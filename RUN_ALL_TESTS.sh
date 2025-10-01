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
    set -a
    source .env.test
    set +a
fi
echo -e "${GREEN}✅ Test environment loaded${NC}"

echo ""
echo "🌱 Seeding test database..."
npm run test:seed

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
