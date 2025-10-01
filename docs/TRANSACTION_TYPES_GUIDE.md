# PIPChips Transaction Types Guide

## Overview

This guide documents all valid PIPChips transaction types in the PIPTip system, their usage patterns, and how to properly implement them in tests and production code.

## Valid Transaction Types

The following transaction types are defined in `prisma/schema.prisma` as the `PipchipsTransactionType` enum (lines 1116-1134):

### Daily Rewards
- **`DAILY_BONUS`** - Base daily reward for claiming
- **`STREAK_BONUS`** - Additional bonus for maintaining streaks
- **`STARTING_BONUS`** - Initial bonus when user first registers

### Purchases
- **`PURCHASE`** - PIPChips purchased with real tokens (ABSTER, ICE, etc.)

### Match Betting (1v1 Games)
- **`BET_PLACED`** - Wager deducted when placing a bet
- **`BET_WON`** - Payout credited when winning a match
- **`BET_REFUNDED`** - Wager returned when match is cancelled

### Prediction Markets
- **`PREDICTION_BET`** - Wager placed on a prediction market
- **`PREDICTION_WIN`** - Payout from winning prediction
- **`PREDICTION_LOSS`** - Recorded loss (for analytics/history)

### Tournaments
- **`TOURNAMENT_ENTRY`** - Entry fee for joining a tournament
- **`TOURNAMENT_BET`** - Wager placed within tournament context
- **`TOURNAMENT_WIN`** - Prize awarded for tournament placement
- **`TOURNAMENT_PRIZE`** - Prize pool distribution

### Admin Operations
- **`ADMIN_CREDIT`** - Manual credit by administrator
- **`ADMIN_DEBIT`** - Manual debit by administrator

### Referrals
- **`REFERRAL_BONUS`** - Bonus for referring new users

## Usage in Code

### Production Code

Use the imported `PipchipsTransactionType` enum from Prisma:

```typescript
import { PipchipsTransactionType } from '@prisma/client';
import { pipchipsService } from '../services/pipchips_service.js';

// Correct usage
await pipchipsService.debitPIPChips(
  userId,
  amount,
  PipchipsTransactionType.BET_PLACED,
  matchId,
  'Match wager'
);

await pipchipsService.creditPIPChips(
  winnerId,
  payout,
  PipchipsTransactionType.BET_WON,
  matchId,
  'Match payout'
);
```

### Test Code

Use the `getValidTransactionTypes()` helper from `test_mocks.ts`:

```typescript
import { getValidTransactionTypes } from '../src/services/test_mocks.js';

const TxTypes = getValidTransactionTypes();

// Correct usage in tests
await pipchipsService.debitPIPChips(
  userId,
  amount,
  TxTypes.BET_PLACED,
  matchId,
  'Test match wager'
);

await pipchipsService.creditPIPChips(
  winnerId,
  payout,
  TxTypes.BET_WON,
  matchId,
  'Test match payout'
);
```

## Common Patterns

### Match Flow (1v1 Games)

```typescript
// 1. Place wagers
await pipchipsService.debitPIPChips(
  challengerId,
  wagerAmount,
  TxTypes.BET_PLACED,
  matchId,
  'Match wager'
);

await pipchipsService.debitPIPChips(
  joinerId,
  wagerAmount,
  TxTypes.BET_PLACED,
  matchId,
  'Match wager'
);

// 2. Calculate payout (with 2% rake)
const pot = wagerAmount * 2n;
const rake = (pot * 2n) / 100n;
const payout = pot - rake;

// 3. Credit winner
await pipchipsService.creditPIPChips(
  winnerId,
  payout,
  TxTypes.BET_WON,
  matchId,
  'Match payout'
);
```

### Daily Bonus with Streak

```typescript
const baseAmount = 100n;
const streakMultiplier = calculateStreakMultiplier(currentStreak);
const bonusAmount = baseAmount + streakMultiplier;

await pipchipsService.creditPIPChips(
  userId,
  baseAmount,
  TxTypes.DAILY_BONUS,
  undefined,
  'Daily bonus claim'
);

if (streakMultiplier > 0n) {
  await pipchipsService.creditPIPChips(
    userId,
    streakMultiplier,
    TxTypes.STREAK_BONUS,
    undefined,
    `Streak bonus (${currentStreak} days)`
  );
}
```

### Admin Operations

```typescript
// Credit PIPChips to user
await pipchipsService.creditPIPChips(
  userId,
  amount,
  TxTypes.ADMIN_CREDIT,
  `admin_action_${Date.now()}`,
  'Manual credit by admin'
);

// Debit PIPChips from user
await pipchipsService.debitPIPChips(
  userId,
  amount,
  TxTypes.ADMIN_DEBIT,
  `admin_action_${Date.now()}`,
  'Manual debit by admin'
);
```

## Test Helper Functions

### Location
`src/services/test_mocks.ts` (lines 48-94)

