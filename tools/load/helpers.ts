// tests/load/helpers.ts - Load test utilities and helpers
import { PrismaClient, Prisma } from '@prisma/client';
import { formatAmount, decToBigDirect } from '../../src/services/token.js';
import { creditToken } from '../../src/services/balances.js';

const prisma = new PrismaClient();

// Configuration from environment
export const CONFIG = {
  USERS: parseInt(process.env.USERS || '100'),
  TOKENS: parseInt(process.env.TOKENS || '2'),
  SINGLE_TIPS: parseInt(process.env.SINGLE_TIPS || '1000'),
  GROUP_TIPS: parseInt(process.env.GROUP_TIPS || '100'),
  CLAIMERS_MIN: 10,
  CLAIMERS_MAX: 30,
  EXPIRE_COUNT: parseInt(process.env.EXPIRE_COUNT || '50'),
  CONCURRENCY: parseInt(process.env.CONCURRENCY || '50'),
  INITIAL_BALANCE: '10000', // 10,000 tokens per user
};

// Types for test data
export interface TestUser {
  id: number;
  discordId: string;
}

export interface TestToken {
  id: number;
  symbol: string;
  decimals: number;
  address: string;
}

export interface TestStats {
  startTime: number;
  durations: number[];
  errors: string[];
  slowQueries: Array<{ operation: string; duration: number; query?: string }>;
  uniqueViolations: number;
}

export interface LoadTestResult {
  success: boolean;
  stats: {
    users: number;
    tokens: number;
    singleTips: number;
    groupTips: number;
    totalClaims: number;
    uniqueViolations: number;
    errors: number;
    slowQueries: number;
  };
  performance: {
    totalDuration: number;
    p50Duration: number;
    p95Duration: number;
    avgTipsPerSecond: number;
  };
  invariants: {
    noNegativeBalances: boolean;
    balanceConservation: boolean;
    transactionConsistency: boolean;
    refundIdempotency: boolean;
    claimUniqueness: boolean;
  };
  failures?: any[];
}

// Utility functions
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

export function randomAmount(maxBalance: string, decimals: number): bigint {
  // Generate random amount between 1 and 10% of max balance
  const maxAtomic = decToBigDirect(maxBalance, decimals);
  const maxTip = maxAtomic / BigInt(10); // Max 10% of balance
  return BigInt(Math.floor(Math.random() * Number(maxTip))) + BigInt(1);
}

export function batchArray<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

export function calculatePercentile(values: number[], percentile: number): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] || 0;
}

// Clean up any existing test data
export async function cleanupTestData(): Promise<void> {
  console.log('🧹 Cleaning up existing test data...');
  
  // Get test user IDs for cleanup
  const testUsers = await prisma.user.findMany({
    where: { discordId: { startsWith: 'load_test_' } },
    select: { id: true }
  });
  const testUserIds = testUsers.map(u => u.id);
  
  const testTokens = await prisma.token.findMany({
    where: { symbol: { startsWith: 'LOAD_' } },
    select: { id: true }
  });
  const testTokenIds = testTokens.map(t => t.id);
  
  // Delete in correct order to avoid foreign key violations
  if (testUserIds.length > 0) {
    await prisma.transaction.deleteMany({
      where: { 
        OR: [
          { metadata: { contains: 'load_test' } },
          { userId: { in: testUserIds } }
        ]
      }
    });
  }
  
  if (testUserIds.length > 0) {
    await prisma.tip.deleteMany({
      where: { 
        OR: [
          { fromUserId: { in: testUserIds } },
          { toUserId: { in: testUserIds } }
        ]
      }
    });
    
    await prisma.groupTipClaim.deleteMany({
      where: { userId: { in: testUserIds } }
    });
    
    await prisma.groupTip.deleteMany({
      where: { creatorId: { in: testUserIds } }
    });
  }
  
  if (testUserIds.length > 0 || testTokenIds.length > 0) {
    await prisma.userBalance.deleteMany({
      where: { 
        OR: [
          ...(testUserIds.length > 0 ? [{ userId: { in: testUserIds } }] : []),
          ...(testTokenIds.length > 0 ? [{ tokenId: { in: testTokenIds } }] : [])
        ]
      }
    });
  }
  
  await prisma.user.deleteMany({
    where: { discordId: { startsWith: 'load_test_' } }
  });
  
  await prisma.token.deleteMany({
    where: { symbol: { startsWith: 'LOAD_' } }
  });
}

