# Prediction Markets Comprehensive Test Suite

This directory contains a comprehensive test suite designed to validate the entire prediction markets system before launch. The test suite ensures that all components work correctly, handle edge cases gracefully, and perform well under load.

## 🧪 Test Suite Overview

### Test Categories

1. **Automated Market Creation Tests** (`test_automation.ts`)
   - Configuration loading and validation
   - Hot configuration reloading
   - Scheduler management
   - Manual market creation
   - Daily limit enforcement
   - Duplicate prevention
   - Error handling and logging

2. **Full Betting Cycle Tests** (`test_full_cycle.ts`)
   - Market creation
   - Bet placement and validation
   - Odds calculation accuracy
   - Balance deductions
   - Market resolution
   - Payout calculations with rake
   - House rake collection
   - Market cancellation and refunds

3. **API Integration Tests** (`test_api_integration.ts`)
   - Authentication and authorization
   - CORS headers validation
   - Rate limiting
   - Admin endpoints
   - Market management APIs
   - Input sanitization
   - Error handling
   - Response format consistency

4. **Edge Case Tests** (`test_edge_cases.ts`)
   - One-sided betting scenarios
   - Insufficient balance handling
   - Race condition prevention
   - Zero/negative amount validation
   - Non-existent market handling
   - Database constraint violations
   - Extreme decimal precision
   - Memory and resource cleanup

5. **Load Tests** (`test_load.ts`)
   - Concurrent market creation
   - Massive simultaneous betting
   - Database lock contention
   - Memory usage stability
   - API response times
   - Connection pool stress
   - Market resolution performance
   - System recovery validation

## 🚀 Running Tests

### Quick Start - Full Test Suite

```bash
# Run the comprehensive test suite
npm run test:prediction-markets
```

This command:
- Sets up an isolated test environment
- Creates a temporary test database
- Runs all test categories in sequence
- Generates a comprehensive report
- Cleans up all test data
- Provides pass/fail status for launch readiness

### Individual Test Categories

Run specific test categories:

```bash
# Individual test suites
npm run test:automation        # Automated market creation
npm run test:cycle            # Full betting cycle
npm run test:edge-cases       # Edge case validation
npm run test:load             # Load testing

# Direct comprehensive run (without shell script)
npm run test:comprehensive
```

### Test Environment

Tests use an isolated environment:
- **Database**: Temporary SQLite database (`test_prediction_markets.db`)
- **Environment**: Test-specific configuration (`.env.test`)
- **Data**: Isolated test users, tokens, and markets
- **Cleanup**: Automatic cleanup after each run

## 📊 Test Report Format

The test suite generates detailed reports showing:

```
🧪 PREDICTION MARKETS TEST SUITE REPORT
==================================================

📦 Automated Market Creation (1234ms)
   Passed: 10 | Failed: 0

   ✅ Configuration loads correctly (45ms)
   ✅ Hot configuration reload works (123ms)
   ✅ Scheduler start/stop functionality (23ms)
   ... (additional tests)

📦 Full Betting Cycle (2345ms)
   Passed: 10 | Failed: 0

   ✅ Create test market (67ms)
   ✅ Place initial bets (89ms)
   ✅ Verify odds calculation (12ms)
   ... (additional tests)

==================================================
SUMMARY: 50 passed, 0 failed
🎉 ALL TESTS PASSED - System ready for launch!
```

## 🔧 Test Configuration

### Environment Setup

Create `.env.test` for test-specific configuration:

```env
# Test database
DATABASE_URL="file:./test_prediction_markets.db"

# Test credentials
ADMIN_SECRET="test-admin-secret-for-testing-only"
SESSION_SECRET="test-session-secret-for-testing-only"

# Test mode
NODE_ENV="test"
DISABLE_EXTERNAL_APIS="true"
```

### Test Data

The test suite creates:
- **5 Test Users**: With predetermined balances
- **Test Guild**: For Discord integration testing
- **Test Token**: For transaction testing
- **Test Markets**: Created and cleaned up per test

## ⚡ Performance Benchmarks

