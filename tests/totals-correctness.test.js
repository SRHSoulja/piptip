// tests/totals-correctness.test.js - Regression tests for proper status filtering
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Totals correctness - exclude failed/refunded items', () => {
  let testUsers = [];
  let testToken;

  beforeEach(async () => {
    // Create test token
    testToken = await prisma.token.create({
      data: {
        symbol: 'TESTCOIN',
        address: '0x' + Math.random().toString(16).substr(2, 40),
        decimals: 6,
        active: true
      }
    });

    // Create test users
    for (let i = 0; i < 3; i++) {
      const user = await prisma.user.create({
        data: { discordId: `test_user_${Date.now()}_${i}` }
      });
      testUsers.push(user);

      // Give users some balance
      await prisma.userBalance.create({
        data: {
          userId: user.id,
          tokenId: testToken.id,
          amount: 1000
        }
      });
    }
  });

  afterEach(async () => {
    // Clean up in correct order (foreign key constraints)
    await prisma.userBalance.deleteMany({
      where: { tokenId: testToken.id }
    });
    await prisma.tip.deleteMany({
      where: { tokenId: testToken.id }
    });
    await prisma.groupTipClaim.deleteMany({});
    await prisma.groupTip.deleteMany({
      where: { tokenId: testToken.id }
    });
    await prisma.user.deleteMany({
      where: { id: { in: testUsers.map(u => u.id) } }
    });
    await prisma.token.delete({
      where: { id: testToken.id }
    });
    testUsers = [];
  });

  test('Direct tips: only COMPLETED tips counted in totals', async () => {
    const [sender, recipient] = testUsers;

    // Create tips with different statuses
    const completedTip = await prisma.tip.create({
      data: {
        fromUserId: sender.id,
        toUserId: recipient.id,
        tokenId: testToken.id,
        amountAtomic: 100,
        status: 'COMPLETED'
      }
    });

    const pendingTip = await prisma.tip.create({
      data: {
        fromUserId: sender.id,
        toUserId: recipient.id,
        tokenId: testToken.id,
        amountAtomic: 100,
        status: 'PENDING'
      }
    });

    const refundedTip = await prisma.tip.create({
      data: {
        fromUserId: sender.id,
        toUserId: recipient.id,
        tokenId: testToken.id,
        amountAtomic: 100,
        status: 'REFUNDED',
        refundedAt: new Date()
      }
    });

    // Test tip counting queries used in stats
    const completedTipCount = await prisma.tip.count({
      where: { status: 'COMPLETED' }
    });

    const sentTipStats = await prisma.tip.groupBy({
      by: ['fromUserId'],
      where: { fromUserId: sender.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    const receivedTipStats = await prisma.tip.groupBy({
      by: ['toUserId'],
      where: { toUserId: recipient.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    // Assertions
    assert.strictEqual(completedTipCount, 1, 'Only COMPLETED tips should be counted');
    assert.strictEqual(sentTipStats.length, 1, 'Only COMPLETED sent tips should be counted');
    assert.strictEqual(sentTipStats[0]._count.id, 1, 'Should count exactly 1 completed sent tip');
    assert.strictEqual(receivedTipStats.length, 1, 'Only COMPLETED received tips should be counted');
    assert.strictEqual(receivedTipStats[0]._count.id, 1, 'Should count exactly 1 completed received tip');

    // Verify all tips exist in database (history shows them)
    const allTips = await prisma.tip.findMany({
      where: {
        OR: [
          { fromUserId: sender.id },
          { toUserId: recipient.id }
        ]
      }
    });
    assert.strictEqual(allTips.length, 3, 'All tips should exist in history');

    // Verify refunded tip is properly marked
    const refundedInDb = allTips.find(t => t.id === refundedTip.id);
    assert.strictEqual(refundedInDb.status, 'REFUNDED', 'Refunded tip should be marked as REFUNDED');
    assert(refundedInDb.refundedAt, 'Refunded tip should have refundedAt timestamp');
  });

  test('Group tips: only CLAIMED claims counted in totals', async () => {
    const [creator, claimer1, claimer2] = testUsers;

    // Create a finalized group tip
    const groupTip = await prisma.groupTip.create({
      data: {
        creatorId: creator.id,
        tokenId: testToken.id,
        totalAmount: 300,
        duration: 1,
        status: 'FINALIZED',
        expiresAt: new Date(Date.now() - 1000) // Already expired
      }
    });

    // Create claims with different statuses
    const claimedClaim = await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip.id,
        userId: claimer1.id,
        status: 'CLAIMED',
        claimedAt: new Date()
      }
    });

    const pendingClaim = await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip.id,
        userId: claimer2.id,
        status: 'PENDING'
      }
    });

    const refundedClaim = await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip.id,
        userId: creator.id, // Different user for variety
        status: 'REFUNDED',
        refundedAt: new Date()
      }
    });

    // Test group tip claim counting queries used in stats
    const claimedCount = await prisma.groupTipClaim.count({
      where: { userId: claimer1.id, status: 'CLAIMED' }
    });

    const claimedStats = await prisma.groupTipClaim.groupBy({
      by: ['userId'],
      where: { userId: claimer1.id, status: 'CLAIMED' },
      _count: { id: true }
    });

    // Test profile query for group tip claims
    const userClaimedStats = await prisma.groupTipClaim.groupBy({
      by: ['groupTipId'],
      where: { userId: claimer1.id, status: 'CLAIMED' },
      _count: { id: true }
    });

    // Assertions
    assert.strictEqual(claimedCount, 1, 'Only CLAIMED group tip claims should be counted');
    assert.strictEqual(claimedStats.length, 1, 'Only users with CLAIMED claims should appear in stats');
    assert.strictEqual(claimedStats[0]._count.id, 1, 'Should count exactly 1 claimed claim');
    assert.strictEqual(userClaimedStats.length, 1, 'Should count 1 group tip with CLAIMED status');

    // Verify all claims exist in database (history shows them)
    const allClaims = await prisma.groupTipClaim.findMany({
      where: { groupTipId: groupTip.id }
    });
    assert.strictEqual(allClaims.length, 3, 'All claims should exist in history');

    // Verify status labels are properly set
    const claimedInDb = allClaims.find(c => c.id === claimedClaim.id);
    const pendingInDb = allClaims.find(c => c.id === pendingClaim.id);
    const refundedInDb = allClaims.find(c => c.id === refundedClaim.id);

    assert.strictEqual(claimedInDb.status, 'CLAIMED', 'Claimed claim should be marked as CLAIMED');
    assert(claimedInDb.claimedAt, 'Claimed claim should have claimedAt timestamp');
    assert.strictEqual(pendingInDb.status, 'PENDING', 'Pending claim should be marked as PENDING');
    assert.strictEqual(refundedInDb.status, 'REFUNDED', 'Refunded claim should be marked as REFUNDED');
    assert(refundedInDb.refundedAt, 'Refunded claim should have refundedAt timestamp');
  });

  test('Group tip creation: all statuses shown in history', async () => {
    const creator = testUsers[0];

    // Create group tips with different statuses
    const activeGroupTip = await prisma.groupTip.create({
      data: {
        creatorId: creator.id,
        tokenId: testToken.id,
        totalAmount: 100,
        duration: 24,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    const finalizedGroupTip = await prisma.groupTip.create({
      data: {
        creatorId: creator.id,
        tokenId: testToken.id,
        totalAmount: 200,
        duration: 1,
        status: 'FINALIZED',
        expiresAt: new Date(Date.now() - 1000)
      }
    });

    const refundedGroupTip = await prisma.groupTip.create({
      data: {
        creatorId: creator.id,
        tokenId: testToken.id,
        totalAmount: 150,
        duration: 1,
        status: 'REFUNDED',
        expiresAt: new Date(Date.now() - 2000),
        refundedAt: new Date()
      }
    });

    // Test stats queries that count completed group tips
    const serverStats = await prisma.groupTip.aggregate({
      where: { 
        creatorId: creator.id,
        status: { in: ['FINALIZED', 'REFUNDED'] } 
      },
      _count: { id: true }
    });

    const createdStats = await prisma.groupTip.groupBy({
      by: ['tokenId'],
      where: { creatorId: creator.id },
      _count: { id: true },
      _sum: { totalAmount: true }
    });

    // Assertions
    assert.strictEqual(serverStats._count.id, 2, 'Only FINALIZED/REFUNDED group tips should be counted in server stats');

    // History should show all group tips with proper status labels
    const allGroupTips = await prisma.groupTip.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: 'desc' }
    });

    assert.strictEqual(allGroupTips.length, 3, 'All group tips should exist in history');
    
    const statuses = allGroupTips.map(gt => gt.status).sort();
    assert.deepStrictEqual(statuses, ['ACTIVE', 'FINALIZED', 'REFUNDED'], 'All status labels should be preserved');

    const refundedInDb = allGroupTips.find(gt => gt.id === refundedGroupTip.id);
    assert(refundedInDb.refundedAt, 'Refunded group tip should have refundedAt timestamp');
  });

  test('Transaction history includes all statuses with proper labels', async () => {
    const [user1, user2] = testUsers;

    // Create some transactions that might be related to tips/refunds
    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user1.id,
        otherUserId: user2.id,
        tokenId: testToken.id,
        amount: 100,
        metadata: 'Direct tip transaction'
      }
    });

    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user2.id, // Refund back to sender
        otherUserId: user1.id,
        tokenId: testToken.id,
        amount: 100,
        metadata: 'Group tip refund - no claims received'
      }
    });

    // Test transaction history queries
    const userTransactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { userId: user1.id },
          { otherUserId: user1.id }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    // Assertions
    assert.strictEqual(userTransactions.length, 2, 'All transactions should appear in history');
    
    // Check metadata contains refund information
    const refundTx = userTransactions.find(tx => tx.metadata?.includes('refund'));
    assert(refundTx, 'Refund transaction should be identifiable by metadata');
    assert(refundTx.metadata.includes('refund'), 'Refund transaction should have refund label in metadata');
  });

  test('Profile statistics exclude failed/refunded items', async () => {
    const [user1, user2] = testUsers;

    // Create completed and refunded tips
    await prisma.tip.create({
      data: {
        fromUserId: user1.id,
        toUserId: user2.id,
        tokenId: testToken.id,
        amountAtomic: 100,
        status: 'COMPLETED'
      }
    });

    await prisma.tip.create({
      data: {
        fromUserId: user1.id,
        toUserId: user2.id,
        tokenId: testToken.id,
        amountAtomic: 150,
        status: 'REFUNDED'
      }
    });

    // Create group tip and claims
    const groupTip = await prisma.groupTip.create({
      data: {
        creatorId: user1.id,
        tokenId: testToken.id,
        totalAmount: 300,
        duration: 1,
        status: 'FINALIZED',
        expiresAt: new Date(Date.now() - 1000)
      }
    });

    await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip.id,
        userId: user2.id,
        status: 'CLAIMED'
      }
    });

    await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip.id,
        userId: user1.id,
        status: 'REFUNDED'
      }
    });

    // Test profile queries (simulate profile.ts logic)
    const tipStatsSent = await prisma.tip.groupBy({
      by: ['tokenId'],
      where: { fromUserId: user1.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    const tipStatsReceived = await prisma.tip.groupBy({
      by: ['tokenId'],
      where: { toUserId: user2.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    const groupTipClaims = await prisma.groupTipClaim.groupBy({
      by: ['groupTipId'],
      where: { userId: user2.id, status: 'CLAIMED' },
      _count: { id: true }
    });

    // Assertions
    assert.strictEqual(tipStatsSent.length, 1, 'Only COMPLETED sent tips should be counted');
    assert.strictEqual(tipStatsSent[0]._count.id, 1, 'Should count 1 completed sent tip, not refunded one');
    assert.strictEqual(Number(tipStatsSent[0]._sum.amountAtomic), 100, 'Should sum only completed tip amount');

    assert.strictEqual(tipStatsReceived.length, 1, 'Only COMPLETED received tips should be counted');
    assert.strictEqual(tipStatsReceived[0]._count.id, 1, 'Should count 1 completed received tip');

    assert.strictEqual(groupTipClaims.length, 1, 'Only CLAIMED group tip claims should be counted');
    assert.strictEqual(groupTipClaims[0]._count.id, 1, 'Should count 1 claimed group tip claim');
  });
});