// Create test users
export async function createTestUsers(count: number): Promise<TestUser[]> {
  console.log(`👥 Creating ${count} test users...`);
  
  const users: TestUser[] = [];
  const batchSize = 100; // Create users in batches for better performance
  
  for (let i = 0; i < count; i += batchSize) {
    const batch = [];
    const batchEnd = Math.min(i + batchSize, count);
    
    for (let j = i; j < batchEnd; j++) {
      batch.push({
        discordId: `load_test_user_${j.toString().padStart(6, '0')}`,
      });
    }
    
    const created = await prisma.user.createMany({
      data: batch,
      skipDuplicates: true,
    });
    
    // Fetch the created users to get their IDs
    const createdUsers = await prisma.user.findMany({
      where: { discordId: { in: batch.map(u => u.discordId) } },
      select: { id: true, discordId: true }
    });
    
    users.push(...createdUsers);
  }
  
  return users;
}

// Create test tokens
export async function createTestTokens(count: number): Promise<TestToken[]> {
  console.log(`🪙 Creating ${count} test tokens...`);
  
  const tokens: TestToken[] = [];
  
  for (let i = 0; i < count; i++) {
    const token = await prisma.token.create({
      data: {
        symbol: `LOAD_${i.toString().padStart(2, '0')}`,
        address: `0x${Math.random().toString(16).substr(2, 40)}`,
        decimals: 6, // Standard 6 decimals
        active: true,
        minDeposit: '1',
        minWithdraw: '1',
      }
    });
    
    tokens.push({
      id: token.id,
      symbol: token.symbol,
      decimals: token.decimals,
      address: token.address,
    });
  }
  
  return tokens;
}

// Fund user balances
export async function fundUserBalances(users: TestUser[], tokens: TestToken[]): Promise<void> {
  console.log(`💰 Funding ${users.length} users with ${CONFIG.INITIAL_BALANCE} tokens each...`);
  
  const balanceData = [];
  const transactionData = [];
  
  for (const user of users) {
    for (const token of tokens) {
      // Create balance entry
      balanceData.push({
        userId: user.id,
        tokenId: token.id,
        amount: CONFIG.INITIAL_BALANCE,
      });
      
      // Create corresponding transaction for accounting
      transactionData.push({
        type: 'DEPOSIT',
        userId: user.id,
        tokenId: token.id,
        amount: CONFIG.INITIAL_BALANCE,
        fee: '0',
        guildId: null,
        metadata: JSON.stringify({ kind: 'LOAD_TEST_INITIAL_FUNDING' }),
      });
    }
  }
  
  // Insert in batches for better performance
  const batchSize = 1000;
  
  for (let i = 0; i < balanceData.length; i += batchSize) {
    const batch = balanceData.slice(i, i + batchSize);
    await prisma.userBalance.createMany({
      data: batch,
      skipDuplicates: true,
    });
  }
  
  for (let i = 0; i < transactionData.length; i += batchSize) {
    const batch = transactionData.slice(i, i + batchSize);
    await prisma.transaction.createMany({
      data: batch,
      skipDuplicates: true,
    });
  }
}

// Integrity checks
export async function assertNoNegativeBalances(): Promise<boolean> {
  const testUsers = await prisma.user.findMany({
    where: { discordId: { startsWith: 'load_test_' } },
    select: { id: true }
  });
  const testUserIds = testUsers.map(u => u.id);
  
  if (testUserIds.length === 0) return true;
  
  const negativeBalances = await prisma.userBalance.findMany({
    where: { 
      amount: { lt: '0' },
      userId: { in: testUserIds }
    },
    include: { User: true, Token: true }
  });
  
  if (negativeBalances.length > 0) {
    console.error(`❌ Found ${negativeBalances.length} negative balances:`, 
      negativeBalances.map(b => ({
        user: b.User.discordId,
        token: b.Token.symbol,
        balance: b.amount
      }))
    );
    return false;
  }
  
  return true;
}

