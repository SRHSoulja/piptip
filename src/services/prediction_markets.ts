// src/services/prediction_markets.ts - Core prediction market logic with PIPChips and LMSR
import { prisma } from "./db.js";
import { responsibleGaming } from "./responsible_gaming.js";
import { pipchipsService } from "./pipchips_service.js";
import { LMSRMarketMaker } from "./lmsr_market_maker.js";
import { getUserActiveTierForMarkets } from "./tiers.js";
import { placeTournamentAwareBet, processWinningsWithContext } from "./tournament_context.js";
import Decimal from 'decimal.js';

export interface MarketBet {
  id: string;
  marketId: string;
  userId: string;
  side: 'YES' | 'NO';
  amount: number;
  timestamp: Date;
}

export interface Market {
  id: string;
  title: string;
  description: string;
  createdAt: Date;
  resolveAt: Date;
  status: 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
  outcome?: 'YES' | 'NO';
  totalYesBets: number;
  totalNoBets: number;
  totalBetCount: number;
  rakePercentage: number;
  minBet: number;
  maxBet: number;
  creatorId: string;
  guildId: string;
  channelId: string;
  tokenSymbol: string; // Legacy field - now always 'PIPCHIPS'
  marketType: string;
  marketData: any; // Additional data for resolution (e.g., target price, token address)
  liquidity?: number;
  totalPipchipsVolume?: number;
  currentPrices?: Record<string, number>;
  lmsrShares?: Record<string, string>;
}

/**
 * Core prediction market service handling parimutuel betting
 * The house NEVER bets - only facilitates and collects rake
 */
export class PredictionMarketService {

  /**
   * Create a new prediction market
   */
  async createMarket(params: {
    title: string;
    description: string;
    resolveAt: Date;
    creatorId: string;
    guildId: string;
    channelId: string;
    tokenSymbol: string;
    marketType: string;
    marketData: any;
    rakePercentage?: number;
    minBet?: number;
    maxBet?: number;
  }): Promise<Market> {
    // Get user's tier information for market creation benefits
    const userTier = await getUserActiveTierForMarkets(params.creatorId);

    // Calculate tier-based rake percentage
    let finalRakePercentage = params.rakePercentage || 3.0; // Default 3% rake
    if (userTier?.tier.marketRakePercent !== null && userTier?.tier.marketRakePercent !== undefined) {
      finalRakePercentage = Number(userTier.tier.marketRakePercent);
    }

    // Calculate tier-based liquidity bonus
    const baseLiquidity = 1000;
    const liquidityBonus = userTier?.tier.systemLiquidityBonus || 0;
    const totalLiquidity = baseLiquidity + liquidityBonus;

    console.log(`Creating market for user ${params.creatorId}:`, {
      tierName: userTier?.tier.name || 'No Tier',
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
        tokenSymbol: 'PIPCHIPS', // Always use PIPChips now
        marketType: params.marketType,
        marketData: params.marketData,
        rakePercentage: finalRakePercentage, // Use tier-based rake percentage
        minBet: params.minBet || 1,
        maxBet: params.maxBet || 10000,
        status: 'ACTIVE',
        totalYesBets: 0,
        totalNoBets: 0,
        totalBetCount: 0,
        // PIPChips specific fields with tier bonus
        liquidity: BigInt(totalLiquidity), // Base liquidity + tier bonus
        totalPipchipsVolume: BigInt(0),
        currentPrices: { YES: "0.5", NO: "0.5" }, // Initial 50/50 prices
        lmsrShares: { YES: "0", NO: "0" } // Initial share distribution
      }
    });

