# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Development**: `npm run dev` - Start bot and web server with tsx
- **Build**: `npm run build` - Compile TypeScript to dist/
- **Production**: `npm start` - Run compiled application
- **Database**: `npx prisma migrate dev` - Apply schema migrations
- **Schema push**: `npm run prisma:push` - Push schema without migrations

## Production Readiness & Validation

- **Full Validation**: `npx tsx scripts/deployment_validation.ts` - Comprehensive deployment readiness check
- **Environment Check**: `npx tsx src/services/env_validator.ts` - Validate all required environment variables
- **Database Integrity**: `npx tsx scripts/db_integrity_check.ts` - Run database integrity validation
- **Smoke Tests**: `npx tsx scripts/smoke_tests.ts` - End-to-end production validation
- **Test Import Check**: `node scripts/check-test-imports.cjs` - Ensure no test code in production

## Database Synchronization & Management

- **Sync Validation**: `npx tsx scripts/sync_validation.ts` - Validate Supabase-Prisma synchronization
- **Deployment Sync**: `npx tsx scripts/deployment_sync.ts [pre|migrate|post|rollback]` - Deployment-safe migrations
- **Grand Reset**: `npx tsx scripts/grand_reset.ts` - Wipe all user/financial data for fresh starts
- **Init Config**: `npx tsx scripts/init_app_config.ts` - Initialize AppConfig with emergency controls
- **Auto-Fix Sync**: Set `AUTO_FIX_SYNC=true` environment variable for automatic sync repair

## Network & Database Switching

- **Test Database Switching**: `npx tsx scripts/test_database_switching.ts` - Test automatic database switching between networks
- **Network Configuration**: Set `NETWORK=testnet` or `NETWORK=mainnet` to switch RPC, chain ID, and database
- **Database Isolation**: Set `TEST_DATABASE_URL` for testnet data isolation from production database
- **Setup Instructions**:
  1. Create test database: `CREATE DATABASE piptip_test;`
  2. Set `TEST_DATABASE_URL` in `.env` file
  3. Run migrations on test DB: `NETWORK=testnet npx prisma migrate deploy`

## Contract Deployment

- **Registry Contract**: `contracts/MerkleRegistry.sol` - Solidity contract for storing merkle tree snapshots
- **Deploy Instructions**: `NETWORK=testnet npx tsx scripts/deploy_registry.ts` - Deploy registry to Abstract testnet
- **Contract Setup**:
  1. Compile contract with Hardhat/Foundry
  2. Deploy to testnet with sufficient ETH balance
  3. Set `TESTNET_REGISTRY_CONTRACT_ADDRESS` in `.env`
  4. Test with: `npx tsx scripts/test_merkle_publisher.ts publish`

## Achievement System Management

### Dynamic Achievement System
- **Seed Achievements**: `npx tsx scripts/seed_dynamic_achievements.ts` - Initialize dynamic achievement definitions with responsive gaming mechanics
- **Schema Validation**: `npx tsx scripts/validate_achievement_schema.ts` - Validate achievement system database requirements
- **Production Readiness**: `npx tsx scripts/production_readiness_check.ts` - Comprehensive production validation

### Admin Operations
- **Admin Panel**: Access dynamic achievement management at `/admin/achievements` endpoint
- **Manual Controls**: Grant, revoke, reset progress, and bulk operations via API
- **Real-time Monitoring**: WebSocket dashboard for live achievement tracking at `/admin/achievements` namespace
- **Emergency Controls**: Global enable/disable via AppConfig (`achievementsEnabled`, `streakProtectionEnabled`)

## Deployment

- **CI/CD**: Automated deployment via GitHub Actions on push to main branch
- **Manual**: Follow procedures in `DEPLOYMENT_RUNBOOK.md`
- **Environment**: Use `.env.example` as template for production environment setup

## Architecture

PIPTip is a Discord tipping bot for Abstract Chain tokens (Penguin, Ice, Pebble) with integrated web admin interface.

