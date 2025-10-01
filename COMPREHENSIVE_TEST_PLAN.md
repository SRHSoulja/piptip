# Comprehensive Test Plan - Full Bot Coverage

## Overview

This document provides a complete testing strategy for validating **every function** of the PIPTip bot end-to-end using the isolated test database.

## Test Database Requirements

**Status:** ✅ Configured (needs Docker running)

### Setup Commands

```bash
# 1. Start Docker Desktop/Engine
sudo systemctl start docker  # Linux
# OR open Docker Desktop     # Mac/Windows

# 2. Setup test database
npm run test:setup

# 3. Verify setup
docker ps | grep piptip-test
```

### Environment Validation

```bash
# Confirm test environment
cat .env.test | grep TEST_DATABASE_URL
# Expected: postgresql://...@localhost:5433/piptip_test

# Verify isolation
echo $DATABASE_URL
# Should NOT be production database
```

## Test Coverage Matrix

### ✅ 1. Database & Environment

**Requirement:** All tests run against isolated test DB (port 5433)

**Tests:**
- Configuration check in `.env.test`
- Safety validator: `src/services/test_db_safety.ts`
- Validation script: `scripts/validate_markets_migration.ts`

**Verification Commands:**
```bash
# Verify test database configuration
npm run validate:markets-migration

# Check database safety
dotenv -e .env.test -- npx tsx -e "
import { validateTestEnvironment } from './src/services/test_db_safety.js';
validateTestEnvironment();
"
```

**Expected Result:**
```
✅ Test database configuration validated
   Database: piptip_test
   Host: localhost
   Port: 5433
   Status: Isolated test environment
```

### 🎮 2. Matches (PIPChips)

**Requirement:** Test match creation, wagers, settlement, ties, rake, Merkle integration

**Existing Test:** `tests/match_integration.test.ts`

**Coverage:**
- ✅ Match creation with valid parameters
- ✅ Invalid match creation (insufficient balance, invalid amounts)
- ✅ Wager placement with PIPChips
- ✅ Transaction + BalanceDelta logging
- ✅ Winner settlement with payouts
- ✅ Rake calculation and logging
- ✅ Tie scenarios (refunds, no rake)
- ✅ Balance reconciliation
- ⚠️  Merkle snapshot integration (covered in `tests/merkle_publisher.test.ts`)

**Run Command:**
```bash
npm run test:match-integration
```

**Expected Validations:**
1. Match creates transaction logs
2. Wagers deduct PIPChips correctly
3. Winners receive payouts (minus rake)
4. Rake is logged and tracked
5. Ties refund all wagers
6. BalanceDelta matches UserBalance changes
7. Idempotency prevents duplicate transactions

**Additional Coverage Needed:**
```typescript
// tests/match_comprehensive.test.ts (NEW - to create)
describe('Match System - Complete Coverage', () => {
  test('Multiple concurrent matches');
  test('Match with spectators');
  test('Match timeout handling');
  test('Match cancellation before start');
  test('Rake accumulation over multiple matches');
  test('Balance reconciliation after 100 matches');
});
```

### 💸 3. Tips & Group Tips

**Requirement:** Single tips, group tips with contributions, idempotency, reconciliation

**Existing Tests:**
- `tests/transaction_log_integration.test.ts` (partial coverage)
- Group tip tests may be in main codebase

**Coverage:**
- ✅ Single tip transaction logging
- ⚠️  Group tip creation
- ⚠️  Multi-user contributions
- ⚠️  Group tip expiry
- ⚠️  Idempotency key validation
- ⚠️  BalanceDelta reconciliation

**Run Command:**
```bash
npm run test:transaction-integration
```

**Additional Coverage Needed:**
```typescript
// tests/tips_comprehensive.test.ts (NEW - to create)
describe('Tips & Group Tips - Complete Coverage', () => {
  test('Single tip end-to-end');
  test('Group tip creation and claiming');
  test('Multiple users claim same group tip');
  test('Group tip expiry and refund');
  test('Duplicate tip prevention (idempotency)');
  test('Tip with note/message');
  test('Balance reconciliation after 50 tips');
  test('Tax/fee calculation on tips');
});
```

