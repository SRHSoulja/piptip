#!/usr/bin/env node

// scripts/deployment_validation.ts - Comprehensive deployment readiness validation

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

interface ValidationStep {
  name: string;
  description: string;
  command: string;
  required: boolean;
  timeout?: number;
}

interface ValidationResult {
  step: string;
  passed: boolean;
  output?: string;
  error?: string;
  duration: number;
}

class DeploymentValidator {
  private results: ValidationResult[] = [];

  private async runCommand(command: string, timeout = 30000): Promise<{ output: string; success: boolean }> {
    const startTime = Date.now();
    
    try {
      const output = execSync(command, {
        encoding: 'utf8',
        timeout,
        cwd: process.cwd(),
        stdio: 'pipe'
      });
      
      return {
        output: output.trim(),
        success: true
      };
    } catch (error: any) {
      return {
        output: error.stdout?.trim() || error.stderr?.trim() || error.message || String(error),
        success: false
      };
    }
  }

  private async validateStep(step: ValidationStep): Promise<ValidationResult> {
    console.log(`\n🔍 ${step.name}`);
    console.log(`   ${step.description}`);
    
    const startTime = Date.now();
    const result = await this.runCommand(step.command, step.timeout);
    const endTime = Date.now();
    
    const validationResult: ValidationResult = {
      step: step.name,
      passed: result.success,
      output: result.output,
      duration: endTime - startTime
    };

    if (result.success) {
      console.log(`   ✅ PASS (${validationResult.duration}ms)`);
    } else {
      console.log(`   ${step.required ? '❌ FAIL' : '⚠️  WARNING'} (${validationResult.duration}ms)`);
      if (result.output) {
        console.log(`   Output: ${result.output.split('\n')[0]}${result.output.split('\n').length > 1 ? '...' : ''}`);
      }
    }

    return validationResult;
  }

  private getValidationSteps(): ValidationStep[] {
    return [
      // Build validation
      {
        name: 'clean_install',
        description: 'Clean npm install with no dev dependencies',
        command: 'npm ci --omit=dev --silent',
        required: true,
        timeout: 60000
      },
      {
        name: 'prisma_generate',
        description: 'Generate Prisma client',
        command: 'npx prisma generate',
        required: true,
        timeout: 30000
      },
      {
        name: 'typescript_check',
        description: 'TypeScript type checking',
        command: 'npx tsc --noEmit --pretty false',
        required: true,
        timeout: 45000
      },
      {
        name: 'build_application',
        description: 'Build application to dist/',
        command: 'npm run build',
        required: true,
        timeout: 60000
      },
      
      // Code quality checks
      {
        name: 'test_imports_check',
        description: 'Verify no test imports in production code',
        command: 'node scripts/check-test-imports.cjs',
        required: true,
        timeout: 10000
      },
      {
        name: 'eslint_check',
        description: 'ESLint validation with zero warnings',
        command: 'npx eslint --max-warnings=0 src/',
        required: false, // Set to warning since it may not be configured
        timeout: 30000
      },
      {
        name: 'prettier_check',
        description: 'Prettier formatting validation',
        command: 'npx prettier --check src/',
        required: false, // Set to warning since it may not be configured
        timeout: 15000
      },
      
      // Security and environment validation
      {
        name: 'environment_validation',
        description: 'Validate all required environment variables',
        command: 'npx tsx src/services/env_validator.ts',
        required: true,
        timeout: 10000
      },
      
      // Database validation
      {
        name: 'migration_status',
        description: 'Verify database migrations are up to date',
        command: 'npx prisma migrate status',
        required: true,
        timeout: 15000
      },
      {
        name: 'database_integrity',
        description: 'Run comprehensive database integrity checks',
        command: 'npx tsx scripts/db_integrity_check.ts',
        required: true,
        timeout: 30000
      },
      
      // Runtime smoke tests
      {
        name: 'smoke_tests',
        description: 'Execute end-to-end smoke test suite',
        command: 'npx tsx scripts/smoke_tests.ts',
        required: true,
        timeout: 60000
      }
    ];
  }

  async runValidation(): Promise<boolean> {
    console.log('🚀 PIPTip Deployment Validation');
    console.log('=' .repeat(70));
    console.log('Comprehensive production readiness verification');
    console.log('=' .repeat(70));

    const steps = this.getValidationSteps();
    let requiredPassed = 0;
    let requiredTotal = 0;
    let totalPassed = 0;

    // Run each validation step
    for (const step of steps) {
      const result = await this.validateStep(step);
      this.results.push(result);

      if (step.required) {
        requiredTotal++;
        if (result.passed) {
          requiredPassed++;
        }
      }

      if (result.passed) {
        totalPassed++;
      }

      // Early termination for critical failures
      if (step.required && !result.passed && 
          ['clean_install', 'prisma_generate', 'build_application'].includes(step.name)) {
        console.log(`\n💥 Critical build step failed: ${step.name}`);
        console.log('   Stopping validation - fix build issues first');
        break;
      }
    }

    // Generate summary report
    this.generateSummaryReport(requiredPassed, requiredTotal, totalPassed, steps.length);

    // Return success status
    return requiredPassed === requiredTotal;
  }

  private generateSummaryReport(requiredPassed: number, requiredTotal: number, totalPassed: number, totalSteps: number) {
    console.log('\n' + '=' .repeat(70));
    console.log('📊 DEPLOYMENT VALIDATION SUMMARY');
    console.log('=' .repeat(70));
    
    console.log(`Required Checks: ${requiredPassed}/${requiredTotal} passed`);
    console.log(`Optional Checks: ${totalPassed - requiredPassed}/${totalSteps - requiredTotal} passed`);
    console.log(`Overall Success: ${totalPassed}/${totalSteps} (${Math.round((totalPassed / totalSteps) * 100)}%)`);

    // Detailed results
    console.log('\nDetailed Results:');
    for (const result of this.results) {
      const status = result.passed ? '✅' : '❌';
      const duration = `${result.duration}ms`;
      console.log(`  ${status} ${result.step.padEnd(25)} (${duration.padStart(8)})`);
    }

    // Overall status
    if (requiredPassed === requiredTotal) {
      console.log('\n🎉 DEPLOYMENT READY');
      console.log('   All required validation checks passed');
      console.log('   System is ready for production deployment');
      
      if (totalPassed < totalSteps) {
        console.log(`\n⚠️  Note: ${totalSteps - totalPassed} optional checks failed`);
        console.log('   Consider addressing these for optimal production setup');
      }
    } else {
      console.log('\n🚨 DEPLOYMENT BLOCKED');
      console.log(`   ${requiredTotal - requiredPassed} required validation checks failed`);
      console.log('   Address failed checks before proceeding with deployment');
      
      // List failed required checks
      const failedRequired = this.results.filter(r => 
        !r.passed && this.getValidationSteps().find(s => s.name === r.step)?.required
      );
      
      if (failedRequired.length > 0) {
        console.log('\nFailed Required Checks:');
        for (const failed of failedRequired) {
          console.log(`  • ${failed.step}`);
          if (failed.output) {
            console.log(`    ${failed.output.split('\n')[0]}`);
          }
        }
      }
    }

    // Performance summary
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);
    console.log(`\nValidation completed in ${Math.round(totalDuration / 1000)}s`);
  }
}

async function main() {
  const validator = new DeploymentValidator();
  
  try {
    const success = await validator.runValidation();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('\n💥 Validation framework error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}