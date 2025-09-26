// Redis Caching Service for Performance Optimization
// Note: Redis is optional - falls back to in-memory cache if not available
// To enable Redis: npm install ioredis @types/ioredis and set REDIS_URL
// import Redis from 'ioredis';
class RedisCache {
    redis = null;
    fallbackCache = new Map();
    config;
    isConnected = false;
    constructor() {
        this.config = {
            defaultTTL: 300, // 5 minutes
            maxRetries: 3,
            retryDelayOnFailover: 100
        };
        // Initialize fallback-only mode for now
        this.initializeFallback();
    }
    initializeFallback() {
        console.log('Redis cache initialized in fallback mode (memory-only)');
        this.isConnected = false;
        // Clean up expired items every minute
        setInterval(() => this.cleanupExpiredItems(), 60000);
    }
    cleanupExpiredItems() {
        const now = Date.now();
        for (const [key, item] of this.fallbackCache.entries()) {
            if (now - item.timestamp > item.ttl * 1000) {
                this.fallbackCache.delete(key);
            }
        }
    }
    async get(key) {
        try {
            // Use fallback cache
            const item = this.fallbackCache.get(key);
            if (!item)
                return null;
            // Check if expired
            if (Date.now() - item.timestamp > item.ttl * 1000) {
                this.fallbackCache.delete(key);
                return null;
            }
            return item.data;
        }
        catch (error) {
            console.error('Cache get error:', error);
            return null;
        }
    }
    async set(key, value, ttlSeconds) {
        try {
            const ttl = ttlSeconds || this.config.defaultTTL;
            // Store in fallback cache
            this.fallbackCache.set(key, {
                data: value,
                timestamp: Date.now(),
                ttl
            });
            return true;
        }
        catch (error) {
            console.error('Cache set error:', error);
            return false;
        }
    }
    async del(key) {
        try {
            return this.fallbackCache.delete(key);
        }
        catch (error) {
            console.error('Cache delete error:', error);
            return false;
        }
    }
    async exists(key) {
        try {
            const item = this.fallbackCache.get(key);
            if (!item)
                return false;
            // Check if expired
            if (Date.now() - item.timestamp > item.ttl * 1000) {
                this.fallbackCache.delete(key);
                return false;
            }
            return true;
        }
        catch (error) {
            console.error('Cache exists error:', error);
            return false;
        }
    }
    async clear() {
        try {
            this.fallbackCache.clear();
            return true;
        }
        catch (error) {
            console.error('Cache clear error:', error);
            return false;
        }
    }
    async keys(pattern) {
        try {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            const matchingKeys = [];
            for (const key of this.fallbackCache.keys()) {
                if (regex.test(key)) {
                    // Check if expired
                    const item = this.fallbackCache.get(key);
                    if (item && Date.now() - item.timestamp <= item.ttl * 1000) {
                        matchingKeys.push(key);
                    }
                    else if (item) {
                        this.fallbackCache.delete(key);
                    }
                }
            }
            return matchingKeys;
        }
        catch (error) {
            console.error('Cache keys error:', error);
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
        }
        catch (error) {
            console.error('Cache delete pattern error:', error);
            return 0;
        }
    }
    // Health check
    isHealthy() {
        return true; // Fallback cache is always "healthy"
    }
    // Get connection status
    getStatus() {
        return {
            connected: this.isConnected,
            mode: 'fallback',
            itemCount: this.fallbackCache.size
        };
    }
}
// Create singleton instance
export const redisCache = new RedisCache();
// Convenience functions
export async function getCached(key) {
    return redisCache.get(key);
}
export async function setCache(key, value, ttlSeconds) {
    return redisCache.set(key, value, ttlSeconds);
}
export async function delCache(key) {
    return redisCache.del(key);
}
export async function clearCache() {
    return redisCache.clear();
}
// Token-specific caching functions
export async function getCachedTokens() {
    return redisCache.get('tokens:all');
}
export async function setCachedTokens(tokens, ttlSeconds = 300) {
    return redisCache.set('tokens:all', tokens, ttlSeconds);
}
