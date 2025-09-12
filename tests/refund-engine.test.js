// tests/refund-engine.test.js - Test centralized refund engine
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { PrismaClient } from '@prisma/client';
import { RefundEngine } from '../src/services/refund_engine.js';

const prisma = new PrismaClient();

describe('Refund Engine', () => {
  let testUsers = [];
  let testToken;

  beforeEach(async () => {
    testToken = await prisma.token.create({
      data: {
        symbol: 'REFUND',
        address: '0x' + Math.random().toString(16).substr(2, 40),
        decimals: 6,
        active: true
      }
    });

    // Create two test users
    for (let i = 0; i < 2; i++) {
      const user = await prisma.user.create({
        data: { discordId: `refund_user_${Date.now()}_${i}` }
      });
      testUsers.push(user);
      
      // Initialize user balance with large starting balance
      await prisma.userBalance.create({
        data: {
          userId: user.id,
          tokenId: testToken.id,
          amount: '1000000000' // 1000 tokens in atomic units (1000 * 10^6)
        }
      });
    }
  });

  afterEach(async () => {
    // Clean up in correct order due to foreign key constraints
    if (testUsers.length > 0) {
      await prisma.transaction.deleteMany({ where: { userId: { in: testUsers.map(u => u.id) } } }).catch(() => {});
    }
    if (testToken && testToken.id) {
      await prisma.tip.deleteMany({ where: { tokenId: testToken.id } }).catch(() => {});
      await prisma.groupTip.deleteMany({ where: { tokenId: testToken.id } }).catch(() => {});
      await prisma.userBalance.deleteMany({ where: { tokenId: testToken.id } }).catch(() => {});
    }
    if (testUsers.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: testUsers.map(u => u.id) } } }).catch(() => {});
    }
    if (testToken && testToken.id) {
      await prisma.token.delete({ where: { id: testToken.id } }).catch(() => {}); // Ignore if already deleted
    }
    testUsers = [];
    testToken = null;
  });

  describe('refundTip', () => {
    test('should refund tip with principal + tax', async () => {
      // Create a completed tip with tax
      const tip = await prisma.tip.create({
        data: {
          fromUserId: testUsers[0].id,
          toUserId: testUsers[1].id,
          tokenId: testToken.id,
          amountAtomic: '100000000', // 100 tokens (6 decimals)
          feeAtomic: '1000000',      // 1 token fee
          taxAtomic: '1000000',      // 1 token tax
          status: 'COMPLETED'
        }
      });

      // Refund the tip
      const result = await RefundEngine.refundTip(tip.id);

      // Verify refund results
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.alreadyRefunded, false);
      assert.strictEqual(result.refundedAmount, 100000000n); // Principal
      assert.strictEqual(result.refundedTax, 1000000n);      // Tax

      // Check tip status was updated
      const refundedTip = await prisma.tip.findUnique({
        where: { id: tip.id }
      });
      assert.strictEqual(refundedTip.status, 'REFUNDED');
      assert(refundedTip.refundedAt instanceof Date);

      // Verify a Transaction record was created
      const transactions = await prisma.transaction.findMany({
        where: { 
          userId: testUsers[0].id,
          type: 'TIP',
          metadata: { contains: 'refund' }
        }
      });
      assert.strictEqual(transactions.length, 1);
    });

    test('should be idempotent - calling twice yields identical state', async () => {
      // Create a tip
      const tip = await prisma.tip.create({
        data: {
          fromUserId: testUsers[0].id,
          toUserId: testUsers[1].id,
          tokenId: testToken.id,
          amountAtomic: '50000000',  // 50 tokens
          feeAtomic: '500000',       // 0.5 tokens
          taxAtomic: '500000',       // 0.5 tokens
          status: 'COMPLETED'
        }
      });

      // First refund
      const result1 = await RefundEngine.refundTip(tip.id);
      
      // Get state after first refund
      const tip1 = await prisma.tip.findUnique({ where: { id: tip.id } });

      // Second refund (should be idempotent)
      const result2 = await RefundEngine.refundTip(tip.id);

      // Get state after second refund
      const tip2 = await prisma.tip.findUnique({ where: { id: tip.id } });

      // First refund should succeed
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result1.alreadyRefunded, false);

      // Second refund should be idempotent
      assert.strictEqual(result2.success, true);
      assert.strictEqual(result2.alreadyRefunded, true);
      assert.strictEqual(result2.refundedAmount, result1.refundedAmount);
      assert.strictEqual(result2.refundedTax, result1.refundedTax);
      
      // Tip status should be identical (both REFUNDED)
      assert.strictEqual(tip1.status, 'REFUNDED');
      assert.strictEqual(tip2.status, 'REFUNDED');
      assert.strictEqual(tip1.refundedAt.getTime(), tip2.refundedAt.getTime());

      // Should only have one transaction record despite two calls
      const transactions = await prisma.transaction.findMany({
        where: { 
          userId: testUsers[0].id,
          type: 'TIP',
          metadata: { contains: 'refund' }
        }
      });
      assert.strictEqual(transactions.length, 1); // Only one refund transaction
    });

    test('should handle non-existent tip gracefully', async () => {
      const result = await RefundEngine.refundTip(99999);
      
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, 'Tip not found');
    });
  });

  describe('refundContribution', () => {
    test('should refund group tip with principal + tax', async () => {
      // Create a group tip
      const groupTip = await prisma.groupTip.create({
        data: {
          creatorId: testUsers[0].id,
          tokenId: testToken.id,
          totalAmount: '200',        // 200 tokens (human-readable format)
          taxAtomic: '2000000',      // 2 tokens tax (atomic format)
          duration: 3600,            // 1 hour
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60000)
        }
      });

      // Refund the contribution
      const result = await RefundEngine.refundContribution(groupTip.id);

      // Verify refund results
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.alreadyRefunded, false);
      assert.strictEqual(result.refundedAmount, 200000000n); // Principal (200 tokens in atomic)
      assert.strictEqual(result.refundedTax, 2000000n);      // Tax (2 tokens in atomic)

      // Check group tip status was updated
      const refundedGroupTip = await prisma.groupTip.findUnique({
        where: { id: groupTip.id }
      });
      assert.strictEqual(refundedGroupTip.status, 'REFUNDED');
      assert(refundedGroupTip.refundedAt instanceof Date);

      // Verify a Transaction record was created
      const transactions = await prisma.transaction.findMany({
        where: { 
          userId: testUsers[0].id,
          type: 'TIP',
          metadata: { contains: 'refund' }
        }
      });
      assert.strictEqual(transactions.length, 1);
    });

    test('should be idempotent for group tip refunds', async () => {
      // Create a group tip
      const groupTip = await prisma.groupTip.create({
        data: {
          creatorId: testUsers[0].id,
          tokenId: testToken.id,
          totalAmount: '75',         // 75 tokens (human-readable format)
          taxAtomic: '750000',       // 0.75 tokens tax (atomic format)
          duration: 1800,            // 30 minutes
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 30000)
        }
      });

      // First refund
      const result1 = await RefundEngine.refundContribution(groupTip.id);
      
      // Get state after first refund
      const groupTip1 = await prisma.groupTip.findUnique({ where: { id: groupTip.id } });

      // Second refund (should be idempotent)
      const result2 = await RefundEngine.refundContribution(groupTip.id);

      // Get state after second refund
      const groupTip2 = await prisma.groupTip.findUnique({ where: { id: groupTip.id } });

      // First refund should succeed
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result1.alreadyRefunded, false);

      // Second refund should be idempotent
      assert.strictEqual(result2.success, true);
      assert.strictEqual(result2.alreadyRefunded, true);
      assert.strictEqual(result2.refundedAmount, result1.refundedAmount);
      assert.strictEqual(result2.refundedTax, result1.refundedTax);
      
      // Group tip status should be identical (both REFUNDED)
      assert.strictEqual(groupTip1.status, 'REFUNDED');
      assert.strictEqual(groupTip2.status, 'REFUNDED');
      assert.strictEqual(groupTip1.refundedAt.getTime(), groupTip2.refundedAt.getTime());

      // Should only have one transaction record despite two calls
      const transactions = await prisma.transaction.findMany({
        where: { 
          userId: testUsers[0].id,
          type: 'TIP',
          metadata: { contains: 'refund' }
        }
      });
      assert.strictEqual(transactions.length, 1); // Only one refund transaction
    });

    test('should handle non-existent group tip gracefully', async () => {
      const result = await RefundEngine.refundContribution(99999);
      
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, 'Group tip not found');
    });
  });

  describe('Transaction Safety', () => {
    test('should handle missing user data gracefully', async () => {
      // Create tip with null fromUserId (invalid state)
      const tip = await prisma.tip.create({
        data: {
          fromUserId: null,
          toUserId: testUsers[1].id,
          tokenId: testToken.id,
          amountAtomic: '10000000',
          taxAtomic: '100000',
          status: 'COMPLETED'
        }
      });

      const result = await RefundEngine.refundTip(tip.id);
      
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, 'Invalid tip data - missing sender or token');
    });

    test('should handle missing token data gracefully', async () => {
      // Create a tip first
      const tip = await prisma.tip.create({
        data: {
          fromUserId: testUsers[0].id,
          toUserId: testUsers[1].id,
          tokenId: testToken.id,
          amountAtomic: '10000000',
          taxAtomic: '100000',
          status: 'COMPLETED'
        }
      });

      // Clean up all related records to avoid foreign key constraints
      await prisma.transaction.deleteMany({ where: { tokenId: testToken.id } });
      await prisma.tip.deleteMany({ where: { tokenId: testToken.id } });
      await prisma.groupTip.deleteMany({ where: { tokenId: testToken.id } });
      await prisma.userBalance.deleteMany({ where: { tokenId: testToken.id } });
      await prisma.token.delete({ where: { id: testToken.id } });
      testToken = null; // Mark as deleted
      
      // Try to refund non-existent tip (should fail gracefully)
      const result = await RefundEngine.refundTip(tip.id);
      
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, 'Tip not found');
    });
  });
});