export async function checkBalanceConservation(
  initialFunding: bigint,
  users: TestUser[],
  tokens: TestToken[]
): Promise<boolean> {
  console.log('💹 Checking balance conservation...');
  
  const testUsers = await prisma.user.findMany({
    where: { discordId: { startsWith: 'load_test_' } },
    select: { id: true }
  });
  const testUserIds = testUsers.map(u => u.id);
  
  const testTokens = await prisma.token.findMany({
    where: { symbol: { startsWith: 'LOAD_' } },
    select: { id: true }
  });
  const testTokenIds = testTokens.map(t => t.id);
  
  if (testUserIds.length === 0 || testTokenIds.length === 0) return true;
  
  // Calculate total current balances
  const currentBalances = await prisma.userBalance.findMany({
    where: {
      userId: { in: testUserIds },
      tokenId: { in: testTokenIds }
    }
  });
  
  const totalCurrentBalance = currentBalances.reduce((sum, balance) => {
    return sum + BigInt(balance.amount.toString());
  }, BigInt(0));
  
  // Calculate total deposits from transactions
  const deposits = await prisma.transaction.findMany({
    where: {
      type: 'DEPOSIT',
      userId: { in: testUserIds },
      tokenId: { in: testTokenIds }
    }
  });
  
  const totalDeposits = deposits.reduce((sum, tx) => {
    return sum + BigInt(tx.amount.toString());
  }, BigInt(0));
  
  // Calculate total withdrawals (if any)
  const withdrawals = await prisma.transaction.findMany({
    where: {
      type: 'WITHDRAWAL',
      userId: { in: testUserIds },
      tokenId: { in: testTokenIds }
    }
  });
  
  const totalWithdrawals = withdrawals.reduce((sum, tx) => {
    return sum + BigInt(tx.amount.toString());
  }, BigInt(0));
  
  // Expected balance = deposits - withdrawals
  const expectedBalance = totalDeposits - totalWithdrawals;
  
  if (totalCurrentBalance !== expectedBalance) {
    console.error(`❌ Balance conservation failed:`);
    console.error(`  Current total: ${totalCurrentBalance}`);
    console.error(`  Expected total: ${expectedBalance}`);
    console.error(`  Deposits: ${totalDeposits}`);
    console.error(`  Withdrawals: ${totalWithdrawals}`);
    console.error(`  Difference: ${totalCurrentBalance - expectedBalance}`);
    return false;
  }
  
  console.log(`✅ Balance conservation verified (${totalCurrentBalance} tokens)`);
  return true;
}

export async function checkTransactionConsistency(): Promise<boolean> {
  console.log('📊 Checking transaction consistency...');
  
  // Check that every COMPLETED tip has a corresponding transaction
  const completedTips = await prisma.tip.findMany({
    where: {
      status: 'COMPLETED',
      From: { discordId: { startsWith: 'load_test_' } }
    }
  });
  
  for (const tip of completedTips) {
    const transaction = await prisma.transaction.findFirst({
      where: {
        type: 'TIP',
        userId: tip.fromUserId,
        otherUserId: tip.toUserId,
        tokenId: tip.tokenId,
        amount: tip.amountAtomic,
      }
    });
    
    if (!transaction) {
      console.error(`❌ Missing transaction for tip ${tip.id}`);
      return false;
    }
  }
  
  console.log(`✅ Transaction consistency verified (${completedTips.length} tips)`);
  return true;
}

export async function checkClaimUniqueness(): Promise<boolean> {
  console.log('🔒 Checking claim uniqueness...');
  
  const duplicateClaims = await prisma.$queryRaw<Array<{ groupTipId: number; userId: number; count: number }>>`
    SELECT "groupTipId", "userId", COUNT(*) as count
    FROM "GroupTipClaim" 
    WHERE "userId" IN (
      SELECT id FROM "User" WHERE "discordId" LIKE 'load_test_%'
    )
    GROUP BY "groupTipId", "userId"
    HAVING COUNT(*) > 1
  `;
  
  if (duplicateClaims.length > 0) {
    console.error(`❌ Found ${duplicateClaims.length} duplicate claims:`, duplicateClaims);
    return false;
  }
  
  console.log('✅ Claim uniqueness verified');
  return true;
}

// Performance tracking
export class PerformanceTracker {
  private stats: TestStats = {
    startTime: Date.now(),
    durations: [],
    errors: [],
    slowQueries: [],
    uniqueViolations: 0,
  };
  
  startOperation(): number {
    return Date.now();
  }
  
  endOperation(startTime: number, operation?: string): void {
    const duration = Date.now() - startTime;
    this.stats.durations.push(duration);
    
    if (duration > 300 && operation) {
      this.stats.slowQueries.push({ operation, duration });
      console.warn(`⚠️ Slow operation: ${operation} took ${duration}ms`);
    }
  }
  
  recordError(error: string): void {
    this.stats.errors.push(error);
  }
  
  recordUniqueViolation(): void {
    this.stats.uniqueViolations++;
  }
  
  getStats(): TestStats {
    return { ...this.stats };
  }
  
  getTotalDuration(): number {
    return Date.now() - this.stats.startTime;
  }
  
  getP50Duration(): number {
    return calculatePercentile(this.stats.durations, 50);
  }
  
  getP95Duration(): number {
    return calculatePercentile(this.stats.durations, 95);
  }
}

// Write failure details to file
export async function writeFailureReport(failures: any[]): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `tests/load/failures-${timestamp}.json`;
  
  try {
    const fs = await import('fs');
    fs.writeFileSync(filename, JSON.stringify(failures, null, 2));
    console.log(`📄 Failure details written to ${filename}`);
  } catch (error) {
    console.error('Failed to write failure report:', error);
  }
}

export { prisma };