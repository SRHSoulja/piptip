// tests/prediction_markets_test.ts - Comprehensive prediction markets integration test
import { prisma } from "../src/services/db.js";
import { predictionMarkets } from "../src/services/prediction_markets.js";
import { marketResolver } from "../src/services/market_resolver.js";
import { marketConfig } from "../src/services/market_config.js";
import { creditToken } from "../src/services/balances.js";

// Test configuration
const TEST_GUILD_ID = "test_guild_123";
const TEST_CHANNEL_ID = "test_channel_456";
const TEST_TOKEN_SYMBOL = "PENGUIN";
const RAKE_PERCENTAGE = 3.0; // 3% house rake

// Test users with Discord IDs
const TEST_USERS = [
  { discordId: "test_user_1", name: "Alice" },
  { discordId: "test_user_2", name: "Bob" },
  { discordId: "test_user_3", name: "Charlie" },
  { discordId: "test_user_4", name: "David" }
];

interface TestResult {
  test: string;
  passed: boolean;
  details?: any;
  error?: string;
}

class PredictionMarketsTestSuite {
  private testResults: TestResult[] = [];
  private testMarketIds: string[] = [];
  private testUserIds: number[] = [];

  async runAllTests() {
    console.log("🧪 Starting Prediction Markets Integration Tests\n");
    console.log("=" .repeat(60));

    try {
      // Setup test environment
      await this.setupTestEnvironment();

      // Run all test scenarios
      await this.testBasicMarketFlow();
      await this.testOddsCalculation();
      await this.testMarketResolution();
      await this.testRakeCalculation();
      await this.testEdgeCases();
      await this.testInsufficientBalance();
      await this.testMarketCancellation();

      // Print results
      this.printTestResults();

    } catch (error) {
      console.error("❌ Test suite failed:", error);
    } finally {
      // Cleanup test data
      await this.cleanupTestData();
    }
  }

  /**
   * Setup test environment with users and token balances
   */
  async setupTestEnvironment() {
    console.log("\n📋 Setting up test environment...");

    // Ensure test token exists
    let testToken = await prisma.token.findFirst({
      where: { symbol: TEST_TOKEN_SYMBOL }
    });

    if (!testToken) {
      testToken = await prisma.token.create({
        data: {
          symbol: TEST_TOKEN_SYMBOL,
          address: "0xtest" + Math.random().toString(36).substring(7),
          decimals: 18,
          active: true,
          minDeposit: "1",
          minWithdraw: "1"
        }
      });
    }

    // Create test users with balances
    for (const testUser of TEST_USERS) {
      let user = await prisma.user.findFirst({
        where: { discordId: testUser.discordId }
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            discordId: testUser.discordId,
            username: testUser.name
          }
        });
      }

      this.testUserIds.push(user.id);