### Available Functions

#### `getValidTransactionTypes()`
Returns an object with all valid transaction types as constants:

```typescript
const TxTypes = getValidTransactionTypes();
// Returns:
// {
//   DAILY_BONUS: 'DAILY_BONUS',
//   BET_PLACED: 'BET_PLACED',
//   BET_WON: 'BET_WON',
//   ...
// }
```

#### `getAllTransactionTypes()`
Returns an array of all valid transaction type strings:

```typescript
const allTypes = getAllTransactionTypes();
// Returns: ['DAILY_BONUS', 'STREAK_BONUS', 'BET_PLACED', ...]
```

## Common Errors and Fixes

### Error: Invalid Transaction Type

**Problem:**
```typescript
// ❌ WRONG - Invalid type
await pipchipsService.debitPIPChips(
  userId,
  amount,
  'wagerAtomic',  // This is not a valid transaction type!
  matchId,
  'description'
);
```

**Solution:**
```typescript
// ✅ CORRECT
await pipchipsService.debitPIPChips(
  userId,
  amount,
  TxTypes.BET_PLACED,  // Valid transaction type
  matchId,
  'description'
);
```

### Error: wagerAtomic Type Mismatch

**Problem:**
```typescript
// ❌ WRONG - Decimal constructor
const match = await prisma.match.create({
  data: {
    wagerAtomic: new Decimal(100),  // Wrong type!
  }
});
```

**Solution:**
```typescript
// ✅ CORRECT - Integer value
const match = await prisma.match.create({
  data: {
    wagerAtomic: 100,  // Stored as Int in database
  }
});
```

## Recent Fixes (2025-10-01)

### Files Updated

1. **`src/services/test_mocks.ts`**
   - Added `getValidTransactionTypes()` helper function
   - Added `getAllTransactionTypes()` helper function
   - Provides centralized source of truth for test transaction types

2. **`tests/discord_integration.test.ts`**
   - Fixed: `wagerAtomic` type from `Decimal(100)` to `100` (line 179)
   - Fixed: Transaction type from `'BET_PLACED'` to `TxTypes.BET_PLACED` (line 238)
   - Added: Import of `getValidTransactionTypes` helper

3. **`tests/scaling_failover.test.ts`**
   - Fixed: All `wagerAtomic` values from Decimal to Int (lines 103, 333, 449)
   - Fixed: All transaction types to use `TxTypes.*` (lines 129, 137, 147, 206, 217, 458, 459, 486)
   - Added: Import of `getValidTransactionTypes` helper

### Summary of Changes

- **Transaction Types**: All hardcoded string transaction types replaced with validated constants from helper
- **Data Types**: All `wagerAtomic` fields corrected from `Decimal` to `Int`
- **Test Safety**: Centralized helper prevents future type mismatches
- **Documentation**: Complete guide created for developers

## Best Practices

1. **Always use the helper in tests**: Import `getValidTransactionTypes()` instead of hardcoding strings
2. **Use Prisma enum in production**: Import `PipchipsTransactionType` from `@prisma/client`
3. **Match type to context**: Use `BET_*` for matches, `PREDICTION_*` for markets, `TOURNAMENT_*` for tournaments
4. **Include descriptive references**: Pass meaningful `referenceId` and `description` parameters
5. **Handle errors**: Wrap transactions in try-catch blocks with proper error handling

## Validation

To validate that a string is a valid transaction type:

```typescript
import { getAllTransactionTypes } from '../src/services/test_mocks.js';

function isValidTransactionType(type: string): boolean {
  return getAllTransactionTypes().includes(type);
}
```

## Database Schema Reference

From `prisma/schema.prisma` (lines 1116-1134):

```prisma
enum PipchipsTransactionType {
  DAILY_BONUS
  STREAK_BONUS
  PURCHASE
  BET_PLACED
  BET_WON
  BET_REFUNDED
  TOURNAMENT_PRIZE
  ADMIN_CREDIT
  ADMIN_DEBIT
  REFERRAL_BONUS
  STARTING_BONUS
  PREDICTION_BET
  PREDICTION_WIN
  PREDICTION_LOSS
  TOURNAMENT_ENTRY
  TOURNAMENT_BET
  TOURNAMENT_WIN
}
```

## Related Files

- **Schema Definition**: `prisma/schema.prisma` (lines 1116-1134)
- **Service Implementation**: `src/services/pipchips_service.ts` (lines 1-200)
- **Test Helper**: `src/services/test_mocks.ts` (lines 48-94)
- **Test Implementations**:
  - `tests/discord_integration.test.ts`
  - `tests/scaling_failover.test.ts`
  - `tests/prediction_market_flow.test.ts`
  - `tests/match_integration.test.ts`

## Support

For questions or issues with transaction types, refer to:
1. This guide
2. The Prisma schema definition
3. The `pipchips_service.ts` implementation
4. Test examples in the test suite