### Core Components

**Discord Bot** (`src/index.ts`): Main entry point with auto-ack wrapper for interactions, guild allowlist enforcement, and command routing.

**Commands** (`src/commands/`): Slash commands prefixed with `pip_` for user onboarding, wallet linking, deposits, withdrawals, tipping, and profile management.

**Web Interface** (`src/web/`): Express routes for health checks, internal APIs, and admin dashboard at separate endpoints.

**Services Layer** (`src/services/`): Business logic including database operations, blockchain treasury management, token handling, and notification system.

**Database Models**: Prisma schema with Users (Discord + wallet linking), Tokens (multi-token support), Balances, Tips, GroupTips (expiring tip pools), Matches (gaming), and TierMembership (premium subscriptions).

### Key Patterns

- Guild-based allowlist system via ApprovedServer model
- Auto-defer wrapper prevents Discord 3-second timeout
- Token autocomplete for user-friendly command interaction  
- Notification queue system with ephemeral delivery
- Group tip expiry management with timer restoration on startup
- Treasury service handles on-chain deposits/withdrawals via Abstract Chain

### Environment Setup

Requires extensive `.env` configuration including Discord credentials, PostgreSQL database URL, Abstract Chain RPC settings, token addresses, fee configurations, and admin secrets. Use `.env.example` as template and run `npx tsx scripts/env_validator.ts` to validate configuration.

## Production Security

### Secret Management
- **Log Scrubbing**: `src/services/log_scrubber.ts` automatically scrubs sensitive data from logs
- **Environment Validation**: Required vs optional variables clearly defined and validated
- **Admin Protection**: Bearer token authentication on admin and internal API routes
- **Secret Detection**: Automated detection prevents secrets from leaking into logs

### Code Quality
- **Build Guards**: CI/CD prevents test imports from reaching production (`scripts/check-test-imports.cjs`)
- **Type Safety**: Comprehensive TypeScript validation with `--noEmit --pretty false`
- **Database Integrity**: Automated validation of data consistency and constraints

### Deployment Safety
- **Health Checks**: 3-second timeout health validation with retry logic
- **Automated Rollback**: CI/CD automatically reverts on health check failure
- **Smoke Testing**: End-to-end validation of critical functionality post-deployment
- **Migration Validation**: Database schema consistency verification before deployment

## Session Management & OAuth (Railway Deployment)

### Critical Configuration for Railway
- **Trust Proxy**: `app.set('trust proxy', 1)` is ESSENTIAL for Railway deployment
- **PostgreSQL Sessions**: Use `connect-pg-simple` for persistent session storage (Railway doesn't have managed Redis)
- **Cookie Settings**: `sameSite: 'lax'` and `secure: true` with trust proxy enabled
- **Relative Redirects**: Use relative paths `/pengubook` instead of full URLs to preserve cookies

### OAuth Authentication Flow
- **Session Persistence Issue**: Without trust proxy, secure cookies fail on Railway's HTTPS termination
- **Debug Indicators**: Check for `cookies: []` in auth logs - indicates cookie delivery failure
- **Session Store**: PostgreSQL session table auto-created by `connect-pg-simple`
- **Route Order**: Session middleware MUST be configured before session-dependent routes (admin, auth, pengubook)

### Key Files
- `src/index.ts`: Session middleware configuration and trust proxy setup
- `src/web/auth.ts`: OAuth callback handling and session storage
- PostgreSQL `session` table: Automatically managed by connect-pg-simple

### Troubleshooting OAuth Loops
1. Check if `cookies: []` appears in auth check logs
2. Verify trust proxy is enabled: Look for "✅ Trust proxy enabled for production"
3. Confirm PostgreSQL session store: "✅ PostgreSQL session store configured"
4. Ensure routes load after sessions: "✅ Session-dependent routes configured"
5. Session ID should remain consistent between OAuth callback and redirect