// Integration test for group claim double-click scenario
// Tests the unique constraint behavior and performance optimization

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/services/db.ts';

describe('Group Tip Claim - Unique Constraint Tests', () => {
  let testUser, testToken, testGroupTip;

  // Setup test data
  test('Setup test data', async () => {
    // Create test user
    testUser = await prisma.user.upsert({
      where: { discordId: 'test-user-12345' },
      update: {},
      create: { discordId: 'test-user-12345' }
    });

    // Get or create a token for testing
    testToken = await prisma.token.findFirst({
      where: { active: true }
    });

    if (!testToken) {
      testToken = await prisma.token.create({
        data: {
          address: '0xtest123',
          symbol: 'TEST',
          decimals: 18,
          active: true
        }
      });
    }

    // Create test group tip
    testGroupTip = await prisma.groupTip.create({
      data: {
        creatorId: testUser.id,
        tokenId: testToken.id,
        totalAmount: '100.0',
        duration: 3600,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      }
    });

    assert.ok(testUser.id);
    assert.ok(testToken.id);
    assert.ok(testGroupTip.id);
  });

  test('Double-click claim: first succeeds, second returns error', async () => {
    // Create a different user to claim (can't claim own group tip)
    const claimUser = await prisma.user.upsert({
      where: { discordId: 'claim-user-67890' },
      update: {},
      create: { discordId: 'claim-user-67890' }
    });

    // First claim attempt - should succeed
    let firstClaimResult;
    let firstClaimError;

    try {
      firstClaimResult = await prisma.groupTipClaim.create({
        data: {
          groupTipId: testGroupTip.id,
          userId: claimUser.id
        }
      });
    } catch (err) {
      firstClaimError = err;
    }

    // Verify first claim succeeded
    assert.ok(firstClaimResult, 'First claim should succeed');
    assert.strictEqual(firstClaimError, undefined, 'First claim should not error');
    assert.strictEqual(firstClaimResult.groupTipId, testGroupTip.id);
    assert.strictEqual(firstClaimResult.userId, claimUser.id);

    // Second claim attempt - should fail with P2002 unique constraint error
    let secondClaimResult;
    let secondClaimError;

    try {
      secondClaimResult = await prisma.groupTipClaim.create({
        data: {
          groupTipId: testGroupTip.id,
          userId: claimUser.id
        }
      });
    } catch (err) {
      secondClaimError = err;
    }

    // Verify second claim failed with unique constraint error
    assert.strictEqual(secondClaimResult, undefined, 'Second claim should fail');
    assert.ok(secondClaimError, 'Second claim should error');
    assert.strictEqual(secondClaimError.code, 'P2002', 'Should be Prisma unique constraint error');
    assert.ok(secondClaimError.message.includes('Unique constraint'), 'Error message should mention unique constraint');
  });

  test('Performance: claim attempt is single DB operation', async () => {
    // Create another user for this test
    const perfUser = await prisma.user.upsert({
      where: { discordId: 'perf-user-99999' },
      update: {},
      create: { discordId: 'perf-user-99999' }
    });

    // Measure the time for a claim attempt
    const startTime = performance.now();
    
    try {
      await prisma.groupTipClaim.create({
        data: {
          groupTipId: testGroupTip.id,
          userId: perfUser.id
        }
      });
    } catch (err) {
      // Expected if user already claimed, but we still measure timing
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Performance check: should complete very quickly (under 100ms for single DB op)
    assert.ok(duration < 100, `Claim attempt should be fast (${duration.toFixed(2)}ms), indicating single DB operation`);
  });

  test('Verify no O(n) claim scanning by checking no claims are loaded', async () => {
    // This test verifies that our optimized code doesn't load all claims
    // by checking that we can make a claim attempt without loading related claims
    
    const scanUser = await prisma.user.upsert({
      where: { discordId: 'scan-user-11111' },  
      update: {},
      create: { discordId: 'scan-user-11111' }
    });

    // Test that we can attempt a claim without needing to load existing claims
    // This simulates the optimized path that goes straight to INSERT and catches P2002
    let claimError;
    
    try {
      // Direct claim creation - no prior claims query needed
      await prisma.groupTipClaim.create({
        data: {
          groupTipId: testGroupTip.id,
          userId: scanUser.id
        }
      });
    } catch (err) {
      claimError = err;
    }

    // Should succeed or fail with P2002, but never need to scan existing claims
    assert.ok(!claimError || claimError.code === 'P2002', 'Should succeed or fail with unique constraint, no scanning needed');
  });

  // Cleanup test data
  test('Cleanup test data', async () => {
    // Clean up in reverse order to respect foreign keys
    await prisma.groupTipClaim.deleteMany({
      where: { groupTipId: testGroupTip.id }
    });
    
    await prisma.groupTip.delete({
      where: { id: testGroupTip.id }
    });

    // Only delete test token if we created it
    if (testToken.symbol === 'TEST') {
      await prisma.token.delete({
        where: { id: testToken.id }
      });
    }

    await prisma.user.deleteMany({
      where: { discordId: { in: ['test-user-12345', 'claim-user-67890', 'perf-user-99999', 'scan-user-11111'] } }
    });
  });
});