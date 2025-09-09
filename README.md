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

    DISCORD_TOKEN=your-bot-token
    DATABASE_URL=postgresql://user:pass@host:5432/dbname

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
