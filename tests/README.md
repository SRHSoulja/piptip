# 🧪 Prediction Markets Testing Suite

This directory contains comprehensive tests for the PIPTip prediction markets system to ensure everything works correctly before real money flows.

## 🚀 Quick Start

```bash
# Run the core prediction markets logic tests
npx tsx scripts/test_markets.ts

# Run API integration tests (requires server running)
npm run dev  # In one terminal
npx tsx tests/api_integration_test.ts  # In another terminal
```

## 📋 Test Coverage

### 🎯 Core Logic Tests (`prediction_markets_test.ts`)

**Complete Flow Validation:**
1. ✅ **Market Creation** - Verify markets are created with correct parameters
2. ✅ **Betting Flow** - Test bet placement, validation, and state updates
3. ✅ **Odds Calculation** - Validate parimutuel math is correct
4. ✅ **Market Resolution** - Test payouts and rake collection
5. ✅ **Rake Calculation** - Verify house edge is calculated correctly

**Edge Cases Covered:**
- ✅ **One-sided markets** (should cancel and refund all bets)
- ✅ **Equal betting pools** (odds should be ~1.94x with 3% rake)
- ✅ **Minimum bet validation** (reject bets below threshold)
- ✅ **Insufficient balance** (reject bets exceeding user balance)
- ✅ **Market cancellation** (full refunds to all bettors)

### 🌐 API Integration Tests (`api_integration_test.ts`)

**Web Endpoint Validation:**
- ✅ **Public endpoints** (`/api/markets`, `/api/stats`)
- ✅ **Market details** (`/api/market/:id`)
- ✅ **Betting endpoints** (`/api/bet` - auth required)
- ✅ **User endpoints** (`/api/user/bets`, `/api/user/balance` - auth required)
- ✅ **Admin endpoints** (`/admin/prediction_markets/*` - admin auth required)

## 📊 Test Scenarios Explained

### Scenario 1: Basic Payout Calculation
```
Market: "Will BTC reach $100k?"
Bets: Alice 2000 YES, Bob 1000 YES, Charlie 3000 NO
Total Pool: 6000
House Rake (3%): 180
Prize Pool: 5820

If outcome = YES:
- Alice wins: (2000/3000) * 5820 = 3880 (profit: 1880)
- Bob wins: (1000/3000) * 5820 = 1940 (profit: 940)
- Charlie loses: 0 (loss: -3000)
```

### Scenario 2: Equal Pools
```
Market: Equal betting on both sides
Bets: 1000 YES, 1000 NO
Expected odds with 3% rake: ~1.94x both sides
```

### Scenario 3: One-sided Market
```
Market: Only YES bets placed
Result: Market cancelled, all bets refunded in full
No house rake collected (fair cancellation)
```

## 🎲 Test Data

**Test Users:**
- Alice (`test_user_1`) - Primary bettor
- Bob (`test_user_2`) - Secondary bettor
- Charlie (`test_user_3`) - Opposing bettor
- David (`test_user_4`) - Balance test user

**Test Markets:**
- Various market types (PRICE_UP_DOWN, PRICE_ABOVE_BELOW)
- Different rake percentages (3%, 5%)
- Different betting limits and timeframes

## 🔍 What Each Test Validates

### ✅ Math Accuracy
- Parimutuel odds calculation
- Proportional payout distribution
- Rake percentage deduction
- Balance updates after bets/payouts

### ✅ Business Logic
- Market lifecycle (created → active → resolved)
- Betting validation (amounts, balances, limits)
- Resolution logic (winner determination)
- Refund logic (cancellations, one-sided markets)

### ✅ Data Integrity
- User balances remain consistent
- No double-spending or balance errors
- Atomic transactions (bet placement, resolution)
- Proper cleanup and state management

### ✅ Edge Case Handling
- Insufficient funds rejection
- Invalid bet amounts
- Expired markets
- Database constraints

## 🚨 Critical Validations

**Before Production Deployment:**

1. **✅ House Never Loses Money**
   - Rake is always collected correctly
   - Payouts never exceed prize pool
   - One-sided markets are cancelled (no risk)

2. **✅ User Funds Protected**
   - Can't bet more than balance
   - All bets are properly recorded
   - Refunds work correctly

3. **✅ Math is Perfect**
   - Odds calculation matches expected formulas
   - Payouts sum to correct total
   - Rake percentage is exact

4. **✅ System Integrity**
   - Database transactions are atomic
   - No race conditions in concurrent betting
   - Proper error handling throughout

## 🔧 Running Individual Tests

```bash
# Test just the odds calculation
npx tsx -e "
import { PredictionMarketsTestSuite } from './tests/prediction_markets_test.js';
const suite = new PredictionMarketsTestSuite();
await suite.testOddsCalculation();
"

# Test just the API endpoints
npx tsx tests/api_integration_test.ts

# Test with custom parameters
npx tsx -e "
import { predictionMarkets } from './src/services/prediction_markets.js';
// Custom test code here...
"
```

## 📈 Performance Benchmarks

The tests also measure:
- ⏱️ **API response times** (should be <100ms for most endpoints)
- 🔄 **Concurrent betting** (multiple users betting simultaneously)
- 📊 **Database performance** (query optimization validation)
- 🎯 **Market resolution speed** (bulk resolution of expired markets)

## 🎉 Success Criteria

**All tests must pass before production:**
- ✅ 100% test coverage for core betting logic
- ✅ All edge cases handled gracefully
- ✅ API endpoints respond correctly
- ✅ Math calculations are exact
- ✅ No fund leakage or double-spending possible

**Expected Output:**
```
🧪 Starting Prediction Markets Integration Tests
===============================================

📋 Setting up test environment...
✅ Test environment ready with 4 users

🔬 Test: Basic Market Flow
  ✅ Passed

🔬 Test: Odds Calculation
  ✅ Passed

🔬 Test: Market Resolution & Payouts
  ✅ Passed

🔬 Test: Rake Calculation
  ✅ Passed

🔬 Test: Edge Cases
  ✅ All edge cases passed

🔬 Test: Insufficient Balance
  ✅ Passed

🔬 Test: Market Cancellation
  ✅ Passed

📊 TEST RESULTS SUMMARY
======================
Total Tests: 7
Passed: 7 (100.0%)
Failed: 0

🎉 ALL TESTS PASSED! The prediction markets system is working correctly!
```

## 🚀 Ready for Production

Once all tests pass, your prediction markets system is validated and ready for real money flow. The comprehensive test suite ensures:

- **Financial accuracy** - Every calculation is perfect
- **User protection** - Funds are safe and secure
- **Business logic** - Market mechanics work as intended
- **System reliability** - Edge cases are handled gracefully

**Deploy with confidence!** 🎯