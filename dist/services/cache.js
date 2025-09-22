// src/services/cache.ts - Redis caching service for PIPTip bot performance optimization
import { createClient } from 'redis';
export class PIPTipCache {
    redis = null;
    connecting = false;
    connected = false;
    constructor() {
        this.initializeRedis();
    }
    async initializeRedis() {
        if (this.connecting || this.connected)
            return;
        try {
            this.connecting = true;
            // Use Railway's REDIS_URL or fallback for local development
            const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
            this.redis = createClient({
                url: redisUrl,
                socket: {
                    connectTimeout: 5000,
                },
                retryDelayOnFailover: 100,
                retryDelayOnClusterDown: 100,
            });
            this.redis.on('error', (err) => {
                console.error('Redis Client Error:', err);
                this.connected = false;
            });
            this.redis.on('connect', () => {
                console.log('✅ Redis connected successfully');
                this.connected = true;
            });
            this.redis.on('disconnect', () => {
                console.log('⚠️ Redis disconnected');
                this.connected = false;
            });
            await this.redis.connect();
            this.connecting = false;
        }
        catch (error) {
            console.error('Failed to initialize Redis:', error);
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
            if (!this.redis)
                return null;
            const data = await this.redis.get(key);
            return data ? JSON.parse(data) : null;
        }
        catch (error) {
            console.error('Redis get error:', error);
            return null; // Graceful fallback - don't break functionality
        }
    }
    async set(key, value, ttlSeconds = 300) {
        try {
            await this.ensureConnection();
            if (!this.redis)
                return;
            await this.redis.setEx(key, ttlSeconds, JSON.stringify(value));
        }
        catch (error) {
            console.error('Redis set error:', error);
            // Don't throw - cache failures shouldn't break functionality
        }
    }
    async del(key) {
        try {
            await this.ensureConnection();
            if (!this.redis)
                return;
            await this.redis.del(key);
        }
        catch (error) {
            console.error('Redis del error:', error);
        }
    }
    async delPattern(pattern) {
        try {
            await this.ensureConnection();
            if (!this.redis)
                return;
            const keys = await this.redis.keys(pattern);
            if (keys.length > 0) {
                await this.redis.del(keys);
            }
        }
        catch (error) {
            console.error('Redis delPattern error:', error);
        }
    }
    async exists(key) {
        try {
            await this.ensureConnection();
            if (!this.redis)
                return false;
            const result = await this.redis.exists(key);
            return result === 1;
        }
        catch (error) {
            console.error('Redis exists error:', error);
            return false;
        }
    }
    async increment(key, ttlSeconds = 300) {
        try {
            await this.ensureConnection();
            if (!this.redis)
                return 0;
            const result = await this.redis.incr(key);
            if (result === 1) {
                // Set TTL only on first increment
                await this.redis.expire(key, ttlSeconds);
            }
            return result;
        }
        catch (error) {
            console.error('Redis increment error:', error);
            return 0;
        }
    }
    // Health check for monitoring
    async ping() {
        try {
            await this.ensureConnection();
            if (!this.redis)
                return false;
            const result = await this.redis.ping();
            return result === 'PONG';
        }
        catch (error) {
            console.error('Redis ping error:', error);
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
        }
        catch (error) {
            console.error('Redis disconnect error:', error);
        }
    }
}
// Export singleton instance
export const cache = new PIPTipCache();
// Cache key helpers for consistency
export const CacheKeys = {
    // Token data
    ACTIVE_TOKENS: 'piptip:tokens:active',
    TOKEN: (id) => `piptip:token:${id}`,
    // User data
    USER_BALANCE: (userId, tokenId) => `piptip:balance:${userId}:${tokenId}`,
    USER_TIER: (userId) => `piptip:tier:${userId}`,
    USER_PROFILE: (userId) => `piptip:profile:${userId}`,
    // Leaderboards
    LEADERBOARD_SOCIAL: 'piptip:leaderboard:social',
    LEADERBOARD_LEVEL: 'piptip:leaderboard:level',
    LEADERBOARD_GENEROSITY: 'piptip:leaderboard:generosity',
    // Rate limiting
    RATE_LIMIT: (userId, action) => `piptip:ratelimit:${userId}:${action}`,
    // Achievements
    USER_ACHIEVEMENTS: (userId) => `piptip:achievements:${userId}`,
    // Group tips
    GROUP_TIP: (id) => `piptip:grouptip:${id}`,
    // Streaks
    USER_STREAK: (userId) => `piptip:streak:${userId}`,
    // Legacy compatibility
    leaderboard: 'piptip:leaderboard:social', // For backwards compatibility
    userStreak: (userId) => `piptip:streak:${userId}`,
    userAchievements: (userId) => `piptip:achievements:${userId}`,
};
// Cache TTL constants (in seconds)
export const CacheTTL = {
    TOKENS: 300, // 5 minutes
    BALANCE: 60, // 1 minute
    TIER: 3600, // 1 hour
    PROFILE: 300, // 5 minutes
    LEADERBOARD: 300, // 5 minutes
    RATE_LIMIT: 60, // 1 minute
    ACHIEVEMENTS: 600, // 10 minutes
    GROUP_TIP: 30, // 30 seconds
    // Legacy compatibility
    leaderboard: 300, // 5 minutes
    streak: 300, // 5 minutes
    achievements: 600, // 10 minutes
};
// Legacy compatibility functions for existing code
export const cacheWithMetrics = cache;
export const getCache = cache;
