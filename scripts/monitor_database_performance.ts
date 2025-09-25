#!/usr/bin/env tsx

/**
 * Database Performance Monitoring Script
 *
 * This script monitors the performance of critical database operations
 * and provides insights into query performance and index effectiveness.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SlowQuery {
  query: string;
  calls: bigint;
  total_time: number;
  mean_time: number;
  rows: bigint;
}

interface IndexStats {
  schemaname: string;
  tablename: string;
  indexname: string;
  idx_scan: bigint;
  idx_tup_read: bigint;
  idx_tup_fetch: bigint;
}

interface TableStats {
  schemaname: string;
  relname: string;
  seq_scan: bigint;
  seq_tup_read: bigint;
  idx_scan: bigint;
  idx_tup_fetch: bigint;
  n_tup_ins: bigint;
  n_tup_upd: bigint;
  n_tup_del: bigint;
  n_live_tup: bigint;
  n_dead_tup: bigint;
}

async function getSlowQueries(limit: number = 10): Promise<SlowQuery[]> {
  try {
    return await prisma.$queryRaw<SlowQuery[]>`
      SELECT
        LEFT(query, 100) as query,
        calls,
        total_time,
        mean_time,
        rows
      FROM pg_stat_statements
      ORDER BY mean_time DESC
      LIMIT ${limit}
    `;
  } catch (error) {
    console.warn('pg_stat_statements extension not available. Slow query analysis disabled.');
    return [];
  }
}

async function getIndexStats(): Promise<IndexStats[]> {
  try {
    return await prisma.$queryRaw<IndexStats[]>`
      SELECT
        schemaname,
        tablename,
        indexname,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
      ORDER BY idx_scan DESC
    `;
  } catch (error) {
    console.error('Error getting index stats:', error);
    return [];
  }
}

async function getTableStats(): Promise<TableStats[]> {
  try {
    return await prisma.$queryRaw<TableStats[]>`
      SELECT
        schemaname,
        relname,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        n_tup_ins,
        n_tup_upd,
        n_tup_del,
        n_live_tup,
        n_dead_tup
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY n_live_tup DESC
    `;
  } catch (error) {
    console.error('Error getting table stats:', error);
    return [];
  }
}

async function getUnusedIndexes(): Promise<{indexname: string, tablename: string}[]> {
  try {
    return await prisma.$queryRaw<{indexname: string, tablename: string}[]>`
      SELECT
        indexname,
        tablename
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
        AND idx_scan = 0
        AND indexname NOT LIKE '%_pkey'
      ORDER BY tablename, indexname
    `;
  } catch (error) {
    console.error('Error getting unused indexes:', error);
    return [];
  }
}

async function getCacheHitRatio(): Promise<number> {
  try {
    const result = await prisma.$queryRaw<{ratio: number}[]>`
      SELECT round(
        100 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2
      ) as ratio
      FROM pg_stat_database
      WHERE datname = current_database()
    `;
    return result[0]?.ratio || 0;
  } catch (error) {
    console.error('Error getting cache hit ratio:', error);
    return 0;
  }
}

async function getConnectionStats(): Promise<{active: number, idle: number, total: number}> {
  try {
    const result = await prisma.$queryRaw<{state: string, count: bigint}[]>`
      SELECT
        state,
        count(*) as count
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY state
    `;

    let active = 0, idle = 0, total = 0;
    for (const row of result) {
      const count = Number(row.count);
      total += count;
      if (row.state === 'active') active = count;
      else if (row.state === 'idle') idle = count;
    }

    return { active, idle, total };
  } catch (error) {
    console.error('Error getting connection stats:', error);
    return { active: 0, idle: 0, total: 0 };
  }
}

async function performCriticalQueryTests(): Promise<void> {
  console.log('🧪 CRITICAL QUERY PERFORMANCE TESTS');
  console.log('====================================\n');

  const tests = [
    {
      name: 'Discord ID Lookup',
      description: 'Most frequent operation - every Discord command',
      query: async () => {
        const startTime = Date.now();
        try {
          await prisma.user.findFirst({
            where: { discordId: 'test_nonexistent_user' }
          });
        } catch (error) {
          // Expected - just testing query performance
        }
        return Date.now() - startTime;
      }
    },
    {
      name: 'User Balance Lookup',
      description: 'Balance check for tips/withdrawals',
      query: async () => {
        const startTime = Date.now();
        try {
          await prisma.userBalance.findMany({
            where: { userId: 99999 }, // Non-existent user
            include: { Token: true }
          });
        } catch (error) {
          // Expected
        }
        return Date.now() - startTime;
      }
    },
    {
      name: 'Active Markets Query',
      description: 'Loading active prediction markets',
      query: async () => {
        const startTime = Date.now();
        try {
          await prisma.predictionMarket.findMany({
            where: {
              status: 'ACTIVE',
              guildId: 'test_guild_123'
            },
            orderBy: { createdAt: 'desc' },
            take: 10
          });
        } catch (error) {
          // Expected
        }
        return Date.now() - startTime;
      }
    },
    {
      name: 'Activity Feed Query',
      description: 'PenguBook homepage loading',
      query: async () => {
        const startTime = Date.now();
        try {
          await prisma.activityFeedItem.findMany({
            where: { visibility: 'public' },
            orderBy: { createdAt: 'desc' },
            take: 20
          });
        } catch (error) {
          // Expected
        }
        return Date.now() - startTime;
      }
    },
    {
      name: 'Recent Tips Query',
      description: 'Recent tip activity',
      query: async () => {
        const startTime = Date.now();
        try {
          await prisma.tip.findMany({
            where: { status: 'COMPLETED' },
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: {
              From: { select: { discordId: true } },
              To: { select: { discordId: true } },
              Token: { select: { symbol: true } }
            }
          });
        } catch (error) {
          // Expected
        }
        return Date.now() - startTime;
      }
    }
  ];

  for (const test of tests) {
    try {
      const duration = await test.query();
      const status = duration < 100 ? '✅' : duration < 500 ? '⚠️' : '❌';
      console.log(`${status} ${test.name}: ${duration}ms`);
      console.log(`   ${test.description}\n`);
    } catch (error) {
      console.log(`❌ ${test.name}: Error - ${error}\n`);
    }
  }
}

async function main() {
  console.log('📊 PIPtip Database Performance Monitor');
  console.log('======================================\n');

  // Database health overview
  console.log('🏥 DATABASE HEALTH');
  console.log('==================');

  const cacheHitRatio = await getCacheHitRatio();
  const connections = await getConnectionStats();

  console.log(`Cache hit ratio: ${cacheHitRatio}% ${cacheHitRatio > 95 ? '✅' : '⚠️'}`);
  console.log(`Connections: ${connections.active} active, ${connections.idle} idle, ${connections.total} total`);
  console.log('');

  // Critical query performance tests
  await performCriticalQueryTests();

  // Index usage statistics
  console.log('📈 INDEX USAGE STATISTICS');
  console.log('=========================');

  const indexStats = await getIndexStats();
  const criticalIndexes = [
    'User_discordId_idx',
    'UserBalance_userId_idx',
    'UserBalance_tokenId_idx',
    'PredictionMarket_status_guildId_createdAt_idx',
    'ActivityFeedItem_visibility_createdAt_idx',
    'Tip_status_createdAt_idx'
  ];

  for (const indexName of criticalIndexes) {
    const stats = indexStats.find(s => s.indexname === indexName);
    if (stats) {
      const scans = Number(stats.idx_scan);
      const status = scans > 0 ? '✅' : '⚠️';
      console.log(`${status} ${indexName}: ${scans} scans, ${stats.idx_tup_read} tuples read`);
    } else {
      console.log(`❌ ${indexName}: Not found or not used`);
    }
  }
  console.log('');

  // Table statistics
  console.log('📋 TABLE STATISTICS (Top 10 by size)');
  console.log('====================================');

  const tableStats = await getTableStats();
  const topTables = tableStats.slice(0, 10);

  for (const table of topTables) {
    const seqScanRatio = Number(table.seq_scan) / (Number(table.idx_scan) + Number(table.seq_scan)) * 100;
    const seqScanStatus = seqScanRatio < 10 ? '✅' : seqScanRatio < 30 ? '⚠️' : '❌';

    console.log(`${table.relname}:`);
    console.log(`  Rows: ${table.n_live_tup}`);
    console.log(`  ${seqScanStatus} Sequential scans: ${table.seq_scan} (${seqScanRatio.toFixed(1)}%)`);
    console.log(`  Index scans: ${table.idx_scan}`);
    console.log('');
  }

  // Unused indexes
  console.log('🗑️ UNUSED INDEXES');
  console.log('=================');

  const unusedIndexes = await getUnusedIndexes();
  if (unusedIndexes.length === 0) {
    console.log('✅ No unused indexes found\n');
  } else {
    console.log('⚠️ The following indexes have never been used:');
    for (const index of unusedIndexes) {
      console.log(`  ${index.tablename}.${index.indexname}`);
    }
    console.log('');
  }

  // Slow queries (if available)
  console.log('🐌 SLOW QUERIES');
  console.log('===============');

  const slowQueries = await getSlowQueries(5);
  if (slowQueries.length === 0) {
    console.log('ℹ️ No slow query data available (pg_stat_statements extension not installed)\n');
  } else {
    for (const query of slowQueries) {
      console.log(`⏱️ ${query.mean_time.toFixed(2)}ms average (${query.calls} calls):`);
      console.log(`   ${query.query}...\n`);
    }
  }

  // Performance recommendations
  console.log('💡 PERFORMANCE RECOMMENDATIONS');
  console.log('==============================');

  if (cacheHitRatio < 95) {
    console.log('⚠️ Cache hit ratio is below 95%. Consider increasing shared_buffers.');
  }

  if (connections.active > 50) {
    console.log('⚠️ High number of active connections. Consider connection pooling optimization.');
  }

  const highSeqScanTables = tableStats.filter(t => {
    const ratio = Number(t.seq_scan) / (Number(t.idx_scan) + Number(t.seq_scan));
    return ratio > 0.3 && Number(t.n_live_tup) > 1000;
  });

  if (highSeqScanTables.length > 0) {
    console.log('⚠️ Tables with high sequential scan ratios may need additional indexes:');
    for (const table of highSeqScanTables) {
      console.log(`   ${table.relname}`);
    }
  }

  if (unusedIndexes.length > 5) {
    console.log('⚠️ Consider dropping unused indexes to improve write performance.');
  }

  console.log('\n✅ Performance monitoring complete!');

  await prisma.$disconnect();
}

main()
  .catch((error) => {
    console.error('💥 Performance monitoring failed:', error);
    process.exit(1);
  });