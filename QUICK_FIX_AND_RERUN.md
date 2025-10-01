# Quick Fix & Re-Run Guide

**Time Required:** 30 minutes
**Objective:** Fix critical blockers and execute full test suite

---

## Issue Summary

Your test run showed **13/13 PASSED** but this is **misleading**. Only 1 test actually ran:
- ✅ Balance Functions Audit (found 33 missing logs)
- ⚠️ 9 tests didn't run (`dotenv: Permission denied`)
- ❌ 1 test failed (Stress Test - no token)
- ❌ 2 tests missing (no script defined)

---

## Quick Fixes (Run These Now)

### Fix #1: Rebuild dotenv-cli (5 min)

```bash
cd /home/arson/builds/piptip

# Rebuild dotenv-cli to fix permissions
npm rebuild dotenv-cli

# Verify it works
node_modules/.bin/dotenv --version
```

**Expected:** Version number displayed, no permission errors

---

### Fix #2: Add Missing Test Scripts (2 min)

Edit `package.json` and add these two lines in the "scripts" section:

```json
{
  "scripts": {
    "test:merkle-publisher": "dotenv -e .env.test -- npx tsx tests/merkle_publisher.test.ts",
    "test:network": "dotenv -e .env.test -- npx tsx tests/network.test.ts"
  }
}
```

Or run this command:

```bash
# Quick edit with sed
sed -i '/"test:tournament-entry":/a\    "test:merkle-publisher": "dotenv -e .env.test -- npx tsx tests/merkle_publisher.test.ts",\n    "test:network": "dotenv -e .env.test -- npx tsx tests/network.test.ts",' package.json
```

---

### Fix #3: Seed Test Token for Stress Test (10 min)

Create a test seeding script:

```bash
cat > scripts/seed_test_token.ts << 'EOF'
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding test token...');

  const token = await prisma.token.upsert({
    where: { symbol: 'PIPCHIPS' },
    create: {
      name: 'PIPChips',
      symbol: 'PIPCHIPS',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 0,
      isActive: true
    },
    update: {
      isActive: true
    }
  });

  console.log('✅ Token seeded:', token);

  const tpipToken = await prisma.token.upsert({
    where: { symbol: 'TPIP' },
    create: {
      name: 'Tournament PIPChips',
      symbol: 'TPIP',
      address: '0x0000000000000000000000000000000000000001',
      decimals: 0,
      isActive: true
    },
    update: {
      isActive: true
    }
  });

  console.log('✅ TPIP token seeded:', tpipToken);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
EOF
```

Run it:

```bash
dotenv -e .env.test -- npx tsx scripts/seed_test_token.ts
```

---

### Fix #4: Install bc for Math (1 min)

```bash
sudo apt-get install -y bc
```

---

## Re-Run Complete Test Suite

```bash
./RUN_ALL_TESTS.sh
```

**Expected Duration:** 50-60 minutes
**Expected Outcome:** 11-13 tests execute fully with real results

---

## What to Look For

### Success Indicators
- ✅ No "Permission denied" errors
- ✅ Test output shows actual test execution
- ✅ Stress test completes or shows specific test failures
- ✅ Summary shows actual pass rate with bc calculation

### Still Expected Issues
- ⚠️ Some tests may fail with real errors (that's good - shows they ran!)
- ⚠️ Transaction logging warnings (33 functions, we know about this)
- ⚠️ Possible test data issues (can fix after seeing real errors)

---

## After Re-Run

Once tests complete, share the new `TEST_RESULTS_*.md` file and I'll:

1. ✅ Analyze actual test failures
2. ✅ Generate specific TODOs with code snippets
3. ✅ Provide confidence ratings per system
4. ✅ Create prioritized fix plan with time estimates
5. ✅ Identify any new gaps discovered

---

## Alternative: Quick Test of One Suite

If you want to verify the fix worked before running all tests:

```bash
# Test one suite first
npm run validate:markets-migration
```

**Should see:** Actual validation output with 21 checks, not "Permission denied"

---

## Estimated Timeline

| Task | Time |
|------|------|
| Rebuild dotenv-cli | 5 min |
| Add test scripts | 2 min |
| Seed test token | 10 min |
| Install bc | 1 min |
| Re-run full suite | 60 min |
| **TOTAL** | **78 min (~1.5 hours)** |

---

## Ready?

Run these commands in order:

```bash
# 1. Fix dotenv
npm rebuild dotenv-cli

# 2. Seed test data
dotenv -e .env.test -- npx tsx scripts/seed_test_token.ts

# 3. Install bc
sudo apt-get install -y bc

# 4. Re-run tests
./RUN_ALL_TESTS.sh
```

Then share the new results file when complete!
