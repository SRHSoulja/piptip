// test/test_setup.ts - Test infrastructure and setup utilities
import { prisma } from '../src/services/db.js';
import { getActiveTokens } from '../src/services/token.js';

export interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  details?: string;
  error?: string;
  duration?: number;
}

export interface TestSuite {
  name: string;
  results: TestResult[];
  passed: number;
  failed: number;
  duration: number;
}

export class TestRunner {
  private suites: TestSuite[] = [];
  private currentSuite: TestSuite | null = null;

  startSuite(name: string): void {
    this.currentSuite = {
      name,
      results: [],
      passed: 0,
      failed: 0,
      duration: Date.now()
    };
  }

  async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    if (!this.currentSuite) {
      throw new Error('No test suite started');
    }

    const startTime = Date.now();
    let result: TestResult;

    try {
      await testFn();
      result = {
        name,
        status: 'PASS',
        duration: Date.now() - startTime
      };
      this.currentSuite.passed++;
    } catch (error: any) {
      result = {
        name,
        status: 'FAIL',
        error: error.message,
        duration: Date.now() - startTime
      };
      this.currentSuite.failed++;
    }

    this.currentSuite.results.push(result);
  }

  finishSuite(): void {
    if (!this.currentSuite) {
      throw new Error('No test suite started');
    }

    this.currentSuite.duration = Date.now() - this.currentSuite.duration;
    this.suites.push(this.currentSuite);
    this.currentSuite = null;
  }

  generateReport(): string {
    let report = '\n🧪 PREDICTION MARKETS TEST SUITE REPORT\n';
    report += '='.repeat(50) + '\n\n';

    let totalPassed = 0;
    let totalFailed = 0;

    for (const suite of this.suites) {
      totalPassed += suite.passed;
      totalFailed += suite.failed;

      report += `📦 ${suite.name} (${suite.duration}ms)\n`;
      report += `   Passed: ${suite.passed} | Failed: ${suite.failed}\n\n`;

      for (const result of suite.results) {
        const icon = result.status === 'PASS' ? '✅' : '❌';
        report += `   ${icon} ${result.name}`;

        if (result.duration) {
          report += ` (${result.duration}ms)`;
        }

        if (result.details) {
          report += ` - ${result.details}`;
        }

        if (result.error) {
          report += `\n      ERROR: ${result.error}`;
        }

        report += '\n';
      }
      report += '\n';
    }

    report += '='.repeat(50) + '\n';
    report += `SUMMARY: ${totalPassed} passed, ${totalFailed} failed\n`;

    if (totalFailed === 0) {
      report += '🎉 ALL TESTS PASSED - System ready for launch!\n';
    } else {
      report += '⚠️  SOME TESTS FAILED - Address issues before launch\n';
    }

    return report;
  }
}

// Test data management
export class TestDataManager {
  private createdUsers: string[] = [];
  private createdMarkets: string[] = [];
  private testGuildId = 'TEST_GUILD_123456789';

  async setupTestEnvironment(): Promise<void> {
    console.log('🔧 Setting up test environment...');

    // Ensure test guild exists
    await this.ensureTestGuild();

    // Create test tokens if needed
    await this.ensureTestTokens();

    // Create test users
    await this.createTestUsers();

    console.log('✅ Test environment setup complete');
  }

  async cleanupTestData(): Promise<void> {
    console.log('🧹 Cleaning up test data...');

    try {
      // Delete test markets and related data
      if (this.createdMarkets.length > 0) {
        await prisma.bet.deleteMany({
          where: { marketId: { in: this.createdMarkets } }
        });

        await prisma.market.deleteMany({
          where: { id: { in: this.createdMarkets } }
        });
      }

      // Delete test users and related data
      if (this.createdUsers.length > 0) {
        await prisma.balance.deleteMany({
          where: { userId: { in: this.createdUsers } }
        });

        await prisma.user.deleteMany({
          where: { discordId: { in: this.createdUsers } }
        });
      }

      // Delete test auto market logs (if table exists)
      try {
        await prisma.autoMarketLog.deleteMany({
          where: { marketId: { startsWith: 'TEST_' } }
        });
      } catch (error: any) {
        if (!error.message.includes('does not exist')) {
          throw error; // Re-throw if it's not a table doesn't exist error
        }
      }

      console.log('✅ Test data cleanup complete');
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
      throw error;
    }
  }

  private async ensureTestGuild(): Promise<void> {
    const existing = await prisma.approvedServer.findFirst({
      where: { guildId: this.testGuildId }
    });

    if (!existing) {
      await prisma.approvedServer.create({
        data: {
          guildId: this.testGuildId,
          enabled: true,
          note: 'Automated test server'
        }
      });
    }
  }

