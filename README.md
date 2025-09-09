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
- Slash commands for onboarding and tipping (`/pip_start`, `/pip_register`, `/pip_tip`, etc.)
- Wallet linking + on-chain deposit/withdraw flow (`/pip_link`, `/pip_deposit`, `/pip_withdraw`)
- Profile view (`/pip_profile`)
- Group tip helpers & expiry logic (internal)

> Commands come from the files in `src/commands/` of this repo.

---

## 🛠️ Commands
| Command | What it does |
|---|---|
| `/pip_start` | Initialize your PIPTip profile |
| `/pip_register` | Register your account |
| `/pip_link` | Link your Abstract wallet |
| `/pip_deposit` | Deposit tokens into your bot balance |
| `/pip_withdraw` | Withdraw tokens back to your wallet |
| `/pip_tip` | Tip a user (supports group tip helpers internally) |
| `/pip_profile` | View your balances/profile |

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

## 🤝 Contributing
Pull requests welcome! Open an issue to discuss bigger changes.  

---

## 📜 License
MIT
