# Run All Tests - Complete Validation Script

## Quick Start

```bash
# 1. Start Docker
sudo systemctl start docker  # Linux
# OR launch Docker Desktop   # Mac/Windows

# 2. Setup test database (one command)
npm run test:setup

# 3. Run this script
bash RUN_ALL_TESTS.sh
```

---

## Complete Test Execution Script

Save this as `RUN_ALL_TESTS.sh`:

```bash
#!/bin/bash
# Complete PIPTip Bot Test Suite
# Runs all tests and generates comprehensive report

set -e  # Exit on error

echo "🧪 PIPTip Bot - Complete Test Suite"
echo "===================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Counters
TOTAL_SUITES=0
PASSED_SUITES=0
FAILED_SUITES=0

# Results file
RESULTS_FILE="TEST_RESULTS_$(date +%Y-%m-%d_%H-%M-%S).md"

# Function to run test and track results
run_test() {
    local test_name="$1"
    local test_command="$2"

    TOTAL_SUITES=$((TOTAL_SUITES + 1))

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🧪 Running: $test_name"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    if eval "$test_command" 2>&1 | tee -a "$RESULTS_FILE"; then
        echo -e "${GREEN}✅ PASSED: $test_name${NC}"
        echo "✅ PASSED: $test_name" >> "$RESULTS_FILE"
        PASSED_SUITES=$((PASSED_SUITES + 1))
    else
        echo -e "${RED}❌ FAILED: $test_name${NC}"
        echo "❌ FAILED: $test_name" >> "$RESULTS_FILE"
        FAILED_SUITES=$((FAILED_SUITES + 1))
    fi

    echo "" >> "$RESULTS_FILE"
}

# Start results file
echo "# PIPTip Bot Test Results" > "$RESULTS_FILE"
echo "**Date:** $(date)" >> "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"
echo "## Test Execution Log" >> "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"

# Check Docker
echo "🐳 Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running!${NC}"
    echo "Please start Docker and try again."
    exit 1
fi
echo -e "${GREEN}✅ Docker is running${NC}"

# Check test database
echo ""
echo "🔍 Checking test database..."
if docker ps | grep piptip-test-db > /dev/null; then
    echo -e "${GREEN}✅ Test database is running${NC}"
else
    echo -e "${YELLOW}⚠️  Test database not running, starting...${NC}"
    npm run test:setup
fi

# Verify environment
echo ""
echo "🔒 Verifying test environment..."
if [ -z "$TEST_DATABASE_URL" ]; then
    echo -e "${YELLOW}⚠️  Loading test environment...${NC}"
    export $(grep -v '^#' .env.test | xargs)
fi
echo -e "${GREEN}✅ Test environment loaded${NC}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Starting Test Execution"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# PHASE 1: Environment Validation
echo ""
echo "📋 PHASE 1: Environment Validation"
echo "──────────────────────────────────"

run_test "Markets Migration Validation (21 checks)" \
    "npm run validate:markets-migration"

# PHASE 2: Core Functionality Tests
echo ""
echo "🎮 PHASE 2: Core Functionality Tests"
echo "────────────────────────────────────"

run_test "Match Integration" \
    "npm run test:match-integration"

run_test "Transaction Log Integration" \
    "npm run test:transaction-integration"

run_test "Prediction Markets (Integration)" \
    "npm run test:prediction-integration"

run_test "Prediction Markets (Flow)" \
    "npm run test:prediction-flow"

run_test "Prediction Markets (Migration)" \
    "npm run test:markets-integration"

run_test "Tournament TPIP" \
    "npm run test:tournament-tpip"

run_test "Tournament Multi-Token Entry" \
    "npm run test:tournament-entry"

# PHASE 3: Validation & Monitoring
echo ""
echo "📊 PHASE 3: Validation & Monitoring"
echo "───────────────────────────────────"

run_test "TPIP System Validation" \
    "npm run validate:tpip"

run_test "Stress Test (Short Mode)" \
    "npm run test:stress-short"

run_test "Balance Functions Audit" \
    "npm run audit:balance-functions"

# PHASE 4: Supporting Tests
echo ""
echo "🔧 PHASE 4: Supporting Tests"
echo "────────────────────────────"

run_test "Merkle Publisher" \
    "npm run test:merkle-publisher"

run_test "Network Configuration" \
    "npm run test:network"

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Test Execution Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Total Test Suites: $TOTAL_SUITES"
echo -e "${GREEN}Passed: $PASSED_SUITES${NC}"
echo -e "${RED}Failed: $FAILED_SUITES${NC}"
echo ""

# Calculate percentage
PASS_RATE=$(echo "scale=1; ($PASSED_SUITES * 100) / $TOTAL_SUITES" | bc)
echo "Pass Rate: $PASS_RATE%"
echo ""

# Write summary to results file
{
    echo ""
    echo "## Summary"
    echo ""
    echo "- **Total Test Suites:** $TOTAL_SUITES"
    echo "- **Passed:** $PASSED_SUITES"
    echo "- **Failed:** $FAILED_SUITES"
    echo "- **Pass Rate:** $PASS_RATE%"
    echo ""
} >> "$RESULTS_FILE"

# Final status
if [ $FAILED_SUITES -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
    echo "✅ ALL TESTS PASSED" >> "$RESULTS_FILE"
    echo ""
    echo "Results saved to: $RESULTS_FILE"
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    echo "❌ SOME TESTS FAILED" >> "$RESULTS_FILE"
    echo ""
    echo "Results saved to: $RESULTS_FILE"
    echo "Please review failures and address issues."
    exit 1
fi
```