      // Give each user 10000 test tokens
      await creditToken(testUser.discordId, testToken.id, 10000n, "TEST_CREDIT");
    }

    console.log("✅ Test environment ready with", TEST_USERS.length, "users");
  }

  /**
   * Test 1: Basic market creation and betting flow
   */
  async testBasicMarketFlow() {
    const testName = "Basic Market Flow";
    console.log(`\n🔬 Test: ${testName}`);

    try {
      // Create a test market
      const market = await predictionMarkets.createMarket({
        title: "Test Market: Will BTC reach $100k?",
        description: "Testing basic market flow",
        resolveAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
        creatorId: TEST_USERS[0].discordId,
        guildId: TEST_GUILD_ID,
        channelId: TEST_CHANNEL_ID,
        tokenSymbol: TEST_TOKEN_SYMBOL,
        marketType: "PRICE_ABOVE_BELOW",
        marketData: { targetPrice: 100000, symbol: "BTC" },
        rakePercentage: RAKE_PERCENTAGE
      });

      this.testMarketIds.push(market.id);

      // Place bets
      const bet1 = await predictionMarkets.placeBet({
        marketId: market.id,
        userId: TEST_USERS[0].discordId,
        side: 'YES',
        amount: 1000
      });

      const bet2 = await predictionMarkets.placeBet({
        marketId: market.id,
        userId: TEST_USERS[1].discordId,
        side: 'NO',
        amount: 500
      });

      // Verify market state
      const updatedMarket = await predictionMarkets.getMarket(market.id);

      const success = updatedMarket !== null &&
        updatedMarket.totalYesBets === 1000 &&
        updatedMarket.totalNoBets === 500 &&
        updatedMarket.totalBetCount === 2;

      this.testResults.push({
        test: testName,
        passed: success,
        details: {
          marketId: market.id,
          totalPool: updatedMarket?.totalYesBets! + updatedMarket?.totalNoBets!,
          betsPlaced: 2
        }
      });

      console.log(success ? "  ✅ Passed" : "  ❌ Failed");

    } catch (error: any) {
      this.testResults.push({
        test: testName,
        passed: false,
        error: error.message
      });
      console.log("  ❌ Failed:", error.message);
    }
  }

  /**
   * Test 2: Verify odds calculation is correct
   */
  async testOddsCalculation() {
    const testName = "Odds Calculation";
    console.log(`\n🔬 Test: ${testName}`);

    try {
      // Create market with known bet distribution
      const market = await predictionMarkets.createMarket({
        title: "Test Odds Market",
        description: "Testing odds calculation",
        resolveAt: new Date(Date.now() + 1000 * 60 * 60),
        creatorId: TEST_USERS[0].discordId,
        guildId: TEST_GUILD_ID,
        channelId: TEST_CHANNEL_ID,
        tokenSymbol: TEST_TOKEN_SYMBOL,
        marketType: "PRICE_UP_DOWN",
        marketData: { symbol: "ETH" },
        rakePercentage: RAKE_PERCENTAGE
      });

      this.testMarketIds.push(market.id);

      // Place bets: 3000 YES, 1000 NO
      await predictionMarkets.placeBet({
        marketId: market.id,
        userId: TEST_USERS[0].discordId,
        side: 'YES',
        amount: 3000
      });

      await predictionMarkets.placeBet({
        marketId: market.id,
        userId: TEST_USERS[1].discordId,
        side: 'NO',
        amount: 1000
      });

      const updatedMarket = await predictionMarkets.getMarket(market.id)!;
      const odds = predictionMarkets.calculateOdds(updatedMarket!);

      // Expected calculations:
      // Total pool = 4000
      // YES probability = 3000/4000 = 0.75 (75%)
      // NO probability = 1000/4000 = 0.25 (25%)
      // With 3% rake:
      // YES odds = (1/0.75) * 0.97 = 1.293
      // NO odds = (1/0.25) * 0.97 = 3.88

      const expectedYesOdds = 1.293;
      const expectedNoOdds = 3.88;

      const success =
        Math.abs(odds.yesOdds - expectedYesOdds) < 0.01 &&
        Math.abs(odds.noOdds - expectedNoOdds) < 0.01 &&
        Math.abs(odds.yesImpliedProb - 0.75) < 0.01 &&
        Math.abs(odds.noImpliedProb - 0.25) < 0.01;

      this.testResults.push({
        test: testName,
        passed: success,
        details: {
          yesOdds: odds.yesOdds.toFixed(3),
          noOdds: odds.noOdds.toFixed(3),
          yesImpliedProb: (odds.yesImpliedProb * 100).toFixed(1) + "%",
          noImpliedProb: (odds.noImpliedProb * 100).toFixed(1) + "%"
        }
      });

      console.log(success ? "  ✅ Passed" : "  ❌ Failed");
      console.log(`    YES odds: ${odds.yesOdds.toFixed(3)}x (expected ~${expectedYesOdds}x)`);
      console.log(`    NO odds: ${odds.noOdds.toFixed(3)}x (expected ~${expectedNoOdds}x)`);

    } catch (error: any) {
      this.testResults.push({
        test: testName,
        passed: false,
        error: error.message
      });
      console.log("  ❌ Failed:", error.message);
    }
  }

  /**
   * Test 3: Market resolution and payout calculation
   */
  async testMarketResolution() {
    const testName = "Market Resolution & Payouts";
    console.log(`\n🔬 Test: ${testName}`);

    try {
      // Create market
      const market = await predictionMarkets.createMarket({
        title: "Test Resolution Market",
        description: "Testing resolution and payouts",
        resolveAt: new Date(Date.now() + 1000 * 60),
        creatorId: TEST_USERS[0].discordId,
        guildId: TEST_GUILD_ID,
        channelId: TEST_CHANNEL_ID,
        tokenSymbol: TEST_TOKEN_SYMBOL,
        marketType: "PRICE_UP_DOWN",
        marketData: { symbol: "SOL" },
        rakePercentage: RAKE_PERCENTAGE
      });

      this.testMarketIds.push(market.id);

      // Get initial balances
      const initialBalances: Record<string, bigint> = {};
      for (const user of TEST_USERS.slice(0, 3)) {
        const balance = await this.getUserBalance(user.discordId);
        initialBalances[user.discordId] = balance;
      }

      // Place bets
      // Alice: 2000 YES
      // Bob: 1000 YES
      // Charlie: 3000 NO
      await predictionMarkets.placeBet({
        marketId: market.id,
        userId: TEST_USERS[0].discordId,
        side: 'YES',
        amount: 2000
      });

      await predictionMarkets.placeBet({
        marketId: market.id,
        userId: TEST_USERS[1].discordId,
        side: 'YES',
        amount: 1000
      });

      await predictionMarkets.placeBet({
        marketId: market.id,
        userId: TEST_USERS[2].discordId,
        side: 'NO',
        amount: 3000
      });

      // Resolve market as YES
      const resolution = await predictionMarkets.resolveMarket(market.id, 'YES');

      // Calculate expected payouts
      // Total pool: 6000
      // House rake (3%): 180
      // Prize pool: 5820
      // YES winners share 5820 based on their bet proportion
      // Alice gets: (2000/3000) * 5820 = 3880
      // Bob gets: (1000/3000) * 5820 = 1940
      // Charlie gets: 0 (lost)

      const finalBalances: Record<string, bigint> = {};
      for (const user of TEST_USERS.slice(0, 3)) {
        const balance = await this.getUserBalance(user.discordId);
        finalBalances[user.discordId] = balance;
      }

      const aliceProfit = Number(finalBalances[TEST_USERS[0].discordId] - initialBalances[TEST_USERS[0].discordId]);
      const bobProfit = Number(finalBalances[TEST_USERS[1].discordId] - initialBalances[TEST_USERS[1].discordId]);
      const charlieLoss = Number(finalBalances[TEST_USERS[2].discordId] - initialBalances[TEST_USERS[2].discordId]);

      const expectedAliceProfit = 3880 - 2000; // 1880
      const expectedBobProfit = 1940 - 1000; // 940
      const expectedCharlieLoss = -3000;

      const success =
        Math.abs(aliceProfit - expectedAliceProfit) < 2 &&
        Math.abs(bobProfit - expectedBobProfit) < 2 &&
        Math.abs(charlieLoss - expectedCharlieLoss) < 2 &&
        resolution.success &&
        resolution.houseRake === 180;

      this.testResults.push({
        test: testName,
        passed: success,
        details: {
          outcome: 'YES',
          totalPool: 6000,
          houseRake: resolution.houseRake,
          aliceProfit,
          bobProfit,
          charlieLoss,
          payouts: resolution.payouts?.length
        }
      });

      console.log(success ? "  ✅ Passed" : "  ❌ Failed");
      console.log(`    House rake: ${resolution.houseRake} (expected 180)`);
      console.log(`    Alice profit: ${aliceProfit} (expected ~${expectedAliceProfit})`);
      console.log(`    Bob profit: ${bobProfit} (expected ~${expectedBobProfit})`);
      console.log(`    Charlie loss: ${charlieLoss} (expected ${expectedCharlieLoss})`);

    } catch (error: any) {
      this.testResults.push({
        test: testName,
        passed: false,
        error: error.message
      });
      console.log("  ❌ Failed:", error.message);
    }
  }

  /**
   * Test 4: Rake calculation verification
   */
  async testRakeCalculation() {
    const testName = "Rake Calculation";
    console.log(`\n🔬 Test: ${testName}`);

    try {
      // Create market with 5% rake
      const market = await predictionMarkets.createMarket({
        title: "Test Rake Market",
        description: "Testing rake calculation",
        resolveAt: new Date(Date.now() + 1000 * 60),
        creatorId: TEST_USERS[0].discordId,
        guildId: TEST_GUILD_ID,
        channelId: TEST_CHANNEL_ID,
        tokenSymbol: TEST_TOKEN_SYMBOL,
        marketType: "PRICE_UP_DOWN",
        marketData: { symbol: "AVAX" },
        rakePercentage: 5.0
      });

      this.testMarketIds.push(market.id);

      // Place bets totaling 10000
      await predictionMarkets.placeBet({
        marketId: market.id,
        userId: TEST_USERS[0].discordId,
        side: 'YES',
        amount: 6000
      });

      await predictionMarkets.placeBet({
        marketId: market.id,
        userId: TEST_USERS[1].discordId,
        side: 'NO',
        amount: 4000
      });

      // Resolve market
      const resolution = await predictionMarkets.resolveMarket(market.id, 'YES');

      // Expected rake: 10000 * 0.05 = 500
      const expectedRake = 500;
      const actualRake = resolution.houseRake || 0;

      const success = actualRake === expectedRake;

      this.testResults.push({
        test: testName,
        passed: success,
        details: {
          totalPool: 10000,
          rakePercentage: 5.0,
          expectedRake,
          actualRake
        }
      });

      console.log(success ? "  ✅ Passed" : "  ❌ Failed");
      console.log(`    Rake collected: ${actualRake} (expected ${expectedRake})`);

    } catch (error: any) {
      this.testResults.push({
        test: testName,
        passed: false,
        error: error.message
      });
      console.log("  ❌ Failed:", error.message);
    }
  }

  /**
   * Test 5: Edge cases
   */
  async testEdgeCases() {
    const testName = "Edge Cases";
    console.log(`\n🔬 Test: ${testName}`);

    const subTests = {
      oneSidedMarket: false,
      equalPools: false,
      minBetValidation: false
    };

    try {
      // Test 5.1: Market with only one side betting (should cancel/refund)
      console.log("  📍 Testing one-sided market...");
      const oneSidedMarket = await predictionMarkets.createMarket({
        title: "One-sided Market Test",
        description: "Should be cancelled due to one-sided betting",
        resolveAt: new Date(Date.now() + 1000 * 60),
        creatorId: TEST_USERS[0].discordId,
        guildId: TEST_GUILD_ID,
        channelId: TEST_CHANNEL_ID,
        tokenSymbol: TEST_TOKEN_SYMBOL,
        marketType: "PRICE_UP_DOWN",
        marketData: { symbol: "DOGE" }
      });

      this.testMarketIds.push(oneSidedMarket.id);

      const initialBalance = await this.getUserBalance(TEST_USERS[0].discordId);

      await predictionMarkets.placeBet({
        marketId: oneSidedMarket.id,
        userId: TEST_USERS[0].discordId,
        side: 'YES',
        amount: 1000
      });

      // Try to resolve - should cancel and refund
      const oneSidedResolution = await predictionMarkets.resolveMarket(oneSidedMarket.id, 'YES');

      const finalBalance = await this.getUserBalance(TEST_USERS[0].discordId);
      const refunded = Number(finalBalance) === Number(initialBalance);

      subTests.oneSidedMarket = oneSidedResolution.success && refunded;
      console.log(`    One-sided market: ${subTests.oneSidedMarket ? '✅' : '❌'} (refunded: ${refunded})`);

      // Test 5.2: Market with exactly equal pools
      console.log("  📍 Testing equal pools market...");
      const equalPoolsMarket = await predictionMarkets.createMarket({
        title: "Equal Pools Market Test",
        description: "Testing with equal YES/NO pools",
        resolveAt: new Date(Date.now() + 1000 * 60),
        creatorId: TEST_USERS[0].discordId,
        guildId: TEST_GUILD_ID,
        channelId: TEST_CHANNEL_ID,
        tokenSymbol: TEST_TOKEN_SYMBOL,
        marketType: "PRICE_UP_DOWN",
        marketData: { symbol: "MATIC" },
        rakePercentage: RAKE_PERCENTAGE
      });

      this.testMarketIds.push(equalPoolsMarket.id);

      await predictionMarkets.placeBet({
        marketId: equalPoolsMarket.id,
        userId: TEST_USERS[0].discordId,
        side: 'YES',
        amount: 1000
      });

      await predictionMarkets.placeBet({
        marketId: equalPoolsMarket.id,
        userId: TEST_USERS[1].discordId,
        side: 'NO',
        amount: 1000
      });

      const equalMarket = await predictionMarkets.getMarket(equalPoolsMarket.id);
      const equalOdds = predictionMarkets.calculateOdds(equalMarket!);

      // With equal pools and 3% rake, both odds should be ~1.94x
      const expectedOdds = 1.94;
      subTests.equalPools =
        Math.abs(equalOdds.yesOdds - expectedOdds) < 0.01 &&
        Math.abs(equalOdds.noOdds - expectedOdds) < 0.01;

      console.log(`    Equal pools odds: ${subTests.equalPools ? '✅' : '❌'} (YES: ${equalOdds.yesOdds.toFixed(2)}x, NO: ${equalOdds.noOdds.toFixed(2)}x)`);

      // Test 5.3: Minimum bet validation
      console.log("  📍 Testing minimum bet validation...");
      const minBetMarket = await predictionMarkets.createMarket({
        title: "Min Bet Test",
        description: "Testing minimum bet validation",
        resolveAt: new Date(Date.now() + 1000 * 60),
        creatorId: TEST_USERS[0].discordId,
        guildId: TEST_GUILD_ID,
        channelId: TEST_CHANNEL_ID,
        tokenSymbol: TEST_TOKEN_SYMBOL,
        marketType: "PRICE_UP_DOWN",
        marketData: { symbol: "ADA" },
        minBet: 100
      });

      this.testMarketIds.push(minBetMarket.id);

      // Try to place bet below minimum
      const lowBet = await predictionMarkets.placeBet({
        marketId: minBetMarket.id,
        userId: TEST_USERS[0].discordId,
        side: 'YES',
        amount: 50 // Below minimum of 100
      });

      subTests.minBetValidation = !lowBet.success && lowBet.error?.includes("between");
      console.log(`    Min bet validation: ${subTests.minBetValidation ? '✅' : '❌'}`);

      const allPassed = Object.values(subTests).every(v => v);

      this.testResults.push({
        test: testName,
        passed: allPassed,
        details: subTests
      });

      console.log(allPassed ? "  ✅ All edge cases passed" : "  ❌ Some edge cases failed");

    } catch (error: any) {
      this.testResults.push({
        test: testName,
        passed: false,
        error: error.message
      });
      console.log("  ❌ Failed:", error.message);
    }
  }

  /**
   * Test 6: Insufficient balance handling
   */
  async testInsufficientBalance() {
    const testName = "Insufficient Balance";
    console.log(`\n🔬 Test: ${testName}`);

    try {
      // Create a market
      const market = await predictionMarkets.createMarket({
        title: "Balance Test Market",
        description: "Testing insufficient balance handling",
        resolveAt: new Date(Date.now() + 1000 * 60),
        creatorId: TEST_USERS[0].discordId,
        guildId: TEST_GUILD_ID,
        channelId: TEST_CHANNEL_ID,
        tokenSymbol: TEST_TOKEN_SYMBOL,
        marketType: "PRICE_UP_DOWN",
        marketData: { symbol: "LINK" }
      });

      this.testMarketIds.push(market.id);

      // Try to bet more than balance (users have 10000 initially minus previous bets)
      const hugeBet = await predictionMarkets.placeBet({
        marketId: market.id,
        userId: TEST_USERS[3].discordId, // David hasn't bet yet
        side: 'YES',
        amount: 50000 // Way more than balance
      });

      const success = !hugeBet.success && hugeBet.error?.toLowerCase().includes("insufficient");

      this.testResults.push({
        test: testName,
        passed: success,
        details: {
          attemptedBet: 50000,
          userBalance: 10000,
          error: hugeBet.error
        }
      });

      console.log(success ? "  ✅ Passed" : "  ❌ Failed");
      console.log(`    Error message: "${hugeBet.error}"`);

    } catch (error: any) {
      this.testResults.push({
        test: testName,
        passed: false,
        error: error.message
      });
      console.log("  ❌ Failed:", error.message);
    }
  }

  /**
   * Test 7: Market cancellation and refunds
   */
  async testMarketCancellation() {
    const testName = "Market Cancellation";
    console.log(`\n🔬 Test: ${testName}`);

    try {
      // Create a market
      const market = await predictionMarkets.createMarket({
        title: "Cancellation Test Market",
        description: "Testing market cancellation and refunds",
        resolveAt: new Date(Date.now() + 1000 * 60),
        creatorId: TEST_USERS[0].discordId,
        guildId: TEST_GUILD_ID,
        channelId: TEST_CHANNEL_ID,
        tokenSymbol: TEST_TOKEN_SYMBOL,
        marketType: "PRICE_UP_DOWN",
        marketData: { symbol: "DOT" }
      });

      this.testMarketIds.push(market.id);

      // Track balances before betting
      const balancesBefore: Record<string, bigint> = {};
      for (const user of TEST_USERS.slice(0, 2)) {
        balancesBefore[user.discordId] = await this.getUserBalance(user.discordId);
      }

      // Place bets
      await predictionMarkets.placeBet({
        marketId: market.id,
        userId: TEST_USERS[0].discordId,
        side: 'YES',
        amount: 1500
      });

      await predictionMarkets.placeBet({
        marketId: market.id,
        userId: TEST_USERS[1].discordId,
        side: 'NO',
        amount: 2500
      });

      // Cancel the market
      const cancellation = await predictionMarkets.resolveMarket(market.id, 'CANCEL');

      // Check balances after cancellation
      const balancesAfter: Record<string, bigint> = {};
      for (const user of TEST_USERS.slice(0, 2)) {
        balancesAfter[user.discordId] = await this.getUserBalance(user.discordId);
      }

      // Verify full refunds (balances should be same as before)
      const aliceRefunded = balancesAfter[TEST_USERS[0].discordId] === balancesBefore[TEST_USERS[0].discordId];
      const bobRefunded = balancesAfter[TEST_USERS[1].discordId] === balancesBefore[TEST_USERS[1].discordId];

      const success = cancellation.success && aliceRefunded && bobRefunded;

      this.testResults.push({
        test: testName,
        passed: success,
        details: {
          refunds: cancellation.payouts?.length,
          aliceRefunded,
          bobRefunded
        }
      });

      console.log(success ? "  ✅ Passed" : "  ❌ Failed");
      console.log(`    Refunds processed: ${cancellation.payouts?.length}`);
      console.log(`    All balances restored: ${aliceRefunded && bobRefunded ? 'Yes' : 'No'}`);

    } catch (error: any) {
      this.testResults.push({
        test: testName,
        passed: false,
        error: error.message
      });
      console.log("  ❌ Failed:", error.message);
    }
  }

  /**
   * Helper: Get user balance
   */
  async getUserBalance(discordId: string): Promise<bigint> {
    const user = await prisma.user.findFirst({
      where: { discordId }
    });

    if (!user) return 0n;

    const balance = await prisma.userBalance.findFirst({
      where: {
        userId: user.id,
        Token: { symbol: TEST_TOKEN_SYMBOL }
      }
    });

    return BigInt(balance?.amount || 0);
  }

  /**
   * Print test results summary
   */
  printTestResults() {
    console.log("\n" + "=" .repeat(60));
    console.log("📊 TEST RESULTS SUMMARY");
    console.log("=" .repeat(60));

    const passed = this.testResults.filter(r => r.passed).length;
    const failed = this.testResults.filter(r => !r.passed).length;
    const total = this.testResults.length;

    for (const result of this.testResults) {
      const icon = result.passed ? "✅" : "❌";
      console.log(`${icon} ${result.test}`);
      if (!result.passed && result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }

    console.log("\n" + "-" .repeat(60));
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed} (${((passed/total) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${failed}`);
    console.log("-" .repeat(60));

    if (failed === 0) {
      console.log("\n🎉 ALL TESTS PASSED! The prediction markets system is working correctly!");
    } else {
      console.log("\n⚠️  Some tests failed. Please review the errors above.");
    }
  }

  /**
   * Cleanup test data
   */
  async cleanupTestData() {
    console.log("\n🧹 Cleaning up test data...");

    try {
      // Delete test markets and their bets (cascade delete)
      for (const marketId of this.testMarketIds) {
        await prisma.predictionMarket.delete({
          where: { id: marketId }
        }).catch(() => {}); // Ignore if already deleted
      }

      console.log("✅ Test cleanup complete");
    } catch (error) {
      console.error("⚠️  Cleanup error:", error);
    }
  }
}

// Run the test suite
async function main() {
  const testSuite = new PredictionMarketsTestSuite();
  await testSuite.runAllTests();
  process.exit(0);
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { PredictionMarketsTestSuite };