# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Development**: `npm run dev` - Start bot and web server with tsx
- **Build**: `npm run build` - Compile TypeScript to dist/
- **Production**: `npm start` - Run compiled application
- **Database**: `npx prisma migrate dev` - Apply schema migrations
- **Schema push**: `npm run prisma:push` - Push schema without migrations

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

Requires extensive `.env` configuration including Discord credentials, PostgreSQL database URL, Abstract Chain RPC settings, token addresses, fee configurations, and admin secrets. See README.md for complete environment variable list.