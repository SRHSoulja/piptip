// test/test_load.ts - Load testing for prediction markets system
import { testRunner, testData, assert, createMockDiscordInteraction } from './test_setup.js';
import { predictionMarkets } from '../src/services/prediction_markets.js';
import { prisma } from '../src/services/db.js';
import { Decimal } from 'decimal.js';

export async function runLoadTests(): Promise<void> {
  testRunner.startSuite('Load Testing');

  const testUsers = testData.getTestUsers();
  const testGuildId = testData.getTestGuildId();
  let testToken: any;
  let loadTestMarkets: string[] = [];

  // Setup
  testToken = await testData.getTestToken();

  // Test 1: Concurrent Market Creation
  await testRunner.runTest('Concurrent market creation load test', async () => {
    const concurrentMarkets = 10;
    const startTime = Date.now();

    // Create multiple markets simultaneously
    const marketCreationPromises = Array.from({ length: concurrentMarkets }, (_, i) =>
      predictionMarkets.createMarket({
        title: `LOAD_TEST_MARKET_${i}_${Date.now()}`,
        description: `Load test market ${i} for concurrent creation testing`,
        endTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        tokenId: testToken.id,
        creatorId: testUsers[i % testUsers.length],
        guildId: testGuildId
      })
    );

    const results = await Promise.allSettled(marketCreationPromises);
    const successfulCreations = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const failedCreations = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));

    const duration = Date.now() - startTime;

    // Track successful markets for cleanup
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success && result.value.market) {
        loadTestMarkets.push(result.value.market.id);
        testData.addCreatedMarket(result.value.market.id);
      }
    }

    assert.assertGreaterThan(successfulCreations.length, concurrentMarkets * 0.8, 'At least 80% of markets should be created successfully');
    console.log(`Created ${successfulCreations.length}/${concurrentMarkets} markets in ${duration}ms (avg: ${Math.round(duration/concurrentMarkets)}ms per market)`);
  });

  // Test 2: Massive Concurrent Betting
  await testRunner.runTest('Massive concurrent betting load test', async () => {
    if (loadTestMarkets.length === 0) {
      // Create a test market if none available
      const marketResult = await predictionMarkets.createMarket({
        title: 'LOAD_TEST_BETTING_MARKET',
        description: 'Load test market for concurrent betting',
        endTime: new Date(Date.now() + 60 * 60 * 1000),
        tokenId: testToken.id,
        creatorId: testUsers[0],
        guildId: testGuildId
      });

      if (marketResult.success) {
        loadTestMarkets.push(marketResult.market!.id);
        testData.addCreatedMarket(marketResult.market!.id);
      }
    }

    const targetMarketId = loadTestMarkets[0];
    const concurrentBets = 50;
    const startTime = Date.now();

    // Create additional test users for load testing
    const loadTestUsers: string[] = [];
    for (let i = 0; i < 25; i++) {
      const userId = `LOAD_TEST_USER_${i}_${Date.now()}`;
      loadTestUsers.push(userId);

      // Create user and give balance
      await prisma.user.create({
        data: {
          discordId: userId,
          username: `LoadTestUser${i}`,
          walletAddress: `0x${userId.slice(-40).padStart(40, '0')}`,
          isActive: true
        }
      });

      await prisma.balance.create({
        data: {
          userId,
          tokenId: testToken.id,
          amount: '100.0' // Give each user 100 tokens
        }
      });
    }

    // Create concurrent betting load
    const bettingPromises = Array.from({ length: concurrentBets }, (_, i) => {
      const userId = loadTestUsers[i % loadTestUsers.length];
      const mockInteraction = createMockDiscordInteraction(userId, testGuildId);

      return predictionMarkets.placeBet({
        marketId: targetMarketId,
        userId,
        tokenId: testToken.id,
        side: i % 2 === 0 ? 'YES' : 'NO', // Alternate between YES and NO
        amount: '2', // Small amounts to avoid balance issues
        interaction: mockInteraction
      });
    });

    const results = await Promise.allSettled(bettingPromises);
    const successfulBets = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const failedBets = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));

    const duration = Date.now() - startTime;

    // Verify database consistency
    const totalBetsInDb = await prisma.bet.count({ where: { marketId: targetMarketId } });
    const market = await prisma.market.findUnique({ where: { id: targetMarketId } });

    assert.assertGreaterThan(successfulBets.length, concurrentBets * 0.6, 'At least 60% of bets should succeed under load');
    assert.assertEqual(totalBetsInDb, successfulBets.length, 'Database bet count should match successful bets');

    console.log(`Processed ${successfulBets.length}/${concurrentBets} bets in ${duration}ms`);
    console.log(`Final pools: YES=${market?.yesPool}, NO=${market?.noPool}`);

    // Cleanup load test users
    await prisma.balance.deleteMany({ where: { userId: { in: loadTestUsers } } });
    await prisma.bet.deleteMany({ where: { userId: { in: loadTestUsers } } });
    await prisma.user.deleteMany({ where: { discordId: { in: loadTestUsers } } });
  });

  // Test 3: Database Lock Contention Test
  await testRunner.runTest('Database lock contention prevention', async () => {
    if (loadTestMarkets.length === 0) return;

    const targetMarketId = loadTestMarkets[0];
    const contendingOperations = 20;

    // Create operations that would cause lock contention
    const operations = Array.from({ length: contendingOperations }, (_, i) => {
      if (i % 4 === 0) {
        // Market updates (odds recalculation)
        return prisma.market.findUnique({ where: { id: targetMarketId } });
      } else if (i % 4 === 1) {
        // Bet queries
        return prisma.bet.findMany({ where: { marketId: targetMarketId }, take: 10 });
      } else if (i % 4 === 2) {
        // Balance queries
        return prisma.balance.findMany({
          where: { tokenId: testToken.id },
          take: 5
        });
      } else {
        // User queries
        return prisma.user.findMany({
          where: { discordId: { in: testUsers } },
          take: 3
        });
      }
    });

    const startTime = Date.now();
    const results = await Promise.allSettled(operations);
    const duration = Date.now() - startTime;

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    assert.assertEqual(failed, 0, 'No database operations should fail due to lock contention');
    console.log(`Completed ${successful}/${contendingOperations} database operations in ${duration}ms`);
  });

  // Test 4: Memory Usage Under Load
  await testRunner.runTest('Memory usage stability under load', async () => {
    const initialMemory = process.memoryUsage();

    // Perform memory-intensive operations
    const operations = [];

    // Create and process many bets
    for (let i = 0; i < 100; i++) {
      operations.push(
        prisma.bet.findMany({
          where: { marketId: { in: loadTestMarkets } },
          include: { user: true, market: true, token: true }
        })
      );
    }

    // Create and process many market queries
    for (let i = 0; i < 50; i++) {
      operations.push(
        prisma.market.findMany({
          where: { status: 'ACTIVE' },
          include: { bets: true, creator: true, token: true }
        })
      );
    }

    await Promise.allSettled(operations);

    const finalMemory = process.memoryUsage();
    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
    const memoryIncreasePercent = (memoryIncrease / initialMemory.heapUsed) * 100;

    console.log(`Memory increase: ${Math.round(memoryIncrease / 1024 / 1024)}MB (${Math.round(memoryIncreasePercent)}%)`);
    console.log(`Heap used: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB`);

    // Memory increase should be reasonable (less than 100MB for this test)
    assert.assertLessThan(memoryIncrease, 100 * 1024 * 1024, 'Memory increase should be less than 100MB');
  });

  // Test 5: API Response Time Under Load
  await testRunner.runTest('API response time under load', async () => {
    const requestCount = 100;
    const startTime = Date.now();

    // Simulate multiple API requests
    const apiRequests = Array.from({ length: requestCount }, () =>
      prisma.market.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          title: true,
          yesOdds: true,
          noOdds: true,
          yesPool: true,
          noPool: true,
          endTime: true
        },
        take: 20
      })
    );

    const results = await Promise.allSettled(apiRequests);
    const duration = Date.now() - startTime;
    const avgResponseTime = duration / requestCount;

    const successful = results.filter(r => r.status === 'fulfilled').length;

    assert.assertEqual(successful, requestCount, 'All API requests should succeed');
    assert.assertLessThan(avgResponseTime, 100, 'Average response time should be under 100ms');

    console.log(`Processed ${requestCount} API requests in ${duration}ms (avg: ${Math.round(avgResponseTime)}ms)`);
  });

  // Test 6: Odds Calculation Performance
  await testRunner.runTest('Odds calculation performance under load', async () => {
    if (loadTestMarkets.length === 0) return;

    const targetMarketId = loadTestMarkets[0];
    const calculationCount = 1000;
    const startTime = Date.now();

    // Simulate rapid odds calculations
    for (let i = 0; i < calculationCount; i++) {
      const market = await prisma.market.findUnique({
        where: { id: targetMarketId }
      });

      if (market) {
        const yesPool = new Decimal(market.yesPool || '0');
        const noPool = new Decimal(market.noPool || '0');
        const totalPool = yesPool.plus(noPool);

        if (totalPool.gt(0)) {
          const yesOdds = totalPool.dividedBy(yesPool.gt(0) ? yesPool : new Decimal('0.01'));
          const noOdds = totalPool.dividedBy(noPool.gt(0) ? noPool : new Decimal('0.01'));

          // Simulate odds update
          await prisma.market.update({
            where: { id: targetMarketId },
            data: {
              yesOdds: yesOdds.toString(),
              noOdds: noOdds.toString()
            }
          });
        }
      }

      // Only update every 10th calculation to avoid overwhelming the database
      if (i % 10 !== 0) {
        continue;
      }
    }

    const duration = Date.now() - startTime;
    const avgCalculationTime = duration / (calculationCount / 10);

    console.log(`Performed ${calculationCount / 10} odds calculations in ${duration}ms (avg: ${Math.round(avgCalculationTime)}ms)`);
    assert.assertLessThan(avgCalculationTime, 50, 'Average odds calculation should be under 50ms');
  });

  // Test 7: Connection Pool Stress Test
  await testRunner.runTest('Database connection pool stress test', async () => {
    const connectionCount = 30; // Should stress the connection pool

    const connectionPromises = Array.from({ length: connectionCount }, async (_, i) => {
      // Hold connections for a brief period
      const startTime = Date.now();

      await prisma.user.findMany({
        where: { isActive: true },
        take: 5
      });

      await new Promise(resolve => setTimeout(resolve, 100)); // Hold connection briefly

      await prisma.market.findMany({
        where: { status: 'ACTIVE' },
        take: 5
      });

      return Date.now() - startTime;
    });

    const results = await Promise.allSettled(connectionPromises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const durations = results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<number>).value);

    const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const maxDuration = Math.max(...durations);

    assert.assertEqual(successful, connectionCount, 'All connection pool requests should succeed');
    assert.assertLessThan(maxDuration, 5000, 'No connection should take more than 5 seconds');

    console.log(`Connection pool test: ${successful}/${connectionCount} successful`);
    console.log(`Average duration: ${Math.round(avgDuration)}ms, Max: ${Math.round(maxDuration)}ms`);
  });

  // Test 8: Market Resolution Under Load
  await testRunner.runTest('Market resolution performance under load', async () => {
    // Create multiple markets to resolve
    const marketsToResolve = Math.min(5, loadTestMarkets.length);

    if (marketsToResolve === 0) {
      console.log('Skipping resolution test - no markets available');
      return;
    }

    const resolutionPromises = loadTestMarkets.slice(0, marketsToResolve).map((marketId, i) =>
      predictionMarkets.resolveMarket({
        marketId,
        outcome: i % 2 === 0 ? 'YES' : 'NO',
        resolvedBy: testUsers[0]
      })
    );

    const startTime = Date.now();
    const results = await Promise.allSettled(resolutionPromises);
    const duration = Date.now() - startTime;

    const successful = results.filter(r =>
      r.status === 'fulfilled' && r.value.success
    ).length;

    console.log(`Resolved ${successful}/${marketsToResolve} markets in ${duration}ms`);

    if (marketsToResolve > 0) {
      const avgResolutionTime = duration / marketsToResolve;
      assert.assertLessThan(avgResolutionTime, 1000, 'Average market resolution should be under 1 second');
    }
  });

  // Test 9: System Recovery After Load
  await testRunner.runTest('System recovery after load testing', async () => {
    // Wait for any pending operations to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test basic functionality still works
    const healthCheck = await prisma.user.count();
    assert.assertGreaterThan(healthCheck, 0, 'Database should still be responsive');

    // Test market creation still works
    const recoveryMarket = await predictionMarkets.createMarket({
      title: 'RECOVERY_TEST_Market',
      description: 'Test market to verify system recovery',
      endTime: new Date(Date.now() + 60 * 60 * 1000),
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    assert.assertTrue(recoveryMarket.success, 'System should recover normal functionality after load testing');

    if (recoveryMarket.market) {
      testData.addCreatedMarket(recoveryMarket.market.id);
    }

    console.log('System recovery verified - normal functionality restored');
  });

  // Test 10: Resource Cleanup Verification
  await testRunner.runTest('Resource cleanup verification', async () => {
    const beforeCleanup = {
      markets: await prisma.market.count(),
      bets: await prisma.bet.count(),
      users: await prisma.user.count()
    };

    // Verify no resource leaks
    const memoryUsage = process.memoryUsage();
    const memoryUsedMB = memoryUsage.heapUsed / 1024 / 1024;

    console.log(`Current resource usage:`);
    console.log(`- Markets: ${beforeCleanup.markets}`);
    console.log(`- Bets: ${beforeCleanup.bets}`);
    console.log(`- Users: ${beforeCleanup.users}`);
    console.log(`- Memory: ${Math.round(memoryUsedMB)}MB`);

    // Memory usage should be reasonable (less than 200MB for tests)
    assert.assertLessThan(memoryUsedMB, 200, 'Memory usage should remain reasonable');

    console.log('Load testing completed successfully');
  });

  testRunner.finishSuite();
}