# Test Database Setup - Isolated Testing Environment

## Overview

All tests (market migration, prediction flow, TPIP, stress tests) run against a **dedicated test database** that is completely isolated from production. This prevents:

- ❌ Accidental production database modifications
- ❌ Schema conflicts between test and production
- ❌ Data corruption from test execution
- ❌ Missing model errors (`PredictionBet`, `Tournament undefined`)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

This installs `dotenv-cli` which is required for loading `.env.test` in test scripts.

### 2. Start Test Database

```bash
npm run test:setup
```

This command:
- Starts PostgreSQL test database on port **5433** (not 5432)
- Starts Redis test instance on port **6380** (not 6379)
- Runs Prisma migrations on test database
- Generates Prisma client
- Verifies database connectivity

### 3. Run Tests

```bash
# Markets migration validation
npm run validate:markets-migration

# Integration tests
npm run test:markets-integration

# Tournament TPIP tests
npm run test:tournament-tpip

# Prediction flow tests
npm run test:prediction-flow

# All tests
npm run test:rake
```

## Architecture

### Test Database (PostgreSQL)

**Port:** 5433 (isolated from production on 5432)
**Container:** `piptip-test-db`
**Database:** `piptip_test`
**User:** `piptip_test`

### Test Redis

**Port:** 6380 (isolated from production on 6379)
**Container:** `piptip-test-redis`

### Environment Files

**.env.test** - Test environment configuration
- `TEST_DATABASE_URL` - Points to localhost:5433
- `DATABASE_URL` - Set to match TEST_DATABASE_URL
- `REDIS_URL` - Points to localhost:6380
- `NODE_ENV=test`
- `NETWORK=testnet`

## Commands Reference

### Setup & Management

```bash
# Full setup (start DB + run migrations)
npm run test:setup

# Start test database containers
npm run test:db:start

# Stop test database containers
npm run test:db:stop

# Reset test database (delete all data and restart)
npm run test:db:reset

# Run migrations on test database
npm run test:migrate
```

### Test Execution

All test scripts automatically use `.env.test` via `dotenv-cli`:

```bash
# Markets migration validation
npm run validate:markets-migration

# Markets integration tests
npm run test:markets-integration

# Tournament TPIP tests
npm run test:tournament-tpip

# Tournament entry tests
npm run test:tournament-entry

# Prediction flow tests
npm run test:prediction-flow

# Match integration tests
npm run test:match-integration

# Transaction log tests
npm run test:transaction-integration

# TPIP validation
npm run validate:tpip
```

### Manual Docker Commands

```bash
# Start containers
docker-compose -f docker-compose.test.yml up -d

# View logs
docker-compose -f docker-compose.test.yml logs -f

# Stop containers
docker-compose -f docker-compose.test.yml down

# Stop and remove volumes (full reset)
docker-compose -f docker-compose.test.yml down -v

# Check container status
docker ps | grep piptip-test
```

### Database Access

```bash
# Connect to test database
docker exec -it piptip-test-db psql -U piptip_test -d piptip_test

# Run SQL query
docker exec piptip-test-db psql -U piptip_test -d piptip_test -c "SELECT COUNT(*) FROM \"PredictionMarket\";"

# View tables
docker exec piptip-test-db psql -U piptip_test -d piptip_test -c "\\dt"
```

## Safety Features

### 1. Test DB Safety Validator

**File:** `src/services/test_db_safety.ts`

**Protections:**
- Throws error if `TEST_DATABASE_URL` is not set
- Validates database is not on port 5432 (production)
- Checks for test database indicators
- Prevents production database access

**Usage:**
```typescript
import { validateTestEnvironment } from './src/services/test_db_safety.js';

// At start of test file
validateTestEnvironment();
```

### 2. Environment Validation

All test scripts use `dotenv -e .env.test` which:
- Forces loading of test environment
- Overrides any conflicting environment variables
- Ensures `NODE_ENV=test` and `NETWORK=testnet`

### 3. Port Isolation

**Test Ports:**
- PostgreSQL: **5433** (not 5432)
- Redis: **6380** (not 6379)

**Production Ports:**
- PostgreSQL: **5432**
- Redis: **6379**

This prevents accidental cross-contamination.

## CI/CD Integration

### GitHub Actions

**File:** `.github/workflows/test-database.yml`

**Features:**
- Spins up PostgreSQL service on port 5433
- Spins up Redis service on port 6380
- Runs migrations automatically
- Executes all test suites
- Validates database isolation

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests
- Manual workflow dispatch