Expected performance thresholds:

- **Market Creation**: < 100ms per market
- **Bet Placement**: < 50ms per bet
- **Odds Calculation**: < 50ms per update
- **API Response**: < 100ms average
- **Memory Usage**: < 200MB during tests
- **Database Operations**: < 5s max connection time

## 🛡️ Security Validation

Tests validate:
- Input sanitization (XSS, SQL injection)
- Authentication bypass attempts
- Authorization boundary checks
- Balance validation accuracy
- Race condition prevention
- Resource cleanup completeness

## 🔄 Continuous Integration

For CI/CD integration:

```yaml
# Example GitHub Actions
- name: Run Prediction Markets Tests
  run: npm run test:prediction-markets

- name: Check Test Exit Code
  run: |
    if [ $? -eq 0 ]; then
      echo "✅ All tests passed - ready for deployment"
    else
      echo "❌ Tests failed - deployment blocked"
      exit 1
    fi
```

## 🚨 Launch Readiness Checklist

The test suite validates these critical systems:

### ✅ Core Functionality
- [x] Market creation and management
- [x] Betting mechanics and validation
- [x] Odds calculation accuracy
- [x] Payout system with rake
- [x] Balance tracking and updates

### ✅ API Integration
- [x] Authentication and authorization
- [x] Rate limiting and security
- [x] CORS configuration
- [x] Input validation
- [x] Error handling

### ✅ Edge Cases
- [x] Insufficient balance scenarios
- [x] Race condition handling
- [x] Invalid input rejection
- [x] System failure recovery
- [x] Resource cleanup

### ✅ Performance
- [x] Load handling capability
- [x] Database performance
- [x] Memory usage stability
- [x] Connection pool management
- [x] Response time consistency

### ✅ Security
- [x] Input sanitization
- [x] Authentication bypass prevention
- [x] Balance manipulation protection
- [x] SQL injection prevention
- [x] XSS attack mitigation

## 🔧 Troubleshooting

### Common Issues

1. **Database Connection Errors**
   ```bash
   # Ensure test database is accessible
   DATABASE_URL="file:./test_prediction_markets.db" npx prisma db push --force-reset
   ```

2. **Permission Errors**
   ```bash
   # Make test script executable
   chmod +x test/test.sh
   ```

3. **Memory Issues**
   ```bash
   # Increase Node.js memory limit
   NODE_OPTIONS="--max-old-space-size=4096" npm run test:prediction-markets
   ```

4. **Timeout Issues**
   ```bash
   # Run individual test suites
   npm run test:automation  # Start with faster tests
   ```

### Debug Mode

For detailed debugging:

```bash
# Enable debug logging
DEBUG=* npm run test:comprehensive

# Run with verbose output
npm run test:comprehensive -- --verbose
```

## 📈 Extending Tests

### Adding New Tests

1. Create test file: `test_new_feature.ts`
2. Follow the existing pattern:
   ```typescript
   import { testRunner, testData, assert } from './test_setup.js';

   export async function runNewFeatureTests(): Promise<void> {
     testRunner.startSuite('New Feature Tests');

     await testRunner.runTest('Test description', async () => {
       // Test implementation
       assert.assertTrue(condition, 'Error message');
     });

     testRunner.finishSuite();
   }
   ```
3. Add to `run_all_tests.ts`
4. Update documentation

### Custom Assertions

Available assertion methods:
- `assert.assertEqual(actual, expected, message?)`
- `assert.assertTrue(condition, message?)`
- `assert.assertExists(value, message?)`
- `assert.assertGreaterThan(actual, expected, message?)`
- `assert.assertThrows(fn, message?)`

## 🎯 Success Criteria

**System is ready for launch when:**
- All tests pass (0 failures)
- Performance meets benchmarks
- Security validations complete
- Edge cases handled gracefully
- Load testing demonstrates stability

**⚠️ Do not launch if:**
- Any tests fail
- Performance degrades significantly
- Security vulnerabilities detected
- Edge cases cause system failures
- Load testing reveals instability