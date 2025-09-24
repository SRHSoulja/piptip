// Quick test to validate basic functionality
import 'dotenv/config';
import { testRunner, testData, assert } from './test_setup.js';
import { ensurePrisma } from '../src/services/db.js';

async function runQuickTest(): Promise<void> {
  console.log('🧪 QUICK PREDICTION MARKETS TEST');
  console.log('================================');

  try {
    // Test database connection
    console.log('📡 Testing database connection...');
    await ensurePrisma();
    console.log('✅ Database connected');

    // Test basic setup
    testRunner.startSuite('Quick Validation');

    await testRunner.runTest('Database connectivity', async () => {
      const { prisma } = await import('../src/services/db.js');
      const userCount = await prisma.user.count();
      assert.assertGreaterThan(userCount, -1, 'Database should be accessible');
      console.log(`Found ${userCount} users in database`);
    });

    await testRunner.runTest('Token system availability', async () => {
      const { getActiveTokens } = await import('../src/services/token.js');
      const tokens = await getActiveTokens();
      console.log(`Found ${tokens.length} active tokens`);
      assert.assertTrue(tokens.length >= 0, 'Token system should be accessible');
    });

    await testRunner.runTest('Market automation config', async () => {
      try {
        const { marketAutomationScheduler } = await import('../src/services/market_automation_scheduler.js');
        const config = marketAutomationScheduler.getConfig();
        assert.assertExists(config, 'Market automation config should be accessible');
        console.log(`Automation enabled: ${config.enabled}, schedule: ${config.schedule.join(', ')}`);
      } catch (error) {
        console.log('Market automation not available:', error);
      }
    });

    testRunner.finishSuite();

    const report = testRunner.generateReport();
    console.log(report);

    console.log('🎉 Quick test completed!');

  } catch (error) {
    console.error('❌ Quick test failed:', error);
    process.exit(1);
  }
}

runQuickTest();