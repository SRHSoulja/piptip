#!/usr/bin/env tsx

/**
 * Critical Database Index Validation Script
 *
 * This script validates that all critical performance indexes have been created
 * and provides performance monitoring queries to verify their effectiveness.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface IndexInfo {
  schemaname: string;
  tablename: string;
  indexname: string;
  indexdef: string;
}

interface QueryPlan {
  plan: string;
}

const CRITICAL_INDEXES = [
  {
    name: 'User_discordId_idx',
    table: 'User',
    columns: ['discordId'],
    description: 'Discord ID lookups (highest frequency)',
    testQuery: `SELECT * FROM "User" WHERE "discordId" = 'test_user_123'`
  },
  {
    name: 'UserBalance_userId_idx',
    table: 'UserBalance',
    columns: ['userId'],
    description: 'User balance lookups',
    testQuery: `SELECT * FROM "UserBalance" WHERE "userId" = 1`
  },
  {
    name: 'UserBalance_tokenId_idx',
    table: 'UserBalance',
    columns: ['tokenId'],
    description: 'Token balance queries',
    testQuery: `SELECT * FROM "UserBalance" WHERE "tokenId" = 1`
  },
  {
    name: 'PredictionMarket_status_guildId_createdAt_idx',
    table: 'PredictionMarket',
    columns: ['status', 'guildId', 'createdAt'],
    description: 'Active markets by guild',
    testQuery: `SELECT * FROM "PredictionMarket" WHERE "status" = 'ACTIVE' AND "guildId" = 'test_guild'`
  },
  {
    name: 'PredictionParticipation_userId_createdAt_idx',
    table: 'PredictionParticipation',
    columns: ['userId', 'createdAt'],
    description: 'User betting history',
    testQuery: `SELECT * FROM "PredictionParticipation" WHERE "userId" = 'test_user' ORDER BY "createdAt" DESC`
  },
  {
    name: 'ActivityFeedItem_visibility_createdAt_idx',
    table: 'ActivityFeedItem',
    columns: ['visibility', 'createdAt'],
    description: 'Public activity feed',
    testQuery: `SELECT * FROM "ActivityFeedItem" WHERE "visibility" = 'public' ORDER BY "createdAt" DESC`
  },
  {
    name: 'Transaction_userId_createdAt_idx',
    table: 'Transaction',
    columns: ['userId', 'createdAt'],
    description: 'User transaction history',
    testQuery: `SELECT * FROM "Transaction" WHERE "userId" = 1 ORDER BY "createdAt" DESC`
  },
  {
    name: 'Tip_status_createdAt_idx',
    table: 'Tip',
    columns: ['status', 'createdAt'],
    description: 'Recent completed tips',
    testQuery: `SELECT * FROM "Tip" WHERE "status" = 'COMPLETED' ORDER BY "createdAt" DESC`
  },
  {
    name: 'Notification_sentAt_createdAt_idx',
    table: 'Notification',
    columns: ['sentAt', 'createdAt'],
    description: 'Pending notifications',
    testQuery: `SELECT * FROM "Notification" WHERE "sentAt" IS NULL ORDER BY "createdAt"`
  }
];

async function validateIndexExists(indexName: string): Promise<boolean> {
  try {
    const result = await prisma.$queryRaw<IndexInfo[]>`
      SELECT schemaname, tablename, indexname, indexdef
      FROM pg_indexes
      WHERE indexname = ${indexName}
      AND schemaname = 'public'
    `;

    return result.length > 0;
  } catch (error) {
    console.error(`Error checking index ${indexName}:`, error);
    return false;
  }
}

async function analyzeQueryPlan(query: string): Promise<string[]> {
  try {
    const result = await prisma.$queryRaw<QueryPlan[]>`EXPLAIN (FORMAT TEXT) ${query}`;
    return result.map(row => row.plan);
  } catch (error) {
    console.error(`Error analyzing query plan:`, error);
    return [`Error: ${error}`];
  }
}

async function checkIndexUsage(indexName: string): Promise<{calls: bigint, tuples: bigint} | null> {
  try {
    const result = await prisma.$queryRaw<{idx_scan: bigint, idx_tup_read: bigint}[]>`
      SELECT idx_scan, idx_tup_read
      FROM pg_stat_user_indexes
      WHERE indexrelname = ${indexName}
    `;

    if (result.length > 0) {
      return {
        calls: result[0].idx_scan,
        tuples: result[0].idx_tup_read
      };
    }
    return null;
  } catch (error) {
    console.error(`Error checking index usage for ${indexName}:`, error);
    return null;
  }
}

async function getTableStats(tableName: string): Promise<{rows: bigint, size: string} | null> {
  try {
    const result = await prisma.$queryRaw<{n_tup_ins: bigint, n_tup_upd: bigint, n_tup_del: bigint, n_live_tup: bigint}[]>`
      SELECT n_tup_ins, n_tup_upd, n_tup_del, n_live_tup
      FROM pg_stat_user_tables
      WHERE relname = ${tableName}
    `;

    const sizeResult = await prisma.$queryRaw<{size: string}[]>`
      SELECT pg_size_pretty(pg_total_relation_size(${tableName}::regclass)) as size
    `;

    if (result.length > 0 && sizeResult.length > 0) {
      return {
        rows: result[0].n_live_tup,
        size: sizeResult[0].size
      };
    }
    return null;
  } catch (error) {
    console.error(`Error getting table stats for ${tableName}:`, error);
    return null;
  }
}

async function main() {
  console.log('🔍 PIPtip Critical Database Index Validation');
  console.log('=============================================\n');

  let allIndexesPresent = true;
  let indexesWithUsage = 0;
  let indexesWithoutUsage = 0;

  for (const index of CRITICAL_INDEXES) {
    console.log(`📋 Checking: ${index.name}`);
    console.log(`   Table: ${index.table}`);
    console.log(`   Purpose: ${index.description}`);

    // Check if index exists
    const exists = await validateIndexExists(index.name);
    if (exists) {
      console.log(`   ✅ Index exists`);

      // Check index usage statistics
      const usage = await checkIndexUsage(index.name);
      if (usage) {
        console.log(`   📊 Usage: ${usage.calls} scans, ${usage.tuples} tuples read`);
        if (usage.calls > 0n) {
          indexesWithUsage++;
        } else {
          indexesWithoutUsage++;
        }
      }

      // Get table statistics
      const tableStats = await getTableStats(index.table);
      if (tableStats) {
        console.log(`   📏 Table: ${tableStats.rows} rows, ${tableStats.size}`);
      }

    } else {
      console.log(`   ❌ Index missing!`);
      allIndexesPresent = false;
    }

    console.log('');
  }

  // Summary
  console.log('📊 VALIDATION SUMMARY');
  console.log('====================');
  console.log(`Total critical indexes: ${CRITICAL_INDEXES.length}`);
  console.log(`Indexes present: ${allIndexesPresent ? CRITICAL_INDEXES.length : 'Some missing'}`);
  console.log(`Indexes with usage: ${indexesWithUsage}`);
  console.log(`Indexes without usage: ${indexesWithoutUsage}`);

  if (allIndexesPresent) {
    console.log('\n✅ All critical performance indexes are present!');
  } else {
    console.log('\n❌ Some critical indexes are missing. Run the migration to create them.');
  }

  // Performance test queries
  console.log('\n🚀 PERFORMANCE TEST QUERIES');
  console.log('============================');
  console.log('You can run these queries to test index performance:\n');

  for (const index of CRITICAL_INDEXES) {
    console.log(`-- ${index.description}`);
    console.log(`EXPLAIN (ANALYZE, BUFFERS) ${index.testQuery};`);
    console.log('');
  }

  // Database health check
  console.log('💾 DATABASE HEALTH METRICS');
  console.log('===========================');

  try {
    const connectionInfo = await prisma.$queryRaw<{count: number}[]>`
      SELECT count(*) as count FROM pg_stat_activity WHERE state = 'active'
    `;
    console.log(`Active connections: ${connectionInfo[0]?.count || 0}`);

    const cacheHit = await prisma.$queryRaw<{ratio: number}[]>`
      SELECT round(
        100 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2
      ) as ratio
      FROM pg_stat_database
      WHERE datname = current_database()
    `;
    console.log(`Cache hit ratio: ${cacheHit[0]?.ratio || 0}%`);

  } catch (error) {
    console.error('Error getting database health metrics:', error);
  }

  await prisma.$disconnect();

  // Exit with error code if indexes missing
  process.exit(allIndexesPresent ? 0 : 1);
}

main()
  .catch((error) => {
    console.error('💥 Validation failed:', error);
    process.exit(1);
  });