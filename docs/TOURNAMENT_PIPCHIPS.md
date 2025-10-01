# Tournament PIPChips (TPIP) System

## Overview

Tournament PIPChips (TPIP) is a **temporary currency** that exists only during tournament play. It provides isolated tournament economies while maintaining complete transaction logging for reconciliation.

### Key Characteristics

- **Symbol:** TPIP
- **Decimals:** 0 (whole numbers only)
- **Token ID:** 4
- **Lifecycle:** Created on entry, used in-tournament, converted on payout, reset to zero
- **Purpose:** Isolate tournament balances from regular PIPChips economy

## Lifecycle Flow

### 1. Tournament Entry

When a player enters a tournament:

```typescript
// Debit entry fee from regular PIPChips
logCompleteTransaction(tx, {
  operation: 'TOURNAMENT_ENTRY_FEE',
  userId,
  guildId,
  idempotencyKey: `tournament_entry_fee_${tournamentId}_${userId}`,
  balanceChanges: [{
    tokenId: 2, // PIPCHIPS
    userId,
    amountDelta: -entryFeeAmount,
    reason: 'tournament_entry_fee'
  }]
});

// Credit starting TPIP balance
logCompleteTransaction(tx, {
  operation: 'TOURNAMENT_TPIP_CREDIT',
  userId,
  guildId,
  idempotencyKey: `tournament_tpip_credit_${tournamentId}_${userId}`,
  balanceChanges: [{
    tokenId: 4, // TPIP
    userId,
    amountDelta: startingTPIP,
    reason: 'tournament_entry_tpip'
  }]
});
```

**Result:**
- User's PIPCHIPS balance decreases by entry fee
- User's TPIP balance increases by starting amount
- Both logged with separate Transaction + BalanceDelta entries

### 2. In-Tournament Play

All wagers, pots, and transfers use TPIP only:

```typescript
// TPIP wager (prediction market bet)
logCompleteTransaction(tx, {
  operation: 'TOURNAMENT_WAGER',
  userId,
  guildId,
  idempotencyKey: `tournament_wager_${marketId}_${userId}`,
  balanceChanges: [{
    tokenId: 4, // TPIP
    userId,
    amountDelta: -wagerAmount,
    reason: 'tournament_wager'
  }]
});

// TPIP payout (win)
logCompleteTransaction(tx, {
  operation: 'TOURNAMENT_WIN',
  userId,
  guildId,
  idempotencyKey: `tournament_win_${marketId}_${userId}`,
  balanceChanges: [{
    tokenId: 4, // TPIP
    userId,
    amountDelta: +winAmount,
    reason: 'tournament_win'
  }]
});
```

**Key Points:**
- Tournament participants cannot use regular PIPChips during play
- All operations create proper Transaction + BalanceDelta for TPIP
- TPIP balances tracked independently per tournament

### 3. Tournament Payouts

At tournament conclusion, winners' TPIP is converted back to PIPChips:

```typescript
// For each winner:

// 1. Debit their final TPIP balance
logCompleteTransaction(tx, {
  operation: 'TOURNAMENT_TPIP_DEBIT',
  userId: winnerId,
  guildId,
  idempotencyKey: `tournament_tpip_debit_${tournamentId}_${winnerId}`,
  balanceChanges: [{
    tokenId: 4, // TPIP
    userId: winnerId,
    amountDelta: -finalTPIPBalance,
    reason: 'tournament_conclusion_tpip_debit'
  }]
});

// 2. Credit equivalent PIPChips (or more for winners)
logCompleteTransaction(tx, {
  operation: 'TOURNAMENT_PAYOUT',
  userId: winnerId,
  guildId,
  idempotencyKey: `tournament_payout_${tournamentId}_${winnerId}`,
  balanceChanges: [{
    tokenId: 2, // PIPCHIPS
    userId: winnerId,
    amountDelta: +payoutAmount,
    reason: 'tournament_payout'
  }]
});
```

**Conversion Logic:**
- 1st place: TPIP → PIPChips (1:1 or better based on prize pool)
- 2nd place: TPIP → PIPChips (partial conversion)
- 3rd place: TPIP → PIPChips (partial conversion)
- All others: TPIP → 0 (no conversion, entry fee lost)

### 4. Tournament Reset

After payouts, **all** remaining TPIP balances must be reset to zero:

