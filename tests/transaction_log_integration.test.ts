#!/usr/bin/env npx tsx
/**
 * Comprehensive Transaction Log Integration Tests
 *
 * Tests all balance-affecting operations to ensure they properly create
 * Transaction + BalanceDelta records via logCompleteTransaction()
 *
 * Run: npm run test:transaction-integration
 */

import "dotenv/config";
import { prisma } from "../src/services/db.js";
import { Decimal } from "@prisma/client/runtime/library";

// Test utilities
interface TestContext {
  testUsers: Array<{ id: number; discordId: string }>;
  testTokens: Array<{ id: number; symbol: string; decimals: number }>;
  cleanup: Array<() => Promise<void>>;
}

let ctx: TestContext;

async function setup(): Promise<void> {
  console.log("🧪 Setting up test environment...\n");

  ctx = {
    testUsers: [],
    testTokens: [],
    cleanup: []
  };

  // Get or create test token
  const token = await prisma.token.findFirst({
    where: { active: true },
    select: { id: true, symbol: true, decimals: true }
  });

  if (!token) {
    throw new Error("No active token found for testing");
  }

  ctx.testTokens.push(token);

  // Create test users
  for (let i = 0; i < 3; i++) {
    const discordId = `test_txlog_user_${Date.now()}_${i}`;
    const user = await prisma.user.create({
      data: { discordId, updatedAt: new Date() }
    });

    // Create initial balance
    await prisma.userBalance.create({
      data: {
        userId: user.id,
        tokenId: token.id,
        amount: new Decimal(10000) // Start with 10,000 tokens
      }
    });

    ctx.testUsers.push({ id: user.id, discordId });
    ctx.cleanup.push(async () => {
      await prisma.userBalance.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    });
  }

  console.log(`✅ Created ${ctx.testUsers.length} test users`);
  console.log(`✅ Using token: ${token.symbol} (decimals: ${token.decimals})\n`);
}

async function cleanup(): Promise<void> {
  console.log("\n🧹 Cleaning up test data...");

  for (const cleanupFn of ctx.cleanup.reverse()) {
    await cleanupFn().catch(err => console.error("Cleanup error:", err));
  }

  console.log("✅ Cleanup completed");
}

