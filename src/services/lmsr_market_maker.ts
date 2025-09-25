// src/services/lmsr_market_maker.ts - Logarithmic Market Scoring Rule implementation with numerical stability
import { Decimal } from 'decimal.js';
import { createLogger } from '../utils/logger.js';

// Configure Decimal.js for high precision financial calculations
Decimal.set({
  precision: 50,        // 50 decimal places precision
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -20,        // Use exponential notation below 1e-20
  toExpPos: 30,         // Use exponential notation above 1e30
  minE: -1000,          // Minimum exponent
  maxE: 1000,           // Maximum exponent
});

const logger = createLogger('lmsr-market-maker');

interface MarketState {
  outcomes: string[];
  shares: Record<string, Decimal>;
  liquidity: Decimal;
}

interface PriceCalculation {
  outcome: string;
  price: Decimal;
  confidence: Decimal;
}

interface CostCalculation {
  outcome: string;
  sharesPurchased: Decimal;
  cost: Decimal;
  newPrice: Decimal;
  priceImpact: Decimal;
  slippage: Decimal;
}

export class LMSRMarketMaker {
  private readonly EPSILON = new Decimal('1e-15');
  private readonly MAX_EXPONENT = new Decimal(100);
  private readonly MIN_LIQUIDITY = new Decimal('1');
  private readonly MAX_SHARES = new Decimal('1e12');
  private readonly PRICE_STABILITY_THRESHOLD = new Decimal('1e-10');

  constructor(
    private liquidity: Decimal,
    private outcomes: string[]
  ) {
    if (liquidity.lt(this.MIN_LIQUIDITY)) {
      throw new Error(`Liquidity ${liquidity} below minimum ${this.MIN_LIQUIDITY}`);
    }

    if (outcomes.length < 2) {
      throw new Error('Market must have at least 2 outcomes');
    }

    logger.info({
      liquidity: liquidity.toString(),
      outcomes,
    }, 'LMSR market maker initialized');
  }

  /**
   * Calculate the cost function using LMSR formula: C(q) = b * log(sum(exp(qi/b)))
   * Implements numerical stability techniques to prevent overflow/underflow
   */
  calculateCost(shares: Record<string, Decimal>): Decimal {
    try {
      const b = this.liquidity;

      // Find maximum share quantity for numerical stability
      let maxQ = new Decimal(0);
      for (const outcome of this.outcomes) {
        const q = shares[outcome] || new Decimal(0);
        if (q.gt(maxQ)) maxQ = q;
      }

      // Calculate sum with numerical stability: exp(qi/b - maxQ/b)
      let sum = new Decimal(0);

      for (const outcome of this.outcomes) {
        const q = shares[outcome] || new Decimal(0);
        const scaledDiff = q.sub(maxQ).div(b);

        // Prevent extreme values that could cause overflow
        if (scaledDiff.gt(this.MAX_EXPONENT)) {
          throw new Error(`Share quantity ${outcome}:${q} would cause numerical overflow`);
        }

        if (scaledDiff.lt(this.MAX_EXPONENT.neg())) {
          // Very small values contribute negligibly, skip for performance
          continue;
        }

        const expValue = this.safeExp(scaledDiff);
        sum = sum.plus(expValue);
      }

      if (sum.lte(this.EPSILON)) {
        throw new Error('Numerical instability: sum too small in cost calculation');
      }

      // C = b * (log(sum) + maxQ/b)
      const result = b.times(this.safeLn(sum).plus(maxQ.div(b)));

      logger.debug({
        maxQ: maxQ.toString(),
        sum: sum.toString(),
        cost: result.toString(),
      }, 'Cost calculation completed');

      return result;

    } catch (error) {
      logger.error({ error }, 'LMSR cost calculation failed');
      logger.error({ error, shares }, 'Cost calculation failed');
      throw error;
    }
  }

