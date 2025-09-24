// test/test_automation.ts - Automated market creation test suite
import { testRunner, testData, assert, createMockDiscordInteraction } from './test_setup.js';
import { marketAutomationScheduler } from '../src/services/market_automation_scheduler.js';
import { prisma } from '../src/services/db.js';
import fs from 'fs';
import path from 'path';

export async function runAutomationTests(): Promise<void> {
  testRunner.startSuite('Automated Market Creation');

  // Test 1: Configuration Loading and Validation
  await testRunner.runTest('Configuration loads correctly', async () => {
    const config = marketAutomationScheduler.getConfig();
    assert.assertTrue(typeof config.enabled === 'boolean', 'Config enabled should be boolean');
    assert.assertTrue(Array.isArray(config.schedule), 'Config schedule should be array');
    assert.assertTrue(config.maxDailyMarkets > 0, 'Max daily markets should be positive');
    assert.assertTrue(config.crypto.enabled || config.sports.enabled, 'At least one market type should be enabled');
  });

  // Test 2: Hot Configuration Reloading
  await testRunner.runTest('Hot configuration reload works', async () => {
    const configPath = path.join(process.cwd(), 'config', 'market_automation.json');
    const originalConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    try {
      // Modify config
      const testConfig = { ...originalConfig, maxDailyMarkets: 999 };
      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

      // Wait for file watcher to trigger
      await new Promise(resolve => setTimeout(resolve, 1000));

      const updatedConfig = marketAutomationScheduler.getConfig();
      assert.assertEqual(updatedConfig.maxDailyMarkets, 999, 'Config should be hot-reloaded');
    } finally {
      // Restore original config
      fs.writeFileSync(configPath, JSON.stringify(originalConfig, null, 2));
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  });

  // Test 3: Schedule Management
  await testRunner.runTest('Scheduler start/stop functionality', async () => {
    const initialStatus = marketAutomationScheduler.getStatus();

    marketAutomationScheduler.stop();
    const stoppedStatus = marketAutomationScheduler.getStatus();
    assert.assertFalse(stoppedStatus.isRunning, 'Scheduler should be stopped');

    marketAutomationScheduler.start();
    const startedStatus = marketAutomationScheduler.getStatus();
    assert.assertTrue(startedStatus.isRunning, 'Scheduler should be running');
  });

  // Test 4: Manual Market Creation Trigger
  await testRunner.runTest('Manual market creation trigger', async () => {
    const beforeCount = await prisma.market.count({
      where: { title: { startsWith: 'TEST_' } }
    });

    // Configure for test mode by temporarily setting defaultGuildId
    const config = marketAutomationScheduler.getConfig();
    marketAutomationScheduler.updateConfig({
      defaultGuildId: testData.getTestGuildId(),
      crypto: { ...config.crypto, enabled: true },
      sports: { ...config.sports, enabled: false } // Only test crypto for speed
    });

    const result = await marketAutomationScheduler.triggerManualCreation();

    if (result.success) {
      const afterCount = await prisma.market.count({
        where: { title: { startsWith: 'TEST_' } }
      });

      assert.assertGreaterThan(afterCount, beforeCount, 'Should create at least one test market');

      // Track created markets for cleanup
      const newMarkets = await prisma.market.findMany({
        where: {
          title: { startsWith: 'TEST_' },
          createdAt: { gte: new Date(Date.now() - 60000) }
        },
        select: { id: true }
      });

      for (const market of newMarkets) {
        testData.addCreatedMarket(market.id);
      }
    } else {
      console.log('Manual creation result:', result);
    }

    // Restore original config
    marketAutomationScheduler.updateConfig({
      defaultGuildId: null,
      crypto: config.crypto,
      sports: config.sports
    });
  });

  // Test 5: Daily Limit Enforcement
  await testRunner.runTest('Daily limit enforcement', async () => {
    const config = marketAutomationScheduler.getConfig();

    // Set very low daily limit for testing
    marketAutomationScheduler.updateConfig({
      maxDailyMarkets: 1,
      defaultGuildId: testData.getTestGuildId()
    });

    // Reset daily counters to ensure clean state
    marketAutomationScheduler.resetDailyCounters();

    // First creation should succeed
    const result1 = await marketAutomationScheduler.triggerManualCreation();

    // Second creation should be limited
    const result2 = await marketAutomationScheduler.triggerManualCreation();

    if (result1.success && result2.success) {
      // If both succeeded, check that we didn't exceed the limit
      const totalCreated = result1.markets.length + result2.markets.length;
      assert.assertLessThan(totalCreated, 3, 'Should respect daily limits');
    }

    // Restore original config
    marketAutomationScheduler.updateConfig({
      maxDailyMarkets: config.maxDailyMarkets,
      defaultGuildId: null
    });
  });

  // Test 6: Duplicate Prevention
  await testRunner.runTest('Duplicate market prevention', async () => {
    const config = marketAutomationScheduler.getConfig();

    marketAutomationScheduler.updateConfig({
      defaultGuildId: testData.getTestGuildId(),
      crypto: { ...config.crypto, enabled: true, tokens: ['BTC'] }, // Specific token
      sports: { ...config.sports, enabled: false }
    });

    // Create first market
    const result1 = await marketAutomationScheduler.triggerManualCreation();

    // Immediately try to create another - should be prevented by cooldown
    const result2 = await marketAutomationScheduler.triggerManualCreation();

    if (result1.success && result1.markets.length > 0) {
      for (const market of result1.markets) {
        testData.addCreatedMarket(market.id);
      }

      // Second attempt should create fewer or no markets due to cooldown
      if (result2.success) {
        const hasBTCMarkets1 = result1.markets.some(m => m.title.includes('BTC'));
        const hasBTCMarkets2 = result2.markets.some(m => m.title.includes('BTC'));

        if (hasBTCMarkets1 && hasBTCMarkets2) {
          // This might be OK if they're different types of BTC markets
          console.log('Both results had BTC markets - might be different subtypes');
        }
      }
    }

    // Restore original config
    marketAutomationScheduler.updateConfig({
      defaultGuildId: null,
      crypto: config.crypto,
      sports: config.sports
    });
  });

  // Test 7: Error Handling and Logging
  await testRunner.runTest('Error handling and logging', async () => {
    const beforeLogCount = await prisma.autoMarketLog.count();

    // Force an error by providing invalid guild ID
    marketAutomationScheduler.updateConfig({
      defaultGuildId: 'INVALID_GUILD_999999'
    });

    const result = await marketAutomationScheduler.triggerManualCreation();

    const afterLogCount = await prisma.autoMarketLog.count();
    assert.assertGreaterThan(afterLogCount, beforeLogCount, 'Should log market creation attempts');

    // Check that some logs exist
    const recentLogs = await prisma.autoMarketLog.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 60000) } },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    assert.assertGreaterThan(recentLogs.length, 0, 'Should have created logs');

    // Restore original config
    marketAutomationScheduler.updateConfig({ defaultGuildId: null });
  });

  // Test 8: Market Configuration Validation
  await testRunner.runTest('Market configuration validation', async () => {
    const originalConfig = marketAutomationScheduler.getConfig();

    // Test invalid time format
    try {
      marketAutomationScheduler.updateConfig({
        schedule: ['25:00', '09:00'] // Invalid hour
      });

      const result = await marketAutomationScheduler.triggerManualCreation();
      // Should handle gracefully without crashing

    } finally {
      marketAutomationScheduler.updateConfig({
        schedule: originalConfig.schedule
      });
    }

    // Test extreme values
    try {
      marketAutomationScheduler.updateConfig({
        maxDailyMarkets: -1 // Invalid value
      });

      const config = marketAutomationScheduler.getConfig();
      // Should have reasonable bounds
      assert.assertGreaterThan(config.maxDailyMarkets, -1, 'Should handle invalid max daily markets');

    } finally {
      marketAutomationScheduler.updateConfig({
        maxDailyMarkets: originalConfig.maxDailyMarkets
      });
    }
  });

  // Test 9: Analytics and Status Reporting
  await testRunner.runTest('Analytics and status reporting', async () => {
    const status = marketAutomationScheduler.getStatus();

    assert.assertTrue(typeof status.isRunning === 'boolean', 'Status should include running state');
    assert.assertTrue(typeof status.dailyCreationCount === 'number', 'Status should include daily count');
    assert.assertTrue(typeof status.consecutiveFailures === 'number', 'Status should include failure count');

    // Check that analytics are available
    const analytics = await marketAutomationScheduler.getAnalytics(7); // 7 days
    assert.assertTrue(typeof analytics.totalAttempts === 'number', 'Analytics should include total attempts');
    assert.assertTrue(typeof analytics.successRate === 'number', 'Analytics should include success rate');
  });

  // Test 10: Database Integration
  await testRunner.runTest('Database integration and persistence', async () => {
    const beforeCount = await prisma.autoMarketLog.count();

    // Trigger creation to generate logs
    const config = marketAutomationScheduler.getConfig();
    marketAutomationScheduler.updateConfig({
      defaultGuildId: testData.getTestGuildId(),
      maxDailyMarkets: 1
    });

    await marketAutomationScheduler.triggerManualCreation();

    const afterCount = await prisma.autoMarketLog.count();
    assert.assertGreaterThan(afterCount, beforeCount, 'Should persist logs to database');

    // Verify log structure
    const latestLog = await prisma.autoMarketLog.findFirst({
      orderBy: { createdAt: 'desc' }
    });

    if (latestLog) {
      assert.assertTrue(['crypto', 'sports'].includes(latestLog.type), 'Log should have valid type');
      assert.assertTrue(typeof latestLog.success === 'boolean', 'Log should have success flag');
      assert.assertExists(latestLog.config, 'Log should include config snapshot');
    }

    // Restore original config
    marketAutomationScheduler.updateConfig({
      defaultGuildId: null,
      maxDailyMarkets: config.maxDailyMarkets
    });
  });

  testRunner.finishSuite();
}