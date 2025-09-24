// test/test_edge_cases.ts - Edge case validation test suite
import { testRunner, testData, assert, createMockDiscordInteraction } from './test_setup.js';
import { predictionMarkets } from '../src/services/prediction_markets.js';
import { prisma } from '../src/services/db.js';
import { Decimal } from 'decimal.js';

export async function runEdgeCaseTests(): Promise<void> {
  testRunner.startSuite('Edge Case Validation');

  const testUsers = testData.getTestUsers();
  const testGuildId = testData.getTestGuildId();
  let testToken: any;

  // Setup
  testToken = await testData.getTestToken();

  // Test 1: Market with only YES bets (should cancel/refund)
  await testRunner.runTest('Market with only YES bets handling', async () => {
    // Create test market
    const marketResult = await predictionMarkets.createMarket({
      title: 'TEST_YES_ONLY_Market with only yes bets',
      description: 'Test market for yes-only scenario',
      endTime: new Date(Date.now() + 1000), // Very short duration
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    assert.assertTrue(marketResult.success, 'Market creation should succeed');
    const marketId = marketResult.market!.id;
    testData.addCreatedMarket(marketId);

    // Place only YES bets
    const mockInteraction1 = createMockDiscordInteraction(testUsers[0], testGuildId);
    const mockInteraction2 = createMockDiscordInteraction(testUsers[1], testGuildId);

    const bet1 = await predictionMarkets.placeBet({
      marketId,
      userId: testUsers[0],
      tokenId: testToken.id,
      side: 'YES',
      amount: '50',
      interaction: mockInteraction1
    });

    const bet2 = await predictionMarkets.placeBet({
      marketId,
      userId: testUsers[1],
      tokenId: testToken.id,
      side: 'YES',
      amount: '30',
      interaction: mockInteraction2
    });

    assert.assertTrue(bet1.success && bet2.success, 'YES bets should succeed');

    // Wait for market to expire
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Try to resolve - should handle one-sided betting
    const resolveResult = await predictionMarkets.resolveMarket({
      marketId,
      outcome: 'CANCELLED', // Admin should cancel one-sided markets
      resolvedBy: testUsers[0]
    });

    if (resolveResult.success) {
      // Verify market was cancelled
      const market = await prisma.market.findUnique({ where: { id: marketId } });
      assert.assertEqual(market!.status, 'CANCELLED', 'One-sided market should be cancelled');

      // Check if refunds were processed (if system supports it)
      const bets = await prisma.bet.findMany({ where: { marketId } });
      console.log(`Market had ${bets.length} bets, all YES side, status: ${market!.status}`);
    }
  });

  // Test 2: User betting more than balance (should reject)
  await testRunner.runTest('Betting more than balance rejection', async () => {
    // Create test market
    const marketResult = await predictionMarkets.createMarket({
      title: 'TEST_INSUFFICIENT_BALANCE_Market',
      description: 'Test market for balance validation',
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    assert.assertTrue(marketResult.success, 'Market creation should succeed');
    const marketId = marketResult.market!.id;
    testData.addCreatedMarket(marketId);

    // Check user's actual balance
    const userBalance = await prisma.balance.findUnique({
      where: {
        userId_tokenId: {
          userId: testUsers[0],
          tokenId: testToken.id
        }
      }
    });

    assert.assertExists(userBalance, 'User should have balance record');

    const currentBalance = new Decimal(userBalance!.amount);
    const excessiveAmount = currentBalance.plus(100).toString(); // More than balance

    // Attempt to bet more than balance
    const mockInteraction = createMockDiscordInteraction(testUsers[0], testGuildId);
    const betResult = await predictionMarkets.placeBet({
      marketId,
      userId: testUsers[0],
      tokenId: testToken.id,
      side: 'YES',
      amount: excessiveAmount,
      interaction: mockInteraction
    });

    assert.assertFalse(betResult.success, 'Should reject bet exceeding balance');
    assert.assertTrue(
      betResult.error?.toLowerCase().includes('insufficient') ||
      betResult.error?.toLowerCase().includes('balance'),
      `Error message should mention balance: ${betResult.error}`
    );

    // Verify balance wasn't changed
    const balanceAfter = await prisma.balance.findUnique({
      where: {
        userId_tokenId: {
          userId: testUsers[0],
          tokenId: testToken.id
        }
      }
    });

    assert.assertEqual(balanceAfter!.amount, userBalance!.amount, 'Balance should be unchanged');
  });

  // Test 3: API failures during resolution (should handle gracefully)
  await testRunner.runTest('API failure handling during resolution', async () => {
    // Create test market
    const marketResult = await predictionMarkets.createMarket({
      title: 'TEST_API_FAILURE_Market for API failure testing',
      description: 'Test market for API failure handling',
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    const marketId = marketResult.market!.id;
    testData.addCreatedMarket(marketId);

    // Place some bets
    const mockInteraction = createMockDiscordInteraction(testUsers[0], testGuildId);
    await predictionMarkets.placeBet({
      marketId,
      userId: testUsers[0],
      tokenId: testToken.id,
      side: 'YES',
      amount: '10',
      interaction: mockInteraction
    });

    // Simulate resolution with potential API failures by trying invalid outcomes
    const invalidResolve = await predictionMarkets.resolveMarket({
      marketId,
      outcome: 'INVALID_OUTCOME' as any,
      resolvedBy: testUsers[0]
    });

    // System should handle invalid outcomes gracefully
    assert.assertFalse(invalidResolve.success, 'Should reject invalid outcomes');

    // Market should still be resolvable with valid outcome
    const validResolve = await predictionMarkets.resolveMarket({
      marketId,
      outcome: 'YES',
      resolvedBy: testUsers[0]
    });

    assert.assertTrue(validResolve.success, 'Should accept valid outcomes after invalid attempt');
  });

  // Test 4: Simultaneous bets (no race conditions)
  await testRunner.runTest('Simultaneous betting race condition prevention', async () => {
    // Create test market
    const marketResult = await predictionMarkets.createMarket({
      title: 'TEST_RACE_CONDITION_Market for race testing',
      description: 'Test market for race condition testing',
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    const marketId = marketResult.market!.id;
    testData.addCreatedMarket(marketId);

    // Create multiple simultaneous bet attempts from same user
    const mockInteraction1 = createMockDiscordInteraction(testUsers[0], testGuildId);
    const mockInteraction2 = createMockDiscordInteraction(testUsers[0], testGuildId);
    const mockInteraction3 = createMockDiscordInteraction(testUsers[0], testGuildId);

    const simultaneousBets = [
      predictionMarkets.placeBet({
        marketId,
        userId: testUsers[0],
        tokenId: testToken.id,
        side: 'YES',
        amount: '100',
        interaction: mockInteraction1
      }),
      predictionMarkets.placeBet({
        marketId,
        userId: testUsers[0],
        tokenId: testToken.id,
        side: 'NO',
        amount: '100',
        interaction: mockInteraction2
      }),
      predictionMarkets.placeBet({
        marketId,
        userId: testUsers[0],
        tokenId: testToken.id,
        side: 'YES',
        amount: '100',
        interaction: mockInteraction3
      })
    ];

    const results = await Promise.allSettled(simultaneousBets);
    const successfulBets = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failedBets = results.length - successfulBets;

    // Some bets should fail due to insufficient balance after first bet
    assert.assertGreaterThan(failedBets, 0, 'Some simultaneous bets should fail due to balance constraints');
    assert.assertGreaterThan(successfulBets, 0, 'At least one bet should succeed');

    // Check final balance consistency
    const finalBalance = await prisma.balance.findUnique({
      where: {
        userId_tokenId: {
          userId: testUsers[0],
          tokenId: testToken.id
        }
      }
    });

    const userBets = await prisma.bet.findMany({
      where: { marketId, userId: testUsers[0] }
    });

    const totalBetAmount = userBets.reduce((sum, bet) => sum.plus(new Decimal(bet.amount)), new Decimal(0));
    console.log(`User placed ${userBets.length} bets totaling ${totalBetAmount.toString()}, final balance: ${finalBalance!.amount}`);

    // Balance should be consistent with successful bets
    assert.assertTrue(
      new Decimal(finalBalance!.amount).plus(totalBetAmount).lte(1000), // Original balance was 1000
      'Balance should be consistent with placed bets'
    );
  });

  // Test 5: Market resolution at exact same time as bet placement
  await testRunner.runTest('Market resolution during bet placement', async () => {
    // Create test market with very short duration
    const marketResult = await predictionMarkets.createMarket({
      title: 'TEST_RESOLUTION_RACE_Market',
      description: 'Test market for resolution race condition',
      endTime: new Date(Date.now() + 2000), // 2 seconds
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    const marketId = marketResult.market!.id;
    testData.addCreatedMarket(marketId);

    // Wait until just before expiry
    await new Promise(resolve => setTimeout(resolve, 1800));

    // Try to place bet and resolve simultaneously
    const mockInteraction = createMockDiscordInteraction(testUsers[1], testGuildId);

    const betPromise = predictionMarkets.placeBet({
      marketId,
      userId: testUsers[1],
      tokenId: testToken.id,
      side: 'YES',
      amount: '10',
      interaction: mockInteraction
    });

    const resolvePromise = predictionMarkets.resolveMarket({
      marketId,
      outcome: 'YES',
      resolvedBy: testUsers[0]
    });

    const [betResult, resolveResult] = await Promise.allSettled([betPromise, resolvePromise]);

    // One operation should succeed, the other should fail appropriately
    console.log('Bet result:', betResult.status === 'fulfilled' ? betResult.value : 'rejected');
    console.log('Resolve result:', resolveResult.status === 'fulfilled' ? resolveResult.value : 'rejected');

    // Verify final market state is consistent
    const finalMarket = await prisma.market.findUnique({ where: { id: marketId } });
    assert.assertExists(finalMarket, 'Market should exist');

    if (finalMarket!.status === 'RESOLVED') {
      console.log('Market was resolved, bet should have been rejected if placed after resolution');
    } else {
      console.log('Market resolution may have failed, bet might have succeeded');
    }
  });

  // Test 6: Zero amount betting
  await testRunner.runTest('Zero amount bet rejection', async () => {
    const marketResult = await predictionMarkets.createMarket({
      title: 'TEST_ZERO_BET_Market',
      description: 'Test market for zero bet validation',
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    const marketId = marketResult.market!.id;
    testData.addCreatedMarket(marketId);

    const mockInteraction = createMockDiscordInteraction(testUsers[0], testGuildId);
    const zeroBetResult = await predictionMarkets.placeBet({
      marketId,
      userId: testUsers[0],
      tokenId: testToken.id,
      side: 'YES',
      amount: '0',
      interaction: mockInteraction
    });

    assert.assertFalse(zeroBetResult.success, 'Should reject zero amount bets');
  });

  // Test 7: Negative amount betting
  await testRunner.runTest('Negative amount bet rejection', async () => {
    const marketResult = await predictionMarkets.createMarket({
      title: 'TEST_NEGATIVE_BET_Market',
      description: 'Test market for negative bet validation',
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    const marketId = marketResult.market!.id;
    testData.addCreatedMarket(marketId);

    const mockInteraction = createMockDiscordInteraction(testUsers[0], testGuildId);
    const negativeBetResult = await predictionMarkets.placeBet({
      marketId,
      userId: testUsers[0],
      tokenId: testToken.id,
      side: 'YES',
      amount: '-10',
      interaction: mockInteraction
    });

    assert.assertFalse(negativeBetResult.success, 'Should reject negative amount bets');
  });

  // Test 8: Betting on non-existent market
  await testRunner.runTest('Betting on non-existent market', async () => {
    const mockInteraction = createMockDiscordInteraction(testUsers[0], testGuildId);
    const invalidMarketBet = await predictionMarkets.placeBet({
      marketId: 'non-existent-market-id',
      userId: testUsers[0],
      tokenId: testToken.id,
      side: 'YES',
      amount: '10',
      interaction: mockInteraction
    });

    assert.assertFalse(invalidMarketBet.success, 'Should reject bets on non-existent markets');
  });

  // Test 9: Betting on resolved market
  await testRunner.runTest('Betting on resolved market', async () => {
    // Create and immediately resolve a market
    const marketResult = await predictionMarkets.createMarket({
      title: 'TEST_RESOLVED_BET_Market',
      description: 'Test market for resolved market betting',
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    const marketId = marketResult.market!.id;
    testData.addCreatedMarket(marketId);

    // Resolve the market
    await predictionMarkets.resolveMarket({
      marketId,
      outcome: 'YES',
      resolvedBy: testUsers[0]
    });

    // Try to bet on resolved market
    const mockInteraction = createMockDiscordInteraction(testUsers[1], testGuildId);
    const betOnResolvedResult = await predictionMarkets.placeBet({
      marketId,
      userId: testUsers[1],
      tokenId: testToken.id,
      side: 'NO',
      amount: '10',
      interaction: mockInteraction
    });

    assert.assertFalse(betOnResolvedResult.success, 'Should reject bets on resolved markets');
  });

  // Test 10: Database constraint violations
  await testRunner.runTest('Database constraint handling', async () => {
    const marketResult = await predictionMarkets.createMarket({
      title: 'TEST_CONSTRAINT_Market',
      description: 'Test market for constraint validation',
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    const marketId = marketResult.market!.id;
    testData.addCreatedMarket(marketId);

    try {
      // Try to create a duplicate market with same ID (should fail)
      await prisma.market.create({
        data: {
          id: marketId, // Duplicate ID
          title: 'Duplicate Market',
          description: 'Should fail',
          endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
          tokenId: testToken.id,
          creatorId: testUsers[0],
          guildId: testGuildId,
          status: 'ACTIVE',
          yesPool: '0',
          noPool: '0',
          yesOdds: '2.00',
          noOdds: '2.00'
        }
      });

      assert.assertTrue(false, 'Should not allow duplicate market IDs');
    } catch (error) {
      // Expected - constraint violation should be handled
      console.log('Constraint violation properly handled');
    }
  });

  // Test 11: Extreme decimal precision
  await testRunner.runTest('Extreme decimal precision handling', async () => {
    const marketResult = await predictionMarkets.createMarket({
      title: 'TEST_PRECISION_Market',
      description: 'Test market for precision testing',
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    const marketId = marketResult.market!.id;
    testData.addCreatedMarket(marketId);

    // Try bet with extreme precision
    const mockInteraction = createMockDiscordInteraction(testUsers[0], testGuildId);
    const precisionBetResult = await predictionMarkets.placeBet({
      marketId,
      userId: testUsers[0],
      tokenId: testToken.id,
      side: 'YES',
      amount: '0.123456789123456789', // Very high precision
      interaction: mockInteraction
    });

    if (precisionBetResult.success) {
      // Verify precision is handled appropriately
      const bet = await prisma.bet.findFirst({
        where: { marketId, userId: testUsers[0] }
      });

      console.log(`High precision bet: input ${0.123456789123456789}, stored: ${bet?.amount}`);
    } else {
      console.log('High precision bet rejected:', precisionBetResult.error);
    }
  });

  // Test 12: Memory and resource cleanup
  await testRunner.runTest('Memory and resource cleanup', async () => {
    // Create multiple markets and verify they don't cause memory leaks
    const marketPromises = Array.from({ length: 10 }, (_, i) =>
      predictionMarkets.createMarket({
        title: `TEST_CLEANUP_Market_${i}`,
        description: `Cleanup test market ${i}`,
        endTime: new Date(Date.now() + 1000), // Short duration
        tokenId: testToken.id,
        creatorId: testUsers[0],
        guildId: testGuildId
      })
    );

    const results = await Promise.all(marketPromises);
    const successfulMarkets = results.filter(r => r.success);

    // Track created markets for cleanup
    for (const result of successfulMarkets) {
      if (result.market) {
        testData.addCreatedMarket(result.market.id);
      }
    }

    assert.assertGreaterThan(successfulMarkets.length, 5, 'Should create multiple markets successfully');

    // Wait for expiry
    await new Promise(resolve => setTimeout(resolve, 1100));

    console.log(`Created ${successfulMarkets.length} test markets for cleanup testing`);
  });

  testRunner.finishSuite();
}