```typescript
// For each remaining participant (non-winners)
logCompleteTransaction(tx, {
  operation: 'TOURNAMENT_TPIP_RESET',
  userId: participantId,
  guildId,
  idempotencyKey: `tournament_reset_${tournamentId}_${participantId}`,
  balanceChanges: [{
    tokenId: 4, // TPIP
    userId: participantId,
    amountDelta: -remainingTPIPBalance, // Debit to zero
    reason: 'tournament_conclusion_reset'
  }]
});
```

**Critical:**
- This ensures Merkle reconciliation shows TPIP = 0 for all users post-tournament
- Prevents "orphaned" TPIP balances
- Maintains clean state for next tournament

## Merkle Tree Integration

### During Tournament

```typescript
// Merkle snapshot includes TPIP balances
const balances = await prisma.userBalance.groupBy({
  by: ['userId'],
  _sum: { amount: true },
  where: {
    tokenId: { in: [1, 2, 3, 4] } // Includes TPIP (token 4)
  }
});
```

**Expected State:**
- Active tournament participants have nonzero TPIP
- Non-participants have zero TPIP
- Both states are valid mid-tournament

### After Tournament Conclusion

```typescript
// Validate all TPIP balances are zero
const lingering = await prisma.userBalance.findMany({
  where: {
    tokenId: 4, // TPIP
    amount: { not: "0" }
  }
});

if (lingering.length > 0) {
  console.error(`❌ CRITICAL: ${lingering.length} users have orphaned TPIP balances!`);
  // This indicates a bug in tournament conclusion logic
}
```

**Post-Tournament Validation:**
- All TPIP balances MUST be zero
- Any nonzero TPIP indicates incomplete tournament cleanup
- Reconciliation script should flag this as an error

## Reconciliation Rules

### Valid States

1. **No Active Tournaments:**
   - All users: TPIP balance = 0
   - ΣBalanceDeltas for TPIP = 0

2. **Active Tournament:**
   - Tournament participants: TPIP balance > 0 (possible)
   - Non-participants: TPIP balance = 0
   - ΣBalanceDeltas for TPIP = Σ(active TPIP balances)

3. **Tournament Concluded:**
   - All users: TPIP balance = 0
   - ΣBalanceDeltas for TPIP = 0

### Validation Script Extension

```typescript
// Check for orphaned TPIP balances
const orphanedTPIP = await prisma.userBalance.findMany({
  where: {
    tokenId: 4, // TPIP
    amount: { not: "0" }
  },
  include: { user: true }
});

if (orphanedTPIP.length > 0) {
  // Check if any active tournaments exist
  const activeTournaments = await prisma.tournament.count({
    where: { status: 'ACTIVE' }
  });

  if (activeTournaments === 0) {
    console.error(`❌ CRITICAL: ${orphanedTPIP.length} orphaned TPIP balances with no active tournaments!`);
    return { success: false, error: 'Orphaned TPIP detected' };
  }
}
```

## Implementation Checklist

### ✅ Token Setup
- [x] Create TPIP token (ID: 4, symbol: TPIP, decimals: 0)
- [x] Add to database via `scripts/add_tpip_token.ts`

### 🚧 Tournament Entry
- [ ] Modify `tournament_context.ts` to use dual logging:
  - Log PIPCHIPS debit for entry fee
  - Log TPIP credit for starting balance
- [ ] Use idempotency keys: `tournament_entry_fee_${tournamentId}_${userId}`
- [ ] Use idempotency keys: `tournament_tpip_credit_${tournamentId}_${userId}`

### 🚧 In-Tournament Play
- [ ] Update tournament wager logic to use TPIP (tokenId: 4)
- [ ] Ensure all operations create Transaction + BalanceDelta
- [ ] Prevent use of regular PIPChips during tournament

### 🚧 Tournament Payouts
- [ ] Implement TPIP → PIPChips conversion for winners
- [ ] Log both sides explicitly (TPIP debit + PIPChips credit)
- [ ] Calculate payout amounts based on rankings

### 🚧 Tournament Reset
- [ ] Implement cleanup to reset all TPIP to zero
- [ ] Log explicit BalanceDelta for each reset
- [ ] Use idempotency keys: `tournament_reset_${tournamentId}_${userId}`

