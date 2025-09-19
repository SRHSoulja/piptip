#!/usr/bin/env npx tsx
// Performance Index Application Script
// Applies critical database indexes with proper error handling and monitoring

import { prisma } from '../src/services/db.js';
import { performance } from 'perf_hooks';

interface IndexResult {
  name: string;
  success: boolean;
  duration: number;
  error?: string;
}

const PERFORMANCE_INDEXES = [
  {
    name: 'Tip_fromUserId_status_createdAt_idx',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Tip_fromUserId_status_createdAt_idx" ON "Tip"("fromUserId", "status", "createdAt");'
  },
  {
    name: 'Tip_toUserId_status_createdAt_idx',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Tip_toUserId_status_createdAt_idx" ON "Tip"("toUserId", "status", "createdAt");'
  },
  {
    name: 'Tip_status_createdAt_amount_idx',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Tip_status_createdAt_amount_idx" ON "Tip"("status", "createdAt", "amountAtomic");'
  },
  {
    name: 'UserBalance_userId_tokenId_amount_idx',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserBalance_userId_tokenId_amount_idx" ON "UserBalance"("userId", "tokenId", "amount");'
  },
  {
    name: 'UserBalance_tokenId_amount_idx',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserBalance_tokenId_amount_idx" ON "UserBalance"("tokenId", "amount");'
  },
  {
    name: 'Match_status_createdAt_idx',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Match_status_createdAt_idx" ON "Match"("status", "createdAt");'
  },
  {
    name: 'Match_challengerId_status_idx',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Match_challengerId_status_idx" ON "Match"("challengerId", "status");'
  },
  {
    name: 'UserStreak_currentWins_lastGameAt_idx',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserStreak_currentWins_lastGameAt_idx" ON "UserStreak"("currentWins" DESC, "lastGameAt" DESC);'
  },
  {
    name: 'Transaction_userId_type_createdAt_idx',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Transaction_userId_type_createdAt_idx" ON "Transaction"("userId", "type", "createdAt");'
  },
  {
    name: 'GroupTip_status_expiresAt_guildId_idx',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "GroupTip_status_expiresAt_guildId_idx" ON "GroupTip"("status", "expiresAt", "guildId");'
  },
  {
    name: 'UserAchievementProgress_userId_lastChecked_idx',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserAchievementProgress_userId_lastChecked_idx" ON "UserAchievementProgress"("userId", "lastCheckedAt");'
  },
  {
    name: 'User_showInPenguBook_bioViewCount_idx',
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_showInPenguBook_bioViewCount_idx" ON "User"("showInPenguBook", "bioViewCount" DESC) WHERE "bio" IS NOT NULL;'
  }
];

