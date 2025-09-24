// src/web/admin/prediction_markets.ts - Admin API for prediction markets management
import { Router } from "express";
import { prisma } from "../../services/db.js";
import { predictionMarkets } from "../../services/prediction_markets.js";
import { marketResolver } from "../../services/market_resolver.js";
import { marketConfig } from "../../services/market_config.js";
import { marketAutomation } from "../../services/market_automation.js";
export const predictionMarketsRouter = Router();
/**
 * GET /admin/prediction_markets - List all markets with admin details
 */
predictionMarketsRouter.get("/prediction_markets", async (req, res) => {
    try {
        const { status = "all", limit = "50", offset = "0", guild_id } = req.query;
        const limitNum = Math.min(parseInt(limit) || 50, 200);
        const offsetNum = parseInt(offset) || 0;
        // Build query filters
        const where = {};
        if (status !== "all") {
            where.status = status.toUpperCase();
        }
        if (guild_id) {
            where.guildId = guild_id;
        }
        const markets = await prisma.predictionMarket.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limitNum,
            skip: offsetNum,
            include: {
                _count: {
                    select: { bets: true }
                }
            }
        });
        // Calculate odds for each market
        const marketsWithDetails = markets.map(market => {
            const marketObj = predictionMarkets['mapDbMarket'](market);
            const odds = predictionMarkets.calculateOdds(marketObj);
            const totalPool = market.totalYesBets + market.totalNoBets;
            const timeLeft = market.resolveAt.getTime() - Date.now();
            return {
                id: market.id,
                title: market.title,
                description: market.description,
                status: market.status,
                outcome: market.outcome,
                marketType: market.marketType,
                tokenSymbol: market.tokenSymbol,
                createdAt: market.createdAt.toISOString(),
                resolveAt: market.resolveAt.toISOString(),
                timeLeftMs: timeLeft,
                expired: timeLeft <= 0,
                // Financial data
                totalPool,
                yesPool: market.totalYesBets,
                noPool: market.totalNoBets,
                totalBets: market._count.bets,
                rakePercentage: market.rakePercentage,
                // Betting limits
                minBet: market.minBet,
                maxBet: market.maxBet,
                // Live odds
                odds: {
                    yes: Number(odds.yesOdds.toFixed(2)),
                    no: Number(odds.noOdds.toFixed(2)),
                    yesImplied: Number((odds.yesImpliedProb * 100).toFixed(1)),
                    noImplied: Number((odds.noImpliedProb * 100).toFixed(1))
                },
                // Creator and guild info
                creatorId: market.creatorId,
                guildId: market.guildId,
                channelId: market.channelId,
                // Market-specific data
                marketData: market.marketData
            };
        });
        const total = await prisma.predictionMarket.count({ where });
        res.json({
            success: true,
            markets: marketsWithDetails,
            pagination: {
                total,
                limit: limitNum,
                offset: offsetNum,
                hasMore: offsetNum + limitNum < total
            }
        });
    }
    catch (error) {
        console.error('Admin API error /prediction_markets:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch markets'
        });
    }
});
/**
 * POST /admin/prediction_markets/:id/resolve - Manually resolve a market
 */
predictionMarketsRouter.post("/prediction_markets/:id/resolve", async (req, res) => {
    try {
        const { id } = req.params;
        const { outcome, force = false } = req.body;
        if (!outcome || !['YES', 'NO', 'CANCEL'].includes(outcome)) {
            return res.status(400).json({
                success: false,
                error: 'Outcome must be YES, NO, or CANCEL'
            });
        }
        // Get market details
        const market = await prisma.predictionMarket.findUnique({
            where: { id },
            include: { _count: { select: { bets: true } } }
        });
        if (!market) {
            return res.status(404).json({
                success: false,
                error: 'Market not found'
            });
        }
        if (market.status !== 'ACTIVE' && !force) {
            return res.status(400).json({
                success: false,
                error: 'Market is not active. Use force=true to override.'
            });
        }
        // Resolve the market
        const result = await predictionMarkets.resolveMarket(id, outcome);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }
        res.json({
            success: true,
            message: `Market resolved with outcome: ${outcome}`,
            resolution: {
                outcome,
                payouts: result.payouts?.length || 0,
                houseRake: result.houseRake || 0,
                totalBets: market._count.bets
            }
        });
    }
    catch (error) {
        console.error('Admin API error /resolve:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to resolve market'
        });
    }
});
/**
 * DELETE /admin/prediction_markets/:id - Cancel a market and refund all bets
 */
predictionMarketsRouter.delete("/prediction_markets/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const result = await predictionMarkets.resolveMarket(id, 'CANCEL');
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }
        res.json({
            success: true,
            message: 'Market cancelled and all bets refunded',
            refunds: result.payouts?.length || 0
        });
    }
    catch (error) {
        console.error('Admin API error /cancel:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to cancel market'
        });
    }
});
/**
 * POST /admin/prediction_markets/:id/force-resolve - Force resolve with external data
 */
