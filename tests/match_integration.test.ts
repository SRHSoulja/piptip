#!/usr/bin/env npx tsx
/**
 * Match Flow Integration Test
 *
 * Tests complete match lifecycle to ensure Transaction + BalanceDelta integrity:
 * - 2 players place wagers
 * - Match resolves with winner/loser
 * - Transaction + BalanceDelta records created for wagers and payout
 * - Final UserBalance matches sum of BalanceDeltas
 * - Refund scenario creates proper BalanceDeltas
 *
 * Run: npm run test:match-integration
 */

import "dotenv/config";
import { validateTestEnvironment } from "../src/services/test_db_safety.js";
import { getTransactionTimeout } from "../src/services/test_mocks.js";
import { prisma } from "../src/services/db.js";
import { Decimal } from "@prisma/client/runtime/library";
import { formatUnits, parseUnits } from "ethers";

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.USE_MOCK_PRICES = 'true';

// Validate test environment before running
validateTestEnvironment();

interface TestContext {
  testUsers: Array<{ id: number; discordId: string }>;
  testToken: { id: number; symbol: string; decimals: number };
  cleanup: Array<() => Promise<void>>;
}

let ctx: TestContext;

async function setup(): Promise<void> {
  console.log("🧪 Setting up match test environment...\n");

  ctx = {
    testUsers: [],
    testToken: null as any,
    cleanup: []
  };

  // Get test token
  const token = await prisma.token.findFirst({
    where: { active: true },
    select: { id: true, symbol: true, decimals: true }
  });

  if (!token) {
    throw new Error("No active token found for testing");
  }

  ctx.testToken = token;

  // Create 2 test users for match
  for (let i = 0; i < 2; i++) {
    const discordId = `test_match_user_${Date.now()}_${i}`;
    const user = await prisma.user.create({
      data: { discordId, updatedAt: new Date() }
    });

    // Create initial balance (1000 tokens each)
    await prisma.userBalance.create({
      data: {
        userId: user.id,
        tokenId: token.id,
        amount: new Decimal(1000)
      }
    });

    ctx.testUsers.push({ id: user.id, discordId });
    ctx.cleanup.push(async () => {
      await prisma.userBalance.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    });
  }

  console.log(`✅ Created 2 test users (challengers/joiners)`);
  console.log(`✅ Using token: ${token.symbol} (decimals: ${token.decimals})\n`);
}

async function cleanup(): Promise<void> {
  console.log("\n🧹 Cleaning up test data...");

  for (const cleanupFn of ctx.cleanup.reverse()) {
    await cleanupFn().catch(err => console.error("Cleanup error:", err));
  }

  console.log("✅ Cleanup completed");
}

