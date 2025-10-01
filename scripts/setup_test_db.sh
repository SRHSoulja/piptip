#!/bin/bash
# Setup Test Database
# This script prepares the isolated test database for running tests

set -e  # Exit on error

echo "🔧 Setting up test database..."
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running!${NC}"
    echo "Please start Docker and try again."
    exit 1
fi

# Check if .env.test exists
if [ ! -f .env.test ]; then
    echo -e "${RED}❌ .env.test file not found!${NC}"
    echo "Please create .env.test with TEST_DATABASE_URL"
    exit 1
fi

# Load test environment variables
echo -e "${YELLOW}📋 Loading test environment from .env.test${NC}"
set -a  # Automatically export all variables
source .env.test
set +a  # Disable auto-export

# Verify TEST_DATABASE_URL is set
if [ -z "$TEST_DATABASE_URL" ]; then
    echo -e "${RED}❌ TEST_DATABASE_URL is not set in .env.test!${NC}"
    echo "Add this line to .env.test:"
    echo '  TEST_DATABASE_URL="postgresql://piptip_test:test_password_change_in_production@localhost:5433/piptip_test?schema=public"'
    exit 1
fi

echo -e "${GREEN}✅ Test environment loaded${NC}"
echo "   DATABASE_URL: ${DATABASE_URL}"
echo ""

# Start Docker containers
echo -e "${YELLOW}🐳 Starting test database containers...${NC}"
docker-compose -f docker-compose.test.yml up -d

# Wait for PostgreSQL to be ready
echo -e "${YELLOW}⏳ Waiting for PostgreSQL to be ready...${NC}"
max_attempts=30
attempt=0

while ! docker exec piptip-test-db pg_isready -U piptip_test -d piptip_test > /dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ $attempt -ge $max_attempts ]; then
        echo -e "${RED}❌ PostgreSQL failed to start within 30 seconds${NC}"
        docker-compose -f docker-compose.test.yml logs postgres-test
        exit 1
    fi
    echo -n "."
    sleep 1
done

echo ""
echo -e "${GREEN}✅ PostgreSQL is ready${NC}"
echo ""

# Push schema to test database (skip migrations which may be incomplete)
echo -e "${YELLOW}🔄 Pushing Prisma schema to test database...${NC}"
DATABASE_URL="$TEST_DATABASE_URL" npx prisma db push --accept-data-loss --skip-generate

echo ""
echo -e "${GREEN}✅ Migrations applied successfully${NC}"
echo ""

# Generate Prisma client
echo -e "${YELLOW}⚙️  Generating Prisma client...${NC}"
npx prisma generate

echo ""
echo -e "${GREEN}✅ Prisma client generated${NC}"
echo ""

# Verify database connectivity
echo -e "${YELLOW}🔍 Verifying database connectivity...${NC}"
if DATABASE_URL="$TEST_DATABASE_URL" npx prisma db execute --stdin <<< "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Database connection verified${NC}"
else
    echo -e "${YELLOW}⚠️  Prisma connection test failed, but database may still be working${NC}"
    echo -e "${YELLOW}   Checking with direct docker connection...${NC}"
    if docker exec piptip-test-db psql -U piptip_test -d piptip_test -c "SELECT 1;" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Database is accessible via Docker${NC}"
    else
        echo -e "${RED}❌ Failed to connect to test database${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}✅ Test database setup complete!${NC}"
echo ""
echo "You can now run tests with:"
echo "  npm run test:markets-integration"
echo "  npm run validate:markets-migration"
echo "  npm run test:tournament-tpip"
echo ""
echo "To stop the test database:"
echo "  docker-compose -f docker-compose.test.yml down"
echo ""
