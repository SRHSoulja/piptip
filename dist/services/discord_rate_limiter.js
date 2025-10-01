class DiscordRateLimiter {
  queues = /* @__PURE__ */ new Map();
  lastRequest = /* @__PURE__ */ new Map();
  processing = /* @__PURE__ */ new Set();
  // Rate limits per endpoint (requests per second)
  RATE_LIMITS = {
    "channel_fetch": 50,
    // Channel operations
    "guild_fetch": 10,
    // Guild operations
    "member_fetch": 10,
    // Member operations
    "user_fetch": 25,
    // User fetching for contributors display
    "message_send": 5,
    // Message sending
    "message_edit": 5,
    // Message editing
    "interaction_reply": 50,
    // Interaction responses
    "default": 5
    // Default conservative limit
  };
  // Maximum queue size per endpoint
  MAX_QUEUE_SIZE = 100;
  // Request timeout (5 seconds for responsive interactions)
  REQUEST_TIMEOUT = 5e3;
  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1e3);
  }
  /**
   * Execute a Discord API operation with rate limiting
   */
  async execute(endpoint, operation) {
    return new Promise((resolve, reject) => {
      if (!this.queues.has(endpoint)) {
        this.queues.set(endpoint, []);
      }
      const queue = this.queues.get(endpoint);
      if (queue.length >= this.MAX_QUEUE_SIZE) {
        reject(new Error(`Rate limit queue full for endpoint: ${endpoint}`));
        return;
      }
      queue.push({
        operation,
        resolve,
        reject,
        endpoint,
        timestamp: Date.now()
      });
      if (!this.processing.has(endpoint)) {
        this.processQueue(endpoint);
      }
    });
  }
  async processQueue(endpoint) {
    if (this.processing.has(endpoint)) return;
    this.processing.add(endpoint);
    const queue = this.queues.get(endpoint);
    if (!queue || queue.length === 0) {
      this.processing.delete(endpoint);
      return;
    }
    try {
      const rateLimit = this.RATE_LIMITS[endpoint] || this.RATE_LIMITS.default;
      const minInterval = 1e3 / rateLimit;
      const lastRequest = this.lastRequest.get(endpoint) || 0;
      const timeSinceLastRequest = Date.now() - lastRequest;
      if (timeSinceLastRequest < minInterval) {
        const waitTime = minInterval - timeSinceLastRequest;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
      const item = queue.shift();
      if (!item) {
        this.processing.delete(endpoint);
        return;
      }
      if (Date.now() - item.timestamp > this.REQUEST_TIMEOUT) {
        item.reject(new Error(`Request timeout for endpoint: ${endpoint}`));
        setImmediate(() => this.processQueue(endpoint));
        return;
      }
      this.lastRequest.set(endpoint, Date.now());
      try {
        const result = await Promise.race([
          item.operation(),
          new Promise(
            (_, reject) => setTimeout(() => reject(new Error(`Operation timeout for ${endpoint}`)), this.REQUEST_TIMEOUT)
          )
        ]);
        item.resolve(result);
      } catch (error) {
        console.error(`Discord rate limiter error for ${endpoint}:`, {
          message: error?.message,
          name: error?.name,
          code: error?.code,
          status: error?.status,
          method: error?.method,
          url: error?.url,
          stack: error?.stack?.split("\n").slice(0, 3).join("\n")
        });
        if (error && typeof error === "object" && "status" in error) {
          const status = error.status;
          if (status === 429) {
            console.warn(`Discord rate limit hit for ${endpoint}, retrying...`);
            queue.unshift(item);
            await new Promise((resolve) => setTimeout(resolve, 5e3));
          } else {
            item.reject(error);
          }
        } else {
          item.reject(error);
        }
      }
      setImmediate(() => this.processQueue(endpoint));
    } catch (error) {
      console.error(`Rate limiter error for ${endpoint}:`, error);
      this.processing.delete(endpoint);
    }
  }
  cleanup() {
    const now = Date.now();
    const maxAge = 10 * 60 * 1e3;
    for (const [endpoint, timestamp] of this.lastRequest.entries()) {
      if (now - timestamp > maxAge) {
        this.lastRequest.delete(endpoint);
      }
    }
    for (const [endpoint, queue] of this.queues.entries()) {
      const originalLength = queue.length;
      for (let i = queue.length - 1; i >= 0; i--) {
        if (now - queue[i].timestamp > this.REQUEST_TIMEOUT) {
          const item = queue.splice(i, 1)[0];
          item.reject(new Error(`Request timeout during cleanup: ${endpoint}`));
        }
      }
      if (queue.length === 0) {
        this.queues.delete(endpoint);
      } else if (originalLength !== queue.length) {
        console.log(`Cleaned up ${originalLength - queue.length} expired requests for ${endpoint}`);
      }
    }
  }
  /**
   * Get current queue status for monitoring
   */
  getStatus() {
    const status = {};
    for (const [endpoint, queue] of this.queues.entries()) {
      status[endpoint] = {
        queueLength: queue.length,
        processing: this.processing.has(endpoint),
        lastRequest: this.lastRequest.get(endpoint) || 0
      };
    }
    return status;
  }
  /**
   * Clear all queues (for shutdown)
   */
  shutdown() {
    for (const [endpoint, queue] of this.queues.entries()) {
      for (const item of queue) {
        item.reject(new Error("Rate limiter shutting down"));
      }
    }
    this.queues.clear();
    this.lastRequest.clear();
    this.processing.clear();
  }
}
const discordRateLimiter = new DiscordRateLimiter();
const rateLimitedDiscord = {
  async fetchChannel(client, channelId) {
    return discordRateLimiter.execute(
      "channel_fetch",
      () => client.channels.fetch(channelId)
    );
  },
  async fetchGuild(client, guildId) {
    return discordRateLimiter.execute(
      "guild_fetch",
      () => client.guilds.fetch(guildId)
    );
  },
  async fetchMember(guild, userId) {
    return discordRateLimiter.execute(
      "member_fetch",
      () => guild.members.fetch(userId)
    );
  },
  async sendMessage(channel, options) {
    return discordRateLimiter.execute(
      "message_send",
      () => channel.send(options)
    );
  },
  async replyToInteraction(interaction, options) {
    return discordRateLimiter.execute(
      "interaction_reply",
      () => interaction.reply(options)
    );
  },
  async editReply(interaction, options) {
    return discordRateLimiter.execute(
      "interaction_reply",
      () => interaction.editReply(options)
    );
  },
  async editMessage(message, options) {
    return discordRateLimiter.execute(
      "message_edit",
      () => message.edit(options)
    );
  },
  // Direct execute method for custom operations
  async execute(endpoint, operation) {
    return discordRateLimiter.execute(endpoint, operation);
  }
};
export {
  DiscordRateLimiter,
  discordRateLimiter,
  rateLimitedDiscord
};
//# sourceMappingURL=discord_rate_limiter.js.map
