/**
 * Tournament Entry Multi-Token Payment Tests
 *
 * Tests mixed-token tournament entry payments:
 * - Single token payments
 * - Mixed token payments (50% ABSTR + 50% PEBBLE)
 * - Complex splits (33% ABSTR + 33% PEBBLE + 34% ICE)
 * - Price fluctuation handling
 * - Insufficient payment scenarios
 * - TPIP allocation verification
 */

import "dotenv/config";
import { validateTestEnvironment } from "../src/services/test_db_safety.js";
import { prisma } from "../src/services/db.js";
import {
  enterTournamentWithPayment,
  calculateEntryPayment,
  getTournamentEntryStatus,
  type TokenPayment
} from "../src/services/tournament_entry_service.js";
import { getTPIPBalance } from "../src/services/tpip_service.js";

// Enable test mode
process.env.NODE_ENV = 'test';
process.env.USE_MOCK_PRICES = 'true';
validateTestEnvironment();

interface TestContext {
  testUsers: Array<{
    id: number;
    discordId: string;
    agwAddress: string;
  }>;
  testTournament: {
    id: string;
    entryFeeUSD: number;
    tpipAllocation: number;
  };
  tokens: {
    abstr: { id: number; symbol: string; decimals: number };
    pebble: { id: number; symbol: string; decimals: number };
    ice: { id: number; symbol: string; decimals: number };
    tpip: { id: number; symbol: string; decimals: number };
  };
  cleanup: Array<() => Promise<void>>;
}

const ctx: TestContext = {
  testUsers: [],
  testTournament: {
    id: ``,
    entryFeeUSD: 0,
    tpipAllocation: 0
  },
  tokens: {} as any,
  cleanup: []
};

// Test configuration
const ENTRY_FEE_USD = 10; // $10 entry fee
const TPIP_ALLOCATION = 5000; // 5000 TPIP per entry

async function setup(): Promise<void> {
  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║   Tournament Entry Multi-Token Payment Test Suite         ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);

  console.log(`🧪 Setting up test environment...\n`);

  // Get tokens - using available tokens only
  const [abstr, pipchips, tpip] = await Promise.all([
    prisma.token.findFirst({ where: { symbol: "ABSTER" } }),
    prisma.token.findFirst({ where: { symbol: "PIPCHIPS" } }),
    prisma.token.findFirst({ where: { symbol: "TPIP" } })
  ]);

  if (!abstr || !pipchips || !tpip) {
    throw new Error("Required tokens not found");
  }

  // Use PIPCHIPS as second token for mixed payments (it has real price data)
  ctx.tokens = {
    abstr: { id: abstr.id, symbol: abstr.symbol, decimals: abstr.decimals },
    pebble: { id: pipchips.id, symbol: pipchips.symbol, decimals: pipchips.decimals }, // Using PIPCHIPS as second token
    ice: { id: abstr.id, symbol: abstr.symbol, decimals: abstr.decimals }, // Reuse ABSTR for third token tests
    tpip: { id: tpip.id, symbol: tpip.symbol, decimals: tpip.decimals }
  };

  console.log(`✅ Tokens loaded: ABSTER(${abstr.id}), PIPCHIPS(${pipchips.id}), TPIP(${tpip.id})\n`);

  // Create test tournament
  const tournamentId = `test_tournament_${Date.now()}`;
  const tournament = await prisma.tournament.create({
    data: {
      id: tournamentId,
      name: "Multi-Token Entry Test Tournament",
      status: "PENDING",
      entryFee: ENTRY_FEE_USD,
      startingPIPChips: TPIP_ALLOCATION,
      prizePool: 0,
      maxParticipants: 100,
      guildId: "test_guild"
    }
  });

  ctx.testTournament = {
    id: tournament.id,
    entryFeeUSD: ENTRY_FEE_USD,
    tpipAllocation: TPIP_ALLOCATION
  };

  ctx.cleanup.push(async () => {
    await prisma.tournament.delete({ where: { id: tournamentId } }).catch(() => {});
  });

  console.log(`✅ Created test tournament: ${tournament.name} ($${ENTRY_FEE_USD} entry, ${TPIP_ALLOCATION} TPIP)\n`);

  // Create 5 test users with various token balances
  for (let i = 0; i < 5; i++) {
    const discordId = `test_entry_user_${Date.now()}_${i}`;
    const agwAddress = `0x${Math.random().toString(16).substring(2, 42).padStart(40, '0')}`;

    const user = await prisma.user.create({
      data: { discordId, agwAddress , updatedAt: new Date() }}
    });

    // Give users different token combinations
    // User 0: Only ABSTR
    // User 1: Only PEBBLE
    // User 2: ABSTR + PEBBLE
    // User 3: All three tokens
    // User 4: Insufficient funds

    const baseAmount = 1000n; // 1000 tokens

    if (i === 0 || i === 2 || i === 3) {
      // Give ABSTR
      await prisma.userBalance.create({
        data: {
          userId: user.id,
          tokenId: abstr.id,
          amount: (baseAmount * (10n ** BigInt(abstr.decimals))).toString()
        }
      });
    }

    if (i === 1 || i === 2 || i === 3) {
      // Give PEBBLE
      await prisma.userBalance.create({
        data: {
          userId: user.id,
          tokenId: pebble.id,
          amount: (baseAmount * (10n ** BigInt(pebble.decimals))).toString()
        }
      });
    }

    if (i === 3) {
      // Give ICE
      await prisma.userBalance.create({
        data: {
          userId: user.id,
          tokenId: ice.id,
          amount: (baseAmount * (10n ** BigInt(ice.decimals))).toString()
        }
      });
    }

    if (i === 4) {
      // Insufficient: only 1 token (assuming price > $10)
      await prisma.userBalance.create({
        data: {
          userId: user.id,
          tokenId: abstr.id,
          amount: (1n * (10n ** BigInt(abstr.decimals))).toString()
        }
      });
    }

    ctx.testUsers.push({ id: user.id, discordId, agwAddress });
    ctx.cleanup.push(async () => {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    });
  }

  console.log(`✅ Created 5 test users with various token balances\n`);
}

