import { Router } from "express";
import { prisma } from "../../services/db.js";
import { PIPChipsLMSR } from "../../services/pipchips_lmsr.js";
import { pipchipsService } from "../../services/pipchips_service.js";
import { predictionMarkets } from "../../services/prediction_markets.js";
import { getCurrentUser } from "../auth.js";
import { Decimal } from "decimal.js";
const pipchipsMarketsRouter = Router();
const setCorsHeaders = (req, res, next) => {
  const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "https://piptip.gg",
    "https://www.piptip.gg",
    "https://piptip-production.up.railway.app",
    process.env.WEB_URL
  ].filter(Boolean);
  const origin = req.get("Origin");
  if (allowedOrigins.includes(origin || "")) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
};
pipchipsMarketsRouter.use(setCorsHeaders);
pipchipsMarketsRouter.get("/markets", async (req, res) => {
  try {
    const { limit = "20", offset = "0", status = "active" } = req.query;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offsetNum = parseInt(offset) || 0;
    const where = {
      currency: "PIPCHIPS"
      // Only PIPChips markets
    };
    if (status === "active") {
      where.status = "ACTIVE";
      where.resolveAt = { gt: /* @__PURE__ */ new Date() };
    } else if (status === "resolved") {
      where.status = "RESOLVED";
    }
    const [markets, totalCount] = await Promise.all([
      prisma.predictionMarket.findMany({
        where,
        orderBy: [
          { totalPipchipsVolume: "desc" },
          // Most volume first
          { createdAt: "desc" }
        ],
        take: limitNum,
        skip: offsetNum,
        include: {
          _count: {
            select: { participations: true }
          }
        }
      }),
      prisma.predictionMarket.count({ where })
    ]);
    const marketsWithPrices = markets.map((market) => {
      const lmsr = new PIPChipsLMSR(
        Number(market.liquidity) || 1e3,
        market.marketOutcomes
      );
      const currentShares = {};
      for (const outcome of market.marketOutcomes) {
        const shares = market.lmsrShares?.[outcome] || 0;
        currentShares[outcome] = new Decimal(shares);
      }
      const prices = lmsr.calculateAllPrices(currentShares);
      const pricesMap = prices.reduce((acc, p) => {
        acc[p.outcome] = p.price.toNumber();
        return acc;
      }, {});
      const timeLeft = market.resolveAt.getTime() - Date.now();
      const predictionsClosed = timeLeft <= 0 || market.status !== "ACTIVE";
      return {
        id: market.id,
        title: market.title,
        description: market.description,
        marketType: market.marketType,
        outcomes: market.marketOutcomes,
        resolveAt: market.resolveAt.toISOString(),
        timeLeftMs: Math.max(0, timeLeft),
        status: market.status,
        predictionsClosed,
        // PIPChips info
        currency: "PIPCHIPS",
        totalVolume: market.totalPipchipsVolume || 0,
        totalPredictions: market._count.participations,
        liquidityParameter: Number(market.liquidity),
        // Live LMSR prices
        prices: pricesMap,
        // Market metadata
        marketData: market.marketData,
        createdAt: market.createdAt.toISOString(),
        creatorId: market.creatorId
      };
    });
    res.json({
      success: true,
      markets: marketsWithPrices,
      pagination: {
        total: totalCount,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < totalCount
      }
    });
  } catch (error) {
    console.error("PIPChips API error /markets:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch PIPChips markets"
    });
  }
});
pipchipsMarketsRouter.get("/market/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { include_predictions = "true" } = req.query;
    const market = await prisma.predictionMarket.findUnique({
      where: {
        id
        // PIPChips markets identified by tokenSymbol instead of currency
      },
      include: {
        participations: include_predictions === "true" ? {
          where: { tokenSymbol: "PIPCHIPS" },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            side: true,
            amount: true,
            sharesPurchased: true,
            createdAt: true,
            userId: true
          }
        } : false,
        _count: {
          select: {
            participations: {
              where: { tokenSymbol: "PIPCHIPS" }
            }
          }
        }
      }
    });
    if (!market) {
      return res.status(404).json({
        success: false,
        error: "PIPChips market not found"
      });
    }
    const lmsr = new PIPChipsLMSR(
      1e3,
      // Default liquidity parameter
      market.marketOutcomes
    );
    const currentShares = {};
    for (const outcome of market.marketOutcomes) {
      const shares = market.lmsrShares?.[outcome] || 0;
      currentShares[outcome] = new Decimal(shares);
    }
    const prices = lmsr.calculateAllPrices(currentShares);
    const marketDepth = lmsr.getMarketDepth(currentShares);
    const pricesMap = prices.reduce((acc, p) => {
      acc[p.outcome] = {
        price: p.price.toNumber(),
        confidence: p.confidence.toNumber(),
        impliedProbability: p.price.toNumber() * 100
      };
      return acc;
    }, {});
    const timeLeft = market.resolveAt.getTime() - Date.now();
    const predictionsClosed = timeLeft <= 0 || market.status !== "ACTIVE";
    const participationHistory = include_predictions === "true" && market.participations ? market.participations.map((participation) => ({
      id: participation.id,
      side: participation.side,
      amount: participation.amount,
      shares: participation.sharesPurchased,
      // potentialPayout: calculated dynamically if needed
      timestamp: participation.createdAt.toISOString(),
      userId: participation.userId.slice(0, 8) + "..."
      // Anonymize
    })) : [];
    res.json({
      success: true,
      market: {
        id: market.id,
        title: market.title,
        description: market.description,
        marketType: market.marketType,
        outcomes: market.marketOutcomes,
        resolveAt: market.resolveAt.toISOString(),
        timeLeftMs: Math.max(0, timeLeft),
        status: market.status,
        predictionsClosed,
        // PIPChips market info
        currency: "PIPCHIPS",
        totalVolume: market.totalPipchipsVolume || 0,
        totalPredictions: market._count.participations,
        liquidityParameter: Number(market.liquidity),
        // LMSR pricing
        prices: pricesMap,
        marketDepth,
        currentShares: Object.fromEntries(
          Object.entries(currentShares).map(([k, v]) => [k, v.toNumber()])
        ),
        // Market data
        marketData: market.marketData,
        recentParticipations: participationHistory,
        // Meta
        createdAt: market.createdAt.toISOString(),
        creatorId: market.creatorId,
        outcome: market.outcome
        // Legacy fields removed: winningOutcome, totalPayout
      }
    });
  } catch (error) {
    console.error("PIPChips API error /market/:id:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch PIPChips market details"
    });
  }
});
pipchipsMarketsRouter.post("/predict", async (req, res) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: "Discord authentication required",
        needsAuth: true
      });
    }
    const { marketId, outcome, pipchipsAmount } = req.body;
    if (!marketId || !outcome || !pipchipsAmount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: marketId, outcome, pipchipsAmount"
      });
    }
    const predictionAmount = parseInt(pipchipsAmount);
    if (isNaN(predictionAmount) || predictionAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: "PIPChips amount must be a positive integer"
      });
    }
    if (predictionAmount < 10) {
      return res.status(400).json({
        success: false,
        error: "Minimum prediction is 10 PIPChips"
      });
    }
    console.log("\u{1F50D} Looking for market:", { marketId });
    const market = await prisma.predictionMarket.findUnique({
      where: {
        id: marketId
        // Remove tokenSymbol filter for now to debug
      }
    });
    console.log("\u{1F4CA} Found market:", market ? { id: market.id, tokenSymbol: market.tokenSymbol, status: market.status } : "NOT_FOUND");
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
    if (/* @__PURE__ */ new Date() >= market.resolveAt) {
      return res.status(400).json({
        success: false,
        error: "Market has expired"
      });
    }
    if (!market.marketOutcomes.includes(outcome)) {
      return res.status(400).json({
        success: false,
        error: `Invalid outcome. Valid outcomes: ${market.marketOutcomes.join(", ")}`
      });
    }
    const userBalance = await pipchipsService.getUserBalance(currentUser.discordId);
    if (userBalance.balance < BigInt(predictionAmount)) {
      return res.status(400).json({
        success: false,
        error: "Insufficient PIPChips balance",
        currentBalance: Number(userBalance.balance),
        required: predictionAmount,
        deficit: predictionAmount - Number(userBalance.balance)
      });
    }
    const predictionResult = await predictionMarkets.placeBet({
      marketId,
      userId: currentUser.discordId,
      side: outcome,
      amount: predictionAmount
    });
    if (!predictionResult.success) {
      return res.status(400).json({
        success: false,
        error: predictionResult.error || "Failed to place prediction"
      });
    }
    const updatedMarket = predictionResult.market;
    if (!updatedMarket) {
      throw new Error("Market not found after prediction placement");
    }
    const newUserBalance = await pipchipsService.getUserBalance(currentUser.discordId);
    const currentPrices = updatedMarket.currentPrices || { YES: "0.5", NO: "0.5" };
    res.json({
      success: true,
      message: "PIPChips prediction placed successfully",
      prediction: {
        marketId,
        outcome,
        pipchipsAmount: predictionAmount,
        sharesPurchased: 0,
        // Will be calculated based on LMSR if market uses it
        potentialPayout: predictionAmount * 2,
        // Simplified - actual payout depends on market resolution
        currentPrice: parseFloat(currentPrices[outcome] || "0.5"),
        slippage: 0,
        // Will be calculated properly once LMSR is fully integrated
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      updatedMarket: {
        id: updatedMarket.id,
        totalVolume: updatedMarket.totalPipchipsVolume || 0,
        totalPredictions: updatedMarket.totalBetCount,
        prices: currentPrices,
        totalYes: updatedMarket.totalYesBets,
        totalNo: updatedMarket.totalNoBets
      },
      userBalance: {
        previous: Number(userBalance.balance),
        current: Number(newUserBalance.balance),
        spent: predictionAmount
      }
    });
  } catch (error) {
    console.error("PIPChips prediction error:", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to place PIPChips prediction"
    });
  }
});
pipchipsMarketsRouter.post("/bet", async (req, res) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: "Discord authentication required",
        needsAuth: true
      });
    }
    const { marketId, outcome, pipchipsAmount } = req.body;
    if (!marketId || !outcome || !pipchipsAmount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: marketId, outcome, pipchipsAmount"
      });
    }
    const predictionAmount = parseInt(pipchipsAmount);
    if (isNaN(predictionAmount) || predictionAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: "PIPChips amount must be a positive integer"
      });
    }
    if (predictionAmount < 10) {
      return res.status(400).json({
        success: false,
        error: "Minimum prediction is 10 PIPChips"
      });
    }
    console.log("\u{1F50D} Looking for market:", { marketId });
    const market = await prisma.predictionMarket.findUnique({
      where: {
        id: marketId
        // Remove tokenSymbol filter for now to debug
      }
    });
    console.log("\u{1F4CA} Found market:", market ? { id: market.id, tokenSymbol: market.tokenSymbol, status: market.status } : "NOT_FOUND");
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
    if (/* @__PURE__ */ new Date() >= market.resolveAt) {
      return res.status(400).json({
        success: false,
        error: "Market has expired"
      });
    }
    if (!market.marketOutcomes.includes(outcome)) {
      return res.status(400).json({
        success: false,
        error: `Invalid outcome. Valid outcomes: ${market.marketOutcomes.join(", ")}`
      });
    }
    const userBalance = await pipchipsService.getUserBalance(currentUser.discordId);
    if (userBalance.balance < BigInt(predictionAmount)) {
      return res.status(400).json({
        success: false,
        error: "Insufficient PIPChips balance",
        currentBalance: Number(userBalance.balance),
        required: predictionAmount,
        deficit: predictionAmount - Number(userBalance.balance)
      });
    }
    const predictionResult = await predictionMarkets.placeBet({
      marketId,
      userId: currentUser.discordId,
      side: outcome,
      amount: predictionAmount
    });
    if (!predictionResult.success) {
      return res.status(400).json({
        success: false,
        error: predictionResult.error || "Failed to place prediction"
      });
    }
    const updatedMarket = predictionResult.market;
    if (!updatedMarket) {
      throw new Error("Market not found after prediction placement");
    }
    const newUserBalance = await pipchipsService.getUserBalance(currentUser.discordId);
    const currentPrices = updatedMarket.currentPrices || { YES: "0.5", NO: "0.5" };
    res.json({
      success: true,
      message: "PIPChips prediction placed successfully",
      prediction: {
        marketId,
        outcome,
        pipchipsAmount: predictionAmount,
        sharesPurchased: 0,
        // Will be calculated based on LMSR if market uses it
        potentialPayout: predictionAmount * 2,
        // Simplified - actual payout depends on market resolution
        currentPrice: parseFloat(currentPrices[outcome] || "0.5"),
        slippage: 0,
        // Will be calculated properly once LMSR is fully integrated
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      updatedMarket: {
        id: updatedMarket.id,
        totalVolume: updatedMarket.totalPipchipsVolume || 0,
        totalPredictions: updatedMarket.totalBetCount,
        prices: currentPrices,
        totalYes: updatedMarket.totalYesBets,
        totalNo: updatedMarket.totalNoBets
      },
      userBalance: {
        previous: Number(userBalance.balance),
        current: Number(newUserBalance.balance),
        spent: predictionAmount
      }
    });
  } catch (error) {
    console.error("PIPChips prediction error (legacy endpoint):", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to place PIPChips prediction"
    });
  }
});
pipchipsMarketsRouter.get("/user/balance", async (req, res) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: "Discord authentication required",
        needsAuth: true
      });
    }
    const [balance, streakInfo] = await Promise.all([
      pipchipsService.getUserBalance(currentUser.discordId),
      pipchipsService.getStreakInfo(currentUser.discordId)
    ]);
    res.json({
      success: true,
      user: {
        discordId: currentUser.discordId,
        username: currentUser.username
      },
      balance: {
        current: Number(balance.balance),
        earnedTotal: Number(balance.earnedTotal),
        spentTotal: Number(balance.spentTotal),
        boughtTotal: Number(balance.boughtTotal),
        lastDaily: balance.lastDaily?.toISOString() || null
      },
      streak: {
        currentStreak: streakInfo.currentStreak,
        longestStreak: streakInfo.longestStreak,
        canClaimDaily: streakInfo.canClaim,
        hoursUntilNext: streakInfo.hoursUntilNext,
        streakMultiplier: streakInfo.streakMultiplier,
        lastClaimDate: streakInfo.lastClaimDate?.toISOString() || null
      },
      currency: "PIPCHIPS"
    });
  } catch (error) {
    console.error("PIPChips balance API error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch PIPChips balance"
    });
  }
});
pipchipsMarketsRouter.get("/user/participations", async (req, res) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: "Discord authentication required",
        needsAuth: true
      });
    }
    const { limit = "20", offset = "0", status = "all" } = req.query;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offsetNum = parseInt(offset) || 0;
    const participations = await prisma.predictionParticipation.findMany({
      where: {
        userId: currentUser.discordId,
        tokenSymbol: "PIPCHIPS"
        // Only PIPChips participations
      },
      include: {
        market: {
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            outcome: true,
            resolveAt: true,
            marketType: true,
            marketOutcomes: true,
            totalPipchipsVolume: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: limitNum,
      skip: offsetNum
    });
    const formattedParticipations = participations.map((participation) => {
      const market = participation.market;
      let result = null;
      let actualPayout = 0;
      if (market.status === "RESOLVED" && market.outcome) {
        const won = participation.side === market.outcome;
        if (won) {
          actualPayout = Math.floor((participation.sharesPurchased || new Decimal(0)).toNumber() * 1e3);
        }
        result = won ? "won" : "lost";
      } else if (market.status === "CANCELLED") {
        result = "refunded";
        actualPayout = participation.amount;
      } else {
        result = "pending";
      }
      return {
        id: participation.id,
        marketId: participation.marketId,
        marketTitle: market.title,
        marketDescription: market.description,
        outcome: participation.side,
        pipchipsAmount: participation.amount,
        sharesPurchased: participation.sharesPurchased,
        // potentialPayout: calculated dynamically if needed
        actualPayout,
        placedAt: participation.createdAt.toISOString(),
        result,
        market: {
          status: market.status,
          outcome: market.outcome,
          resolveAt: market.resolveAt.toISOString(),
          marketType: market.marketType,
          outcomes: market.marketOutcomes,
          totalVolume: market.totalPipchipsVolume || 0
        }
      };
    });
    const filteredPredictions = status === "all" ? formattedParticipations : formattedParticipations.filter((prediction) => {
      if (status === "active") return prediction.result === "pending";
      if (status === "won") return prediction.result === "won";
      if (status === "lost") return prediction.result === "lost";
      return true;
    });
    const total = await prisma.predictionParticipation.count({
      where: {
        userId: currentUser.discordId,
        tokenSymbol: "PIPCHIPS"
      }
    });
    res.json({
      success: true,
      predictions: filteredPredictions,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < total
      },
      summary: {
        totalPredictions: filteredPredictions.length,
        totalSpent: filteredPredictions.reduce((sum, prediction) => sum + prediction.pipchipsAmount, 0),
        totalWon: filteredPredictions.filter((prediction) => prediction.result === "won").reduce((sum, prediction) => sum + prediction.actualPayout, 0),
        winRate: filteredPredictions.length > 0 ? filteredPredictions.filter((prediction) => prediction.result === "won").length / filteredPredictions.filter((prediction) => prediction.result !== "pending").length * 100 : 0
      }
    });
  } catch (error) {
    console.error("PIPChips predictions API error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch PIPChips prediction history"
    });
  }
});
pipchipsMarketsRouter.get("/stats", async (req, res) => {
  try {
    const [
      totalMarkets,
      activeMarkets,
      totalBets,
      totalVolume,
      uniqueBettors,
      pipchipsStats
    ] = await Promise.all([
      prisma.predictionMarket.count({
        where: { tokenSymbol: "PIPCHIPS" }
      }),
      prisma.predictionMarket.count({
        where: { tokenSymbol: "PIPCHIPS", status: "ACTIVE" }
      }),
      prisma.predictionParticipation.count({
        where: { tokenSymbol: "PIPCHIPS" }
      }),
      prisma.predictionParticipation.aggregate({
        where: { tokenSymbol: "PIPCHIPS" },
        _sum: { amount: true }
      }),
      prisma.predictionParticipation.findMany({
        where: { tokenSymbol: "PIPCHIPS" },
        select: { userId: true },
        distinct: ["userId"]
      }),
      pipchipsService.getSystemStats()
    ]);
    res.json({
      success: true,
      stats: {
        markets: {
          total: totalMarkets,
          active: activeMarkets,
          resolved: totalMarkets - activeMarkets
        },
        predictions: {
          totalPredictions: totalBets,
          totalVolume: totalVolume._sum.amount || 0,
          uniquePredictors: uniqueBettors.length
        },
        pipchips: {
          totalCirculation: Number(pipchipsStats.totalCirculation),
          totalEarned: Number(pipchipsStats.totalEarned),
          totalSpent: Number(pipchipsStats.totalSpent),
          totalBought: Number(pipchipsStats.totalBought),
          activeUsers24h: pipchipsStats.activeUsers24h,
          dailyClaims24h: pipchipsStats.dailyClaims24h,
          totalUsers: pipchipsStats.totalUsers
        }
      }
    });
  } catch (error) {
    console.error("PIPChips stats API error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch PIPChips statistics"
    });
  }
});
var pipchips_markets_default = pipchipsMarketsRouter;
export {
  pipchips_markets_default as default,
  pipchipsMarketsRouter
};
//# sourceMappingURL=pipchips_markets.js.map