---

## Make Script Executable

```bash
chmod +x RUN_ALL_TESTS.sh
```

---

## Run Tests

```bash
./RUN_ALL_TESTS.sh
```

The script will:
1. ✅ Check Docker is running
2. ✅ Verify test database is started
3. ✅ Load test environment
4. 🧪 Run all 13+ test suites
5. 📊 Generate comprehensive results report
6. ✅ Show pass/fail summary

---

## Alternative: Manual Execution

If you prefer to run tests manually:

### Phase 1: Environment Validation (2 min)
```bash
npm run validate:markets-migration
```

### Phase 2: Core Functionality (30 min)
```bash
npm run test:match-integration
npm run test:transaction-integration
npm run test:prediction-integration
npm run test:prediction-flow
npm run test:markets-integration
npm run test:tournament-tpip
npm run test:tournament-entry
```

### Phase 3: Validation & Monitoring (15 min)
```bash
npm run validate:tpip
npm run test:stress-short
npm run audit:balance-functions
```

### Phase 4: Supporting Tests (5 min)
```bash
npm run test:merkle-publisher
npm run test:network
```

---

## Expected Results

### Success Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Test Execution Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total Test Suites: 13
Passed: 13
Failed: 0

Pass Rate: 100.0%

✅ ALL TESTS PASSED!

Results saved to: TEST_RESULTS_2025-10-01_14-30-00.md
```

### Acceptable Output

```
Total Test Suites: 13
Passed: 11
Failed: 2

Pass Rate: 84.6%

❌ SOME TESTS FAILED

Results saved to: TEST_RESULTS_2025-10-01_14-30-00.md
Please review failures and address issues.
```

---

## Interpreting Results

### 100% Pass Rate ✅
- All systems working correctly
- Ready for production
- No critical issues

### 80-99% Pass Rate ⚠️
- Most systems working
- Review failed tests
- Address root causes
- Re-run to confirm fixes

### <80% Pass Rate ❌
- Significant issues present
- Critical review needed
- May require code fixes
- Not ready for production

---

## Common Issues & Solutions

### Issue: Docker not running
```
❌ Docker is not running!
```
**Solution:**
```bash
sudo systemctl start docker
```

### Issue: Test database not found
```
❌ Test database not running
```
**Solution:**
```bash
npm run test:setup
```

### Issue: Environment not loaded
```
⚠️ TEST_DATABASE_URL not set
```
**Solution:**
```bash
export $(grep -v '^#' .env.test | xargs)
```

### Issue: Port already in use
```
❌ Port 5433 already allocated
```
**Solution:**
```bash
npm run test:db:stop
npm run test:setup
```

---

## After Running Tests

### 1. Review Results File
```bash
cat TEST_RESULTS_*.md
```

### 2. Check for Failures
Look for `❌ FAILED` entries and review error messages

### 3. Address Issues
- Fix failing tests
- Update code if needed
- Re-run specific tests

### 4. Document Findings
Update project documentation with:
- Test results
- Any issues found
- Fixes applied
- Recommendations

### 5. Create Tickets
For any gaps or failures:
- Create GitHub issues
- Assign priorities
- Set timelines

---

## CI/CD Integration

Add to `.github/workflows/test-database.yml`:

```yaml
- name: Run Complete Test Suite
  run: ./RUN_ALL_TESTS.sh

- name: Upload Test Results
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: test-results
    path: TEST_RESULTS_*.md
```

---

## Summary

**Total Duration:** ~50-60 minutes
**Test Suites:** 13+
**Commands:** 19 different test scripts
**Output:** Detailed results file

**Prerequisites:**
- Docker running
- Test database setup
- npm dependencies installed

**Expected Outcome:**
- Comprehensive validation
- Clear pass/fail report
- Actionable insights
- Production readiness assessment

---

**Ready to Execute:** ✅
**Next Action:** Start Docker → Run script
**Status:** Comprehensive testing plan complete
