// tests/history-labels.test.js - Test that history shows refunded labels correctly
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('History labels for refunded items', () => {
  let testUsers = [];
  let testToken;

  beforeEach(async () => {
    // Create test token
    testToken = await prisma.token.create({
      data: {
        symbol: 'TESTCOIN2',
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

  test('Tips history shows all statuses including REFUNDED', async () => {
    const [sender, recipient] = testUsers;

    // Create tips with different statuses
    await prisma.tip.create({
      data: {
        fromUserId: sender.id,
        toUserId: recipient.id,
        tokenId: testToken.id,
        amountAtomic: 100,
        status: 'COMPLETED',
        note: 'Successful tip'
      }
    });

    await prisma.tip.create({
      data: {
        fromUserId: sender.id,
        toUserId: recipient.id,
        tokenId: testToken.id,
        amountAtomic: 150,
        status: 'REFUNDED',
        refundedAt: new Date(),
        note: 'Failed tip - refunded'
      }
    });

    await prisma.tip.create({
      data: {
        fromUserId: sender.id,
        toUserId: recipient.id,
        tokenId: testToken.id,
        amountAtomic: 75,
        status: 'PENDING',
        note: 'Processing tip'
      }
    });

    // Test the query that would be used in user export/history
    const userTipHistory = await prisma.tip.findMany({
      where: {
        OR: [
          { fromUserId: sender.id },
          { toUserId: recipient.id }
        ]
      },
      include: { Token: true },
      orderBy: { createdAt: 'desc' }
    });

    // Assertions
    assert.strictEqual(userTipHistory.length, 3, 'All tips should appear in history');
    
    const statuses = userTipHistory.map(tip => tip.status).sort();
    assert.deepStrictEqual(statuses, ['COMPLETED', 'PENDING', 'REFUNDED'], 'All status types should be present');

    // Check refunded tip has proper fields
    const refundedTip = userTipHistory.find(tip => tip.status === 'REFUNDED');
    assert(refundedTip, 'Refunded tip should be present in history');
    assert(refundedTip.refundedAt, 'Refunded tip should have refundedAt timestamp');
    assert.strictEqual(refundedTip.note, 'Failed tip - refunded', 'Refunded tip should preserve note');
    assert.strictEqual(Number(refundedTip.amountAtomic), 150, 'Refunded tip should preserve amount');

    // Check completed tip
    const completedTip = userTipHistory.find(tip => tip.status === 'COMPLETED');
    assert(completedTip, 'Completed tip should be present in history');
    assert.strictEqual(completedTip.note, 'Successful tip', 'Completed tip should preserve note');

    // Check pending tip
    const pendingTip = userTipHistory.find(tip => tip.status === 'PENDING');
    assert(pendingTip, 'Pending tip should be present in history');
    assert.strictEqual(pendingTip.note, 'Processing tip', 'Pending tip should preserve note');
  });

  test('Group tip history shows all statuses including REFUNDED', async () => {
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

    const refundedGroupTip = await prisma.groupTip.create({
      data: {
        creatorId: creator.id,
        tokenId: testToken.id,
        totalAmount: 200,
        duration: 1,
        status: 'REFUNDED',
        expiresAt: new Date(Date.now() - 1000),
        refundedAt: new Date()
      }
    });

    const finalizedGroupTip = await prisma.groupTip.create({
      data: {
        creatorId: creator.id,
        tokenId: testToken.id,
        totalAmount: 300,
        duration: 2,
        status: 'FINALIZED',
        expiresAt: new Date(Date.now() - 2000)
      }
    });

    // Test the query that would be used in group tip history/export
    const groupTipHistory = await prisma.groupTip.findMany({
      where: { creatorId: creator.id },
      include: { Token: true },
      orderBy: { createdAt: 'desc' }
    });

    // Assertions
    assert.strictEqual(groupTipHistory.length, 3, 'All group tips should appear in history');
    
    const statuses = groupTipHistory.map(gt => gt.status).sort();
    assert.deepStrictEqual(statuses, ['ACTIVE', 'FINALIZED', 'REFUNDED'], 'All status types should be present');

    // Check refunded group tip has proper fields
    const refundedGT = groupTipHistory.find(gt => gt.status === 'REFUNDED');
    assert(refundedGT, 'Refunded group tip should be present in history');
    assert(refundedGT.refundedAt, 'Refunded group tip should have refundedAt timestamp');
    assert.strictEqual(Number(refundedGT.totalAmount), 200, 'Refunded group tip should preserve amount');

    // Check active group tip
    const activeGT = groupTipHistory.find(gt => gt.status === 'ACTIVE');
    assert(activeGT, 'Active group tip should be present in history');
    assert(!activeGT.refundedAt, 'Active group tip should not have refundedAt');

    // Check finalized group tip
    const finalizedGT = groupTipHistory.find(gt => gt.status === 'FINALIZED');
    assert(finalizedGT, 'Finalized group tip should be present in history');
    assert(!finalizedGT.refundedAt, 'Finalized group tip should not have refundedAt');
  });

  test('Group tip claim history shows all statuses including REFUNDED', async () => {
    const [creator, claimer1, claimer2] = testUsers;

    // Create a group tip
    const groupTip = await prisma.groupTip.create({
      data: {
        creatorId: creator.id,
        tokenId: testToken.id,
        totalAmount: 300,
        duration: 1,
        status: 'FINALIZED',
        expiresAt: new Date(Date.now() - 1000)
      }
    });

    // Create claims with different statuses
    await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip.id,
        userId: claimer1.id,
        status: 'CLAIMED',
        claimedAt: new Date()
      }
    });

    await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip.id,
        userId: claimer2.id,
        status: 'REFUNDED',
        refundedAt: new Date()
      }
    });

    await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip.id,
        userId: creator.id,
        status: 'PENDING'
      }
    });

    // Test the query that would be used in claim history/export
    const claimHistory = await prisma.groupTipClaim.findMany({
      where: { groupTipId: groupTip.id },
      include: { 
        GroupTip: { include: { Token: true } },
        User: true 
      },
      orderBy: { createdAt: 'desc' }
    });

    // Assertions
    assert.strictEqual(claimHistory.length, 3, 'All claims should appear in history');
    
    const statuses = claimHistory.map(claim => claim.status).sort();
    assert.deepStrictEqual(statuses, ['CLAIMED', 'PENDING', 'REFUNDED'], 'All claim status types should be present');

    // Check claimed status
    const claimedClaim = claimHistory.find(claim => claim.status === 'CLAIMED');
    assert(claimedClaim, 'Claimed claim should be present in history');
    assert(claimedClaim.claimedAt, 'Claimed claim should have claimedAt timestamp');
    assert(!claimedClaim.refundedAt, 'Claimed claim should not have refundedAt');

    // Check refunded status
    const refundedClaim = claimHistory.find(claim => claim.status === 'REFUNDED');
    assert(refundedClaim, 'Refunded claim should be present in history');
    assert(refundedClaim.refundedAt, 'Refunded claim should have refundedAt timestamp');
    assert(!refundedClaim.claimedAt, 'Refunded claim should not have claimedAt');

    // Check pending status
    const pendingClaim = claimHistory.find(claim => claim.status === 'PENDING');
    assert(pendingClaim, 'Pending claim should be present in history');
    assert(!pendingClaim.claimedAt, 'Pending claim should not have claimedAt');
    assert(!pendingClaim.refundedAt, 'Pending claim should not have refundedAt');
  });

  test('Transaction history includes refund metadata', async () => {
    const [user1, user2] = testUsers;

    // Create transactions that simulate refund scenarios
    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user1.id,
        otherUserId: user2.id,
        tokenId: testToken.id,
        amount: 100,
        metadata: 'Completed direct tip'
      }
    });

    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user2.id, // Refund back to original sender
        tokenId: testToken.id,
        amount: 150,
        metadata: 'Group tip refunded - no claims received'
      }
    });

    await prisma.transaction.create({
      data: {
        type: 'TIP',
        userId: user1.id,
        tokenId: testToken.id,
        amount: 75,
        metadata: 'Tip refunded - user not found'
      }
    });

    // Test transaction history query
    const transactionHistory = await prisma.transaction.findMany({
      where: {
        OR: [
          { userId: user1.id },
          { userId: user2.id }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    // Assertions
    assert.strictEqual(transactionHistory.length, 3, 'All transactions should appear in history');

    // Check for refund transactions by metadata
    const refundTransactions = transactionHistory.filter(tx => 
      tx.metadata && tx.metadata.toLowerCase().includes('refund')
    );
    assert.strictEqual(refundTransactions.length, 2, 'Should have 2 refund transactions');

    // Verify refund metadata is preserved
    const groupTipRefund = refundTransactions.find(tx => 
      tx.metadata.includes('Group tip refunded')
    );
    assert(groupTipRefund, 'Group tip refund should be identifiable');
    assert.strictEqual(groupTipRefund.metadata, 'Group tip refunded - no claims received', 
      'Group tip refund metadata should be preserved');

    const userRefund = refundTransactions.find(tx => 
      tx.metadata.includes('Tip refunded')
    );
    assert(userRefund, 'Direct tip refund should be identifiable');
    assert.strictEqual(userRefund.metadata, 'Tip refunded - user not found',
      'Direct tip refund metadata should be preserved');

    // Check completed transaction
    const completedTransaction = transactionHistory.find(tx => 
      tx.metadata && tx.metadata.includes('Completed')
    );
    assert(completedTransaction, 'Completed transaction should be present');
    assert.strictEqual(completedTransaction.metadata, 'Completed direct tip',
      'Completed transaction metadata should be preserved');
  });

  test('User export CSV format includes refund status labels', async () => {
    const [user1, user2] = testUsers;

    // Create a refunded tip
    const refundedTip = await prisma.tip.create({
      data: {
        fromUserId: user1.id,
        toUserId: user2.id,
        tokenId: testToken.id,
        amountAtomic: 100,
        status: 'REFUNDED',
        refundedAt: new Date(),
        note: 'Test refunded tip'
      }
    });

    // Create a refunded group tip claim
    const groupTip = await prisma.groupTip.create({
      data: {
        creatorId: user1.id,
        tokenId: testToken.id,
        totalAmount: 200,
        duration: 1,
        status: 'REFUNDED',
        expiresAt: new Date(Date.now() - 1000),
        refundedAt: new Date()
      }
    });

    const refundedClaim = await prisma.groupTipClaim.create({
      data: {
        groupTipId: groupTip.id,
        userId: user2.id,
        status: 'REFUNDED',
        refundedAt: new Date()
      }
    });

    // Simulate the data queries used in transaction export
    const tips = await prisma.tip.findMany({
      where: {
        OR: [{ fromUserId: user1.id }, { toUserId: user1.id }]
      },
      include: { Token: true },
      orderBy: { createdAt: 'desc' }
    });

    const groupTips = {
      created: await prisma.groupTip.findMany({
        where: { creatorId: user1.id },
        include: { Token: true },
        orderBy: { createdAt: 'desc' }
      }),
      claimed: await prisma.groupTipClaim.findMany({
        where: { userId: user1.id },
        include: { GroupTip: { include: { Token: true } } },
        orderBy: { createdAt: 'desc' }
      })
    };

    // Verify the data contains proper status labels (simulating CSV generation)
    assert.strictEqual(tips.length, 1, 'Should have 1 tip');
    assert.strictEqual(tips[0].status, 'REFUNDED', 'Tip status should be REFUNDED');
    assert(tips[0].refundedAt, 'Tip should have refundedAt timestamp');

    assert.strictEqual(groupTips.created.length, 1, 'Should have 1 created group tip');
    assert.strictEqual(groupTips.created[0].status, 'REFUNDED', 'Group tip status should be REFUNDED');
    assert(groupTips.created[0].refundedAt, 'Group tip should have refundedAt timestamp');

    // Test the claimed array for user2 (who had a refunded claim)
    const user2Claims = await prisma.groupTipClaim.findMany({
      where: { userId: user2.id },
      include: { GroupTip: { include: { Token: true } } },
      orderBy: { createdAt: 'desc' }
    });

    assert.strictEqual(user2Claims.length, 1, 'Should have 1 claim');
    assert.strictEqual(user2Claims[0].status, 'REFUNDED', 'Claim status should be REFUNDED');
    assert(user2Claims[0].refundedAt, 'Claim should have refundedAt timestamp');
  });
});