## Troubleshooting

### Test Database Not Starting

**Symptom:** `TEST_DATABASE_URL is not set`

**Fix:**
```bash
# Ensure .env.test exists
cat .env.test

# Start database
npm run test:setup
```

### Port Already in Use

**Symptom:** `port 5433 already allocated`

**Fix:**
```bash
# Check what's using port 5433
lsof -i :5433

# Stop existing test database
docker-compose -f docker-compose.test.yml down

# Restart
npm run test:setup
```

### Missing Models (PredictionBet, Tournament)

**Symptom:** `Cannot read properties of undefined (reading 'findFirst')`

**Fix:**
```bash
# Reset test database and re-run migrations
npm run test:db:reset

# Or manually run migrations
npm run test:migrate
```

### Schema Out of Sync

**Symptom:** Tests fail with schema errors

**Fix:**
```bash
# Reset database completely
npm run test:db:reset

# Or just re-run migrations
npm run test:migrate
```

### Production Database Access Detected

**Symptom:** `SAFETY VIOLATION: Tests cannot run against production database!`

**Fix:**
```bash
# Load test environment
export $(cat .env.test | xargs)

# Verify
echo $DATABASE_URL
# Should show: postgresql://...@localhost:5433/piptip_test

# Run tests
npm run test:markets-integration
```

## Database Schema

The test database contains the **complete production schema** including:

### Core Models
- `User` - User accounts
- `UserBalance` - Token balances (PIPChips, TPIP)
- `Transaction` - Financial transactions
- `BalanceDelta` - Balance change records

### Prediction Markets
- `PredictionMarket` - Market definitions
- `PredictionParticipation` - User bets

### Tournaments
- `TournamentParticipant` - Tournament entries
- `TournamentSession` - Tournament state

### Tokens
- `Token` - Supported tokens

## Best Practices

### 1. Always Use Test Scripts

✅ **Correct:**
```bash
npm run test:markets-integration
```

❌ **Incorrect:**
```bash
NETWORK=testnet npx tsx tests/prediction_markets_integration.test.ts
```

The npm scripts ensure `.env.test` is loaded properly.

### 2. Reset Between Test Runs

If tests are failing unexpectedly:

```bash
npm run test:db:reset
npm run test:markets-integration
```

### 3. Check Database Status

Before running tests:

```bash
# Verify database is running
docker ps | grep piptip-test-db

# Verify connectivity
npm run test:migrate
```

### 4. Clean Up After Testing

```bash
# Stop containers when done
npm run test:db:stop

# Or keep running for faster subsequent tests
# (containers auto-start on next test:setup)
```

## Production Safety Checklist

Before running any tests:

- [x] `TEST_DATABASE_URL` is set in `.env.test`
- [x] Database URL points to **localhost:5433**
- [x] `NODE_ENV=test` or `NETWORK=testnet`
- [x] Test database is running (`docker ps`)
- [x] Migrations are applied (`npm run test:migrate`)
- [x] Using test scripts (`npm run test:*`)

## Files Reference

### Configuration
- `docker-compose.test.yml` - Test database containers
- `.env.test` - Test environment variables
- `.github/workflows/test-database.yml` - CI/CD workflow

### Scripts
- `scripts/setup_test_db.sh` - Complete test DB setup
- `scripts/init_test_db.sql` - Database initialization SQL

### Safety
- `src/services/test_db_safety.ts` - Database safety validator

### Tests
- `tests/prediction_markets_integration.test.ts` - Markets integration
- `tests/tournament_tpip_integration.test.ts` - TPIP tests
- `tests/prediction_market_flow.test.ts` - Prediction flow
- `scripts/validate_markets_migration.ts` - Migration validation

## Status Indicators

When tests run, you'll see:

✅ **Safe:**
```
🔒 Database Configuration Check
✅ TEST_DATABASE_URL: postgresql://piptip_test:...@localhost:5433/...
✅ DATABASE_URL: postgresql://piptip_test:...@localhost:5433/...
```

❌ **Unsafe:**
```
❌ TEST_DATABASE_URL is not set!
🚨 SAFETY VIOLATION: Tests cannot run against production database!
```

## Summary

**Test Database Setup:** 100% isolated from production
**Port Isolation:** 5433 (test) vs 5432 (prod)
**Automatic Migration:** Yes (via `test:setup`)
**CI/CD Integration:** Yes (GitHub Actions)
**Safety Checks:** Built-in validation
**Status:** ✅ Production Ready

All tests now run safely against the isolated test database with complete schema support and zero production risk.
