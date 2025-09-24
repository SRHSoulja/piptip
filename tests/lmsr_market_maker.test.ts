// tests/lmsr_market_maker.test.ts - Comprehensive tests for LMSR Market Maker
import { describe, test, expect, beforeEach } from '@jest/globals';
import Decimal from 'decimal.js';
import { LMSRMarketMaker } from '../src/services/lmsr_market_maker.js';

describe('LMSR Market Maker', () => {
  let lmsr: LMSRMarketMaker;

  beforeEach(() => {
    lmsr = new LMSRMarketMaker(
      new Decimal(100), // liquidity parameter
      ['YES', 'NO']
    );
  });

  describe('Initialization', () => {
    test('should initialize with valid parameters', () => {
      expect(lmsr.marketLiquidity.toString()).toBe('100');
      expect(lmsr.marketOutcomes).toEqual(['YES', 'NO']);
    });

    test('should reject insufficient liquidity', () => {
      expect(() => new LMSRMarketMaker(new Decimal('0.5'), ['YES', 'NO']))
        .toThrow('Liquidity 0.5 below minimum');
    });

    test('should reject insufficient outcomes', () => {
      expect(() => new LMSRMarketMaker(new Decimal(100), ['YES']))
        .toThrow('Market must have at least 2 outcomes');
    });
  });

  describe('Price Calculations', () => {
    test('initial prices should be equal and sum to 1', () => {
      const shares = { YES: new Decimal(0), NO: new Decimal(0) };
      const yesPrice = lmsr.calculatePrice(shares, 'YES');
      const noPrice = lmsr.calculatePrice(shares, 'NO');

      expect(yesPrice.toNumber()).toBeCloseTo(0.5, 10);
      expect(noPrice.toNumber()).toBeCloseTo(0.5, 10);
      expect(yesPrice.plus(noPrice).toNumber()).toBeCloseTo(1, 10);
    });

    test('prices should sum to 1 with unequal shares', () => {
      const shares = { YES: new Decimal(50), NO: new Decimal(30) };
      const prices = lmsr.calculateAllPrices(shares);

      const totalPrice = prices.reduce((sum, p) => sum.plus(p.price), new Decimal(0));
      expect(totalPrice.toNumber()).toBeCloseTo(1, 10);
    });

    test('price should increase with more shares', () => {
      const shares1 = { YES: new Decimal(0), NO: new Decimal(0) };
      const shares2 = { YES: new Decimal(100), NO: new Decimal(0) };

      const price1 = lmsr.calculatePrice(shares1, 'YES');
      const price2 = lmsr.calculatePrice(shares2, 'YES');

      expect(price2.gt(price1)).toBe(true);
      expect(price2.toNumber()).toBeGreaterThan(0.9); // Should be heavily favored
    });

    test('should handle extreme share values', () => {
      const shares = { YES: new Decimal('1000000'), NO: new Decimal(0) };

      expect(() => lmsr.calculatePrice(shares, 'YES')).not.toThrow();

      const price = lmsr.calculatePrice(shares, 'YES');
      expect(price.toNumber()).toBeGreaterThan(0.99);
    });

    test('should reject invalid outcome', () => {
      const shares = { YES: new Decimal(0), NO: new Decimal(0) };

      expect(() => lmsr.calculatePrice(shares, 'INVALID'))
        .toThrow('Unknown outcome: INVALID');
    });
  });

  describe('Cost Calculations', () => {
    test('should calculate increasing marginal cost', () => {
      const shares = { YES: new Decimal(0), NO: new Decimal(0) };

      const cost1 = lmsr.calculateBuyCost(shares, 'YES', new Decimal(10));
      const cost2 = lmsr.calculateBuyCost(shares, 'YES', new Decimal(20));

      // Cost for 20 shares should be more than double the cost for 10 shares
      expect(cost2.cost.gt(cost1.cost.times(2))).toBe(true);
    });

    test('should show price impact for large orders', () => {
      const shares = { YES: new Decimal(0), NO: new Decimal(0) };

      const smallOrder = lmsr.calculateBuyCost(shares, 'YES', new Decimal(1));
      const largeOrder = lmsr.calculateBuyCost(shares, 'YES', new Decimal(100));

      expect(largeOrder.priceImpact.gt(smallOrder.priceImpact)).toBe(true);
      expect(largeOrder.slippage.gt(smallOrder.slippage)).toBe(true);
    });

    test('should reject invalid purchase amounts', () => {
      const shares = { YES: new Decimal(0), NO: new Decimal(0) };

      expect(() => lmsr.calculateBuyCost(shares, 'YES', new Decimal(-1)))
        .toThrow('Shares to buy must be positive');

      expect(() => lmsr.calculateBuyCost(shares, 'YES', new Decimal('1e15')))
        .toThrow('exceeds maximum');
    });
  });

  describe('Market Depth Analysis', () => {
    test('should provide depth information for all outcomes', () => {
      const shares = { YES: new Decimal(10), NO: new Decimal(5) };
      const depth = lmsr.getMarketDepth(shares);

      expect(depth).toHaveProperty('YES');
      expect(depth).toHaveProperty('NO');
      expect(depth.YES).toHaveProperty('currentPrice');
      expect(depth.YES).toHaveProperty('priceImpacts');
      expect(Array.isArray(depth.YES.priceImpacts)).toBe(true);
    });

    test('should show increasing price impact for larger orders', () => {
      const shares = { YES: new Decimal(0), NO: new Decimal(0) };
      const depth = lmsr.getMarketDepth(shares);

      const impacts = depth.YES.priceImpacts;
      const smallImpact = parseFloat(impacts[0].slippage);
      const largeImpact = parseFloat(impacts[impacts.length - 1].slippage);

      expect(largeImpact).toBeGreaterThan(smallImpact);
    });
  });

  describe('Budget Optimization', () => {
    test('should find optimal share purchase for budget', () => {
      const shares = { YES: new Decimal(0), NO: new Decimal(0) };
      const budget = new Decimal(50);

      const result = lmsr.optimizeSharePurchase(shares, 'YES', budget);

      expect(result.cost.lte(budget)).toBe(true);
      expect(result.sharesPurchased.gt(0)).toBe(true);
    });

    test('should respect budget constraints', () => {
      const shares = { YES: new Decimal(0), NO: new Decimal(0) };
      const smallBudget = new Decimal(1);

      const result = lmsr.optimizeSharePurchase(shares, 'YES', smallBudget);

      expect(result.cost.lte(smallBudget)).toBe(true);
    });

    test('should reject negative or zero budgets', () => {
      const shares = { YES: new Decimal(0), NO: new Decimal(0) };

      expect(() => lmsr.optimizeSharePurchase(shares, 'YES', new Decimal(-1)))
        .toThrow('Budget must be positive');

      expect(() => lmsr.optimizeSharePurchase(shares, 'YES', new Decimal(0)))
        .toThrow('Budget must be positive');
    });
  });

  describe('Market State Validation', () => {
    test('should validate correct market states', () => {
      const validShares = { YES: new Decimal(50), NO: new Decimal(30) };

      expect(lmsr.validateMarketState(validShares)).toBe(true);
    });

    test('should reject invalid share amounts', () => {
      const negativeShares = { YES: new Decimal(-10), NO: new Decimal(30) };
      const nanShares = { YES: new Decimal(NaN), NO: new Decimal(30) };

      expect(lmsr.validateMarketState(negativeShares)).toBe(false);
      expect(lmsr.validateMarketState(nanShares)).toBe(false);
    });

    test('should reject missing outcomes', () => {
      const incompleteShares = { YES: new Decimal(50) }; // Missing NO

      expect(lmsr.validateMarketState(incompleteShares)).toBe(false);
    });
  });

  describe('Multi-Outcome Markets', () => {
    let multiLmsr: LMSRMarketMaker;

    beforeEach(() => {
      multiLmsr = new LMSRMarketMaker(
        new Decimal(200),
        ['OPTION_A', 'OPTION_B', 'OPTION_C']
      );
    });

    test('should handle three outcome markets', () => {
      const shares = {
        OPTION_A: new Decimal(10),
        OPTION_B: new Decimal(20),
        OPTION_C: new Decimal(5)
      };

      const prices = multiLmsr.calculateAllPrices(shares);
      expect(prices).toHaveLength(3);

      const totalPrice = prices.reduce((sum, p) => sum.plus(p.price), new Decimal(0));
      expect(totalPrice.toNumber()).toBeCloseTo(1, 10);
    });

    test('should maintain price consistency across outcomes', () => {
      const shares = {
        OPTION_A: new Decimal(0),
        OPTION_B: new Decimal(0),
        OPTION_C: new Decimal(0)
      };

      const prices = multiLmsr.calculateAllPrices(shares);

      // All prices should be equal initially
      const expectedPrice = 1 / 3;
      prices.forEach(p => {
        expect(p.price.toNumber()).toBeCloseTo(expectedPrice, 10);
      });
    });
  });

  describe('Numerical Stability', () => {
    test('should handle very large share amounts', () => {
      const shares = {
        YES: new Decimal('1e10'),
        NO: new Decimal('1e9')
      };

      expect(() => lmsr.calculateAllPrices(shares)).not.toThrow();

      const prices = lmsr.calculateAllPrices(shares);
      const totalPrice = prices.reduce((sum, p) => sum.plus(p.price), new Decimal(0));
      expect(totalPrice.toNumber()).toBeCloseTo(1, 5); // Slightly less precision for extreme values
    });

    test('should handle very small differences in shares', () => {
      const shares = {
        YES: new Decimal('1000000.000000001'),
        NO: new Decimal('1000000')
      };

      expect(() => lmsr.calculateAllPrices(shares)).not.toThrow();

      const yesPrice = lmsr.calculatePrice(shares, 'YES');
      const noPrice = lmsr.calculatePrice(shares, 'NO');

      expect(yesPrice.gt(noPrice)).toBe(true);
      expect(yesPrice.plus(noPrice).toNumber()).toBeCloseTo(1, 10);
    });

    test('should handle mixed large and small values', () => {
      const shares = {
        YES: new Decimal('1e8'),
        NO: new Decimal('0.001')
      };

      expect(() => lmsr.calculateAllPrices(shares)).not.toThrow();

      const prices = lmsr.calculateAllPrices(shares);
      expect(prices[0].price.toNumber()).toBeGreaterThan(0.99);
      expect(prices[1].price.toNumber()).toBeLessThan(0.01);
    });
  });

  describe('Error Handling', () => {
    test('should provide meaningful error messages', () => {
      const shares = { YES: new Decimal(0), NO: new Decimal(0) };

      expect(() => lmsr.calculatePrice(shares, 'INVALID'))
        .toThrow('Unknown outcome: INVALID');

      expect(() => lmsr.calculateBuyCost(shares, 'YES', new Decimal(0)))
        .toThrow('Shares to buy must be positive');
    });

    test('should handle corrupted state gracefully', () => {
      const corruptedShares = {
        YES: new Decimal(Infinity),
        NO: new Decimal(0)
      };

      // Should not crash, but should detect invalid state
      expect(lmsr.validateMarketState(corruptedShares)).toBe(false);
    });
  });

  describe('Performance', () => {
    test('should handle batch price calculations efficiently', () => {
      const shares = { YES: new Decimal(100), NO: new Decimal(50) };

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        lmsr.calculateAllPrices(shares);
      }
      const duration = Date.now() - start;

      // Should complete 1000 calculations in reasonable time
      expect(duration).toBeLessThan(5000); // 5 seconds max
    });

    test('should handle repeated buy cost calculations', () => {
      const shares = { YES: new Decimal(50), NO: new Decimal(25) };

      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        lmsr.calculateBuyCost(shares, 'YES', new Decimal(10));
      }
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(2000); // 2 seconds max
    });
  });
});

console.log('🧪 LMSR Market Maker tests loaded');