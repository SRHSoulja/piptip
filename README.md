# PIPTip 🤖🐧

Discord tipping bot for the **Abstract Chain** — built for sending **Penguin**, **Ice**, and **Pebble** right inside your server.

---

## ⚡ Quickstart in 60 Seconds
    git clone https://github.com/SRHSoulja/piptip.git
    cd piptip
    npm install
    cp .env.example .env   # configure your token + database
    npx prisma migrate dev
    npm run dev

---

## ✨ Features (current)
- Slash commands for onboarding and tipping (`/pip_register`, `/pip_tip`, `/pip_game`, etc.)
- Wallet linking + on-chain deposit/withdraw flow (`/pip_link`, `/pip_deposit`, `/pip_withdraw`)
- Profile view (`/pip_profile`)
- Group tip helpers & expiry logic (internal)

> Commands come from the files in `src/commands/` of this repo.

---

## 🛠️ Commands
| Command | What it does |
|---|---|
| `/pip_register` | 🎯 Create your PIPTip account and profile |
| `/pip_link` | 🔗 Connect your Abstract wallet for deposits and withdrawals |
| `/pip_deposit` | 💰 Get instructions to add funds to your account |
| `/pip_withdraw` | 💸 Send your tokens to your linked wallet |
| `/pip_tip` | 💸 Send tips (direct to user or group tip for everyone) |
| `/pip_game` | 🎮 Challenge others to Penguin Ice Pebble - rock-paper-scissors style! |
| `/pip_profile` | 👤 View your balance, stats, and account details |
| `/pip_help` | 📚 Complete guide on how to use PIPTip bot |

---

## 🚀 Getting Started

### 1) Clone & install
    git clone https://github.com/SRHSoulja/piptip.git
    cd piptip
    npm install

### 2) Environment
Create a `.env` file in the root with your settings:

    # Database
    DATABASE_URL="file:./prisma/dev.db"
    # DATABASE_URL="postgresql://postgres:password@host:5432/postgres"

    # Discord Bot
    DISCORD_TOKEN=add_here
    DISCORD_CLIENT_ID=add_here
    GUILD_ID=add_here

    # Web server
    PUBLIC_BASE_URL=http://localhost:3000
    PORT=3000
    SESSION_SECRET=add_here

    # Abstract chain
    ABSTRACT_RPC_URL="https://abstract-mainnet.g.alchemy.com/v2/add_here"
    ABSTRACT_CHAIN_ID=2741
    TREASURY_AGW_ADDRESS=add_here
    AGW_SESSION_PRIVATE_KEY=add_here

    # Token settings
    TOKEN_ADDRESS=add_here
    TOKEN_DECIMALS=18
    HOUSE_FEE_BPS=200
    TIP_FEE_BPS=100

    # Internal auth
    INTERNAL_BEARER=add_here
    ADMIN_SECRET=add_here

    # Withdraw settings
    WITHDRAW_MAX_PER_TX=50
    WITHDRAW_DAILY_CAP=500


### 3) Prisma
Run database migrations:

    npx prisma migrate dev

### 4) Run the bot
Start the development server:

    npm run dev

---

## 🧱 Tech
- TypeScript  
- discord.js  
- Prisma + PostgreSQL  
- Express  

---

## 🚀 Mainnet Launch

PIPTip is production-ready for deployment to Abstract mainnet with comprehensive safety measures and monitoring.

### Quick Launch Guide
- **Summary**: See [MAINNET_LAUNCH_SUMMARY.md](docs/MAINNET_LAUNCH_SUMMARY.md) for one-page deployment guide
- **Full Plan**: See [MAINNET_LAUNCH_PLAN.md](docs/MAINNET_LAUNCH_PLAN.md) for complete battle plan

### Key Commands
```bash
# Dry run validation (NO GAS)
npm run dryrun:mainnet

# Deploy to mainnet (USES GAS - requires --confirm-mainnet)
npm run deploy:mainnet

# Publish first snapshot (USES GAS - requires --confirm-mainnet)
npm run publish:mainnet

# Monitor system health (NO GAS)
npm run health
```

### Safety Features
- ✅ Multi-layer safety checks prevent accidental mainnet operations
- ✅ All commands are gas-free unless explicitly confirmed with `--confirm-mainnet`
- ✅ Comprehensive rollback procedures and circuit breakers
- ✅ Real-time monitoring and alerting systems

---

## 🤝 Contributing
Pull requests welcome! Open an issue to discuss bigger changes.

---

## 📜 License
MIT
