#!/bin/bash
# Quick test database check

echo "🔍 Checking test database status..."
echo ""

# Load test environment
set -a
source .env.test
set +a

echo "1. Docker containers:"
docker ps --filter "name=piptip-test" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

echo "2. Database URL:"
echo "   $TEST_DATABASE_URL" | cut -d'@' -f2
echo ""

echo "3. Testing connection with psql:"
docker exec piptip-test-db psql -U piptip_test -d piptip_test -c "SELECT 1 AS test;" 2>&1 || echo "   ⚠️  Direct connection test failed"
echo ""

echo "4. Testing with Prisma:"
DATABASE_URL="$TEST_DATABASE_URL" npx prisma db execute --stdin <<< "SELECT 1;" 2>&1
echo ""

echo "5. Checking if tables exist:"
docker exec piptip-test-db psql -U piptip_test -d piptip_test -c "\dt" 2>&1 | head -20