    return this.mapDbMarket(market);
  }

  /**
   * Place a bet on a market
   * Returns updated market with new odds
   */
  async placeBet(params: {
    marketId: string;
    userId: string;
    side: 'YES' | 'NO';
    amount: number;
  }): Promise<{ success: boolean; market?: Market; error?: string }> {
    const { marketId, userId, side, amount } = params;

    try {
      // Get market and validate
      const market = await prisma.predictionMarket.findUnique({
        where: { id: marketId }
      });

      if (!market) {
        return { success: false, error: "Market not found" };
      }

      if (market.status !== 'ACTIVE') {
        return { success: false, error: "Market is not active" };
      }

      if (new Date() >= market.resolveAt) {
        return { success: false, error: "Market has expired" };
      }

      // Check sports-specific betting cutoff (game start time)
      const marketData = market.marketData as any;
      if (marketData?.bettingClosesAtGameStart || marketData?.gameStartTime) {
        const currentTime = new Date();
        let bettingCutoffTime: Date;

        if (marketData.bettingClosesAt) {
          bettingCutoffTime = new Date(marketData.bettingClosesAt);
        } else if (marketData.gameStartTime) {
          bettingCutoffTime = new Date(marketData.gameStartTime);
        }

        if (bettingCutoffTime && currentTime >= bettingCutoffTime) {
          const gameInfo = marketData.homeTeam && marketData.awayTeam
            ? `${marketData.homeTeam} vs ${marketData.awayTeam}`
            : 'this game';
          const minutesSinceCutoff = Math.floor((currentTime.getTime() - bettingCutoffTime.getTime()) / (60 * 1000));

          return {
            success: false,
            error: `⏰ Betting closed for ${gameInfo} at game start (${minutesSinceCutoff} minutes ago) to prevent late-information advantage.`
          };
        }

        // Warning for bets close to game start
        if (bettingCutoffTime) {
          const minutesUntilCutoff = Math.floor((bettingCutoffTime.getTime() - currentTime.getTime()) / (60 * 1000));
          if (minutesUntilCutoff > 0 && minutesUntilCutoff <= 30) {
            console.log(`⚠️  Late sports bet: User ${userId} betting with ${minutesUntilCutoff} minutes until game start on market ${marketId}`);
          }
        }
      }

      if (amount < market.minBet || amount > market.maxBet) {
        return { success: false, error: `Prediction must be between ${market.minBet} and ${market.maxBet} PIPChips` };
      }

      // Check responsible gaming limits
      const gamingCheck = await responsibleGaming.canUserPredict(userId, amount, 'PIPCHIPS');
      if (!gamingCheck.allowed) {
        return {
          success: false,
          error: gamingCheck.reason || "Prediction not allowed",
        };
      }

      // Check user has sufficient PIPChips balance
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

      // Execute PIPChips bet transaction
      const result = await prisma.$transaction(async (tx) => {
        // Deduct PIPChips from user balance using the service
        await pipchipsService.processTransaction({
          userId,
          amount: BigInt(-amount), // Negative for deduction
          type: 'PREDICTION_BET',
          referenceId: marketId,
          description: `Bet ${amount} PIPChips on ${side} in market: ${market.title}`
        });

        // For LMSR markets, calculate shares purchased
        let sharesPurchased = null;
        if (market.lmsrShares) {
          const lmsr = new LMSRMarketMaker(new Decimal(Number(market.liquidity) || 1000), ["YES", "NO"]);
          const currentShares: Record<string, Decimal> = {};

          // Parse current LMSR shares
          if (typeof market.lmsrShares === 'object' && market.lmsrShares) {
            for (const [outcome, shareAmount] of Object.entries(market.lmsrShares)) {
              if (typeof shareAmount === 'string' || typeof shareAmount === 'number') {
                currentShares[outcome] = new Decimal(shareAmount);
              }
            }
          } else {
            currentShares['YES'] = new Decimal(0);
            currentShares['NO'] = new Decimal(0);
          }

          const costCalc = lmsr.calculateBuyCost(currentShares, side, new Decimal(amount));
          sharesPurchased = costCalc.sharesPurchased;
        }

        // Create bet record
        await tx.predictionBet.create({
          data: {
            marketId,
            userId,
            side,
            amount,
            tokenSymbol: 'PIPCHIPS',
            sharesPurchased: sharesPurchased ? sharesPurchased.toFixed() : null
          }
        });

        // Update market totals
        const updates: any = {
          totalBetCount: { increment: 1 },
          totalPipchipsVolume: { increment: BigInt(amount) }
        };

        if (side === 'YES') {
          updates.totalYesBets = { increment: amount };
        } else {
          updates.totalNoBets = { increment: amount };
        }

        // Update LMSR shares if this is an LMSR market
        if (market.lmsrShares && sharesPurchased) {
          const currentShares = market.lmsrShares as Record<string, string> || { YES: '0', NO: '0' };
          const updatedShares = { ...currentShares };
          const currentAmount = new Decimal(updatedShares[side] || '0');
          updatedShares[side] = currentAmount.plus(sharesPurchased).toFixed();

          updates.lmsrShares = updatedShares;

          // Update current prices
          const lmsr = new LMSRMarketMaker(new Decimal(Number(market.liquidity) || 1000), ["YES", "NO"]);
          const sharesForPricing: Record<string, Decimal> = {};
          for (const [outcome, shares] of Object.entries(updatedShares)) {
            sharesForPricing[outcome] = new Decimal(shares);
          }
          const prices = lmsr.calculateAllPrices(sharesForPricing);
          const priceRecord: Record<string, string> = {};
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
      console.error('Error placing bet:', error);
      return { success: false, error: "Failed to place bet" };
    }
  }

  /**
   * Calculate current odds for a market
   * Returns implied probability based on bet distribution
   */
  calculateOdds(market: Market): { yesOdds: number; noOdds: number; yesImpliedProb: number; noImpliedProb: number } {
    const totalPool = market.totalYesBets + market.totalNoBets;

    if (totalPool === 0) {
      // No bets yet - 50/50 odds
      return {
        yesOdds: 2.0,
        noOdds: 2.0,
        yesImpliedProb: 0.5,
        noImpliedProb: 0.5
      };
    }

    // Calculate implied probabilities
    const yesImpliedProb = market.totalYesBets / totalPool;
    const noImpliedProb = market.totalNoBets / totalPool;

    // Calculate odds (payout ratio)
    // If 60% bet YES, then YES odds = 1 / 0.6 = 1.67 (before rake)
    // Account for rake in payout calculations
    const rakeMultiplier = (100 - market.rakePercentage) / 100;

    const yesOdds = yesImpliedProb > 0 ? (1 / yesImpliedProb) * rakeMultiplier : 0;
    const noOdds = noImpliedProb > 0 ? (1 / noImpliedProb) * rakeMultiplier : 0;

    return { yesOdds, noOdds, yesImpliedProb, noImpliedProb };
  }

  /**
   * Resolve a market with the given outcome
   * For LMSR markets: winning shares pay 1 PIPChip each, losing shares pay 0
   * For legacy parimutuel markets: proportional payout system
   */
  async resolveMarket(marketId: string, outcome: 'YES' | 'NO' | 'CANCEL'): Promise<{
    success: boolean;
    payouts?: Array<{ userId: string; amount: number }>;
    houseRake?: number;
    error?: string;
  }> {
    try {
      const market = await prisma.predictionMarket.findUnique({
        where: { id: marketId },
        include: {
          bets: true
        }
      });

      if (!market) {
        return { success: false, error: "Market not found" };
      }

      if (market.status !== 'ACTIVE') {
        return { success: false, error: "Market is not active" };
      }

      // Handle cancellation (refund all bets)
      if (outcome === 'CANCEL') {
        return await this.cancelMarket(marketId);
      }

      const totalPool = market.totalYesBets + market.totalNoBets;

      // If no bets or only one side has bets, cancel the market
      if (totalPool === 0 || market.totalYesBets === 0 || market.totalNoBets === 0) {
        console.log(`Market ${marketId} cancelled - insufficient betting on both sides`);
        return await this.cancelMarket(marketId);
      }

      const payouts: Array<{ userId: string; amount: number }> = [];

      // Check if this is an LMSR market (has lmsrShares data)
      if (market.lmsrShares) {
        // LMSR payout: winning shares pay 1 PIPChip each, losing shares pay 0
        for (const bet of market.bets) {
          if (bet.side === outcome && bet.sharesPurchased) {
            // Winner gets 1 PIPChip per share owned
            const shareCount = parseFloat(bet.sharesPurchased.toString());
            payouts.push({
              userId: bet.userId,
              amount: Math.floor(shareCount) // Each share = 1 PIPChip
            });
          }
          // Losing shares get nothing (already paid the cost when betting)
        }
      } else {
        // Legacy parimutuel payout system
        const houseRake = totalPool * (market.rakePercentage / 100);
        const prizePool = totalPool - houseRake;

        const winningBets = market.bets.filter(bet => bet.side === outcome);
        const winningPool = outcome === 'YES' ? market.totalYesBets : market.totalNoBets;

        for (const bet of winningBets) {
          const winShare = bet.amount / winningPool;
          const payout = winShare * prizePool;
          payouts.push({
            userId: bet.userId,
            amount: Math.floor(payout)
          });
        }
      }

      // Execute payout transaction
      await prisma.$transaction(async (tx) => {
        // Update market status
        await tx.predictionMarket.update({
          where: { id: marketId },
          data: {
            status: 'RESOLVED',
            outcome
          }
        });

        // Process payouts using PIPChips
        for (const payout of payouts) {
          if (payout.amount > 0) {
            // Credit PIPChips to winner
            await pipchipsService.processTransaction({
              userId: payout.userId,
              amount: BigInt(payout.amount),
              type: 'PREDICTION_PAYOUT',
              referenceId: marketId,
              description: `Payout ${payout.amount} PIPChips from resolved market: ${market.title}`
            });
          }
        }

        // Add house rake to treasury (optional - depends on your tokenomics)
        // This could go to a treasury wallet or be distributed to token holders
      });

      // Calculate rake for logging (LMSR markets don't have traditional rake)
      const totalPaidOut = payouts.reduce((sum, p) => sum + p.amount, 0);
      const effectiveRake = market.lmsrShares ? 0 : totalPool * (market.rakePercentage / 100);

      console.log(`Market ${marketId} resolved with outcome ${outcome}. Total paid out: ${totalPaidOut} PIPChips, Payouts: ${payouts.length}`);

      return { success: true, payouts, houseRake: effectiveRake };

    } catch (error) {
      console.error('Error resolving market:', error);
      return { success: false, error: "Failed to resolve market" };
    }
  }

  /**
   * Cancel a market and refund all bets
   */
  private async cancelMarket(marketId: string): Promise<{
    success: boolean;
    payouts?: Array<{ userId: string; amount: number }>;
    error?: string;
  }> {
    try {
      const market = await prisma.predictionMarket.findUnique({
        where: { id: marketId },
        include: { bets: true }
      });

      if (!market) {
        return { success: false, error: "Market not found" };
      }

      // Refund all bets
      const refunds: Array<{ userId: string; amount: number }> = [];

      await prisma.$transaction(async (tx) => {
        // Update market status
        await tx.predictionMarket.update({
          where: { id: marketId },
          data: { status: 'CANCELLED' }
        });

        // Process refunds using PIPChips
        for (const bet of market.bets) {
          // Refund the original bet amount in PIPChips
          await pipchipsService.processTransaction({
            userId: bet.userId,
            amount: BigInt(bet.amount),
            type: 'PREDICTION_REFUND',
            referenceId: marketId,
            description: `Refund ${bet.amount} PIPChips from cancelled market: ${market.title}`
          });

          refunds.push({
            userId: bet.userId,
            amount: bet.amount
          });
        }
      });

      console.log(`Market ${marketId} cancelled. Refunded ${refunds.length} bets.`);

      return { success: true, payouts: refunds };

    } catch (error) {
      console.error('Error cancelling market:', error);
      return { success: false, error: "Failed to cancel market" };
    }
  }

  /**
   * Get market by ID
   */
  async getMarket(marketId: string): Promise<Market | null> {
    const market = await prisma.predictionMarket.findUnique({
      where: { id: marketId }
    });

    return market ? this.mapDbMarket(market) : null;
  }

  /**
   * Get active markets for a guild
   */
  async getActiveMarkets(guildId: string): Promise<Market[]> {
    const markets = await prisma.predictionMarket.findMany({
      where: {
        guildId,
        status: 'ACTIVE'
      },
      orderBy: { resolveAt: 'asc' }
    });

    return markets.map(m => this.mapDbMarket(m));
  }

  /**
   * Get expired markets that need resolution (excludes manual admin markets)
   */
  async getExpiredMarkets(): Promise<Market[]> {
    const now = new Date();
    const markets = await prisma.predictionMarket.findMany({
      where: {
        status: 'ACTIVE',
        resolveAt: { lte: now }
      },
      orderBy: { resolveAt: 'asc' }
    });

    // Filter out manual admin markets from automatic resolution
    const autoResolvableMarkets = markets.filter(market => {
      const marketData = market.marketData as any;
      const resolutionMethod = marketData?.resolutionMethod || 'API_AUTO';
      return resolutionMethod !== 'MANUAL_ADMIN';
    });

    return autoResolvableMarkets.map(m => this.mapDbMarket(m));
  }

  /**
   * Get expired manual admin markets that require manual resolution
   */
  async getExpiredManualAdminMarkets(): Promise<Market[]> {
    const now = new Date();
    const markets = await prisma.predictionMarket.findMany({
      where: {
        status: 'ACTIVE',
        resolveAt: { lte: now }
      },
      orderBy: { resolveAt: 'asc' }
    });

    // Filter to only manual admin markets
    const manualAdminMarkets = markets.filter(market => {
      const marketData = market.marketData as any;
      const resolutionMethod = marketData?.resolutionMethod || 'API_AUTO';
      return resolutionMethod === 'MANUAL_ADMIN';
    });

    return manualAdminMarkets.map(m => this.mapDbMarket(m));
  }

  /**
   * Get user's bets for a market
   */
  async getUserBets(marketId: string, userId: string): Promise<MarketBet[]> {
    const bets = await prisma.predictionBet.findMany({
      where: { marketId, userId },
      orderBy: { createdAt: 'desc' }
    });

    return bets.map(bet => ({
      id: bet.id,
      marketId: bet.marketId,
      userId: bet.userId,
      side: bet.side as 'YES' | 'NO',
      amount: bet.amount,
      timestamp: bet.createdAt
    }));
  }

  /**
   * Get count of active markets created by a user
   */
  async getUserActiveMarketCount(userId: string): Promise<number> {
    return await prisma.predictionMarket.count({
      where: {
        creatorId: userId,
        status: 'ACTIVE'
      }
    });
  }

  /**
   * Map database market to service interface
   */
  private mapDbMarket(dbMarket: any): Market {
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
      liquidity: dbMarket.liquidity ? Number(dbMarket.liquidity) : undefined,
      totalPipchipsVolume: dbMarket.totalPipchipsVolume ? Number(dbMarket.totalPipchipsVolume) : undefined,
      currentPrices: dbMarket.currentPrices ? (typeof dbMarket.currentPrices === 'string' ? JSON.parse(dbMarket.currentPrices) : dbMarket.currentPrices) : undefined,
      lmsrShares: dbMarket.lmsrShares ? (typeof dbMarket.lmsrShares === 'string' ? JSON.parse(dbMarket.lmsrShares) : dbMarket.lmsrShares) : undefined
    };
  }
}

// Export singleton instance
export const predictionMarkets = new PredictionMarketService();