  /**
   * Calculate the price of a specific outcome: p_i = exp(qi/b) / sum(exp(qj/b))
   */
  calculatePrice(shares: Record<string, Decimal>, outcome: string): Decimal {
    if (!this.outcomes.includes(outcome)) {
      throw new Error(`Unknown outcome: ${outcome}`);
    }

    try {
      const b = this.liquidity;

      // Find maximum for numerical stability
      let maxQ = new Decimal(0);
      for (const o of this.outcomes) {
        const q = shares[o] || new Decimal(0);
        if (q.gt(maxQ)) maxQ = q;
      }

      // Calculate numerator and denominator with stability
      const targetQ = shares[outcome] || new Decimal(0);
      const numeratorExp = targetQ.sub(maxQ).div(b);

      if (numeratorExp.gt(this.MAX_EXPONENT)) {
        logger.warn({ outcome, targetQ: targetQ.toString() }, 'Extreme share quantity detected');
      }

      const numerator = this.safeExp(numeratorExp);
      let denominator = new Decimal(0);

      for (const o of this.outcomes) {
        const q = shares[o] || new Decimal(0);
        const expValue = this.safeExp(q.sub(maxQ).div(b));
        denominator = denominator.plus(expValue);
      }

      if (denominator.lte(this.EPSILON)) {
        logger.warn({ shares, outcome }, 'Denominator near zero in price calculation');
        // Return equal probability as fallback
        return new Decimal(1).div(this.outcomes.length);
      }

      const price = numerator.div(denominator);

      // Sanity check: price should be between 0 and 1
      if (price.lt(0) || price.gt(1)) {
        logger.warn({
          outcome,
          price: price.toString(),
          numerator: numerator.toString(),
          denominator: denominator.toString(),
        }, 'Price outside valid range');

        return price.clamp(this.EPSILON, new Decimal(1).sub(this.EPSILON));
      }

      return price;

    } catch (error) {
      logger.error('lmsr_price_calculation_failed - high priority lmsr error');
      logger.error({ error, outcome, shares }, 'Price calculation failed');
      throw error;
    }
  }

  /**
   * Calculate all outcome prices at once (more efficient)
   */
  calculateAllPrices(shares: Record<string, Decimal>): PriceCalculation[] {
    try {
      const b = this.liquidity;

      // Find maximum for stability
      let maxQ = new Decimal(0);
      for (const outcome of this.outcomes) {
        const q = shares[outcome] || new Decimal(0);
        if (q.gt(maxQ)) maxQ = q;
      }

      // Calculate all exponentials once
      const exponentials: Record<string, Decimal> = {};
      let totalExp = new Decimal(0);

      for (const outcome of this.outcomes) {
        const q = shares[outcome] || new Decimal(0);
        const expValue = this.safeExp(q.sub(maxQ).div(b));
        exponentials[outcome] = expValue;
        totalExp = totalExp.plus(expValue);
      }

      // Calculate prices and confidence scores
      const prices: PriceCalculation[] = [];

      for (const outcome of this.outcomes) {
        const price = exponentials[outcome].div(totalExp);

        // Confidence based on how far price is from 1/n (uniform distribution)
        const uniformPrice = new Decimal(1).div(this.outcomes.length);
        const confidence = price.sub(uniformPrice).abs().div(uniformPrice);

        prices.push({
          outcome,
          price,
          confidence
        });
      }

      // Verify prices sum to 1 (within tolerance)
      const totalPrice = prices.reduce((sum, p) => sum.plus(p.price), new Decimal(0));
      const priceDeviation = totalPrice.sub(1).abs();

      if (priceDeviation.gt(this.EPSILON)) {
        logger.warn({
          totalPrice: totalPrice.toString(),
          deviation: priceDeviation.toString(),
        }, 'Prices do not sum to exactly 1');
      }

      return prices;

    } catch (error) {
      logger.error('lmsr_all_prices_failed - high priority lmsr error');
      logger.error({ error, shares }, 'All prices calculation failed');
      throw error;
    }
  }

  /**
   * Calculate cost to purchase shares of a specific outcome
   */
  calculateBuyCost(
    currentShares: Record<string, Decimal>,
    outcome: string,
    sharesToBuy: Decimal
  ): CostCalculation {
    if (!this.outcomes.includes(outcome)) {
      throw new Error(`Unknown outcome: ${outcome}`);
    }

    if (sharesToBuy.lte(0)) {
      throw new Error('Shares to buy must be positive');
    }

    if (sharesToBuy.gt(this.MAX_SHARES)) {
      throw new Error(`Share quantity ${sharesToBuy} exceeds maximum ${this.MAX_SHARES}`);
    }

    try {
      // Calculate current state
      const oldPrice = this.calculatePrice(currentShares, outcome);
      const oldCost = this.calculateCost(currentShares);

      // Calculate new state after purchase
      const newShares = { ...currentShares };
      const currentAmount = newShares[outcome] || new Decimal(0);
      newShares[outcome] = currentAmount.plus(sharesToBuy);

      const newPrice = this.calculatePrice(newShares, outcome);
      const newCost = this.calculateCost(newShares);

      const totalCost = newCost.sub(oldCost);
      const avgPrice = totalCost.div(sharesToBuy);

      // Calculate price impact and slippage
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
      logger.error('lmsr_buy_cost_failed - high priority lmsr error');
      logger.error({ error, outcome, sharesToBuy: sharesToBuy.toString() }, 'Buy cost calculation failed');
      throw error;
    }
  }