### 🚧 Merkle Integration
- [ ] Include TPIP in Merkle tree snapshots
- [ ] Update reconciliation script to handle temporary balances
- [ ] Add validation for orphaned TPIP detection

### 🚧 Testing
- [ ] Create `tests/tournament_integration.test.ts`
- [ ] Test full lifecycle: entry → play → payout → reset
- [ ] Verify Merkle snapshots before/after tournament
- [ ] Confirm all TPIP balances = 0 after conclusion

## Example: Complete Tournament Flow

```typescript
// Tournament: 5 players, 1000 PIPCHIPS entry, 5000 TPIP starting balance

// === ENTRY PHASE ===
// Each player:
// - Loses 1000 PIPCHIPS (logged)
// - Gains 5000 TPIP (logged)

// === PLAY PHASE ===
// Players wager TPIP on prediction markets
// Winners gain TPIP, losers lose TPIP
// All logged with Transaction + BalanceDelta

// Final TPIP balances:
// Player 1: 12000 TPIP (winner)
// Player 2: 8000 TPIP (2nd place)
// Player 3: 5000 TPIP (break even)
// Player 4: 2000 TPIP (lost some)
// Player 5: 0 TPIP (lost all)

// === PAYOUT PHASE ===
// Player 1: 12000 TPIP → 12000 PIPCHIPS (1:1 conversion)
// Player 2: 8000 TPIP → 8000 PIPCHIPS (1:1 conversion)
// Player 3: 5000 TPIP → 5000 PIPCHIPS (1:1 conversion - break even)
// Players 4-5: No payout (lost their entry fees)

// === RESET PHASE ===
// Player 1: -12000 TPIP → 0 TPIP (logged)
// Player 2: -8000 TPIP → 0 TPIP (logged)
// Player 3: -5000 TPIP → 0 TPIP (logged)
// Player 4: -2000 TPIP → 0 TPIP (logged)
// Player 5: Already 0 TPIP (no action needed)

// === FINAL STATE ===
// All players: TPIP balance = 0
// ΣBalanceDeltas for TPIP = 0
// Merkle tree validates correctly
```

## Troubleshooting

### Issue: Orphaned TPIP Balances

**Symptoms:**
- Users have nonzero TPIP after tournament ends
- Reconciliation script fails

**Causes:**
- Tournament cleanup didn't run
- Reset logic failed for some users
- Transaction rollback during cleanup

**Fix:**
```typescript
// Manual cleanup script
const orphaned = await prisma.userBalance.findMany({
  where: {
    tokenId: 4,
    amount: { not: "0" }
  }
});

for (const balance of orphaned) {
  await logCompleteTransaction(tx, {
    operation: 'TOURNAMENT_TPIP_MANUAL_RESET',
    userId: balance.userId,
    idempotencyKey: `manual_reset_${balance.userId}_${Date.now()}`,
    balanceChanges: [{
      tokenId: 4,
      userId: balance.userId,
      amountDelta: -BigInt(balance.amount),
      reason: 'manual_cleanup'
    }]
  });
}
```

### Issue: TPIP Used Outside Tournament

**Symptoms:**
- Non-tournament users have TPIP balances
- TPIP appears in regular game operations

**Prevention:**
```typescript
// Check if user is in tournament mode
if (!user.inTournamentMode && operation.usesTPIP) {
  throw new Error('TPIP can only be used during tournaments');
}

// Check token type in operations
if (tokenId === 4 && !tournamentContext) {
  throw new Error('TPIP requires tournament context');
}
```

## Migration Notes

### Existing Tournaments

If you have active tournaments when deploying TPIP:

1. **Option A: Convert Mid-Flight**
   - Calculate each player's current tournament balance
   - Credit equivalent TPIP
   - Continue tournament with TPIP

2. **Option B: Finish with Old System**
   - Let current tournaments complete without TPIP
   - Apply TPIP to new tournaments only

**Recommended:** Option B for safety

### Backfilling Historical Data

TPIP is forward-only. Historical tournaments remain in the old system (User.pipchipsBalance tracking). No backfill needed.

## Summary

TPIP provides:
- ✅ **Isolated tournament economies**
- ✅ **Complete transaction logging**
- ✅ **Merkle reconciliation support**
- ✅ **Clean state management**
- ✅ **Prevents balance leakage between regular and tournament play**

All operations must create proper `Transaction + BalanceDelta` entries for full auditability.