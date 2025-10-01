import { Router } from "express";
import { prisma } from "../../services/db.js";
import { predictionMarkets } from "../../services/prediction_markets.js";
import { getActiveTokens } from "../../services/token.js";
const marketsApiRouter = Router();
const setCorsHeaders = (req, res, next) => {
  const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "https://your-website.com",
    // Replace with your actual domain
    "https://piptip.gg",
    // Example domain
    "https://www.piptip.gg"
  ];
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
marketsApiRouter.use(setCorsHeaders);
marketsApiRouter.get("/markets", async (req, res) => {
  try {
    const { guild_id, limit = "20", offset = "0", token } = req.query;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offsetNum = parseInt(offset) || 0;
    const where = {
      status: "ACTIVE",
      resolveAt: { gt: /* @__PURE__ */ new Date() }
      // Only show non-expired markets
    };
    if (guild_id) {
      where.guildId = guild_id;
    }
    if (token) {
      where.tokenSymbol = token.toUpperCase();
    }
    const markets = await prisma.predictionMarket.findMany({
      where,
      orderBy: [
        { totalBetCount: "desc" },
        // Most active first
        { createdAt: "desc" }
      ],
      take: limitNum,
      skip: offsetNum,
      include: {
        _count: {
          select: { participations: true }
        }
      }
    });
    const marketsWithOdds = markets.map((market) => {
      const marketObj = predictionMarkets["mapDbMarket"](market);
      const odds = predictionMarkets.calculateOdds(marketObj);
      const totalPool = market.totalYesBets + market.totalNoBets;
      const timeLeft = market.resolveAt.getTime() - Date.now();
      return {
        id: market.id,
        title: market.title,
        description: market.description,
        marketType: market.marketType,
        tokenSymbol: market.tokenSymbol,
        resolveAt: market.resolveAt.toISOString(),
        timeLeftMs: Math.max(0, timeLeft),
        // Betting info
        totalPool,
        totalBets: market._count.participations,
        yesPool: market.totalYesBets,
        noPool: market.totalNoBets,
        minBet: market.minBet,
        maxBet: market.maxBet,
        // Live odds
        odds: {
          yes: Number(odds.yesOdds.toFixed(2)),
          no: Number(odds.noOdds.toFixed(2)),
          yesImplied: Number((odds.yesImpliedProb * 100).toFixed(1)),
          noImplied: Number((odds.noImpliedProb * 100).toFixed(1))
        },
        // Market data for display
        marketData: market.marketData,
        // Creator info (optional)
        creatorId: market.creatorId,
        guildId: market.guildId
      };
    });
    const total = await prisma.predictionMarket.count({ where });
    res.json({
      success: true,
      markets: marketsWithOdds,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < total
      }
    });
  } catch (error) {
    console.error("API error /markets:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch markets"
    });
  }
});
marketsApiRouter.get("/market/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { include_bets = "true" } = req.query;
    const market = await prisma.predictionMarket.findUnique({
      where: { id },
      include: {
        participations: include_bets === "true" ? {
          orderBy: { createdAt: "desc" },
          take: 50,
          // Latest 50 participations
          select: {
            id: true,
            side: true,
            amount: true,
            createdAt: true,
            userId: true
            // Discord ID - you might want to hash this for privacy
          }
        } : false,
        _count: {
          select: { participations: true }
        }
      }
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
    const marketObj = predictionMarkets["mapDbMarket"](market);
    const odds = predictionMarkets.calculateOdds(marketObj);
    const totalPool = market.totalYesBets + market.totalNoBets;
    const timeLeft = market.resolveAt.getTime() - Date.now();
    const participationHistory = include_bets === "true" && market.participations ? market.participations.map((participation) => ({
      id: participation.id,
      side: participation.side,
      amount: participation.amount,
      timestamp: participation.createdAt.toISOString(),
      userId: participation.userId.slice(0, 8) + "..."
      // Anonymize for privacy
    })) : [];
    res.json({
      success: true,
      market: {
        id: market.id,
        title: market.title,
        description: market.description,
        marketType: market.marketType,
        tokenSymbol: market.tokenSymbol,
        resolveAt: market.resolveAt.toISOString(),
        timeLeftMs: Math.max(0, timeLeft),
        status: market.status,
        // Detailed betting info
        totalPool,
        totalBets: market._count.participations,
        yesPool: market.totalYesBets,
        noPool: market.totalNoBets,
        minBet: market.minBet,
        maxBet: market.maxBet,
        rakePercentage: market.rakePercentage,
        // Live odds
        odds: {
          yes: Number(odds.yesOdds.toFixed(2)),
          no: Number(odds.noOdds.toFixed(2)),
          yesImplied: Number((odds.yesImpliedProb * 100).toFixed(1)),
          noImplied: Number((odds.noImpliedProb * 100).toFixed(1))
        },
        // Market-specific data
        marketData: market.marketData,
        // Recent participation activity
        recentParticipations: participationHistory,
        // Meta
        createdAt: market.createdAt.toISOString(),
        creatorId: market.creatorId,
        guildId: market.guildId
      }
    });
  } catch (error) {
    console.error("API error /market/:id:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch market details"
    });
  }
});
marketsApiRouter.post("/bet", async (req, res) => {
  try {
    const discordId = req.user?.discordId || req.session?.discordId;
    if (!discordId) {
      return res.status(401).json({
        success: false,
        error: "Discord authentication required",
        needsAuth: true
      });
    }
    const { marketId, side, amount } = req.body;
    if (!marketId || !side || !amount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: marketId, side, amount"
      });
    }
    if (!["YES", "NO"].includes(side)) {
      return res.status(400).json({
        success: false,
        error: "Side must be YES or NO"
      });
    }
    const betAmount = parseInt(amount);
    if (isNaN(betAmount) || betAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Amount must be a positive integer"
      });
    }
    const result = await predictionMarkets.placeBet({
      marketId,
      userId: discordId,
      side,
      amount: betAmount
    });
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }
    const odds = predictionMarkets.calculateOdds(result.market);
    const totalPool = result.market.totalYesBets + result.market.totalNoBets;
    res.json({
      success: true,
      message: "Participation placed successfully",
      participation: {
        marketId,
        side,
        amount: betAmount,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      updatedMarket: {
        id: result.market.id,
        totalPool,
        yesPool: result.market.totalYesBets,
        noPool: result.market.totalNoBets,
        totalBets: result.market.totalBetCount,
        odds: {
          yes: Number(odds.yesOdds.toFixed(2)),
          no: Number(odds.noOdds.toFixed(2)),
          yesImplied: Number((odds.yesImpliedProb * 100).toFixed(1)),
          noImplied: Number((odds.noImpliedProb * 100).toFixed(1))
        }
      }
    });
  } catch (error) {
    console.error("API error /bet:", error);
    res.status(500).json({
      success: false,
      error: "Failed to place bet"
    });
  }
});
marketsApiRouter.get("/user/participations", async (req, res) => {
  try {
    const discordId = req.user?.discordId || req.session?.discordId;
    if (!discordId) {
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
      where: { userId: discordId },
      select: {
        id: true,
        marketId: true,
        userId: true,
        side: true,
        amount: true,
        tokenSymbol: true,
        sharesPurchased: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: limitNum,
      skip: offsetNum
    });
    const marketIds = [...new Set(participations.map((p) => p.marketId))];
    const markets = await prisma.predictionMarket.findMany({
      where: { id: { in: marketIds } },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        outcome: true,
        resolveAt: true,
        marketType: true,
        tokenSymbol: true,
        totalYesBets: true,
        totalNoBets: true
      }
    });
    const marketMap = new Map(markets.map((m) => [m.id, m]));
    const formattedBets = participations.map((bet) => {
      const market = marketMap.get(bet.marketId);
      if (!market) {
        return {
          id: bet.id,
          marketId: bet.marketId,
          marketTitle: "Market not found",
          marketDescription: "",
          side: bet.side,
          amount: bet.amount,
          tokenSymbol: bet.tokenSymbol,
          placedAt: bet.createdAt.toISOString(),
          result: "unknown",
          payout: 0
        };
      }
      let result = null;
      let payout = 0;
      if (market.status === "RESOLVED" && market.outcome) {
        const won = bet.side === market.outcome;
        if (won) {
          payout = Number(bet.amount) * 2;
        }
        result = won ? "won" : "lost";
      } else if (market.status === "CANCELLED") {
        result = "refunded";
        payout = Number(bet.amount);
      } else {
        result = "pending";
      }
      return {
        id: bet.id,
        marketId: bet.marketId,
        marketTitle: market.title,
        marketDescription: market.description,
        side: bet.side,
        amount: Number(bet.amount),
        tokenSymbol: bet.tokenSymbol,
        placedAt: bet.createdAt.toISOString(),
        result,
        payout,
        market: {
          status: market.status,
          outcome: market.outcome,
          resolveAt: market.resolveAt.toISOString(),
          marketType: market.marketType,
          totalPool: Number(market.totalYesBets) + Number(market.totalNoBets)
        }
      };
    });
    const filteredBets = status === "all" ? formattedBets : formattedBets.filter((bet) => {
      if (status === "active") return bet.result === "pending";
      if (status === "won") return bet.result === "won";
      if (status === "lost") return bet.result === "lost";
      return true;
    });
    const total = await prisma.predictionParticipation.count({
      where: { userId: discordId }
    });
    res.json({
      success: true,
      bets: filteredBets,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < total
      }
    });
  } catch (error) {
    console.error("API error /user/bets:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch user bets"
    });
  }
});
marketsApiRouter.get("/user/balance", async (req, res) => {
  try {
    const discordId = req.user?.discordId || req.session?.discordId;
    if (!discordId) {
      return res.status(401).json({
        success: false,
        error: "Discord authentication required",
        needsAuth: true
      });
    }
    const user = await prisma.user.findFirst({
      where: { discordId },
      include: {
        balances: {
          include: {
            Token: true
          }
        }
      }
    });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found. Please link your wallet first."
      });
    }
    const balances = user.balances.map((balance) => ({
      tokenId: balance.Token.id,
      symbol: balance.Token.symbol,
      amount: Number(balance.amount),
      decimals: balance.Token.decimals || 18,
      // Convert to human-readable format
      displayAmount: Number(balance.amount) / Math.pow(10, balance.Token.decimals || 18)
    }));
    const activeTokens = await getActiveTokens();
    const supportedTokens = activeTokens.map((token) => ({
      id: token.id,
      symbol: token.symbol,
      decimals: token.decimals || 18,
      minBet: token.minDeposit || 1,
      active: token.active
    }));
    res.json({
      success: true,
      user: {
        discordId: user.discordId,
        walletLinked: !!user.agwAddress,
        agwAddress: user.agwAddress
      },
      balances,
      supportedTokens
    });
  } catch (error) {
    console.error("API error /user/balance:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch user balance"
    });
  }
});
marketsApiRouter.get("/stats", async (req, res) => {
  try {
    const [
      totalMarkets,
      activeMarkets,
      totalParticipations,
      totalVolume,
      uniqueParticipants
    ] = await Promise.all([
      prisma.predictionMarket.count(),
      prisma.predictionMarket.count({ where: { status: "ACTIVE" } }),
      prisma.predictionParticipation.count(),
      prisma.predictionParticipation.aggregate({
        _sum: { amount: true }
      }),
      prisma.predictionParticipation.findMany({
        select: { userId: true },
        distinct: ["userId"]
      })
    ]);
    const tokenStats = await prisma.predictionParticipation.groupBy({
      by: ["tokenSymbol"],
      _count: { tokenSymbol: true },
      _sum: { amount: true },
      orderBy: { _count: { tokenSymbol: "desc" } },
      take: 5
    });
    res.json({
      success: true,
      stats: {
        markets: {
          total: totalMarkets,
          active: activeMarkets,
          resolved: totalMarkets - activeMarkets
        },
        participation: {
          totalParticipations,
          totalVolume: totalVolume._sum.amount || 0,
          uniqueParticipants: uniqueParticipants.length
        },
        popularTokens: tokenStats.map((stat) => ({
          symbol: stat.tokenSymbol,
          bets: stat._count.tokenSymbol || 0,
          volume: stat._sum.amount || 0
        }))
      }
    });
  } catch (error) {
    console.error("API error /stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch statistics"
    });
  }
});
export {
  marketsApiRouter
};
//# sourceMappingURL=markets.js.map
