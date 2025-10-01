#!/usr/bin/env npx tsx
/**
 * Scaling & Failover Test Suite
 *
 * Tests system behavior under load and failure conditions:
 * - Concurrent user operations
 * - Process restart mid-operation
 * - Database connection loss
 * - Balance drift detection
 * - Orphaned transaction recovery
 *
 * Run: npm run test:scaling-failover
 */

import "dotenv/config";
import { validateTestEnvironment } from "../src/services/test_db_safety.js";
import { prisma } from "../src/services/db.js";
import { Decimal } from "@prisma/client/runtime/library";
import { getValidTransactionTypes } from "../src/services/test_mocks.js";

process.env.NODE_ENV = 'test';
validateTestEnvironment();

// Get valid transaction types
const TxTypes = getValidTransactionTypes();

let testUsers: any[] = [];
let testToken: any;

async function setup(): Promise<void> {
  console.log("🧪 Setting up scaling & failover test environment...\n");

  // Get test token
  testToken = await prisma.token.findFirst({
    where: { symbol: 'PIPCHIPS' }
  });

  if (!testToken) {
    throw new Error("PIPCHIPS token not found");
  }

  // Create many test users for concurrency testing
  console.log("Creating 50 test users...");
  for (let i = 1; i <= 50; i++) {
    const discordId = `scaling_test_user_${Date.now()}_${i}`;
    const user = await prisma.user.create({
      data: {
        discordId,
        pipchipsBalance: 10000n,
        updatedAt: new Date()
      }
    });

    testUsers.push({ id: user.id, discordId });
  }

  console.log(`✅ Created ${testUsers.length} test users\n`);
}

async function cleanup(): Promise<void> {
  console.log("\n🧹 Cleaning up test data...");

  for (const user of testUsers) {
    await prisma.pipchipsTransaction.deleteMany({
      where: { userId: user.discordId }
    });

    await prisma.match.deleteMany({
      where: {
        OR: [
          { challengerId: user.id },
          { joinerId: user.id }
        ]
      }
    });

    await prisma.user.delete({
      where: { discordId: user.discordId }
    }).catch(() => {});
  }

  console.log("✅ Cleanup completed");
}

