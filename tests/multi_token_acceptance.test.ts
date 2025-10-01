// Multi-Token Architecture Acceptance Tests
// Validates deposits, withdrawals, reconciliation across multiple tokens

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { applyDeposit } from '../src/services/deposits.js';
import { getActiveTokens, getTokenBySymbol } from '../src/services/token.js';
import { getLegacyDefaultToken, validateTokenAddressEnv } from '../src/services/legacy_token_fallback.js';

const prisma = new PrismaClient();

describe('Multi-Token Architecture', () => {
  let testTokens: any[] = [];
  let testUsers: any[] = [];

  beforeAll(async () => {
    // Clean up test data
    await prisma.transaction.deleteMany({ where: { metadata: { contains: 'test_' } } });
    await prisma.userBalance.deleteMany({ where: { userId: { in: [9999, 9998, 9997] } } });
    await prisma.user.deleteMany({ where: { id: { in: [9999, 9998, 9997] } } });
    await prisma.token.deleteMany({ where: { symbol: { in: ['TEST_PENGU', 'TEST_ICE', 'TEST_PEBBLE'] } } });
    await prisma.processedDeposit.deleteMany({ where: { key: { contains: 'test_' } } });

    // Create test tokens
    testTokens = await Promise.all([
      prisma.token.create({
        data: {
          address: '0x1111111111111111111111111111111111111111',
          symbol: 'TEST_PENGU',
          decimals: 18,
          minDeposit: '0.1',
          minWithdraw: '0.1',
          active: true
        }
      }),
      prisma.token.create({
        data: {
          address: '0x2222222222222222222222222222222222222222',
          symbol: 'TEST_ICE',
          decimals: 6,
          minDeposit: '1.0',
          minWithdraw: '1.0',
          active: true
        }
      }),
      prisma.token.create({
        data: {
          address: '0x3333333333333333333333333333333333333333',
          symbol: 'TEST_PEBBLE',
          decimals: 8,
          minDeposit: '10.0',
          minWithdraw: '10.0',
          active: true
        }
      })
    ]);

    // Create test users
    testUsers = await Promise.all([
      prisma.user.create({
        data: {
          id: 9999,
          discordId: 'test_user_1',
          agwAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          updatedAt: new Date()
        }
      }),
      prisma.user.create({
        data: {
          id: 9998,
          discordId: 'test_user_2',
          agwAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          updatedAt: new Date()
        }
      }),
      prisma.user.create({
        data: {
          id: 9997,
          discordId: 'test_user_3',
          agwAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
          updatedAt: new Date()
        }
      })
    ]);
  });

  afterAll(async () => {
    // Cleanup
    await prisma.transaction.deleteMany({ where: { metadata: { contains: 'test_' } } });
    await prisma.userBalance.deleteMany({ where: { userId: { in: [9999, 9998, 9997] } } });
    await prisma.user.deleteMany({ where: { id: { in: [9999, 9998, 9997] } } });
    await prisma.token.deleteMany({ where: { symbol: { in: ['TEST_PENGU', 'TEST_ICE', 'TEST_PEBBLE'] } } });
    await prisma.processedDeposit.deleteMany({ where: { key: { contains: 'test_' } } });
    await prisma.$disconnect();
  });

  describe('Token Management', () => {
    it('should fetch all active tokens', async () => {
      const tokens = await getActiveTokens();

      expect(tokens.length).toBeGreaterThanOrEqual(3);

      const testSymbols = tokens.map(t => t.symbol);
      expect(testSymbols).toContain('TEST_PENGU');
      expect(testSymbols).toContain('TEST_ICE');
      expect(testSymbols).toContain('TEST_PEBBLE');
    });

    it('should find tokens by symbol', async () => {
      const pengu = await getTokenBySymbol('TEST_PENGU');
      const ice = await getTokenBySymbol('TEST_ICE');

      expect(pengu).toBeDefined();
      expect(pengu?.symbol).toBe('TEST_PENGU');
      expect(pengu?.decimals).toBe(18);

      expect(ice).toBeDefined();
      expect(ice?.symbol).toBe('TEST_ICE');
      expect(ice?.decimals).toBe(6);
    });

    it('should handle legacy default token fallback', async () => {
      const defaultToken = await getLegacyDefaultToken();
      expect(defaultToken).toBeDefined();
      expect(defaultToken.active).toBe(true);
    });
  });

  describe('Multi-Token Deposits', () => {
    const TREASURY = process.env.TREASURY_AGW_ADDRESS || '0x9999999999999999999999999999999999999999';

    it('should process PENGU deposits with correct decimals', async () => {
      const depositAmount = '5000000000000000000'; // 5 PENGU (18 decimals)

      const result = await applyDeposit({
        from: testUsers[0].agwAddress,
        to: TREASURY,
        token: testTokens[0].address, // TEST_PENGU
        valueAtomic: depositAmount,
        tx: 'test_pengu_deposit_1'
      });

      expect(result.ok).toBe(true);
      expect(result.credited).toBe(true);
      expect(result.token).toBe('TEST_PENGU');
      expect(result.userId).toBe(9999);

      // Verify balance
      const balance = await prisma.userBalance.findUnique({
        where: {
          userId_tokenId: { userId: 9999, tokenId: testTokens[0].id }
        }
      });

      expect(balance).toBeDefined();
      expect(balance!.amount.toString()).toBe('5');
    });

    it('should process ICE deposits with correct decimals', async () => {
      const depositAmount = '5000000'; // 5 ICE (6 decimals)

      const result = await applyDeposit({
        from: testUsers[1].agwAddress,
        to: TREASURY,
        token: testTokens[1].address, // TEST_ICE
        valueAtomic: depositAmount,
        tx: 'test_ice_deposit_1'
      });

      expect(result.ok).toBe(true);
      expect(result.credited).toBe(true);
      expect(result.token).toBe('TEST_ICE');
      expect(result.userId).toBe(9998);

      // Verify balance
      const balance = await prisma.userBalance.findUnique({
        where: {
          userId_tokenId: { userId: 9998, tokenId: testTokens[1].id }
        }
      });

      expect(balance).toBeDefined();
      expect(balance!.amount.toString()).toBe('5');
    });

    it('should process PEBBLE deposits with correct decimals', async () => {
      const depositAmount = '5000000000'; // 50 PEBBLE (8 decimals)

      const result = await applyDeposit({
        from: testUsers[2].agwAddress,
        to: TREASURY,
        token: testTokens[2].address, // TEST_PEBBLE
        valueAtomic: depositAmount,
        tx: 'test_pebble_deposit_1'
      });

      expect(result.ok).toBe(true);
      expect(result.credited).toBe(true);
      expect(result.token).toBe('TEST_PEBBLE');
      expect(result.userId).toBe(9997);

      // Verify balance
      const balance = await prisma.userBalance.findUnique({
        where: {
          userId_tokenId: { userId: 9997, tokenId: testTokens[2].id }
        }
      });

      expect(balance).toBeDefined();
      expect(balance!.amount.toString()).toBe('50');
    });

    it('should reject deposits below minimum', async () => {
      const smallAmount = '50000000000000000'; // 0.05 PENGU (below 0.1 minimum)

      const result = await applyDeposit({
        from: testUsers[0].agwAddress,
        to: TREASURY,
        token: testTokens[0].address,
        valueAtomic: smallAmount,
        tx: 'test_small_deposit'
      });

      expect(result.ok).toBe(true);
      expect(result.skipped).toContain('below minimum');
    });

    it('should prevent duplicate deposits', async () => {
      const depositAmount = '1000000000000000000'; // 1 PENGU

      // First deposit
      const result1 = await applyDeposit({
        from: testUsers[0].agwAddress,
        to: TREASURY,
        token: testTokens[0].address,
        valueAtomic: depositAmount,
        tx: 'test_duplicate_deposit'
      });

      expect(result1.ok).toBe(true);
      expect(result1.credited).toBe(true);

      // Duplicate deposit
      const result2 = await applyDeposit({
        from: testUsers[0].agwAddress,
        to: TREASURY,
        token: testTokens[0].address,
        valueAtomic: depositAmount,
        tx: 'test_duplicate_deposit'
      });

      expect(result2.ok).toBe(true);
      expect(result2.duplicate).toBe(true);
    });

    it('should ignore deposits from unlinked wallets', async () => {
      const result = await applyDeposit({
        from: '0xdddddddddddddddddddddddddddddddddddddddd', // Unlinked wallet
        to: TREASURY,
        token: testTokens[0].address,
        valueAtomic: '1000000000000000000',
        tx: 'test_unlinked_deposit'
      });

      expect(result.ok).toBe(true);
      expect(result.ignored).toBe('wallet not linked');
    });

    it('should reject inactive tokens', async () => {
      // Create inactive token
      const inactiveToken = await prisma.token.create({
        data: {
          address: '0x4444444444444444444444444444444444444444',
          symbol: 'INACTIVE',
          decimals: 18,
          minDeposit: '1.0',
          minWithdraw: '1.0',
          active: false
        }
      });

      const result = await applyDeposit({
        from: testUsers[0].agwAddress,
        to: TREASURY,
        token: inactiveToken.address,
        valueAtomic: '1000000000000000000',
        tx: 'test_inactive_token'
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('token not active/known');

      // Cleanup
      await prisma.token.delete({ where: { id: inactiveToken.id } });
    });
  });

  describe('Transaction Logging', () => {
    it('should log all deposits with correct tokenId', async () => {
      const transactions = await prisma.transaction.findMany({
        where: {
          type: 'DEPOSIT',
          userId: { in: [9999, 9998, 9997] }
        },
        include: {
          user: true,
          token: true
        }
      });

      expect(transactions.length).toBeGreaterThanOrEqual(3);

      // Check PENGU transaction
      const penguTx = transactions.find(t => t.token?.symbol === 'TEST_PENGU');
      expect(penguTx).toBeDefined();
      expect(penguTx!.userId).toBe(9999);
      expect(penguTx!.tokenId).toBe(testTokens[0].id);

      // Check ICE transaction
      const iceTx = transactions.find(t => t.token?.symbol === 'TEST_ICE');
      expect(iceTx).toBeDefined();
      expect(iceTx!.userId).toBe(9998);
      expect(iceTx!.tokenId).toBe(testTokens[1].id);

      // Check PEBBLE transaction
      const pebbleTx = transactions.find(t => t.token?.symbol === 'TEST_PEBBLE');
      expect(pebbleTx).toBeDefined();
      expect(pebbleTx!.userId).toBe(9997);
      expect(pebbleTx!.tokenId).toBe(testTokens[2].id);
    });
  });

  describe('Balance Reconciliation', () => {
    it('should accurately track balances per token per user', async () => {
      // Get all test user balances
      const balances = await prisma.userBalance.findMany({
        where: {
          userId: { in: [9999, 9998, 9997] }
        },
        include: {
          user: true,
          token: true
        }
      });

      expect(balances.length).toBeGreaterThanOrEqual(3);

      // Verify each user has correct token balances
      const user1Balances = balances.filter(b => b.userId === 9999);
      const user2Balances = balances.filter(b => b.userId === 9998);
      const user3Balances = balances.filter(b => b.userId === 9997);

      expect(user1Balances.length).toBeGreaterThanOrEqual(1); // PENGU
      expect(user2Balances.length).toBeGreaterThanOrEqual(1); // ICE
      expect(user3Balances.length).toBeGreaterThanOrEqual(1); // PEBBLE

      // Verify balance amounts are correctly stored in human units
      const penguBalance = user1Balances.find(b => b.token?.symbol === 'TEST_PENGU');
      expect(Number(penguBalance?.amount)).toBeGreaterThan(0);

      const iceBalance = user2Balances.find(b => b.token?.symbol === 'TEST_ICE');
      expect(Number(iceBalance?.amount)).toBeGreaterThan(0);

      const pebbleBalance = user3Balances.find(b => b.token?.symbol === 'TEST_PEBBLE');
      expect(Number(pebbleBalance?.amount)).toBeGreaterThan(0);
    });

    it('should sum all user liabilities by token', async () => {
      // This simulates what reconciliation would do
      const liabilities = await prisma.$queryRaw<any[]>`
        SELECT
          t.symbol,
          t.address,
          COALESCE(SUM(ub.amount::numeric), 0) as total_user_liabilities
        FROM "Token" t
        LEFT JOIN "UserBalance" ub ON t.id = ub."tokenId"
        WHERE t.symbol IN ('TEST_PENGU', 'TEST_ICE', 'TEST_PEBBLE')
        GROUP BY t.id, t.symbol, t.address
        ORDER BY t.symbol
      `;

      expect(liabilities.length).toBe(3);

      const penguLiability = liabilities.find(l => l.symbol === 'TEST_PENGU');
      const iceLiability = liabilities.find(l => l.symbol === 'TEST_ICE');
      const pebbleLiability = liabilities.find(l => l.symbol === 'TEST_PEBBLE');

      expect(Number(penguLiability?.total_user_liabilities)).toBeGreaterThan(0);
      expect(Number(iceLiability?.total_user_liabilities)).toBeGreaterThan(0);
      expect(Number(pebbleLiability?.total_user_liabilities)).toBeGreaterThan(0);
    });
  });

  describe('Legacy Token Address Migration', () => {
    it('should validate TOKEN_ADDRESS environment variable', async () => {
      const validation = await validateTokenAddressEnv();

      // Should either be valid (matches active token) or have recommendations
      if (validation.valid) {
        expect(validation.configured).toBeDefined();
        expect(validation.message).toContain('matches active token');
      } else {
        expect(validation.recommended).toBeDefined();
        expect(validation.message).toBeDefined();
      }
    });

    it('should provide fallback when TOKEN_ADDRESS not set', async () => {
      // Temporarily remove TOKEN_ADDRESS
      const original = process.env.TOKEN_ADDRESS;
      delete process.env.TOKEN_ADDRESS;

      const validation = await validateTokenAddressEnv();
      expect(validation.valid).toBe(false);
      expect(validation.message).toContain('not configured');
      expect(validation.recommended).toBeDefined();

      // Restore
      if (original) process.env.TOKEN_ADDRESS = original;
    });
  });

  describe('Multi-Token Flow Integration', () => {
    it('should handle complete multi-token deposit flow', async () => {
      const TREASURY = process.env.TREASURY_AGW_ADDRESS || '0x9999999999999999999999999999999999999999';

      // Simulate multi-token deposits from same user
      const deposits = [
        { token: testTokens[0], amount: '2000000000000000000', symbol: 'TEST_PENGU' }, // 2 PENGU
        { token: testTokens[1], amount: '3000000', symbol: 'TEST_ICE' },               // 3 ICE
        { token: testTokens[2], amount: '1500000000', symbol: 'TEST_PEBBLE' }          // 15 PEBBLE
      ];

      const results = [];

      for (const [index, deposit] of deposits.entries()) {
        const result = await applyDeposit({
          from: testUsers[0].agwAddress, // Same user for all tokens
          to: TREASURY,
          token: deposit.token.address,
          valueAtomic: deposit.amount,
          tx: `test_multi_deposit_${index + 1}`
        });

        results.push(result);
        expect(result.ok).toBe(true);
        expect(result.credited).toBe(true);
        expect(result.token).toBe(deposit.symbol);
      }

      // Verify user now has balances in all three tokens
      const userBalances = await prisma.userBalance.findMany({
        where: { userId: 9999 },
        include: { token: true }
      });

      const tokenSymbols = userBalances.map(b => b.token?.symbol);
      expect(tokenSymbols).toContain('TEST_PENGU');
      expect(tokenSymbols).toContain('TEST_ICE');
      expect(tokenSymbols).toContain('TEST_PEBBLE');

      // Verify total transaction count
      const userTransactions = await prisma.transaction.findMany({
        where: { userId: 9999, type: 'DEPOSIT' }
      });

      expect(userTransactions.length).toBeGreaterThanOrEqual(4); // Previous + 3 new
    });
  });
});

describe('Migration Strategy Validation', () => {
  it('should work without TOKEN_ADDRESS environment variable', async () => {
    // This test validates that the system can operate without TOKEN_ADDRESS
    const tokens = await getActiveTokens();
    expect(tokens.length).toBeGreaterThan(0);

    const defaultToken = await getLegacyDefaultToken();
    expect(defaultToken).toBeDefined();
    expect(defaultToken.active).toBe(true);
  });

  it('should maintain backward compatibility for legacy code', async () => {
    // Verify legacy token export still works (even if undefined)
    const { TOKEN_ADDRESS } = await import('../src/services/token.js');
    // Should not throw error, TOKEN_ADDRESS can be undefined now
    expect(typeof TOKEN_ADDRESS === 'string' || TOKEN_ADDRESS === undefined).toBe(true);
  });
});