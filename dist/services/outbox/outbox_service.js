import { EmbedBuilder, ButtonBuilder, ActionRowBuilder } from "discord.js";
import { prisma } from "../db.js";
import crypto from "crypto";
class OutboxService {
  constructor(discord, config = {
    batchSize: 50,
    pollInterval: 2e3,
    // 2 seconds
    retryDelays: [1e3, 2e3, 5e3, 1e4, 3e4],
    // exponential backoff
    rateLimit: {
      messagesPerMinute: 50,
      // Conservative Discord rate limit
      burstLimit: 10
      // Max burst before throttling
    }
  }) {
    this.discord = discord;
    this.config = config;
  }
  processing = false;
  intervalId = null;
  rateLimitTracker = /* @__PURE__ */ new Map();
  /**
   * Add message to outbox within a transaction (ensures atomicity)
   */
  async addMessage(tx, message) {
    const messageHash = this.generateMessageHash(message);
    try {
      const outboxMessage = await tx.outboxMessage.create({
        data: {
          aggregateId: message.aggregateId,
          aggregateType: message.aggregateType,
          eventType: message.eventType,
          channelId: message.channelId,
          userId: message.userId,
          guildId: message.guildId,
          payload: message.payload,
          messageHash,
          priority: message.priority || 5,
          status: "PENDING",
          attempts: 0,
          maxAttempts: this.config.retryDelays.length,
          nextRetryAt: /* @__PURE__ */ new Date()
        }
      });
      console.log(`\u{1F4EC} Message queued: ${message.eventType} for ${message.aggregateType}:${message.aggregateId}`);
      return outboxMessage.id;
    } catch (error) {
      if (error.code === "P2002" && error.meta?.target?.includes("messageHash")) {
        console.log(`\u{1F4EC} Duplicate message prevented: ${message.eventType}`);
        const existing = await tx.outboxMessage.findUnique({
          where: { messageHash },
          select: { id: true }
        });
        return existing?.id || "duplicate";
      }
      throw error;
    }
  }
  /**
   * Start the outbox processor
   */
  start() {
    if (this.intervalId) {
      console.warn("\u26A0\uFE0F Outbox processor already started");
      return;
    }
    console.log("\u{1F680} Starting outbox processor");
    this.intervalId = setInterval(() => {
      this.processMessages().catch((error) => {
        console.error("\u274C Error in outbox processor:", error);
      });
    }, this.config.pollInterval);
    this.processMessages();
  }
  /**
   * Stop the outbox processor
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("\u{1F6D1} Outbox processor stopped");
    }
  }
  /**
   * Process pending messages with priority ordering and rate limiting
   */
  async processMessages() {
    if (this.processing) {
      return;
    }
    this.processing = true;
    try {
      const messages = await prisma.outboxMessage.findMany({
        where: {
          status: { in: ["PENDING"] },
          nextRetryAt: { lte: /* @__PURE__ */ new Date() }
        },
        take: this.config.batchSize,
        orderBy: [
          { priority: "asc" },
          // Higher priority first (lower number)
          { createdAt: "asc" }
          // FIFO within same priority
        ]
      });
      if (messages.length === 0) {
        return;
      }
      console.log(`\u{1F4EC} Processing ${messages.length} outbox messages`);
      for (const message of messages) {
        if (this.isRateLimited(message.guildId || "global")) {
          console.log(`\u23F3 Rate limited, skipping message ${message.id}`);
          continue;
        }
        await this.processMessage(message);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      this.processing = false;
    }
  }
  /**
   * Process individual message with comprehensive error handling
   */
  async processMessage(message) {
    try {
      await prisma.outboxMessage.update({
        where: { id: message.id },
        data: {
          status: "PROCESSING",
          attempts: message.attempts + 1
        }
      });
      await this.sendToDiscord(message);
      await prisma.outboxMessage.update({
        where: { id: message.id },
        data: {
          status: "SENT",
          processedAt: /* @__PURE__ */ new Date()
        }
      });
      this.trackRateLimit(message.guildId || "global");
      console.log(`\u2705 Message sent: ${message.eventType} (${message.id})`);
    } catch (error) {
      await this.handleMessageFailure(message, error);
    }
  }
  /**
   * Send message to Discord with proper formatting and error handling
   */
  async sendToDiscord(message) {
    const { channelId, userId, guildId, payload } = message;
    const messageOptions = {
      content: payload.content
    };
    if (payload.embeds && payload.embeds.length > 0) {
      messageOptions.embeds = payload.embeds.map(
        (embedData) => new EmbedBuilder(embedData)
      );
    }
    if (payload.components && payload.components.length > 0) {
      messageOptions.components = payload.components.map((componentData) => {
        if (componentData.components) {
          return new ActionRowBuilder().addComponents(
            componentData.components.map((comp) => {
              if (comp.type === 2) {
                return new ButtonBuilder(comp);
              }
              return comp;
            })
          );
        }
        return componentData;
      });
    }
    if (payload.files && payload.files.length > 0) {
      messageOptions.files = payload.files;
    }
    if (channelId) {
      const channel = await this.discord.channels.fetch(channelId);
      if (!channel) {
        throw new Error(`Channel ${channelId} not found or not accessible`);
      }
      if (!channel.isTextBased()) {
        throw new Error(`Channel ${channelId} is not a text channel`);
      }
      await channel.send(messageOptions);
    } else if (userId) {
      const user = await this.discord.users.fetch(userId);
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }
      await user.send(messageOptions);
    } else {
      throw new Error("No channelId or userId specified for message delivery");
    }
  }
  /**
   * Handle message delivery failures with retry logic
   */
  async handleMessageFailure(message, error) {
    const attempts = message.attempts;
    const isRateLimit = error.message.includes("429") || error.message.includes("rate limit");
    const isPermissionError = error.message.includes("50013") || error.message.includes("permission");
    const isNotFound = error.message.includes("10003") || error.message.includes("not found");
    console.error(`\u274C Message delivery failed (attempt ${attempts}): ${error.message}`);
    if (isNotFound || isPermissionError) {
      await prisma.outboxMessage.update({
        where: { id: message.id },
        data: {
          status: "FAILED",
          lastError: error.message
        }
      });
      console.warn(`\u26A0\uFE0F Message ${message.id} failed permanently: ${error.message}`);
      return;
    }
    if (attempts >= message.maxAttempts && !isRateLimit) {
      await prisma.outboxMessage.update({
        where: { id: message.id },
        data: {
          status: "DLQ",
          lastError: error.message
        }
      });
      console.error(`\u{1F6A8} Message ${message.id} moved to DLQ after ${attempts} attempts`);
      return;
    }
    const retryDelay = isRateLimit ? 6e4 : this.config.retryDelays[Math.min(attempts - 1, this.config.retryDelays.length - 1)];
    await prisma.outboxMessage.update({
      where: { id: message.id },
      data: {
        status: "PENDING",
        lastError: error.message,
        nextRetryAt: new Date(Date.now() + retryDelay)
      }
    });
    console.log(`\u{1F504} Message ${message.id} scheduled for retry in ${retryDelay}ms`);
  }
  /**
   * Check if rate limited for a guild
   */
  isRateLimited(guildId) {
    const now = Date.now();
    const tracker = this.rateLimitTracker.get(guildId);
    if (!tracker) {
      return false;
    }
    if (now > tracker.resetAt) {
      this.rateLimitTracker.delete(guildId);
      return false;
    }
    return tracker.count >= this.config.rateLimit.messagesPerMinute;
  }
  /**
   * Track rate limit usage
   */
  trackRateLimit(guildId) {
    const now = Date.now();
    const tracker = this.rateLimitTracker.get(guildId);
    if (!tracker || now > tracker.resetAt) {
      this.rateLimitTracker.set(guildId, {
        count: 1,
        resetAt: now + 6e4
        // 1 minute window
      });
    } else {
      tracker.count++;
    }
  }
  /**
   * Generate unique hash for message deduplication
   */
  generateMessageHash(message) {
    const content = {
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      channelId: message.channelId,
      userId: message.userId,
      payload: message.payload
    };
    return crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
  }
  /**
   * Get outbox statistics for monitoring
   */
  async getStats() {
    const stats = await prisma.outboxMessage.groupBy({
      by: ["status"],
      _count: { id: true }
    });
    const recentFailures = await prisma.outboxMessage.count({
      where: {
        status: "FAILED",
        createdAt: {
          gte: new Date(Date.now() - 36e5)
          // Last hour
        }
      }
    });
    const rateLimitInfo = Array.from(this.rateLimitTracker.entries()).map(([guildId, tracker]) => ({
      guildId,
      messagesSent: tracker.count,
      resetAt: new Date(tracker.resetAt).toISOString()
    }));
    return {
      messagesByStatus: stats.reduce((acc, stat) => {
        acc[stat.status] = stat._count.id;
        return acc;
      }, {}),
      recentFailures,
      rateLimitInfo,
      isProcessing: this.processing,
      lastProcessed: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  /**
   * Cleanup old messages (run periodically)
   */
  async cleanup(daysToKeep = 7) {
    const cutoffDate = /* @__PURE__ */ new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const result = await prisma.outboxMessage.deleteMany({
      where: {
        status: "SENT",
        processedAt: { lt: cutoffDate }
      }
    });
    if (result.count > 0) {
      console.log(`\u{1F9F9} Cleaned up ${result.count} old outbox messages`);
    }
    return result.count;
  }
  /**
   * Force retry all failed messages (admin operation)
   */
  async retryFailedMessages() {
    const result = await prisma.outboxMessage.updateMany({
      where: {
        status: { in: ["FAILED", "DLQ"] }
      },
      data: {
        status: "PENDING",
        attempts: 0,
        nextRetryAt: /* @__PURE__ */ new Date(),
        lastError: null
      }
    });
    console.log(`\u{1F504} Queued ${result.count} failed messages for retry`);
    return result.count;
  }
}
const outboxService = new OutboxService(
  // Discord client will be injected when service starts
  {}
);
console.log("\u{1F680} Outbox service initialized for reliable Discord message delivery");
export {
  OutboxService,
  outboxService
};
//# sourceMappingURL=outbox_service.js.map
