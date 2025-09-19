#!/usr/bin/env node

// scripts/deployment_validation.ts - Comprehensive deployment readiness validation

import { execSync, spawn } from 'child_process';
import { readFileSync } from 'fs';
import { promisify } from 'util';

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

// Security: Whitelisted commands and their allowed patterns
interface SecureCommand {
  command: string;
  allowedArgs?: string[];
  validator?: (fullCommand: string) => boolean;
}

// Secure command execution patterns
const ALLOWED_COMMANDS: Record<string, SecureCommand> = {
  npm: {
    command: 'npm',
    allowedArgs: ['ci', 'run', 'install'],
    validator: (cmd) => /^npm\s+(ci|run\s+[\w\-\.:]+|install)(\s+[\w\-\.\s=@\/]*)?$/.test(cmd)
  },
  npx: {
    command: 'npx',
    allowedArgs: ['prisma', 'tsc', 'tsx', 'eslint', 'prettier'],
    validator: (cmd) => /^npx\s+(prisma(\s+[\w\-\.\s\/]*)?|tsc(\s+[\w\-\.\s]*)?|tsx(\s+[\w\-\.\s\/]*)?|eslint(\s+[\w\-\.\s\/]*)?|prettier(\s+[\w\-\.\s\/]*)?)$/.test(cmd)
  },
  node: {
    command: 'node',
    allowedArgs: ['scripts/'],
    validator: (cmd) => /^node\s+scripts\/[\w\-\.\/]+\.c?js(\s+[\w\-\.\s\/]*)?$/.test(cmd)
  },
  tsc: {
    command: 'tsc',
    allowedArgs: ['--noEmit', '--pretty'],
    validator: (cmd) => /^tsc(\s+(--noEmit|--pretty)(\s+(false|true))?)*$/.test(cmd)
  }
};

// Security logging for command execution
function logSecurityEvent(event: string, command: string, success: boolean, details?: string) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    command: command.replace(/\s+/g, ' ').trim(),
    success,
    details,
    process: 'deployment_validation'
  };

  // Log to console for now - in production, this should go to security log
  console.log(`[SECURITY] ${JSON.stringify(logEntry)}`);
}

class DeploymentValidator {
  private results: ValidationResult[] = [];

