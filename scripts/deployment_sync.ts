#!/usr/bin/env tsx
// scripts/deployment_sync.ts - Ensure database sync during deployments

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { validateDatabaseSync } from './sync_validation.js';

const prisma = new PrismaClient();

interface DeploymentSyncResult {
  preDeployment: boolean;
  migration: boolean;
  postDeployment: boolean;
  rollback?: boolean;
}

async function preDeploymentSync(): Promise<boolean> {
  try {
    console.log('🔍 Pre-deployment synchronization check...');
    
    // Create backup before any changes
    console.log('   📦 Creating pre-deployment backup...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `pre_deployment_${timestamp}`;
    
    try {
      execSync(`npx tsx scripts/backup_database.ts --name="${backupName}"`, { stdio: 'inherit' });
      console.log('   ✅ Backup created successfully');
    } catch (error) {
      console.warn('   ⚠️  Backup failed but continuing deployment');
    }
    
    // Validate current state
    const validation = await validateDatabaseSync();
    if (!validation.ok) {
      console.error('   ❌ Database is not in sync before deployment');
      validation.issues.forEach(issue => console.error(`      • ${issue}`));
      return false;
    }
    
    console.log('   ✅ Pre-deployment validation passed');
    return true;
    
  } catch (error: any) {
    console.error('❌ Pre-deployment sync failed:', error.message);
    return false;
  }
}

async function deploymentMigration(): Promise<boolean> {
  try {
    console.log('🚀 Running deployment migrations...');
    
    // Check if there are pending migrations
    try {
      const status = execSync('npx prisma migrate status', { encoding: 'utf-8' });
      if (status.includes('Database schema is up to date')) {
        console.log('   ✅ No migrations needed');
        return true;
      }
    } catch (error) {
      // Migration status failed, might need migrations
    }
    
    // Apply migrations
    console.log('   📝 Applying migrations...');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    
    // Regenerate client
    console.log('   📦 Regenerating Prisma client...');
    execSync('npx prisma generate', { stdio: 'inherit' });
    
    console.log('   ✅ Migrations completed successfully');
    return true;
    
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    return false;
  }
}

async function postDeploymentSync(): Promise<boolean> {
  try {
    console.log('🔍 Post-deployment synchronization check...');
    
    // Wait for services to stabilize
    console.log('   ⏳ Waiting for services to stabilize...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Validate final state
    const validation = await validateDatabaseSync();
    if (!validation.ok) {
      console.error('   ❌ Database sync validation failed after deployment');
      validation.issues.forEach(issue => console.error(`      • ${issue}`));
      return false;
    }
    
    // Test basic operations
    console.log('   🧪 Testing basic database operations...');
    try {
      await prisma.$queryRaw`SELECT COUNT(*) FROM "User"`;
      await prisma.$queryRaw`SELECT COUNT(*) FROM "Token"`;
      console.log('   ✅ Basic operations working');
    } catch (error: any) {
      console.error('   ❌ Basic operations failed:', error.message);
      return false;
    }
    
    // Verify schema integrity
    console.log('   🔍 Verifying schema integrity...');
    try {
      const diff = execSync('npx prisma db diff --exit-code', { encoding: 'utf-8' });
      if (diff.trim()) {
        console.warn('   ⚠️  Schema drift detected after deployment');
        return false;
      }
    } catch (error: any) {
      if (error.status === 2) {
        console.warn('   ⚠️  Schema drift detected after deployment');
        return false;
      }
    }
    
    console.log('   ✅ Post-deployment validation passed');
    return true;
    
  } catch (error: any) {
    console.error('❌ Post-deployment sync failed:', error.message);
    return false;
  }
}

async function emergencyRollback(): Promise<boolean> {
  try {
    console.log('🚨 Emergency rollback initiated...');
    
    // Find most recent backup
    console.log('   🔍 Looking for recent backup...');
    const backups = execSync('ls -t backups/pre_deployment_*.sql 2>/dev/null || echo ""', { encoding: 'utf-8' });
    const latestBackup = backups.split('\n')[0].trim();
    
    if (!latestBackup) {
      console.error('   ❌ No backup available for rollback');
      return false;
    }
    
    console.log(`   📦 Rolling back to: ${latestBackup}`);
    
    // Restore from backup (would need custom restore logic)
    console.warn('   ⚠️  Automatic rollback not implemented - manual intervention required');
    console.log(`   💡 To rollback manually: restore from ${latestBackup}`);
    
    return false; // Manual intervention needed
    
  } catch (error: any) {
    console.error('❌ Rollback failed:', error.message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const phase = args[0] || 'full';
  
  const results: DeploymentSyncResult = {
    preDeployment: false,
    migration: false,
    postDeployment: false
  };
  
  try {
    switch (phase) {
      case 'pre':
        results.preDeployment = await preDeploymentSync();
        break;
        
      case 'migrate':
        results.migration = await deploymentMigration();
        break;
        
      case 'post':
        results.postDeployment = await postDeploymentSync();
        break;
        
      case 'rollback':
        results.rollback = await emergencyRollback();
        break;
        
      case 'full':
      default:
        console.log('🚀 Full deployment synchronization...\n');
        
        results.preDeployment = await preDeploymentSync();
        if (!results.preDeployment) {
          console.error('❌ Pre-deployment checks failed');
          process.exit(1);
        }
        
        console.log('');
        results.migration = await deploymentMigration();
        if (!results.migration) {
          console.error('❌ Migration failed - considering rollback');
          await emergencyRollback();
          process.exit(1);
        }
        
        console.log('');
        results.postDeployment = await postDeploymentSync();
        if (!results.postDeployment) {
          console.error('❌ Post-deployment validation failed');
          process.exit(1);
        }
        
        break;
    }
    
    console.log('\n📊 Deployment Sync Results:');
    Object.entries(results).forEach(([phase, success]) => {
      if (success !== undefined) {
        console.log(`   ${phase}: ${success ? '✅' : '❌'}`);
      }
    });
    
    const allPassed = Object.values(results).every(result => result !== false);
    if (allPassed) {
      console.log('\n🎯 Deployment synchronization completed successfully!');
    } else {
      console.log('\n❌ Some synchronization steps failed');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Deployment sync failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { preDeploymentSync, deploymentMigration, postDeploymentSync, emergencyRollback };