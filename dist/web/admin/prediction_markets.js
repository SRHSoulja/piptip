// src/web/admin/prediction_markets.ts - Admin API for prediction markets management
import { Router } from "express";
import { prisma } from "../../services/db.js";
import { predictionMarkets } from "../../services/prediction_markets.js";
import { marketResolver } from "../../services/market_resolver.js";
import { marketConfig } from "../../services/market_config.js";
import { marketAutomation } from "../../services/market_automation.js";
import { adminPermissions } from "../../services/admin_permissions.js";
import { marketTemplates } from "../../services/market_templates.js";
import { getCurrentUser } from "../auth.js";
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
/**
 * GET /admin/prediction_markets/templates - Get available market templates
 */
predictionMarketsRouter.get("/prediction_markets/templates", async (req, res) => {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        const isAdmin = await adminPermissions.isUserAdmin(currentUser.discordId);
        const templates = marketTemplates.getAllTemplates(isAdmin);
        const templatesByCategory = {
            sports: templates.filter(t => t.category === 'sports'),
            crypto: templates.filter(t => t.category === 'crypto'),
            custom: templates.filter(t => t.category === 'custom'),
            special: templates.filter(t => t.category === 'special')
        };
        const stats = await marketTemplates.getTemplateStats();
        res.json({
            success: true,
            data: {
                templates,
                templatesByCategory,
                stats,
                userPermissions: {
                    isAdmin,
                    canCreateSpecialMarkets: await adminPermissions.canUserCreateSpecialMarkets(currentUser.discordId),
                    canResolveMarkets: await adminPermissions.canUserResolveMarkets(currentUser.discordId)
                }
            }
        });
    }
    catch (error) {
        console.error('Admin API error /templates:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch market templates'
        });
    }
});
/**
 * POST /admin/prediction_markets/create-special - Create admin special market
 */
predictionMarketsRouter.post("/prediction_markets/create-special", async (req, res) => {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        // Check admin permissions
        const canCreateSpecial = await adminPermissions.canUserCreateSpecialMarkets(currentUser.discordId);
        if (!canCreateSpecial) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient privileges to create special markets'
            });
        }
        const { title, description, templateType, outcomes, liquidity, endDate, guildId, channelId, customData, adminNotes } = req.body;
        // Validate required fields
        if (!title || !description || !outcomes || !Array.isArray(outcomes) || outcomes.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: title, description, outcomes (min 2)'
            });
        }
        // Validate template if provided
        if (templateType) {
            const canUseTemplate = marketTemplates.canUserUseTemplate(templateType, true);
            if (!canUseTemplate) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid or restricted template type'
                });
            }
            const validation = marketTemplates.validateTemplateConfig(templateType, outcomes, customData);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    error: `Template validation failed: ${validation.errors.join(', ')}`
                });
            }
        }
        // Generate market data
        const marketData = templateType
            ? marketTemplates.generateMarketData(templateType, customData)
            : { customMarket: true, ...customData };
        // Set defaults for admin markets
        const resolveAt = endDate ? new Date(endDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week default
        const marketLiquidity = liquidity ? BigInt(liquidity) : BigInt(2000); // Higher default for admin markets
        // Create the special market
        const market = await prisma.predictionMarket.create({
            data: {
                title,
                description,
                resolveAt,
                creatorId: currentUser.discordId,
                guildId: guildId || 'ADMIN_SPECIAL',
                channelId: channelId || 'ADMIN_SPECIAL',
                tokenSymbol: 'PIPCHIPS',
                marketType: templateType || 'ADMIN_CUSTOM',
                marketData,
                marketOutcomes: outcomes,
                liquidity: marketLiquidity,
                currentPrices: outcomes.reduce((acc, outcome) => {
                    acc[outcome] = (1 / outcomes.length).toFixed(4); // Equal initial probabilities
                    return acc;
                }, {}),
                lmsrShares: outcomes.reduce((acc, outcome) => {
                    acc[outcome] = '0'; // No initial shares
                    return acc;
                }, {}),
                // Admin special market fields
                templateType: templateType || 'CUSTOM_EVENT',
                resolutionMethod: 'MANUAL_ADMIN',
                isSpecialMarket: true,
                requiresManualResolution: true,
                adminNotes: adminNotes || `Created by admin ${currentUser.username || currentUser.discordId}`,
                rakePercentage: 0, // Admin markets have no rake
                minBet: 1,
                maxBet: 10000
            }
        });
        // Log admin action
        try {
            await prisma.adminSetting.upsert({
                where: { key: `market_creation_log_${Date.now()}` },
                update: {},
                create: {
                    key: `market_creation_log_${Date.now()}`,
                    value: {
                        marketId: market.id,
                        createdBy: currentUser.discordId,
                        templateType: templateType || 'CUSTOM',
                        timestamp: new Date().toISOString(),
                        action: 'SPECIAL_MARKET_CREATED'
                    },
                    description: `Special market created by admin`,
                    updatedBy: currentUser.discordId
                }
            });
        }
        catch (logError) {
            // Don't fail market creation if logging fails
            console.warn('Failed to log admin market creation:', logError);
        }
        res.json({
            success: true,
            message: 'Admin special market created successfully',
            data: {
                marketId: market.id,
                title: market.title,
                outcomes: market.marketOutcomes,
                resolutionMethod: market.resolutionMethod,
                isSpecialMarket: market.isSpecialMarket,
                createdAt: market.createdAt
            }
        });
    }
    catch (error) {
        console.error('Admin API error /create-special:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create special market'
        });
    }
});
/**
 * GET /admin/prediction_markets/special - Get admin special markets
 */