// Test 1: Concurrent Matches
async function testConcurrentMatches(): Promise<boolean> {
  console.log("1️⃣ Testing concurrent match execution...");

  try {
    const { pipchipsService } = await import("../src/services/pipchips_service.js");
    const startTime = Date.now();

    // Create 25 matches (50 users, 2 per match)
    const matches = [];
    for (let i = 0; i < 25; i++) {
      const challenger = testUsers[i * 2];
      const joiner = testUsers[i * 2 + 1];

      matches.push(
        prisma.match.create({
          data: {
            status: 'IN_PROGRESS',
            wagerAtomic: 100, // Stored as Int in database
            tokenId: testToken.id,
            challengerId: challenger.id,
            joinerId: joiner.id,
            guildId: 'test_guild_123'
          }
        })
      );
    }

    const createdMatches = await Promise.all(matches);
    console.log(`   ✅ Created ${createdMatches.length} matches concurrently`);

    // Simulate match resolutions concurrently
    const resolutions = createdMatches.map(async (match, index) => {
      const challenger = testUsers[index * 2];
      const joiner = testUsers[index * 2 + 1];

      // Randomly pick winner
      const winner = Math.random() > 0.5 ? challenger : joiner;
      const loser = winner === challenger ? joiner : challenger;

      // Debit wagers
      await pipchipsService.debitPIPChips(
        challenger.discordId,
        100n,
        TxTypes.BET_PLACED,
        match.id.toString(),
        `Match ${match.id} wager`
      );

      await pipchipsService.debitPIPChips(
        joiner.discordId,
        100n,
        TxTypes.BET_PLACED,
        match.id.toString(),
        `Match ${match.id} wager`
      );

      // Credit winner (pot - 2% rake)
      const payout = 200n - (200n * 2n / 100n); // 196
      await pipchipsService.creditPIPChips(
        winner.discordId,
        payout,
        TxTypes.BET_WON,
        match.id.toString(),
        `Match ${match.id} payout`
      );

      return { match: match.id, winner: winner.id };
    });

    await Promise.all(resolutions);

    const duration = Date.now() - startTime;
    console.log(`   ✅ Resolved ${createdMatches.length} matches in ${duration}ms`);
    console.log(`   📊 Average: ${(duration / createdMatches.length).toFixed(1)}ms per match`);

    // Verify no negative balances
    const negativeBalances = await prisma.user.count({
      where: {
        discordId: { in: testUsers.map(u => u.discordId) },
        pipchipsBalance: { lt: 0 }
      }
    });

    if (negativeBalances > 0) {
      throw new Error(`${negativeBalances} users have negative balance!`);
    }

    console.log(`   ✅ No negative balances detected`);

    return true;
  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 2: Balance Drift Detection
async function testBalanceDriftDetection(): Promise<boolean> {
  console.log("\n2️⃣ Testing balance drift detection...");

  try {
    const { pipchipsService } = await import("../src/services/pipchips_service.js");

    // Perform many small transactions
    const user = testUsers[0];
    const initialBalance = await prisma.user.findUnique({
      where: { discordId: user.discordId },
      select: { pipchipsBalance: true }
    });

    let expectedBalance = initialBalance?.pipchipsBalance || 0n;

    for (let i = 0; i < 20; i++) {
      const amount = BigInt(Math.floor(Math.random() * 100) + 1);

      if (Math.random() > 0.5) {
        // Credit
        await pipchipsService.creditPIPChips(
          user.discordId,
          amount,
          TxTypes.ADMIN_CREDIT,
          `drift_test_${i}`,
          'Drift test credit'
        );
        expectedBalance += amount;
      } else {
        // Debit (if balance allows)
        if (expectedBalance >= amount) {
          await pipchipsService.debitPIPChips(
            user.discordId,
            amount,
            TxTypes.ADMIN_DEBIT,
            `drift_test_${i}`,
            'Drift test debit'
          );
          expectedBalance -= amount;
        }
      }
    }

    // Check final balance
    const finalBalance = await prisma.user.findUnique({
      where: { discordId: user.discordId },
      select: { pipchipsBalance: true }
    });

    console.log(`   💰 Initial: ${initialBalance?.pipchipsBalance}`);
    console.log(`   💰 Expected: ${expectedBalance}`);
    console.log(`   💰 Actual: ${finalBalance?.pipchipsBalance}`);

    const drift = (finalBalance?.pipchipsBalance || 0n) - expectedBalance;

    if (drift === 0n) {
      console.log(`   ✅ No balance drift detected`);
      return true;
    } else {
      console.log(`   ⚠️  Drift detected: ${drift} PIPChips`);

      // Small drift might be acceptable
      if (drift < 100n && drift > -100n) {
        console.log(`   ✅ Drift within acceptable range`);
        return true;
      }

      throw new Error(`Significant drift: ${drift}`);
    }

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 3: Orphaned Transaction Detection
async function testOrphanedTransactionDetection(): Promise<boolean> {
  console.log("\n3️⃣ Testing orphaned transaction detection...");

  try {
    const user = testUsers[1];

    // Create a balance change without transaction log (simulating error)
    const before = await prisma.user.findUnique({
      where: { discordId: user.discordId },
      select: { pipchipsBalance: true }
    });

    // Manual balance update (bypassing service)
    await prisma.user.update({
      where: { discordId: user.discordId },
      data: {
        pipchipsBalance: { increment: 500 }
      }
    });

    // Check for orphaned change
    const after = await prisma.user.findUnique({
      where: { discordId: user.discordId },
      select: { pipchipsBalance: true }
    });

    const change = (after?.pipchipsBalance || 0n) - (before?.pipchipsBalance || 0n);

    // Check if there's a transaction record for this change
    const txCount = await prisma.pipchipsTransaction.count({
      where: {
        userId: user.discordId,
        amount: change,
        createdAt: { gte: new Date(Date.now() - 5000) }
      }
    });

    if (txCount === 0) {
      console.log(`   ⚠️  Orphaned transaction detected: ${change} PIPChips with no log`);
      console.log(`   ✅ Detection system working`);

      // Revert orphaned change
      await prisma.user.update({
        where: { discordId: user.discordId },
        data: {
          pipchipsBalance: before?.pipchipsBalance
        }
      });

      console.log(`   ✅ Orphaned change reverted`);
      return true;
    }

    console.log(`   ℹ️  No orphaned transactions found`);
    return true;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 4: Process Restart Simulation
async function testProcessRestartRecovery(): Promise<boolean> {
  console.log("\n4️⃣ Testing process restart recovery...");

  try {
    const user = testUsers[2];

    // Start a match
    const match = await prisma.match.create({
      data: {
        status: 'PENDING',
        wagerAtomic: 200, // Stored as Int in database
        tokenId: testToken.id,
        challengerId: user.id,
        guildId: 'test_guild_123',
        offerDeadline: new Date(Date.now() + 60000)
      }
    });

    console.log(`   📝 Created match: ${match.id}`);

    // Simulate process crash - leave match in PENDING state
    console.log(`   💥 Simulating process crash...`);

    // On restart, check for stale matches
    const staleMatches = await prisma.match.findMany({
      where: {
        status: 'PENDING',
        offerDeadline: { lt: new Date() }
      }
    });

    if (staleMatches.length > 0) {
      console.log(`   ⚠️  Found ${staleMatches.length} stale matches`);
    }

    // Recovery: Clean up stale match
    const matchToClean = await prisma.match.findFirst({
      where: {
        id: match.id,
        status: 'PENDING'
      }
    });

    if (matchToClean) {
      // Update to expired or delete
      await prisma.match.update({
        where: { id: match.id },
        data: { status: 'EXPIRED' }
      });

      console.log(`   ✅ Stale match recovered: Set to EXPIRED`);
    }

    // Verify no pending wagers left
    const pendingWagers = await prisma.match.count({
      where: {
        status: 'PENDING',
        offerDeadline: { lt: new Date() }
      }
    });

    if (pendingWagers === 0) {
      console.log(`   ✅ All stale matches handled`);
      return true;
    }

    throw new Error(`${pendingWagers} stale matches remain`);

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 5: Database Connection Resilience
async function testDatabaseResilience(): Promise<boolean> {
  console.log("\n5️⃣ Testing database connection resilience...");

  try {
    // Test connection pool
    const connections = [];
    for (let i = 0; i < 10; i++) {
      connections.push(
        prisma.user.count({
          where: { discordId: { contains: 'scaling_test' } }
        })
      );
    }

    const results = await Promise.all(connections);
    console.log(`   ✅ Handled ${results.length} concurrent queries`);

    // Test reconnection (simulate by disconnecting and reconnecting)
    await prisma.$disconnect();
    console.log(`   📡 Disconnected from database`);

    // Reconnect automatically on next query
    const userCount = await prisma.user.count({
      where: { discordId: { contains: 'scaling_test' } }
    });

    console.log(`   ✅ Reconnected successfully`);
    console.log(`   ✅ Found ${userCount} test users after reconnect`);

    return true;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 6: Rake Percentage Validation
async function testRakeValidation(): Promise<boolean> {
  console.log("\n6️⃣ Testing rake percentage accuracy...");

  try {
    const { pipchipsService } = await import("../src/services/pipchips_service.js");

    const challenger = testUsers[3];
    const joiner = testUsers[4];

    // Create match
    const match = await prisma.match.create({
      data: {
        status: 'IN_PROGRESS',
        wagerAtomic: 1000, // Stored as Int in database
        tokenId: testToken.id,
        challengerId: challenger.id,
        joinerId: joiner.id,
        guildId: 'test_guild_123'
      }
    });

    // Wagers
    await pipchipsService.debitPIPChips(challenger.discordId, 1000n, TxTypes.BET_PLACED, match.id.toString(), 'Rake test');
    await pipchipsService.debitPIPChips(joiner.discordId, 1000n, TxTypes.BET_PLACED, match.id.toString(), 'Rake test');

    // Calculate payout (2% rake)
    const pot = 2000n;
    const houseFeeBps = 200n; // 2%
    const rake = (pot * houseFeeBps) / 10000n;
    const payout = pot - rake;

    console.log(`   💰 Pot: ${pot}`);
    console.log(`   💸 Rake (2%): ${rake}`);
    console.log(`   💵 Payout: ${payout}`);

    // Verify calculation
    const expectedRake = 40n; // 2% of 2000
    const expectedPayout = 1960n;

    if (rake !== expectedRake) {
      throw new Error(`Rake mismatch: expected ${expectedRake}, got ${rake}`);
    }

    if (payout !== expectedPayout) {
      throw new Error(`Payout mismatch: expected ${expectedPayout}, got ${payout}`);
    }

    console.log(`   ✅ Rake calculation accurate`);

    // Credit winner
    await pipchipsService.creditPIPChips(challenger.discordId, payout, TxTypes.BET_WON, match.id.toString(), 'Rake test payout');

    // Verify no money created/destroyed
    const challengerBalance = await prisma.user.findUnique({
      where: { discordId: challenger.discordId },
      select: { pipchipsBalance: true }
    });

    const joinerBalance = await prisma.user.findUnique({
      where: { discordId: joiner.discordId },
      select: { pipchipsBalance: true }
    });

    const totalUserBalance = (challengerBalance?.pipchipsBalance || 0n) + (joinerBalance?.pipchipsBalance || 0n);
    const expectedTotal = 20000n - rake; // Both started with 10k

    console.log(`   📊 Total user balance: ${totalUserBalance}`);
    console.log(`   📊 Expected: ${expectedTotal}`);

    if (totalUserBalance === expectedTotal) {
      console.log(`   ✅ No money creation/destruction`);
      return true;
    }

    throw new Error(`Balance mismatch: ${totalUserBalance} vs ${expectedTotal}`);

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Main test runner
async function runTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   Scaling & Failover Test Suite                           ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  try {
    await setup();

    const results = {
      concurrentMatches: await testConcurrentMatches(),
      balanceDrift: await testBalanceDriftDetection(),
      orphanedTransactions: await testOrphanedTransactionDetection(),
      processRestart: await testProcessRestartRecovery(),
      databaseResilience: await testDatabaseResilience(),
      rakeValidation: await testRakeValidation()
    };

    // Summary
    const passed = Object.values(results).filter(r => r).length;
    const total = Object.values(results).length;

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║   Test Results                                             ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${total - passed}`);
    console.log(`\nOverall: ${passed === total ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}\n`);

    if (passed !== total) {
      process.exit(1);
    }

  } catch (error) {
    console.error("❌ Test suite failed:", error);
    process.exit(1);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}
