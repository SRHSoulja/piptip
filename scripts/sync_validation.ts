#!/usr/bin/env tsx
// scripts/sync_validation.ts - Validate Supabase-Prisma synchronization

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const prisma = new PrismaClient();

interface ValidationResult {
  ok: boolean;
  issues: string[];
  warnings: string[];
}

async function validateDatabaseSync(): Promise<ValidationResult> {
  const result: ValidationResult = { ok: true, issues: [], warnings: [] };

  try {
    console.log('🔄 Validating Supabase-Prisma synchronization...');
    
    // 1. Check if Prisma schema matches database schema
    console.log('📋 Checking schema synchronization...');
    try {
      const diff = execSync('npx prisma db diff --exit-code', { encoding: 'utf-8' });
      if (diff.trim()) {
        result.issues.push('Schema drift detected: Prisma schema does not match database');
        result.ok = false;
      } else {
        console.log('✅ Prisma schema matches database');
      }
    } catch (error: any) {
      if (error.status === 2) {
        result.issues.push('Schema drift detected: Database structure differs from Prisma schema');
        result.ok = false;
      }
    }

    // 2. Check migration status
    console.log('📋 Checking migration status...');
    try {
      const status = execSync('npx prisma migrate status', { encoding: 'utf-8' });
      if (status.includes('following migrations have not yet been applied')) {
        result.issues.push('Pending migrations detected - database needs to be updated');
        result.ok = false;
      } else if (status.includes('Database schema is up to date')) {
        console.log('✅ All migrations applied');
      }
    } catch (error: any) {
      result.issues.push(`Migration status check failed: ${error.message}`);
      result.ok = false;
    }

    // 3. Validate database connectivity and basic operations
    console.log('📋 Testing database connectivity...');
    try {
      await prisma.$queryRaw`SELECT 1 as test`;
      console.log('✅ Database connection working');
    } catch (error: any) {
      result.issues.push(`Database connection failed: ${error.message}`);
      result.ok = false;
    }

    // 4. Check for foreign key constraints
    console.log('📋 Validating foreign key constraints...');
    try {
      const fkViolations = await prisma.$queryRaw`
        SELECT 
          tc.table_name, 
          tc.constraint_name, 
          kcu.column_name, 
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM 
          information_schema.table_constraints AS tc 
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = ccu.table_name 
          AND column_name = ccu.column_name
        )
      ` as any[];
      
      if (fkViolations.length > 0) {
        result.issues.push(`Foreign key constraint violations detected: ${fkViolations.length} issues`);
        result.ok = false;
      } else {
        console.log('✅ Foreign key constraints valid');
      }
    } catch (error: any) {
      result.warnings.push(`Could not validate foreign keys: ${error.message}`);
    }

    // 5. Check for data consistency
    console.log('📋 Checking data consistency...');
    try {
      // Check for orphaned records
      const orphanedBalances = await prisma.userBalance.count({
        where: {
          OR: [
            { User: null },
            { Token: null }
          ]
        }
      });
      
      if (orphanedBalances > 0) {
        result.warnings.push(`Found ${orphanedBalances} orphaned balance records`);
      }

      const orphanedTips = await prisma.tip.count({
        where: {
          OR: [
            { From: null, fromUserId: { not: null } },
            { To: null, toUserId: { not: null } }
          ]
        }
      });
      
      if (orphanedTips > 0) {
        result.warnings.push(`Found ${orphanedTips} orphaned tip records`);
      }

      console.log('✅ Data consistency check completed');
    } catch (error: any) {
      result.warnings.push(`Data consistency check failed: ${error.message}`);
    }

    return result;

  } catch (error: any) {
    result.issues.push(`Validation failed: ${error.message}`);
    result.ok = false;
    return result;
  }
}

async function fixSyncIssues(): Promise<boolean> {
  try {
    console.log('🔧 Attempting to fix synchronization issues...');
    
    // Generate fresh Prisma client
    console.log('   📦 Regenerating Prisma client...');
    execSync('npx prisma generate', { stdio: 'inherit' });
    
    // Apply pending migrations
    console.log('   📝 Applying pending migrations...');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    
    // Push schema if needed (for development)
    if (process.env.NODE_ENV !== 'production') {
      console.log('   🚀 Pushing schema changes...');
      execSync('npx prisma db push', { stdio: 'inherit' });
    }
    
    return true;
  } catch (error: any) {
    console.error('❌ Failed to fix sync issues:', error.message);
    return false;
  }
}

async function main() {
  try {
    const validation = await validateDatabaseSync();
    
    console.log('\n📊 Validation Results:');
    console.log(`Status: ${validation.ok ? '✅ SYNCHRONIZED' : '❌ SYNC ISSUES DETECTED'}`);
    
    if (validation.issues.length > 0) {
      console.log('\n🚨 Issues found:');
      validation.issues.forEach(issue => console.log(`   • ${issue}`));
    }
    
    if (validation.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      validation.warnings.forEach(warning => console.log(`   • ${warning}`));
    }
    
    if (!validation.ok) {
      console.log('\n🔧 Attempting automatic fixes...');
      const fixed = await fixSyncIssues();
      
      if (fixed) {
        console.log('✅ Sync issues resolved - please run validation again');
        process.exit(0);
      } else {
        console.log('❌ Could not automatically fix all issues');
        process.exit(1);
      }
    } else {
      console.log('\n🎯 Database is fully synchronized!');
    }
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { validateDatabaseSync, fixSyncIssues };