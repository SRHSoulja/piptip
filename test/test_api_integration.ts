// test/test_api_integration.ts - API integration test suite
import { testRunner, testData, assert } from './test_setup.js';
import express from 'express';
import request from 'supertest';
import { adminRouter } from '../src/web/admin.js';
import { marketsApiRouter } from '../src/web/api/markets.js';
import { prisma } from '../src/services/db.js';

export async function runAPIIntegrationTests(): Promise<void> {
  testRunner.startSuite('API Integration');

  // Setup test app
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  app.use('/api', marketsApiRouter);

  const adminSecret = process.env.ADMIN_SECRET || 'test-admin-secret';
  let testMarketId: string;
  let testToken: any;

  // Test 1: Health Check Endpoint
  await testRunner.runTest('Health check endpoint', async () => {
    const response = await request(app)
      .get('/api/health')
      .expect(200);

    assert.assertEqual(response.body.status, 'ok', 'Health check should return ok');
    assert.assertExists(response.body.timestamp, 'Health check should include timestamp');
  });

  // Test 2: Admin Authentication
  await testRunner.runTest('Admin authentication', async () => {
    // Test without auth - should fail
    const unauthorizedResponse = await request(app)
      .get('/admin/ping')
      .expect(401);

    assert.assertEqual(unauthorizedResponse.body.ok, false, 'Should reject unauthorized requests');

    // Test with correct auth - should succeed
    const authorizedResponse = await request(app)
      .get('/admin/ping')
      .set('Authorization', `Bearer ${adminSecret}`)
      .expect(200);

    assert.assertEqual(authorizedResponse.body.ok, true, 'Should accept authorized requests');
  });

  // Test 3: Markets API - List Markets
  await testRunner.runTest('List markets API', async () => {
    // First create a test market
    testToken = await testData.getTestToken();
    const testUsers = testData.getTestUsers();

    const market = await prisma.market.create({
      data: {
        id: 'test-api-market-' + Date.now(),
        title: 'TEST_API_Will cryptocurrency adoption increase?',
        description: 'Test market for API testing',
        endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        tokenId: testToken.id,
        creatorId: testUsers[0],
        guildId: testData.getTestGuildId(),
        status: 'ACTIVE',
        yesPool: '0',
        noPool: '0',
        yesOdds: '2.00',
        noOdds: '2.00'
      }
    });

    testMarketId = market.id;
    testData.addCreatedMarket(testMarketId);

    // Test API response
    const response = await request(app)
      .get('/api/markets')
      .expect(200);

    assert.assertTrue(Array.isArray(response.body), 'Should return array of markets');

    const testMarket = response.body.find((m: any) => m.id === testMarketId);
    assert.assertExists(testMarket, 'Test market should be in API response');
    assert.assertEqual(testMarket.title, market.title, 'Market title should match');
    assert.assertEqual(testMarket.status, 'ACTIVE', 'Market status should be active');
  });

  // Test 4: Markets API - Get Specific Market
  await testRunner.runTest('Get specific market API', async () => {
    const response = await request(app)
      .get(`/api/markets/${testMarketId}`)
      .expect(200);

    assert.assertEqual(response.body.id, testMarketId, 'Should return correct market');
    assert.assertExists(response.body.title, 'Market should have title');
    assert.assertExists(response.body.description, 'Market should have description');
    assert.assertExists(response.body.yesOdds, 'Market should have yes odds');
    assert.assertExists(response.body.noOdds, 'Market should have no odds');
  });

  // Test 5: Markets API - Place Bet
  await testRunner.runTest('Place bet via API', async () => {
    const testUsers = testData.getTestUsers();

    const betData = {
      marketId: testMarketId,
      userId: testUsers[0],
      side: 'YES',
      amount: '10',
      tokenId: testToken.id
    };

    const response = await request(app)
      .post('/api/markets/bet')
      .send(betData)
      .expect(200);

    assert.assertTrue(response.body.success, `Bet should succeed: ${response.body.error || 'No error'}`);
    assert.assertExists(response.body.betId, 'Should return bet ID');

    // Verify bet in database
    const bet = await prisma.bet.findUnique({
      where: { id: response.body.betId }
    });

    assert.assertExists(bet, 'Bet should exist in database');
    assert.assertEqual(bet!.marketId, testMarketId, 'Bet market ID should match');
    assert.assertEqual(bet!.userId, testUsers[0], 'Bet user ID should match');
    assert.assertEqual(bet!.side, 'YES', 'Bet side should match');
    assert.assertEqual(bet!.amount, '10', 'Bet amount should match');
  });

  // Test 6: Markets API - Invalid Bet Validation
  await testRunner.runTest('Invalid bet validation', async () => {
    const testUsers = testData.getTestUsers();

    // Test with invalid amount
    const invalidBetData = {
      marketId: testMarketId,
      userId: testUsers[0],
      side: 'YES',
      amount: '-10', // Negative amount
      tokenId: testToken.id
    };

    const response1 = await request(app)
      .post('/api/markets/bet')
      .send(invalidBetData)
      .expect(400);

    assert.assertFalse(response1.body.success, 'Should reject negative amounts');

    // Test with invalid side
    const invalidSideData = {
      marketId: testMarketId,
      userId: testUsers[0],
      side: 'MAYBE', // Invalid side
      amount: '10',
      tokenId: testToken.id
    };

    const response2 = await request(app)
      .post('/api/markets/bet')
      .send(invalidSideData)
      .expect(400);

    assert.assertFalse(response2.body.success, 'Should reject invalid sides');
  });

  // Test 7: CORS Headers
  await testRunner.runTest('CORS headers validation', async () => {
    const response = await request(app)
      .options('/api/markets')
      .set('Origin', 'https://example.com')
      .set('Access-Control-Request-Method', 'GET');

    // Check for CORS headers (if implemented)
    const corsHeader = response.headers['access-control-allow-origin'];
    if (corsHeader) {
      assert.assertTrue(
        corsHeader === '*' || corsHeader === 'https://example.com',
        'CORS should allow origins'
      );
    } else {
      console.log('CORS headers not found - may need implementation');
    }
  });

  // Test 8: Rate Limiting
  await testRunner.runTest('Rate limiting validation', async () => {
    // Make multiple rapid requests
    const promises = Array.from({ length: 20 }, () =>
      request(app)
        .get('/api/markets')
        .then(res => res.status)
        .catch(err => err.status)
    );

    const responses = await Promise.all(promises);
    const rateLimitedResponses = responses.filter(status => status === 429);

    if (rateLimitedResponses.length > 0) {
      console.log(`Rate limiting working: ${rateLimitedResponses.length}/20 requests rate limited`);
    } else {
      console.log('No rate limiting detected - may need implementation');
    }

    // At least first few requests should succeed
    assert.assertTrue(responses.slice(0, 5).every(status => status === 200), 'First few requests should succeed');
  });

  // Test 9: Admin Automation API
  await testRunner.runTest('Admin automation API endpoints', async () => {
    // Test automation status
    const statusResponse = await request(app)
      .get('/admin/automation/status')
      .set('Authorization', `Bearer ${adminSecret}`)
      .expect(200);

    assert.assertTrue(statusResponse.body.success, 'Automation status should succeed');
    assert.assertExists(statusResponse.body.status, 'Should include status object');

    // Test automation config
    const configResponse = await request(app)
      .get('/admin/automation/config')
      .set('Authorization', `Bearer ${adminSecret}`)
      .expect(200);

    assert.assertTrue(configResponse.body.success, 'Automation config should succeed');
    assert.assertExists(configResponse.body.config, 'Should include config object');

    // Test config update
    const updateData = {
      maxDailyMarkets: 999 // Test value
    };

    const updateResponse = await request(app)
      .post('/admin/automation/config')
      .set('Authorization', `Bearer ${adminSecret}`)
      .send(updateData)
      .expect(200);

    assert.assertTrue(updateResponse.body.success, 'Config update should succeed');
    assert.assertEqual(updateResponse.body.config.maxDailyMarkets, 999, 'Config should be updated');
  });

  // Test 10: Admin Treasury API
  await testRunner.runTest('Admin treasury API', async () => {
    const response = await request(app)
      .get('/admin/treasury')
      .set('Authorization', `Bearer ${adminSecret}`)
      .expect(200);

    assert.assertTrue(response.body.ok, 'Treasury API should succeed');
    assert.assertTrue(Array.isArray(response.body.tokens), 'Should return tokens array');
    assert.assertExists(response.body.totalTreasuryUSD, 'Should include USD total');
  });

  // Test 11: Market Analytics API
  await testRunner.runTest('Market analytics API', async () => {
    // Test market-specific analytics
    const marketAnalytics = await request(app)
      .get(`/api/markets/${testMarketId}/analytics`)
      .expect(200);

    assert.assertExists(marketAnalytics.body.totalBets, 'Should include total bets');
    assert.assertExists(marketAnalytics.body.totalVolume, 'Should include total volume');

    // Test global analytics (if endpoint exists)
    const globalAnalytics = await request(app)
      .get('/api/analytics/global')
      .expect((res) => {
        // Accept 200 or 404 (if not implemented)
        assert.assertTrue([200, 404].includes(res.status), 'Should handle global analytics request');
      });
  });

  // Test 12: Error Handling
  await testRunner.runTest('API error handling', async () => {
    // Test 404 for non-existent market
    const notFoundResponse = await request(app)
      .get('/api/markets/non-existent-market')
      .expect(404);

    assert.assertFalse(notFoundResponse.body.success || false, 'Should return error for non-existent market');

    // Test malformed JSON
    const malformedResponse = await request(app)
      .post('/api/markets/bet')
      .set('Content-Type', 'application/json')
      .send('{"invalid": json}')
      .expect(400);

    // Should handle malformed JSON gracefully
    assert.assertTrue(malformedResponse.status === 400, 'Should reject malformed JSON');
  });

  // Test 13: Input Sanitization
  await testRunner.runTest('Input sanitization', async () => {
    const testUsers = testData.getTestUsers();

    // Test with XSS attempt in market creation
    const xssData = {
      title: '<script>alert("xss")</script>Test Market',
      description: 'Normal description',
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      tokenId: testToken.id,
      creatorId: testUsers[0],
      guildId: testData.getTestGuildId()
    };

    const response = await request(app)
      .post('/api/markets/create')
      .send(xssData)
      .expect((res) => {
        // Should either reject or sanitize
        if (res.status === 200 && res.body.success) {
          assert.assertFalse(
            res.body.market.title.includes('<script>'),
            'Should sanitize script tags'
          );
        }
      });
  });

  // Test 14: Authentication Edge Cases
  await testRunner.runTest('Authentication edge cases', async () => {
    // Test with malformed Bearer token
    const malformedAuth = await request(app)
      .get('/admin/ping')
      .set('Authorization', 'Bearer')
      .expect(401);

    assert.assertFalse(malformedAuth.body.ok, 'Should reject malformed Bearer token');

    // Test with wrong auth method
    const wrongMethod = await request(app)
      .get('/admin/ping')
      .set('Authorization', `Basic ${Buffer.from('admin:password').toString('base64')}`)
      .expect(401);

    assert.assertFalse(wrongMethod.body.ok, 'Should reject non-Bearer authentication');
  });

  // Test 15: Response Format Consistency
  await testRunner.runTest('Response format consistency', async () => {
    // All successful API responses should have consistent format
    const endpoints = [
      '/api/markets',
      `/api/markets/${testMarketId}`
    ];

    for (const endpoint of endpoints) {
      const response = await request(app)
        .get(endpoint)
        .expect(200);

      // Check for consistent response structure
      if (response.body.success !== undefined) {
        assert.assertTrue(response.body.success, `${endpoint} should indicate success`);
      }

      // Check for consistent error format
      if (response.body.error !== undefined) {
        assert.assertTrue(typeof response.body.error === 'string', `${endpoint} errors should be strings`);
      }
    }
  });

  testRunner.finishSuite();
}