async function cleanup(): Promise<void> {
  console.log("\n🧹 Cleaning up test data...");

  for (const cleanupFn of ctx.cleanup.reverse()) {
    await cleanupFn().catch(err => console.error("Cleanup error:", err));
  }

  console.log("✅ Cleanup completed");
}

// Test 1: Single token payment (100% ABSTR)
async function testSingleTokenPayment(): Promise<boolean> {
  console.log("1️⃣ Testing single token payment (100% ABSTR)...");

  try {
    const user = ctx.testUsers[0];

    // Calculate payment
    const calculation = await calculateEntryPayment({
      tournamentId: ctx.testTournament.id,
      desiredPayments: [{ tokenId: ctx.tokens.abstr.id, percentage: 100 }]
    });

    if (!calculation.success || !calculation.payments) {
      console.error(`   ❌ Payment calculation failed: ${calculation.error}`);
      return false;
    }

    const payment = calculation.payments[0];
    console.log(`   💰 Calculated payment: ${payment.amountDecimal} ${payment.tokenSymbol} ($${payment.usdValue})`);

    // Enter tournament
    const result = await enterTournamentWithPayment({
      userId: user.id,
      discordId: user.discordId,
      tournamentId: ctx.testTournament.id,
      payments: [{ tokenId: payment.tokenId, amount: payment.amount }]
    });

    if (!result.success) {
      console.error(`   ❌ Entry failed: ${result.error}`);
      return false;
    }

    // Verify TPIP allocation
    const tpipBalance = await getTPIPBalance(user.id);
    if (tpipBalance !== BigInt(TPIP_ALLOCATION)) {
      console.error(`   ❌ TPIP allocation mismatch: expected ${TPIP_ALLOCATION}, got ${tpipBalance}`);
      return false;
    }

    // Verify entry status
    const status = await getTournamentEntryStatus({
      userId: user.id,
      tournamentId: ctx.testTournament.id
    });

    if (!status.isEntered) {
      console.error(`   ❌ User not marked as entered`);
      return false;
    }

    console.log(`   ✅ Single token payment successful`);
    console.log(`   ✅ TPIP allocated: ${tpipBalance}`);
    console.log(`   ✅ Total USD paid: $${result.totalUsdPaid?.toFixed(2)}`);
    return true;

  } catch (error) {
    console.error(`   ❌ Test error:`, error);
    return false;
  }
}

