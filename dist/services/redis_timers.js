import { createClient } from "redis";
import { finalizeExpiredGroupTip } from "../features/finalizeExpiredGroupTip.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
class RedisTimerService {
  client = null;
  subscriber = null;
  discordClient = null;
  isConnected = false;
  /**
   * Initialize Redis connections with fallback handling
   */
  async initialize(discordClient) {
    this.discordClient = discordClient;
    if (!process.env.REDIS_URL || process.env.REDIS_URL === "") {
      console.log("Redis timer service disabled - falling back to existing timer system");
      this.isConnected = false;
      return;
    }
    try {
      this.client = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: 5e3
        }
      });
      this.subscriber = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: 5e3
        }
      });
      await Promise.all([
        this.client.connect(),
        this.subscriber.connect()
      ]);
      await this.client.configSet("notify-keyspace-events", "Ex");
      await this.subscriber.pSubscribe("__keyevent@0__:expired", (message, channel) => {
        this.handleExpiredKey(message).catch((error) => {
          console.error("\u274C Redis expiration handler error:", error.message);
        });
      });
      this.isConnected = true;
      console.log("\u2705 Redis timer service connected and listening for expiration events");
    } catch (error) {
      console.warn("\u26A0\uFE0F Redis connection failed, falling back to existing system:", error.message);
      this.isConnected = false;
    }
  }
  /**
   * Schedule a group tip to expire at exact timestamp
   */
  async scheduleGroupTipExpiry(tipId, expiresAt) {
    if (!this.isConnected || !this.client) {
      console.log(`\u26A0\uFE0F Redis not available, skipping timer for tip ${tipId}`);
      return false;
    }
    try {
      const key = `grouptip:${tipId}`;
      const ttlSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1e3));
      await this.client.setEx(key, ttlSeconds, JSON.stringify({
        tipId,
        expiresAt: expiresAt.toISOString(),
        scheduledAt: (/* @__PURE__ */ new Date()).toISOString()
      }));
      console.log(`\u23F0 Redis timer set for tip ${tipId}: expires in ${ttlSeconds} seconds (${expiresAt.toISOString()})`);
      return true;
    } catch (error) {
      console.error(`\u274C Failed to schedule Redis timer for tip ${tipId}:`, error.message);
      return false;
    }
  }
  /**
   * Cancel a scheduled group tip timer
   */
  async cancelGroupTipTimer(tipId) {
    if (!this.isConnected || !this.client) {
      return false;
    }
    try {
      const key = `grouptip:${tipId}`;
      const deleted = await this.client.del(key);
      if (deleted > 0) {
        console.log(`\u2705 Redis timer cancelled for tip ${tipId}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`\u274C Failed to cancel Redis timer for tip ${tipId}:`, error.message);
      return false;
    }
  }
  /**
   * Handle expired key from Redis keyspace notification
   */
  async handleExpiredKey(key) {
    if (!key.startsWith("grouptip:")) {
      return;
    }
    const tipId = parseInt(key.replace("grouptip:", ""));
    if (!Number.isFinite(tipId)) {
      console.error(`\u274C Invalid tip ID from Redis key: ${key}`);
      return;
    }
    console.log(`\u{1F525} Redis timer FIRED for tip ${tipId} - processing expiry NOW!`);
    try {
      const result = await Promise.race([
        this.processExpiredTip(tipId),
        new Promise(
          (_, reject) => setTimeout(() => reject(new Error("Redis expiry processing timeout")), 15e3)
        )
      ]);
      console.log(`\u2705 Redis timer completion for tip ${tipId}: ${result.kind}`);
    } catch (error) {
      console.error(`\u274C Redis timer processing failed for tip ${tipId}:`, error.message);
    }
  }
  /**
   * Process expired tip with database finalization and Discord update
   */
  async processExpiredTip(tipId) {
    const result = await finalizeExpiredGroupTip(tipId);
    if (this.discordClient && this.discordClient.isReady()) {
      try {
        await Promise.race([
          updateGroupTipMessage(this.discordClient, tipId),
          new Promise(
            (_, reject) => setTimeout(() => reject(new Error("Discord update timeout")), 8e3)
          )
        ]);
        console.log(`\u{1F4F1} Discord message updated for tip ${tipId}`);
      } catch (discordError) {
        console.warn(`\u26A0\uFE0F Discord update failed for tip ${tipId}:`, discordError.message);
      }
    }
    return result;
  }
  /**
   * Get timer status for monitoring
   */
  async getTimerStatus() {
    if (!this.isConnected || !this.client) {
      return { active: 0, connected: false };
    }
    try {
      const keys = await this.client.keys("grouptip:*");
      return {
        active: keys.length,
        connected: true,
        timers: keys
      };
    } catch (error) {
      console.error("\u274C Redis status check failed:", error.message);
      return { active: 0, connected: false };
    }
  }
  /**
   * Cleanup and disconnect
   */
  async disconnect() {
    try {
      if (this.subscriber) {
        await this.subscriber.pUnsubscribe();
        await this.subscriber.disconnect();
      }
      if (this.client) {
        await this.client.disconnect();
      }
      this.isConnected = false;
      console.log("\u2705 Redis timer service disconnected");
    } catch (error) {
      console.warn("\u26A0\uFE0F Redis disconnect error:", error.message);
    }
  }
  /**
   * Restore timers for existing active group tips
   */
  async restoreActiveTimers() {
    if (!this.isConnected) {
      return 0;
    }
    try {
      const { prisma } = await import("./db.js");
      const activeTips = await prisma.groupTip.findMany({
        where: {
          status: "ACTIVE",
          expiresAt: { gt: /* @__PURE__ */ new Date() }
          // Only future tips
        },
        select: { id: true, expiresAt: true }
      });
      let restored = 0;
      for (const tip of activeTips) {
        const success = await this.scheduleGroupTipExpiry(tip.id, tip.expiresAt);
        if (success) restored++;
      }
      console.log(`\u2705 Restored ${restored}/${activeTips.length} Redis timers`);
      return restored;
    } catch (error) {
      console.error("\u274C Failed to restore Redis timers:", error.message);
      return 0;
    }
  }
}
const redisTimers = new RedisTimerService();
export {
  redisTimers
};
//# sourceMappingURL=redis_timers.js.map
