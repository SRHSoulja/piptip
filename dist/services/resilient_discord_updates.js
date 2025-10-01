import { prisma } from "./db.js";
class ResilientDiscordUpdateService {
  retryQueue = /* @__PURE__ */ new Map();
  processingTimer = null;
  client = null;
  isShuttingDown = false;
  // Configuration
  DEFAULT_MAX_ATTEMPTS = 8;
  INITIAL_RETRY_DELAY_MS = 1e3;
  // 1 second
  MAX_RETRY_DELAY_MS = 3e5;
  // 5 minutes
  PROCESS_INTERVAL_MS = 5e3;
  // Check queue every 5 seconds
  IMMEDIATE_RETRY_WINDOW_MS = 3e4;
  // Try immediate retries for 30 seconds
  constructor() {
    console.log("\u{1F527} ResilientDiscordUpdateService initialized");
  }
  /**
   * Initialize with Discord client and start processing queue
   */
  async initialize(client) {
    this.client = client;
    console.log("\u{1F680} ResilientDiscordUpdateService started with client");
    this.startProcessingLoop();
    await this.loadPersistentQueue();
  }
  /**
   * Queue a Discord update for reliable delivery
   */
  async queueUpdate(type, tipId, maxAttempts = this.DEFAULT_MAX_ATTEMPTS, exponentialBackoff = true) {
    const updateId = `${type}_${tipId}_${Date.now()}`;
    const pendingUpdate = {
      id: updateId,
      type,
      tipId,
      attempts: 0,
      maxAttempts,
      lastAttemptAt: /* @__PURE__ */ new Date(),
      nextRetryAt: /* @__PURE__ */ new Date(),
      // Try immediately
      exponentialBackoff,
      metadata: { queuedAt: (/* @__PURE__ */ new Date()).toISOString() }
    };
    this.retryQueue.set(updateId, pendingUpdate);
    console.log(`\u{1F4CB} Queued Discord update: ${updateId} for tip ${tipId}`);
    setImmediate(() => this.processUpdate(updateId));
    return updateId;
  }
  /**
   * Attempt a Discord update with comprehensive error handling
   */
  async executeUpdate(update) {
    if (!this.client || !this.client.isReady()) {
      return {
        success: false,
        error: "Discord client not ready",
        shouldRetry: true
      };
    }
    try {
      switch (update.type) {
        case "group_tip_finalize":
          return await this.executeGroupTipUpdate(update);
        default:
          return {
            success: false,
            error: `Unknown update type: ${update.type}`,
            shouldRetry: false
          };
      }
    } catch (error) {
      const errorMessage = error?.message || String(error);
      const shouldRetry = this.shouldRetryError(error);
      console.warn(`\u26A0\uFE0F Discord update ${update.id} failed:`, errorMessage);
      return {
        success: false,
        error: errorMessage,
        shouldRetry
      };
    }
  }
  /**
   * Execute group tip finalization update
   */
  async executeGroupTipUpdate(update) {
    const { tipId } = update;
    const { updateGroupTipMessage } = await import("../features/group_tip_helpers.js");
    const updatePromise = updateGroupTipMessage(this.client, tipId);
    const timeoutPromise = new Promise(
      (_, reject) => setTimeout(() => reject(new Error("Discord update timeout")), 15e3)
    );
    try {
      await Promise.race([updatePromise, timeoutPromise]);
      console.log(`\u2705 Discord message updated successfully for tip ${tipId} (attempt ${update.attempts + 1})`);
      return { success: true, shouldRetry: false };
    } catch (error) {
      const errorMessage = error?.message || String(error);
      const shouldRetry = this.shouldRetryError(error);
      return {
        success: false,
        error: errorMessage,
        shouldRetry
      };
    }
  }
  /**
   * Determine if an error should trigger a retry
   */
  shouldRetryError(error) {
    const errorMessage = error?.message?.toLowerCase() || String(error).toLowerCase();
    if (errorMessage.includes("timeout") || errorMessage.includes("network") || errorMessage.includes("connection") || errorMessage.includes("rate limit") || errorMessage.includes("502") || errorMessage.includes("503") || errorMessage.includes("504")) {
      return true;
    }
    if (error?.status) {
      const status = error.status;
      if ([429, 500, 502, 503, 504].includes(status)) {
        return true;
      }
      if ([403, 404, 400].includes(status)) {
        return false;
      }
    }
    return true;
  }
  /**
   * Process a single update from the queue
   */
  async processUpdate(updateId) {
    const update = this.retryQueue.get(updateId);
    if (!update) {
      return;
    }
    if (Date.now() < update.nextRetryAt.getTime()) {
      return;
    }
    update.attempts++;
    update.lastAttemptAt = /* @__PURE__ */ new Date();
    console.log(`\u{1F504} Processing Discord update ${updateId} (attempt ${update.attempts}/${update.maxAttempts})`);
    const result = await this.executeUpdate(update);
    if (result.success) {
      this.retryQueue.delete(updateId);
      console.log(`\u2705 Discord update ${updateId} completed successfully`);
      return;
    }
    if (update.attempts >= update.maxAttempts || !result.shouldRetry) {
      this.retryQueue.delete(updateId);
      console.error(`\u274C Discord update ${updateId} failed permanently: ${result.error}`);
      await this.logFailedUpdate(update, result.error);
      return;
    }
    const delay = this.calculateRetryDelay(update);
    update.nextRetryAt = new Date(Date.now() + delay);
    console.log(`\u23F3 Discord update ${updateId} will retry in ${Math.ceil(delay / 1e3)}s (attempt ${update.attempts}/${update.maxAttempts})`);
  }
  /**
   * Calculate retry delay with exponential backoff
   */
  calculateRetryDelay(update) {
    if (!update.exponentialBackoff) {
      return this.INITIAL_RETRY_DELAY_MS;
    }
    const baseDelay = this.INITIAL_RETRY_DELAY_MS;
    const exponentialDelay = baseDelay * Math.pow(2, update.attempts - 1);
    return Math.min(exponentialDelay, this.MAX_RETRY_DELAY_MS);
  }
  /**
   * Start the background processing loop
   */
  startProcessingLoop() {
    if (this.processingTimer || this.isShuttingDown) {
      return;
    }
    this.processingTimer = setInterval(async () => {
      if (this.isShuttingDown) {
        return;
      }
      try {
        const updateIds = Array.from(this.retryQueue.keys());
        for (const updateId of updateIds) {
          if (this.isShuttingDown) {
            break;
          }
          await this.processUpdate(updateId);
        }
        this.cleanupOldUpdates();
      } catch (error) {
        console.error("\u{1F525} Error in Discord update processing loop:", error);
      }
    }, this.PROCESS_INTERVAL_MS);
    console.log("\u26A1 Discord update processing loop started");
  }
  /**
   * Clean up old updates from memory
   */
  cleanupOldUpdates() {
    const maxAge = 24 * 60 * 60 * 1e3;
    const cutoff = Date.now() - maxAge;
    for (const [updateId, update] of this.retryQueue.entries()) {
      if (update.lastAttemptAt.getTime() < cutoff) {
        this.retryQueue.delete(updateId);
        console.log(`\u{1F9F9} Cleaned up old Discord update: ${updateId}`);
      }
    }
  }
  /**
   * Load persistent queue from database (if needed for critical updates)
   */
  async loadPersistentQueue() {
    console.log("\u{1F4C2} Persistent queue loading skipped (memory-only implementation)");
  }
  /**
   * Log failed update for monitoring and analysis
   */
  async logFailedUpdate(update, error) {
    try {
      await prisma.transaction.create({
        data: {
          type: "discord_update_failed",
          userId: null,
          guildId: null,
          tokenId: null,
          amount: update.tipId,
          // Store tip ID in amount field for tracking
          fee: update.attempts,
          // Store attempt count in fee field
          txHash: null,
          metadata: JSON.stringify({
            updateId: update.id,
            updateType: update.type,
            tipId: update.tipId,
            attempts: update.attempts,
            error,
            queuedAt: update.metadata?.queuedAt,
            failedAt: (/* @__PURE__ */ new Date()).toISOString()
          })
        }
      });
    } catch (dbError) {
      console.error("\u{1F525} Failed to log Discord update failure to database:", dbError);
    }
  }
  /**
   * Get current queue status for monitoring
   */
  getQueueStatus() {
    const updates = Array.from(this.retryQueue.values()).map((update) => ({
      id: update.id,
      type: update.type,
      tipId: update.tipId,
      attempts: update.attempts,
      maxAttempts: update.maxAttempts,
      nextRetryAt: update.nextRetryAt.toISOString()
    }));
    return {
      queueSize: this.retryQueue.size,
      updates
    };
  }
  /**
   * Shutdown the service gracefully
   */
  async shutdown() {
    console.log("\u{1F6D1} Shutting down ResilientDiscordUpdateService...");
    this.isShuttingDown = true;
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 1e3));
    console.log(`\u{1F4CA} Discord update queue shutdown complete. ${this.retryQueue.size} updates remaining.`);
  }
  /**
   * Force retry all failed updates (admin function)
   */
  async forceRetryAll() {
    console.log(`\u{1F504} Force retrying ${this.retryQueue.size} Discord updates...`);
    for (const [updateId, update] of this.retryQueue.entries()) {
      update.nextRetryAt = /* @__PURE__ */ new Date();
      setImmediate(() => this.processUpdate(updateId));
    }
  }
  /**
   * Clear all pending updates (admin function)
   */
  clearQueue() {
    const queueSize = this.retryQueue.size;
    this.retryQueue.clear();
    console.log(`\u{1F9F9} Cleared ${queueSize} pending Discord updates from queue`);
  }
}
const resilientDiscordUpdates = new ResilientDiscordUpdateService();
async function updateGroupTipMessageResilient(client, tipId, maxAttempts = 8) {
  console.log(`\u{1F680} Queuing resilient Discord update for tip ${tipId}`);
  return await resilientDiscordUpdates.queueUpdate(
    "group_tip_finalize",
    tipId,
    maxAttempts,
    true
    // Use exponential backoff
  );
}
async function initializeResilientDiscordUpdates(client) {
  await resilientDiscordUpdates.initialize(client);
}
async function shutdownResilientDiscordUpdates() {
  await resilientDiscordUpdates.shutdown();
}
export {
  initializeResilientDiscordUpdates,
  resilientDiscordUpdates,
  shutdownResilientDiscordUpdates,
  updateGroupTipMessageResilient
};
//# sourceMappingURL=resilient_discord_updates.js.map
