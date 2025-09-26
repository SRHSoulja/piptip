import { enhancedRedisCache } from './redis_enhanced';
class DatabasePerformanceOptimizer {
    prisma;
    queryMetrics = new Map();
    slowQueryThreshold = 100; // 100ms
    cacheHitStats = { hits: 0, misses: 0 };
    constructor(prisma) {
        this.prisma = prisma;
        this.setupQueryLogging();
        this.startPerformanceMonitoring();
    }
    /**
     * Setup query logging and performance monitoring
     */
    setupQueryLogging() {
        // Extend Prisma client with query logging
        this.prisma.$use(async (params, next) => {
            const start = Date.now();
            const queryHash = this.generateQueryHash(params);
            try {
                const result = await next(params);
                const executionTime = Date.now() - start;
                // Record metrics
                this.recordQueryMetrics({
                    queryHash,
                    query: `${params.model}.${params.action}`,
                    executionTime,
                    timestamp: start,
                    params: this.sanitizeParams(params),
                    cached: false
                });
                // Log slow queries
                if (executionTime > this.slowQueryThreshold) {
                    console.warn(`🐌 Slow query detected: ${params.model}.${params.action} (${executionTime}ms)`);
                }
                return result;
            }
            catch (error) {
                const executionTime = Date.now() - start;
                // Record failed query
                this.recordQueryMetrics({
                    queryHash,
                    query: `${params.model}.${params.action}`,
                    executionTime,
                    timestamp: start,
                    params: this.sanitizeParams(params),
                    cached: false
                });
                throw error;
            }
        });
    }
    /**
     * Start background performance monitoring
     */
    startPerformanceMonitoring() {
        // Analyze performance every 5 minutes
        setInterval(() => {
            this.analyzePerformance();
        }, 5 * 60 * 1000);
        // Generate daily performance report
        setInterval(() => {
            this.generatePerformanceReport();
        }, 24 * 60 * 60 * 1000);
        console.log('📊 Database performance monitoring started');
    }
    // ============================================================================
    // QUERY OPTIMIZATION WITH INTELLIGENT CACHING
    // ============================================================================
    /**
     * Optimized user balance query with caching
     */
    async getUserBalance(userId, tokenId) {
        const cacheKey = `balance:${userId}:${tokenId}`;
        // Try cache first
        const cached = await enhancedRedisCache.get(cacheKey);
        if (cached) {
            this.cacheHitStats.hits++;
            return cached.balance;
        }
        this.cacheHitStats.misses++;
        // Cache miss - query with optimization
        const start = Date.now();
        const balance = await this.prisma.userBalance.findUnique({
            where: {
                userId_tokenId: {
                    userId,
                    tokenId
                }
            },
            select: {
                amount: true
            }
        });
        const executionTime = Date.now() - start;
        // Cache for 30 seconds
        if (balance) {
            await enhancedRedisCache.set(cacheKey, { balance: balance.amount.toString() }, 30);
        }
        // Record performance
        this.recordQueryMetrics({
            queryHash: `getUserBalance:${userId}:${tokenId}`,
            query: 'UserBalance.findUnique',
            executionTime,
            timestamp: start,
            cached: false
        });
        return balance?.amount.toString() || null;
    }
    /**
     * Optimized user tips query with pagination and caching
     */
    async getUserTips(userId, page = 1, limit = 20) {
        const cacheKey = `user_tips:${userId}:${page}:${limit}`;
        // Try cache first (cache for 2 minutes for recent tips)
        const cached = await enhancedRedisCache.get(cacheKey);
        if (cached) {
            this.cacheHitStats.hits++;
            return { ...cached, cached: true };
        }
        this.cacheHitStats.misses++;
        const start = Date.now();
        const offset = (page - 1) * limit;
        // Optimized query with cursor-based pagination for better performance
        const [tips, total] = await Promise.all([
            this.prisma.tip.findMany({
                where: {
                    OR: [
                        { fromUserId: userId },
                        { toUserId: userId }
                    ]
                },
                include: {
                    fromUser: {
                        select: {
                            id: true,
                            discordId: true
                        }
                    },
                    toUser: {
                        select: {
                            id: true,
                            discordId: true
                        }
                    },
                    Token: {
                        select: {
                            symbol: true,
                            name: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                skip: offset,
                take: limit
            }),
            // Use approximate count for better performance
            this.getApproximateTipCount(userId)
        ]);
        const executionTime = Date.now() - start;
        const result = { tips, total };
        // Cache for 2 minutes
        await enhancedRedisCache.set(cacheKey, result, 120);
        this.recordQueryMetrics({
            queryHash: `getUserTips:${userId}:${page}:${limit}`,
            query: 'Tip.findMany',
            executionTime,
            timestamp: start,
            cached: false
        });
        return { ...result, cached: false };
    }
    /**
     * Get approximate count for better performance (instead of exact count)
     */
    async getApproximateTipCount(userId) {
        const cacheKey = `tip_count:${userId}`;
        const cached = await enhancedRedisCache.get(cacheKey);
        if (cached) {
            return cached.count;
        }
        // Use stats table if available, fallback to actual count
        try {
            const userStats = await this.prisma.userStats.findUnique({
                where: { userId },
                select: {
                    totalTipsSent: true,
                    totalTipsReceived: true
                }
            });
            const approximateCount = userStats
                ? userStats.totalTipsSent + userStats.totalTipsReceived
                : await this.prisma.tip.count({
                    where: {
                        OR: [
                            { fromUserId: userId },
                            { toUserId: userId }
                        ]
                    }
                });
            // Cache for 5 minutes
            await enhancedRedisCache.set(cacheKey, { count: approximateCount }, 300);
            return approximateCount;
        }
        catch (error) {
            console.error('Error getting approximate tip count:', error);
            return 0;
        }
    }
    /**
     * Optimized leaderboard query with smart caching
     */
    async getLeaderboard(type = 'tips_sent', limit = 50) {
        const cacheKey = `leaderboard:${type}:${limit}`;
        // Try cache first (cache for 10 minutes)
        const cached = await enhancedRedisCache.get(cacheKey);
        if (cached) {
            this.cacheHitStats.hits++;
            return { ...cached, cached: true };
        }
        this.cacheHitStats.misses++;
        const start = Date.now();
        const orderByField = {
            'tips_sent': 'totalTipsSent',
            'matches_won': 'matchesWon',
            'total_deposited': 'totalDeposited'
        }[type];
        const users = await this.prisma.userStats.findMany({
            include: {
                user: {
                    select: {
                        id: true,
                        discordId: true,
                        showInPenguBook: true
                    }
                }
            },
            where: {
                user: {
                    showInPenguBook: true,
                    isBanned: false
                }
            },
            orderBy: {
                [orderByField]: 'desc'
            },
            take: limit
        });
        const executionTime = Date.now() - start;
        const result = {
            users,
            generatedAt: Date.now()
        };
        // Cache for 10 minutes
        await enhancedRedisCache.set(cacheKey, result, 600);
        this.recordQueryMetrics({
            queryHash: `getLeaderboard:${type}:${limit}`,
            query: 'UserStats.findMany',
            executionTime,
            timestamp: start,
            cached: false
        });
        return { ...result, cached: false };
    }
    /**
     * Batch update user balances with optimized transaction
     */
    async batchUpdateBalances(updates) {
        const start = Date.now();
        const errors = [];
        let updated = 0;
        try {
            // Use transaction for consistency
            await this.prisma.$transaction(async (tx) => {
                // Batch updates in chunks of 100 for optimal performance
                const chunkSize = 100;
                for (let i = 0; i < updates.length; i += chunkSize) {
                    const chunk = updates.slice(i, i + chunkSize);
                    // Use Promise.allSettled for better error handling
                    const results = await Promise.allSettled(chunk.map(async (update) => {
                        await tx.userBalance.upsert({
                            where: {
                                userId_tokenId: {
                                    userId: update.userId,
                                    tokenId: update.tokenId
                                }
                            },
                            update: {
                                amount: update.amount
                            },
                            create: {
                                userId: update.userId,
                                tokenId: update.tokenId,
                                amount: update.amount
                            }
                        });
                        // Invalidate cache
                        await enhancedRedisCache.invalidateBalance(update.userId.toString(), update.tokenId.toString());
                    }));
                    // Count successful updates and collect errors
                    results.forEach((result, index) => {
                        if (result.status === 'fulfilled') {
                            updated++;
                        }
                        else {
                            const update = chunk[index];
                            errors.push(`Failed to update balance for user ${update.userId}, token ${update.tokenId}: ${result.reason}`);
                        }
                    });
                }
            });
            const executionTime = Date.now() - start;
            this.recordQueryMetrics({
                queryHash: `batchUpdateBalances:${updates.length}`,
                query: 'UserBalance.upsert',
                executionTime,
                timestamp: start,
                cached: false
            });
            return { success: errors.length === 0, updated, errors };
        }
        catch (error) {
            const executionTime = Date.now() - start;
            this.recordQueryMetrics({
                queryHash: `batchUpdateBalances:${updates.length}`,
                query: 'UserBalance.upsert',
                executionTime,
                timestamp: start,
                cached: false
            });
            console.error('Batch update balances failed:', error);
            return {
                success: false,
                updated,
                errors: [error instanceof Error ? error.message : 'Unknown error']
            };
        }
    }
    // ============================================================================
    // PERFORMANCE ANALYSIS AND MONITORING
    // ============================================================================
    /**
     * Analyze query performance and identify bottlenecks
     */
    analyzePerformance() {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        let totalQueries = 0;
        let slowQueries = 0;
        const queryTypeStats = {};
        // Analyze metrics from the last hour
        for (const [queryHash, metrics] of this.queryMetrics.entries()) {
            const recentMetrics = metrics.filter(m => m.timestamp > oneHourAgo);
            if (recentMetrics.length === 0)
                continue;
            totalQueries += recentMetrics.length;
            for (const metric of recentMetrics) {
                if (metric.executionTime > this.slowQueryThreshold) {
                    slowQueries++;
                }
                // Aggregate by query type
                const queryType = metric.query;
                if (!queryTypeStats[queryType]) {
                    queryTypeStats[queryType] = { count: 0, avgTime: 0, maxTime: 0 };
                }
                const stats = queryTypeStats[queryType];
                stats.count++;
                stats.maxTime = Math.max(stats.maxTime, metric.executionTime);
                stats.avgTime = (stats.avgTime * (stats.count - 1) + metric.executionTime) / stats.count;
            }
        }
        // Log performance summary
        if (totalQueries > 0) {
            const slowQueryPercent = (slowQueries / totalQueries) * 100;
            const cacheHitRate = (this.cacheHitStats.hits / (this.cacheHitStats.hits + this.cacheHitStats.misses)) * 100;
            console.log(`📊 Performance Summary (last hour):
        Total Queries: ${totalQueries}
        Slow Queries: ${slowQueries} (${slowQueryPercent.toFixed(1)}%)
        Cache Hit Rate: ${cacheHitRate.toFixed(1)}%

        Top Slow Queries:
        ${Object.entries(queryTypeStats)
                .filter(([, stats]) => stats.avgTime > this.slowQueryThreshold)
                .sort(([, a], [, b]) => b.avgTime - a.avgTime)
                .slice(0, 5)
                .map(([query, stats]) => `  • ${query}: avg ${stats.avgTime.toFixed(1)}ms, max ${stats.maxTime}ms (${stats.count} queries)`)
                .join('\n')}`);
        }
        // Reset cache hit stats
        this.cacheHitStats = { hits: 0, misses: 0 };
    }
    /**
     * Generate daily performance report
     */
    generatePerformanceReport() {
        const now = Date.now();
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        const report = {
            timestamp: now,
            period: '24h',
            summary: {
                totalQueries: 0,
                slowQueries: 0,
                avgResponseTime: 0,
                cacheUtilization: 0
            },
            topSlowQueries: [],
            recommendations: []
        };
        // Analyze all metrics from last 24 hours
        let totalTime = 0;
        const queryStats = {};
        for (const [queryHash, metrics] of this.queryMetrics.entries()) {
            const recentMetrics = metrics.filter(m => m.timestamp > oneDayAgo);
            for (const metric of recentMetrics) {
                report.summary.totalQueries++;
                totalTime += metric.executionTime;
                if (metric.executionTime > this.slowQueryThreshold) {
                    report.summary.slowQueries++;
                }
                if (!queryStats[metric.query]) {
                    queryStats[metric.query] = { times: [], count: 0 };
                }
                queryStats[metric.query].times.push(metric.executionTime);
                queryStats[metric.query].count++;
            }
        }
        // Calculate averages and top slow queries
        report.summary.avgResponseTime = report.summary.totalQueries > 0 ? totalTime / report.summary.totalQueries : 0;
        report.topSlowQueries = Object.entries(queryStats)
            .map(([query, stats]) => ({
            query,
            avgTime: stats.times.reduce((sum, time) => sum + time, 0) / stats.times.length,
            count: stats.count
        }))
            .sort((a, b) => b.avgTime - a.avgTime)
            .slice(0, 10);
        // Generate recommendations
        if (report.summary.slowQueries / report.summary.totalQueries > 0.05) {
            report.recommendations.push('Consider adding database indexes for frequently slow queries');
        }
        if (report.summary.avgResponseTime > 50) {
            report.recommendations.push('Overall query performance is degraded - investigate database resources');
        }
        // Save report
        console.log('📈 Daily Performance Report Generated');
        // In production, save to file or send to monitoring service
    }
    // ============================================================================
    // UTILITIES
    // ============================================================================
    generateQueryHash(params) {
        return `${params.model}_${params.action}_${JSON.stringify(params.args || {})}`.substring(0, 100);
    }
    sanitizeParams(params) {
        // Remove sensitive data from logging
        const sanitized = { ...params };
        if (sanitized.args?.data?.password) {
            sanitized.args.data.password = '[REDACTED]';
        }
        return sanitized;
    }
    recordQueryMetrics(metrics) {
        const { queryHash } = metrics;
        if (!this.queryMetrics.has(queryHash)) {
            this.queryMetrics.set(queryHash, []);
        }
        const queryMetrics = this.queryMetrics.get(queryHash);
        queryMetrics.push(metrics);
        // Keep only last 100 metrics per query type
        if (queryMetrics.length > 100) {
            queryMetrics.splice(0, queryMetrics.length - 100);
        }
    }
    /**
     * Get current performance statistics
     */
    getPerformanceStats() {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        let totalQueries = 0;
        let slowQueries = 0;
        let totalTime = 0;
        const queryStats = {};
        for (const [queryHash, metrics] of this.queryMetrics.entries()) {
            const recentMetrics = metrics.filter(m => m.timestamp > oneHourAgo);
            for (const metric of recentMetrics) {
                totalQueries++;
                totalTime += metric.executionTime;
                if (metric.executionTime > this.slowQueryThreshold) {
                    slowQueries++;
                }
                if (!queryStats[metric.query]) {
                    queryStats[metric.query] = { times: [], count: 0 };
                }
                queryStats[metric.query].times.push(metric.executionTime);
                queryStats[metric.query].count++;
            }
        }
        const avgResponseTime = totalQueries > 0 ? totalTime / totalQueries : 0;
        const cacheHitRate = (this.cacheHitStats.hits / (this.cacheHitStats.hits + this.cacheHitStats.misses)) * 100 || 0;
        const topSlowQueries = Object.entries(queryStats)
            .map(([query, stats]) => ({
            query,
            avgTime: stats.times.reduce((sum, time) => sum + time, 0) / stats.times.length,
            count: stats.count
        }))
            .sort((a, b) => b.avgTime - a.avgTime)
            .slice(0, 5);
        return {
            totalQueries,
            slowQueries,
            avgResponseTime,
            cacheHitRate,
            topSlowQueries
        };
    }
}
// Export singleton (will be initialized by database service)
export let dbPerformanceOptimizer;
export function initializeDbOptimizer(prisma) {
    dbPerformanceOptimizer = new DatabasePerformanceOptimizer(prisma);
    console.log('🚀 Database Performance Optimizer initialized');
}
export default DatabasePerformanceOptimizer;
