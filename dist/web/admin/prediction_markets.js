import { Router } from "express";
import { prisma } from "../../services/db.js";
import { predictionMarkets } from "../../services/prediction_markets.js";
import { marketResolver } from "../../services/market_resolver.js";
import { marketConfig } from "../../services/market_config.js";
import { marketAutomation } from "../../services/market_automation.js";
import { adminPermissions } from "../../services/admin_permissions.js";
import { marketTemplates } from "../../services/market_templates.js";
import { getCurrentUser } from "../auth.js";
const predictionMarketsRouter = Router();
predictionMarketsRouter.get("/prediction_markets", async (req, res) => {
  try {
    const { status = "all", limit = "50", offset = "0", guild_id } = req.query;
    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const offsetNum = parseInt(offset) || 0;
    const where = {};
    if (status !== "all") {
      where.status = status.toUpperCase();
    }
    if (guild_id) {
      where.guildId = guild_id;
    }
    const markets = await prisma.predictionMarket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limitNum,
      skip: offsetNum,
      include: {
        _count: {
          select: { participations: true }
        }
      }
    });
    const marketsWithDetails = markets.map((market) => {
      const marketObj = predictionMarkets["mapDbMarket"](market);
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
        totalBets: market._count.participations,
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
  } catch (error) {
    console.error("Admin API error /prediction_markets:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch markets"
    });
  }
});
predictionMarketsRouter.post("/prediction_markets/:id/resolve", async (req, res) => {
  try {
    const { id } = req.params;
    const { outcome, force = false } = req.body;
    if (!outcome || !["YES", "NO", "CANCEL"].includes(outcome)) {
      return res.status(400).json({
        success: false,
        error: "Outcome must be YES, NO, or CANCEL"
      });
    }
    const market = await prisma.predictionMarket.findUnique({
      where: { id },
      include: { _count: { select: { participations: true } } }
    });
    if (!market) {
      return res.status(404).json({
        success: false,
        error: "Market not found"
      });
    }
    if (market.status !== "ACTIVE" && !force) {
      return res.status(400).json({
        success: false,
        error: "Market is not active. Use force=true to override."
      });
    }
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
        totalParticipations: market._count.participations
      }
    });
  } catch (error) {
    console.error("Admin API error /resolve:", error);
    res.status(500).json({
      success: false,
      error: "Failed to resolve market"
    });
  }
});
predictionMarketsRouter.delete("/prediction_markets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await predictionMarkets.resolveMarket(id, "CANCEL");
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }
    res.json({
      success: true,
      message: "Market cancelled and all bets refunded",
      refunds: result.payouts?.length || 0
    });
  } catch (error) {
    console.error("Admin API error /cancel:", error);
    res.status(500).json({
      success: false,
      error: "Failed to cancel market"
    });
  }
});
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
  } catch (error) {
    console.error("Admin API error /force-resolve:", error);
    res.status(500).json({
      success: false,
      error: "Failed to force resolve market"
    });
  }
});
predictionMarketsRouter.get("/prediction_markets/stats", async (req, res) => {
  try {
    const [
      totalMarkets,
      activeMarkets,
      expiredMarkets,
      resolvedMarkets,
      cancelledMarkets,
      totalBets,
      totalVolume,
      recentActivity
    ] = await Promise.all([
      // Market counts
      prisma.predictionMarket.count(),
      prisma.predictionMarket.count({ where: { status: "ACTIVE" } }),
      prisma.predictionMarket.count({
        where: {
          status: "ACTIVE",
          resolveAt: { lte: /* @__PURE__ */ new Date() }
        }
      }),
      prisma.predictionMarket.count({ where: { status: "RESOLVED" } }),
      prisma.predictionMarket.count({ where: { status: "CANCELLED" } }),
      // Participation stats
      prisma.predictionParticipation.count(),
      prisma.predictionParticipation.aggregate({
        _sum: { amount: true }
      }),
      // Recent activity (last 24 hours)
      prisma.predictionParticipation.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1e3)
          }
        }
      })
    ]);
    const tokenStats = await prisma.predictionParticipation.groupBy({
      by: ["tokenSymbol"],
      _count: { tokenSymbol: true },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 5
    });
    const automationStatus = marketAutomation.getStatus();
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
        participation: {
          totalParticipations: totalBets,
          totalVolume: totalVolume._sum.amount || 0,
          recentActivity24h: recentActivity
        },
        topTokens: tokenStats.map((stat) => ({
          symbol: stat.tokenSymbol,
          participations: stat._count.tokenSymbol || 0,
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
  } catch (error) {
    console.error("Admin API error /stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch statistics"
    });
  }
});
predictionMarketsRouter.get("/prediction_markets/config", async (req, res) => {
  try {
    const config = marketConfig.getConfig();
    res.json({
      success: true,
      config
    });
  } catch (error) {
    console.error("Admin API error /config:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch configuration"
    });
  }
});
predictionMarketsRouter.put("/prediction_markets/config", async (req, res) => {
  try {
    const updates = req.body;
    if (updates.settings?.defaultRakePercentage) {
      const rake = parseFloat(updates.settings.defaultRakePercentage);
      if (isNaN(rake) || rake < 0 || rake > 20) {
        return res.status(400).json({
          success: false,
          error: "Rake percentage must be between 0 and 20"
        });
      }
    }
    const currentConfig = marketConfig.getConfig();
    res.json({
      success: true,
      message: "Configuration validation passed",
      note: "In production, this would update the configuration file and restart automation if needed",
      current: currentConfig,
      proposed: updates
    });
  } catch (error) {
    console.error("Admin API error /config update:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update configuration"
    });
  }
});
predictionMarketsRouter.post("/prediction_markets/automation/restart", async (req, res) => {
  try {
    marketAutomation.restart();
    res.json({
      success: true,
      message: "Market automation restarted",
      status: marketAutomation.getStatus()
    });
  } catch (error) {
    console.error("Admin API error /automation/restart:", error);
    res.status(500).json({
      success: false,
      error: "Failed to restart automation"
    });
  }
});
predictionMarketsRouter.post("/prediction_markets/resolve-expired", async (req, res) => {
  try {
    const result = await marketAutomation.forceResolveExpiredMarkets();
    res.json({
      success: true,
      message: "Expired markets resolution triggered",
      result: {
        resolved: result.resolved,
        errors: result.errors
      }
    });
  } catch (error) {
    console.error("Admin API error /resolve-expired:", error);
    res.status(500).json({
      success: false,
      error: "Failed to resolve expired markets"
    });
  }
});
predictionMarketsRouter.get("/prediction_markets/templates", async (req, res) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    const isAdmin = await adminPermissions.isUserAdmin(currentUser.discordId);
    const templates = marketTemplates.getAllTemplates(isAdmin);
    const templatesByCategory = {
      sports: templates.filter((t) => t.category === "sports"),
      crypto: templates.filter((t) => t.category === "crypto"),
      custom: templates.filter((t) => t.category === "custom"),
      special: templates.filter((t) => t.category === "special")
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
  } catch (error) {
    console.error("Admin API error /templates:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch market templates"
    });
  }
});
predictionMarketsRouter.post("/prediction_markets/create-special", async (req, res) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    const canCreateSpecial = await adminPermissions.canUserCreateSpecialMarkets(currentUser.discordId);
    if (!canCreateSpecial) {
      return res.status(403).json({
        success: false,
        error: "Insufficient privileges to create special markets"
      });
    }
    const {
      title,
      description,
      templateType,
      outcomes,
      liquidity,
      endDate,
      guildId,
      channelId,
      customData,
      adminNotes
    } = req.body;
    if (!title || !description || !outcomes || !Array.isArray(outcomes) || outcomes.length < 2) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: title, description, outcomes (min 2)"
      });
    }
    if (templateType) {
      const canUseTemplate = marketTemplates.canUserUseTemplate(templateType, true);
      if (!canUseTemplate) {
        return res.status(400).json({
          success: false,
          error: "Invalid or restricted template type"
        });
      }
      const validation = marketTemplates.validateTemplateConfig(templateType, outcomes, customData);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: `Template validation failed: ${validation.errors.join(", ")}`
        });
      }
    }
    const marketData = templateType ? marketTemplates.generateMarketData(templateType, customData) : { customMarket: true, ...customData };
    const resolveAt = endDate ? new Date(endDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3);
    const marketLiquidity = liquidity ? BigInt(liquidity) : BigInt(2e3);
    const market = await prisma.predictionMarket.create({
      data: {
        title,
        description,
        resolveAt,
        creatorId: currentUser.discordId,
        guildId: guildId || "ADMIN_SPECIAL",
        channelId: channelId || "ADMIN_SPECIAL",
        tokenSymbol: "PIPCHIPS",
        marketType: templateType || "ADMIN_CUSTOM",
        marketData,
        marketOutcomes: outcomes,
        liquidity: marketLiquidity,
        currentPrices: outcomes.reduce((acc, outcome) => {
          acc[outcome] = (1 / outcomes.length).toFixed(4);
          return acc;
        }, {}),
        lmsrShares: outcomes.reduce((acc, outcome) => {
          acc[outcome] = "0";
          return acc;
        }, {}),
        // Admin special market fields
        templateType: templateType || "CUSTOM_EVENT",
        resolutionMethod: "MANUAL_ADMIN",
        isSpecialMarket: true,
        requiresManualResolution: true,
        adminNotes: adminNotes || `Created by admin ${currentUser.username || currentUser.discordId}`,
        rakePercentage: 0,
        // Admin markets have no rake
        minBet: 1,
        maxBet: 1e4
      }
    });
    try {
      await prisma.adminSetting.upsert({
        where: { key: `market_creation_log_${Date.now()}` },
        update: {},
        create: {
          key: `market_creation_log_${Date.now()}`,
          value: {
            marketId: market.id,
            createdBy: currentUser.discordId,
            templateType: templateType || "CUSTOM",
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            action: "SPECIAL_MARKET_CREATED"
          },
          description: `Special market created by admin`,
          updatedBy: currentUser.discordId
        }
      });
    } catch (logError) {
      console.warn("Failed to log admin market creation:", logError);
    }
    res.json({
      success: true,
      message: "Admin special market created successfully",
      data: {
        marketId: market.id,
        title: market.title,
        outcomes: market.marketOutcomes,
        resolutionMethod: market.resolutionMethod,
        isSpecialMarket: market.isSpecialMarket,
        createdAt: market.createdAt
      }
    });
  } catch (error) {
    console.error("Admin API error /create-special:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create special market"
    });
  }
});
predictionMarketsRouter.get("/prediction_markets/special", async (req, res) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    const isAdmin = await adminPermissions.isUserAdmin(currentUser.discordId);
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: "Admin privileges required"
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
      orderBy: { createdAt: "desc" },
      take: limitNum,
      skip: offsetNum,
      include: {
        _count: {
          select: { participations: true }
        }
      }
    });
    const marketsWithDetails = specialMarkets.map((market) => ({
      id: market.id,
      title: market.title,
      description: market.description,
      outcomes: market.marketOutcomes,
      status: market.status,
      templateType: market.templateType,
      resolutionMethod: market.resolutionMethod,
      isSpecialMarket: market.isSpecialMarket,
      requiresManualResolution: market.requiresManualResolution,
      totalParticipations: market._count.participations,
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
  } catch (error) {
    console.error("Admin API error /special:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch special markets"
    });
  }
});
predictionMarketsRouter.post("/prediction_markets/:id/manual-resolve", async (req, res) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    const canResolve = await adminPermissions.canUserResolveMarkets(currentUser.discordId);
    if (!canResolve) {
      return res.status(403).json({
        success: false,
        error: "Insufficient privileges to resolve markets"
      });
    }
    const { id: marketId } = req.params;
    const { outcome, notes } = req.body;
    if (!outcome) {
      return res.status(400).json({
        success: false,
        error: "Outcome is required"
      });
    }
    const market = await prisma.predictionMarket.findUnique({
      where: { id: marketId }
    });
    if (!market) {
      return res.status(404).json({
        success: false,
        error: "Market not found"
      });
    }
    if (market.status !== "ACTIVE") {
      return res.status(400).json({
        success: false,
        error: "Market is not active"
      });
    }
    if (!market.marketOutcomes.includes(outcome)) {
      return res.status(400).json({
        success: false,
        error: `Invalid outcome. Must be one of: ${market.marketOutcomes.join(", ")}`
      });
    }
    let resolveResult;
    if (market.marketOutcomes.length === 2 && (market.marketOutcomes.includes("YES") || market.marketOutcomes.includes("Yes"))) {
      const mappedOutcome = outcome === "Yes" ? "YES" : outcome === "No" ? "NO" : outcome;
      resolveResult = await predictionMarkets.resolveMarket(marketId, mappedOutcome);
    } else {
      resolveResult = await resolveMultiChoiceMarket(marketId, outcome, currentUser?.discordId || "admin");
    }
    if (!resolveResult.success) {
      return res.status(400).json({
        success: false,
        error: resolveResult.error || "Failed to resolve market"
      });
    }
    await prisma.predictionMarket.update({
      where: { id: marketId },
      data: {
        resolvedBy: currentUser?.discordId || "admin",
        resolvedAt: /* @__PURE__ */ new Date(),
        adminNotes: notes ? `${market.adminNotes || ""}

Resolution notes: ${notes}` : market.adminNotes
      }
    });
    res.json({
      success: true,
      message: "Market resolved successfully",
      data: {
        marketId,
        outcome,
        payouts: resolveResult.payouts?.length || 0,
        totalPaidOut: resolveResult.payouts?.reduce((sum, p) => sum + p.amount, 0) || 0,
        resolvedBy: currentUser?.discordId || "admin",
        resolvedAt: /* @__PURE__ */ new Date()
      }
    });
  } catch (error) {
    console.error("Admin API error /manual-resolve:", error);
    res.status(500).json({
      success: false,
      error: "Failed to resolve market"
    });
  }
});
async function resolveMultiChoiceMarket(marketId, winningOutcome, adminId) {
  try {
    const market = await prisma.predictionMarket.findUnique({
      where: { id: marketId },
      include: { participations: true }
    });
    if (!market) {
      return { success: false, error: "Market not found" };
    }
    const payouts = [];
    for (const participation of market.participations) {
      if (participation.side === winningOutcome && participation.sharesPurchased) {
        const shareCount = parseFloat(participation.sharesPurchased.toString());
        payouts.push({
          userId: participation.userId,
          amount: Math.floor(shareCount)
          // Each share = 1 PIPChip
        });
      }
    }
    await prisma.$transaction(async (tx) => {
      await tx.predictionMarket.update({
        where: { id: marketId },
        data: {
          status: "RESOLVED",
          outcome: winningOutcome,
          resolvedBy: adminId,
          resolvedAt: /* @__PURE__ */ new Date()
        }
      });
      for (const payout of payouts) {
        if (payout.amount > 0) {
          const updatedUser = await tx.user.update({
            where: { discordId: payout.userId },
            data: {
              pipchipsBalance: { increment: BigInt(payout.amount) },
              pipchipsEarnedTotal: { increment: BigInt(payout.amount) }
            }
          });
          await tx.pipchipsTransaction.create({
            data: {
              userId: payout.userId,
              amount: BigInt(payout.amount),
              balanceAfter: updatedUser.pipchipsBalance,
              transactionType: "PREDICTION_WIN",
              referenceId: marketId,
              description: `Payout ${payout.amount} PIPChips from resolved market: ${market.title}`,
              metadata: { outcome: winningOutcome, adminResolved: true }
            }
          });
        }
      }
    });
    return { success: true, payouts };
  } catch (error) {
    console.error("Error resolving multi-choice market:", error);
    return { success: false, error: "Failed to resolve multi-choice market" };
  }
}
export {
  predictionMarketsRouter
};
//# sourceMappingURL=prediction_markets.js.map
