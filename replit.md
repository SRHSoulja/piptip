# PIPTip Discord Bot - Replit Setup

## Project Overview
PIPTip is a Discord tipping bot for the Abstract Chain, built with TypeScript, Discord.js, Express, and Prisma. It allows users to send Penguin, Ice, and Pebble tokens directly in Discord servers.

## Recent Changes (September 19, 2025)
- Successfully imported from GitHub repository
- Configured PostgreSQL database with Prisma migrations
- Set up web server to run on port 5000 (required for Replit)
- Fixed TypeScript dependencies and compilation errors
- Configured workflow for automatic startup

## Project Architecture
- **Backend**: Node.js with TypeScript, Express web server
- **Database**: PostgreSQL with Prisma ORM
- **Discord Integration**: Discord.js for bot functionality
- **Blockchain**: Ethers.js for Abstract Chain integration
- **Web Interface**: Admin panel and PenguBook social features

## User Configuration Required

### Discord Bot Setup
The following secrets need to be added via Replit's secrets manager:
- `DISCORD_TOKEN` - Your Discord bot token
- `DISCORD_CLIENT_ID` - Your Discord application client ID
- `GUILD_ID` - Your primary Discord server ID (optional, for testing)

### Abstract Chain Configuration
- `ABSTRACT_RPC_URL` - Abstract Chain RPC endpoint
- `TREASURY_AGW_ADDRESS` - Treasury wallet address
- `AGW_SESSION_PRIVATE_KEY` - Private key for transactions

### Token Addresses
- `TOKEN_ADDRESS` - Main token contract address
- `PENGUIN_TOKEN_ADDRESS` - Penguin token contract
- `ICE_TOKEN_ADDRESS` - Ice token contract  
- `PEBBLE_TOKEN_ADDRESS` - Pebble token contract

### Admin Configuration
- `ADMIN_SECRET` - Admin authentication token
- `INTERNAL_BEARER` - Internal API authentication

## Getting Started
1. Add the required secrets via Replit's secrets manager
2. The database is already configured and migrations have been run
3. The bot will start automatically when all required environment variables are set
4. Visit the web interface at your Replit URL to access admin features

## Key Features
- Slash commands for user registration, wallet linking, tipping
- Group tip functionality with expiry timers
- Profile system with PenguBook social features
- Admin panel for bot management
- Achievement system and leaderboards
- Withdrawal limits and security features

## Current Status
- ✅ Database: Configured and migrated
- ✅ Dependencies: Installed and compiled
- ✅ Port Configuration: Set to 5000 for Replit
- ⏳ Discord Integration: Waiting for bot tokens
- ⏳ Blockchain Integration: Waiting for chain configuration

## Next Steps
1. Configure Discord bot tokens in secrets
2. Set up Abstract Chain configuration
3. Test bot functionality in a Discord server
4. Configure admin access and token addresses

## File Structure
- `src/commands/` - Discord slash commands
- `src/web/` - Express web routes and admin panel
- `src/services/` - Core business logic
- `prisma/` - Database schema and migrations
- `docs/` - Additional documentation