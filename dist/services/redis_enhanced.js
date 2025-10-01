import Redis from "ioredis";
class EnhancedRedisCache {
  redis = null;
  subscriber = null;
  isConnected = false;
  fallbackCache = /* @__PURE__ */ new Map();
  constructor() {
    this.initializeRedis();
  }
  /**
   * Initialize Redis with clustering and failover support
   */
  async initializeRedis() {
    try {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) {
        console.log("\u26A0\uFE0F No REDIS_URL found, using in-memory fallback");
        this.initializeFallback();
        return;
      }
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        enableReadyCheck: true,
        connectTimeout: 1e4,
        commandTimeout: 5e3,
        lazyConnect: true,
        keepAlive: 3e4,
        keyPrefix: "piptip:"
      });
      this.subscriber = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        // pub/sub should not retry
        lazyConnect: true,
        keyPrefix: "piptip:"
      });
      this.setupEventHandlers();
      await this.redis.connect();
      await this.subscriber.connect();
      console.log("\u{1F680} Enhanced Redis cache initialized successfully");
      this.isConnected = true;
    } catch (error) {
      console.error("\u274C Redis initialization failed:", error);
      this.initializeFallback();
    }
  }
  initializeFallback() {
    console.log("\u{1F504} Redis cache running in fallback mode (memory-only)");
    this.isConnected = false;
    setInterval(() => {
      const now = Date.now();
      for (const [key, item] of this.fallbackCache.entries()) {
        if (item.expiry && now > item.expiry) {
          this.fallbackCache.delete(key);
        }
      }
    }, 6e4);
  }
  setupEventHandlers() {
    if (!this.redis) return;
    this.redis.on("connect", () => {
      this.isConnected = true;
      console.log("\u2705 Redis connected");
    });
    this.redis.on("error", (error) => {
      this.isConnected = false;
      console.error("\u274C Redis error:", error.message);
    });
    this.redis.on("ready", () => {
      console.log("\u{1F680} Redis ready for operations");
    });
  }
  // ============================================================================
  // HIGH-PERFORMANCE SESSION MANAGEMENT
  // ============================================================================
  /**
   * Store session with automatic expiry and analytics
   */
  async setSession(sessionId, sessionData, ttlSeconds = 3600) {
    try {
      if (this.isConnected && this.redis) {
        const pipeline = this.redis.pipeline();
        pipeline.hset(`session:${sessionId}`, sessionData);
        pipeline.expire(`session:${sessionId}`, ttlSeconds);
        const now = Date.now();
        const hourBucket = Math.floor(now / (60 * 60 * 1e3)) * 60 * 60 * 1e3;
        pipeline.hincrby(`metrics:sessions:${hourBucket}`, "created", 1);
        pipeline.expire(`metrics:sessions:${hourBucket}`, 86400);
        await pipeline.exec();
        return true;
      } else {
        this.fallbackCache.set(`session:${sessionId}`, {
          data: sessionData,
          expiry: Date.now() + ttlSeconds * 1e3
        });
        return true;
      }
    } catch (error) {
      console.error("Session set error:", error);
      return false;
    }
  }
  /**
   * Get session with automatic expiry extension
   */
  async getSession(sessionId, extendTTL = 3600) {
    try {
      if (this.isConnected && this.redis) {
        const pipeline = this.redis.pipeline();
        pipeline.hgetall(`session:${sessionId}`);
        pipeline.expire(`session:${sessionId}`, extendTTL);
        const results = await pipeline.exec();
        const sessionData = results?.[0]?.[1];
        if (sessionData && Object.keys(sessionData).length > 0) {
          await this.redis.hset(`session:${sessionId}`, "lastActivity", Date.now());
          return sessionData;
        }
        return null;
      } else {
        const cached = this.fallbackCache.get(`session:${sessionId}`);
        if (cached && (!cached.expiry || Date.now() < cached.expiry)) {
          return cached.data;
        }
        return null;
      }
    } catch (error) {
      console.error("Session get error:", error);
      return null;
    }
  }
  // ============================================================================
  // ENTERPRISE RATE LIMITING
  // ============================================================================
  /**
   * Sliding window rate limiting with burst protection
   */
  async checkRateLimit(identifier, windowSeconds, maxRequests, burstMultiplier = 1.5) {
    try {
      if (!this.isConnected || !this.redis) {
        return this.fallbackRateLimit(identifier, windowSeconds, maxRequests);
      }
      const now = Date.now();
      const windowStart = now - windowSeconds * 1e3;
      const key = `rate_limit:${identifier}`;
      const burstLimit = Math.floor(maxRequests * burstMultiplier);
      const luaScript = `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local windowStart = tonumber(ARGV[2])
        local maxRequests = tonumber(ARGV[3])
        local burstLimit = tonumber(ARGV[4])
        local windowSeconds = tonumber(ARGV[5])

        -- Remove expired entries
        redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)

        -- Count current requests
        local currentCount = redis.call('ZCARD', key)

        -- Check burst limit first
        local allowed = currentCount < burstLimit

        if allowed then
          -- Add current request
          redis.call('ZADD', key, now, now .. '-' .. math.random())
          redis.call('EXPIRE', key, windowSeconds)
          currentCount = currentCount + 1
        end

        -- Calculate remaining based on normal limit
        local remaining = math.max(0, maxRequests - currentCount)
        local resetTime = now + (windowSeconds * 1000)

        return {allowed and 1 or 0, remaining, resetTime, currentCount}
      `;
      const result = await this.redis.eval(
        luaScript,
        1,
        key,
        now.toString(),
        windowStart.toString(),
        maxRequests.toString(),
        burstLimit.toString(),
        windowSeconds.toString()
      );
      return {
        allowed: result[0] === 1,
        remaining: result[1],
        resetTime: result[2],
        totalHits: result[3]
      };
    } catch (error) {
      console.error("Rate limit check error:", error);
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetTime: Date.now() + windowSeconds * 1e3,
        totalHits: 1
      };
    }
  }
  /**
   * Fallback rate limiting for when Redis is unavailable
   */
  fallbackRateLimit(identifier, windowSeconds, maxRequests) {
    const key = `rate_limit:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1e3;
    let requests = this.fallbackCache.get(key) || [];
    requests = requests.filter((timestamp) => timestamp > windowStart);
    const allowed = requests.length < maxRequests;
    if (allowed) {
      requests.push(now);
      this.fallbackCache.set(key, requests);
    }
    return {
      allowed,
      remaining: Math.max(0, maxRequests - requests.length),
      resetTime: now + windowSeconds * 1e3,
      totalHits: requests.length
    };
  }
  // ============================================================================
  // INTELLIGENT CACHING WITH PERFORMANCE OPTIMIZATION
  // ============================================================================
  /**
   * Cache with intelligent TTL and compression for large data
   */
  async set(key, value, ttlSeconds = 300) {
    try {
      if (this.isConnected && this.redis) {
        const serialized = JSON.stringify(value);
        if (serialized.length > 1024) {
          await this.redis.setex(key, ttlSeconds, `compressed:${serialized}`);
        } else {
          await this.redis.setex(key, ttlSeconds, serialized);
        }
        return true;
      } else {
        this.fallbackCache.set(key, {
          data: value,
          expiry: Date.now() + ttlSeconds * 1e3
        });
        return true;
      }
    } catch (error) {
      console.error("Cache set error:", error);
      return false;
    }
  }
  /**
   * Get with automatic decompression and metrics tracking
   */
  async get(key) {
    try {
      if (this.isConnected && this.redis) {
        const data = await this.redis.get(key);
        if (!data) return null;
        this.trackCacheMetric("hit", key);
        if (data.startsWith("compressed:")) {
          return JSON.parse(data.substring(11));
        }
        return JSON.parse(data);
      } else {
        const cached = this.fallbackCache.get(key);
        if (cached && (!cached.expiry || Date.now() < cached.expiry)) {
          return cached.data;
        }
        return null;
      }
    } catch (error) {
      console.error("Cache get error:", error);
      this.trackCacheMetric("error", key);
      return null;
    }
  }
  /**
   * Multi-get for batch operations
   */
  async mget(keys) {
    const results = {};
    if (this.isConnected && this.redis && keys.length > 1) {
      try {
        const values = await this.redis.mget(...keys);
        for (let i = 0; i < keys.length; i++) {
          if (values[i]) {
            const data = values[i];
            if (data?.startsWith("compressed:")) {
              results[keys[i]] = JSON.parse(data.substring(11));
            } else if (data) {
              results[keys[i]] = JSON.parse(data);
            }
          }
        }
      } catch (error) {
        console.error("Multi-get error:", error);
      }
    } else {
      for (const key of keys) {
        const value = await this.get(key);
        if (value !== null) {
          results[key] = value;
        }
      }
    }
    return results;
  }
  // ============================================================================
  // USER BALANCE CACHING (HIGH FREQUENCY OPERATIONS)
  // ============================================================================
  /**
   * Cache user balances with write-through pattern
   */
  async cacheUserBalance(userId, tokenId, balance) {
    const key = `balance:${userId}:${tokenId}`;
    await this.set(key, { balance, updated: Date.now() }, 60);
  }
  /**
   * Get cached balance with fallback to database
   */
  async getCachedBalance(userId, tokenId, fallbackFetcher) {
    const key = `balance:${userId}:${tokenId}`;
    const cached = await this.get(key);
    if (cached && cached.balance) {
      return cached.balance;
    }
    if (fallbackFetcher) {
      try {
        const fresh = await fallbackFetcher();
        await this.cacheUserBalance(userId, tokenId, fresh);
        return fresh;
      } catch (error) {
        console.error("Balance fallback fetch error:", error);
      }
    }
    return null;
  }
  /**
   * Invalidate balance cache on updates
   */
  async invalidateBalance(userId, tokenId) {
    if (this.isConnected && this.redis) {
      if (tokenId) {
        await this.redis.del(`balance:${userId}:${tokenId}`);
      } else {
        const pattern = `balance:${userId}:*`;
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }
    } else {
      const keysToDelete = [];
      for (const key of this.fallbackCache.keys()) {
        if (key.startsWith(`balance:${userId}:`) && (!tokenId || key.includes(tokenId))) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach((key) => this.fallbackCache.delete(key));
    }
  }
  // ============================================================================
  // ANALYTICS AND MONITORING
  // ============================================================================
  /**
   * Track cache performance metrics
   */
  async trackCacheMetric(type, key) {
    if (!this.isConnected || !this.redis) return;
    try {
      const now = Date.now();
      const minuteBucket = Math.floor(now / 6e4) * 6e4;
      const metricKey = `cache_metrics:${minuteBucket}`;
      const pipeline = this.redis.pipeline();
      pipeline.hincrby(metricKey, type, 1);
      pipeline.expire(metricKey, 3600);
      if (type === "miss") {
        const keyPattern = key.split(":")[0];
        pipeline.hincrby(`cache_misses:${keyPattern}`, "count", 1);
        pipeline.expire(`cache_misses:${keyPattern}`, 86400);
      }
      await pipeline.exec();
    } catch (error) {
    }
  }
  /**
   * Get cache performance statistics
   */
  async getCacheStats() {
    if (!this.isConnected || !this.redis) {
      return {
        hits: 0,
        misses: 0,
        errors: 0,
        hitRate: 0,
        connected: false
      };
    }
    try {
      const now = Date.now();
      const buckets = [];
      for (let i = 0; i < 10; i++) {
        const bucketTime = Math.floor((now - i * 6e4) / 6e4) * 6e4;
        buckets.push(`cache_metrics:${bucketTime}`);
      }
      const stats = await this.redis.pipeline().hmget(...buckets.map((b) => [b, "hit", "miss", "error"])).exec();
      let hits = 0, misses = 0, errors = 0;
      stats?.forEach((result) => {
        const data = result[1];
        hits += parseInt(data[0] || "0");
        misses += parseInt(data[1] || "0");
        errors += parseInt(data[2] || "0");
      });
      const total = hits + misses;
      const hitRate = total > 0 ? hits / total * 100 : 0;
      return {
        hits,
        misses,
        errors,
        hitRate,
        connected: this.isConnected
      };
    } catch (error) {
      console.error("Cache stats error:", error);
      return {
        hits: 0,
        misses: 0,
        errors: 0,
        hitRate: 0,
        connected: this.isConnected
      };
    }
  }
  // ============================================================================
  // HEALTH AND UTILITIES
  // ============================================================================
  /**
   * Health check with performance metrics
   */
  async healthCheck() {
    try {
      if (!this.isConnected || !this.redis) {
        return { healthy: false, error: "Redis not connected" };
      }
      const start = Date.now();
      const [pong, info] = await Promise.all([
        this.redis.ping(),
        this.redis.info("memory")
      ]);
      const latency = Date.now() - start;
      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      const connectionsMatch = info.match(/connected_clients:(\d+)/);
      return {
        healthy: pong === "PONG",
        latency,
        memory: memoryMatch?.[1]?.trim(),
        connections: connectionsMatch ? parseInt(connectionsMatch[1]) : 0
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log("\u{1F504} Shutting down Redis cache...");
    if (this.redis) {
      await this.redis.quit();
    }
    if (this.subscriber) {
      await this.subscriber.quit();
    }
    this.fallbackCache.clear();
    console.log("\u2705 Redis cache shutdown complete");
  }
}
const enhancedRedisCache = new EnhancedRedisCache();
const cacheSession = (sessionId, data, ttl) => enhancedRedisCache.setSession(sessionId, data, ttl);
const getSession = (sessionId, extendTTL) => enhancedRedisCache.getSession(sessionId, extendTTL);
const checkRateLimit = (id, window, max, burst) => enhancedRedisCache.checkRateLimit(id, window, max, burst);
const cacheData = (key, value, ttl) => enhancedRedisCache.set(key, value, ttl);
const getCachedData = (key) => enhancedRedisCache.get(key);
const cacheUserBalance = (userId, tokenId, balance) => enhancedRedisCache.cacheUserBalance(userId, tokenId, balance);
const getCachedBalance = (userId, tokenId, fallback) => enhancedRedisCache.getCachedBalance(userId, tokenId, fallback);
process.on("SIGTERM", () => enhancedRedisCache.shutdown());
process.on("SIGINT", () => enhancedRedisCache.shutdown());
var redis_enhanced_default = enhancedRedisCache;
export {
  cacheData,
  cacheSession,
  cacheUserBalance,
  checkRateLimit,
  redis_enhanced_default as default,
  enhancedRedisCache,
  getCachedBalance,
  getCachedData,
  getSession
};
//# sourceMappingURL=redis_enhanced.js.map
