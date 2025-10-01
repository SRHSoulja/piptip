#!/usr/bin/env npx tsx
/**
 * Game Simulation Stress Test
 *
 * Simulates 100 matches + 100 prediction market bets with random outcomes
 * to validate that no balance drift exists between UserBalance and transaction log.
 *
 * Run: npx tsx scripts/simulate_games.ts
 */

import "dotenv/config";
import { validateTestEnvironment } from "../src/services/test_db_safety.js";
import { getTransactionTimeout } from "../src/services/test_mocks.js";
import { prisma } from "../src/services/db.js";
import { debitTokenAtomicTx, creditTokenTx } from "../src/services/balances.js";
import { pipchipsService } from "../src/services/pipchips_service.js";
import { PredictionMarketService } from "../src/services/prediction_markets.js";
import { Decimal } from "@prisma/client/runtime/library";
import { parseUnits, formatUnits } from "ethers";

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.USE_MOCK_PRICES = 'true';

// Validate test environment before running
validateTestEnvironment();

// Simulation configuration
const CONFIG = {
  matchCount: 100,
  predictionMarketCount: 100,
  testUserCount: 20,
  initialBalance: 100000, // 100k tokens per user
  minWager: 10,
  maxWager: 1000,
  minBet: 10,
  maxBet: 500,
};

interface TestUser {
  id: number;
  discordId: string;
}

interface TestToken {
  id: number;
  symbol: string;
  decimals: number;
}

interface SimulationResult {
  matchesSimulated: number;
  predictionsSimulated: number;
  balanceDiscrepancies: number;
  totalBalanceDrift: bigint;
  success: boolean;
}

let testUsers: TestUser[] = [];
let testToken: TestToken;
let predictionMarketService: PredictionMarketService;

/**
 * Setup test environment
 */
async function setup(): Promise<void> {
  console.log("🧪 Setting up simulation environment...\n");

  predictionMarketService = new PredictionMarketService();

  // Get or use first active token
  const token = await prisma.token.findFirst({
    where: { active: true },
    select: { id: true, symbol: true, decimals: true }
  });

  if (!token) {
    throw new Error("No active token found");
  }

  testToken = token;
  console.log(`✅ Using token: ${token.symbol} (decimals: ${token.decimals})`);

  // Create test users
  console.log(`\n📝 Creating ${CONFIG.testUserCount} test users...`);
  for (let i = 0; i < CONFIG.testUserCount; i++) {
    const discordId = `sim_user_${Date.now()}_${i}`;
    const user = await prisma.user.create({
      data: { discordId }
    });

    // Create initial balance for token matches
    await prisma.userBalance.create({
      data: {
        userId: user.id,
        tokenId: token.id,
        amount: new Decimal(CONFIG.initialBalance)
      }
    });

    // Initialize PIPChips balance for predictions
    await prisma.user.update({
      where: { id: user.id },
      data: { pipchipsBalance: BigInt(CONFIG.initialBalance * 100) }
    });

    testUsers.push({ id: user.id, discordId });
  }

  console.log(`✅ Created ${testUsers.length} test users\n`);
}

/**
 * Cleanup test data
 */
async function cleanup(): Promise<void> {
  console.log("\n🧹 Cleaning up simulation data...");

  for (const user of testUsers) {
    await prisma.balanceDelta.deleteMany({ where: { userId: user.id } });
    await prisma.transaction.deleteMany({ where: { userId: user.id } });
    await prisma.pipchipsTransaction.deleteMany({ where: { userId: user.discordId } });
    await prisma.userBalance.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }

  console.log("✅ Cleanup completed");
}

/**
 * Simulate random matches
 */
