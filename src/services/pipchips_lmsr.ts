// src/services/pipchips_lmsr.ts - PIPChips-powered LMSR Market Maker for web predictions
import { Decimal } from 'decimal.js';
import { LMSRMarketMaker } from './lmsr_market_maker.js';
import { pipchipsService } from './pipchips_service.js';
import { prisma } from './db.js';
import { createLogger, logFinancialOperation } from '../utils/logger.js';

// Configure high precision for PIPChips calculations
Decimal.set({
  precision: 50,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -20,
  toExpPos: 30,
  minE: -1000,
  maxE: 1000,
});

const logger = createLogger('pipchips-lmsr');

interface PIPChipsParticipation {
  userId: string;
  marketId: string;
  outcome: string;
  pipchipsAmount: bigint;
  sharesPurchased: Decimal;
  potentialPayout: Decimal;
  currentPrice: Decimal;
  slippage: Decimal;
}

interface MarketState {
  id: string;
  shares: Record<string, Decimal>;
  prices: Record<string, Decimal>;
  totalVolume: bigint;
  liquidityParameter: Decimal;
}

export class PIPChipsLMSR {
  private lmsr: LMSRMarketMaker;

  constructor(liquidityParameter: number = 1000, outcomes: string[] = ['YES', 'NO']) {
    this.lmsr = new LMSRMarketMaker(new Decimal(liquidityParameter), outcomes);
  }

  /**
   * Calculate cost in PIPChips to buy shares of an outcome
   */
  async calculateBetCost(
    currentShares: Record<string, Decimal>,
    outcome: string,
    pipchipsAmount: bigint
  ): Promise<{
    sharesPurchased: Decimal;
    actualCost: bigint;
    potentialPayout: Decimal;
    priceImpact: Decimal;
    slippage: Decimal;
    newPrice: Decimal;
  }> {
    const financialLog = logFinancialOperation(
      'pipchips_bet_calculation',
      'system',
      pipchipsAmount.toString()
    );

    try {
      financialLog.start();

      // Convert PIPChips amount to shares using market price
      const currentPrice = this.lmsr.calculatePrice(currentShares, outcome);
      const targetShares = new Decimal(pipchipsAmount.toString()).div(1000); // 1000 PIPChips per share baseline

      // Get exact cost and shares from LMSR
      const costCalculation = this.lmsr.calculateBuyCost(currentShares, outcome, targetShares);

      // Convert LMSR cost back to PIPChips (multiply by 1000)
      const actualCostPipchips = costCalculation.cost.times(1000);
      const actualCostBigint = BigInt(Math.floor(actualCostPipchips.toNumber()));

      // Potential payout is shares * 1000 PIPChips (full payout per share)
      const potentialPayout = costCalculation.sharesPurchased.times(1000);

      const result = {
        sharesPurchased: costCalculation.sharesPurchased,
        actualCost: actualCostBigint,
        potentialPayout,
        priceImpact: costCalculation.priceImpact,
        slippage: costCalculation.slippage,
        newPrice: costCalculation.newPrice
      };

      financialLog.success({
        shares: result.sharesPurchased.toString(),
        cost: result.actualCost.toString(),
        payout: result.potentialPayout.toString()
      });

      return result;

    } catch (error) {
      financialLog.error(error as Error);
      logger.error({ error, outcome, pipchipsAmount: pipchipsAmount.toString() }, 'Bet cost calculation failed');
      throw error;
    }
  }