### 📈 4. Prediction Markets (PIPChips)

**Requirement:** Creation, betting, resolution, refunds, rake logging

**Existing Tests:**
- `tests/prediction_market_integration.test.ts`
- `tests/prediction_market_flow.test.ts`
- `tests/prediction_markets_integration.test.ts` (newest)
- `tests/lmsr_market_maker.test.ts`

**Coverage:**
- ✅ Market creation via admin panel
- ✅ Bet placement with PIPChips
- ✅ LMSR odds calculation
- ✅ Market resolution (YES/NO/CANCEL)
- ✅ Winner payouts
- ✅ Market cancellation refunds
- ✅ Transaction logging
- ✅ Slash commands removed from Discord
- ✅ Help command redirects to website

**Run Commands:**
```bash
npm run test:prediction-integration
npm run test:prediction-flow
npm run test:markets-integration
```

**Expected Validations:**
1. Admin can create markets
2. Users can place bets
3. Odds update dynamically (LMSR)
4. Resolutions distribute payouts
5. Cancellations refund all bets
6. Rake is calculated and logged
7. Discord commands don't execute (redirect only)
8. Website API endpoints work

**Additional Coverage:**
```typescript
// tests/markets_comprehensive.test.ts (NEW - to create)
describe('Prediction Markets - Extended Coverage', () => {
  test('Market with 100+ participants');
  test('Market with large bet amounts');
  test('Market resolution with edge case odds');
  test('Simultaneous bets on same market');
  test('Market expiry handling');
  test('Admin override/force resolution');
  test('Market statistics and analytics');
});
```

### 🏆 5. Tournament Markets (TPIP)

**Requirement:** TPIP purchase, multi-token entry, tournament markets, TPIP reset

**Existing Tests:**
- `tests/tournament_tpip_integration.test.ts`
- `tests/tournament_entry_multi_token.test.ts`

**Coverage:**
- ✅ TPIP purchase with Abstract tokens
- ✅ USD valuation of payments
- ✅ Multi-token entry (single token)
- ✅ Multi-token entry (mixed tokens)
- ✅ TPIP allocation on entry
- ✅ Tournament market creation
- ✅ Bets with TPIP only
- ⚠️  Payouts in TPIP
- ⚠️  Refunds in TPIP
- ⚠️  TPIP reset at conclusion
- ✅ TPIP/PIPChips isolation
- ✅ Merkle tree integration

**Run Commands:**
```bash
npm run test:tournament-tpip
npm run test:tournament-entry
npm run validate:tpip
```

**Expected Validations:**
1. Users can enter tournaments with any token
2. USD value calculated correctly
3. TPIP allocated based on entry fee
4. Tournament markets only accept TPIP
5. TPIP balances isolated from PIPChips
6. TPIP appears in Merkle snapshots
7. TPIP resets to 0 at tournament end
8. No TPIP/PIPChips mixing

**Additional Coverage:**
```typescript
// tests/tournaments_comprehensive.test.ts (NEW - to create)
describe('Tournaments - Extended Coverage', () => {
  test('Tournament with 50+ participants');
  test('Multiple tournaments running concurrently');
  test('Tournament prize distribution');
  test('TPIP market resolution during tournament');
  test('Tournament leaderboard accuracy');
  test('TPIP reset enforcement');
  test('Tournament cancellation and refunds');
});
```

### 🏦 6. Treasury & Operations

**Requirement:** Rake logging, swaps, cold transfers, reconciliation

**Existing Tests:**
- Partial coverage in transaction log tests
- Treasury safety tests exist

**Coverage:**
- ⚠️  Rake accumulation from matches
- ⚠️  Rake accumulation from markets
- ⚠️  Treasury balance tracking
- ⚠️  Cold transfer logging
- ⚠️  Reconciliation accuracy

