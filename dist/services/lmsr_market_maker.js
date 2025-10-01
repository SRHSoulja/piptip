import { Decimal } from "decimal.js";
import { createLogger } from "../utils/logger.js";
Decimal.set({
  precision: 50,
  // 50 decimal places precision
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -20,
  // Use exponential notation below 1e-20
  toExpPos: 30,
  // Use exponential notation above 1e30
  minE: -1e3,
  // Minimum exponent
  maxE: 1e3
  // Maximum exponent
});
const logger = createLogger("lmsr-market-maker");
class LMSRMarketMaker {
  constructor(liquidity, outcomes) {
    this.liquidity = liquidity;
    this.outcomes = outcomes;
    if (liquidity.lt(this.MIN_LIQUIDITY)) {
      throw new Error(`Liquidity ${liquidity} below minimum ${this.MIN_LIQUIDITY}`);
    }
    if (outcomes.length < 2) {
      throw new Error("Market must have at least 2 outcomes");
    }
    logger.info({
      liquidity: liquidity.toString(),
      outcomes
    }, "LMSR market maker initialized");
  }
  EPSILON = new Decimal("1e-15");
  MAX_EXPONENT = new Decimal(100);
  MIN_LIQUIDITY = new Decimal("1");
  MAX_SHARES = new Decimal("1e12");
  PRICE_STABILITY_THRESHOLD = new Decimal("1e-10");
  /**
   * Calculate the cost function using LMSR formula: C(q) = b * log(sum(exp(qi/b)))
   * Implements numerical stability techniques to prevent overflow/underflow
   */
  calculateCost(shares) {
    try {
      const b = this.liquidity;
      let maxQ = new Decimal(0);
      for (const outcome of this.outcomes) {
        const q = shares[outcome] || new Decimal(0);
        if (q.gt(maxQ)) maxQ = q;
      }
      let sum = new Decimal(0);
      for (const outcome of this.outcomes) {
        const q = shares[outcome] || new Decimal(0);
        const scaledDiff = q.sub(maxQ).div(b);
        if (scaledDiff.gt(this.MAX_EXPONENT)) {
          throw new Error(`Share quantity ${outcome}:${q} would cause numerical overflow`);
        }
        if (scaledDiff.lt(this.MAX_EXPONENT.neg())) {
          continue;
        }
        const expValue = this.safeExp(scaledDiff);
        sum = sum.plus(expValue);
      }
      if (sum.lte(this.EPSILON)) {
        throw new Error("Numerical instability: sum too small in cost calculation");
      }
      const result = b.times(this.safeLn(sum).plus(maxQ.div(b)));
      logger.debug({
        maxQ: maxQ.toString(),
        sum: sum.toString(),
        cost: result.toString()
      }, "Cost calculation completed");
      return result;
    } catch (error) {
      logger.error({ error }, "LMSR cost calculation failed");
      logger.error({ error, shares }, "Cost calculation failed");
      throw error;
    }
  }
  /**
   * Calculate the price of a specific outcome: p_i = exp(qi/b) / sum(exp(qj/b))
   */
  calculatePrice(shares, outcome) {
    if (!this.outcomes.includes(outcome)) {
      throw new Error(`Unknown outcome: ${outcome}`);
    }
    try {
      const b = this.liquidity;
      let maxQ = new Decimal(0);
      for (const o of this.outcomes) {
        const q = shares[o] || new Decimal(0);
        if (q.gt(maxQ)) maxQ = q;
      }
      const targetQ = shares[outcome] || new Decimal(0);
      const numeratorExp = targetQ.sub(maxQ).div(b);
      if (numeratorExp.gt(this.MAX_EXPONENT)) {
        logger.warn({ outcome, targetQ: targetQ.toString() }, "Extreme share quantity detected");
      }
      const numerator = this.safeExp(numeratorExp);
      let denominator = new Decimal(0);
      for (const o of this.outcomes) {
        const q = shares[o] || new Decimal(0);
        const expValue = this.safeExp(q.sub(maxQ).div(b));
        denominator = denominator.plus(expValue);
      }
      if (denominator.lte(this.EPSILON)) {
        logger.warn({ shares, outcome }, "Denominator near zero in price calculation");
        return new Decimal(1).div(this.outcomes.length);
      }
      const price = numerator.div(denominator);
      if (price.lt(0) || price.gt(1)) {
        logger.warn({
          outcome,
          price: price.toString(),
          numerator: numerator.toString(),
          denominator: denominator.toString()
        }, "Price outside valid range");
        return price.clamp(this.EPSILON, new Decimal(1).sub(this.EPSILON));
      }
      return price;
    } catch (error) {
      logger.error("lmsr_price_calculation_failed - high priority lmsr error");
      logger.error({ error, outcome, shares }, "Price calculation failed");
      throw error;
    }
  }
  /**
   * Calculate all outcome prices at once (more efficient)
   */
  calculateAllPrices(shares) {
    try {
      const b = this.liquidity;
      let maxQ = new Decimal(0);
      for (const outcome of this.outcomes) {
        const q = shares[outcome] || new Decimal(0);
        if (q.gt(maxQ)) maxQ = q;
      }
      const exponentials = {};
      let totalExp = new Decimal(0);
      for (const outcome of this.outcomes) {
        const q = shares[outcome] || new Decimal(0);
        const expValue = this.safeExp(q.sub(maxQ).div(b));
        exponentials[outcome] = expValue;
        totalExp = totalExp.plus(expValue);
      }
      const prices = [];
      for (const outcome of this.outcomes) {
        const price = exponentials[outcome].div(totalExp);
        const uniformPrice = new Decimal(1).div(this.outcomes.length);
        const confidence = price.sub(uniformPrice).abs().div(uniformPrice);
        prices.push({
          outcome,
          price,
          confidence
        });
      }
      const totalPrice = prices.reduce((sum, p) => sum.plus(p.price), new Decimal(0));
      const priceDeviation = totalPrice.sub(1).abs();
      if (priceDeviation.gt(this.EPSILON)) {
        logger.warn({
          totalPrice: totalPrice.toString(),
          deviation: priceDeviation.toString()
        }, "Prices do not sum to exactly 1");
      }
      return prices;
    } catch (error) {
      logger.error("lmsr_all_prices_failed - high priority lmsr error");
      logger.error({ error, shares }, "All prices calculation failed");
      throw error;
    }
  }
  /**
   * Calculate cost to purchase shares of a specific outcome
   */
  calculateBuyCost(currentShares, outcome, sharesToBuy) {
    if (!this.outcomes.includes(outcome)) {
      throw new Error(`Unknown outcome: ${outcome}`);
    }
    if (sharesToBuy.lte(0)) {
      throw new Error("Shares to buy must be positive");
    }
    if (sharesToBuy.gt(this.MAX_SHARES)) {
      throw new Error(`Share quantity ${sharesToBuy} exceeds maximum ${this.MAX_SHARES}`);
    }
    try {
      const oldPrice = this.calculatePrice(currentShares, outcome);
      const oldCost = this.calculateCost(currentShares);
      const newShares = { ...currentShares };
      const currentAmount = newShares[outcome] || new Decimal(0);
      newShares[outcome] = currentAmount.plus(sharesToBuy);
      const newPrice = this.calculatePrice(newShares, outcome);
      const newCost = this.calculateCost(newShares);
      const totalCost = newCost.sub(oldCost);
      const avgPrice = totalCost.div(sharesToBuy);
      const priceImpact = newPrice.sub(oldPrice);
      const slippage = avgPrice.sub(oldPrice).div(oldPrice).times(100);
      return {
        outcome,
        sharesPurchased: sharesToBuy,
        cost: totalCost,
        newPrice,
        priceImpact,
        slippage
      };
    } catch (error) {
      logger.error("lmsr_buy_cost_failed - high priority lmsr error");
      logger.error({ error, outcome, sharesToBuy: sharesToBuy.toString() }, "Buy cost calculation failed");
      throw error;
    }
  }
  /**
   * Calculate optimal share amounts for a given budget
   */
  optimizeSharePurchase(currentShares, outcome, budget, tolerance = new Decimal("0.01")) {
    if (budget.lte(0)) {
      throw new Error("Budget must be positive");
    }
    try {
      let low = new Decimal(0);
      let high = budget.times(10);
      let bestResult = null;
      while (high.sub(low).gt(tolerance)) {
        const mid = low.plus(high).div(2);
        try {
          const result = this.calculateBuyCost(currentShares, outcome, mid);
          if (result.cost.lte(budget)) {
            bestResult = result;
            low = mid;
          } else {
            high = mid;
          }
        } catch (error) {
          high = mid;
        }
      }
      if (!bestResult) {
        throw new Error(`Cannot purchase any shares with budget ${budget}`);
      }
      return bestResult;
    } catch (error) {
      logger.error("lmsr_optimize_failed - medium priority lmsr error");
      logger.error({ error, outcome, budget: budget.toString() }, "Share optimization failed");
      throw error;
    }
  }
  /**
   * Get market depth information for liquidity analysis
   */
  getMarketDepth(currentShares) {
    const depth = {};
    for (const outcome of this.outcomes) {
      const currentPrice = this.calculatePrice(currentShares, outcome);
      const orderSizes = [1, 10, 100, 1e3, 1e4].map((n) => new Decimal(n));
      const impacts = orderSizes.map((size) => {
        try {
          const result = this.calculateBuyCost(currentShares, outcome, size);
          return {
            shareSize: size.toString(),
            totalCost: result.cost.toString(),
            avgPrice: result.cost.div(size).toString(),
            priceImpact: result.priceImpact.toString(),
            slippage: result.slippage.toString() + "%",
            newPrice: result.newPrice.toString()
          };
        } catch (error) {
          return {
            shareSize: size.toString(),
            error: "Calculation failed - order too large"
          };
        }
      });
      depth[outcome] = {
        currentPrice: currentPrice.toString(),
        priceImpacts: impacts
      };
    }
    return depth;
  }
  /**
   * Validate market state for consistency
   */
  validateMarketState(shares) {
    try {
      for (const outcome of this.outcomes) {
        if (!(outcome in shares)) {
          logger.warn({ outcome }, "Missing outcome in shares");
          return false;
        }
        const amount = shares[outcome];
        if (amount.isNaN() || !amount.isFinite() || amount.lt(0)) {
          logger.warn({ outcome, amount: amount.toString() }, "Invalid share amount");
          return false;
        }
      }
      const prices = this.calculateAllPrices(shares);
      const totalPrice = prices.reduce((sum, p) => sum.plus(p.price), new Decimal(0));
      if (totalPrice.sub(1).abs().gt(this.EPSILON)) {
        logger.warn({ totalPrice: totalPrice.toString() }, "Prices do not sum to 1");
        return false;
      }
      return true;
    } catch (error) {
      logger.error({ error, shares }, "Market state validation failed");
      return false;
    }
  }
  /**
   * Safe exponential calculation with overflow protection
   */
  safeExp(x) {
    if (x.gt(this.MAX_EXPONENT)) {
      logger.warn({ x: x.toString() }, "Exponential input clamped to prevent overflow");
      return Decimal.exp(this.MAX_EXPONENT);
    }
    if (x.lt(this.MAX_EXPONENT.neg())) {
      return new Decimal(0);
    }
    return Decimal.exp(x);
  }
  /**
   * Safe natural logarithm with underflow protection
   */
  safeLn(x) {
    if (x.lte(0)) {
      throw new Error(`Cannot take logarithm of non-positive number: ${x}`);
    }
    if (x.lt(this.EPSILON)) {
      logger.warn({ x: x.toString() }, "Logarithm input near zero");
      return Decimal.ln(this.EPSILON);
    }
    return Decimal.ln(x);
  }
  // Getters for market parameters
  get marketLiquidity() {
    return this.liquidity;
  }
  get marketOutcomes() {
    return [...this.outcomes];
  }
}
console.log("\u{1F680} LMSR Market Maker implementation loaded with numerical stability");
export {
  LMSRMarketMaker
};
//# sourceMappingURL=lmsr_market_maker.js.map
