// Test for batch group tip expiry refunds
// Tests single transaction handling of 100+ pending contributions

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/services/db.ts';
import { finalizeExpiredGroupTip } from '../src/features/finalizeExpiredGroupTip.ts';

describe('Group Tip Expiry - Batch Refunds Tests', () => {
  let testCreator, testToken, testGroupTip;
  let testUsers = [];

  test('Setup test data with 100+ pending contributions', async () => {
    // Create test creator
    testCreator = await prisma.user.upsert({
      where: { discordId: 'expiry-creator-12345' },
      update: {},
      create: { discordId: 'expiry-creator-12345' }
    });

    // Get or create active token
    testToken = await prisma.token.findFirst({
      where: { active: true }
    });

    if (!testToken) {
      testToken = await prisma.token.create({
        data: {
          address: '0xexpirytest123',
          symbol: 'ETEST',
          decimals: 18,
          active: true
        }
      });
    }

    // Create expired group tip (already expired)
    testGroupTip = await prisma.groupTip.create({
      data: {
        creatorId: testCreator.id,
        tokenId: testToken.id,
        totalAmount: '1000.0',
        duration: 3600,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() - 1000), // Already expired
      }
    });

    // Create 100+ test users with PENDING claims
    for (let i = 0; i < 105; i++) {
      const user = await prisma.user.upsert({
        where: { discordId: `pending-user-${i}` },
        update: {},
        create: { discordId: `pending-user-${i}` }
      });

      // Create PENDING claim (simulates incomplete claim process)
      await prisma.groupTipClaim.create({
        data: {
          groupTipId: testGroupTip.id,
          userId: user.id,
          status: 'PENDING' // These should be refunded
        }
      });

      testUsers.push(user);
    }

    // Create a few CLAIMED users too (should get payouts)
    for (let i = 0; i < 3; i++) {
      const user = await prisma.user.upsert({
        where: { discordId: `claimed-user-${i}` },
        update: {},
        create: { discordId: `claimed-user-${i}` }
      });

      await prisma.groupTipClaim.create({
        data: {
          groupTipId: testGroupTip.id,
          userId: user.id,
          status: 'CLAIMED', // These should get payouts
          claimedAt: new Date()
        }
      });

      testUsers.push(user);
    }

    assert.ok(testCreator.id);
    assert.ok(testToken.id);
    assert.ok(testGroupTip.id);
    assert.strictEqual(testUsers.length, 108); // 105 pending + 3 claimed
  });

  test('Single transaction handles 100+ pending refunds', async () => {
    // Get initial state
    const beforeClaims = await prisma.groupTipClaim.findMany({
      where: { groupTipId: testGroupTip.id },
      include: { User: true }
    });
    
    const pendingCount = beforeClaims.filter(c => c.status === 'PENDING').length;
    const claimedCount = beforeClaims.filter(c => c.status === 'CLAIMED').length;
    
    assert.strictEqual(pendingCount, 105, 'Should have 105 pending claims');
    assert.strictEqual(claimedCount, 3, 'Should have 3 claimed claims');

    // Measure performance of finalization
    const startTime = performance.now();
    
    // Finalize the expired group tip
    const result = await finalizeExpiredGroupTip(testGroupTip.id);
    
    const endTime = performance.now();
    const duration = endTime - startTime;

    // Verify result type
    assert.strictEqual(result.kind, 'FINALIZED', 'Should finalize with payouts for claimed users');
    assert.strictEqual(result.payouts.length, 3, 'Should have payouts for 3 claimed users');

    // Performance check - should be fast since it's batched in single transaction  
    assert.ok(duration < 5000, `Batch finalization should be fast (${duration.toFixed(2)}ms) for 105 refunds + 3 payouts`);

    console.log(`✅ Processed ${pendingCount} pending refunds + ${claimedCount} payouts in ${duration.toFixed(2)}ms`);
  });

  test('Verify all PENDING claims were refunded in batch', async () => {
    // Check that all PENDING claims are now REFUNDED
    const afterClaims = await prisma.groupTipClaim.findMany({
      where: { groupTipId: testGroupTip.id }
    });
    
    const refundedCount = afterClaims.filter(c => c.status === 'REFUNDED').length;
    const claimedCount = afterClaims.filter(c => c.status === 'CLAIMED').length;
    const pendingCount = afterClaims.filter(c => c.status === 'PENDING').length;
    
    assert.strictEqual(refundedCount, 105, 'All 105 pending claims should be marked as REFUNDED');
    assert.strictEqual(claimedCount, 3, 'Claimed users should remain CLAIMED');
    assert.strictEqual(pendingCount, 0, 'No claims should remain PENDING');
    
    // Verify refundedAt is set for refunded claims
    const refundedClaims = afterClaims.filter(c => c.status === 'REFUNDED');
    refundedClaims.forEach(claim => {
      assert.ok(claim.refundedAt, 'Refunded claims should have refundedAt timestamp');
    });
  });

  test('Group tip status updated correctly', async () => {
    // Verify group tip status is FINALIZED
    const finalTip = await prisma.groupTip.findUnique({
      where: { id: testGroupTip.id }
    });
    
    assert.strictEqual(finalTip.status, 'FINALIZED', 'Group tip should be marked as FINALIZED');
  });

  test('Idempotent behavior: re-running does nothing', async () => {
    // Get state before second run
    const beforeSecondRun = await prisma.groupTipClaim.findMany({
      where: { groupTipId: testGroupTip.id }
    });

    // Run finalization again
    const secondResult = await finalizeExpiredGroupTip(testGroupTip.id);

    // Should return NOOP since already finalized
    assert.strictEqual(secondResult.kind, 'NOOP', 'Second run should return NOOP');

    // Verify no changes occurred
    const afterSecondRun = await prisma.groupTipClaim.findMany({
      where: { groupTipId: testGroupTip.id }
    });

    assert.strictEqual(afterSecondRun.length, beforeSecondRun.length);
    
    // Compare each claim's status
    beforeSecondRun.forEach((beforeClaim, idx) => {
      const afterClaim = afterSecondRun.find(ac => ac.id === beforeClaim.id);
      assert.ok(afterClaim, 'Claim should still exist');
      assert.strictEqual(afterClaim.status, beforeClaim.status, 'Status should not change on second run');
    });
  });

  test('Transaction atomicity: all operations succeed or fail together', async () => {
    // Create another group tip to test transaction atomicity
    const atomicTestGroupTip = await prisma.groupTip.create({
      data: {
        creatorId: testCreator.id,
        tokenId: testToken.id,
        totalAmount: '100.0',
        duration: 3600,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() - 1000), // Already expired
      }
    });

    // Create some pending claims
    const atomicUsers = [];
    for (let i = 0; i < 10; i++) {
      const user = await prisma.user.upsert({
        where: { discordId: `atomic-user-${i}` },
        update: {},
        create: { discordId: `atomic-user-${i}` }
      });

      await prisma.groupTipClaim.create({
        data: {
          groupTipId: atomicTestGroupTip.id,
          userId: user.id,
          status: 'PENDING'
        }
      });

      atomicUsers.push(user);
    }

    // Finalize should complete atomically
    const atomicResult = await finalizeExpiredGroupTip(atomicTestGroupTip.id);

    // Either all refunds succeeded, or none did
    const finalClaims = await prisma.groupTipClaim.findMany({
      where: { groupTipId: atomicTestGroupTip.id }
    });

    const refundedInAtomic = finalClaims.filter(c => c.status === 'REFUNDED').length;
    const pendingInAtomic = finalClaims.filter(c => c.status === 'PENDING').length;

    // Should be either all refunded or all still pending (not mixed)
    assert.ok(
      (refundedInAtomic === 10 && pendingInAtomic === 0) || 
      (refundedInAtomic === 0 && pendingInAtomic === 10),
      'Transaction should be atomic - either all refunded or none'
    );

    // Cleanup atomic test data
    await prisma.groupTipClaim.deleteMany({
      where: { groupTipId: atomicTestGroupTip.id }
    });
    await prisma.groupTip.delete({
      where: { id: atomicTestGroupTip.id }
    });
    await prisma.user.deleteMany({
      where: { discordId: { startsWith: 'atomic-user-' } }
    });
  });

  test('Cleanup test data', async () => {
    // Clean up in reverse order to respect foreign keys
    await prisma.groupTipClaim.deleteMany({
      where: { groupTipId: testGroupTip.id }
    });
    
    await prisma.groupTip.delete({
      where: { id: testGroupTip.id }
    });

    // Only delete test token if we created it
    if (testToken.symbol === 'ETEST') {
      await prisma.token.delete({
        where: { id: testToken.id }
      });
    }

    // Delete user balances first, then users
    const userIds = ['expiry-creator-12345']
      .concat(testUsers.slice(0, 105).map((_, i) => `pending-user-${i}`))
      .concat(testUsers.slice(105).map((_, i) => `claimed-user-${i}`));
    
    // Get user IDs to delete their balances
    const usersToDelete = await prisma.user.findMany({
      where: { discordId: { in: userIds } },
      select: { id: true }
    });

    if (usersToDelete.length > 0) {
      await prisma.userBalance.deleteMany({
        where: { userId: { in: usersToDelete.map(u => u.id) } }
      });
    }
    
    await prisma.user.deleteMany({
      where: { discordId: { in: userIds } }
    });
  });
});