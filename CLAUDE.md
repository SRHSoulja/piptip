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