predictionMarketsRouter.get("/prediction_markets/special", async (req, res) => {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        const isAdmin = await adminPermissions.isUserAdmin(currentUser.discordId);
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Admin privileges required'
            });
        }
        const { limit = "50", offset = "0", status = "all" } = req.query;
        const limitNum = Math.min(parseInt(limit) || 50, 100);
        const offsetNum = parseInt(offset) || 0;
        const where = {
            isSpecialMarket: true
        };
        if (status !== "all") {
            where.status = status.toUpperCase();
        }
        const specialMarkets = await prisma.predictionMarket.findMany({
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
        const marketsWithDetails = specialMarkets.map(market => ({
            id: market.id,
            title: market.title,
            description: market.description,
            outcomes: market.marketOutcomes,
            status: market.status,
            templateType: market.templateType,
            resolutionMethod: market.resolutionMethod,
            isSpecialMarket: market.isSpecialMarket,
            requiresManualResolution: market.requiresManualResolution,
            totalBets: market._count.bets,
            totalVolume: Number(market.totalPipchipsVolume || 0),
            currentPrices: market.currentPrices,
            createdAt: market.createdAt,
            resolveAt: market.resolveAt,
            resolvedBy: market.resolvedBy,
            resolvedAt: market.resolvedAt,
            adminNotes: market.adminNotes,
            creatorId: market.creatorId
        }));
        const totalCount = await prisma.predictionMarket.count({
            where: { isSpecialMarket: true }
        });
        res.json({
            success: true,
            data: {
                markets: marketsWithDetails,
                pagination: {
                    total: totalCount,
                    limit: limitNum,
                    offset: offsetNum,
                    hasMore: offsetNum + limitNum < totalCount
                }
            }
        });
    }
    catch (error) {
        console.error('Admin API error /special:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch special markets'
        });
    }
});
/**
 * POST /admin/prediction_markets/:id/manual-resolve - Manually resolve market
 */
