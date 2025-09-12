# PIPTip Bot Deployment Checklist

## 🚨 CRITICAL NOTES
- **TypeScript Build Issues**: The project has TypeScript null-safety errors that prevent `npm run build`. However, the bot runs fine in development mode using `tsx`.
- **Production Deployment**: Use `tsx` for production instead of compiled TypeScript until type issues are resolved.

## 📋 Pre-Deployment Checklist

### 1. Server Requirements
- [ ] **Node.js**: Version 18.x or higher installed
- [ ] **npm**: Latest version
- [ ] **PM2**: `npm install -g pm2` (process manager)
- [ ] **PostgreSQL**: Database server running and accessible
- [ ] **Git**: For cloning repository (optional if using file transfer)

### 2. Environment Setup
- [ ] Create project directory on server (e.g., `/var/www/piptip`)
- [ ] Ensure proper permissions for the application user
- [ ] Firewall configured to allow necessary ports

## 📁 Files to Transfer via WinSCP

### Required Files and Directories:
```
📁 Project Root/
├── 📁 src/                    ✅ REQUIRED - All source code
├── 📁 prisma/                 ✅ REQUIRED - Database schema & migrations
├── 📁 node_modules/           ❌ SKIP - Install fresh on server
├── 📁 dist/                   ❌ SKIP - TypeScript build (has errors)
├── 📁 backups/                🔶 OPTIONAL - Previous backups
├── 📄 package.json            ✅ REQUIRED - Dependencies & scripts
├── 📄 package-lock.json       ✅ REQUIRED - Exact dependency versions
├── 📄 tsconfig.json           ✅ REQUIRED - TypeScript configuration
├── 📄 .env                    ✅ REQUIRED - Environment variables
├── 📄 CLAUDE.md               🔶 OPTIONAL - Development notes
├── 📄 README.md               🔶 OPTIONAL - Documentation
└── 📄 DEPLOYMENT_CHECKLIST.md 🔶 OPTIONAL - This checklist
```

### Files to EXCLUDE from transfer:
- `node_modules/` - Will be installed fresh
- `dist/` - Has TypeScript compilation errors
- `.git/` - Source control (unless needed)
- `backups/` - Only if you want historical backups

## 🔧 Environment Variables (.env file)

Create/update `.env` file on server with these required variables:

```bash
# Discord Configuration
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_id
GUILD_ID=your_discord_server_id

# Database
DATABASE_URL="postgresql://username:password@localhost:5432/piptip"

# Abstract Chain Configuration
ABSTRACT_RPC_URL=https://api.testnet.abs.xyz
ABSTRACT_CHAIN_ID=2741
TREASURY_AGW_ADDRESS=0xYourTreasuryAddress
AGW_SESSION_PRIVATE_KEY=0xYourPrivateKey

# Token Configuration
TOKEN_ADDRESS=0xYourTokenAddress
TOKEN_DECIMALS=18

# Fee Configuration (in basis points, 100 = 1%)
HOUSE_FEE_BPS=200
TIP_FEE_BPS=100

# Admin & Security
ADMIN_SECRET=your_secure_admin_password
ADMIN_BEARER=your_admin_bearer_token
INTERNAL_BEARER=your_internal_api_bearer

# Server Configuration
PORT=3000
NODE_ENV=production

# Optional
BACKUP_DIR=./backups
```

## 🗄️ Database Setup

### PostgreSQL Database Setup:
```sql
-- 1. Create database
CREATE DATABASE piptip;

-- 2. Create user (optional, or use existing)
CREATE USER piptip_user WITH ENCRYPTED PASSWORD 'secure_password';

-- 3. Grant permissions
GRANT ALL PRIVILEGES ON DATABASE piptip TO piptip_user;
```

### Database Migration Commands:
```bash
# After files are transferred and dependencies installed:
npx prisma db push          # Apply schema to database
npx prisma generate         # Generate Prisma client
```

## 📦 Server Installation Steps

### Step 1: Transfer Files
1. Use WinSCP to transfer required files to server
2. Connect to server directory (e.g., `/var/www/piptip`)
3. Upload files as listed in "Files to Transfer" section

### Step 2: Install Dependencies
```bash
cd /var/www/piptip
npm ci                      # Install exact package versions
npx prisma generate         # Generate Prisma client
```

