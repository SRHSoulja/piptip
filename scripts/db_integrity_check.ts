#!/usr/bin/env node

// scripts/db_integrity_check.ts - Database integrity validation

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface IntegrityCheck {
  name: string;
  query: string;
  expectZeroRows?: boolean;
  description: string;
}

const INTEGRITY_CHECKS: IntegrityCheck[] = [
  {
    name: 'negative_balances',
    query: 'SELECT * FROM "UserBalance" WHERE amount < 0',
    expectZeroRows: true,
    description: 'No negative balances should exist'
  },
  {
    name: 'duplicate_group_claims',
    query: `
      SELECT groupTipId, userId, COUNT(*) as count
      FROM "GroupTipClaim"
      GROUP BY groupTipId, userId
      HAVING COUNT(*) > 1
    `,
    expectZeroRows: true,
    description: 'Exactly one claim per (groupTipId, userId) pair'
  },
  {
    name: 'invalid_tip_statuses',
    query: `
      SELECT DISTINCT status FROM "Tip"
      WHERE status NOT IN ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED')
    `,
    expectZeroRows: true,
    description: 'All tip statuses must be valid enum values'
  },
  {
    name: 'refunded_tips_missing_date',
    query: `
      SELECT id FROM "Tip"
      WHERE status = 'REFUNDED' AND refundedAt IS NULL
    `,
    expectZeroRows: true,
    description: 'Refunded tips must have refundedAt timestamp'
  },
  {
    name: 'refunded_group_tips_missing_date',
    query: `
      SELECT id FROM "GroupTip"
      WHERE status = 'REFUNDED' AND refundedAt IS NULL
    `,
    expectZeroRows: true,
    description: 'Refunded group tips must have refundedAt timestamp'
  },
  {
    name: 'orphaned_group_claims',
    query: `
      SELECT gc.id FROM "GroupTipClaim" gc
      LEFT JOIN "GroupTip" gt ON gc.groupTipId = gt.id
      WHERE gt.id IS NULL
    `,
    expectZeroRows: true,
    description: 'Group tip claims must reference existing group tips'
  },
  {
    name: 'orphaned_user_balances',
    query: `
      SELECT ub.id FROM "UserBalance" ub
      LEFT JOIN "User" u ON ub.userId = u.id
      WHERE u.id IS NULL
    `,
    expectZeroRows: true,
    description: 'User balances must reference existing users'
  },
  {
    name: 'invalid_tip_amounts',
    query: `
      SELECT id FROM "Tip"
      WHERE amountAtomic <= 0
    `,
    expectZeroRows: true,
    description: 'Tip amounts must be positive'
  },
  {
    name: 'invalid_group_tip_amounts',
    query: `
      SELECT id FROM "GroupTip"
      WHERE totalAmount <= 0
    `,
    expectZeroRows: true,
    description: 'Group tip amounts must be positive'
  },
  {
    name: 'expired_active_group_tips',
    query: `
      SELECT id FROM "GroupTip"
      WHERE status = 'ACTIVE' AND expiresAt < NOW()
    `,
    expectZeroRows: false, // This might have results during normal operation
    description: 'Active group tips that have expired (may indicate processing delay)'
  }
];

async function runIntegrityCheck(check: IntegrityCheck): Promise<boolean> {
  console.log(`\n🔍 Running: ${check.name}`);
  console.log(`   ${check.description}`);
  
  try {
    const results = await prisma.$queryRawUnsafe(check.query);
    const resultCount = Array.isArray(results) ? results.length : 0;
    
    if (check.expectZeroRows && resultCount === 0) {
      console.log(`   ✅ PASS - No issues found`);
      return true;
    } else if (!check.expectZeroRows) {
      console.log(`   ℹ️  INFO - ${resultCount} rows found (informational check)`);
      if (resultCount > 0) {
        console.log(`   First few results:`, JSON.stringify(results.slice(0, 3), null, 2));
      }
      return true;
    } else {
      console.log(`   ❌ FAIL - Found ${resultCount} problematic rows`);
      console.log(`   First few results:`, JSON.stringify(results.slice(0, 5), null, 2));
      return false;
    }
  } catch (error) {
    console.log(`   💥 ERROR - Query failed:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function checkMigrationStatus(): Promise<boolean> {
  console.log('\n📋 Checking migration status...');
  
  try {
    // Check if there are any pending migrations
    const { execSync } = await import('child_process');
    const output = execSync('npx prisma migrate status', { 
      encoding: 'utf8', 
      cwd: process.cwd() 
    });
    
    if (output.includes('Database schema is up to date')) {
      console.log('✅ All migrations applied successfully');
      return true;
    } else {
      console.log('⚠️  Migration status output:', output);
      return false;
    }
  } catch (error) {
    console.log('💥 Failed to check migration status:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function main() {
  console.log('🚀 Starting PIPTip Database Integrity Checks');
  console.log('=' .repeat(60));
  
  let passedChecks = 0;
  let totalChecks = INTEGRITY_CHECKS.length;
  
  // Run migration check first
  const migrationOk = await checkMigrationStatus();
  if (!migrationOk) {
    console.log('\n❌ Migration check failed - some checks may not be accurate');
  }
  
  // Run integrity checks
  for (const check of INTEGRITY_CHECKS) {
    const passed = await runIntegrityCheck(check);
    if (passed) {
      passedChecks++;
    }
  }
  
  // Summary
  console.log('\n' + '=' .repeat(60));
  console.log(`📊 Integrity Check Summary:`);
  console.log(`   Passed: ${passedChecks}/${totalChecks} checks`);
  console.log(`   Migrations: ${migrationOk ? 'OK' : 'WARNING'}`);
  
  if (passedChecks === totalChecks && migrationOk) {
    console.log('\n🎉 All integrity checks passed! Database is healthy.');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some integrity checks failed or have warnings.');
    console.log('   Review the issues above and take corrective action.');
    process.exit(1);
  }
}

// Handle cleanup
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(1);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}