  private async ensureTestTokens(): Promise<void> {
    const tokens = await getActiveTokens();

    if (tokens.length === 0) {
      // Create a test token if none exist
      await prisma.token.create({
        data: {
          address: '0x1234567890123456789012345678901234567890',
          symbol: 'TEST',
          name: 'Test Token',
          decimals: 18,
          isActive: true,
          minDeposit: '1',
          minWithdraw: '1',
          tipFeePercentage: 3.0,
          houseRakePercentage: 3.0
        }
      });
    }
  }

  private async createTestUsers(): Promise<void> {
    const testUsers = [
      { discordId: 'TEST_USER_1', username: 'TestUser1' },
      { discordId: 'TEST_USER_2', username: 'TestUser2' },
      { discordId: 'TEST_USER_3', username: 'TestUser3' },
      { discordId: 'TEST_USER_4', username: 'TestUser4' },
      { discordId: 'TEST_USER_5', username: 'TestUser5' }
    ];

    const tokens = await getActiveTokens();
    const testToken = tokens[0];

    for (const userData of testUsers) {
      // Create user if doesn't exist
      const existingUser = await prisma.user.findUnique({
        where: { discordId: userData.discordId }
      });

      if (!existingUser) {
        await prisma.user.create({
          data: {
            discordId: userData.discordId,
            username: userData.username,
            walletAddress: `0x${userData.discordId.slice(-40).padStart(40, '0')}`,
            isActive: true
          }
        });

        this.createdUsers.push(userData.discordId);

        // Give test users some balance for testing
        await prisma.balance.create({
          data: {
            userId: userData.discordId,
            tokenId: testToken.id,
            amount: '1000.0' // 1000 tokens for testing
          }
        });
      }
    }
  }

  getTestGuildId(): string {
    return this.testGuildId;
  }

  getTestUsers(): string[] {
    return this.createdUsers;
  }

  addCreatedMarket(marketId: string): void {
    this.createdMarkets.push(marketId);
  }

  async getTestToken() {
    const tokens = await getActiveTokens();
    return tokens[0];
  }
}

// Test assertion utilities
export class TestAssertions {
  static assertEqual<T>(actual: T, expected: T, message?: string): void {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  }

  static assertNotEqual<T>(actual: T, unexpected: T, message?: string): void {
    if (actual === unexpected) {
      throw new Error(message || `Expected not to equal ${unexpected}, got ${actual}`);
    }
  }

  static assertTrue(condition: boolean, message?: string): void {
    if (!condition) {
      throw new Error(message || 'Expected condition to be true');
    }
  }

  static assertFalse(condition: boolean, message?: string): void {
    if (condition) {
      throw new Error(message || 'Expected condition to be false');
    }
  }

  static assertGreaterThan(actual: number, expected: number, message?: string): void {
    if (actual <= expected) {
      throw new Error(message || `Expected ${actual} to be greater than ${expected}`);
    }
  }

  static assertLessThan(actual: number, expected: number, message?: string): void {
    if (actual >= expected) {
      throw new Error(message || `Expected ${actual} to be less than ${expected}`);
    }
  }

  static assertExists<T>(value: T | null | undefined, message?: string): void {
    if (value == null) {
      throw new Error(message || 'Expected value to exist');
    }
  }

  static assertArrayLength<T>(array: T[], expectedLength: number, message?: string): void {
    if (array.length !== expectedLength) {
      throw new Error(message || `Expected array length ${expectedLength}, got ${array.length}`);
    }
  }

  static async assertThrows(fn: () => Promise<void> | void, message?: string): Promise<void> {
    let threw = false;
    try {
      await fn();
    } catch (error) {
      threw = true;
    }

    if (!threw) {
      throw new Error(message || 'Expected function to throw an error');
    }
  }
}

// Mock Discord interaction for testing
export function createMockDiscordInteraction(userId: string, guildId: string) {
  return {
    user: { id: userId },
    guildId,
    channelId: 'TEST_CHANNEL_123',
    reply: async (options: any) => {
      console.log(`Mock reply to ${userId}:`, options.content || options);
    },
    editReply: async (options: any) => {
      console.log(`Mock edit reply to ${userId}:`, options.content || options);
    },
    deferReply: async () => {
      console.log(`Mock defer reply for ${userId}`);
    },
    isRepliable: () => true,
    deferred: false,
    replied: false
  };
}

export const testRunner = new TestRunner();
export const testData = new TestDataManager();
export const assert = TestAssertions;