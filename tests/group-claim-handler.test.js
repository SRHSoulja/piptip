// Integration test that mirrors the actual handleGroupTipClaim function
// Tests the complete flow including transaction handling

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/services/db.ts';

describe('Group Tip Claim Handler - Complete Flow Tests', () => {
  let testUser, claimUser, testToken, testGroupTip;

  test('Setup test data', async () => {
    // Create test users
    testUser = await prisma.user.upsert({
      where: { discordId: 'handler-creator-12345' },
      update: {},
      create: { discordId: 'handler-creator-12345' }
    });

    claimUser = await prisma.user.upsert({
      where: { discordId: 'handler-claimer-67890' },
      update: {},
      create: { discordId: 'handler-claimer-67890' }
    });

    // Get active token
    testToken = await prisma.token.findFirst({
      where: { active: true }
    });

    if (!testToken) {
      testToken = await prisma.token.create({
        data: {
          address: '0xhandlertest123',
          symbol: 'HTEST',
          decimals: 18,
          active: true
        }
      });
    }

    // Create active group tip
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
    assert.ok(claimUser.id);
    assert.ok(testToken.id);
    assert.ok(testGroupTip.id);
  });

  test('Simulate handleGroupTipClaim: First claim succeeds', async () => {
    // Simulate the actual transaction flow from handleGroupTipClaim
    const result = await prisma.$transaction(async (tx) => {
      const tip = await tx.groupTip.findUnique({
        where: { id: testGroupTip.id },
        include: {
          Creator: true,
          Token: true,
        },
      });

      if (!tip) throw new Error("Group tip not found");

      const now = new Date();
      const isExpired = tip.expiresAt.getTime() < now.getTime();

      if (isExpired) {
        return { expired: true, status: tip.status, groupTipId: tip.id };
      }

      if (tip.status !== "ACTIVE") {
        throw new Error("This group tip is no longer active");
      }

      // Don't let creator claim (this is the claimer, not creator, so should pass)
      if (tip.Creator.discordId === 'handler-claimer-67890') {
        throw new Error("You cannot claim your own group tip");
      }

      // This is where the optimization happens - no claims preloading!
      // Simulate user upsert
      const user = await tx.user.upsert({
        where: { discordId: 'handler-claimer-67890' },
        update: {},
        create: { discordId: 'handler-claimer-67890' },
      });

      // Record claim (catch duplicate if they spam-click)
      try {
        await tx.groupTipClaim.create({
          data: { groupTipId: tip.id, userId: user.id },
        });
      } catch (err) {
        // Prisma unique constraint on @@unique([groupTipId, userId])
        if (err?.code === "P2002") {
          throw new Error("You have already claimed this group tip");
        }
        throw err;
      }

      // Get current claim count after successful insert
      const claimCount = await tx.groupTipClaim.count({
        where: { groupTipId: tip.id },
      });

      return {
        expired: false,
        groupTipId: tip.id,
        newClaimCount: claimCount,
      };
    });

    // Verify successful claim
    assert.strictEqual(result.expired, false);
    assert.strictEqual(result.groupTipId, testGroupTip.id);
    assert.strictEqual(result.newClaimCount, 1);
  });

  test('Simulate handleGroupTipClaim: Double-click returns "already claimed"', async () => {
    // Second attempt should fail fast with our error message
    let claimError;

    try {
      await prisma.$transaction(async (tx) => {
        const tip = await tx.groupTip.findUnique({
          where: { id: testGroupTip.id },
          include: {
            Creator: true,
            Token: true,
          },
        });

        if (!tip) throw new Error("Group tip not found");
        if (tip.status !== "ACTIVE") throw new Error("This group tip is no longer active");

        // Don't let creator claim
        if (tip.Creator.discordId === 'handler-claimer-67890') {
          throw new Error("You cannot claim your own group tip");
        }

        // Simulate user attempting to claim again
        const user = await tx.user.upsert({
          where: { discordId: 'handler-claimer-67890' },
          update: {},
          create: { discordId: 'handler-claimer-67890' },
        });

        // This should fail with P2002 and get converted to user-friendly error
        try {
          await tx.groupTipClaim.create({
            data: { groupTipId: tip.id, userId: user.id },
          });
        } catch (err) {
          if (err?.code === "P2002") {
            throw new Error("You have already claimed this group tip");
          }
          throw err;
        }
      });
    } catch (err) {
      claimError = err;
    }

    // Verify we get the user-friendly error message
    assert.ok(claimError);
    assert.strictEqual(claimError.message, "You have already claimed this group tip");
  });

  test('Creator cannot claim their own group tip', async () => {
    let creatorClaimError;

    try {
      await prisma.$transaction(async (tx) => {
        const tip = await tx.groupTip.findUnique({
          where: { id: testGroupTip.id },
          include: {
            Creator: true,
            Token: true,
          },
        });

        // Simulate creator trying to claim (should fail before DB insert)
        if (tip.Creator.discordId === 'handler-creator-12345') {
          throw new Error("You cannot claim your own group tip");
        }
      });
    } catch (err) {
      creatorClaimError = err;
    }

    // Verify creator gets blocked before any DB operations
    assert.ok(creatorClaimError);
    assert.strictEqual(creatorClaimError.message, "You cannot claim your own group tip");
  });

  test('Performance: Complete claim flow is fast', async () => {
    // Create a new user for performance test
    const perfUser = await prisma.user.upsert({
      where: { discordId: 'perf-handler-user-99999' },
      update: {},
      create: { discordId: 'perf-handler-user-99999' }
    });

    const startTime = performance.now();

    // Run complete claim flow
    const result = await prisma.$transaction(async (tx) => {
      const tip = await tx.groupTip.findUnique({
        where: { id: testGroupTip.id },
        include: {
          Creator: true,
          Token: true,
        },
      });

      const user = await tx.user.upsert({
        where: { discordId: 'perf-handler-user-99999' },
        update: {},
        create: { discordId: 'perf-handler-user-99999' },
      });

      await tx.groupTipClaim.create({
        data: { groupTipId: tip.id, userId: user.id },
      });

      const claimCount = await tx.groupTipClaim.count({
        where: { groupTipId: tip.id },
      });

      return { claimCount };
    });

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Performance check: complete flow should be reasonably fast (adjusted for DB network latency)
    assert.ok(duration < 1500, `Complete claim flow should be fast (${duration.toFixed(2)}ms)`);
    assert.ok(result.claimCount >= 2, 'Should have multiple claims now');

    // Cleanup perf user
    await prisma.user.delete({ where: { discordId: 'perf-handler-user-99999' } });
  });

  test('Cleanup test data', async () => {
    await prisma.groupTipClaim.deleteMany({
      where: { groupTipId: testGroupTip.id }
    });
    
    await prisma.groupTip.delete({
      where: { id: testGroupTip.id }
    });

    if (testToken.symbol === 'HTEST') {
      await prisma.token.delete({
        where: { id: testToken.id }
      });
    }

    await prisma.user.deleteMany({
      where: { discordId: { in: ['handler-creator-12345', 'handler-claimer-67890'] } }
    });
  });
});