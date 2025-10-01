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

### Railway Build Cache Issues (CRITICAL)

**Problem**: Railway may deploy stale compiled JavaScript from cached `dist/` directory even after pushing new TypeScript changes.

**Symptoms**:
- New console.log statements don't appear in production logs
- Code changes don't take effect despite "Deployment successful" messages
- Version markers added to code don't show up in logs
- Fixes appear to work locally but not in production

**Verification Method**:
Always add version markers when making critical fixes to verify deployment:
```typescript
console.log('🚀 PIPTip v2.X.X - [description of fix]');
```

**Solutions**:
1. **Force rebuild** (nuclear option): Delete `dist/` directory and commit
   ```bash
   rm -rf dist/ && git add -A && git commit -m "Force Railway rebuild" && git push
   ```
2. **Railway dashboard**: Use "Redeploy" with "Clear build cache" option if available
3. **Verify deployment**: Always check logs for version markers before assuming fix worked

**Important**: Railway showing "Deployment successful" does NOT guarantee your code changes are running. The build cache can serve old compiled code. Always verify with log markers or by testing the actual functionality.

**Root Cause**: Railway's build process compiles TypeScript to `dist/` using `npm run build`. If the build cache isn't properly invalidated, Railway deploys cached compiled JavaScript instead of rebuilding from new source.

## Architecture

PIPTip (Penguin Ice Pebble Tip Bot) is a Discord tipping bot for Abstract Chain with multi-token support. The name comes from the rock-paper-scissors style game: Penguin beats Ice, Ice beats Pebble, Pebble beats Penguin. Users can tip each other, play matches, participate in prediction markets, and more.

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

## Multi-Token Economy

PIPTip supports multiple ERC-20 tokens on Abstract Chain:
- **Token Management**: Tokens stored in `Token` table with address, symbol, decimals, and active status
- **Balance System**: Per-user, per-token balances in `UserBalance` table with atomic precision
- **Token Operations**: All financial operations (tips, deposits, withdrawals, matches) support multi-token
- **Admin Controls**: Tokens can be added/removed via admin panel at `/admin/ui`
- **Minimum Amounts**: Each token has configurable `minDeposit` and `minWithdraw` thresholds

### Adding New Tokens
1. Admin panel: Enter token address at `/admin/ui` → Tokens section
2. System fetches metadata (symbol, decimals) from blockchain via Alchemy
3. Configure minimums and fee percentages
4. Token appears in all user-facing commands with autocomplete

## CSRF Protection

Admin panel and state-changing endpoints use CSRF protection with session binding:
- **Token Generation**: HMAC-based tokens bound to session ID and user ID
- **Double Submit Cookie**: Enhanced security with cookie + header validation
- **Bearer Auth Bypass**: Admin endpoints with Bearer token skip CSRF (bearer tokens prevent CSRF)
- **Whitelisted Paths**: Auth endpoints and certain system endpoints skip CSRF validation
- **Service File**: `src/services/csrf_protection.ts`

### CSRF Exemptions
Endpoints that skip CSRF validation:
- `/auth/login`, `/auth/mfa/initiate`, `/auth/mfa/verify` - Auth flow
- `/ping` - Health check
- `/system/grand-reset` - Protected by bearer auth
- All admin endpoints with valid Bearer token in Authorization header

## Database Connection Management

### Supabase Pooler Configuration
- **Pooler Mode**: Transaction pooler (port 6543) for prepared statement compatibility
- **Connection String**: `postgresql://[user]:[password]@[host]:6543/[database]?pgbouncer=true&connection_limit=5`
- **Retry Logic**: Exponential backoff with 3 retries in `src/services/db.ts`
- **Keepalive Queries**: Periodic `SELECT 1` to maintain connection
- **Session Store**: Limited to 3 connections to stay under 60 connection limit on Supabase Free tier

### Network Switching
- **Testnet**: Set `NETWORK=testnet` + `TEST_DATABASE_URL` for isolated test database
- **Mainnet**: Set `NETWORK=mainnet` + standard `DATABASE_URL`
- **Automatic Switching**: Database URL switches based on NETWORK environment variable
- **Safety**: Test database prevents accidental production data corruption during testing

## Common Issues & Solutions

### Discord Command Timeouts
**Problem**: Commands fail with "Unknown interaction" or "Interaction already acknowledged"
**Cause**: Command processing takes >3 seconds before deferring
**Solution**:
- Use `withAutoChannelCheck` wrapper for automatic deferral
- Pre-warm caches at startup (e.g., guild settings cache in `src/index.ts`)
- Defer interaction BEFORE doing slow operations (DB queries, API calls)

### Profile Command Slow Performance
**Problem**: `/pip_profile` times out on first use
**Solution**: Guild settings cache warming at bot startup prevents first-use delay

### Social Leaderboard Performance
**Problem**: Leaderboard fails for many users with database errors
**Cause**: Too many users being processed with complex queries
**Solution**: Limited to 150 users max in `src/services/social_leaderboards.ts`
**Circuit Breaker**: Stops processing if database connection fails

### Prediction Market Auto-Resolution Failures
**Problem**: Markets fail to resolve with "not API-guaranteed" errors
**Cause**: Market created without `apiGuaranteed: true` flag or missing template metadata
**Solution**:
- All crypto markets MUST be created via automation scheduler
- Manual market creation blocked for crypto market types in admin panel
- Validation at startup: `src/services/crypto_market_validator.ts`
- Only markets with `apiGuaranteed: true` can auto-resolve