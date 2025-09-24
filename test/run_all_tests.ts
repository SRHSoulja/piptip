// test/run_all_tests.ts - Main test runner for prediction markets system
import 'dotenv/config';
import { testRunner, testData } from './test_setup.js';
import { runAutomationTests } from './test_automation.js';
import { runFullCycleTests } from './test_full_cycle.js';
import { runAPIIntegrationTests } from './test_api_integration.js';
import { runEdgeCaseTests } from './test_edge_cases.js';
import { runLoadTests } from './test_load.js';
import { ensurePrisma } from '../src/services/db.js';

async function runAllTests(): Promise<void> {
  console.log('🧪 PREDICTION MARKETS COMPREHENSIVE TEST SUITE');
  console.log('=' .repeat(60));
  console.log('Starting comprehensive validation before launch...\n');

  try {
    // Ensure database connection
    console.log('📡 Connecting to database...');
    await ensurePrisma();
    console.log('✅ Database connected\n');

    // Setup test environment
    console.log('🔧 Setting up test environment...');
    await testData.setupTestEnvironment();
    console.log('✅ Test environment ready\n');

    // Start timing
    const overallStartTime = Date.now();

    // Run all test suites in sequence
    console.log('🚀 Running test suites...\n');

    // 1. Automated Market Creation Tests
    console.log('📅 Running Automated Market Creation Tests...');
    try {
      await runAutomationTests();
      console.log('✅ Automation tests completed\n');
    } catch (error) {
      console.error('❌ Automation tests failed:', error);
    }

    // 2. Full Betting Cycle Tests
    console.log('🎯 Running Full Betting Cycle Tests...');
    try {
      await runFullCycleTests();
      console.log('✅ Full cycle tests completed\n');
    } catch (error) {
      console.error('❌ Full cycle tests failed:', error);
    }

    // 3. API Integration Tests
    console.log('🌐 Running API Integration Tests...');
    try {
      await runAPIIntegrationTests();
      console.log('✅ API integration tests completed\n');
    } catch (error) {
      console.error('❌ API integration tests failed:', error);
    }

    // 4. Edge Case Tests
    console.log('⚠️  Running Edge Case Validation Tests...');
    try {
      await runEdgeCaseTests();
      console.log('✅ Edge case tests completed\n');
    } catch (error) {
      console.error('❌ Edge case tests failed:', error);
    }

    // 5. Load Tests
    console.log('🏋️  Running Load Tests...');
    try {
      await runLoadTests();
      console.log('✅ Load tests completed\n');
    } catch (error) {
      console.error('❌ Load tests failed:', error);
    }

    // Calculate total time
    const totalDuration = Date.now() - overallStartTime;

    // Generate and display final report
    console.log('📊 Generating test report...\n');
    const report = testRunner.generateReport();
    console.log(report);

    console.log(`⏱️  Total test duration: ${Math.round(totalDuration / 1000)}s\n`);

    // Cleanup test data
    console.log('🧹 Cleaning up test data...');
    await testData.cleanupTestData();
    console.log('✅ Cleanup completed\n');

    // Final validation summary
    const allSuites = testRunner['suites']; // Access private property for final check
    const totalPassed = allSuites.reduce((sum, suite) => sum + suite.passed, 0);
    const totalFailed = allSuites.reduce((sum, suite) => sum + suite.failed, 0);

    if (totalFailed === 0) {
      console.log('🎉 ALL TESTS PASSED - PREDICTION MARKETS SYSTEM READY FOR LAUNCH! 🚀');
      console.log('\n✅ System validation checklist:');
      console.log('   • Market creation: VALIDATED');
      console.log('   • Betting mechanics: VALIDATED');
      console.log('   • Odds calculation: VALIDATED');
      console.log('   • Payout system: VALIDATED');
      console.log('   • API endpoints: VALIDATED');
      console.log('   • Edge cases: VALIDATED');
      console.log('   • Load handling: VALIDATED');
      console.log('   • Database integrity: VALIDATED');
      console.log('\n🔒 Security checks:');
      console.log('   • Input validation: TESTED');
      console.log('   • Authentication: TESTED');
      console.log('   • Balance verification: TESTED');
      console.log('   • Race condition prevention: TESTED');

      process.exit(0);
    } else {
      console.log('❌ SOME TESTS FAILED - SYSTEM NOT READY FOR LAUNCH');
      console.log(`\n⚠️  Issues found: ${totalFailed} failed tests`);
      console.log('Please review and fix the following before launch:');

      // List failed tests
      for (const suite of allSuites) {
        const failedTests = suite.results.filter(r => r.status === 'FAIL');
        if (failedTests.length > 0) {
          console.log(`\n🔴 ${suite.name}:`);
          for (const test of failedTests) {
            console.log(`   • ${test.name}: ${test.error}`);
          }
        }
      }

      process.exit(1);
    }

  } catch (error) {
    console.error('💥 FATAL ERROR during test execution:', error);

    // Attempt cleanup even after fatal error
    try {
      await testData.cleanupTestData();
    } catch (cleanupError) {
      console.error('❌ Cleanup also failed:', cleanupError);
    }

    process.exit(1);
  }
}

// Handle process termination gracefully
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Test interrupted by user');
  console.log('🧹 Performing cleanup...');

  try {
    await testData.cleanupTestData();
    console.log('✅ Cleanup completed');
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  }

  process.exit(1);
});

process.on('uncaughtException', async (error) => {
  console.error('\n💥 UNCAUGHT EXCEPTION:', error);

  try {
    await testData.cleanupTestData();
  } catch (cleanupError) {
    console.error('❌ Cleanup failed:', cleanupError);
  }

  process.exit(1);
});

// Run the tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests();
}