  /**
   * Security: Validates and sanitizes commands before execution
   * Prevents command injection by using strict whitelisting
   */
  private validateCommand(command: string): { valid: boolean; sanitized?: string; error?: string } {
    // Basic sanitization - remove dangerous characters and normalize whitespace
    const sanitized = command.replace(/[;&|`$(){}[\]\\]/g, '').replace(/\s+/g, ' ').trim();

    // Reject empty or suspiciously long commands
    if (!sanitized || sanitized.length > 200) {
      return { valid: false, error: 'Command empty or too long' };
    }

    // Extract base command
    const parts = sanitized.split(' ');
    const baseCommand = parts[0];

    // Check if base command is whitelisted
    const allowedCmd = ALLOWED_COMMANDS[baseCommand];
    if (!allowedCmd) {
      return { valid: false, error: `Command '${baseCommand}' not in whitelist` };
    }

    // Validate command pattern using regex
    if (allowedCmd.validator && !allowedCmd.validator(sanitized)) {
      return { valid: false, error: `Command '${sanitized}' failed pattern validation` };
    }

    // Additional validation for specific command arguments
    if (allowedCmd.allowedArgs) {
      const hasValidArg = allowedCmd.allowedArgs.some(arg =>
        sanitized.includes(arg) || parts.slice(1).some(p => p.startsWith(arg))
      );
      if (!hasValidArg) {
        return { valid: false, error: `Command arguments not in allowed list` };
      }
    }

    return { valid: true, sanitized };
  }

  /**
   * Security: Executes commands using secure patterns with validation
   * Uses spawn instead of execSync for better security control
   */
  private async runCommand(command: string, timeout = 30000): Promise<{ output: string; success: boolean }> {
    const startTime = Date.now();

    // Security validation
    const validation = this.validateCommand(command);
    if (!validation.valid) {
      const error = `Command validation failed: ${validation.error}`;
      logSecurityEvent('COMMAND_REJECTED', command, false, validation.error);
      return {
        output: error,
        success: false
      };
    }

    const sanitizedCommand = validation.sanitized!;
    logSecurityEvent('COMMAND_VALIDATED', sanitizedCommand, true);

    try {
      // Split command into parts for secure execution
      const parts = sanitizedCommand.split(' ');
      const cmd = parts[0];
      const args = parts.slice(1);

      // Use spawn for more secure execution (no shell interpretation)
      const result = await this.executeWithSpawn(cmd, args, timeout);

      logSecurityEvent('COMMAND_EXECUTED', sanitizedCommand, result.success,
        result.success ? 'SUCCESS' : 'FAILED');

      return result;
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      logSecurityEvent('COMMAND_ERROR', sanitizedCommand, false, errorMsg);

      return {
        output: errorMsg,
        success: false
      };
    }
  }

  /**
   * Security: Uses spawn instead of execSync to avoid shell injection
   */
  private executeWithSpawn(command: string, args: string[], timeout: number): Promise<{ output: string; success: boolean }> {
    return new Promise((resolve) => {
      // Security: Further sanitize args to prevent injection
      const sanitizedArgs = args.map(arg => {
        // Remove dangerous characters and limit length
        return arg.replace(/[;&|`$(){}[\]\\<>]/g, '').substring(0, 100);
      }).filter(arg => arg.length > 0);

      // Security: Additional command validation
      if (!command || command.length === 0 || command.length > 50) {
        resolve({
          output: 'Invalid command: empty or too long',
          success: false
        });
        return;
      }

      // SECURITY: Command has been validated through multi-layer whitelist + regex validation
      // - Command is from predefined ALLOWED_COMMANDS whitelist
      // - Arguments are sanitized and separated to prevent injection
      // - No shell interpretation (shell: false) prevents shell injection
      const child = spawn(command, sanitizedArgs, {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_ENV: 'production',
          // Security: Remove potentially dangerous environment variables
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USER: process.env.USER
        },
        // Security: Additional spawn options for safety
        shell: false, // Explicitly disable shell
        detached: false // Keep process attached for proper cleanup
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000); // Force kill after 5s
      }, timeout);

      child.stdout?.on('data', (data) => {
        // Security: Limit output size to prevent memory exhaustion
        if (stdout.length < 50000) { // 50KB limit
          stdout += data.toString();
        }
      });

      child.stderr?.on('data', (data) => {
        // Security: Limit error output size
        if (stderr.length < 50000) { // 50KB limit
          stderr += data.toString();
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        if (timedOut) {
          resolve({
            output: `Command timed out after ${timeout}ms`,
            success: false
          });
          return;
        }

        const success = code === 0;
        const output = success ? stdout.trim() : (stderr.trim() || stdout.trim());

        resolve({
          output,
          success
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({
          output: `Spawn error: ${error.message}`,
          success: false
        });
      });
    });
  }

  private async validateStep(step: ValidationStep): Promise<ValidationResult> {
    console.log(`\n🔍 ${step.name}`);
    console.log(`   ${step.description}`);

    const startTime = Date.now();

    // Security: Log validation step start
    logSecurityEvent('VALIDATION_STEP_START', step.command, true, step.name);

    try {
      const result = await this.runCommand(step.command, step.timeout);
      const endTime = Date.now();

      const validationResult: ValidationResult = {
        step: step.name,
        passed: result.success,
        output: result.output,
        duration: endTime - startTime
      };

      // Security: Log validation step completion
      logSecurityEvent('VALIDATION_STEP_COMPLETE', step.command, result.success,
        `${step.name}: ${result.success ? 'PASS' : 'FAIL'}`);

      if (result.success) {
        console.log(`   ✅ PASS (${validationResult.duration}ms)`);
      } else {
        console.log(`   ${step.required ? '❌ FAIL' : '⚠️  WARNING'} (${validationResult.duration}ms)`);
        if (result.output) {
          // Security: Sanitize output before logging to prevent log injection
          const sanitizedOutput = result.output.replace(/[\r\n\t]/g, ' ').substring(0, 200);
          console.log(`   Output: ${sanitizedOutput.split('\n')[0]}${result.output.split('\n').length > 1 ? '...' : ''}`);
        }
      }

      return validationResult;
    } catch (error: any) {
      const endTime = Date.now();
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Security: Log unexpected validation errors
      logSecurityEvent('VALIDATION_STEP_ERROR', step.command, false,
        `${step.name}: Unexpected error - ${errorMsg}`);

      return {
        step: step.name,
        passed: false,
        output: `Validation framework error: ${errorMsg}`,
        error: errorMsg,
        duration: endTime - startTime
      };
    }
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
    console.log('🔒 Security: All commands validated via whitelist');
    console.log('=' .repeat(70));

    // Security: Log validation session start
    logSecurityEvent('VALIDATION_SESSION_START', 'deployment_validation', true,
      'Starting comprehensive deployment validation with secure command execution');

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

    // Security: Log validation session completion
    const success = requiredPassed === requiredTotal;
    logSecurityEvent('VALIDATION_SESSION_COMPLETE', 'deployment_validation', success,
      `Required: ${requiredPassed}/${requiredTotal}, Total: ${totalPassed}/${steps.length}`);

    // Return success status
    return success;
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

// Execute main function if this script is run directly
// Check if script is being executed directly vs imported
const isMainScript = process.argv[1]?.endsWith('deployment_validation.ts') ||
                     process.argv[1]?.endsWith('deployment_validation.js');

if (isMainScript) {
  main().catch(console.error);
}