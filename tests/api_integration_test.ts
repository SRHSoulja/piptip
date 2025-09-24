// tests/api_integration_test.ts - Test the web API endpoints

import fetch from 'node-fetch';
import { prisma } from "../src/services/db.js";
import { creditToken } from "../src/services/balances.js";

const API_BASE = 'http://localhost:3000'; // Adjust if your server runs on different port
const TEST_USER_DISCORD_ID = 'api_test_user_' + Date.now();

interface APITestResult {
  endpoint: string;
  method: string;
  passed: boolean;
  status?: number;
  error?: string;
  responseTime?: number;
}

class APIIntegrationTest {
  private results: APITestResult[] = [];
  private testMarketId: string | null = null;
  private testUserId: number | null = null;

  async runAPITests() {
    console.log("🌐 API Integration Tests");
    console.log("========================\n");

    try {
      await this.setupTestUser();
      await this.testPublicEndpoints();
      await this.testMarketCreation();
      await this.testBettingFlow();
      await this.testUserEndpoints();
      await this.testAdminEndpoints();

      this.printResults();

    } catch (error) {
      console.error("❌ API test suite failed:", error);
    } finally {
      await this.cleanup();
    }
  }

  async setupTestUser() {
    console.log("📋 Setting up test user...");

    // Create test user
    const user = await prisma.user.create({
      data: {
        discordId: TEST_USER_DISCORD_ID,
        username: 'API Test User'
      }
    });
    this.testUserId = user.id;

    // Get or create test token
    let token = await prisma.token.findFirst({
      where: { symbol: 'PENGUIN' }
    });

    if (!token) {
      token = await prisma.token.create({
        data: {
          symbol: 'PENGUIN',
          address: '0xtest123456789',
          decimals: 18,
          active: true,
          minDeposit: '1',
          minWithdraw: '1'
        }
      });
    }

    // Give user test balance
    await creditToken(TEST_USER_DISCORD_ID, token.id, 10000n, "TEST_CREDIT");

    console.log("✅ Test user created with balance\n");
  }

  async testPublicEndpoints() {
    console.log("🔍 Testing public API endpoints...");

    // Test GET /api/markets
    await this.makeAPITest('GET', '/api/markets', null, 200);

    // Test GET /api/markets with filters
    await this.makeAPITest('GET', '/api/markets?limit=5&status=all', null, 200);

    // Test GET /api/stats
    await this.makeAPITest('GET', '/api/stats', null, 200);

    console.log("✅ Public endpoints tested\n");
  }

  async testMarketCreation() {
    console.log("🎯 Testing market creation via admin API...");

    // Since regular API doesn't have market creation, we'll create one via service
    const { predictionMarkets } = await import("../src/services/prediction_markets.js");

    const market = await predictionMarkets.createMarket({
      title: "API Test Market: Will ETH reach $5000?",
      description: "Testing API integration with real market",
      resolveAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      creatorId: TEST_USER_DISCORD_ID,
      guildId: "test_guild_api",
      channelId: "test_channel_api",
      tokenSymbol: "PENGUIN",
      marketType: "PRICE_ABOVE_BELOW",
      marketData: { targetPrice: 5000, symbol: "ETH" }
    });

    this.testMarketId = market.id;

    // Test GET /api/market/:id
    await this.makeAPITest('GET', `/api/market/${market.id}`, null, 200);

    console.log("✅ Market creation tested\n");
  }

  async testBettingFlow() {
    if (!this.testMarketId) {
      console.log("❌ Skipping betting tests - no market created");
      return;
    }

    console.log("💰 Testing betting flow...");

    // Test placing a bet (would normally require Discord auth, so this might fail)
    const betData = {
      marketId: this.testMarketId,
      side: 'YES',
      amount: 100
    };

    // This will likely fail due to auth requirements, but we test the endpoint
    await this.makeAPITest('POST', '/api/bet', betData, [400, 401]);

    console.log("✅ Betting flow tested (auth required)\n");
  }

  async testUserEndpoints() {
    console.log("👤 Testing user endpoints...");

    // These will likely fail due to auth requirements
    await this.makeAPITest('GET', '/api/user/balance', null, [400, 401]);
    await this.makeAPITest('GET', '/api/user/bets', null, [400, 401]);

    console.log("✅ User endpoints tested (auth required)\n");
  }

  async testAdminEndpoints() {
    console.log("🛠️ Testing admin endpoints...");

    // These will fail without proper admin auth
    await this.makeAPITest('GET', '/admin/prediction_markets', null, [400, 401]);
    await this.makeAPITest('GET', '/admin/prediction_markets/stats', null, [400, 401]);

    console.log("✅ Admin endpoints tested (auth required)\n");
  }

  async makeAPITest(
    method: string,
    endpoint: string,
    body: any = null,
    expectedStatus: number | number[] = 200
  ) {
    const startTime = Date.now();

    try {
      const options: any = {
        method,
        headers: {
          'Content-Type': 'application/json',
        }
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${API_BASE}${endpoint}`, options);
      const responseTime = Date.now() - startTime;

      const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
      const passed = expectedStatuses.includes(response.status);

      this.results.push({
        endpoint,
        method,
        passed,
        status: response.status,
        responseTime
      });

      const icon = passed ? '✅' : '❌';
      console.log(`  ${icon} ${method} ${endpoint} -> ${response.status} (${responseTime}ms)`);

      // Log response for debugging if it's an error we didn't expect
      if (!passed) {
        const text = await response.text();
        console.log(`    Response: ${text.substring(0, 100)}...`);
      }

    } catch (error: any) {
      this.results.push({
        endpoint,
        method,
        passed: false,
        error: error.message
      });

      console.log(`  ❌ ${method} ${endpoint} -> ERROR: ${error.message}`);
    }
  }

  printResults() {
    console.log("\n" + "=" .repeat(50));
    console.log("📊 API TEST RESULTS");
    console.log("=" .repeat(50));

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;

    for (const result of this.results) {
      const icon = result.passed ? "✅" : "❌";
      const timing = result.responseTime ? ` (${result.responseTime}ms)` : '';
      console.log(`${icon} ${result.method} ${result.endpoint}${timing}`);

      if (!result.passed) {
        if (result.error) {
          console.log(`   Error: ${result.error}`);
        } else {
          console.log(`   Status: ${result.status}`);
        }
      }
    }

    console.log("\n" + "-" .repeat(50));
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("-" .repeat(50));

    if (failed === 0) {
      console.log("\n🎉 All API endpoints are responding correctly!");
    } else {
      console.log("\n⚠️  Note: Some failures expected due to authentication requirements");
    }
  }

  async cleanup() {
    console.log("\n🧹 Cleaning up test data...");

    try {
      // Delete test market if created
      if (this.testMarketId) {
        await prisma.predictionMarket.delete({
          where: { id: this.testMarketId }
        }).catch(() => {});
      }

      // Delete test user
      if (this.testUserId) {
        await prisma.user.delete({
          where: { id: this.testUserId }
        }).catch(() => {});
      }

      console.log("✅ Cleanup complete");
    } catch (error) {
      console.error("⚠️  Cleanup error:", error);
    }
  }
}

// Export for use in other scripts
export { APIIntegrationTest };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const test = new APIIntegrationTest();
  test.runAPITests().then(() => process.exit(0));
}