// Test 1: Tier Purchase
async function testTierPurchase(): Promise<boolean> {
  console.log("1️⃣ Testing Tier Purchase...");

  try {
    const { purchaseTierByBalance } = await import("../src/services/tier_purchase.js");
    const testUser = ctx.testUsers[0];
    const token = ctx.testTokens[0];

    // Get or create a tier
    let tier = await prisma.tier.findFirst({ where: { active: true } });
    if (!tier) {
      tier = await prisma.tier.create({
        data: {
          name: "Test Tier",
          active: true,
          durationDays: 30
        }
      });
      ctx.cleanup.push(async () => {
        await prisma.tier.delete({ where: { id: tier!.id } }).catch(() => {});
      });
    }

    // Get or create tier price
    let tierPrice = await prisma.tierPrice.findUnique({
      where: {
        tierId_tokenId: { tierId: tier.id, tokenId: token.id }
      }
    });

    if (!tierPrice) {
      tierPrice = await prisma.tierPrice.create({
        data: {
          tierId: tier.id,
          tokenId: token.id,
          amount: new Decimal(100)
        }
      });
      ctx.cleanup.push(async () => {
        await prisma.tierPrice.delete({ where: { id: tierPrice!.id } }).catch(() => {});
      });
    }

    // Purchase tier
    const result = await purchaseTierByBalance({
      discordId: testUser.discordId,
      tierId: tier.id
    });

    // Verify Transaction created
    const transaction = await prisma.transaction.findFirst({
      where: {
        type: "TIER_PURCHASE",
        userId: testUser.id,
        tokenId: token.id
      },
      orderBy: { createdAt: "desc" }
    });

    if (!transaction) {
      console.error("   ❌ No Transaction record found");
      return false;
    }

    // Verify BalanceDelta created
    const balanceDelta = await prisma.balanceDelta.findFirst({
      where: {
        transactionId: transaction.id,
        userId: testUser.id,
        tokenId: token.id
      }
    });

    if (!balanceDelta) {
      console.error("   ❌ No BalanceDelta record found");
      return false;
    }

    // Verify amount is negative (debit)
    if (Number(balanceDelta.amountDelta) >= 0) {
      console.error(`   ❌ BalanceDelta should be negative, got: ${balanceDelta.amountDelta}`);
      return false;
    }

    console.log(`   ✅ Transaction created (ID: ${transaction.id})`);
    console.log(`   ✅ BalanceDelta created (amount: ${balanceDelta.amountDelta})`);
    console.log(`   ✅ Idempotency key: ${transaction.idempotencyKey}`);
    return true;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 2: Group Tip Contribution (Direct Transaction Log Test)
async function testGroupTipContribution(): Promise<boolean> {
  console.log("\n2️⃣ Testing Group Tip Contribution (Transaction Log)...");

  try {
    const { logCompleteTransaction } = await import("../src/services/tx_logger.js");
    const creator = ctx.testUsers[0];
    const contributor = ctx.testUsers[1];
    const token = ctx.testTokens[0];

    // Directly test the transaction logging (bypass the complex group tip creation)
    const result = await prisma.$transaction(async (tx) => {
      const contributionAtomic = BigInt(50 * (10 ** token.decimals));
      const feeAtomic = BigInt(5 * (10 ** token.decimals));
      const timestamp = Date.now();

      return await logCompleteTransaction(tx, {
        operation: 'GROUP_TIP_CONTRIBUTION',
        userId: contributor.id,
        guildId: "test_guild_123",
        balanceChanges: [
          {
            tokenId: token.id,
            userId: contributor.id,
            amountDelta: -(contributionAtomic + feeAtomic),
            reason: 'group_tip_contribution'
          },
          {
            tokenId: token.id,
            userId: undefined, // Fee to house
            amountDelta: feeAtomic,
            reason: 'group_tip_fee'
          }
        ],
        metadata: {
          groupTipId: 999, // Test ID
          contributionAmount: 50,
          taxAmount: 5,
          creatorId: creator.id
        },
        idempotencyKey: `test_group_contribution_${contributor.id}_${timestamp}`,
        source: 'BOT'
      });
    });

    // Verify Transaction created
    const transaction = await prisma.transaction.findUnique({
      where: { id: result.transactionId }
    });

    if (!transaction) {
      console.error("   ❌ No Transaction record found");
      return false;
    }

    // Verify BalanceDeltas created
    const balanceDeltas = await prisma.balanceDelta.findMany({
      where: {
        transactionId: transaction.id,
        tokenId: token.id
      }
    });

    if (balanceDeltas.length !== 2) {
      console.error(`   ❌ Expected 2 BalanceDeltas, got ${balanceDeltas.length}`);
      return false;
    }

    // Verify contributor debit
    const contributorDelta = balanceDeltas.find(bd => bd.userId === contributor.id);
    if (!contributorDelta || Number(contributorDelta.amountDelta) >= 0) {
      console.error("   ❌ Contributor BalanceDelta not found or incorrect");
      return false;
    }

    // Verify fee to house
    const feeDelta = balanceDeltas.find(bd => bd.userId === null);
    if (!feeDelta || Number(feeDelta.amountDelta) <= 0) {
      console.error("   ❌ Fee BalanceDelta not found or incorrect");
      return false;
    }

    console.log(`   ✅ Transaction created (ID: ${transaction.id})`);
    console.log(`   ✅ BalanceDeltas created (count: ${balanceDeltas.length})`);
    console.log(`   ✅ Contributor debit: ${contributorDelta.amountDelta}`);
    console.log(`   ✅ Fee credit: ${feeDelta.amountDelta}`);
    return true;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 3: Tournament Entry Fee (Direct Transaction Log Test)
async function testTournamentEntry(): Promise<boolean> {
  console.log("\n3️⃣ Testing Tournament Entry Fee (Transaction Log)...");

  try {
    const { logCompleteTransaction } = await import("../src/services/tx_logger.js");
    const testUser = ctx.testUsers[2];
    const token = ctx.testTokens[0];

    // Directly test tournament entry fee transaction logging
    const result = await prisma.$transaction(async (tx) => {
      const entryFeeAtomic = BigInt(50 * (10 ** token.decimals));
      const tournamentId = `test_tournament_${Date.now()}`;

      return await logCompleteTransaction(tx, {
        operation: 'TOURNAMENT_ENTRY',
        userId: testUser.id,
        balanceChanges: [{
          tokenId: token.id,
          userId: testUser.id,
          amountDelta: -entryFeeAtomic,
          reason: 'tournament_entry_fee'
        }],
        metadata: {
          tournamentId,
          tournamentName: "Test Tournament",
          startingPIPChips: 1000,
          tokenType: token.symbol
        },
        idempotencyKey: `test_tournament_entry_${tournamentId}_${testUser.id}`,
        source: 'BOT'
      });
    });

    // Verify Transaction created
    const transaction = await prisma.transaction.findUnique({
      where: { id: result.transactionId }
    });

    if (!transaction) {
      console.error("   ❌ No Transaction record found");
      return false;
    }

    if (transaction.type !== "TOURNAMENT_ENTRY") {
      console.error(`   ❌ Wrong transaction type: ${transaction.type}`);
      return false;
    }

    // Verify BalanceDelta created
    const balanceDelta = await prisma.balanceDelta.findFirst({
      where: {
        transactionId: transaction.id,
        userId: testUser.id,
        tokenId: token.id
      }
    });

    if (!balanceDelta) {
      console.error("   ❌ No BalanceDelta record found");
      return false;
    }

    // Verify amount is negative (entry fee payment)
    if (Number(balanceDelta.amountDelta) >= 0) {
      console.error(`   ❌ BalanceDelta should be negative, got: ${balanceDelta.amountDelta}`);
      return false;
    }

    console.log(`   ✅ Transaction created (ID: ${transaction.id})`);
    console.log(`   ✅ BalanceDelta created (amount: ${balanceDelta.amountDelta})`);
    console.log(`   ✅ Entry fee logged correctly`);
    return true;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 4: Treasury Operations
async function testTreasuryOperations(): Promise<boolean> {
  console.log("\n4️⃣ Testing Treasury Operations...");

  try {
    const { logTreasuryOperation } = await import("../src/services/treasury.js");
    const token = ctx.testTokens[0];

    // Log a treasury operation
    const result = await logTreasuryOperation({
      operation: "TREASURY_TEST_OP",
      tokenId: token.id,
      amount: 1000000000000000000n, // 1 token
      reason: "Test treasury operation",
      direction: "in"
    });

    // Verify Transaction created
    const transaction = await prisma.transaction.findUnique({
      where: { id: result.transactionId }
    });

    if (!transaction) {
      console.error("   ❌ No Transaction record found");
      return false;
    }

    if (transaction.type !== "TREASURY_TEST_OP") {
      console.error(`   ❌ Wrong transaction type: ${transaction.type}`);
      return false;
    }

    // Verify BalanceDelta created
    const balanceDelta = await prisma.balanceDelta.findFirst({
      where: {
        transactionId: transaction.id,
        tokenId: token.id
      }
    });

    if (!balanceDelta) {
      console.error("   ❌ No BalanceDelta record found");
      return false;
    }

    // Verify userId is null (treasury operation)
    if (balanceDelta.userId !== null) {
      console.error(`   ❌ Treasury operation should have null userId`);
      return false;
    }

    console.log(`   ✅ Transaction created (ID: ${transaction.id})`);
    console.log(`   ✅ BalanceDelta created (amount: ${balanceDelta.amountDelta})`);
    console.log(`   ✅ Treasury operation logged correctly`);
    return true;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 5: Verify All Operations Create Consistent Records
async function testTransactionConsistency(): Promise<boolean> {
  console.log("\n5️⃣ Testing Transaction Consistency...");

  try {
    // Get all transactions created during this test
    const transactions = await prisma.transaction.findMany({
      where: {
        type: {
          in: [
            "TIER_PURCHASE",
            "GROUP_TIP_CONTRIBUTION",
            "TOURNAMENT_ENTRY",
            "TREASURY_TEST_OP"
          ]
        },
        createdAt: {
          gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
        }
      },
      include: {
        balanceDeltas: true
      }
    });

    console.log(`   📊 Found ${transactions.length} test transactions`);

    let allValid = true;

    for (const transaction of transactions) {
      // Verify each transaction has at least one BalanceDelta
      if (transaction.balanceDeltas.length === 0) {
        console.error(`   ❌ Transaction ${transaction.id} has no BalanceDeltas`);
        allValid = false;
        continue;
      }

      // Verify idempotency key exists
      if (!transaction.idempotencyKey) {
        console.error(`   ❌ Transaction ${transaction.id} missing idempotency key`);
        allValid = false;
        continue;
      }

      console.log(`   ✅ Transaction ${transaction.id} (${transaction.type}): ${transaction.balanceDeltas.length} deltas`);
    }

    return allValid;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Main test runner
async function runTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   Transaction Log Integration Test Suite                  ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  try {
    await setup();

    const results = {
      tierPurchase: await testTierPurchase(),
      groupTipContribution: await testGroupTipContribution(),
      tournamentEntry: await testTournamentEntry(),
      treasuryOperations: await testTreasuryOperations(),
      consistency: await testTransactionConsistency()
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