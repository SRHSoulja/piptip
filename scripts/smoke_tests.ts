#!/usr/bin/env node

// scripts/smoke_tests.ts - Extended smoke test suite for production deployment validation

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SmokeTest {
  name: string;
  description: string;
  test: () => Promise<boolean>;
}

interface SmokeTestConfig {
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  adminBearer?: string;
  internalBearer?: string;
}

// Default configuration - can be overridden by environment
const DEFAULT_CONFIG: SmokeTestConfig = {
  baseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  timeout: 5000,
  maxRetries: 3,
  adminBearer: process.env.ADMIN_SECRET,
  internalBearer: process.env.INTERNAL_BEARER
};

class SmokeTestRunner {
  private config: SmokeTestConfig;

  constructor(config: SmokeTestConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  private async retryTest(testFn: () => Promise<boolean>, testName: string): Promise<boolean> {
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await testFn();
        if (result) return true;
        
        if (attempt < this.config.maxRetries) {
          console.log(`   🔄 Retry ${attempt}/${this.config.maxRetries} for ${testName}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      } catch (error) {
        if (attempt < this.config.maxRetries) {
          console.log(`   🔄 Retry ${attempt}/${this.config.maxRetries} for ${testName} (error: ${error instanceof Error ? error.message : String(error)})`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        } else {
          throw error;
        }
      }
    }
    return false;
  }

  async runTest(test: SmokeTest): Promise<boolean> {
    console.log(`🧪 ${test.name}`);
    console.log(`   ${test.description}`);
    
    try {
      const result = await this.retryTest(test.test, test.name);
      
      if (result) {
        console.log(`   ✅ PASS`);
        return true;
      } else {
        console.log(`   ❌ FAIL`);
        return false;
      }
    } catch (error) {
      console.log(`   💥 ERROR: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  // Core health checks
  private healthCheck = async (): Promise<boolean> => {
    const response = await this.fetchWithTimeout(`${this.config.baseUrl}/health/healthz`);
    
    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.status === 'healthy' && data.db?.status === 'connected';
  };

  private readinessCheck = async (): Promise<boolean> => {
    const response = await this.fetchWithTimeout(`${this.config.baseUrl}/health/ready`);
    return response.ok;
  };

  private livenessCheck = async (): Promise<boolean> => {
    const response = await this.fetchWithTimeout(`${this.config.baseUrl}/health/live`);
    return response.ok;
  };

  // Database connectivity
  private databaseConnection = async (): Promise<boolean> => {
    try {
      await prisma.$queryRaw`SELECT 1 as test`;
      return true;
    } catch {
      return false;
    }
  };

  private databaseMigrations = async (): Promise<boolean> => {
    try {
      const { execSync } = await import('child_process');
      const output = execSync('npx prisma migrate status', { 
        encoding: 'utf8', 
        cwd: process.cwd() 
      });
      return output.includes('Database schema is up to date');
    } catch {
      return false;
    }
  };

  // Admin route security
  private adminRouteProtection = async (): Promise<boolean> => {
    try {
      // Test without authentication - should fail
      const unauthedResponse = await this.fetchWithTimeout(`${this.config.baseUrl}/admin/stats`);
      if (unauthedResponse.ok) {
        return false; // Admin route should be protected
      }

      // Test with authentication if available
      if (this.config.adminBearer) {
        const authedResponse = await this.fetchWithTimeout(`${this.config.baseUrl}/admin/stats`, {
          headers: {
            'Authorization': `Bearer ${this.config.adminBearer}`
          }
        });
        return authedResponse.ok;
      }

      return true; // Protection verified, but can't test auth without credentials
    } catch {
      return false;
    }
  };

  // Internal API protection
  private internalApiProtection = async (): Promise<boolean> => {
    try {
      // Test without authentication - should fail
      const unauthedResponse = await this.fetchWithTimeout(`${this.config.baseUrl}/internal/system/status`);
      if (unauthedResponse.ok) {
        return false; // Internal API should be protected
      }

      // Test with authentication if available
      if (this.config.internalBearer) {
        const authedResponse = await this.fetchWithTimeout(`${this.config.baseUrl}/internal/system/status`, {
          headers: {
            'Authorization': `Bearer ${this.config.internalBearer}`
          }
        });
        return authedResponse.ok;
      }

      return true; // Protection verified, but can't test auth without credentials
    } catch {
      return false;
    }
  };

  // Configuration validation
  private environmentValidation = async (): Promise<boolean> => {
    const requiredEnvs = [
      'DISCORD_TOKEN',
      'DATABASE_URL',
      'ABSTRACT_RPC_URL',
      'TREASURY_AGW_ADDRESS',
      'AGW_SESSION_PRIVATE_KEY',
      'TOKEN_ADDRESS',
      'ADMIN_SECRET',
      'INTERNAL_BEARER'
    ];

    for (const env of requiredEnvs) {
      if (!process.env[env]) {
        console.log(`     Missing required environment variable: ${env}`);
        return false;
      }
    }

    return true;
  };

  // Response time check
  private responseTimeCheck = async (): Promise<boolean> => {
    const startTime = Date.now();
    const response = await this.fetchWithTimeout(`${this.config.baseUrl}/health/healthz`);
    const endTime = Date.now();
    
    const responseTime = endTime - startTime;
    const isHealthy = response.ok && responseTime < 2000; // Max 2 second response time
    
    if (!isHealthy) {
      console.log(`     Response time: ${responseTime}ms (max: 2000ms)`);
    }
    
    return isHealthy;
  };

  // Basic data integrity
  private dataIntegrityBasics = async (): Promise<boolean> => {
    try {
      // Check for negative balances
      const negativeBalances = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM "UserBalance" WHERE amount < 0
      ` as Array<{ count: bigint }>;

      if (Number(negativeBalances[0]?.count) > 0) {
        console.log(`     Found ${negativeBalances[0].count} negative balances`);
        return false;
      }

      // Check for orphaned records
      const orphanedClaims = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM "GroupTipClaim" gc
        LEFT JOIN "GroupTip" gt ON gc.groupTipId = gt.id
        WHERE gt.id IS NULL
      ` as Array<{ count: bigint }>;

      if (Number(orphanedClaims[0]?.count) > 0) {
        console.log(`     Found ${orphanedClaims[0].count} orphaned group tip claims`);
        return false;
      }

      return true;
    } catch (error) {
      console.log(`     Database query failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  // Get all smoke tests
  getSmokeTests(): SmokeTest[] {
    return [
      {
        name: 'health_endpoint',
        description: 'Health endpoint returns healthy status with database connection',
        test: this.healthCheck
      },
      {
        name: 'readiness_check',
        description: 'Readiness endpoint confirms service is ready to accept traffic',
        test: this.readinessCheck
      },
      {
        name: 'liveness_check', 
        description: 'Liveness endpoint confirms service is responsive',
        test: this.livenessCheck
      },
      {
        name: 'database_connection',
        description: 'Direct database connection and query execution',
        test: this.databaseConnection
      },
      {
        name: 'database_migrations',
        description: 'All database migrations are applied and up to date',
        test: this.databaseMigrations
      },
      {
        name: 'admin_route_security',
        description: 'Admin routes require proper authentication',
        test: this.adminRouteProtection
      },
      {
        name: 'internal_api_security',
        description: 'Internal API routes require proper authentication',
        test: this.internalApiProtection
      },
      {
        name: 'environment_config',
        description: 'All required environment variables are configured',
        test: this.environmentValidation
      },
      {
        name: 'response_time',
        description: 'Health endpoint responds within acceptable time limits',
        test: this.responseTimeCheck
      },
      {
        name: 'data_integrity_basics',
        description: 'Basic data integrity checks pass',
        test: this.dataIntegrityBasics
      }
    ];
  }
}

async function main() {
  console.log('🚀 Starting PIPTip Smoke Tests');
  console.log('=' .repeat(60));
  
  const runner = new SmokeTestRunner();
  const tests = runner.getSmokeTests();
  
  let passedTests = 0;
  let totalTests = tests.length;
  
  // Run all smoke tests
  for (const test of tests) {
    const passed = await runner.runTest(test);
    if (passed) {
      passedTests++;
    }
    console.log(''); // Add spacing between tests
  }
  
  // Summary
  console.log('=' .repeat(60));
  console.log(`🧪 Smoke Test Summary:`);
  console.log(`   Passed: ${passedTests}/${totalTests} tests`);
  console.log(`   Success Rate: ${Math.round((passedTests / totalTests) * 100)}%`);
  
  if (passedTests === totalTests) {
    console.log('\n🎉 All smoke tests passed! System is ready for production traffic.');
    process.exit(0);
  } else {
    console.log('\n🚨 Some smoke tests failed. Review issues before proceeding with deployment.');
    console.log('   Failed tests indicate potential production readiness issues.');
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