  /**
   * Place a bet using PIPChips and update market state
   */
  async placeBet(
    userId: string,
    marketId: string,
    outcome: string,
    pipchipsAmount: bigint
  ): Promise<PIPChipsParticipation> {
    const financialLog = logFinancialOperation(
      'pipchips_place_bet',
      userId,
      pipchipsAmount.toString()
    );

    try {
      financialLog.start();

      const result = await prisma.$transaction(async (tx) => {
        // 1. Get market state
        const market = await tx.predictionMarket.findUnique({
          where: { id: marketId },
          select: {
            id: true,
            lmsrShares: true,
            liquidityParameter: true,
            marketOutcomes: true,
            status: true,
            resolveAt: true
          }
        });

        if (!market) {
          throw new Error(`Market ${marketId} not found`);
        }

        if (market.status !== 'ACTIVE') {
          throw new Error(`Market ${marketId} is not active`);
        }

        if (new Date() >= market.resolveAt) {
          throw new Error(`Market ${marketId} has expired`);
        }

        // 2. Parse current shares from database
        const currentShares: Record<string, Decimal> = {};
        for (const outcome of market.marketOutcomes) {
          const shares = market.lmsrShares?.[outcome] || 0;
          currentShares[outcome] = new Decimal(shares);
        }

        // 3. Calculate bet cost and shares
        const costCalc = await this.calculateBetCost(currentShares, outcome, pipchipsAmount);

        // 4. Debit PIPChips from user
        const newBalance = await pipchipsService.debitPIPChips(
          userId,
          costCalc.actualCost,
          'PREDICTION_BET',
          marketId,
          `Bet ${costCalc.actualCost} PIPChips on ${outcome}`,
          {
            marketId,
            outcome,
            shares: costCalc.sharesPurchased.toString(),
            potentialPayout: costCalc.potentialPayout.toString()
          }
        );

        // 5. Update market shares
        const newShares = { ...currentShares };
        newShares[outcome] = newShares[outcome].plus(costCalc.sharesPurchased);

        // 6. Calculate new prices for all outcomes
        const newPrices: Record<string, Decimal> = {};
        for (const o of market.marketOutcomes) {
          newPrices[o] = this.lmsr.calculatePrice(newShares, o);
        }

        // 7. Create participation record
        const participation = await tx.predictionParticipation.create({
          data: {
            userId,
            marketId,
            amount: Number(costCalc.actualCost),
            tokenSymbol: 'PIPCHIPS',
            side: outcome,
            sharesPurchased: costCalc.sharesPurchased.toNumber(),
            potentialPayout: costCalc.potentialPayout.toNumber(),
            purchasePrice: costCalc.newPrice.toNumber()
          }
        });

        // 8. Update market state in database
        const updatedSharesData: Record<string, number> = {};
        for (const [outcome, shares] of Object.entries(newShares)) {
          updatedSharesData[outcome] = shares.toNumber();
        }

        const updatedPricesData: Record<string, number> = {};
        for (const [outcome, price] of Object.entries(newPrices)) {
          updatedPricesData[outcome] = price.toNumber();
        }

        await tx.predictionMarket.update({
          where: { id: marketId },
          data: {
            lmsrShares: updatedSharesData,
            currentPrices: updatedPricesData,
            totalPipchipsVolume: {
              increment: Number(costCalc.actualCost)
            },
            totalBetCount: {
              increment: 1
            }
          }
        });

        return {
          userId,
          marketId,
          outcome,
          pipchipsAmount: costCalc.actualCost,
          sharesPurchased: costCalc.sharesPurchased,
          potentialPayout: costCalc.potentialPayout,
          currentPrice: costCalc.newPrice,
          slippage: costCalc.slippage
        };
      });

      financialLog.success({
        participationId: marketId,
        newBalance: 'calculated',
        shares: result.sharesPurchased.toString()
      });

      logger.info({
        userId,
        marketId,
        outcome,
        amount: result.pipchipsAmount.toString(),
        shares: result.sharesPurchased.toString(),
        payout: result.potentialPayout.toString()
      }, 'PIPChips participation placed successfully');

      return result;

    } catch (error) {
      financialLog.error(error as Error);
      logger.error({ error, userId, marketId, outcome, amount: pipchipsAmount.toString() }, 'Place participation failed');
      throw error;
    }
  }