async function simulateMatches(count: number): Promise<number> {
  console.log(`🎮 Simulating ${count} random matches...\n`);

  let successCount = 0;

  for (let i = 0; i < count; i++) {
    try {
      // Pick two random users
      const challenger = testUsers[Math.floor(Math.random() * testUsers.length)];
      const joiner = testUsers[Math.floor(Math.random() * testUsers.length)];

      // Skip if same user
      if (challenger.id === joiner.id) {
        continue;
      }

      // Random wager between min and max
      const wagerAmount = Math.floor(Math.random() * (CONFIG.maxWager - CONFIG.minWager)) + CONFIG.minWager;
      const wagerAtomic = parseUnits(wagerAmount.toString(), testToken.decimals);

      // Random outcome: 0=tie, 1=challenger wins, 2=joiner wins
      const outcome = Math.floor(Math.random() * 3);

      await prisma.$transaction(async (tx) => {
        // Both players wager
        await debitTokenAtomicTx(tx, challenger.discordId, testToken.id, wagerAtomic, "MATCH_WAGER", {
          guildId: "test_guild"
        });

        await debitTokenAtomicTx(tx, joiner.discordId, testToken.id, wagerAtomic, "MATCH_WAGER", {
          guildId: "test_guild"
        });

        if (outcome === 0) {
          // Tie - refund both
          await creditTokenTx(tx, challenger.discordId, testToken.id, wagerAtomic, "MATCH_PAYOUT", {
            guildId: "test_guild"
          });

          await creditTokenTx(tx, joiner.discordId, testToken.id, wagerAtomic, "MATCH_PAYOUT", {
            guildId: "test_guild"
          });
        } else {
          // Winner takes pot minus 2% rake
          const pot = 2n * wagerAtomic;
          const rake = (pot * 200n) / 10000n; // 2% rake
          const payout = pot - rake;

          const winner = outcome === 1 ? challenger : joiner;
          await creditTokenTx(tx, winner.discordId, testToken.id, payout, "MATCH_PAYOUT", {
            guildId: "test_guild"
          });
        }
      });

      successCount++;

      if ((i + 1) % 25 === 0) {
        console.log(`   ✅ Completed ${i + 1}/${count} matches`);
      }
    } catch (error) {
      console.error(`   ❌ Match ${i + 1} failed:`, (error as Error).message);
    }
  }

  console.log(`\n✅ Simulated ${successCount}/${count} matches successfully\n`);
  return successCount;
}

/**
 * Simulate random prediction market bets
 */
async function simulatePredictions(count: number): Promise<number> {
  console.log(`🔮 Simulating ${count} random prediction markets...\n`);

  let successCount = 0;

  for (let i = 0; i < count; i++) {
    try {
      // Create market
      const creator = testUsers[Math.floor(Math.random() * testUsers.length)];
      const market = await predictionMarketService.createMarket({
        title: `Test Market ${i}`,
        description: `Simulation market ${i}`,
        resolveAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day from now
        creatorId: creator.discordId,
        guildId: "test_guild",
        channelId: "test_channel",
        tokenSymbol: "PIPCHIPS",
        marketType: "custom",
        marketData: {},
        minBet: CONFIG.minBet,
        maxBet: CONFIG.maxBet
      });

      // 3-5 random bets on this market
      const betCount = Math.floor(Math.random() * 3) + 3;
      const bets: Array<{ userId: string; side: 'YES' | 'NO'; amount: number }> = [];

      for (let j = 0; j < betCount; j++) {
        const bettor = testUsers[Math.floor(Math.random() * testUsers.length)];
        const side = Math.random() > 0.5 ? 'YES' : 'NO';
        const amount = Math.floor(Math.random() * (CONFIG.maxBet - CONFIG.minBet)) + CONFIG.minBet;

        await predictionMarketService.placeBet({
          marketId: market.id,
          userId: bettor.discordId,
          side,
          amount
        });

        bets.push({ userId: bettor.discordId, side, amount });
      }

      // Random outcome: YES, NO, or CANCEL
      const outcomes: Array<'YES' | 'NO' | 'CANCEL'> = ['YES', 'NO', 'CANCEL'];
      const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];

      // Resolve market
      await predictionMarketService.resolveMarket(market.id, outcome);

      successCount++;

      if ((i + 1) % 25 === 0) {
        console.log(`   ✅ Completed ${i + 1}/${count} prediction markets`);
      }
    } catch (error) {
      console.error(`   ❌ Prediction ${i + 1} failed:`, (error as Error).message);
    }
  }

  console.log(`\n✅ Simulated ${successCount}/${count} prediction markets successfully\n`);
  return successCount;
}

/**
 * Reconcile balances with BalanceDeltas
 */
