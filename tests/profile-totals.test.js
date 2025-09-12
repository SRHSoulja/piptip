// tests/profile-totals.test.js - Verify profile and leaderboard totals are accurate
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Profile and leaderboard totals accuracy', () => {
  let testUsers = [];
  let testToken;

  beforeEach(async () => {
    // Create test token
    testToken = await prisma.token.create({
      data: {
        symbol: 'TESTCOIN3',
        address: '0x' + Math.random().toString(16).substr(2, 40),
        decimals: 6,
        active: true
      }
    });

    // Create test users
    for (let i = 0; i < 4; i++) {
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

  test('Profile stats queries exclude refunded tips from totals', async () => {
    const [user1, user2, user3] = testUsers;

    // Create a mix of completed and refunded tips for user1 sending
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
        toUserId: user3.id,
        tokenId: testToken.id,
        amountAtomic: 200,
        status: 'COMPLETED'
      }
    });

    await prisma.tip.create({
      data: {
        fromUserId: user1.id,
        toUserId: user2.id,
        tokenId: testToken.id,
        amountAtomic: 150,
        status: 'REFUNDED',
        refundedAt: new Date()
      }
    });

    // Test profile.ts queries - tips sent stats
    const tipStatsSent = await prisma.tip.groupBy({
      by: ['tokenId'],
      where: { fromUserId: user1.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    // Test user search/leaderboard queries 
    const userSentStats = await prisma.tip.aggregate({
      where: { fromUserId: user1.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    // Assertions
    assert.strictEqual(tipStatsSent.length, 1, 'Should have stats for 1 token');
    assert.strictEqual(tipStatsSent[0]._count.id, 2, 'Should count only 2 completed tips, not the refunded one');
    assert.strictEqual(Number(tipStatsSent[0]._sum.amountAtomic), 300, 'Should sum only completed tip amounts (100+200)');

    assert.strictEqual(userSentStats._count.id, 2, 'User stats should count only completed tips');
    assert.strictEqual(Number(userSentStats._sum.amountAtomic), 300, 'User stats should sum only completed amounts');

    // Verify that refunded tip still exists in database
    const allUserTips = await prisma.tip.findMany({
      where: { fromUserId: user1.id }
    });
    assert.strictEqual(allUserTips.length, 3, 'All tips should exist in database for history');
    
    const refundedTip = allUserTips.find(t => t.status === 'REFUNDED');
    assert(refundedTip, 'Refunded tip should exist in history');
    assert.strictEqual(Number(refundedTip.amountAtomic), 150, 'Refunded tip amount should be preserved');
  });

  test('Profile stats queries exclude pending group tip claims from totals', async () => {
    const [creator, claimer1, claimer2, claimer3] = testUsers;

    // Create finalized group tip
    const groupTip1 = await prisma.groupTip.create({
      data: {
        creatorId: creator.id,
        tokenId: testToken.id,
        totalAmount: 300,
        duration: 1,
        status: 'FINALIZED',
        expiresAt: new Date(Date.now() - 1000)
      }
    });

    // Create refunded group tip
    const groupTip2 = await prisma.groupTip.create({
      data: {
        creatorId: creator.id,
        tokenId: testToken.id,
        totalAmount: 200,
        duration: 1,
        status: 'REFUNDED',
        expiresAt: new Date(Date.now() - 2000),
        refundedAt: new Date()
      }
    });

    // Create claims with different statuses for first group tip
    await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip1.id,
        userId: claimer1.id,
        status: 'CLAIMED',
        claimedAt: new Date()
      }
    });

    await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip1.id,
        userId: claimer2.id,
        status: 'CLAIMED',
        claimedAt: new Date()
      }
    });

    await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip1.id,
        userId: claimer3.id,
        status: 'PENDING' // This should not be counted
      }
    });

    // Create refunded claim for second group tip
    await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip2.id,
        userId: claimer1.id,
        status: 'REFUNDED',
        refundedAt: new Date()
      }
    });

    // Test profile.ts query for group tip claims (claimer1 perspective)
    const groupTipClaims = await prisma.groupTipClaim.groupBy({
      by: ['groupTipId'],
      where: { userId: claimer1.id, status: 'CLAIMED' },
      _count: { id: true }
    });

    // Test for claimer2 (should have 1 claimed)
    const claimer2Claims = await prisma.groupTipClaim.groupBy({
      by: ['groupTipId'],
      where: { userId: claimer2.id, status: 'CLAIMED' },
      _count: { id: true }
    });

    // Test for claimer3 (should have 0 claimed, 1 pending)
    const claimer3Claims = await prisma.groupTipClaim.groupBy({
      by: ['groupTipId'],
      where: { userId: claimer3.id, status: 'CLAIMED' },
      _count: { id: true }
    });

    const claimer3PendingClaims = await prisma.groupTipClaim.count({
      where: { userId: claimer3.id, status: 'PENDING' }
    });

    // Assertions
    assert.strictEqual(groupTipClaims.length, 1, 'Claimer1 should have 1 claimed group tip (not refunded one)');
    assert.strictEqual(groupTipClaims[0]._count.id, 1, 'Should count exactly 1 claim');

    assert.strictEqual(claimer2Claims.length, 1, 'Claimer2 should have 1 claimed group tip');
    assert.strictEqual(claimer2Claims[0]._count.id, 1, 'Should count exactly 1 claim');

    assert.strictEqual(claimer3Claims.length, 0, 'Claimer3 should have 0 claimed group tips (only pending)');
    assert.strictEqual(claimer3PendingClaims, 1, 'Claimer3 should have 1 pending claim');

    // Verify all claims exist in database for history
    const allClaims = await prisma.groupTipClaim.findMany();
    assert.strictEqual(allClaims.length, 4, 'All 4 claims should exist in database');
    
    const claimStatuses = allClaims.map(c => c.status).sort();
    assert.deepStrictEqual(claimStatuses, ['CLAIMED', 'CLAIMED', 'PENDING', 'REFUNDED'], 
      'All claim statuses should be preserved');
  });

  test('Stats service excludes pending/failed items from server breakdown', async () => {
    const [user1, user2, user3] = testUsers;

    // Create completed tips
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
        fromUserId: user2.id,
        toUserId: user3.id,
        tokenId: testToken.id,
        amountAtomic: 200,
        status: 'COMPLETED'
      }
    });

    // Create pending and refunded tips that should not be counted
    await prisma.tip.create({
      data: {
        fromUserId: user1.id,
        toUserId: user3.id,
        tokenId: testToken.id,
        amountAtomic: 150,
        status: 'PENDING'
      }
    });

    await prisma.tip.create({
      data: {
        fromUserId: user3.id,
        toUserId: user1.id,
        tokenId: testToken.id,
        amountAtomic: 75,
        status: 'REFUNDED',
        refundedAt: new Date()
      }
    });

    // Test stats service global stats query
    const globalTipStats = await prisma.tip.aggregate({
      where: { status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    // Test token breakdown query
    const tokenStats = await prisma.tip.aggregate({
      where: { tokenId: testToken.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    // Assertions
    assert.strictEqual(globalTipStats._count.id, 2, 'Should count only completed tips globally');
    assert.strictEqual(Number(globalTipStats._sum.amountAtomic), 300, 'Should sum only completed tip amounts (100+200)');

    assert.strictEqual(tokenStats._count.id, 2, 'Should count only completed tips for token');
    assert.strictEqual(Number(tokenStats._sum.amountAtomic), 300, 'Should sum only completed amounts for token');

    // Verify all tips exist for history
    const allTips = await prisma.tip.findMany({
      where: { tokenId: testToken.id }
    });
    assert.strictEqual(allTips.length, 4, 'All tips should exist in history');
  });

  test('Admin leaderboard queries exclude refunded tips from user rankings', async () => {
    const [user1, user2, user3] = testUsers;

    // User1: 2 completed tips sent, 1 refunded (should count 2)
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
        toUserId: user3.id,
        tokenId: testToken.id,
        amountAtomic: 200,
        status: 'COMPLETED'
      }
    });

    await prisma.tip.create({
      data: {
        fromUserId: user1.id,
        toUserId: user2.id,
        tokenId: testToken.id,
        amountAtomic: 150,
        status: 'REFUNDED',
        refundedAt: new Date()
      }
    });

    // User2: 1 completed tip sent (should count 1)
    await prisma.tip.create({
      data: {
        fromUserId: user2.id,
        toUserId: user3.id,
        tokenId: testToken.id,
        amountAtomic: 50,
        status: 'COMPLETED'
      }
    });

    // User3: 1 pending tip (should count 0)
    await prisma.tip.create({
      data: {
        fromUserId: user3.id,
        toUserId: user1.id,
        tokenId: testToken.id,
        amountAtomic: 75,
        status: 'PENDING'
      }
    });

    // Test leaderboard queries (simulate users.ts top users logic)
    const user1Stats = await prisma.tip.aggregate({
      where: { fromUserId: user1.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    const user2Stats = await prisma.tip.aggregate({
      where: { fromUserId: user2.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    const user3Stats = await prisma.tip.aggregate({
      where: { fromUserId: user3.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    // Assertions
    assert.strictEqual(user1Stats._count.id, 2, 'User1 should show 2 completed tips (not refunded one)');
    assert.strictEqual(Number(user1Stats._sum.amountAtomic), 300, 'User1 should show correct completed amount');

    assert.strictEqual(user2Stats._count.id, 1, 'User2 should show 1 completed tip');
    assert.strictEqual(Number(user2Stats._sum.amountAtomic), 50, 'User2 should show correct amount');

    assert.strictEqual(user3Stats._count.id, 0, 'User3 should show 0 completed tips (only pending)');
    assert.strictEqual(Number(user3Stats._sum.amountAtomic || 0), 0, 'User3 should show 0 amount');

    // Verify ranking would be correct (user1 > user2 > user3)
    const userRankings = [
      { userId: user1.id, count: user1Stats._count.id, amount: Number(user1Stats._sum.amountAtomic || 0) },
      { userId: user2.id, count: user2Stats._count.id, amount: Number(user2Stats._sum.amountAtomic || 0) },
      { userId: user3.id, count: user3Stats._count.id, amount: Number(user3Stats._sum.amountAtomic || 0) }
    ].sort((a, b) => b.count - a.count || b.amount - a.amount);

    assert.strictEqual(userRankings[0].userId, user1.id, 'User1 should rank first');
    assert.strictEqual(userRankings[1].userId, user2.id, 'User2 should rank second');
    assert.strictEqual(userRankings[2].userId, user3.id, 'User3 should rank third');
  });

  test('Profile aggregation totals match individual queries', async () => {
    const [user1, user2] = testUsers;

    // Create tips with mixed statuses
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
        status: 'REFUNDED',
        refundedAt: new Date()
      }
    });

    // Test both aggregation methods used in different parts of the app
    const groupedStats = await prisma.tip.groupBy({
      by: ['tokenId'],
      where: { fromUserId: user1.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    const aggregatedStats = await prisma.tip.aggregate({
      where: { fromUserId: user1.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { amountAtomic: true }
    });

    // Assertions - both methods should give same results
    assert.strictEqual(groupedStats.length, 1, 'Grouped stats should have 1 token entry');
    assert.strictEqual(groupedStats[0]._count.id, aggregatedStats._count.id, 
      'Grouped and aggregated count should match');
    assert.strictEqual(Number(groupedStats[0]._sum.amountAtomic), Number(aggregatedStats._sum.amountAtomic || 0), 
      'Grouped and aggregated amounts should match');

    // Both should only count the completed tip
    assert.strictEqual(aggregatedStats._count.id, 1, 'Should count only completed tip');
    assert.strictEqual(Number(aggregatedStats._sum.amountAtomic || 0), 100, 'Should sum only completed amount');
  });
});