predictionMarketsRouter.post("/prediction_markets/:id/manual-resolve", async (req, res) => {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        const canResolve = await adminPermissions.canUserResolveMarkets(currentUser.discordId);
        if (!canResolve) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient privileges to resolve markets'
            });
        }
        const { id: marketId } = req.params;
        const { outcome, notes } = req.body;
        if (!outcome) {
            return res.status(400).json({
                success: false,
                error: 'Outcome is required'
            });
        }
        // Get the market
        const market = await prisma.predictionMarket.findUnique({
            where: { id: marketId }
        });
        if (!market) {
            return res.status(404).json({
                success: false,
                error: 'Market not found'
            });
        }
        if (market.status !== 'ACTIVE') {
            return res.status(400).json({
                success: false,
                error: 'Market is not active'
            });
        }
        // Validate outcome is valid for this market
        if (!market.marketOutcomes.includes(outcome)) {
            return res.status(400).json({
                success: false,
                error: `Invalid outcome. Must be one of: ${market.marketOutcomes.join(', ')}`
            });
        }
        // For LMSR markets, use the existing prediction market service
        // For multi-choice markets, we need to handle differently
        let resolveResult;
        if (market.marketOutcomes.length === 2 && (market.marketOutcomes.includes('YES') || market.marketOutcomes.includes('Yes'))) {
            // Binary market - use existing service
            const mappedOutcome = outcome === 'Yes' ? 'YES' : (outcome === 'No' ? 'NO' : outcome);
            resolveResult = await predictionMarkets.resolveMarket(marketId, mappedOutcome);
        }
        else {
            // Multi-choice market - resolve manually
            resolveResult = await this.resolveMultiChoiceMarket(marketId, outcome, currentUser.discordId);
        }
        if (!resolveResult.success) {
            return res.status(400).json({
                success: false,
                error: resolveResult.error || 'Failed to resolve market'
            });
        }
        // Update admin resolution fields
        await prisma.predictionMarket.update({
            where: { id: marketId },
            data: {
                resolvedBy: currentUser.discordId,
                resolvedAt: new Date(),
                adminNotes: notes ? `${market.adminNotes || ''}\n\nResolution notes: ${notes}` : market.adminNotes
            }
        });
        res.json({
            success: true,
            message: 'Market resolved successfully',
            data: {
                marketId,
                outcome,
                payouts: resolveResult.payouts?.length || 0,
                totalPaidOut: resolveResult.payouts?.reduce((sum, p) => sum + p.amount, 0) || 0,
                resolvedBy: currentUser.discordId,
                resolvedAt: new Date()
            }
        });
    }
    catch (error) {
        console.error('Admin API error /manual-resolve:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to resolve market'
        });
    }
});
/**
 * Helper function to resolve multi-choice markets
 */
async function resolveMultiChoiceMarket(marketId, winningOutcome, adminId) {
    try {
        const market = await prisma.predictionMarket.findUnique({
            where: { id: marketId },
            include: { bets: true }
        });
        if (!market) {
            return { success: false, error: 'Market not found' };
        }
        // For multi-choice LMSR markets: winning shares pay 1 PIPChip each
        const payouts = [];
        for (const bet of market.bets) {
            if (bet.side === winningOutcome && bet.sharesPurchased) {
                // Winner gets 1 PIPChip per share owned
                const shareCount = parseFloat(bet.sharesPurchased.toString());
                payouts.push({
                    userId: bet.userId,
                    amount: Math.floor(shareCount) // Each share = 1 PIPChip
                });
            }
            // Losing shares get nothing (already paid the cost when betting)
        }
        // Execute payouts
        await prisma.$transaction(async (tx) => {
            // Update market status
            await tx.predictionMarket.update({
                where: { id: marketId },
                data: {
                    status: 'RESOLVED',
                    outcome: winningOutcome,
                    resolvedBy: adminId,
                    resolvedAt: new Date()
                }
            });
            // Process payouts using PIPChips
            for (const payout of payouts) {
                if (payout.amount > 0) {
                    // Credit PIPChips to winner (simplified - should use pipchipsService)
                    await tx.user.update({
                        where: { discordId: payout.userId },
                        data: {
                            pipchipsBalance: { increment: BigInt(payout.amount) },
                            pipchipsEarnedTotal: { increment: BigInt(payout.amount) }
                        }
                    });
                    // Create transaction record
                    await tx.pipchipsTransaction.create({
                        data: {
                            userId: payout.userId,
                            amount: BigInt(payout.amount),
                            type: 'PREDICTION_PAYOUT',
                            referenceId: marketId,
                            description: `Payout ${payout.amount} PIPChips from resolved market: ${market.title}`,
                            metadata: { outcome: winningOutcome, adminResolved: true }
                        }
                    });
                }
            }
        });
        return { success: true, payouts };
    }
    catch (error) {
        console.error('Error resolving multi-choice market:', error);
        return { success: false, error: 'Failed to resolve multi-choice market' };
    }
}