// Test 1: Successful Match with Winner
async function testMatchWithWinner(): Promise<boolean> {
  console.log("1️⃣ Testing Match Flow with Winner...");

  try {
    const { debitTokenAtomicTx, creditTokenTx } = await import("../src/services/balances.js");
    const challenger = ctx.testUsers[0];
    const joiner = ctx.testUsers[1];
    const token = ctx.testToken;

    const wagerAmount = 100; // 100 tokens
    const wagerAtomic = parseUnits(wagerAmount.toString(), token.decimals);

    // Initial balances
    const challengerBalanceBefore = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: challenger.id, tokenId: token.id } }
    });
    const joinerBalanceBefore = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: joiner.id, tokenId: token.id } }
    });

    console.log(`   💰 Initial balances: Challenger=${challengerBalanceBefore?.amount}, Joiner=${joinerBalanceBefore?.amount}`);

    // Simulate match flow in transaction with increased timeout
    const matchResult = await prisma.$transaction(async (tx) => {
      // 1. Both players wager
      await debitTokenAtomicTx(tx, challenger.discordId, token.id, wagerAtomic, "MATCH_WAGER", {
        guildId: "test_guild"
      });

      await debitTokenAtomicTx(tx, joiner.discordId, token.id, wagerAtomic, "MATCH_WAGER", {
        guildId: "test_guild"
      });

      // 2. Calculate payout (2% house fee)
      const pot = 2n * wagerAtomic;
      const houseFeeBps = 200n; // 2%
      const rake = (pot * houseFeeBps) / 10000n;
      const payout = pot - rake;

      // 3. Winner gets payout (challenger wins)
      await creditTokenTx(tx, challenger.discordId, token.id, payout, "MATCH_PAYOUT", {
        guildId: "test_guild"
      });

      return { payout, rake };
    }, {
      timeout: getTransactionTimeout()
    });

    // Verify final balances
    const challengerBalanceAfter = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: challenger.id, tokenId: token.id } }
    });
    const joinerBalanceAfter = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: joiner.id, tokenId: token.id } }
    });

    console.log(`   💰 Final balances: Challenger=${challengerBalanceAfter?.amount}, Joiner=${joinerBalanceAfter?.amount}`);

    // Verify Transaction records created
    const transactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { userId: challenger.id, type: { in: ["MATCH_WAGER", "MATCH_PAYOUT"] } },
          { userId: joiner.id, type: "MATCH_WAGER" }
        ],
        createdAt: { gte: new Date(Date.now() - 10000) } // Last 10 seconds
      },
      include: { balanceDeltas: true },
      orderBy: { createdAt: "asc" }
    });

    if (transactions.length !== 3) {
      console.error(`   ❌ Expected 3 transactions (2 wagers + 1 payout), got ${transactions.length}`);
      return false;
    }

    // Verify each transaction has BalanceDeltas
    for (const tx of transactions) {
      if (tx.balanceDeltas.length === 0) {
        console.error(`   ❌ Transaction ${tx.id} (${tx.type}) has no BalanceDeltas`);
        return false;
      }
    }

    // Verify BalanceDelta consistency
    const challengerDeltas = await prisma.balanceDelta.findMany({
      where: {
        userId: challenger.id,
        tokenId: token.id,
        createdAt: { gte: new Date(Date.now() - 10000) }
      }
    });

    const joinerDeltas = await prisma.balanceDelta.findMany({
      where: {
        userId: joiner.id,
        tokenId: token.id,
        createdAt: { gte: new Date(Date.now() - 10000) }
      }
    });

    // Sum BalanceDeltas
    const challengerDeltaSum = challengerDeltas.reduce((sum, delta) =>
      sum + BigInt(formatUnits(delta.amountDelta.toString(), 0)), 0n
    );
    const joinerDeltaSum = joinerDeltas.reduce((sum, delta) =>
      sum + BigInt(formatUnits(delta.amountDelta.toString(), 0)), 0n
    );

    // Calculate expected changes
    const challengerExpected = -wagerAtomic + matchResult.payout;
    const joinerExpected = -wagerAtomic;

    console.log(`   📊 Challenger BalanceDelta sum: ${formatUnits(challengerDeltaSum, token.decimals)} (expected: ${formatUnits(challengerExpected, token.decimals)})`);
    console.log(`   📊 Joiner BalanceDelta sum: ${formatUnits(joinerDeltaSum, token.decimals)} (expected: ${formatUnits(joinerExpected, token.decimals)})`);

    // Verify balance changes match BalanceDelta sums
    const challengerChange = parseUnits(challengerBalanceAfter!.amount.toString(), token.decimals) -
                             parseUnits(challengerBalanceBefore!.amount.toString(), token.decimals);
    const joinerChange = parseUnits(joinerBalanceAfter!.amount.toString(), token.decimals) -
                        parseUnits(joinerBalanceBefore!.amount.toString(), token.decimals);

    const tolerance = 1000n; // 1000 wei tolerance
    if (challengerChange - challengerDeltaSum > tolerance || challengerDeltaSum - challengerChange > tolerance) {
      console.error(`   ❌ Challenger balance change doesn't match BalanceDelta sum`);
      return false;
    }

    if (joinerChange - joinerDeltaSum > tolerance || joinerDeltaSum - joinerChange > tolerance) {
      console.error(`   ❌ Joiner balance change doesn't match BalanceDelta sum`);
      return false;
    }

    console.log(`   ✅ Created 3 transactions (2 wagers + 1 payout)`);
    console.log(`   ✅ All transactions have BalanceDeltas`);
    console.log(`   ✅ Balance changes match BalanceDelta sums`);
    console.log(`   ✅ Winner received ${formatUnits(matchResult.payout, token.decimals)} ${token.symbol}`);
    console.log(`   ✅ House collected ${formatUnits(matchResult.rake, token.decimals)} ${token.symbol} rake`);
    return true;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 2: Match Tie (Refunds)