// Test 2: Mixed token payment (50% ABSTR + 50% PEBBLE)
async function testMixedTokenPayment(): Promise<boolean> {
  console.log("\n2️⃣ Testing mixed token payment (50% ABSTR + 50% PEBBLE)...");

  try {
    const user = ctx.testUsers[2];

    // Calculate payment split
    const calculation = await calculateEntryPayment({
      tournamentId: ctx.testTournament.id,
      desiredPayments: [
        { tokenId: ctx.tokens.abstr.id, percentage: 50 },
        { tokenId: ctx.tokens.pebble.id, percentage: 50 }
      ]
    });

    if (!calculation.success || !calculation.payments) {
      console.error(`   ❌ Payment calculation failed: ${calculation.error}`);
      return false;
    }

    console.log(`   💰 Calculated payments:`);
    calculation.payments.forEach(p => {
      console.log(`      ${p.percentage}% ${p.tokenSymbol}: ${p.amountDecimal} ($${p.usdValue.toFixed(2)})`);
    });

    // Enter tournament with mixed payment
    const payments: TokenPayment[] = calculation.payments.map(p => ({
      tokenId: p.tokenId,
      amount: p.amount
    }));

    const result = await enterTournamentWithPayment({
      userId: user.id,
      discordId: user.discordId,
      tournamentId: ctx.testTournament.id,
      payments
    });

    if (!result.success) {
      console.error(`   ❌ Entry failed: ${result.error}`);
      return false;
    }

    // Verify TPIP allocation
    const tpipBalance = await getTPIPBalance(user.id);
    if (tpipBalance !== BigInt(TPIP_ALLOCATION)) {
      console.error(`   ❌ TPIP allocation mismatch: expected ${TPIP_ALLOCATION}, got ${tpipBalance}`);
      return false;
    }

    // Verify both tokens were debited
    if (!result.payments || result.payments.length !== 2) {
      console.error(`   ❌ Expected 2 payment records, got ${result.payments?.length}`);
      return false;
    }

    console.log(`   ✅ Mixed token payment successful`);
    console.log(`   ✅ TPIP allocated: ${tpipBalance}`);
    console.log(`   ✅ Total USD paid: $${result.totalUsdPaid?.toFixed(2)}`);
    console.log(`   ✅ Tokens debited: ${result.payments.map(p => p.tokenSymbol).join(', ')}`);
    return true;

  } catch (error) {
    console.error(`   ❌ Test error:`, error);
    return false;
  }
}

// Test 3: Complex split (33% ABSTR + 33% PEBBLE + 34% ICE)
async function testComplexSplit(): Promise<boolean> {
  console.log("\n3️⃣ Testing complex split (33% ABSTR + 33% PEBBLE + 34% ICE)...");

  try {
    const user = ctx.testUsers[3];

    // Calculate payment split
    const calculation = await calculateEntryPayment({
      tournamentId: ctx.testTournament.id,
      desiredPayments: [
        { tokenId: ctx.tokens.abstr.id, percentage: 33 },
        { tokenId: ctx.tokens.pebble.id, percentage: 33 },
        { tokenId: ctx.tokens.ice.id, percentage: 34 }
      ]
    });

    if (!calculation.success || !calculation.payments) {
      console.error(`   ❌ Payment calculation failed: ${calculation.error}`);
      return false;
    }

    console.log(`   💰 Calculated payments:`);
    calculation.payments.forEach(p => {
      console.log(`      ${p.percentage}% ${p.tokenSymbol}: ${p.amountDecimal} ($${p.usdValue.toFixed(2)})`);
    });

    // Enter tournament
    const payments: TokenPayment[] = calculation.payments.map(p => ({
      tokenId: p.tokenId,
      amount: p.amount
    }));

    const result = await enterTournamentWithPayment({
      userId: user.id,
      discordId: user.discordId,
      tournamentId: ctx.testTournament.id,
      payments
    });

    if (!result.success) {
      console.error(`   ❌ Entry failed: ${result.error}`);
      return false;
    }

    // Verify TPIP allocation
    const tpipBalance = await getTPIPBalance(user.id);
    if (tpipBalance !== BigInt(TPIP_ALLOCATION)) {
      console.error(`   ❌ TPIP allocation mismatch: expected ${TPIP_ALLOCATION}, got ${tpipBalance}`);
      return false;
    }

    // Verify all three tokens were debited
    if (!result.payments || result.payments.length !== 3) {
      console.error(`   ❌ Expected 3 payment records, got ${result.payments?.length}`);
      return false;
    }

    console.log(`   ✅ Complex split payment successful`);
    console.log(`   ✅ TPIP allocated: ${tpipBalance}`);
    console.log(`   ✅ Total USD paid: $${result.totalUsdPaid?.toFixed(2)}`);
    console.log(`   ✅ Tokens debited: ${result.payments.map(p => p.tokenSymbol).join(', ')}`);
    return true;

  } catch (error) {
    console.error(`   ❌ Test error:`, error);
    return false;
  }
}

