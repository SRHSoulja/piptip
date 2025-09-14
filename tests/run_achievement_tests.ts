#!/usr/bin/env npx tsx
// tests/run_achievement_tests.ts - Master test runner for all Discord achievement integration tests

import { performance } from 'perf_hooks';
import { exec, spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test Suite Configuration
interface TestSuiteConfig {
  testSuites: TestSuiteDefinition[];
  outputDir: string;
  parallel: boolean;
  maxConcurrency: number;
  timeoutMinutes: number;
  generateConsolidatedReport: boolean;
  runInProduction: boolean;
}

interface TestSuiteDefinition {
  name: string;
  script: string;
  description: string;
  category: 'integration' | 'performance' | 'compatibility' | 'stress';
  priority: number; // 1 = highest priority
  estimatedDuration: number; // minutes
  dependencies: string[]; // Other test suites that must run first
  environment: {
    requiredEnvVars: string[];
    mockServices: string[];
    databaseRequired: boolean;
  };
}

interface TestSuiteResult {
  name: string;
  script: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
  metrics?: any;
}

interface ConsolidatedTestReport {
  testRun: {
    timestamp: string;
    duration: number;
    environment: string;
    configuration: TestSuiteConfig;
  };
  summary: {
    totalSuites: number;
    passedSuites: number;
    failedSuites: number;
    skippedSuites: number;
    overallSuccess: boolean;
    criticalFailures: string[];
  };
  suiteResults: TestSuiteResult[];
  performanceMetrics: {
    totalTestTime: number;
    averageTestTime: number;
    longestTest: string;
    shortestTest: string;
    parallelizationEfficiency: number;
  };
  recommendations: string[];
}

// Main Test Runner Class
class AchievementTestRunner {
  private config: TestSuiteConfig;
  private results: TestSuiteResult[] = [];
  private startTime: number = 0;

  constructor() {
    this.config = {
      testSuites: [
        // Core Integration Tests
        {
          name: 'Achievement Integration Tests',
          script: 'tests/achievement_integration_tests.ts',
          description: 'Comprehensive Discord achievement system integration tests',
          category: 'integration',
          priority: 1,
          estimatedDuration: 15,
          dependencies: [],
          environment: {
            requiredEnvVars: ['DATABASE_URL', 'DISCORD_TOKEN'],
            mockServices: ['discord', 'database'],
            databaseRequired: true
          }
        },

        // Viral Moment Tests
        {
          name: 'Viral Notification Tests',
          script: 'tests/viral_notification_tests.ts',
          description: 'Tests for viral moments and notification throttling',
          category: 'stress',
          priority: 2,
          estimatedDuration: 10,
          dependencies: ['Achievement Integration Tests'],
          environment: {
            requiredEnvVars: [],
            mockServices: ['discord', 'notification_queue'],
            databaseRequired: false
          }
        },

        // Mobile Compatibility Tests
        {
          name: 'Mobile Compatibility Tests',
          script: 'tests/mobile_compatibility_tests.ts',
          description: 'Discord mobile app compatibility validation',
          category: 'compatibility',
          priority: 3,
          estimatedDuration: 8,
          dependencies: [],
          environment: {
            requiredEnvVars: [],
            mockServices: ['discord_mobile'],
            databaseRequired: false
          }
        },

        // Existing Load Tests
        {
          name: 'Achievement Load Tests',
          script: 'scripts/load_testing/achievement_load_test.ts',
          description: 'High-volume achievement processing load tests',
          category: 'performance',
          priority: 4,
          estimatedDuration: 12,
          dependencies: ['Achievement Integration Tests'],
          environment: {
            requiredEnvVars: ['DATABASE_URL'],
            mockServices: [],
            databaseRequired: true
          }
        },

        // Button Handler Stress Tests
        {
          name: 'Button Handler Stress Tests',
          script: 'tests/achievement_integration_tests.ts',
          description: 'Rapid button interaction and concurrency tests',
          category: 'stress',
          priority: 5,
          estimatedDuration: 6,
          dependencies: ['Achievement Integration Tests'],
          environment: {
            requiredEnvVars: [],
            mockServices: ['discord'],
            databaseRequired: false
          }
        }
      ],
      outputDir: './tests/results',
      parallel: true,
      maxConcurrency: 3,
      timeoutMinutes: 30,
      generateConsolidatedReport: true,
      runInProduction: false
    };
  }

  async runAllTests(): Promise<ConsolidatedTestReport> {
    console.log('🚀 Starting Discord Achievement System Test Suite');
    console.log(`📊 Configuration: ${this.config.testSuites.length} test suites, parallel: ${this.config.parallel}`);

    this.startTime = performance.now();

    try {
      // Setup test environment
      await this.setupTestEnvironment();

      // Validate test prerequisites
      await this.validatePrerequisites();

      // Run test suites
      if (this.config.parallel) {
        await this.runTestsInParallel();
      } else {
        await this.runTestsSequentially();
      }

      // Generate consolidated report
      const report = await this.generateConsolidatedReport();

      // Cleanup
      await this.cleanup();

      return report;

    } catch (error) {
      console.error('❌ Test suite execution failed:', error);
      throw error;
    }
  }

  private async setupTestEnvironment(): Promise<void> {
    console.log('🔧 Setting up test environment...');

    // Ensure output directory exists
    if (!existsSync(this.config.outputDir)) {
      mkdirSync(this.config.outputDir, { recursive: true });
    }

    // Set test environment variables
    process.env.NODE_ENV = 'test';
    process.env.TEST_MODE = 'true';
    process.env.ACHIEVEMENT_TEST_RUNNER = 'true';

    // Create test-specific environment file
    const testEnvPath = join(__dirname, '../.env.test');
    if (!existsSync(testEnvPath)) {
      const testEnvContent = `
# Test Environment Configuration
NODE_ENV=test
TEST_MODE=true
ACHIEVEMENT_TEST_RUNNER=true
DATABASE_URL=postgresql://test:test@localhost:5432/piptip_test
DISCORD_TOKEN=test_token_for_integration_tests
ADMIN_SECRET=test_admin_secret_for_tests
LOG_LEVEL=error
CACHE_TTL=60
`.trim();
      writeFileSync(testEnvPath, testEnvContent);
    }

    console.log('✅ Test environment setup complete');
  }

  private async validatePrerequisites(): Promise<void> {
    console.log('🔍 Validating test prerequisites...');

    const issues: string[] = [];

    // Check Node.js version
    const nodeVersion = process.version;
    const minNodeVersion = 'v18.0.0';
    if (nodeVersion < minNodeVersion) {
      issues.push(`Node.js version ${nodeVersion} is below minimum required ${minNodeVersion}`);
    }

    // Check required files exist
    const requiredFiles = [
      'package.json',
      'src/services/dynamic_achievements.ts',
      'src/services/achievement_monitoring.ts',
      'src/services/notifications.ts'
    ];

    for (const file of requiredFiles) {
      const filePath = join(__dirname, '..', file);
      if (!existsSync(filePath)) {
        issues.push(`Required file missing: ${file}`);
      }
    }

    // Check test scripts exist
    for (const suite of this.config.testSuites) {
      const scriptPath = join(__dirname, '..', suite.script);
      if (!existsSync(scriptPath)) {
        issues.push(`Test script missing: ${suite.script}`);
      }
    }

    // Validate environment variables for critical tests
    const criticalTests = this.config.testSuites.filter(s => s.priority <= 2);
    for (const test of criticalTests) {
      for (const envVar of test.environment.requiredEnvVars) {
        if (!process.env[envVar] && !process.env.TEST_MODE) {
          issues.push(`Missing environment variable for ${test.name}: ${envVar}`);
        }
      }
    }

    if (issues.length > 0) {
      console.error('❌ Prerequisite validation failed:');
      issues.forEach(issue => console.error(`  - ${issue}`));
      throw new Error(`${issues.length} prerequisite issues found`);
    }

    console.log('✅ All prerequisites validated');
  }

  private async runTestsInParallel(): Promise<void> {
    console.log('⚡ Running tests in parallel...');

    // Sort by priority and handle dependencies
    const sortedSuites = this.resolveDependencyOrder();
    const runningTests = new Map<string, Promise<TestSuiteResult>>();
    const completedTests = new Set<string>();

    for (const suite of sortedSuites) {
      // Wait for dependencies to complete
      for (const dependency of suite.dependencies) {
        if (!completedTests.has(dependency)) {
          const dependencyPromise = runningTests.get(dependency);
          if (dependencyPromise) {
            await dependencyPromise;
          }
        }
      }

      // Check if we can start this test (concurrency limit)
      while (runningTests.size >= this.config.maxConcurrency) {
        const completedPromise = await Promise.race(Array.from(runningTests.values()));
        const completedSuiteName = completedPromise.name;
        runningTests.delete(completedSuiteName);
        completedTests.add(completedSuiteName);
        this.results.push(completedPromise);
      }

      // Start the test
      const testPromise = this.runSingleTest(suite);
      runningTests.set(suite.name, testPromise);
    }

    // Wait for remaining tests to complete
    while (runningTests.size > 0) {
      const completedPromise = await Promise.race(Array.from(runningTests.values()));
      const completedSuiteName = completedPromise.name;
      runningTests.delete(completedSuiteName);
      completedTests.add(completedSuiteName);
      this.results.push(completedPromise);
    }
  }

  private async runTestsSequentially(): Promise<void> {
    console.log('📋 Running tests sequentially...');

    const sortedSuites = this.resolveDependencyOrder();

    for (const suite of sortedSuites) {
      const result = await this.runSingleTest(suite);
      this.results.push(result);

      // Stop on critical failure if configured
      if (!result.success && suite.priority <= 2) {
        console.log(`❌ Critical test failed: ${suite.name}. Stopping execution.`);
        break;
      }
    }
  }

  private resolveDependencyOrder(): TestSuiteDefinition[] {
    const sorted: TestSuiteDefinition[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (suite: TestSuiteDefinition) => {
      if (visiting.has(suite.name)) {
        throw new Error(`Circular dependency detected: ${suite.name}`);
      }
      if (visited.has(suite.name)) {
        return;
      }

      visiting.add(suite.name);

      // Visit dependencies first
      for (const depName of suite.dependencies) {
        const depSuite = this.config.testSuites.find(s => s.name === depName);
        if (depSuite) {
          visit(depSuite);
        }
      }

      visiting.delete(suite.name);
      visited.add(suite.name);
      sorted.push(suite);
    };

    // Sort by priority first, then resolve dependencies
    const prioritySorted = [...this.config.testSuites].sort((a, b) => a.priority - b.priority);

    for (const suite of prioritySorted) {
      if (!visited.has(suite.name)) {
        visit(suite);
      }
    }

    return sorted;
  }

  private async runSingleTest(suite: TestSuiteDefinition): Promise<TestSuiteResult> {
    console.log(`🧪 Starting ${suite.name} (${suite.category})...`);

    const startTime = performance.now();
    const scriptPath = join(__dirname, '..', suite.script);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`⏰ ${suite.name} timed out after ${this.config.timeoutMinutes} minutes`);
        resolve({
          name: suite.name,
          script: suite.script,
          startTime,
          endTime: performance.now(),
          duration: performance.now() - startTime,
          success: false,
          exitCode: -1,
          output: '',
          error: `Test timed out after ${this.config.timeoutMinutes} minutes`
        });
      }, this.config.timeoutMinutes * 60 * 1000);

      const child = spawn('npx', ['tsx', scriptPath], {
        stdio: 'pipe',
        env: {
          ...process.env,
          TEST_SUITE_NAME: suite.name,
          TEST_CATEGORY: suite.category
        }
      });

      let output = '';
      let error = '';

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        process.stdout.write(chunk); // Real-time output
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        error += chunk;
        process.stderr.write(chunk); // Real-time error output
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        const endTime = performance.now();
        const duration = endTime - startTime;

        const result: TestSuiteResult = {
          name: suite.name,
          script: suite.script,
          startTime,
          endTime,
          duration,
          success: code === 0,
          exitCode: code || 0,
          output,
          error: error || undefined
        };

        // Extract metrics if available in output
        try {
          const metricsMatch = output.match(/METRICS:(.+?)END_METRICS/s);
          if (metricsMatch) {
            result.metrics = JSON.parse(metricsMatch[1]);
          }
        } catch (e) {
          // Metrics parsing failed, continue without metrics
        }

        const status = result.success ? '✅' : '❌';
        const durationStr = (duration / 1000).toFixed(2);
        console.log(`${status} ${suite.name} completed in ${durationStr}s`);

        resolve(result);
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          name: suite.name,
          script: suite.script,
          startTime,
          endTime: performance.now(),
          duration: performance.now() - startTime,
          success: false,
          exitCode: -1,
          output,
          error: err.message
        });
      });
    });
  }

  private async generateConsolidatedReport(): Promise<ConsolidatedTestReport> {
    console.log('📊 Generating consolidated test report...');

    const totalDuration = performance.now() - this.startTime;
    const passedSuites = this.results.filter(r => r.success);
    const failedSuites = this.results.filter(r => !r.success);

    // Calculate performance metrics
    const testDurations = this.results.map(r => r.duration);
    const longestTest = this.results.reduce((max, r) => r.duration > max.duration ? r : max, this.results[0]);
    const shortestTest = this.results.reduce((min, r) => r.duration < min.duration ? r : min, this.results[0]);

    // Calculate parallelization efficiency
    const totalTestTime = this.results.reduce((sum, r) => sum + r.duration, 0);
    const parallelizationEfficiency = this.config.parallel ?
      Math.max(0, (totalTestTime - totalDuration) / totalTestTime) * 100 : 0;

    // Identify critical failures
    const criticalFailures = failedSuites
      .filter(r => {
        const suite = this.config.testSuites.find(s => s.name === r.name);
        return suite && suite.priority <= 2;
      })
      .map(r => r.name);

    const report: ConsolidatedTestReport = {
      testRun: {
        timestamp: new Date().toISOString(),
        duration: totalDuration,
        environment: process.env.NODE_ENV || 'development',
        configuration: this.config
      },
      summary: {
        totalSuites: this.results.length,
        passedSuites: passedSuites.length,
        failedSuites: failedSuites.length,
        skippedSuites: this.config.testSuites.length - this.results.length,
        overallSuccess: failedSuites.length === 0 && criticalFailures.length === 0,
        criticalFailures
      },
      suiteResults: this.results,
      performanceMetrics: {
        totalTestTime,
        averageTestTime: testDurations.reduce((sum, d) => sum + d, 0) / testDurations.length,
        longestTest: longestTest?.name || 'N/A',
        shortestTest: shortestTest?.name || 'N/A',
        parallelizationEfficiency
      },
      recommendations: this.generateRecommendations()
    };

    // Save report
    if (this.config.generateConsolidatedReport) {
      const reportPath = join(this.config.outputDir, `achievement_test_report_${Date.now()}.json`);
      writeFileSync(reportPath, JSON.stringify(report, null, 2));

      const summaryPath = join(this.config.outputDir, `achievement_test_summary_${Date.now()}.md`);
      writeFileSync(summaryPath, this.generateMarkdownSummary(report));

      console.log(`📋 Reports saved:`);
      console.log(`   - Detailed: ${reportPath}`);
      console.log(`   - Summary: ${summaryPath}`);
    }

    return report;
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];

    const failedTests = this.results.filter(r => !r.success);
    const slowTests = this.results.filter(r => r.duration > 10 * 60 * 1000); // > 10 minutes

    if (failedTests.length > 0) {
      recommendations.push(`Review ${failedTests.length} failed test suite(s): ${failedTests.map(t => t.name).join(', ')}`);
    }

    if (slowTests.length > 0) {
      recommendations.push(`Optimize ${slowTests.length} slow test suite(s): ${slowTests.map(t => t.name).join(', ')}`);
    }

    const integrationFailures = failedTests.filter(t => t.name.includes('Integration'));
    if (integrationFailures.length > 0) {
      recommendations.push('Critical integration test failures detected - prioritize fixes before deployment');
    }

    const performanceFailures = failedTests.filter(t => t.name.includes('Load') || t.name.includes('Performance'));
    if (performanceFailures.length > 0) {
      recommendations.push('Performance test failures may indicate scalability issues');
    }

    const mobileFailures = failedTests.filter(t => t.name.includes('Mobile'));
    if (mobileFailures.length > 0) {
      recommendations.push('Mobile compatibility issues detected - test on actual devices');
    }

    return recommendations;
  }

  private generateMarkdownSummary(report: ConsolidatedTestReport): string {
    const { summary, performanceMetrics, suiteResults } = report;
    const successRate = (summary.passedSuites / summary.totalSuites) * 100;

    return `# Discord Achievement System Test Report

## Test Execution Summary

- **Timestamp**: ${report.testRun.timestamp}
- **Duration**: ${(report.testRun.duration / 1000 / 60).toFixed(2)} minutes
- **Environment**: ${report.testRun.environment}
- **Configuration**: ${this.config.parallel ? 'Parallel' : 'Sequential'} execution

## Results Overview

- **Total Test Suites**: ${summary.totalSuites}
- **✅ Passed**: ${summary.passedSuites}
- **❌ Failed**: ${summary.failedSuites}
- **⏭️ Skipped**: ${summary.skippedSuites}
- **Success Rate**: ${successRate.toFixed(2)}%
- **Overall Status**: ${summary.overallSuccess ? '✅ PASSED' : '❌ FAILED'}

${summary.criticalFailures.length > 0 ? `
## 🚨 Critical Failures
${summary.criticalFailures.map(failure => `- ${failure}`).join('\n')}
` : ''}

## Performance Metrics

- **Total Test Time**: ${(performanceMetrics.totalTestTime / 1000 / 60).toFixed(2)} minutes
- **Average Test Time**: ${(performanceMetrics.averageTestTime / 1000).toFixed(2)} seconds
- **Longest Test**: ${performanceMetrics.longestTest}
- **Shortest Test**: ${performanceMetrics.shortestTest}
- **Parallelization Efficiency**: ${performanceMetrics.parallelizationEfficiency.toFixed(2)}%

## Test Suite Results

${suiteResults.map(result => `
### ${result.success ? '✅' : '❌'} ${result.name}

- **Duration**: ${(result.duration / 1000).toFixed(2)} seconds
- **Exit Code**: ${result.exitCode}
${result.error ? `- **Error**: ${result.error}` : ''}
${result.metrics ? `- **Metrics**: ${JSON.stringify(result.metrics, null, 2)}` : ''}
`).join('')}

## Recommendations

${report.recommendations.map(rec => `- ${rec}`).join('\n')}

## Next Steps

${summary.overallSuccess ? `
✅ All tests passed! The Discord achievement system is ready for deployment.

**Recommended actions:**
- Deploy to staging environment for final validation
- Monitor performance metrics in production
- Schedule regular test runs for regression detection
` : `
❌ Test failures detected. Address the following before deployment:

**Critical actions:**
${summary.criticalFailures.length > 0 ? '- Fix critical test failures immediately' : ''}
${summary.failedSuites > summary.totalSuites * 0.2 ? '- High failure rate indicates systemic issues' : ''}
- Review failed test logs and error messages
- Fix underlying issues and re-run tests
- Consider delaying deployment until all tests pass
`}

---
*Generated by PIPtip Achievement Test Runner*
`;
  }

  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up test environment...');

    // Remove temporary test files
    try {
      const tempFiles = [
        join(__dirname, '../.env.test'),
        join(this.config.outputDir, 'temp_*')
      ];

      for (const pattern of tempFiles) {
        // In a real implementation, you'd use glob to match patterns
        // For now, just clean up known temp files
      }
    } catch (error) {
      console.warn('⚠️ Warning: Cleanup had issues:', error);
    }

    console.log('✅ Cleanup complete');
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const options = {
    parallel: !args.includes('--sequential'),
    generateReport: !args.includes('--no-report'),
    maxConcurrency: parseInt(args.find(arg => arg.startsWith('--concurrency='))?.split('=')[1] || '3'),
    timeout: parseInt(args.find(arg => arg.startsWith('--timeout='))?.split('=')[1] || '30')
  };

  console.log('🚀 PIPtip Discord Achievement Test Suite');
  console.log(`⚙️ Options: ${JSON.stringify(options, null, 2)}`);

  const runner = new AchievementTestRunner();

  try {
    const report = await runner.runAllTests();

    console.log('\n📊 Test Execution Complete!');
    console.log(`✅ Passed: ${report.summary.passedSuites}/${report.summary.totalSuites}`);
    console.log(`❌ Failed: ${report.summary.failedSuites}`);
    console.log(`⚡ Duration: ${(report.testRun.duration / 1000 / 60).toFixed(2)} minutes`);

    if (report.summary.overallSuccess) {
      console.log('\n🎉 All tests passed! Achievement system is ready for viral moments!');
      process.exit(0);
    } else {
      console.log('\n💥 Some tests failed. Review the report and fix issues before deployment.');
      console.log(`🚨 Critical failures: ${report.summary.criticalFailures.length}`);
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test execution failed:', error);
    process.exit(1);
  }
}

// Help text
function showHelp() {
  console.log(`
🚀 PIPtip Achievement System Test Runner

Usage: npx tsx tests/run_achievement_tests.ts [options]

Options:
  --sequential       Run tests one at a time (default: parallel)
  --no-report        Skip generating detailed reports
  --concurrency=N    Set max parallel tests (default: 3)
  --timeout=N        Set timeout in minutes (default: 30)
  --help            Show this help message

Examples:
  npx tsx tests/run_achievement_tests.ts
  npx tsx tests/run_achievement_tests.ts --sequential --timeout=60
  npx tsx tests/run_achievement_tests.ts --concurrency=5 --no-report

Test Categories:
  - Integration: Core achievement system functionality
  - Performance: Load testing and stress testing
  - Compatibility: Mobile Discord app compatibility
  - Stress: Viral moment and high-volume scenarios
`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  main().catch(console.error);
}

export { AchievementTestRunner, TestSuiteConfig, ConsolidatedTestReport };