  /**
   * Calculate optimal share amounts for a given budget
   */
  optimizeSharePurchase(
    currentShares: Record<string, Decimal>,
    outcome: string,
    budget: Decimal,
    tolerance: Decimal = new Decimal('0.01')
  ): CostCalculation {
    if (budget.lte(0)) {
      throw new Error('Budget must be positive');
    }

    try {
      // Binary search for optimal share amount
      let low = new Decimal(0);
      let high = budget.times(10); // Conservative upper bound
      let bestResult: CostCalculation | null = null;

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
          // If calculation fails, reduce upper bound
          high = mid;
        }
      }

      if (!bestResult) {
        throw new Error(`Cannot purchase any shares with budget ${budget}`);
      }

      return bestResult;

    } catch (error) {
      logger.error('lmsr_optimize_failed - medium priority lmsr error');
      logger.error({ error, outcome, budget: budget.toString() }, 'Share optimization failed');
      throw error;
    }
  }

  /**
   * Get market depth information for liquidity analysis
   */
  getMarketDepth(currentShares: Record<string, Decimal>): Record<string, any> {
    const depth: Record<string, any> = {};

    for (const outcome of this.outcomes) {
      const currentPrice = this.calculatePrice(currentShares, outcome);
      const orderSizes = [1, 10, 100, 1000, 10000].map(n => new Decimal(n));

      const impacts = orderSizes.map(size => {
        try {
          const result = this.calculateBuyCost(currentShares, outcome, size);
          return {
            shareSize: size.toString(),
            totalCost: result.cost.toString(),
            avgPrice: result.cost.div(size).toString(),
            priceImpact: result.priceImpact.toString(),
            slippage: result.slippage.toString() + '%',
            newPrice: result.newPrice.toString(),
          };
        } catch (error) {
          return {
            shareSize: size.toString(),
            error: 'Calculation failed - order too large',
          };
        }
      });

      depth[outcome] = {
        currentPrice: currentPrice.toString(),
        priceImpacts: impacts,
      };
    }

    return depth;
  }

  /**
   * Validate market state for consistency
   */
  validateMarketState(shares: Record<string, Decimal>): boolean {
    try {
      // Check all outcomes are represented
      for (const outcome of this.outcomes) {
        if (!(outcome in shares)) {
          logger.warn({ outcome }, 'Missing outcome in shares');
          return false;
        }

        const amount = shares[outcome];
        if (amount.isNaN() || !amount.isFinite() || amount.lt(0)) {
          logger.warn({ outcome, amount: amount.toString() }, 'Invalid share amount');
          return false;
        }
      }

      // Check prices sum to approximately 1
      const prices = this.calculateAllPrices(shares);
      const totalPrice = prices.reduce((sum, p) => sum.plus(p.price), new Decimal(0));

      if (totalPrice.sub(1).abs().gt(this.EPSILON)) {
        logger.warn({ totalPrice: totalPrice.toString() }, 'Prices do not sum to 1');
        return false;
      }

      return true;

    } catch (error) {
      logger.error({ error, shares }, 'Market state validation failed');
      return false;
    }
  }

  /**
   * Safe exponential calculation with overflow protection
   */
  private safeExp(x: Decimal): Decimal {
    if (x.gt(this.MAX_EXPONENT)) {
      logger.warn({ x: x.toString() }, 'Exponential input clamped to prevent overflow');
      return Decimal.exp(this.MAX_EXPONENT);
    }

    if (x.lt(this.MAX_EXPONENT.neg())) {
      return new Decimal(0); // Effectively zero
    }

    return Decimal.exp(x);
  }

  /**
   * Safe natural logarithm with underflow protection
   */
  private safeLn(x: Decimal): Decimal {
    if (x.lte(0)) {
      throw new Error(`Cannot take logarithm of non-positive number: ${x}`);
    }

    if (x.lt(this.EPSILON)) {
      logger.warn({ x: x.toString() }, 'Logarithm input near zero');
      return Decimal.ln(this.EPSILON);
    }

    return Decimal.ln(x);
  }

  // Getters for market parameters
  get marketLiquidity(): Decimal {
    return this.liquidity;
  }

  get marketOutcomes(): string[] {
    return [...this.outcomes];
  }
}

console.log('🚀 LMSR Market Maker implementation loaded with numerical stability');