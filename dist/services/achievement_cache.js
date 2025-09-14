// src/services/achievement_cache.ts - Redis caching for achievement and leaderboard data
import Redis from 'ioredis';
import { prisma } from './db.js';
// Redis connection (with fallback for development)
let redis = null;
try {
    if (process.env.REDIS_URL) {
        redis = new Redis(process.env.REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryDelayOnFailover: 100,
            enableReadyCheck: false,
            lazyConnect: true,
        });
    }
}
catch (error) {
    console.warn('Redis not available, caching disabled:', error);
}
// Cache key generators
const CACHE_KEYS = {
    STREAK_LEADERBOARD: (limit) => `leaderboard:streaks:${limit}`,
    TIP_LEADERBOARD: (limit) => `leaderboard:tips:${limit}`,
    USER_ACHIEVEMENTS: (discordId) => `achievements:${discordId}`,
    USER_STREAK_STATS: (discordId) => `streak:${discordId}`,
    ACHIEVEMENT_COUNT: (type, level) => `achievement_count:${type}:${level}`,
    LEADERBOARD_CACHE_FLAG: 'leaderboard:cache_valid',
};
// Cache TTL configurations (in seconds)
const CACHE_TTL = {
    LEADERBOARD: 300, // 5 minutes for leaderboards
    USER_DATA: 120, // 2 minutes for user achievements/streaks
    STATS: 600, // 10 minutes for general statistics
    SHORT: 60, // 1 minute for frequently changing data
};
// Cached leaderboard retrieval
export async function getCachedStreakLeaderboard(limit = 10) {
    const cacheKey = CACHE_KEYS.STREAK_LEADERBOARD(limit);
    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        }
        catch (error) {
            console.warn('Redis cache miss for streak leaderboard:', error);
        }
    }
    // Fetch from database with optimized query
    const topStreaks = await prisma.userStreak.findMany({
        where: {
            currentWins: { gt: 0 }
        },
        orderBy: [
            { currentWins: 'desc' },
            { lastGameAt: 'desc' }
        ],
        take: limit,
        include: {
            user: {
                select: { discordId: true }
            }
        }
    });
    const result = topStreaks.map((streak, index) => ({
        rank: index + 1,
        discordId: streak.user.discordId,
        currentWins: streak.currentWins,
        longestWins: streak.longestWins,
        lastGameAt: streak.lastGameAt?.toISOString() || null,
    }));
    // Cache the result
    if (redis) {
        try {
            await redis.setex(cacheKey, CACHE_TTL.LEADERBOARD, JSON.stringify(result));
        }
        catch (error) {
            console.warn('Failed to cache streak leaderboard:', error);
        }
    }
    return result;
}
// Cached tip leaderboard with optimized query
export async function getCachedTipLeaderboard(limit = 10) {
    const cacheKey = CACHE_KEYS.TIP_LEADERBOARD(limit);
    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        }
        catch (error) {
            console.warn('Redis cache miss for tip leaderboard:', error);
        }
    }
    // Optimized query using aggregation
    const tipAggregates = await prisma.tip.groupBy({
        by: ['fromUserId'],
        where: {
            status: 'COMPLETED',
            fromUserId: { not: null }
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: limit
    });
    // Get user details in batch
    const userIds = tipAggregates.map(t => t.fromUserId);
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, discordId: true }
    });
    const userMap = new Map(users.map(u => [u.id, u.discordId]));
    const result = tipAggregates.map((tip, index) => ({
        rank: index + 1,
        discordId: userMap.get(tip.fromUserId) || 'Unknown',
        tipCount: tip._count.id,
        tokenId: 1, // Default token for now
    }));
    // Cache the result
    if (redis) {
        try {
            await redis.setex(cacheKey, CACHE_TTL.LEADERBOARD, JSON.stringify(result));
        }
        catch (error) {
            console.warn('Failed to cache tip leaderboard:', error);
        }
    }
    return result;
}
// Cached user achievements
export async function getCachedUserAchievements(discordId) {
    const cacheKey = CACHE_KEYS.USER_ACHIEVEMENTS(discordId);
    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        }
        catch (error) {
            console.warn('Redis cache miss for user achievements:', error);
        }
    }
    // Fetch from database
    const user = await prisma.user.findUnique({
        where: { discordId },
        select: { id: true }
    });
    if (!user)
        return [];
    const achievements = await prisma.achievement.findMany({
        where: { userId: user.id },
        orderBy: { unlockedAt: 'desc' }
    });
    const result = achievements.map(achievement => ({
        type: achievement.type,
        level: achievement.level,
        unlockedAt: achievement.unlockedAt,
        data: achievement.data ? JSON.parse(achievement.data) : null
    }));
    // Cache with shorter TTL since achievements change frequently
    if (redis) {
        try {
            await redis.setex(cacheKey, CACHE_TTL.USER_DATA, JSON.stringify(result));
        }
        catch (error) {
            console.warn('Failed to cache user achievements:', error);
        }
    }
    return result;
}
// Cached streak stats
export async function getCachedStreakStats(discordId) {
    const cacheKey = CACHE_KEYS.USER_STREAK_STATS(discordId);
    if (redis) {
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }
        }
        catch (error) {
            console.warn('Redis cache miss for streak stats:', error);
        }
    }
    // Fetch from database
    const user = await prisma.user.findUnique({
        where: { discordId },
        select: { id: true }
    });
    if (!user) {
        return { currentWins: 0, longestWins: 0, lastGameAt: null };
    }
    const userStreak = await prisma.userStreak.findUnique({
        where: { userId: user.id }
    });
    const result = {
        currentWins: userStreak?.currentWins || 0,
        longestWins: userStreak?.longestWins || 0,
        lastGameAt: userStreak?.lastGameAt || null
    };
    // Cache with short TTL since streaks change with every game
    if (redis) {
        try {
            await redis.setex(cacheKey, CACHE_TTL.SHORT, JSON.stringify(result));
        }
        catch (error) {
            console.warn('Failed to cache streak stats:', error);
        }
    }
    return result;
}
// Cache invalidation functions
export async function invalidateUserCache(discordId) {
    if (!redis)
        return;
    try {
        await Promise.all([
            redis.del(CACHE_KEYS.USER_ACHIEVEMENTS(discordId)),
            redis.del(CACHE_KEYS.USER_STREAK_STATS(discordId)),
        ]);
    }
    catch (error) {
        console.warn('Failed to invalidate user cache:', error);
    }
}
export async function invalidateLeaderboardCache() {
    if (!redis)
        return;
    try {
        // Use pattern matching to delete all leaderboard caches
        const streakKeys = await redis.keys('leaderboard:streaks:*');
        const tipKeys = await redis.keys('leaderboard:tips:*');
        if (streakKeys.length > 0) {
            await redis.del(...streakKeys);
        }
        if (tipKeys.length > 0) {
            await redis.del(...tipKeys);
        }
    }
    catch (error) {
        console.warn('Failed to invalidate leaderboard cache:', error);
    }
}
// Batch cache warming - run periodically to keep hot data cached
export async function warmLeaderboardCache() {
    if (!redis)
        return;
    try {
        // Warm up common leaderboard sizes
        const sizes = [5, 10, 25];
        await Promise.all([
            ...sizes.map(size => getCachedStreakLeaderboard(size)),
            ...sizes.map(size => getCachedTipLeaderboard(size)),
        ]);
        console.log('Leaderboard cache warmed successfully');
    }
    catch (error) {
        console.error('Failed to warm leaderboard cache:', error);
    }
}
// Health check for Redis
export async function cacheHealthCheck() {
    if (!redis)
        return false;
    try {
        const result = await redis.ping();
        return result === 'PONG';
    }
    catch (error) {
        console.warn('Redis health check failed:', error);
        return false;
    }
}
// Generic query result caching with TTL
export async function cacheQueryResult(cacheKey, queryFn, ttl = CACHE_TTL.USER_DATA) {
    if (!redis) {
        // No caching available, execute query directly
        return await queryFn();
    }
    try {
        // Try to get from cache first
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    }
    catch (error) {
        console.warn(`Cache miss for key ${cacheKey}:`, error);
    }
    // Execute the query
    const result = await queryFn();
    // Cache the result
    try {
        await redis.setex(cacheKey, ttl, JSON.stringify(result));
    }
    catch (error) {
        console.warn(`Failed to cache result for key ${cacheKey}:`, error);
    }
    return result;
}
// Cache expensive profile data with longer TTL
export async function getCachedProfileData(discordId) {
    const cacheKey = `profile:full:${discordId}`;
    return await cacheQueryResult(cacheKey, async () => {
        // Import here to avoid circular dependencies
        const { generateProfileData } = await import('./profile.js');
        const { default: discordUser } = await import('discord.js').then(m => ({ default: { username: discordId } }));
        // This would need to be adapted to work with actual Discord user object
        return await generateProfileData(discordId, discordUser);
    }, CACHE_TTL.USER_DATA);
}
// Cache achievement statistics (global stats)
export async function getCachedAchievementStats() {
    const cacheKey = 'achievement:global_stats';
    return await cacheQueryResult(cacheKey, async () => {
        const { prisma } = await import('./db.js');
        const [totalUsers, totalAchievements, recentAchievements, typeBreakdown] = await Promise.all([
            prisma.user.count(),
            prisma.achievement.count(),
            prisma.achievement.count({
                where: {
                    unlockedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
                }
            }),
            prisma.achievement.groupBy({
                by: ['type'],
                _count: { type: true },
                orderBy: { _count: { type: 'desc' } }
            })
        ]);
        return {
            totalUsers,
            totalAchievements,
            recentAchievements, // Last 24h
            avgAchievementsPerUser: totalAchievements / totalUsers,
            typeBreakdown: typeBreakdown.map(t => ({
                type: t.type,
                count: t._count.type
            })),
            updatedAt: new Date().toISOString()
        };
    }, CACHE_TTL.STATS);
}
// Cache expensive unique recipient/sender queries
export async function getCachedUniqueStats(userId) {
    const cacheKey = `unique_stats:${userId}`;
    return await cacheQueryResult(cacheKey, async () => {
        const { prisma } = await import('./db.js');
        const [uniqueRecipients, uniqueSenders] = await Promise.all([
            prisma.$queryRaw `
          SELECT COUNT(DISTINCT "toUserId") as count
          FROM "Tip"
          WHERE "fromUserId" = ${userId} AND "status" = 'COMPLETED'
        `,
            prisma.$queryRaw `
          SELECT COUNT(DISTINCT "fromUserId") as count
          FROM "Tip"
          WHERE "toUserId" = ${userId} AND "status" = 'COMPLETED'
        `
        ]);
        return {
            uniqueRecipients: Number(uniqueRecipients[0]?.count || 0),
            uniqueSenders: Number(uniqueSenders[0]?.count || 0),
            updatedAt: new Date().toISOString()
        };
    }, CACHE_TTL.STATS // Longer TTL since this is expensive
    );
}
// Cache paginated leaderboards
export async function getCachedPaginatedLeaderboard(type, page = 1, pageSize = 10) {
    const cacheKey = `leaderboard:${type}:page:${page}:size:${pageSize}`;
    return await cacheQueryResult(cacheKey, async () => {
        const { prisma } = await import('./db.js');
        const skip = (page - 1) * pageSize;
        let data = [];
        let totalCount = 0;
        switch (type) {
            case 'tips':
                const [tipResults, tipCount] = await Promise.all([
                    prisma.userStats.findMany({
                        where: { totalTipsSent: { gt: 0 } },
                        orderBy: [{ totalTipsSent: 'desc' }, { updatedAt: 'desc' }],
                        skip,
                        take: pageSize,
                        include: { user: { select: { discordId: true } } }
                    }),
                    prisma.userStats.count({ where: { totalTipsSent: { gt: 0 } } })
                ]);
                data = tipResults.map((stats, index) => ({
                    rank: skip + index + 1,
                    discordId: stats.user.discordId,
                    tipCount: stats.totalTipsSent,
                    tipAmount: Number(stats.totalTipAmountSent),
                }));
                totalCount = tipCount;
                break;
            case 'streaks':
                const [streakResults, streakCount] = await Promise.all([
                    prisma.userStreak.findMany({
                        where: { currentWins: { gt: 0 } },
                        orderBy: [{ currentWins: 'desc' }, { lastGameAt: 'desc' }],
                        skip,
                        take: pageSize,
                        include: { user: { select: { discordId: true } } }
                    }),
                    prisma.userStreak.count({ where: { currentWins: { gt: 0 } } })
                ]);
                data = streakResults.map((streak, index) => ({
                    rank: skip + index + 1,
                    discordId: streak.user.discordId,
                    currentWins: streak.currentWins,
                    longestWins: streak.longestWins,
                }));
                totalCount = streakCount;
                break;
            case 'matches':
                const [matchResults, matchCount] = await Promise.all([
                    prisma.userStats.findMany({
                        where: { matchesWon: { gt: 0 } },
                        orderBy: [{ matchesWon: 'desc' }, { updatedAt: 'desc' }],
                        skip,
                        take: pageSize,
                        include: { user: { select: { discordId: true } } }
                    }),
                    prisma.userStats.count({ where: { matchesWon: { gt: 0 } } })
                ]);
                data = matchResults.map((stats, index) => ({
                    rank: skip + index + 1,
                    discordId: stats.user.discordId,
                    wins: stats.matchesWon,
                    losses: stats.matchesLost,
                    winRate: stats.matchesWon / (stats.matchesWon + stats.matchesLost + stats.matchesTied),
                }));
                totalCount = matchCount;
                break;
        }
        return {
            data,
            pagination: {
                page,
                pageSize,
                totalCount,
                totalPages: Math.ceil(totalCount / pageSize),
                hasNext: page * pageSize < totalCount,
                hasPrev: page > 1,
            },
            updatedAt: new Date().toISOString()
        };
    }, CACHE_TTL.LEADERBOARD);
}
// Get cache statistics
export async function getCacheStats() {
    if (!redis)
        return { connected: false };
    try {
        const info = await redis.info('memory');
        const keyspace = await redis.info('keyspace');
        return {
            connected: true,
            memory: info,
            keyspace: keyspace,
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        return { connected: false, error: error };
    }
}
// Periodic cache maintenance (run via cron or background job)
export async function maintainCache() {
    if (!redis)
        return;
    try {
        // Invalidate old leaderboard caches
        await invalidateLeaderboardCache();
        // Warm up fresh caches
        await warmLeaderboardCache();
        console.log('Cache maintenance completed successfully');
    }
    catch (error) {
        console.error('Cache maintenance failed:', error);
    }
}
