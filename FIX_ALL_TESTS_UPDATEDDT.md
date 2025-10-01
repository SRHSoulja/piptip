# Fix All Tests - Add updatedAt Field

**Issue:** All test files fail with `Argument 'updatedAt' is missing`

**Root Cause:** Prisma User model requires `updatedAt` field but test files don't provide it

**Files to Fix:** 8 files total

---

## Quick Fix - Use This sed Command

Run this single command to fix all files at once:

```bash
# Fix all test files with one command
find tests/ scripts/ -name "*.test.ts" -o -name "stress_test_reconciliation.ts" | while read file; do
  # Add updatedAt to user.create() calls
  sed -i 's/data: {$/data: {\n          updatedAt: new Date(),/' "$file"
  # Add updatedAt to user.upsert() create blocks
  sed -i '/create: {$/,/},/ s/predictionSelfExcluded: false,$/predictionSelfExcluded: false,\n          updatedAt: new Date()/' "$file"
  # Add updatedAt to user.upsert() update blocks
  sed -i '/update: {$/,/}/ s/predictionSelfExcluded: false$/predictionSelfExcluded: false,\n          updatedAt: new Date()/' "$file"
done
```

**OR** manually edit each file as shown below:

---

## Manual Fix Guide

### Pattern 1: Simple user.create()

**Find:**
```typescript
const user = await prisma.user.create({
  data: {
    discordId: "test_user_123"
  }
});
```

**Replace with:**
```typescript
const user = await prisma.user.create({
  data: {
    discordId: "test_user_123",
    updatedAt: new Date()
  }
});
```

---

### Pattern 2: user.create() with pipchipsBalance

**Find:**
```typescript
const user = await prisma.user.create({
  data: {
    discordId: "test_user_123",
    pipchipsBalance: 10000n
  }
});
```

**Replace with:**
```typescript
const user = await prisma.user.create({
  data: {
    discordId: "test_user_123",
    pipchipsBalance: 10000n,
    updatedAt: new Date()
  }
});
```

---

### Pattern 3: user.upsert() with create/update

**Find:**
```typescript
const user = await prisma.user.upsert({
  where: { discordId: "test_predictor_1" },
  create: {
    discordId: "test_predictor_1",
    agwAddress: "0xa3299c781585e",
    pipchipsBalance: 10000n,
    pipchipsEarnedTotal: 10000n,
    pipchipsSpentTotal: 0n,
    pipchipsBoughtTotal: 0n,
    predictionDailyLossLimit: 999999,
    predictionDailyCountLimit: 999,
    predictionSelfExcluded: false
  },
  update: {
    pipchipsBalance: 10000n,
    pipchipsEarnedTotal: 10000n,
    pipchipsSpentTotal: 0n,
    pipchipsBoughtTotal: 0n,
    predictionDailyLossLimit: 999999,
    predictionDailyCountLimit: 999,
    predictionSelfExcluded: false
  }
});
```

**Replace with:**
```typescript
const user = await prisma.user.upsert({
  where: { discordId: "test_predictor_1" },
  create: {
    discordId: "test_predictor_1",
    agwAddress: "0xa3299c781585e",
    pipchipsBalance: 10000n,
    pipchipsEarnedTotal: 10000n,
    pipchipsSpentTotal: 0n,
    pipchipsBoughtTotal: 0n,
    predictionDailyLossLimit: 999999,
    predictionDailyCountLimit: 999,
    predictionSelfExcluded: false,
    updatedAt: new Date()  // ADD THIS
  },
  update: {
    pipchipsBalance: 10000n,
    pipchipsEarnedTotal: 10000n,
    pipchipsSpentTotal: 0n,
    pipchipsBoughtTotal: 0n,
    predictionDailyLossLimit: 999999,
    predictionDailyCountLimit: 999,
    predictionSelfExcluded: false,
    updatedAt: new Date()  // AND THIS
  }
});
```

---

## Files to Fix (8 total)

1. `tests/match_integration.test.ts` - Line 61
2. `tests/transaction_log_integration.test.ts` - Line 48
3. `tests/prediction_market_integration.test.ts` - Line 43 (upsert)
4. `tests/prediction_market_flow.test.ts` - Line 61
5. `tests/tournament_tpip_integration.test.ts` - Multiple lines
6. `tests/tournament_entry_multi_token.test.ts` - Multiple lines
7. `tests/multi_token_acceptance.test.ts` - Multiple lines
8. `scripts/stress_test_reconciliation.ts` - Line 154

---

## After Fixing

Re-run the test suite:

```bash
./RUN_ALL_TESTS.sh
```

**Expected Result:** 10-11/13 tests should pass

**Remaining Issues:**
- 2-3 tests with @jest/globals dependency (separate fix needed)
- 2 tournament tests may still have token lookup issues

---

## Alternative: Fix Just One File First (Test Run)

To verify the fix works, edit just one file:

```bash
# Edit match_integration.test.ts line 61
nano tests/match_integration.test.ts
```

Find line 61:
```typescript
const user = await prisma.user.create({
  data: {
    discordId: `test_match_user_${Date.now()}_${i}`
  }
});
```

Change to:
```typescript
const user = await prisma.user.create({
  data: {
    discordId: `test_match_user_${Date.now()}_${i}`,
    updatedAt: new Date()
  }
});
```

Then test just that one:
```bash
npm run test:match-integration
```

If it passes the setup phase, the fix works!

---

## Automated Fix Script (Recommended)

Create a script to fix all at once:

```bash
cat > scripts/fix_test_updatedat.sh << 'EOF'
#!/bin/bash

echo "🔧 Fixing updatedAt in all test files..."

# Files to fix
files=(
  "tests/match_integration.test.ts"
  "tests/transaction_log_integration.test.ts"
  "tests/prediction_market_integration.test.ts"
  "tests/prediction_market_flow.test.ts"
  "tests/tournament_tpip_integration.test.ts"
  "tests/tournament_entry_multi_token.test.ts"
  "tests/multi_token_acceptance.test.ts"
  "scripts/stress_test_reconciliation.ts"
)

for file in "${files[@]}"; do
  echo "  Fixing $file..."

  # Backup original
  cp "$file" "$file.backup"

  # Add updatedAt to simple user.create calls
  # This is complex - easier to do manually or with a TypeScript script
  echo "    ⚠️  Manual edit required for $file"
done

echo ""
echo "📝 Manual editing required:"
echo "   Add 'updatedAt: new Date()' to all user.create() and user.upsert() calls"
echo ""
echo "Backup files created with .backup extension"
EOF

chmod +x scripts/fix_test_updatedat.sh
```

---

## Summary

**Issue:** Missing `updatedAt` field in 8 test files
**Impact:** All functional tests fail on setup
**Fix Time:** 10-15 minutes (manual) or 2 minutes (sed command)
**Expected Outcome:** 10-11/13 tests passing after fix
