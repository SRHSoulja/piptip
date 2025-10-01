# Deposits Worker Status Report

**Date:** 2025-09-30
**Status:** ✅ **GOOD NEWS - Deposits ARE properly logged!**

---

## Executive Summary

**The old deposit workers (`src/workers/deposits.ts`, `src/workers/deposits_transfers.ts`) are DEAD CODE and can be safely removed.**

The current system uses:
1. `src/services/deposits.ts` - Core deposit logic (✅ properly logs transactions)
2. `src/workers/multi_token_deposits.ts` - Multi-token deposit watcher (calls `applyDeposit`)

**Deposits ARE creating proper Transaction + BalanceDelta records via `creditToken()` → `logTxAtomicTx()` → `logCompleteTransaction()`.**

---

## File Status

### ✅ ACTIVE: `src/services/deposits.ts`

**Status:** Currently in use, properly implemented

**Used By:**
- `src/workers/multi_token_deposits.ts` (line 8): `import { applyDeposit } from "../services/deposits.js"`
- `tests/multi_token_acceptance.test.ts` (line 6): `import { applyDeposit } from '../src/services/deposits.js'`

**Implementation:** ✅ CORRECT
```typescript
// Line 55: Properly uses creditToken which creates Transaction + BalanceDelta
await creditToken(user.discordId, tokenRow.id, amt, "DEPOSIT", { txHash: input.tx });
```

**Flow:**
```
applyDeposit()
  → creditToken()
    → logTxAtomicTx()
      → logCompleteTransaction()
        → Creates Transaction + BalanceDelta ✅
```

### ✅ ACTIVE: `src/workers/multi_token_deposits.ts`

**Status:** Current multi-token deposit watcher (replacement for old workers)

**Purpose:**
- Monitors ALL active tokens for deposits to treasury
- Uses Alchemy's Transfer API
- Calls `applyDeposit()` from `deposits.ts`

**Implementation:** Correct - delegates to `applyDeposit()` which handles logging

**Deployment Status:** Unknown (needs verification)
- Not referenced in `ecosystem.config.js`
- Not in `package.json` scripts
- May be running as separate process or not running at all

### ❌ DEAD CODE: `src/workers/deposits.ts`

**Status:** Legacy single-token worker - DEAD CODE

**References:**
- ❌ Not imported anywhere in active code
- ❌ Not in ecosystem.config.js
- ❌ Not in package.json scripts
- ✅ Only mentioned in documentation (`docs/TOKEN_ADDRESS_MIGRATION.md`)

**Implementation:** ❌ BAD (but doesn't matter since it's not used)
```typescript
// Lines 59-76: Directly updates userBalance WITHOUT using creditToken
await prisma.userBalance.upsert({
  where: { userId_tokenId: { userId: user.id, tokenId: token.id } },
  update: { amount: { increment: bigToDecDirect(value, token.decimals) } },
  create: { userId: user.id, tokenId: token.id, amount: bigToDecDirect(value, token.decimals) }
});

// Creates Transaction without BalanceDelta
await prisma.transaction.create({
  data: {
    type: "DEPOSIT",
    userId: user.id,
    tokenId: token.id,
    amount: bigToDecDirect(value, token.decimals),
    fee: "0",
    txHash: txHash,
    metadata: `deposit from ${from}`
  }
});
```

**Safe to Delete:** ✅ YES

### ❌ DEAD CODE: `src/workers/deposits_transfers.ts`

**Status:** Legacy single-token worker using Alchemy Transfers API - DEAD CODE

**References:**
- ❌ Not imported anywhere in active code
- ❌ Not in ecosystem.config.js
- ❌ Not in package.json scripts
- ✅ Only mentioned in documentation (`docs/TOKEN_ADDRESS_MIGRATION.md`)

**Implementation:** ❌ BAD (but doesn't matter since it's not used)
```typescript
// Lines 85-100: Same issue as deposits.ts - bypasses creditToken
await prisma.userBalance.upsert({
  where: { userId_tokenId: { userId: user.id, tokenId: token.id } },
  update: { amount: { increment: bigToDecDirect(valueAtomic, token.decimals) } },
  create: { userId: user.id, tokenId: token.id, amount: bigToDecDirect(valueAtomic, token.decimals) }
});

await prisma.transaction.create({
  data: {
    type: "DEPOSIT",
    userId: user.id,
    tokenId: token.id,
    amount: bigToDecDirect(valueAtomic, token.decimals),
    fee: "0",
    txHash: txHash,
    metadata: `deposit from ${fromAddr}`
  }
});
```

**Safe to Delete:** ✅ YES

---

## Current Architecture

### Deposit Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Blockchain Event (Transfer to Treasury)                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Multi-Token Deposit Watcher                             │
│    src/workers/multi_token_deposits.ts                      │
│    - Monitors all active tokens                             │
│    - Uses Alchemy Transfer API                              │
│    - Maintains cursor for block tracking                    │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Core Deposit Logic                                       │
│    src/services/deposits.ts :: applyDeposit()               │
│    - Validates treasury address                             │
│    - Checks token active status                             │
│    - Enforces minimum deposit                               │
│    - Idempotency check (ProcessedDeposit)                   │
│    - Validates wallet linkage                               │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Balance Credit                                           │
│    src/services/balances.ts :: creditToken()                │
│    - Updates UserBalance                                    │
│    - Calls logTxAtomicTx()                                  │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Transaction Logging                                      │
│    src/services/tx_logger.ts :: logCompleteTransaction()    │
│    - Creates Transaction record ✅                          │
│    - Creates BalanceDelta record ✅                         │
│    - Single source of truth ✅                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Corrected Audit Findings