**Additional Coverage Needed:**
```typescript
// tests/treasury_comprehensive.test.ts (NEW - to create)
describe('Treasury & Operations', () => {
  test('Rake accumulation from 100 matches');
  test('Rake accumulation from prediction markets');
  test('Treasury balance reconciliation');
  test('Cold transfer to backup wallet');
  test('Treasury swap execution');
  test('Emergency treasury access');
  test('Audit trail completeness');
});
```

**Validation Commands:**
```bash
npm run audit:balance-functions
npm run validate:cross:testnet
```

### 🛠️ 7. Tier Purchases & Withdrawals

**Requirement:** Tier purchases, atomic withdrawals, transaction logging

**Existing Tests:**
- Withdrawal tests may exist
- Tier purchase tests needed

**Coverage:**
- ⚠️  Tier purchase flow
- ⚠️  Balance deduction
- ⚠️  Membership activation
- ⚠️  Withdrawal request
- ⚠️  Atomic withdrawal with txHash
- ⚠️  Balance reconciliation

**Additional Coverage Needed:**
```typescript
// tests/tiers_withdrawals_comprehensive.test.ts (NEW - to create)
describe('Tiers & Withdrawals', () => {
  test('Tier 1 purchase');
  test('Tier 2 upgrade');
  test('Tier expiry and renewal');
  test('Withdrawal request validation');
  test('Withdrawal processing');
  test('Failed withdrawal handling');
  test('Balance reconciliation after withdrawals');
});
```

### 📊 8. Reconciliation & Monitoring

**Requirement:** All validation scripts pass, no discrepancies, Merkle consistency

**Existing Tests:**
- `tests/transaction_log_integration.test.ts`
- `tests/merkle_publisher.test.ts`
- `scripts/validate_markets_migration.ts`
- `scripts/validate_tpip_reconciliation.ts`
- `scripts/stress_test_reconciliation.ts`

**Coverage:**
- ✅ Transaction log integrity
- ✅ BalanceDelta completeness
- ✅ UserBalance reconciliation
- ✅ Merkle tree generation
- ✅ PIPChips + TPIP in Merkle
- ✅ Markets migration validation
- ✅ TPIP system validation

**Run Commands:**
```bash
# Validation scripts
npm run validate:markets-migration
npm run validate:tpip
npm run tx:validate

# Reconciliation tests
npm run test:transaction-integration
npm run test:stress-short

# Balance function audit
npm run audit:balance-functions
```

**Expected Results:**
- Markets migration: 21/21 checks pass
- TPIP validation: All checks pass
- Transaction log: No gaps or inconsistencies
- Stress test: Stable under load
- Balance audit: No unlogged functions

## Test Execution Plan

### Phase 1: Environment Setup (5 minutes)

```bash
# 1. Start Docker
sudo systemctl start docker

# 2. Setup test database
npm run test:setup

# 3. Verify environment
npm run validate:markets-migration
```

### Phase 2: Core Functionality Tests (30 minutes)

```bash
# Matches
npm run test:match-integration

# Transactions
npm run test:transaction-integration

# Prediction Markets
npm run test:prediction-integration
npm run test:prediction-flow
npm run test:markets-integration

# Tournaments (TPIP)
npm run test:tournament-tpip
npm run test:tournament-entry
```

### Phase 3: Validation & Reconciliation (15 minutes)

```bash
# Validation scripts
npm run validate:markets-migration
npm run validate:tpip

# Stress testing
npm run test:stress-short

# Balance audit
npm run audit:balance-functions
```

### Phase 4: Merkle & Network Tests (10 minutes)

```bash
# Merkle tree tests
npm run test:merkle-publisher

# Network tests
npm run test:network

# Multi-token acceptance
npm run test:multi-token
```

### Phase 5: Results Compilation (10 minutes)

- Collect all test outputs
- Identify failures
- Document gaps
- Create summary report

## Expected Test Results Format

For each test suite, document:

```
Test Suite: [Name]
Status: PASS/FAIL
Duration: [seconds]
Tests Run: X
Tests Passed: X
Tests Failed: X
Failures: [list if any]
Coverage: [what was tested]
Gaps: [what needs more coverage]
```