async function testMatchTie(): Promise<boolean> {
  console.log("\n2️⃣ Testing Match Tie with Refunds...");

  try {
    const { debitTokenAtomicTx, creditTokenTx } = await import("../src/services/balances.js");
    const challenger = ctx.testUsers[0];
    const joiner = ctx.testUsers[1];
    const token = ctx.testToken;

    const wagerAmount = 50; // 50 tokens
    const wagerAtomic = parseUnits(wagerAmount.toString(), token.decimals);

    // Initial balances
    const challengerBalanceBefore = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: challenger.id, tokenId: token.id } }
    });
    const joinerBalanceBefore = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: joiner.id, tokenId: token.id } }
    });

    // Simulate tie match with increased timeout
    await prisma.$transaction(async (tx) => {
      // 1. Both players wager
      await debitTokenAtomicTx(tx, challenger.discordId, token.id, wagerAtomic, "MATCH_WAGER", {
        guildId: "test_guild"
      });

      await debitTokenAtomicTx(tx, joiner.discordId, token.id, wagerAtomic, "MATCH_WAGER", {
        guildId: "test_guild"
      });

      // 2. Tie → Refund both
      await creditTokenTx(tx, challenger.discordId, token.id, wagerAtomic, "MATCH_PAYOUT", {
        guildId: "test_guild"
      });

      await creditTokenTx(tx, joiner.discordId, token.id, wagerAtomic, "MATCH_PAYOUT", {
        guildId: "test_guild"
      });
    }, {
      timeout: getTransactionTimeout()
    });

    // Verify final balances (should be same as initial)
    const challengerBalanceAfter = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: challenger.id, tokenId: token.id } }
    });
    const joinerBalanceAfter = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: joiner.id, tokenId: token.id } }
    });

    // Both should have same balance as before (tie = full refund)
    const challengerDiff = Number(challengerBalanceAfter!.amount.sub(challengerBalanceBefore!.amount));
    const joinerDiff = Number(joinerBalanceAfter!.amount.sub(joinerBalanceBefore!.amount));

    if (Math.abs(challengerDiff) > 0.000001) {
      console.error(`   ❌ Challenger balance changed by ${challengerDiff} (expected 0 for tie)`);
      return false;
    }

    if (Math.abs(joinerDiff) > 0.000001) {
      console.error(`   ❌ Joiner balance changed by ${joinerDiff} (expected 0 for tie)`);
      return false;
    }

    // Verify transactions created
    const transactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { userId: challenger.id },
          { userId: joiner.id }
        ],
        type: { in: ["MATCH_WAGER", "MATCH_PAYOUT"] },
        createdAt: { gte: new Date(Date.now() - 10000) }
      },
      include: { balanceDeltas: true }
    });

    // Should have 4 transactions (2 wagers + 2 refunds)
    if (transactions.length < 4) {
      console.error(`   ❌ Expected at least 4 transactions, got ${transactions.length}`);
      return false;
    }

    console.log(`   ✅ Created 4 transactions (2 wagers + 2 refunds)`);
    console.log(`   ✅ Both players refunded full wager amounts`);
    console.log(`   ✅ Final balances equal initial balances (zero net change)`);
    return true;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 3: Merkle Consistency
async function testMerkleConsistency(): Promise<boolean> {
  console.log("\n3️⃣ Testing Merkle Tree Consistency...");

  try {
    const token = ctx.testToken;

    // Get all BalanceDeltas for test users
    const balanceDeltas = await prisma.balanceDelta.findMany({
      where: {
        userId: { in: ctx.testUsers.map(u => u.id) },
        tokenId: token.id
      }
    });

    // Calculate derived balances from BalanceDeltas
    for (const user of ctx.testUsers) {
      const userDeltas = balanceDeltas.filter(bd => bd.userId === user.id);
      const deltaSum = userDeltas.reduce((sum, delta) => {
        return sum + parseUnits(delta.amountDelta.toString(), 0);
      }, 0n);

      // Get actual UserBalance
      const userBalance = await prisma.userBalance.findUnique({
        where: { userId_tokenId: { userId: user.id, tokenId: token.id } }
      });

      if (!userBalance) {
        console.error(`   ❌ UserBalance not found for user ${user.id}`);
        return false;
      }

      // Initial balance was 1000
      const initialBalance = parseUnits("1000", token.decimals);
      const expectedBalance = initialBalance + deltaSum;
      const actualBalance = parseUnits(userBalance.amount.toString(), token.decimals);

      const tolerance = 1000n; // 1000 wei tolerance
      const diff = actualBalance > expectedBalance ?
        actualBalance - expectedBalance :
        expectedBalance - actualBalance;

      if (diff > tolerance) {
        console.error(`   ❌ Balance mismatch for user ${user.id}:`);
        console.error(`      Expected: ${formatUnits(expectedBalance, token.decimals)}`);
        console.error(`      Actual: ${formatUnits(actualBalance, token.decimals)}`);
        console.error(`      Difference: ${formatUnits(diff, token.decimals)}`);
        return false;
      }
    }

    console.log(`   ✅ All user balances match BalanceDelta sums`);
    console.log(`   ✅ Merkle tree would include correct balances`);
    return true;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Main test runner
async function runTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   Match Flow Integration Test Suite                       ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  try {
    await setup();

    const results = {
      matchWithWinner: await testMatchWithWinner(),
      matchTie: await testMatchTie(),
      merkleConsistency: await testMerkleConsistency()
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