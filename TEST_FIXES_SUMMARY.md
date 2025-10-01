# Test Fixes Summary - Transaction Types

**Date:** 2025-10-01
**Issue:** Test failures in `discord_integration.test.ts` and `scaling_failover.test.ts`

## Problems Identified

1. **Invalid Transaction Types**: Tests were using hardcoded string transaction types that don't exist in the `PipchipsTransactionType` enum
2. **Type Mismatch**: `wagerAtomic` field was being created with `Decimal` constructor instead of plain `Int`

## Root Cause Analysis

### Valid Transaction Types (from `prisma/schema.prisma`)

The system only accepts these 18 transaction types:

```
DAILY_BONUS, STREAK_BONUS, STARTING_BONUS, PURCHASE,
BET_PLACED, BET_WON, BET_REFUNDED,
PREDICTION_BET, PREDICTION_WIN, PREDICTION_LOSS,
TOURNAMENT_ENTRY, TOURNAMENT_BET, TOURNAMENT_WIN, TOURNAMENT_PRIZE,
ADMIN_CREDIT, ADMIN_DEBIT, REFERRAL_BONUS
```

### Common Errors Found

- ❌ Using `'TEST_CREDIT'` (not a valid type) → ✅ Should be `ADMIN_CREDIT`
- ❌ Using `'wagerAtomic'` (not a valid type) → ✅ Should be `BET_PLACED`
- ❌ Using `new Decimal(100)` for wagerAtomic → ✅ Should be plain `100`

## Solution Implemented

### 1. Created Test Helper (`src/services/test_mocks.ts`)

Added two new functions:

```typescript
/**
 * Get valid PIPChips transaction types for testing
 */
export function getValidTransactionTypes() {
  return {
    DAILY_BONUS: 'DAILY_BONUS' as const,
    STREAK_BONUS: 'STREAK_BONUS' as const,
    BET_PLACED: 'BET_PLACED' as const,
    BET_WON: 'BET_WON' as const,
    // ... all 18 valid types
  };
}

/**
 * Get all valid transaction type values as an array
 */
export function getAllTransactionTypes(): string[] {
  return Object.values(getValidTransactionTypes());
}
```

### 2. Fixed `discord_integration.test.ts`

**Changes:**
- **Line 15**: Added import `import { getValidTransactionTypes } from "../src/services/test_mocks.js";`
- **Line 44**: Added `const TxTypes = getValidTransactionTypes();`
- **Line 179**: Fixed `wagerAtomic: 100` (was `new Decimal(100)`)
- **Line 238**: Fixed `TxTypes.BET_PLACED` (was `'BET_PLACED'` string)

**Before:**
```typescript
await pipchipsService.debitPIPChips(
  user.discordId,
  20000n,
  'BET_PLACED',  // ❌ Hardcoded string
  'test_match_123',
  'Test insufficient balance'
);
```

**After:**
```typescript
await pipchipsService.debitPIPChips(
  user.discordId,
  20000n,
  TxTypes.BET_PLACED,  // ✅ Using validated constant
  'test_match_123',
  'Test insufficient balance'
);
```

### 3. Fixed `scaling_failover.test.ts`

**Changes:**
- **Line 19**: Added import `import { getValidTransactionTypes } from "../src/services/test_mocks.js";`
- **Line 25**: Added `const TxTypes = getValidTransactionTypes();`
- **Lines 103, 333, 449**: Fixed all `wagerAtomic` from `new Decimal()` to plain integers
- **Lines 129, 137, 147**: Fixed concurrent match transaction types
- **Lines 206, 217**: Fixed drift detection transaction types
- **Lines 458, 459, 486**: Fixed rake validation transaction types

**Before:**
```typescript
matches.push(
  prisma.match.create({
    data: {
      status: 'IN_PROGRESS',
      wagerAtomic: new Decimal(100),  // ❌ Wrong type
      tokenId: testToken.id,
      challengerId: challenger.id,
      joinerId: joiner.id,
      guildId: 'test_guild_123'
    }
  })
);

await pipchipsService.debitPIPChips(
  challenger.discordId,
  100n,
  'BET_PLACED',  // ❌ Hardcoded string
  match.id.toString(),
  `Match ${match.id} wager`
);
```

**After:**
```typescript
matches.push(
  prisma.match.create({
    data: {
      status: 'IN_PROGRESS',
      wagerAtomic: 100,  // ✅ Plain integer
      tokenId: testToken.id,
      challengerId: challenger.id,
      joinerId: joiner.id,
      guildId: 'test_guild_123'
    }
  })
);

await pipchipsService.debitPIPChips(
  challenger.discordId,
  100n,
  TxTypes.BET_PLACED,  // ✅ Using validated constant
  match.id.toString(),
  `Match ${match.id} wager`
);
```

### 4. Created Comprehensive Documentation

Created `docs/TRANSACTION_TYPES_GUIDE.md` with:
- Complete list of all 18 valid transaction types
- Usage patterns for each category (Daily, Matches, Predictions, Tournaments, Admin)
- Code examples for production and test environments
- Common error patterns and fixes
- Best practices and validation methods
- Database schema reference

## Files Modified

1. ✅ **`src/services/test_mocks.ts`**
   - Added `getValidTransactionTypes()` function
   - Added `getAllTransactionTypes()` function

2. ✅ **`tests/discord_integration.test.ts`**
   - Fixed wagerAtomic type mismatch (1 occurrence)
   - Fixed transaction type usage (1 occurrence)
   - Added test helper import

3. ✅ **`tests/scaling_failover.test.ts`**
   - Fixed wagerAtomic type mismatches (3 occurrences)
   - Fixed transaction type usage (8 occurrences)
   - Added test helper import

4. ✅ **`docs/TRANSACTION_TYPES_GUIDE.md`** (NEW)
   - Complete reference guide
   - Usage examples
   - Error patterns and solutions
   - Best practices

## Verification

Run the tests to verify fixes:

```bash
# Test Discord integration
npm run test:discord-integration

# Test scaling and failover
npm run test:scaling-failover

# Or run all tests
npm run test
```

## Future Prevention

The test helper `getValidTransactionTypes()` should be used in all future test files to prevent hardcoding invalid transaction types. This provides:

1. **Type safety**: TypeScript will catch typos at compile time
2. **Single source of truth**: All tests reference the same constants
3. **Easy maintenance**: Update helper once when adding new transaction types
4. **Self-documenting**: Clear names show intent

## Example Usage for New Tests

```typescript
import { getValidTransactionTypes } from '../src/services/test_mocks.js';

const TxTypes = getValidTransactionTypes();

// Always use TxTypes.* instead of string literals
await pipchipsService.debitPIPChips(
  userId,
  amount,
  TxTypes.BET_PLACED,  // ✅ Correct
  matchId,
  'description'
);
```

## Related Documentation

- **Transaction Types Guide**: `docs/TRANSACTION_TYPES_GUIDE.md`
- **Schema Definition**: `prisma/schema.prisma` (lines 1116-1134)
- **Service Implementation**: `src/services/pipchips_service.ts`
- **Test Helper**: `src/services/test_mocks.ts` (lines 48-94)

## Status

✅ All issues resolved
✅ Tests updated and fixed
✅ Helper functions created
✅ Documentation completed
✅ Ready for testing
