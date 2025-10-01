import { prisma } from "./db.js";
import { responsibleGaming } from "./responsible_gaming.js";
import { pipchipsService } from "./pipchips_service.js";
import { LMSRMarketMaker } from "./lmsr_market_maker.js";
import { getUserActiveTierForMarkets } from "./tiers.js";
import { Decimal } from "decimal.js";
class PredictionMarketService {
  /**
   * Create a new prediction market
   */
  async createMarket(params) {
    const userTier = await getUserActiveTierForMarkets(params.creatorId);
    let finalRakePercentage = params.rakePercentage || 3;
    if (userTier?.tier.marketRakePercent !== null && userTier?.tier.marketRakePercent !== void 0) {
      finalRakePercentage = Number(userTier.tier.marketRakePercent);
    }
    const baseLiquidity = 1e3;
    const liquidityBonus = userTier?.tier.systemLiquidityBonus || 0;
    const totalLiquidity = baseLiquidity + liquidityBonus;
    console.log(`Creating market for user ${params.creatorId}:`, {
      tierName: userTier?.tier.name || "No Tier",
      rakePercent: finalRakePercentage,
      baseLiquidity,
      liquidityBonus,
      totalLiquidity
    });
    const market = await prisma.predictionMarket.create({
      data: {
        title: params.title,
        description: params.description,
        resolveAt: params.resolveAt,
        creatorId: params.creatorId,
        guildId: params.guildId,
        channelId: params.channelId,
        tokenSymbol: "PIPCHIPS",
        // Always use PIPChips now
        marketType: params.marketType,
        marketData: params.marketData,
        rakePercentage: finalRakePercentage,
        // Use tier-based rake percentage
        minBet: params.minBet || 1,
        maxBet: params.maxBet || 1e4,
        status: "ACTIVE",
        totalYesBets: 0,
        totalNoBets: 0,
        totalBetCount: 0,
        // PIPChips specific fields with tier bonus
        liquidity: BigInt(totalLiquidity),
        // Base liquidity + tier bonus
        totalPipchipsVolume: BigInt(0),
        currentPrices: { YES: "0.5", NO: "0.5" },
        // Initial 50/50 prices
        lmsrShares: { YES: "0", NO: "0" }
        // Initial share distribution
      }
    });
    return this.mapDbMarket(market);
  }
  /**
   * Place a bet on a market
   * Returns updated market with new odds
   */
  async placeBet(params) {
    const { marketId, userId, side, amount } = params;
    try {
      const market = await prisma.predictionMarket.findUnique({
        where: { id: marketId }
      });
      if (!market) {
        return { success: false, error: "Market not found" };
      }
      if (market.status !== "ACTIVE") {
        return { success: false, error: "Market is not active" };
      }
      if (/* @__PURE__ */ new Date() >= market.resolveAt) {
        return { success: false, error: "Market has expired" };
      }
      const marketData = market.marketData;
      if (marketData?.bettingClosesAtGameStart || marketData?.gameStartTime) {
        const currentTime = /* @__PURE__ */ new Date();
        let bettingCutoffTime = null;
        if (marketData.bettingClosesAt) {
          bettingCutoffTime = new Date(marketData.bettingClosesAt);
        } else if (marketData.gameStartTime) {
          bettingCutoffTime = new Date(marketData.gameStartTime);
        }
        if (bettingCutoffTime && currentTime >= bettingCutoffTime) {
          const gameInfo = marketData.homeTeam && marketData.awayTeam ? `${marketData.homeTeam} vs ${marketData.awayTeam}` : "this game";
          const minutesSinceCutoff = Math.floor((currentTime.getTime() - bettingCutoffTime.getTime()) / (60 * 1e3));
          return {
            success: false,
            error: `\u23F0 Betting closed for ${gameInfo} at game start (${minutesSinceCutoff} minutes ago) to prevent late-information advantage.`
          };
        }
        if (bettingCutoffTime) {
          const minutesUntilCutoff = Math.floor((bettingCutoffTime.getTime() - currentTime.getTime()) / (60 * 1e3));
          if (minutesUntilCutoff > 0 && minutesUntilCutoff <= 30) {
            console.log(`\u26A0\uFE0F  Late sports bet: User ${userId} betting with ${minutesUntilCutoff} minutes until game start on market ${marketId}`);
          }
        }
      }
      if (amount < market.minBet || amount > market.maxBet) {
        return { success: false, error: `Prediction must be between ${market.minBet} and ${market.maxBet} PIPChips` };
      }
      const gamingCheck = await responsibleGaming.canUserPredict(userId, amount, "PIPCHIPS");
      if (!gamingCheck.allowed) {
        return {
          success: false,
          error: gamingCheck.reason || "Prediction not allowed"
        };
      }
      const user = await prisma.user.findFirst({
        where: { discordId: userId }
      });
      if (!user) {
        return { success: false, error: "User account not found. Use `/pip_profile` to create an account." };
      }
      const userPipchips = await pipchipsService.getUserBalance(userId);
      if (Number(userPipchips.balance) < amount) {
        return { success: false, error: `Insufficient PIPChips balance. You have ${Number(userPipchips.balance)} PIPChips.` };
      }
      const result = await prisma.$transaction(async (tx) => {
        await pipchipsService.processTransaction({
          userId,
          amount: BigInt(-amount),
          // Negative for deduction
          type: "PREDICTION_BET",
          referenceId: marketId,
          description: `Bet ${amount} PIPChips on ${side} in market: ${market.title}`
        });
        let sharesPurchased = null;
        if (market.lmsrShares) {
          const lmsr = new LMSRMarketMaker(new Decimal(Number(market.liquidity) || 1e3), ["YES", "NO"]);
          const currentShares = {};
          if (typeof market.lmsrShares === "object" && market.lmsrShares) {
            for (const [outcome, shareAmount] of Object.entries(market.lmsrShares)) {
              if (typeof shareAmount === "string" || typeof shareAmount === "number") {
                currentShares[outcome] = new Decimal(shareAmount);
              }
            }
          } else {
            currentShares["YES"] = new Decimal(0);
            currentShares["NO"] = new Decimal(0);
          }
          const costCalc = lmsr.calculateBuyCost(currentShares, side, new Decimal(amount));
          sharesPurchased = costCalc.sharesPurchased;
        }
        await tx.predictionParticipation.create({
          data: {
            marketId,
            userId,
            side,
            amount,
            tokenSymbol: "PIPCHIPS",
            sharesPurchased: sharesPurchased ? sharesPurchased.toFixed() : null
          }
        });
        const updates = {
          totalBetCount: { increment: 1 },
          totalPipchipsVolume: { increment: BigInt(amount) }
        };
        if (side === "YES") {
          updates.totalYesBets = { increment: amount };
        } else {
          updates.totalNoBets = { increment: amount };
        }
        if (market.lmsrShares && sharesPurchased) {
          const currentShares = market.lmsrShares || { YES: "0", NO: "0" };
          const updatedShares = { ...currentShares };
          const currentAmount = new Decimal(updatedShares[side] || "0");
          updatedShares[side] = currentAmount.plus(sharesPurchased).toFixed();
          updates.lmsrShares = updatedShares;
          const lmsr = new LMSRMarketMaker(new Decimal(Number(market.liquidity) || 1e3), ["YES", "NO"]);
          const sharesForPricing = {};
          for (const [outcome, shares] of Object.entries(updatedShares)) {
            sharesForPricing[outcome] = new Decimal(shares);
          }
          const prices = lmsr.calculateAllPrices(sharesForPricing);
          const priceRecord = {};
          for (const priceCalc of prices) {
            priceRecord[priceCalc.outcome] = priceCalc.price.toFixed(4);
          }
          updates.currentPrices = priceRecord;
        }
        const updatedMarket = await tx.predictionMarket.update({
          where: { id: marketId },
          data: updates
        });
        return updatedMarket;
      });
      return { success: true, market: this.mapDbMarket(result) };
    } catch (error) {
      console.error("Error placing bet:", error);
      return { success: false, error: "Failed to place bet" };
    }
  }
  /**
   * Calculate current odds for a market
   * Returns implied probability based on bet distribution
   */
  calculateOdds(market) {
    const totalPool = market.totalYesBets + market.totalNoBets;
    if (totalPool === 0) {
      return {
        yesOdds: 2,
        noOdds: 2,
        yesImpliedProb: 0.5,
        noImpliedProb: 0.5
      };
    }
    const yesImpliedProb = market.totalYesBets / totalPool;
    const noImpliedProb = market.totalNoBets / totalPool;
    const rakeMultiplier = (100 - market.rakePercentage) / 100;
    const yesOdds = yesImpliedProb > 0 ? 1 / yesImpliedProb * rakeMultiplier : 0;
    const noOdds = noImpliedProb > 0 ? 1 / noImpliedProb * rakeMultiplier : 0;
    return { yesOdds, noOdds, yesImpliedProb, noImpliedProb };
  }
  /**
   * Resolve a market with the given outcome
   * For LMSR markets: winning shares pay 1 PIPChip each, losing shares pay 0
   * For legacy parimutuel markets: proportional payout system
   */
  async resolveMarket(marketId, outcome) {
    try {
      const market = await prisma.predictionMarket.findUnique({
        where: { id: marketId },
        include: {
          participations: true
        }
      });
      if (!market) {
        return { success: false, error: "Market not found" };
      }
      if (market.status !== "ACTIVE") {
        return { success: false, error: "Market is not active" };
      }
      if (outcome === "CANCEL") {
        return await this.cancelMarket(marketId);
      }
      const totalPool = market.totalYesBets + market.totalNoBets;
      if (totalPool === 0 || market.totalYesBets === 0 || market.totalNoBets === 0) {
        console.log(`Market ${marketId} cancelled - insufficient betting on both sides`);
        return await this.cancelMarket(marketId);
      }
      const payouts = [];
      if (market.lmsrShares) {
        for (const participation of market.participations) {
          if (participation.side === outcome && participation.sharesPurchased) {
            const shareCount = parseFloat(participation.sharesPurchased.toString());
            payouts.push({
              userId: participation.userId,
              amount: Math.floor(shareCount)
              // Each share = 1 PIPChip
            });
          }
        }
      } else {
        const houseRake = totalPool * (market.rakePercentage / 100);
        const prizePool = totalPool - houseRake;
        const winningParticipations = market.participations.filter((participation) => participation.side === outcome);
        const winningPool = outcome === "YES" ? market.totalYesBets : market.totalNoBets;
        for (const participation of winningParticipations) {
          const winShare = participation.amount / winningPool;
          const payout = winShare * prizePool;
          payouts.push({
            userId: participation.userId,
            amount: Math.floor(payout)
          });
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.predictionMarket.update({
          where: { id: marketId },
          data: {
            status: "RESOLVED",
            outcome
          }
        });
        for (const payout of payouts) {
          if (payout.amount > 0) {
            await pipchipsService.processTransaction({
              userId: payout.userId,
              amount: BigInt(payout.amount),
              type: "BET_WON",
              referenceId: marketId,
              description: `Payout ${payout.amount} PIPChips from resolved market: ${market.title}`
            });
          }
        }
        if (!market.lmsrShares) {
          const totalPaidOut2 = payouts.reduce((sum, p) => sum + p.amount, 0);
          const rakeAmount = totalPool * (market.rakePercentage / 100);
          if (rakeAmount > 0) {
            const { logCompleteTransaction } = await import("./tx_logger.js");
            const systemUser = await tx.user.findFirst({
              where: { discordId: "SYSTEM" }
            });
            await logCompleteTransaction(tx, {
              source: "BOT",
              operation: "TREASURY_RAKE",
              userId: systemUser?.id ?? null,
              guildId: market.guildId,
              idempotencyKey: `rake_market_${marketId}`,
              opRef: `market_${marketId}`,
              metadata: {
                marketId,
                rakeAmount: Math.floor(rakeAmount),
                rakePercentage: market.rakePercentage,
                totalPool,
                description: "Prediction market house rake collection"
              },
              balanceChanges: [
                {
                  tokenId: 2,
                  // PIPCHIPS token ID
                  userId: systemUser?.id,
                  // Treasury
                  amountDelta: BigInt(Math.floor(rakeAmount)),
                  // Positive delta to treasury
                  reason: "market_rake_collected"
                }
              ]
            });
          }
        }
      });
      const totalPaidOut = payouts.reduce((sum, p) => sum + p.amount, 0);
      const effectiveRake = market.lmsrShares ? 0 : totalPool * (market.rakePercentage / 100);
      console.log(`Market ${marketId} resolved with outcome ${outcome}. Total paid out: ${totalPaidOut} PIPChips, Payouts: ${payouts.length}`);
      return { success: true, payouts, houseRake: effectiveRake };
    } catch (error) {
      console.error("Error resolving market:", error);
      return { success: false, error: "Failed to resolve market" };
    }
  }
  /**
   * Cancel a market and refund all bets
   */
  async cancelMarket(marketId) {
    try {
      const market = await prisma.predictionMarket.findUnique({
        where: { id: marketId },
        include: { participations: true }
      });
      if (!market) {
        return { success: false, error: "Market not found" };
      }
      const refunds = [];
      await prisma.$transaction(async (tx) => {
        await tx.predictionMarket.update({
          where: { id: marketId },
          data: { status: "CANCELLED" }
        });
        for (const participation of market.participations) {
          await pipchipsService.processTransaction({
            userId: participation.userId,
            amount: BigInt(participation.amount),
            type: "BET_REFUNDED",
            referenceId: marketId,
            description: `Refund ${participation.amount} PIPChips from cancelled market: ${market.title}`
          });
          refunds.push({
            userId: participation.userId,
            amount: participation.amount
          });
        }
      });
      console.log(`Market ${marketId} cancelled. Refunded ${refunds.length} participations.`);
      return { success: true, payouts: refunds };
    } catch (error) {
      console.error("Error cancelling market:", error);
      return { success: false, error: "Failed to cancel market" };
    }
  }
  /**
   * Get market by ID
   */
  async getMarket(marketId) {
    const market = await prisma.predictionMarket.findUnique({
      where: { id: marketId }
    });
    return market ? this.mapDbMarket(market) : null;
  }
  /**
   * Get active markets for a guild
   */
  async getActiveMarkets(guildId) {
    const markets = await prisma.predictionMarket.findMany({
      where: {
        guildId,
        status: "ACTIVE"
      },
      orderBy: { resolveAt: "asc" }
    });
    return markets.map((m) => this.mapDbMarket(m));
  }
  /**
   * Get expired markets that need resolution (excludes manual admin markets)
   */
  async getExpiredMarkets() {
    const now = /* @__PURE__ */ new Date();
    const markets = await prisma.predictionMarket.findMany({
      where: {
        status: "ACTIVE",
        resolveAt: { lte: now }
      },
      orderBy: { resolveAt: "asc" }
    });
    const autoResolvableMarkets = markets.filter((market) => {
      const marketData = market.marketData;
      const resolutionMethod = marketData?.resolutionMethod || "API_AUTO";
      return resolutionMethod !== "MANUAL_ADMIN";
    });
    return autoResolvableMarkets.map((m) => this.mapDbMarket(m));
  }
  /**
   * Get expired manual admin markets that require manual resolution
   */
  async getExpiredManualAdminMarkets() {
    const now = /* @__PURE__ */ new Date();
    const markets = await prisma.predictionMarket.findMany({
      where: {
        status: "ACTIVE",
        resolveAt: { lte: now }
      },
      orderBy: { resolveAt: "asc" }
    });
    const manualAdminMarkets = markets.filter((market) => {
      const marketData = market.marketData;
      const resolutionMethod = marketData?.resolutionMethod || "API_AUTO";
      return resolutionMethod === "MANUAL_ADMIN";
    });
    return manualAdminMarkets.map((m) => this.mapDbMarket(m));
  }
  /**
   * Get user's participations for a market
   */
  async getUserParticipations(marketId, userId) {
    const participations = await prisma.predictionParticipation.findMany({
      where: { marketId, userId },
      orderBy: { createdAt: "desc" }
    });
    return participations.map((participation) => ({
      id: participation.id,
      marketId: participation.marketId,
      userId: participation.userId,
      side: participation.side,
      amount: participation.amount,
      timestamp: participation.createdAt
    }));
  }
  /**
   * Get count of active markets created by a user
   */
  async getUserActiveMarketCount(userId) {
    return await prisma.predictionMarket.count({
      where: {
        creatorId: userId,
        status: "ACTIVE"
      }
    });
  }
  /**
   * Map database market to service interface
   */
  mapDbMarket(dbMarket) {
    return {
      id: dbMarket.id,
      title: dbMarket.title,
      description: dbMarket.description,
      createdAt: dbMarket.createdAt,
      resolveAt: dbMarket.resolveAt,
      status: dbMarket.status,
      outcome: dbMarket.outcome,
      totalYesBets: dbMarket.totalYesBets,
      totalNoBets: dbMarket.totalNoBets,
      totalBetCount: dbMarket.totalBetCount,
      rakePercentage: dbMarket.rakePercentage,
      minBet: dbMarket.minBet,
      maxBet: dbMarket.maxBet,
      creatorId: dbMarket.creatorId,
      guildId: dbMarket.guildId,
      channelId: dbMarket.channelId,
      tokenSymbol: dbMarket.tokenSymbol,
      marketType: dbMarket.marketType,
      marketData: dbMarket.marketData,
      // PIPChips specific fields
      liquidity: dbMarket.liquidity ? Number(dbMarket.liquidity) : void 0,
      totalPipchipsVolume: dbMarket.totalPipchipsVolume ? Number(dbMarket.totalPipchipsVolume) : void 0,
      currentPrices: dbMarket.currentPrices ? typeof dbMarket.currentPrices === "string" ? JSON.parse(dbMarket.currentPrices) : dbMarket.currentPrices : void 0,
      lmsrShares: dbMarket.lmsrShares ? typeof dbMarket.lmsrShares === "string" ? JSON.parse(dbMarket.lmsrShares) : dbMarket.lmsrShares : void 0
    };
  }
}
const predictionMarkets = new PredictionMarketService();
export {
  PredictionMarketService,
  predictionMarkets
};
//# sourceMappingURL=prediction_markets.js.map
