import { createClient } from "redis";
class PIPTipCache {
  redis = null;
  connecting = false;
  connected = false;
  constructor() {
    this.initializeRedis();
  }
  async initializeRedis() {
    if (this.connecting || this.connected) return;
    if (!process.env.REDIS_URL || process.env.REDIS_URL === "") {
      console.log("Redis disabled - cache will operate without persistence");
      return;
    }
    try {
      this.connecting = true;
      const redisUrl = process.env.REDIS_URL;
      this.redis = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 5e3
        }
      });
      this.redis.on("error", (err) => {
        console.error("Redis Client Error:", err);
        this.connected = false;
      });
      this.redis.on("connect", () => {
        console.log("\u2705 Redis connected successfully");
        this.connected = true;
      });
      this.redis.on("disconnect", () => {
        console.log("\u26A0\uFE0F Redis disconnected");
        this.connected = false;
      });
      await this.redis.connect();
      this.connecting = false;
    } catch (error) {
      console.error("Failed to initialize Redis:", error);
      this.connecting = false;
      this.redis = null;
    }
  }
  async ensureConnection() {
    if (!this.redis || !this.connected) {
      await this.initializeRedis();
    }
  }
  async get(key) {
    try {
      await this.ensureConnection();
      if (!this.redis) return null;
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("Redis get error:", error);
      return null;
    }
  }
  async set(key, value, ttlSeconds = 300) {
    try {
      await this.ensureConnection();
      if (!this.redis) return;
      await this.redis.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      console.error("Redis set error:", error);
    }
  }
  async del(key) {
    try {
      await this.ensureConnection();
      if (!this.redis) return;
      await this.redis.del(key);
    } catch (error) {
      console.error("Redis del error:", error);
    }
  }
  async delPattern(pattern) {
    try {
      await this.ensureConnection();
      if (!this.redis) return;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(keys);
      }
    } catch (error) {
      console.error("Redis delPattern error:", error);
    }
  }
  async exists(key) {
    try {
      await this.ensureConnection();
      if (!this.redis) return false;
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error("Redis exists error:", error);
      return false;
    }
  }
  async increment(key, ttlSeconds = 300) {
    try {
      await this.ensureConnection();
      if (!this.redis) return 0;
      const result = await this.redis.incr(key);
      if (result === 1) {
        await this.redis.expire(key, ttlSeconds);
      }
      return result;
    } catch (error) {
      console.error("Redis increment error:", error);
      return 0;
    }
  }
  // Health check for monitoring
  async ping() {
    try {
      await this.ensureConnection();
      if (!this.redis) return false;
      const result = await this.redis.ping();
      return result === "PONG";
    } catch (error) {
      console.error("Redis ping error:", error);
      return false;
    }
  }
  // Graceful shutdown
  async disconnect() {
    try {
      if (this.redis && this.connected) {
        await this.redis.quit();
        this.connected = false;
      }
    } catch (error) {
      console.error("Redis disconnect error:", error);
    }
  }
}
const cache = new PIPTipCache();
const CacheKeys = {
  // Token data
  ACTIVE_TOKENS: "piptip:tokens:active",
  TOKEN: (id) => `piptip:token:${id}`,
  // User data
  USER_BALANCE: (userId, tokenId) => `piptip:balance:${userId}:${tokenId}`,
  USER_TIER: (userId) => `piptip:tier:${userId}`,
  USER_PROFILE: (userId) => `piptip:profile:${userId}`,
  // Leaderboards
  LEADERBOARD_SOCIAL: "piptip:leaderboard:social",
  LEADERBOARD_LEVEL: "piptip:leaderboard:level",
  LEADERBOARD_GENEROSITY: "piptip:leaderboard:generosity",
  // Rate limiting
  RATE_LIMIT: (userId, action) => `piptip:ratelimit:${userId}:${action}`,
  // Achievements
  USER_ACHIEVEMENTS: (userId) => `piptip:achievements:${userId}`,
  // Group tips
  GROUP_TIP: (id) => `piptip:grouptip:${id}`,
  // Streaks
  USER_STREAK: (userId) => `piptip:streak:${userId}`,
  // Legacy compatibility
  leaderboard: (type) => type ? `piptip:leaderboard:${type}` : "piptip:leaderboard:social",
  userStreak: (userId) => `piptip:streak:${userId}`,
  userAchievements: (userId) => `piptip:achievements:${userId}`
};
const CacheTTL = {
  TOKENS: 300,
  // 5 minutes
  BALANCE: 60,
  // 1 minute
  TIER: 3600,
  // 1 hour
  PROFILE: 300,
  // 5 minutes
  LEADERBOARD: 300,
  // 5 minutes
  RATE_LIMIT: 60,
  // 1 minute
  ACHIEVEMENTS: 600,
  // 10 minutes
  GROUP_TIP: 30,
  // 30 seconds
  // Legacy compatibility
  leaderboard: 300,
  // 5 minutes
  streak: 300,
  // 5 minutes
  achievements: 600
  // 10 minutes
};
const getCache = cache;
async function cacheWithMetrics(key, fetcher, ttlSeconds) {
  const cached = await cache.get(key);
  if (cached !== null) {
    return cached;
  }
  const fresh = await fetcher();
  await cache.set(key, fresh, ttlSeconds);
  return fresh;
}
export {
  CacheKeys,
  CacheTTL,
  PIPTipCache,
  cache,
  cacheWithMetrics,
  getCache
};
//# sourceMappingURL=cache.js.map