// Test 4: Insufficient payment (should fail)
async function testInsufficientPayment(): Promise<boolean> {
  console.log("\n4️⃣ Testing insufficient payment (should fail)...");

  try {
    const user = ctx.testUsers[4];

    // Try to enter with insufficient funds
    const result = await enterTournamentWithPayment({
      userId: user.id,
      discordId: user.discordId,
      tournamentId: ctx.testTournament.id,
      payments: [
        {
          tokenId: ctx.tokens.abstr.id,
          amount: 1n * (10n ** BigInt(ctx.tokens.abstr.decimals)) // Only 1 token
        }
      ]
    });

    if (result.success) {
      console.error(`   ❌ Entry should have failed but succeeded`);
      return false;
    }

    if (!result.error?.includes("Insufficient payment")) {
      console.error(`   ❌ Wrong error message: ${result.error}`);
      return false;
    }

    // Verify no TPIP was allocated
    const tpipBalance = await getTPIPBalance(user.id);
    if (tpipBalance !== 0n) {
      console.error(`   ❌ TPIP should be 0, got ${tpipBalance}`);
      return false;
    }

    console.log(`   ✅ Insufficient payment correctly rejected`);
    console.log(`   ✅ Error message: ${result.error}`);
    console.log(`   ✅ No TPIP allocated`);
    return true;

  } catch (error) {
    console.error(`   ❌ Test error:`, error);
    return false;
  }
}

// Test 5: Verify transaction logging
async function testTransactionLogging(): Promise<boolean> {
  console.log("\n5️⃣ Verifying transaction logging...");

  try {
    // Check that all entry transactions were logged
    const entryTxs = await prisma.transaction.findMany({
      where: {
        type: 'TOURNAMENT_ENTRY_PAYMENT',
        opRef: `tournament_${ctx.testTournament.id}`
      },
      include: {
        balanceDeltas: {
          include: { token: true }
        }
      }
    });

    const allocationTxs = await prisma.transaction.count({
      where: {
        type: 'TPIP_ALLOCATION',
        opRef: `tournament_${ctx.testTournament.id}`
      }
    });

    // We should have:
    // - User 0: 1 payment (ABSTR)
    // - User 2: 2 payments (ABSTR + PEBBLE)
    // - User 3: 3 payments (ABSTR + PEBBLE + ICE)
    // Total: 6 payment transactions, 3 allocation transactions

    const expectedPayments = 6;
    const expectedAllocations = 3; // 3 successful entries

    if (entryTxs.length !== expectedPayments) {
      console.error(`   ❌ Expected ${expectedPayments} payment transactions, got ${entryTxs.length}`);
      return false;
    }

    if (allocationTxs !== expectedAllocations) {
      console.error(`   ❌ Expected ${expectedAllocations} allocation transactions, got ${allocationTxs}`);
      return false;
    }

    // Verify each transaction has proper BalanceDelta
    for (const tx of entryTxs) {
      if (tx.balanceDeltas.length === 0) {
        console.error(`   ❌ Transaction ${tx.id} has no BalanceDelta`);
        return false;
      }

      if (!tx.usdValue || tx.usdValue <= 0) {
        console.error(`   ❌ Transaction ${tx.id} missing USD value`);
        return false;
      }
    }

    console.log(`   ✅ All ${expectedPayments} payment transactions logged`);
    console.log(`   ✅ All ${expectedAllocations} allocation transactions logged`);
    console.log(`   ✅ All transactions have BalanceDelta records`);
    console.log(`   ✅ All transactions have USD values`);
    return true;

  } catch (error) {
    console.error(`   ❌ Test error:`, error);
    return false;
  }
}

// Run all tests
async function runTests(): Promise<void> {
  await setup();

  const tests = [
    testSingleTokenPayment,
    testMixedTokenPayment,
    testComplexSplit,
    testInsufficientPayment,
    testTransactionLogging
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await test();
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }

  await cleanup();

  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║   Test Results                                             ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);
  console.log(`Total Tests: ${tests.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}\n`);

  if (failed === 0) {
    console.log(`Overall: ✅ ALL TESTS PASSED\n`);
    process.exit(0);
  } else {
    console.log(`Overall: ❌ SOME TESTS FAILED\n`);
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error("❌ Test suite failed:", error);
  process.exit(1);
});
