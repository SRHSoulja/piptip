#!/bin/bash

# test/test.sh - Prediction Markets Test Suite Runner
# This script sets up the test environment and runs the comprehensive test suite

echo "🧪 PREDICTION MARKETS COMPREHENSIVE TEST SUITE"
echo "=============================================="

# Set test environment
export NODE_ENV=test

# Use test environment variables if .env.test exists
if [ -f .env.test ]; then
    echo "📋 Loading test environment configuration..."
    export $(grep -v '^#' .env.test | grep -v '^$' | xargs)

    # Disable Redis for testing
    export REDIS_URL=""
    export REDIS_HOST=""
fi

# Create test database
echo "🗄️  Setting up test database..."
echo "   Using PostgreSQL test database from .env.test..."

# Initialize test database with schema
echo "   Pushing database schema..."
npx prisma db push --force-reset --skip-generate > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "❌ Failed to setup test database"
    exit 1
fi

echo "✅ Test database ready"

# Run the comprehensive test suite
echo ""
echo "🚀 Starting test execution..."
echo ""

# Run tests with tsx
npx tsx test/run_all_tests.ts

TEST_RESULT=$?

# Cleanup test database
echo ""
echo "🧹 Cleaning up test database..."
echo "   PostgreSQL test database will be cleaned by tests themselves"

echo "✅ Cleanup completed"

# Exit with test result
if [ $TEST_RESULT -eq 0 ]; then
    echo ""
    echo "🎉 ALL TESTS PASSED - SYSTEM READY FOR LAUNCH! 🚀"
else
    echo ""
    echo "❌ SOME TESTS FAILED - REVIEW REQUIRED BEFORE LAUNCH"
fi

exit $TEST_RESULT