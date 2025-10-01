import { Decimal } from "decimal.js";
import { LMSRMarketMaker } from "./lmsr_market_maker.js";
import { pipchipsService } from "./pipchips_service.js";
import { prisma } from "./db.js";
import { createLogger, logFinancialOperation } from "../utils/logger.js";
Decimal.set({
  precision: 50,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -20,
  toExpPos: 30,
  minE: -1e3,
  maxE: 1e3
});
const logger = createLogger("pipchips-lmsr");
class PIPChipsLMSR {
  lmsr;
  constructor(liquidityParameter = 1e3, outcomes = ["YES", "NO"]) {
    this.lmsr = new LMSRMarketMaker(new Decimal(liquidityParameter), outcomes);
  }
  /**
   * Calculate cost in PIPChips to buy shares of an outcome
   */
  async calculateBetCost(currentShares, outcome, pipchipsAmount) {
    const financialLog = logFinancialOperation(
      "pipchips_bet_calculation",
      "system",
      pipchipsAmount.toString()
    );
    try {
      financialLog.start();
      const currentPrice = this.lmsr.calculatePrice(currentShares, outcome);
      const targetShares = new Decimal(pipchipsAmount.toString()).div(1e3);
      const costCalculation = this.lmsr.calculateBuyCost(currentShares, outcome, targetShares);
      const actualCostPipchips = costCalculation.cost.times(1e3);
      const actualCostBigint = BigInt(Math.floor(actualCostPipchips.toNumber()));
      const potentialPayout = costCalculation.sharesPurchased.times(1e3);
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
      financialLog.error(error);
      logger.error({ error, outcome, pipchipsAmount: pipchipsAmount.toString() }, "Bet cost calculation failed");
      throw error;
    }
  }
  /**
   * Place a bet using PIPChips and update market state
   */
  async placeBet(userId, marketId, outcome, pipchipsAmount) {
    const financialLog = logFinancialOperation(
      "pipchips_place_bet",
      userId,
      pipchipsAmount.toString()
    );
    try {
      financialLog.start();
      const result = await prisma.$transaction(async (tx) => {
        const market = await tx.predictionMarket.findUnique({
          where: { id: marketId },
          select: {
            id: true,
            lmsrShares: true,
            liquidity: true,
            marketOutcomes: true,
            status: true,
            resolveAt: true
          }
        });
        if (!market) {
          throw new Error(`Market ${marketId} not found`);
        }
        if (market.status !== "ACTIVE") {
          throw new Error(`Market ${marketId} is not active`);
        }
        if (/* @__PURE__ */ new Date() >= market.resolveAt) {
          throw new Error(`Market ${marketId} has expired`);
        }
        const currentShares = {};
        for (const outcome2 of market.marketOutcomes) {
          const shares = market.lmsrShares?.[outcome2] || 0;
          currentShares[outcome2] = new Decimal(shares.toString());
        }
        const costCalc = await this.calculateBetCost(currentShares, outcome, pipchipsAmount);
        const newBalance = await pipchipsService.debitPIPChips(
          userId,
          costCalc.actualCost,
          "PREDICTION_BET",
          marketId,
          `Bet ${costCalc.actualCost} PIPChips on ${outcome}`,
          {
            marketId,
            outcome,
            shares: costCalc.sharesPurchased.toString(),
            potentialPayout: costCalc.potentialPayout.toString()
          }
        );
        const newShares = { ...currentShares };
        newShares[outcome] = newShares[outcome].plus(costCalc.sharesPurchased);
        const newPrices = {};
        for (const o of market.marketOutcomes) {
          newPrices[o] = this.lmsr.calculatePrice(newShares, o);
        }
        const participation = await tx.predictionParticipation.create({
          data: {
            userId,
            marketId,
            amount: Number(costCalc.actualCost),
            tokenSymbol: "PIPCHIPS",
            side: outcome,
            sharesPurchased: costCalc.sharesPurchased
          }
        });
        const updatedSharesData = {};
        for (const [outcome2, shares] of Object.entries(newShares)) {
          updatedSharesData[outcome2] = shares.toNumber();
        }
        const updatedPricesData = {};
        for (const [outcome2, price] of Object.entries(newPrices)) {
          updatedPricesData[outcome2] = price.toNumber();
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
        newBalance: "calculated",
        shares: result.sharesPurchased.toString()
      });
      logger.info({
        userId,
        marketId,
        outcome,
        amount: result.pipchipsAmount.toString(),
        shares: result.sharesPurchased.toString(),
        payout: result.potentialPayout.toString()
      }, "PIPChips participation placed successfully");
      return result;
    } catch (error) {
      financialLog.error(error);
      logger.error({ error, userId, marketId, outcome, amount: pipchipsAmount.toString() }, "Place participation failed");
      throw error;
    }
  }
  /**
   * Resolve market and payout winning bets in PIPChips
   */
  async resolveMarket(marketId, winningOutcome, adminUserId) {
    const financialLog = logFinancialOperation(
      "pipchips_market_resolution",
      adminUserId,
      marketId
    );
    try {
      financialLog.start();
      const result = await prisma.$transaction(async (tx) => {
        const allParticipations = await tx.predictionParticipation.findMany({
          where: { marketId }
        });
        const winningParticipations = allParticipations.filter((participation) => participation.side === winningOutcome);
        const losingParticipations = allParticipations.filter((participation) => participation.side !== winningOutcome);
        let totalPayout = BigInt(0);
        for (const participation of winningParticipations) {
          const sharesPurchased = participation.sharesPurchased || new Decimal(0);
          const payout = BigInt(Math.floor(sharesPurchased.toNumber() * 1e3));
          await pipchipsService.creditPIPChips(
            participation.userId,
            payout,
            "PREDICTION_WIN",
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
        for (const participation of losingParticipations) {
          await pipchipsService.processTransaction({
            userId: participation.userId,
            amount: BigInt(0),
            // No payout
            type: "PREDICTION_LOSS",
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
        await tx.predictionMarket.update({
          where: { id: marketId },
          data: {
            status: "RESOLVED",
            outcome: winningOutcome,
            resolvedAt: /* @__PURE__ */ new Date()
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
      }, "Market resolved with PIPChips payouts");
      return result;
    } catch (error) {
      financialLog.error(error);
      logger.error({ error, marketId, winningOutcome }, "Market resolution failed");
      throw error;
    }
  }
  /**
   * Get market depth and pricing information
   */
  getMarketDepth(currentShares) {
    return this.lmsr.getMarketDepth(currentShares);
  }
  /**
   * Calculate all current prices
   */
  calculateAllPrices(currentShares) {
    return this.lmsr.calculateAllPrices(currentShares);
  }
  /**
   * Get current price for specific outcome
   */
  getCurrentPrice(currentShares, outcome) {
    return this.lmsr.calculatePrice(currentShares, outcome);
  }
  /**
   * Validate market state
   */
  validateMarketState(currentShares) {
    return this.lmsr.validateMarketState(currentShares);
  }
  /**
   * Create initial market state for new predictions
   */
  static createInitialMarket(outcomes, liquidityParameter = 1e3) {
    const shares = {};
    const prices = {};
    const equalPrice = 1 / outcomes.length;
    for (const outcome of outcomes) {
      shares[outcome] = 0;
      prices[outcome] = equalPrice;
    }
    return { shares, prices };
  }
}
const pipchipsLMSR = new PIPChipsLMSR();
console.log("\u{1F4B0} PIPChips LMSR Market Maker initialized");
export {
  PIPChipsLMSR,
  pipchipsLMSR
};
//# sourceMappingURL=pipchips_lmsr.js.map