  /**
   * Resolve market and payout winning bets in PIPChips
   */
  async resolveMarket(
    marketId: string,
    winningOutcome: string,
    adminUserId: string
  ): Promise<{
    marketId: string;
    winningOutcome: string;
    totalPayout: bigint;
    winnersCount: number;
    losersCount: number;
  }> {
    const financialLog = logFinancialOperation(
      'pipchips_market_resolution',
      adminUserId,
      marketId
    );

    try {
      financialLog.start();

      const result = await prisma.$transaction(async (tx) => {
        // 1. Get all participations for this market
        const allParticipations = await tx.predictionParticipation.findMany({
          where: { marketId },
          include: { user: true }
        });

        const winningParticipations = allParticipations.filter(participation => participation.side === winningOutcome);
        const losingParticipations = allParticipations.filter(participation => participation.side !== winningOutcome);

        let totalPayout = BigInt(0);

        // 2. Process winning participations - pay out 1000 PIPChips per share
        for (const participation of winningParticipations) {
          const payout = BigInt(Math.floor(participation.sharesPurchased * 1000));

          await pipchipsService.creditPIPChips(
            participation.userId,
            payout,
            'PREDICTION_WIN',
            marketId,
            `Won ${payout} PIPChips from market resolution`,
            {
              marketId,
              originalParticipation: participation.amount,
              outcome: winningOutcome,
              shares: participation.sharesPurchased
            }
          );

          totalPayout += payout;
        }

        // 3. Log losing participations (no payout, already debited)
        for (const participation of losingParticipations) {
          await pipchipsService.processTransaction({
            userId: participation.userId,
            amount: BigInt(0), // No payout
            type: 'PREDICTION_LOSS',
            referenceId: marketId,
            description: `Lost ${participation.amount} PIPChips from market resolution`,
            metadata: {
              marketId,
              originalParticipation: participation.amount,
              outcome: participation.side,
              shares: participation.sharesPurchased
            }
          });
        }

        // 4. Update market status
        await tx.predictionMarket.update({
          where: { id: marketId },
          data: {
            status: 'RESOLVED',
            winningOutcome,
            resolvedAt: new Date(),
            totalPayout: Number(totalPayout)
          }
        });

        return {
          marketId,
          winningOutcome,
          totalPayout,
          winnersCount: winningParticipations.length,
          losersCount: losingParticipations.length
        };
      });

      financialLog.success({
        winners: result.winnersCount,
        losers: result.losersCount,
        payout: result.totalPayout.toString()
      });

      logger.info({
        marketId,
        winningOutcome,
        totalPayout: result.totalPayout.toString(),
        winnersCount: result.winnersCount,
        losersCount: result.losersCount
      }, 'Market resolved with PIPChips payouts');

      return result;

    } catch (error) {
      financialLog.error(error as Error);
      logger.error({ error, marketId, winningOutcome }, 'Market resolution failed');
      throw error;
    }
  }

  /**
   * Get market depth and pricing information
   */
  getMarketDepth(currentShares: Record<string, Decimal>): Record<string, any> {
    return this.lmsr.getMarketDepth(currentShares);
  }

  /**
   * Calculate all current prices
   */
  calculateAllPrices(currentShares: Record<string, Decimal>) {
    return this.lmsr.calculateAllPrices(currentShares);
  }

  /**
   * Get current price for specific outcome
   */
  getCurrentPrice(currentShares: Record<string, Decimal>, outcome: string): Decimal {
    return this.lmsr.calculatePrice(currentShares, outcome);
  }

  /**
   * Validate market state
   */
  validateMarketState(currentShares: Record<string, Decimal>): boolean {
    return this.lmsr.validateMarketState(currentShares);
  }

  /**
   * Create initial market state for new predictions
   */
  static createInitialMarket(outcomes: string[], liquidityParameter: number = 1000): {
    shares: Record<string, number>;
    prices: Record<string, number>;
  } {
    const shares: Record<string, number> = {};
    const prices: Record<string, number> = {};

    // Start with zero shares and equal probabilities
    const equalPrice = 1 / outcomes.length;

    for (const outcome of outcomes) {
      shares[outcome] = 0;
      prices[outcome] = equalPrice;
    }

    return { shares, prices };
  }
}

// Export singleton instance
export const pipchipsLMSR = new PIPChipsLMSR();

console.log('💰 PIPChips LMSR Market Maker initialized');