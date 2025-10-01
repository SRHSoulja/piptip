class RedisCache {
  redis = null;
  fallbackCache = /* @__PURE__ */ new Map();
  config;
  isConnected = false;
  constructor() {
    this.config = {
      defaultTTL: 300,
      // 5 minutes
      maxRetries: 3,
      retryDelayOnFailover: 100
    };
    this.initializeFallback();
  }
  initializeFallback() {
    console.log("Redis cache initialized in fallback mode (memory-only)");
    this.isConnected = false;
    setInterval(() => this.cleanupExpiredItems(), 6e4);
  }
  cleanupExpiredItems() {
    const now = Date.now();
    for (const [key, item] of this.fallbackCache.entries()) {
      if (now - item.timestamp > item.ttl * 1e3) {
        this.fallbackCache.delete(key);
      }
    }
  }
  async get(key) {
    try {
      const item = this.fallbackCache.get(key);
      if (!item) return null;
      if (Date.now() - item.timestamp > item.ttl * 1e3) {
        this.fallbackCache.delete(key);
        return null;
      }
      return item.data;
    } catch (error) {
      console.error("Cache get error:", error);
      return null;
    }
  }
  async set(key, value, ttlSeconds) {
    try {
      const ttl = ttlSeconds || this.config.defaultTTL;
      this.fallbackCache.set(key, {
        data: value,
        timestamp: Date.now(),
        ttl
      });
      return true;
    } catch (error) {
      console.error("Cache set error:", error);
      return false;
    }
  }
  async del(key) {
    try {
      return this.fallbackCache.delete(key);
    } catch (error) {
      console.error("Cache delete error:", error);
      return false;
    }
  }
  async exists(key) {
    try {
      const item = this.fallbackCache.get(key);
      if (!item) return false;
      if (Date.now() - item.timestamp > item.ttl * 1e3) {
        this.fallbackCache.delete(key);
        return false;
      }
      return true;
    } catch (error) {
      console.error("Cache exists error:", error);
      return false;
    }
  }
  async clear() {
    try {
      this.fallbackCache.clear();
      return true;
    } catch (error) {
      console.error("Cache clear error:", error);
      return false;
    }
  }
  async keys(pattern) {
    try {
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      const matchingKeys = [];
      for (const key of this.fallbackCache.keys()) {
        if (regex.test(key)) {
          const item = this.fallbackCache.get(key);
          if (item && Date.now() - item.timestamp <= item.ttl * 1e3) {
            matchingKeys.push(key);
          } else if (item) {
            this.fallbackCache.delete(key);
          }
        }
      }
      return matchingKeys;
    } catch (error) {
      console.error("Cache keys error:", error);
      return [];
    }
  }
  async delPattern(pattern) {
    try {
      const keys = await this.keys(pattern);
      let deleted = 0;
      for (const key of keys) {
        if (await this.del(key)) {
          deleted++;
        }
      }
      return deleted;
    } catch (error) {
      console.error("Cache delete pattern error:", error);
      return 0;
    }
  }
  // Health check
  isHealthy() {
    return true;
  }
  // Get connection status
  getStatus() {
    return {
      connected: this.isConnected,
      mode: "fallback",
      itemCount: this.fallbackCache.size
    };
  }
}
const redisCache = new RedisCache();
async function getCached(key) {
  return redisCache.get(key);
}
async function setCache(key, value, ttlSeconds) {
  return redisCache.set(key, value, ttlSeconds);
}
async function delCache(key) {
  return redisCache.del(key);
}
async function clearCache() {
  return redisCache.clear();
}
async function getCachedTokens() {
  return redisCache.get("tokens:all");
}
async function setCachedTokens(tokens, ttlSeconds = 300) {
  return redisCache.set("tokens:all", tokens, ttlSeconds);
}
export {
  clearCache,
  delCache,
  getCached,
  getCachedTokens,
  redisCache,
  setCache,
  setCachedTokens
};
//# sourceMappingURL=redis_cache.js.map
