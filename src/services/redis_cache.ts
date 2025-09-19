// Redis Caching Service for Performance Optimization
// TODO: Install ioredis dependency: npm install ioredis @types/ioredis
// import Redis from 'ioredis';

interface CacheConfig {
  defaultTTL: number;
  maxRetries: number;
  retryDelayOnFailover: number;
}

interface CacheItem<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
}

class RedisCache {
  private redis: any = null;
  private fallbackCache: Map<string, CacheItem> = new Map();
  private config: CacheConfig;
  private isConnected: boolean = false;

  constructor() {
    this.config = {
      defaultTTL: 300, // 5 minutes
      maxRetries: 3,
      retryDelayOnFailover: 100
    };

    // Initialize fallback-only mode for now
    this.initializeFallback();
  }

  private initializeFallback(): void {
    console.log('Redis cache initialized in fallback mode (memory-only)');
    this.isConnected = false;

    // Clean up expired items every minute
    setInterval(() => this.cleanupExpiredItems(), 60000);
  }

  private cleanupExpiredItems(): void {
    const now = Date.now();
    for (const [key, item] of this.fallbackCache.entries()) {
      if (now - item.timestamp > item.ttl * 1000) {
        this.fallbackCache.delete(key);
      }
    }
  }

  async get<T = any>(key: string): Promise<T | null> {
    try {
      // Use fallback cache
      const item = this.fallbackCache.get(key);
      if (!item) return null;

      // Check if expired
      if (Date.now() - item.timestamp > item.ttl * 1000) {
        this.fallbackCache.delete(key);
        return null;
      }

      return item.data as T;
    } catch (error: any) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set<T = any>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    try {
      const ttl = ttlSeconds || this.config.defaultTTL;

      // Store in fallback cache
      this.fallbackCache.set(key, {
        data: value,
        timestamp: Date.now(),
        ttl
      });

      return true;
    } catch (error: any) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      return this.fallbackCache.delete(key);
    } catch (error: any) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const item = this.fallbackCache.get(key);
      if (!item) return false;

      // Check if expired
      if (Date.now() - item.timestamp > item.ttl * 1000) {
        this.fallbackCache.delete(key);
        return false;
      }

      return true;
    } catch (error: any) {
      console.error('Cache exists error:', error);
      return false;
    }
  }

  async clear(): Promise<boolean> {
    try {
      this.fallbackCache.clear();
      return true;
    } catch (error: any) {
      console.error('Cache clear error:', error);
      return false;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      const matchingKeys: string[] = [];

      for (const key of this.fallbackCache.keys()) {
        if (regex.test(key)) {
          // Check if expired
          const item = this.fallbackCache.get(key);
          if (item && Date.now() - item.timestamp <= item.ttl * 1000) {
            matchingKeys.push(key);
          } else if (item) {
            this.fallbackCache.delete(key);
          }
        }
      }

      return matchingKeys;
    } catch (error: any) {
      console.error('Cache keys error:', error);
      return [];
    }
  }

  async delPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.keys(pattern);
      let deleted = 0;

      for (const key of keys) {
        if (await this.del(key)) {
          deleted++;
        }
      }

      return deleted;
    } catch (error: any) {
      console.error('Cache delete pattern error:', error);
      return 0;
    }
  }

  // Health check
  isHealthy(): boolean {
    return true; // Fallback cache is always "healthy"
  }

  // Get connection status
  getStatus(): { connected: boolean; mode: string; itemCount: number } {
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
export async function getCached<T>(key: string): Promise<T | null> {
  return redisCache.get<T>(key);
}

export async function setCache<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
  return redisCache.set(key, value, ttlSeconds);
}

export async function delCache(key: string): Promise<boolean> {
  return redisCache.del(key);
}

export async function clearCache(): Promise<boolean> {
  return redisCache.clear();
}

// Token-specific caching functions
export async function getCachedTokens(): Promise<any[] | null> {
  return redisCache.get('tokens:all');
}

export async function setCachedTokens(tokens: any[], ttlSeconds = 300): Promise<boolean> {
  return redisCache.set('tokens:all', tokens, ttlSeconds);
}