async function reconcileBalances(): Promise<{ discrepancies: number; totalDrift: bigint }> {
  console.log("🔍 Reconciling balances with transaction log...\n");

  let discrepancies = 0;
  let totalDrift = 0n;

  // Check token balances
  console.log(`📊 Checking ${testToken.symbol} balances...`);
  for (const user of testUsers) {
    // Get current balance
    const userBalance = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: user.id, tokenId: testToken.id } }
    });

    if (!userBalance) {
      console.error(`   ❌ No balance found for user ${user.id}`);
      discrepancies++;
      continue;
    }

    // Sum BalanceDeltas
    const deltas = await prisma.balanceDelta.findMany({
      where: {
        userId: user.id,
        tokenId: testToken.id
      }
    });

    const deltaSum = deltas.reduce((sum, delta) => {
      return sum + parseUnits(delta.amountDelta.toString(), 0);
    }, 0n);

    // Expected balance = initial + sum of deltas
    const initialBalance = parseUnits(CONFIG.initialBalance.toString(), testToken.decimals);
    const expectedBalance = initialBalance + deltaSum;
    const actualBalance = parseUnits(userBalance.amount.toString(), testToken.decimals);

    // Check drift
    const drift = actualBalance > expectedBalance
      ? actualBalance - expectedBalance
      : expectedBalance - actualBalance;

    const tolerance = 1000n; // 1000 wei tolerance for rounding
    if (drift > tolerance) {
      console.error(`   ❌ Drift for user ${user.id}:`);
      console.error(`      Expected: ${formatUnits(expectedBalance, testToken.decimals)}`);
      console.error(`      Actual:   ${formatUnits(actualBalance, testToken.decimals)}`);
      console.error(`      Drift:    ${formatUnits(drift, testToken.decimals)}`);
      discrepancies++;
      totalDrift += drift;
    }
  }

  // Check PIPChips balances
  console.log(`\n📊 Checking PIPChips balances...`);
  for (const user of testUsers) {
    // Get current PIPChips balance
    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      select: { pipchipsBalance: true }
    });

    if (!userData) {
      console.error(`   ❌ User ${user.id} not found`);
      discrepancies++;
      continue;
    }

    // Sum BalanceDeltas for PIPCHIPS (token ID 2)
    const deltas = await prisma.balanceDelta.findMany({
      where: {
        userId: user.id,
        tokenId: 2 // PIPCHIPS token ID
      }
    });

    const deltaSum = deltas.reduce((sum, delta) => {
      return sum + BigInt(delta.amountDelta.toString());
    }, 0n);

    // Expected balance = initial + sum of deltas
    const initialBalance = BigInt(CONFIG.initialBalance * 100);
    const expectedBalance = initialBalance + deltaSum;
    const actualBalance = userData.pipchipsBalance;

    // Check drift
    const drift = actualBalance > expectedBalance
      ? actualBalance - expectedBalance
      : expectedBalance - actualBalance;

    const tolerance = 1n; // 1 PIPChip tolerance
    if (drift > tolerance) {
      console.error(`   ❌ PIPChips drift for user ${user.id}:`);
      console.error(`      Expected: ${expectedBalance}`);
      console.error(`      Actual:   ${actualBalance}`);
      console.error(`      Drift:    ${drift}`);
      discrepancies++;
      totalDrift += drift;
    }
  }

  if (discrepancies === 0) {
    console.log("\n✅ All balances match transaction log perfectly!");
  } else {
    console.error(`\n❌ Found ${discrepancies} balance discrepancies`);
    console.error(`   Total drift: ${totalDrift} atomic units`);
  }

  return { discrepancies, totalDrift };
}

/**
 * Main simulation runner
 */
async function runSimulation(): Promise<SimulationResult> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   Game Transaction Log Simulation Stress Test             ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  try {
    await setup();

    // Simulate matches
    const matchesSimulated = await simulateMatches(CONFIG.matchCount);

    // Simulate prediction markets
    const predictionsSimulated = await simulatePredictions(CONFIG.predictionMarketCount);

    // Reconcile balances
    const { discrepancies, totalDrift } = await reconcileBalances();

    // Summary
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║   Simulation Results                                       ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");
    console.log(`Test Users: ${testUsers.length}`);
    console.log(`Matches Simulated: ${matchesSimulated}/${CONFIG.matchCount}`);
    console.log(`Predictions Simulated: ${predictionsSimulated}/${CONFIG.predictionMarketCount}`);
    console.log(`Balance Discrepancies: ${discrepancies}`);
    console.log(`Total Balance Drift: ${totalDrift} atomic units`);

    const success = discrepancies === 0;
    console.log(`\nOverall: ${success ? "✅ ALL BALANCES CONSISTENT" : "❌ DISCREPANCIES FOUND"}\n`);

    return {
      matchesSimulated,
      predictionsSimulated,
      balanceDiscrepancies: discrepancies,
      totalBalanceDrift: totalDrift,
      success
    };

  } catch (error) {
    console.error("❌ Simulation failed:", error);
    return {
      matchesSimulated: 0,
      predictionsSimulated: 0,
      balanceDiscrepancies: 0,
      totalBalanceDrift: 0n,
      success: false
    };
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runSimulation().then((result) => {
    process.exit(result.success ? 0 : 1);
  });
}