### Original Assessment: ❌ Deposits bypass transaction log
**Status:** ✅ **INCORRECT - Deposits ARE properly logged**

**Explanation:**
- The audit incorrectly analyzed the OLD workers (`deposits.ts`, `deposits_transfers.ts`)
- These files are DEAD CODE and not actually running
- The CURRENT implementation (`deposits.ts` service + `multi_token_deposits.ts` worker) correctly uses `creditToken()` which creates Transaction + BalanceDelta

### Updated Assessment: ✅ Deposits use transaction log correctly

**Evidence:**
```typescript
// src/services/deposits.ts:55
await creditToken(user.discordId, tokenRow.id, amt, "DEPOSIT", { txHash: input.tx });

// This calls:
// balances.ts → creditToken()
//   → logTxAtomicTx()
//     → tx_logger.ts → logCompleteTransaction()
//       → Creates Transaction ✅
//       → Creates BalanceDelta ✅
```

---

## Deployment Status - VERIFICATION NEEDED

### Unknown: Is `multi_token_deposits.ts` running?

**Evidence of NOT running:**
- ❌ Not in `ecosystem.config.js`
- ❌ Not in `package.json` scripts
- ❌ No systemd service files found
- ❌ No Railway/Vercel deployment config found

**This means:**
- Either deposits are processed another way (webhook? cron?)
- Or the worker is manually started and not in version control
- **OR deposits are currently not working at all**

### ⚠️ CRITICAL: Verify deposit processing

**Action Required:**
1. Check if deposits are currently working in production
2. If YES: Find how they're being processed (webhook? manual worker?)
3. If NO: Deploy `multi_token_deposits.ts` immediately

**Deployment Options:**

**Option A: PM2 Process**
```bash
pm2 start src/workers/multi_token_deposits.ts --name "deposit-watcher" --interpreter npx --interpreter-args tsx
```

**Option B: Add to ecosystem.config.js**
```javascript
module.exports = {
  apps: [
    {
      name: 'piptip-bot',
      script: 'src/index.ts',
      // ... existing config
    },
    {
      name: 'deposit-watcher',
      script: 'src/workers/multi_token_deposits.ts',
      interpreter: 'npx',
      interpreter_args: 'tsx',
      cwd: process.cwd(),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};
```

**Option C: Systemd Service**
```ini
[Unit]
Description=PIPTip Multi-Token Deposit Watcher
After=network.target postgresql.service

[Service]
Type=simple
User=piptip
WorkingDirectory=/path/to/piptip
ExecStart=/usr/bin/npx tsx src/workers/multi_token_deposits.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

---

## Recommendations

### 1. Delete Dead Code ✅ Safe to Remove

Remove these files:
```bash
rm src/workers/deposits.ts
rm src/workers/deposits_transfers.ts
```

Update documentation:
- Remove references in `docs/TOKEN_ADDRESS_MIGRATION.md`
- Update `docs/TRANSACTION_LOG_AUDIT.md` to correct the deposit assessment

### 2. Verify Production Deposit Processing ⚠️ URGENT

**Check if deposits are currently working:**
```sql
-- Check recent deposits
SELECT * FROM "Transaction"
WHERE type = 'DEPOSIT'
ORDER BY "createdAt" DESC
LIMIT 10;

-- Check deposit cursor status
SELECT * FROM "DepositCursor"
WHERE name = 'multi_token_treasury';
```

**If no recent deposits:**
- Deploy `multi_token_deposits.ts` immediately
- Consider alternative: webhook-based deposits

### 3. Add Deployment Config

Add `multi_token_deposits.ts` to deployment configuration:
- Update `ecosystem.config.js` (if using PM2)
- Add npm script: `"worker:deposits": "npx tsx src/workers/multi_token_deposits.ts"`
- Document deployment process

### 4. Update Transaction Log Audit

The audit report (`TRANSACTION_LOG_AUDIT.md`) incorrectly flags deposits as a gap. Update it to:
- ✅ Remove "Deposits" from gap list
- ✅ Add "Deposits" to covered operations list
- ✅ Update impact analysis
- ✅ Reduce critical gap count from 5 to 4

---

## Summary

**Good News:**
- ✅ Deposits ARE properly logged via `creditToken()`
- ✅ `src/services/deposits.ts` is correctly implemented
- ✅ Old workers are dead code and can be safely deleted

**Action Items:**
1. ✅ **LOW PRIORITY:** Delete `deposits.ts` and `deposits_transfers.ts` workers
2. ⚠️ **HIGH PRIORITY:** Verify `multi_token_deposits.ts` is running in production
3. ⚠️ **MEDIUM PRIORITY:** Add worker to deployment configuration
4. ✅ **LOW PRIORITY:** Update transaction log audit report

**Updated Gap Count:** 4 critical gaps (not 5)
- ❌ Tier Purchases
- ❌ Group Tip Contributions
- ❌ Tournament Entry Fees
- ❌ Treasury Operations