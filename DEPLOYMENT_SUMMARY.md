# 🚀 PIPTip Bot - Quick Deployment Guide

## 📁 Files to Transfer via WinSCP

### ✅ REQUIRED FILES:
```
📁 src/                 - All source code
📁 prisma/             - Database schema
📄 package.json        - Dependencies
📄 package-lock.json   - Lock file
📄 tsconfig.json       - TypeScript config
📄 .env                - Environment variables
📄 ecosystem.config.js - PM2 configuration
📄 deploy.sh          - Deployment script
```

### ❌ SKIP THESE:
```
📁 node_modules/       - Install fresh on server
📁 dist/              - Has TypeScript errors
📁 .git/              - Not needed for production
```

## ⚡ Quick Setup Commands

```bash
# 1. Transfer files to server via WinSCP

# 2. Install dependencies
cd /var/www/piptip
npm ci
npx prisma generate

# 3. Setup database
npx prisma db push

# 4. Start with PM2
npm install -g pm2
mkdir logs
pm2 start ecosystem.config.js

# 5. Save PM2 config
pm2 save
pm2 startup
```

## 🔧 Environment Variables (.env)

```bash
# Discord
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
GUILD_ID=your_server_id

# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/piptip"

# Blockchain
ABSTRACT_RPC_URL=https://api.testnet.abs.xyz
TREASURY_AGW_ADDRESS=0xYourAddress
AGW_SESSION_PRIVATE_KEY=0xYourKey
TOKEN_ADDRESS=0xYourTokenAddress

# Admin
ADMIN_SECRET=your_admin_password
ADMIN_BEARER=your_bearer_token

# Optional
PORT=3000
NODE_ENV=production
```

## 🎯 Testing Checklist

- [ ] Bot appears online in Discord
- [ ] `/pip_profile` command works
- [ ] Admin panel: `http://server:3000/admin`
- [ ] PM2 status: `pm2 status`
- [ ] Check logs: `pm2 logs piptip-bot`

## 🚨 Important Notes

1. **Use `tsx` not compiled TypeScript** (due to type errors)
2. **PostgreSQL required** for database
3. **Environment variables must be set** before starting
4. **PM2 auto-restarts** on crashes/reboots

## 🔗 Key URLs

- Admin Interface: `http://your-server:3000/admin`
- Health Check: `http://your-server:3000/health`

---

*For detailed instructions, see `DEPLOYMENT_CHECKLIST.md`*