### Step 3: Database Setup
```bash
# Apply database schema
npx prisma db push

# Optional: Seed initial data if needed
# npm run seed (if you have seeding scripts)
```

### Step 4: Test Installation
```bash
# Test that the app starts
npm run dev

# Should see:
# - "Database connected"
# - "Bot logged in as PIPtip#XXXX"
# - "Web server running on port 3000"
# - "Commands registered"
```

## 🔄 PM2 Production Setup

### PM2 Configuration File (ecosystem.config.js):
Create this file in your project root:

```javascript
module.exports = {
  apps: [{
    name: 'piptip-bot',
    script: 'src/index.ts',
    interpreter: 'npx',
    interpreter_args: 'tsx',
    cwd: '/var/www/piptip',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000
  }]
};
```

### PM2 Commands:
```bash
# Create logs directory
mkdir -p logs

# Start the application
pm2 start ecosystem.config.js

# Check status
pm2 status

# View logs
pm2 logs piptip-bot

# Stop the application
pm2 stop piptip-bot

# Restart the application
pm2 restart piptip-bot

# Delete the application
pm2 delete piptip-bot

# Save PM2 configuration for system restart
pm2 save
pm2 startup
```

## 🌐 Web Server Setup (Optional)

If you want to serve the admin interface through your existing PHP server:

### Nginx Reverse Proxy Configuration:
```nginx
location /piptip/ {
    proxy_pass http://localhost:3000/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
}
```

### Apache Reverse Proxy Configuration:
```apache
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so

<Location "/piptip">
    ProxyPass "http://localhost:3000/"
    ProxyPassReverse "http://localhost:3000/"
    ProxyPreserveHost On
</Location>
```

## 🔍 Post-Deployment Testing

### 1. Discord Bot Tests:
- [ ] Bot appears online in Discord server
- [ ] `/pip_profile` command works
- [ ] `/pip_help` command shows updated commands
- [ ] Admin interface accessible at `http://your-server:3000/admin`

### 2. Database Tests:
- [ ] Database connection successful
- [ ] User registration works
- [ ] Transactions are being logged

### 3. Web Interface Tests:
- [ ] Admin panel loads at `http://server:3000/admin`
- [ ] Admin authentication works
- [ ] User management functions work

## 🚨 Troubleshooting

### Common Issues:

1. **"Cannot find module" errors**
   ```bash
   npm ci
   npx prisma generate
   ```

2. **Database connection failures**
   - Check DATABASE_URL in .env
   - Verify PostgreSQL is running
   - Check firewall/network access

3. **Discord bot not responding**
   - Verify DISCORD_TOKEN is correct
   - Check bot permissions in Discord server
   - Confirm GUILD_ID matches your Discord server

4. **PM2 application crashes**
   ```bash
   pm2 logs piptip-bot  # Check error logs
   pm2 restart piptip-bot
   ```

5. **Port already in use**
   ```bash
   # Find process using port 3000
   lsof -i :3000
   # Kill the process or change PORT in .env
   ```

## 📊 Monitoring & Maintenance

### Log Monitoring:
```bash
# Real-time logs
pm2 logs piptip-bot --lines 100

# Check process status
pm2 monit

# Restart if needed
pm2 restart piptip-bot
```

### Backup Strategy:
- Database backups are automated (hourly via built-in backup service)
- Monitor backup directory: `./backups/`
- Regular database dumps recommended

### Updates:
```bash
# Pull latest code (if using git)
git pull origin main

# Install new dependencies
npm ci

# Apply database changes
npx prisma db push

# Restart application
pm2 restart piptip-bot
```

---

## ✅ Quick Deployment Summary

1. **Transfer files** via WinSCP (exclude node_modules, dist)
2. **Install dependencies**: `npm ci && npx prisma generate`
3. **Setup database**: `npx prisma db push`
4. **Configure .env** with your production values
5. **Create PM2 config** and logs directory
6. **Start with PM2**: `pm2 start ecosystem.config.js`
7. **Save PM2 config**: `pm2 save && pm2 startup`
8. **Test functionality** (Discord bot, admin panel)

**Note**: Due to TypeScript compilation errors, we're using `tsx` (TypeScript executor) instead of pre-compiled JavaScript. This works reliably in production.