## Known Limitations

### Current Environment

**Docker Not Available:**
- Test database on localhost:5433 requires Docker
- Alternative: Use cloud test database
- Workaround: Mock database connections for unit tests

**Test Database Schema:**
- Requires migrations to be applied
- May have schema drift from production
- Solution: Run `npm run test:migrate` before tests

### Missing Test Coverage

**High Priority:**
1. Group tips comprehensive testing
2. Treasury operations end-to-end
3. Tier purchases and membership
4. Withdrawal processing
5. Concurrent operations stress testing

**Medium Priority:**
1. Discord command validation (ensure redirects work)
2. Website API endpoint coverage
3. Admin panel integration tests
4. Error handling and edge cases

**Low Priority:**
1. Performance benchmarking
2. Load testing with 1000+ users
3. Network failure scenarios
4. Database failover testing

## Gap Analysis

### Tests That Exist ✅

1. ✅ Match integration (basic)
2. ✅ Transaction logging
3. ✅ Prediction markets (comprehensive)
4. ✅ TPIP tournaments (good coverage)
5. ✅ Merkle tree generation
6. ✅ Network configuration
7. ✅ Multi-token support

### Tests Needed ⚠️

1. ⚠️  Group tips end-to-end
2. ⚠️  Treasury operations
3. ⚠️  Tier purchases
4. ⚠️  Withdrawals
5. ⚠️  Concurrent operations
6. ⚠️  Discord slash commands (validation only)
7. ⚠️  Website API integration

### Tests to Enhance 🔧

1. 🔧 Match tests (add concurrent matches, timeouts)
2. 🔧 Prediction markets (add stress testing)
3. 🔧 TPIP (add prize distribution)
4. 🔧 Reconciliation (add edge cases)

## Action Items

### Immediate (Before Running Tests)

1. [ ] Start Docker Desktop/Engine
2. [ ] Run `npm run test:setup`
3. [ ] Verify test database is running
4. [ ] Check `.env.test` configuration
5. [ ] Run `npm install` if needed

### Test Execution

1. [ ] Run Phase 1: Environment Setup
2. [ ] Run Phase 2: Core Functionality Tests
3. [ ] Run Phase 3: Validation & Reconciliation
4. [ ] Run Phase 4: Merkle & Network Tests
5. [ ] Run Phase 5: Compile Results

### Post-Testing

1. [ ] Document all failures
2. [ ] Create tickets for gaps
3. [ ] Prioritize missing tests
4. [ ] Update documentation
5. [ ] Plan Phase 2 testing

## Success Criteria

**All Systems Go:** ✅

- [x] Test database isolated from production
- [ ] All existing tests pass
- [ ] No transaction log gaps
- [ ] Balance reconciliation accurate
- [ ] Merkle tree consistency verified
- [ ] Markets migration validated (21/21)
- [ ] TPIP validation passed
- [ ] Stress test stable
- [ ] Balance audit clean

**Partial Success:** ⚠️

- [x] Test database configured
- [ ] Most tests pass (>80%)
- [ ] Known failures documented
- [ ] Gaps identified
- [ ] Remediation plan created

**Blocked:** ❌

- Docker not available
- Test database inaccessible
- Critical tests failing (>20%)
- Production database at risk

## Next Steps

After completing this test plan:

1. **Create Missing Tests** - Fill gaps identified above
2. **Enhance Existing Tests** - Add edge cases and stress testing
3. **Automate Testing** - CI/CD integration complete
4. **Monitor Production** - Apply learnings to production monitoring
5. **Continuous Improvement** - Regular test reviews and updates

## Summary

**Test Files:** 11 existing
**Test Scripts:** 15+ npm commands
**Coverage Areas:** 8 major categories
**Estimated Time:** 70 minutes full suite
**Prerequisites:** Docker + test database
**Expected Outcome:** Comprehensive validation of all bot functions

**Status:** ✅ Plan Complete - Ready for Execution
