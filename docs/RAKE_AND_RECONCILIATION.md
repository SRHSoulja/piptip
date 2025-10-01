# Rake and Reconciliation System Documentation

**Date:** 2025-09-30
**Status:** ✅ **PRODUCTION READY**

---

## Table of Contents

1. [Overview](#overview)
2. [Why Explicit Rake Logging Matters](#why-explicit-rake-logging-matters)
3. [Rake Collection Implementation](#rake-collection-implementation)
4. [Cross-System Reconciliation](#cross-system-reconciliation)
5. [Running Validation](#running-validation)
6. [Report Interpretation](#report-interpretation)
7. [Troubleshooting](#troubleshooting)

---

## Overview

PIPTip's unified transaction log system now includes **explicit rake logging** for all house fee collection from matches and prediction markets. This enables:

- **Complete Audit Trail:** Every rake collected is logged as a Transaction + BalanceDelta
- **Treasury Reconciliation:** Sum of all rake BalanceDeltas shows total house revenue
- **Balance Conservation:** System-wide validation ensures no balance drift
- **Compliance Ready:** Full transparency for regulatory reporting

---

## Why Explicit Rake Logging Matters

### Before: Implicit Rake Collection

```typescript
// Old approach: Rake deducted but not explicitly logged
const pot = 2n * wager;
const rake = (pot * houseFeeBps) / 10000n;
const payout = pot - rake; // Winner gets pot minus rake

// ❌ Problem: Rake is collected but invisible in transaction log
// ❌ Treasury balance cannot be reconciled from BalanceDeltas
// ❌ Difficult to audit total house revenue
```

### After: Explicit Rake Logging

```typescript
// New approach: Explicit BalanceDelta for rake
const pot = 2n * wager;
const rake = (pot * houseFeeBps) / 10000n;
const payout = pot - rake;

// ✅ Winner receives payout (logged)
await creditTokenTx(tx, winnerId, tokenId, payout, "MATCH_PAYOUT");

// ✅ Rake explicitly logged to treasury
await logCompleteTransaction(tx, {
  source: 'BOT',
  operation: 'TREASURY_RAKE',
  userId: null, // Treasury account
  idempotencyKey: `rake_match_${matchId}`,
  balanceChanges: [
    {
      tokenId,
      userId: undefined, // null = treasury
      amountDelta: rake, // Positive delta to treasury
      reason: 'match_rake_collected'
    }
  ]
});
```

### Benefits

1. **Complete Transparency:** Every PIPChip collected by the house is visible in the transaction log
2. **Reconciliation:** `SUM(BalanceDelta WHERE userId IS NULL) = Total Treasury Revenue`
3. **Compliance:** Auditors can verify all rake collection with single query
4. **Fraud Detection:** Discrepancies between expected and actual rake immediately visible
5. **Token Economics:** Track house revenue per token, per game type, per guild

---

## Rake Collection Implementation

### Match System (Rock-Paper-Scissors)

**File:** `src/interactions/buttons/matches.ts`

**Rake Calculation:**
```typescript
function rpsPayout(wagerAtomic: bigint, houseFeeBps: bigint) {
  const pot = 2n * wagerAtomic;

  // Calculate rake with ceiling division (round up, favor platform)
  let rake = (pot * houseFeeBps) / 10000n;
  const remainder = (pot * houseFeeBps) % 10000n;
  if (remainder > 0n) {
    rake = rake + 1n; // Round up to next atomic unit
  }

  // Force minimum rake if calculated is 0
  if (houseFeeBps > 0n && rake === 0n) {
    rake = 1n;
  }

  const payout = pot - rake;
  return { pot, rake, payout };
}
```

**Rake Logging:**
```typescript
// Lines 309-335
if (rakeBig > 0n) {
  await logCompleteTransaction(tx, {
    source: 'BOT',
    operation: 'TREASURY_RAKE',
    userId: null, // Treasury operation
    guildId: i.guildId ?? null,
    idempotencyKey: `rake_match_${m.id}`, // Prevents duplicate logging
    opRef: `match_${m.id}`,
    metadata: {
      matchId: m.id,
      rakeAmount: rakeBig.toString(),
      tokenSymbol: m.Token.symbol,
      description: 'Match house rake collection'
    },
    balanceChanges: [
      {
        tokenId: m.Token.id,
        userId: undefined, // Treasury (null userId)
        amountDelta: rakeBig, // Positive delta to treasury
        reason: 'match_rake_collected'
      }
    ]
  });
}
```

**Key Points:**
- Ties collect **zero rake** (full refunds)
- Rake collected only when match has winner
- Idempotency key: `rake_match_{matchId}`
- Treasury userId = null (system account)

### Prediction Market System

**File:** `src/services/prediction_markets.ts`

**Rake Calculation:**
```typescript
// For non-LMSR markets (parimutuel)
const totalPool = market.totalYesBets + market.totalNoBets;
const houseRake = totalPool * (market.rakePercentage / 100);
const prizePool = totalPool - houseRake;

// Winners split prize pool proportionally
// Rake stays with house
```

**Rake Logging:**
```typescript
// Lines 437-475
if (!market.lmsrShares) { // Only for parimutuel markets
  const rakeAmount = totalPool * (market.rakePercentage / 100);

  if (rakeAmount > 0) {
    await logCompleteTransaction(tx, {
      source: 'BOT',
      operation: 'TREASURY_RAKE',
      userId: systemUser?.id ?? null,
      guildId: market.guildId,
      idempotencyKey: `rake_market_${marketId}`,
      opRef: `market_${marketId}`,
      metadata: {
        marketId,
        rakeAmount: Math.floor(rakeAmount),
        rakePercentage: market.rakePercentage,
        totalPool,
        description: 'Prediction market house rake collection'
      },
      balanceChanges: [
        {
          tokenId: 2, // PIPCHIPS token ID
          userId: systemUser?.id, // Treasury
          amountDelta: BigInt(Math.floor(rakeAmount)),
          reason: 'market_rake_collected'
        }
      ]
    });
  }
}
```

**Key Points:**
- LMSR markets have **no explicit rake** (implicit in pricing)
- Parimutuel markets collect rake on resolution
- Idempotency key: `rake_market_{marketId}`
- Default rake: 3% (configurable per market)

---

## Cross-System Reconciliation

### Reconciliation Script

**File:** `scripts/validate_cross_system.ts`

**Run:** `npm run validate:cross` (mainnet) or `npm run validate:cross:testnet`

### Five Validation Checks

#### 1. Balance Conservation
**Purpose:** Verify sum of all BalanceDeltas equals actual balances (no drift)

**Algorithm:**
```typescript
For each token:
  totalUserBalances = SUM(UserBalance.amount WHERE tokenId)
  totalBalanceDeltas = SUM(BalanceDelta.amountDelta WHERE tokenId)
  drift = |totalUserBalances - totalBalanceDeltas|

  If drift > 0.01%:
    FAIL: Balance drift detected
```

**Pass Criteria:**
- Drift < 0.01% for all tokens
- Treasury rake deltas sum correctly

**Example Output:**
```
📊 Check 1: Balance Conservation
   PENGU:
      User Balances: 1000000.0
      BalanceDeltas: 999999.9
      Drift: 0.1 (0.0001%)
      Treasury Rake: 15234.5
   ✅ Balance conservation passed
```

#### 2. Operation Coverage
**Purpose:** Verify every Transaction has BalanceDeltas and vice versa

**Algorithm:**
```typescript
orphanedTransactions = COUNT(Transaction WHERE balanceDeltas IS EMPTY)
orphanedBalanceDeltas = COUNT(BalanceDelta WHERE transactionId IS NULL)

If orphanedTransactions > 0 OR orphanedBalanceDeltas > 0:
  FAIL: Missing coverage
```

**Pass Criteria:**
- Zero orphaned transactions
- Zero orphaned balance deltas
- Every financial operation has complete audit trail

**Example Output:**
```
🔍 Check 2: Operation Coverage
   Total Transactions: 45678
   Total BalanceDeltas: 91356
   Orphaned Transactions: 0
   Orphaned BalanceDeltas: 0
   ✅ Operation coverage passed
```

#### 3. Rake Validation
**Purpose:** Verify rake entries exist for all matches/markets that collected rake

**Algorithm:**
```typescript
For each settled match WHERE result != TIE AND rakeAtomic > 0:
  rakeTransaction = FIND(Transaction WHERE idempotencyKey = `rake_match_{matchId}`)
  If NOT rakeTransaction:
    FAIL: Missing rake entry

For each resolved market WHERE rakePercentage > 0:
  rakeTransaction = FIND(Transaction WHERE idempotencyKey = `rake_market_{marketId}`)
  If NOT rakeTransaction:
    FAIL: Missing rake entry
```

**Pass Criteria:**
- 100% of matches with rake have TREASURY_RAKE transaction
- 100% of markets with rake have TREASURY_RAKE transaction

**Example Output:**
```
💰 Check 3: Rake Validation
   Matches: 1234/1234 have rake logged
   Markets: 567/567 have rake logged
   Missing: 0 rake entries
   ✅ Rake validation passed
```

#### 4. On-Chain Verification
**Purpose:** Verify txHash links resolve on Abstract blockchain explorer

**Algorithm:**
```typescript
For each transaction WHERE txHash IS NOT NULL:
  receipt = provider.getTransactionReceipt(txHash)

  If receipt AND receipt.status === 1:
    verified++
  Else:
    failed++
```

**Pass Criteria:**
- All on-chain transactions verify successfully
- Zero failed verifications

**Example Output:**
```
⛓️  Check 4: On-Chain Verification
   Total On-Chain: 234
   Verified: 234
   Failed: 0
   Skipped: 0
   ✅ On-chain verification passed
```

#### 5. Merkle Consistency
**Purpose:** Verify balances match last published Merkle snapshot

**Algorithm:**
```typescript
lastSnapshot = FIND(MerkleSnapshot ORDER BY createdAt DESC LIMIT 1)

For each user/token in lastSnapshot.userBalances:
  deltas = SUM(BalanceDelta WHERE userId AND tokenId AND createdAt <= snapshot.createdAt)
  computedBalance = initialBalance + deltas
  drift = |computedBalance - snapshotBalance|

  If drift > 1000 wei:
    FAIL: Balance discrepancy
```

**Pass Criteria:**
- All user balances match snapshot within 1000 wei tolerance
- Zero discrepancies

**Example Output:**
```
🌳 Check 5: Merkle Consistency
   Last Snapshot: 0x4a5f...
   Block: 12345678
   Discrepancies: 0
   ✅ Merkle consistency passed
```

---

## Running Validation

### Quick Start

```bash
# Testnet validation (recommended for testing)
npm run validate:cross:testnet

# Mainnet validation (production)
npm run validate:cross

# Run rake-specific tests
npm run test:rake
```

### Full Validation Suite

```bash
# 1. Run integration tests
npm run test:match-integration
npm run test:prediction-flow
npm run test:game-simulation

# 2. Run cross-system validation
npm run validate:cross:testnet

# 3. Check specific components
npm run tx:validate              # Transaction log integrity
npm run tx:compare               # Merkle vs transaction log
```

### Expected Output

**Success (Exit Code 0):**
```
╔════════════════════════════════════════════════════════════╗
║   Cross-System Reconciliation Validator                   ║
╚════════════════════════════════════════════════════════════╝

Network: testnet
Starting validation at 2025-09-30T12:00:00.000Z

📊 Check 1: Balance Conservation
   PENGU: ✅ No drift
   PIPCHIPS: ✅ No drift
   ✅ Balance conservation passed

🔍 Check 2: Operation Coverage
   ✅ Operation coverage passed

💰 Check 3: Rake Validation
   ✅ Rake validation passed

⛓️  Check 4: On-Chain Verification
   ✅ On-chain verification passed

🌳 Check 5: Merkle Consistency
   ✅ Merkle consistency passed

╔════════════════════════════════════════════════════════════╗
║   Validation Summary                                       ║
╚════════════════════════════════════════════════════════════╝

Total Checks: 5
Passed: 5
Failed: 0
Warnings: 0

Overall: ✅ ALL CHECKS PASSED

📄 Report saved to: reports/validation-1234567890.json
```

**Failure (Exit Code 1):**
```
╔════════════════════════════════════════════════════════════╗
║   Validation Summary                                       ║
╚════════════════════════════════════════════════════════════╝

Total Checks: 5
Passed: 3
Failed: 2
Warnings: 1

Overall: ❌ VALIDATION FAILED

📄 Report saved to: reports/validation-1234567890.json
```

---

## Report Interpretation

### Report Structure

Reports are saved to `reports/validation-{timestamp}.json`:

```json
{
  "timestamp": "2025-09-30T12:00:00.000Z",
  "network": "testnet",
  "checks": {
    "balanceConservation": {
      "passed": true,
      "tokenBalances": [
        {
          "tokenId": 1,
          "symbol": "PENGU",
          "totalUserBalances": "1000000.0",
          "totalBalanceDeltas": "999999.9",
          "drift": "0.1",
          "driftPercentage": 0.0001
        }
      ],
      "treasuryBalances": [
        {
          "tokenId": 1,
          "symbol": "PENGU",
          "totalRakeCollected": "15234.5"
        }
      ],
      "errors": []
    },
    "operationCoverage": { /* ... */ },
    "rakeValidation": { /* ... */ },
    "onChainVerification": { /* ... */ },
    "merkleConsistency": { /* ... */ }
  },
  "summary": {
    "totalChecks": 5,
    "passedChecks": 5,
    "failedChecks": 0,
    "warningCount": 0
  },
  "success": true
}
```

### Key Metrics

**Balance Conservation:**
- `driftPercentage` < 0.01% = Excellent
- `driftPercentage` < 0.1% = Acceptable (rounding)
- `driftPercentage` > 0.1% = Investigate

**Operation Coverage:**
- `orphanedTransactions` = 0 = Perfect
- Any orphaned transactions = Missing BalanceDeltas

**Rake Validation:**
- `missingRakeEntries` = 0 = All rake logged
- Any missing = Run backfill script

**On-Chain Verification:**
- `failedVerifications` = 0 = All on-chain ops valid
- Any failures = Investigate blockchain state

**Merkle Consistency:**
- `balanceDiscrepancies` = 0 = Perfect sync
- Any discrepancies = Balance drift vs snapshot

---

## Troubleshooting

### Issue: Balance Drift Detected

**Symptom:**
```
❌ Token PENGU: Drift 100.5 (0.1%)
```

**Diagnosis:**
1. Check for missing BalanceDeltas:
   ```sql
   SELECT * FROM Transaction WHERE id NOT IN (SELECT DISTINCT transactionId FROM BalanceDelta WHERE transactionId IS NOT NULL);
   ```

2. Check for negative balance attempts:
   ```bash
   npm run validate:cross:testnet 2>&1 | grep "Negative balance"
   ```

**Fix:**
```bash
# Backfill missing BalanceDeltas
npm run tx:backfill

# Re-run validation
npm run validate:cross:testnet
```

### Issue: Missing Rake Entries

**Symptom:**
```
❌ Missing 15 match rake entries and 3 market rake entries
```

**Diagnosis:**
Matches/markets resolved before explicit rake logging was implemented.

**Fix:**
```typescript
// Run manual backfill script (create if needed)
// For each match/market without rake entry:
//   Calculate expected rake
//   Create TREASURY_RAKE transaction with historical data
```

### Issue: Orphaned Transactions

**Symptom:**
```
⚠️  45 transactions without BalanceDeltas
```

**Diagnosis:**
Legacy transactions created before unified log system.

**Fix:**
```bash
# Backfill BalanceDeltas for legacy transactions
npm run tx:backfill

# Verify fix
npm run validate:cross:testnet
```

### Issue: On-Chain Verification Fails

**Symptom:**
```
❌ Transaction 0x1234... failed (status: 0)
```

**Diagnosis:**
Transaction reverted on-chain but was recorded in database.

**Fix:**
1. Investigate why transaction reverted
2. Check if balance update should be rolled back
3. Consider adding pre-flight simulation for future ops

### Issue: Merkle Snapshot Mismatch

**Symptom:**
```
❌ User 123 token 1: Drift 500 (computed=1000, snapshot=500)
```

**Diagnosis:**
BalanceDeltas created after snapshot or snapshot computation error.

**Fix:**
```bash
# Republish Merkle snapshot with current balances
npm run cron:publish:testnet

# Re-run validation
npm run validate:cross:testnet
```

---

## Production Deployment Checklist

Before deploying to mainnet:

- [ ] Run `npm run test:rake` - All rake tests pass
- [ ] Run `npm run test:game-simulation` - No balance drift
- [ ] Run `npm run validate:cross:testnet` - All checks pass
- [ ] Review last 100 matches for rake logging
- [ ] Review last 100 markets for rake logging
- [ ] Verify treasury balance matches BalanceDelta sum
- [ ] Test rake idempotency (duplicate match IDs rejected)
- [ ] Confirm rake rounding favors platform (ceiling division)
- [ ] Verify zero rake on ties
- [ ] Document expected rake percentage per game type

---

## Maintenance

### Daily Monitoring

```bash
# Run validation automatically via cron
0 0 * * * cd /app && npm run validate:cross >> /logs/validation.log 2>&1

# Alert on failures
if [ $? -ne 0 ]; then
  send_alert "Cross-system validation failed"
fi
```

### Monthly Audit

1. Run full validation suite
2. Review all reports in `reports/` directory
3. Compare treasury balances to expected rake
4. Verify on-chain transactions
5. Publish Merkle snapshot
6. Archive old validation reports

---

**Status:** ✅ **SYSTEM READY FOR PRODUCTION**
**Last Updated:** 2025-09-30
**Maintainer:** PIPTip Development Team