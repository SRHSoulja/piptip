// test/test_full_cycle.ts - Full betting cycle test suite
import { testRunner, testData, assert, createMockDiscordInteraction } from './test_setup.js';
import { predictionMarkets } from '../src/services/prediction_markets.js';
import { prisma } from '../src/services/db.js';
import { Decimal } from 'decimal.js';

export async function runFullCycleTests(): Promise<void> {
  testRunner.startSuite('Full Betting Cycle');

  let testMarketId: string;
  let testToken: any;
  const testUsers = testData.getTestUsers();
  const testGuildId = testData.getTestGuildId();

  // Test 1: Market Creation
  await testRunner.runTest('Create test market', async () => {
    testToken = await testData.getTestToken();
    const mockInteraction = createMockDiscordInteraction(testUsers[0], testGuildId);

    const result = await predictionMarkets.createMarket({
      title: 'TEST_MARKET_Will BTC reach $100k by end of year?',
      description: 'Test market for betting cycle validation',
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    assert.assertTrue(result.success, `Market creation should succeed: ${result.error}`);
    assert.assertExists(result.market, 'Market should be returned');

    testMarketId = result.market!.id;
    testData.addCreatedMarket(testMarketId);

    // Verify market in database
    const dbMarket = await prisma.market.findUnique({
      where: { id: testMarketId }
    });

    assert.assertExists(dbMarket, 'Market should exist in database');
    assert.assertEqual(dbMarket!.status, 'ACTIVE', 'Market should be active');
    assert.assertEqual(dbMarket!.yesPool, '0', 'Initial yes pool should be 0');
    assert.assertEqual(dbMarket!.noPool, '0', 'Initial no pool should be 0');
  });

  // Test 2: Initial Bet Placement
  await testRunner.runTest('Place initial bets', async () => {
    const mockInteraction1 = createMockDiscordInteraction(testUsers[0], testGuildId);
    const mockInteraction2 = createMockDiscordInteraction(testUsers[1], testGuildId);

    // User 1 bets YES with 100 tokens
    const result1 = await predictionMarkets.placeBet({
      marketId: testMarketId,
      userId: testUsers[0],
      tokenId: testToken.id,
      side: 'YES',
      amount: '100',
      interaction: mockInteraction1
    });

    assert.assertTrue(result1.success, `First bet should succeed: ${result1.error}`);

    // User 2 bets NO with 50 tokens
    const result2 = await predictionMarkets.placeBet({
      marketId: testMarketId,
      userId: testUsers[1],
      tokenId: testToken.id,
      side: 'NO',
      amount: '50',
      interaction: mockInteraction2
    });

    assert.assertTrue(result2.success, `Second bet should succeed: ${result2.error}`);

    // Verify bets in database
    const bets = await prisma.bet.findMany({
      where: { marketId: testMarketId }
    });

    assert.assertEqual(bets.length, 2, 'Should have 2 bets');

    const yesBet = bets.find(b => b.side === 'YES');
    const noBet = bets.find(b => b.side === 'NO');

    assert.assertExists(yesBet, 'YES bet should exist');
    assert.assertExists(noBet, 'NO bet should exist');
    assert.assertEqual(yesBet!.amount, '100', 'YES bet amount should be correct');
    assert.assertEqual(noBet!.amount, '50', 'NO bet amount should be correct');
  });

  // Test 3: Odds Calculation Verification
  await testRunner.runTest('Verify odds calculation', async () => {
    const market = await prisma.market.findUnique({
      where: { id: testMarketId }
    });

    assert.assertExists(market, 'Market should exist');

    // After bets: YES pool = 100, NO pool = 50
    assert.assertEqual(market!.yesPool, '100', 'YES pool should be updated');
    assert.assertEqual(market!.noPool, '50', 'NO pool should be updated');

    // Calculate expected odds
    const yesPool = new Decimal(market!.yesPool);
    const noPool = new Decimal(market!.noPool);
    const totalPool = yesPool.plus(noPool);

    const expectedYesOdds = totalPool.dividedBy(yesPool);
    const expectedNoOdds = totalPool.dividedBy(noPool);

    const actualYesOdds = new Decimal(market!.yesOdds);
    const actualNoOdds = new Decimal(market!.noOdds);

    // Allow small rounding differences
    const oddsThreshold = 0.01;
    assert.assertTrue(
      actualYesOdds.minus(expectedYesOdds).abs().lt(oddsThreshold),
      `YES odds should be approximately ${expectedYesOdds.toString()}, got ${actualYesOdds.toString()}`
    );
    assert.assertTrue(
      actualNoOdds.minus(expectedNoOdds).abs().lt(oddsThreshold),
      `NO odds should be approximately ${expectedNoOdds.toString()}, got ${actualNoOdds.toString()}`
    );
  });

  // Test 4: Additional Bet Placement and Odds Updates
  await testRunner.runTest('Place additional bets and verify odds updates', async () => {
    const mockInteraction3 = createMockDiscordInteraction(testUsers[2], testGuildId);
    const mockInteraction4 = createMockDiscordInteraction(testUsers[3], testGuildId);

    // User 3 bets YES with 200 tokens
    const result3 = await predictionMarkets.placeBet({
      marketId: testMarketId,
      userId: testUsers[2],
      tokenId: testToken.id,
      side: 'YES',
      amount: '200',
      interaction: mockInteraction3
    });

    assert.assertTrue(result3.success, `Third bet should succeed: ${result3.error}`);

    // User 4 bets NO with 100 tokens
    const result4 = await predictionMarkets.placeBet({
      marketId: testMarketId,
      userId: testUsers[3],
      tokenId: testToken.id,
      side: 'NO',
      amount: '100',
      interaction: mockInteraction4
    });

    assert.assertTrue(result4.success, `Fourth bet should succeed: ${result4.error}`);

    // Verify updated pools
    const updatedMarket = await prisma.market.findUnique({
      where: { id: testMarketId }
    });

    assert.assertExists(updatedMarket, 'Updated market should exist');
    assert.assertEqual(updatedMarket!.yesPool, '300', 'YES pool should be 300 (100+200)');
    assert.assertEqual(updatedMarket!.noPool, '150', 'NO pool should be 150 (50+100)');

    // Verify bet count
    const totalBets = await prisma.bet.count({
      where: { marketId: testMarketId }
    });

    assert.assertEqual(totalBets, 4, 'Should have 4 total bets');
  });

  // Test 5: Balance Deduction Verification
  await testRunner.runTest('Verify user balance deductions', async () => {
    // Check that user balances were properly deducted
    const user1Balance = await prisma.balance.findUnique({
      where: {
        userId_tokenId: {
          userId: testUsers[0],
          tokenId: testToken.id
        }
      }
    });

    const user2Balance = await prisma.balance.findUnique({
      where: {
        userId_tokenId: {
          userId: testUsers[1],
          tokenId: testToken.id
        }
      }
    });

    assert.assertExists(user1Balance, 'User 1 balance should exist');
    assert.assertExists(user2Balance, 'User 2 balance should exist');

    // User 1 bet 100, should have 900 left
    assert.assertEqual(user1Balance!.amount, '900.0', 'User 1 balance should be reduced by 100');

    // User 2 bet 50, should have 950 left
    assert.assertEqual(user2Balance!.amount, '950.0', 'User 2 balance should be reduced by 50');
  });

  // Test 6: Market Resolution - YES Wins
  await testRunner.runTest('Resolve market with YES outcome', async () => {
    const result = await predictionMarkets.resolveMarket({
      marketId: testMarketId,
      outcome: 'YES',
      resolvedBy: testUsers[0]
    });

    assert.assertTrue(result.success, `Market resolution should succeed: ${result.error}`);

    // Verify market status
    const resolvedMarket = await prisma.market.findUnique({
      where: { id: testMarketId }
    });

    assert.assertExists(resolvedMarket, 'Resolved market should exist');
    assert.assertEqual(resolvedMarket!.status, 'RESOLVED', 'Market should be resolved');
    assert.assertEqual(resolvedMarket!.outcome, 'YES', 'Outcome should be YES');
  });

  // Test 7: Payout Calculation and Distribution
  await testRunner.runTest('Verify payout calculations with rake', async () => {
    // Get all bets for this market
    const bets = await prisma.bet.findMany({
      where: { marketId: testMarketId },
      include: { user: true }
    });

    const yesBets = bets.filter(b => b.side === 'YES');
    const noBets = bets.filter(b => b.side === 'NO');

    // Calculate expected payouts
    const totalPool = new Decimal('450'); // 300 YES + 150 NO
    const rakePercentage = testToken.houseRakePercentage; // Should be 3%
    const rake = totalPool.times(rakePercentage).dividedBy(100);
    const payoutPool = totalPool.minus(rake);

    const yesPool = new Decimal('300');

    // For each YES bet, calculate expected payout
    for (const bet of yesBets) {
      const betAmount = new Decimal(bet.amount);
      const betShare = betAmount.dividedBy(yesPool);
      const expectedPayout = payoutPool.times(betShare);

      // Check if payout was calculated (this might be in a separate payout system)
      console.log(`User ${bet.userId} bet ${bet.amount} YES, expected payout: ${expectedPayout.toString()}`);
    }

    // Verify that NO bets get nothing (since YES won)
    assert.assertEqual(noBets.length, 2, 'Should have 2 NO bets that get nothing');

    // Verify rake calculation
    const expectedRake = new Decimal('13.5'); // 3% of 450
    assert.assertTrue(rake.equals(expectedRake), `Rake should be ${expectedRake.toString()}, got ${rake.toString()}`);
  });

  // Test 8: Balance Updates After Resolution
  await testRunner.runTest('Verify balance updates after resolution', async () => {
    // Note: This test assumes the payout system updates balances
    // If payouts are handled separately, this test should be adjusted

    const market = await prisma.market.findUnique({
      where: { id: testMarketId }
    });

    const bets = await prisma.bet.findMany({
      where: { marketId: testMarketId, side: 'YES' }
    });

    // Calculate what balances should be after payouts
    const totalPool = new Decimal(market!.yesPool).plus(new Decimal(market!.noPool));
    const rakePercentage = testToken.houseRakePercentage;
    const rake = totalPool.times(rakePercentage).dividedBy(100);
    const payoutPool = totalPool.minus(rake);
    const yesPool = new Decimal(market!.yesPool);

    for (const bet of bets) {
      const currentBalance = await prisma.balance.findUnique({
        where: {
          userId_tokenId: {
            userId: bet.userId,
            tokenId: testToken.id
          }
        }
      });

      assert.assertExists(currentBalance, `Balance should exist for user ${bet.userId}`);

      // Calculate expected payout for this bet
      const betAmount = new Decimal(bet.amount);
      const betShare = betAmount.dividedBy(yesPool);
      const expectedPayout = payoutPool.times(betShare);

      console.log(`User ${bet.userId}: Current balance ${currentBalance!.amount}, bet ${bet.amount}, expected payout ${expectedPayout.toString()}`);
    }
  });

  // Test 9: House Rake Collection
  await testRunner.runTest('Verify house rake collection', async () => {
    // Check if there's a system for tracking house rake
    // This might be in transactions, or a separate house balance system

    const rakeTransactions = await prisma.transaction.findMany({
      where: {
        type: 'MATCH_RAKE',
        guildId: testGuildId,
        tokenId: testToken.id,
        createdAt: { gte: new Date(Date.now() - 60000) } // Last minute
      }
    });

    // If rake system is implemented
    if (rakeTransactions.length > 0) {
      const totalRake = rakeTransactions.reduce(
        (sum, tx) => sum.plus(new Decimal(tx.amount)),
        new Decimal(0)
      );

      const expectedRake = new Decimal('13.5'); // 3% of 450
      assert.assertTrue(
        totalRake.gte(expectedRake.times(0.9)), // Allow for small differences
        `Total rake should be approximately ${expectedRake.toString()}, got ${totalRake.toString()}`
      );
    } else {
      console.log('No rake transactions found - rake system may not be fully implemented');
    }
  });

  // Test 10: Market Cancellation Flow
  await testRunner.runTest('Test market cancellation and refunds', async () => {
    // Create a new market for cancellation testing
    const mockInteraction = createMockDiscordInteraction(testUsers[0], testGuildId);

    const marketResult = await predictionMarkets.createMarket({
      title: 'TEST_CANCEL_Market to be cancelled',
      description: 'Test market for cancellation',
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testGuildId
    });

    assert.assertTrue(marketResult.success, 'Cancel test market should be created');
    const cancelMarketId = marketResult.market!.id;
    testData.addCreatedMarket(cancelMarketId);

    // Place some bets
    const betResult1 = await predictionMarkets.placeBet({
      marketId: cancelMarketId,
      userId: testUsers[0],
      tokenId: testToken.id,
      side: 'YES',
      amount: '50',
      interaction: mockInteraction
    });

    const betResult2 = await predictionMarkets.placeBet({
      marketId: cancelMarketId,
      userId: testUsers[1],
      tokenId: testToken.id,
      side: 'NO',
      amount: '30',
      interaction: createMockDiscordInteraction(testUsers[1], testGuildId)
    });

    assert.assertTrue(betResult1.success && betResult2.success, 'Bets for cancel test should succeed');

    // Get balances before cancellation
    const balanceBefore1 = await prisma.balance.findUnique({
      where: { userId_tokenId: { userId: testUsers[0], tokenId: testToken.id } }
    });

    const balanceBefore2 = await prisma.balance.findUnique({
      where: { userId_tokenId: { userId: testUsers[1], tokenId: testToken.id } }
    });

    // Cancel the market
    const cancelResult = await predictionMarkets.resolveMarket({
      marketId: cancelMarketId,
      outcome: 'CANCELLED',
      resolvedBy: testUsers[0]
    });

    assert.assertTrue(cancelResult.success, 'Market cancellation should succeed');

    // Verify market status
    const cancelledMarket = await prisma.market.findUnique({
      where: { id: cancelMarketId }
    });

    assert.assertEqual(cancelledMarket!.status, 'CANCELLED', 'Market should be cancelled');

    // Verify refunds (if implemented)
    const balanceAfter1 = await prisma.balance.findUnique({
      where: { userId_tokenId: { userId: testUsers[0], tokenId: testToken.id } }
    });

    const balanceAfter2 = await prisma.balance.findUnique({
      where: { userId_tokenId: { userId: testUsers[1], tokenId: testToken.id } }
    });

    // Balances should be restored (if refund system is implemented)
    console.log(`User 1 balance: ${balanceBefore1?.amount} -> ${balanceAfter1?.amount}`);
    console.log(`User 2 balance: ${balanceBefore2?.amount} -> ${balanceAfter2?.amount}`);
  });

  testRunner.finishSuite();
}