// src/services/cache.ts - Simple swappable cache interface
// Start with Map, can swap to Redis later when needed

// Cache interface for future-proofing
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

// Simple in-memory cache implementation using Map
class MapCache implements Cache {
  private cache = new Map<string, { value: any; expiresAt?: number; lastAccessed: number }>();
  private cleanupInterval: NodeJS.Timeout;
  private readonly maxSize = 5000; // Increased for better hit rates under high load

  constructor() {
    // Clean up expired entries every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);

    // Warm cache on startup with frequently accessed data
    this.warmCache().catch(console.error);
  }

  // Pre-load frequently accessed data for immediate performance gains
  private async warmCache(): Promise<void> {
    try {
      console.log('🔥 Warming cache with frequently accessed data...');

      // Import dynamically to avoid circular dependencies
      const { prisma } = await import('./db.js');

      // 1. Cache all achievement definitions (rarely change, frequently accessed)
      const definitions = await prisma.achievementDefinition.findMany({
        where: { isEnabled: true }
      });

      await this.set('achievement:definitions:all', definitions, 300); // 5 min cache
      console.log(`✅ Cached ${definitions.length} achievement definitions`);

      // 2. Cache top 100 users for leaderboards (accessed frequently)
      const topUsers = await prisma.userStats.findMany({
        take: 100,
        orderBy: [
          { totalTipAmountSent: 'desc' },
          { matchesWon: 'desc' }
        ],
        include: {
          user: {
            select: { discordId: true }
          }
        }
      });

      await this.set('leaderboard:top100', topUsers, 180); // 3 min cache
      console.log(`✅ Cached top ${topUsers.length} users for leaderboards`);

      // 3. Cache achievement categories for filtering
      const categories = await prisma.achievementDefinition.groupBy({
        by: ['category'],
        where: { isEnabled: true },
        _count: { id: true }
      });

      await this.set('achievements:categories', categories, 600); // 10 min cache
      console.log(`✅ Cached ${categories.length} achievement categories`);

      console.log('🎯 Cache warming complete - ready for optimal performance!');

    } catch (error) {
      console.error('⚠️ Cache warming failed (non-critical):', error);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }

    // Update access time for LRU
    entry.lastAccessed = Date.now();
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number = 30): Promise<void> {
    const expiresAt = ttlSeconds > 0 ? Date.now() + (ttlSeconds * 1000) : undefined;

    // Check if we need to evict entries due to size limit
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, { value, expiresAt, lastAccessed: Date.now() });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }

  // Clean up on shutdown
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
  }

  // LRU eviction policy
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      console.log(`🗑️ Evicted cache entry: ${oldestKey}`);
    }
  }

  // Get cache stats for monitoring
  getStats(): { size: number; keys: string[]; maxSize: number; memoryUsage: number } {
    const memoryUsage = this.cache.size / this.maxSize;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      memoryUsage: Math.round(memoryUsage * 100),
      keys: Array.from(this.cache.keys())
    };
  }
}

// Singleton instance - can be swapped with Redis cache later
let cacheInstance: Cache | null = null;

export function getCache(): Cache {
  if (!cacheInstance) {
    cacheInstance = new MapCache();
    console.log("📦 In-memory cache initialized");
  }
  return cacheInstance;
}

// Cache key helpers for consistency
export const CacheKeys = {
  leaderboard: (type: string) => `leaderboard:${type}`,
  userAchievements: (userId: string) => `achievements:${userId}`,
  userStreak: (userId: string) => `streak:${userId}`,
  profileData: (userId: string) => `profile:${userId}`
};

// Cache TTL settings (in seconds)
export const CacheTTL = {
  leaderboard: 30,      // 30 seconds for leaderboards
  achievements: 60,     // 1 minute for user achievements
  streak: 30,          // 30 seconds for streak data
  profile: 15          // 15 seconds for profile data
};

// Performance monitoring wrapper
export async function cacheWithMetrics<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = 30
): Promise<T> {
  const cache = getCache();

  // Try to get from cache
  const startTime = Date.now();
  const cached = await cache.get<T>(key);

  if (cached !== null) {
    const hitTime = Date.now() - startTime;
    console.log(`✅ Cache hit: ${key} (${hitTime}ms)`);
    return cached;
  }

  // Cache miss - fetch data
  const fetchStart = Date.now();
  const data = await fetchFn();
  const fetchTime = Date.now() - fetchStart;

  // Store in cache
  await cache.set(key, data, ttlSeconds);

  console.log(`❌ Cache miss: ${key} (fetch: ${fetchTime}ms)`);
  return data;
}