async function checkExistingIndexes(): Promise<Set<string>> {
  console.log('🔍 Checking existing indexes...');

  const result = await prisma.$queryRaw<Array<{indexname: string}>>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
    AND indexname LIKE '%_idx'
  `;

  const existingIndexes = new Set(result.map(row => row.indexname));
  console.log(`📊 Found ${existingIndexes.size} existing indexes`);

  return existingIndexes;
}

async function applyIndex(index: typeof PERFORMANCE_INDEXES[0]): Promise<IndexResult> {
  const startTime = performance.now();

  try {
    console.log(`🔨 Creating index: ${index.name}`);

    await prisma.$executeRawUnsafe(index.sql);

    const duration = performance.now() - startTime;
    console.log(`✅ Created ${index.name} in ${Math.round(duration)}ms`);

    return {
      name: index.name,
      success: true,
      duration: Math.round(duration)
    };

  } catch (error: any) {
    const duration = performance.now() - startTime;
    console.error(`❌ Failed to create ${index.name}: ${error.message}`);

    return {
      name: index.name,
      success: false,
      duration: Math.round(duration),
      error: error.message
    };
  }
}

async function validateIndexPerformance(): Promise<void> {
  console.log('🎯 Running performance validation queries...');

  const testQueries = [
    {
      name: 'Tip lookup by user and status',
      query: `SELECT COUNT(*) FROM "Tip" WHERE "fromUserId" = 1 AND status = 'COMPLETED'`
    },
    {
      name: 'Balance lookup by user and token',
      query: `SELECT * FROM "UserBalance" WHERE "userId" = 1 AND "tokenId" = 1 LIMIT 1`
    },
    {
      name: 'Recent matches query',
      query: `SELECT COUNT(*) FROM "Match" WHERE status = 'COMPLETED' AND "createdAt" > NOW() - INTERVAL '7 days'`
    },
    {
      name: 'Leaderboard streak query',
      query: `SELECT COUNT(*) FROM "UserStreak" ORDER BY "currentWins" DESC LIMIT 10`
    }
  ];

  for (const test of testQueries) {
    const startTime = performance.now();

    try {
      await prisma.$queryRawUnsafe(test.query);
      const duration = performance.now() - startTime;

      console.log(`📊 ${test.name}: ${Math.round(duration)}ms`);

      if (duration > 100) {
        console.warn(`⚠️  Query took longer than expected: ${Math.round(duration)}ms`);
      }

    } catch (error: any) {
      console.error(`❌ Test query failed: ${test.name} - ${error.message}`);
    }
  }
}

async function generatePerformanceReport(results: IndexResult[]): Promise<void> {
  console.log('\n📈 Performance Index Application Report');
  console.log('=====================================');

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`✅ Successfully created: ${successful.length} indexes`);
  console.log(`❌ Failed to create: ${failed.length} indexes`);

  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
  console.log(`⏱️  Total time: ${Math.round(totalTime)}ms`);

  if (successful.length > 0) {
    console.log('\n🎯 Successfully Created Indexes:');
    successful.forEach(r => {
      console.log(`  • ${r.name} (${r.duration}ms)`);
    });
  }

  if (failed.length > 0) {
    console.log('\n❌ Failed Indexes:');
    failed.forEach(r => {
      console.log(`  • ${r.name}: ${r.error}`);
    });
  }

  // Database size impact
  try {
    const dbSizeResult = await prisma.$queryRaw<Array<{size: string}>>`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `;
    console.log(`\n💾 Database size: ${dbSizeResult[0]?.size || 'Unknown'}`);
  } catch (error) {
    console.warn('Could not determine database size');
  }
}

async function main() {
  console.log('🚀 Starting Performance Index Application');
  console.log('========================================');

  try {
    // Check current state
    const existingIndexes = await checkExistingIndexes();

    // Filter out indexes that already exist
    const indexesToCreate = PERFORMANCE_INDEXES.filter(index =>
      !existingIndexes.has(index.name)
    );

    console.log(`📝 Planning to create ${indexesToCreate.length} new indexes`);

    if (indexesToCreate.length === 0) {
      console.log('✨ All performance indexes already exist!');
      await validateIndexPerformance();
      return;
    }

    // Apply indexes with progress tracking
    const results: IndexResult[] = [];

    for (let i = 0; i < indexesToCreate.length; i++) {
      const index = indexesToCreate[i];
      console.log(`\n[${i + 1}/${indexesToCreate.length}] Processing ${index.name}`);

      const result = await applyIndex(index);
      results.push(result);

      // Brief pause between index creation to reduce database load
      if (i < indexesToCreate.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Generate comprehensive report
    await generatePerformanceReport(results);

    // Validate performance improvements
    console.log('\n🎯 Validating Performance Improvements');
    console.log('====================================');
    await validateIndexPerformance();

    console.log('\n🎉 Performance index application completed!');

  } catch (error: any) {
    console.error('💥 Fatal error during index application:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle script termination gracefully
process.on('SIGINT', async () => {
  console.log('\n⚠️  Received SIGINT, cleaning up...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  Received SIGTERM, cleaning up...');
  await prisma.$disconnect();
  process.exit(0);
});

// Run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main as applyPerformanceIndexes };