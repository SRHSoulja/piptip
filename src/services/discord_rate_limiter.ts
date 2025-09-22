// src/services/discord_rate_limiter.ts - Discord API rate limiting protection
import { Collection } from "discord.js";

interface QueuedOperation<T> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  endpoint: string;
  timestamp: number;
}

export class DiscordRateLimiter {
  private queues = new Map<string, QueuedOperation<any>[]>();
  private lastRequest = new Map<string, number>();
  private processing = new Set<string>();

  // Rate limits per endpoint (requests per second)
  private readonly RATE_LIMITS = {
    'channel_fetch': 50,      // Channel operations
    'guild_fetch': 10,        // Guild operations
    'member_fetch': 10,       // Member operations
    'user_fetch': 25,         // User fetching for contributors display
    'message_send': 5,        // Message sending
    'message_edit': 5,        // Message editing
    'interaction_reply': 50,  // Interaction responses
    'default': 5              // Default conservative limit
  };

  // Maximum queue size per endpoint
  private readonly MAX_QUEUE_SIZE = 100;

  // Request timeout (5 seconds for responsive interactions)
  private readonly REQUEST_TIMEOUT = 5000;

  constructor() {
    // Clean up old entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Execute a Discord API operation with rate limiting
   */
  async execute<T>(endpoint: string, operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      // Get or create queue for this endpoint
      if (!this.queues.has(endpoint)) {
        this.queues.set(endpoint, []);
      }

      const queue = this.queues.get(endpoint)!;

      // Check queue size limit
      if (queue.length >= this.MAX_QUEUE_SIZE) {
        reject(new Error(`Rate limit queue full for endpoint: ${endpoint}`));
        return;
      }

      // Add to queue
      queue.push({
        operation,
        resolve,
        reject,
        endpoint,
        timestamp: Date.now()
      });

      // Process queue if not already processing
      if (!this.processing.has(endpoint)) {
        this.processQueue(endpoint);
      }
    });
  }

  private async processQueue(endpoint: string): Promise<void> {
    if (this.processing.has(endpoint)) return;

    this.processing.add(endpoint);
    const queue = this.queues.get(endpoint);

    if (!queue || queue.length === 0) {
      this.processing.delete(endpoint);
      return;
    }

    try {
      const rateLimit = this.RATE_LIMITS[endpoint as keyof typeof this.RATE_LIMITS] || this.RATE_LIMITS.default;
      const minInterval = 1000 / rateLimit; // ms between requests

      const lastRequest = this.lastRequest.get(endpoint) || 0;
      const timeSinceLastRequest = Date.now() - lastRequest;

      // Wait if we need to respect rate limit
      if (timeSinceLastRequest < minInterval) {
        const waitTime = minInterval - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Process next item in queue
      const item = queue.shift();
      if (!item) {
        this.processing.delete(endpoint);
        return;
      }

      // Check if request has timed out
      if (Date.now() - item.timestamp > this.REQUEST_TIMEOUT) {
        item.reject(new Error(`Request timeout for endpoint: ${endpoint}`));
        // Continue processing queue
        setImmediate(() => this.processQueue(endpoint));
        return;
      }

      // Update last request time
      this.lastRequest.set(endpoint, Date.now());

      try {
        // Execute the operation with timeout
        const result = await Promise.race([
          item.operation(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Operation timeout for ${endpoint}`)), this.REQUEST_TIMEOUT)
          )
        ]);
        item.resolve(result);
      } catch (error) {
        // Enhanced error logging for debugging
        console.error(`Discord rate limiter error for ${endpoint}:`, {
          message: (error as any)?.message,
          name: (error as any)?.name,
          code: (error as any)?.code,
          status: (error as any)?.status,
          method: (error as any)?.method,
          url: (error as any)?.url,
          stack: (error as any)?.stack?.split('\n').slice(0, 3).join('\n')
        });

        // Handle Discord rate limit responses
        if (error && typeof error === 'object' && 'status' in error) {
          const status = (error as any).status;
          if (status === 429) {
            // Rate limited - re-queue the request
            console.warn(`Discord rate limit hit for ${endpoint}, retrying...`);
            queue.unshift(item); // Put back at front of queue

            // Wait longer before retrying
            await new Promise(resolve => setTimeout(resolve, 5000));
          } else {
            item.reject(error);
          }
        } else {
          item.reject(error);
        }
      }

      // Continue processing queue
      setImmediate(() => this.processQueue(endpoint));

    } catch (error) {
      console.error(`Rate limiter error for ${endpoint}:`, error);
      this.processing.delete(endpoint);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    // Clean up old last request times
    for (const [endpoint, timestamp] of this.lastRequest.entries()) {
      if (now - timestamp > maxAge) {
        this.lastRequest.delete(endpoint);
      }
    }

    // Clean up old queue items
    for (const [endpoint, queue] of this.queues.entries()) {
      const originalLength = queue.length;

      // Remove timed out items
      for (let i = queue.length - 1; i >= 0; i--) {
        if (now - queue[i].timestamp > this.REQUEST_TIMEOUT) {
          const item = queue.splice(i, 1)[0];
          item.reject(new Error(`Request timeout during cleanup: ${endpoint}`));
        }
      }

      // Remove empty queues
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
  getStatus(): Record<string, any> {
    const status: Record<string, any> = {};

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
  shutdown(): void {
    for (const [endpoint, queue] of this.queues.entries()) {
      for (const item of queue) {
        item.reject(new Error('Rate limiter shutting down'));
      }
    }

    this.queues.clear();
    this.lastRequest.clear();
    this.processing.clear();
  }
}

// Global rate limiter instance
export const discordRateLimiter = new DiscordRateLimiter();

/**
 * Wrapper functions for common Discord operations
 */
export const rateLimitedDiscord = {
  async fetchChannel(client: any, channelId: string) {
    return discordRateLimiter.execute('channel_fetch', () =>
      client.channels.fetch(channelId)
    );
  },

  async fetchGuild(client: any, guildId: string) {
    return discordRateLimiter.execute('guild_fetch', () =>
      client.guilds.fetch(guildId)
    );
  },

  async fetchMember(guild: any, userId: string) {
    return discordRateLimiter.execute('member_fetch', () =>
      guild.members.fetch(userId)
    );
  },

  async sendMessage(channel: any, options: any) {
    return discordRateLimiter.execute('message_send', () =>
      channel.send(options)
    );
  },

  async replyToInteraction(interaction: any, options: any) {
    return discordRateLimiter.execute('interaction_reply', () =>
      interaction.reply(options)
    );
  },

  async editReply(interaction: any, options: any) {
    return discordRateLimiter.execute('interaction_reply', () =>
      interaction.editReply(options)
    );
  },

  async editMessage(message: any, options: any) {
    return discordRateLimiter.execute('message_edit', () =>
      message.edit(options)
    );
  },

  // Direct execute method for custom operations
  async execute<T>(endpoint: string, operation: () => Promise<T>): Promise<T> {
    return discordRateLimiter.execute(endpoint, operation);
  }
};