predictionMarketsRouter.post("/prediction_markets/:id/force-resolve", async (req, res) => {
    try {
        const { id } = req.params;
        const result = await marketResolver.resolveMarket(id);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }
        res.json({
            success: true,
            message: `Market auto-resolved with outcome: ${result.outcome}`,
            outcome: result.outcome
        });
    }
    catch (error) {
        console.error('Admin API error /force-resolve:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to force resolve market'
        });
    }
});
/**
 * GET /admin/prediction_markets/stats - Dashboard statistics
 */
predictionMarketsRouter.get("/prediction_markets/stats", async (req, res) => {
    try {
        const [totalMarkets, activeMarkets, expiredMarkets, resolvedMarkets, cancelledMarkets, totalBets, totalVolume, recentActivity] = await Promise.all([
            // Market counts
            prisma.predictionMarket.count(),
            prisma.predictionMarket.count({ where: { status: 'ACTIVE' } }),
            prisma.predictionMarket.count({
                where: {
                    status: 'ACTIVE',
                    resolveAt: { lte: new Date() }
                }
            }),
            prisma.predictionMarket.count({ where: { status: 'RESOLVED' } }),
            prisma.predictionMarket.count({ where: { status: 'CANCELLED' } }),
            // Betting stats
            prisma.predictionBet.count(),
            prisma.predictionBet.aggregate({
                _sum: { amount: true }
            }),
            // Recent activity (last 24 hours)
            prisma.predictionBet.count({
                where: {
                    createdAt: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                    }
                }
            })
        ]);
        // Get top tokens by volume
        const tokenStats = await prisma.predictionBet.groupBy({
            by: ['tokenSymbol'],
            _count: { tokenSymbol: true },
            _sum: { amount: true },
            orderBy: { _sum: { amount: 'desc' } },
            take: 5
        });
        // Get automation status
        const automationStatus = marketAutomation.getStatus();
        // Get configuration
        const config = marketConfig.getConfig();
        res.json({
            success: true,
            stats: {
                markets: {
                    total: totalMarkets,
                    active: activeMarkets,
                    expired: expiredMarkets,
                    resolved: resolvedMarkets,
                    cancelled: cancelledMarkets
                },
                betting: {
                    totalBets,
                    totalVolume: totalVolume._sum.amount || 0,
                    recentActivity24h: recentActivity
                },
                topTokens: tokenStats.map(stat => ({
                    symbol: stat.tokenSymbol,
                    bets: stat._count.tokenSymbol || 0,
                    volume: stat._sum.amount || 0
                })),
                automation: {
                    running: automationStatus.running,
                    intervalMs: automationStatus.intervalMs,
                    enabled: config.settings.autoResolveEnabled
                },
                configuration: {
                    defaultRake: config.settings.defaultRakePercentage,
                    minBet: config.settings.minBet,
                    maxBet: config.settings.maxBet,
                    maxActiveMarketsPerGuild: config.settings.maxActiveMarketsPerGuild,
                    autoResolveInterval: config.settings.autoResolveInterval
                }
            }
        });
    }
    catch (error) {
        console.error('Admin API error /stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch statistics'
        });
    }
});
/**
 * GET /admin/prediction_markets/config - Get current configuration
 */
predictionMarketsRouter.get("/prediction_markets/config", async (req, res) => {
    try {
        const config = marketConfig.getConfig();
        res.json({
            success: true,
            config
        });
    }
    catch (error) {
        console.error('Admin API error /config:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch configuration'
        });
    }
});
/**
 * PUT /admin/prediction_markets/config - Update configuration
 */
predictionMarketsRouter.put("/prediction_markets/config", async (req, res) => {
    try {
        const updates = req.body;
        // Validate updates (basic validation)
        if (updates.settings?.defaultRakePercentage) {
            const rake = parseFloat(updates.settings.defaultRakePercentage);
            if (isNaN(rake) || rake < 0 || rake > 20) {
                return res.status(400).json({
                    success: false,
                    error: 'Rake percentage must be between 0 and 20'
                });
            }
        }
        // In a production system, you'd want to save this to a database
        // For now, we'll just validate the structure
        const currentConfig = marketConfig.getConfig();
        res.json({
            success: true,
            message: 'Configuration validation passed',
            note: 'In production, this would update the configuration file and restart automation if needed',
            current: currentConfig,
            proposed: updates
        });
    }
    catch (error) {
        console.error('Admin API error /config update:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update configuration'
        });
    }
});
/**
 * POST /admin/prediction_markets/automation/restart - Restart automation system
 */
predictionMarketsRouter.post("/prediction_markets/automation/restart", async (req, res) => {
    try {
        marketAutomation.restart();
        res.json({
            success: true,
            message: 'Market automation restarted',
            status: marketAutomation.getStatus()
        });
    }
    catch (error) {
        console.error('Admin API error /automation/restart:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to restart automation'
        });
    }
});
/**
 * POST /admin/prediction_markets/resolve-expired - Manually trigger resolution of expired markets
 */
predictionMarketsRouter.post("/prediction_markets/resolve-expired", async (req, res) => {
    try {
        const result = await marketAutomation.forceResolveExpiredMarkets();
        res.json({
            success: true,
            message: 'Expired markets resolution triggered',
            result: {
                resolved: result.resolved,
                errors: result.errors
            }
        });
    }
    catch (error) {
        console.error('Admin API error /resolve-expired:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to resolve expired markets'
        });
    }
});
