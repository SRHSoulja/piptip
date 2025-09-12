# PIPTip Environment Variables & Secrets Audit

This document outlines all required environment variables, security best practices, and deployment configurations for PIPTip.

## 🔐 Required Environment Variables

### Discord Configuration
```bash
# Discord Bot Token (REQUIRED)
DISCORD_TOKEN=your_discord_bot_token_here

# Discord Application ID (REQUIRED) 
DISCORD_APPLICATION_ID=your_discord_app_id_here

# Discord webhook for monitoring alerts (OPTIONAL)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### Database Configuration
```bash
# Primary database URL (REQUIRED)
DATABASE_URL="postgresql://user:pass@host:port/database"

# For Supabase with PgBouncer (RECOMMENDED for production)
DATABASE_URL="postgresql://user:pass@host:port/database?pgbouncer=true&connection_limit=1"

# Slow query threshold in milliseconds (OPTIONAL, default: 300)
SLOW_QUERY_THRESHOLD_MS=300
```

### Abstract Chain RPC Configuration
```bash
# Abstract testnet RPC URL (REQUIRED)
ABSTRACT_RPC_URL="https://api.testnet.abs.xyz"

# Private key for treasury operations (REQUIRED)
TREASURY_PRIVATE_KEY="0x..."

# Alternative: Treasury seed phrase (use either private key OR seed)
TREASURY_SEED_PHRASE="word1 word2 ... word12"
```

### Token Contract Addresses
```bash
# Penguin token contract (REQUIRED)
PENGUIN_TOKEN_ADDRESS="0x..."

# Ice token contract (REQUIRED)
ICE_TOKEN_ADDRESS="0x..."

# Pebble token contract (REQUIRED)  
PEBBLE_TOKEN_ADDRESS="0x..."
```

### Fee Configuration
```bash
# Withdrawal fee in basis points (OPTIONAL, default: 25 = 0.25%)
WITHDRAWAL_FEE_BASIS_POINTS=25

# Tip tax in basis points (OPTIONAL, default: 50 = 0.5%)
TIP_TAX_BASIS_POINTS=50

# Group tip tax in basis points (OPTIONAL, default: 100 = 1%)
GROUP_TIP_TAX_BASIS_POINTS=100
```

### Admin Configuration
```bash
# Admin secret for web interface (REQUIRED)
ADMIN_SECRET="your_secure_admin_password"

# Admin Discord user IDs (comma-separated)
ADMIN_DISCORD_IDS="123456789,987654321"

# Admin guild/server IDs where admin commands work (comma-separated)  
ADMIN_GUILD_IDS="1074882281841360926"
```

### Application Configuration
```bash
# HTTP server port (OPTIONAL, default: 3000)
PORT=3000

# Node environment (OPTIONAL, default: development)
NODE_ENV=production

# Git commit SHA for version tracking (AUTO-SET by deploy script)
GIT_SHA=abc123f

# Enable metrics collection (OPTIONAL, default: false in dev)
ENABLE_METRICS=true

# Alert cooldown in seconds (OPTIONAL, default: 60)
ALERT_COOLDOWN_SECONDS=60
```

### Feature Flags
```bash
# Enable/disable major features (OPTIONAL, all default: true)
ENABLE_GROUP_TIPS=true
ENABLE_GAMES=true  
ENABLE_WITHDRAWALS=true
ENABLE_DEPOSITS=true

# Maintenance mode (OPTIONAL, default: false)
MAINTENANCE_MODE=false
```

## 🛡️ Security Best Practices

### Environment File Management
```bash
# ✅ CORRECT: Environment variables on server only
echo "DISCORD_TOKEN=..." >> /opt/piptip/.env

# ❌ WRONG: Never commit .env files
git add .env  # NEVER DO THIS!
```

### Secret Rotation Schedule
- **Discord tokens**: Rotate every 90 days or on security incidents
- **Database passwords**: Rotate every 30 days
- **Treasury private keys**: Rotate every 180 days or on suspicious activity  
- **Admin secrets**: Rotate every 60 days

### GitHub Actions Secrets

Required secrets in GitHub repository settings:

```yaml
# Server access
SSH_HOST: "your-server-ip-or-hostname"
SSH_USERNAME: "deploy"
SSH_PRIVATE_KEY: "-----BEGIN OPENSSH PRIVATE KEY-----..."
SSH_PORT: "22"  # Optional, defaults to 22

# Application paths
APP_PATH: "/opt/piptip"  # Optional, defaults to /opt/piptip

# Health check
HEALTH_CHECK_URL: "https://your-domain.com/health/healthz"  # Optional
```

### Database Security
```bash
# ✅ Use connection pooling
DATABASE_URL="postgresql://user:pass@host:port/db?pgbouncer=true&connection_limit=1"

# ✅ Use SSL connections  
DATABASE_URL="postgresql://user:pass@host:port/db?sslmode=require"

# ✅ Limit connection lifetime
DATABASE_URL="postgresql://user:pass@host:port/db?connect_timeout=10"
```

## 📋 Environment Validation

### Pre-Deployment Checklist

```bash
#!/bin/bash
# validate_env.sh - Environment validation script

echo "🔍 Validating PIPTip environment..."

# Check required variables
REQUIRED_VARS=(
  "DISCORD_TOKEN"
  "DATABASE_URL" 
  "ABSTRACT_RPC_URL"
  "TREASURY_PRIVATE_KEY"
  "PENGUIN_TOKEN_ADDRESS"
  "ICE_TOKEN_ADDRESS"
  "PEBBLE_TOKEN_ADDRESS"
  "ADMIN_SECRET"
)

MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var}" ]]; then
    MISSING_VARS+=("$var")
  fi
done

if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
  echo "❌ Missing required environment variables:"
  printf '   %s\n' "${MISSING_VARS[@]}"
  exit 1
fi

echo "✅ All required environment variables present"

# Validate Discord token format
if [[ ! "$DISCORD_TOKEN" =~ ^[A-Za-z0-9._-]{50,}$ ]]; then
  echo "⚠️  Discord token format may be invalid"
fi

# Validate database URL
if ! echo "$DATABASE_URL" | grep -q "postgresql://"; then
  echo "⚠️  Database URL should start with postgresql://"
fi

# Validate Ethereum addresses
for addr in "$PENGUIN_TOKEN_ADDRESS" "$ICE_TOKEN_ADDRESS" "$PEBBLE_TOKEN_ADDRESS"; do
  if [[ ! "$addr" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
    echo "⚠️  Invalid Ethereum address format: $addr"
  fi
done

echo "✅ Environment validation complete"
```

### Runtime Environment Check

```bash
# Add to deployment script or app startup
if [[ -f ".env" ]]; then
  source .env
  bash validate_env.sh
else
  echo "❌ .env file not found"
  exit 1
fi
```

## 🏗️ Environment Setup for Different Stages

### Development Environment
```bash
# Minimal setup for local development
DISCORD_TOKEN="your_dev_bot_token"
DATABASE_URL="postgresql://localhost:5432/piptip_dev"
ABSTRACT_RPC_URL="https://api.testnet.abs.xyz"
TREASURY_PRIVATE_KEY="0xdev_key_here"
ADMIN_SECRET="dev_admin_123"
NODE_ENV="development"
```

### Staging Environment  
```bash
# Production-like setup for testing
DISCORD_TOKEN="staging_bot_token"
DATABASE_URL="postgresql://user:pass@staging-db:5432/piptip_staging?pgbouncer=true"
ABSTRACT_RPC_URL="https://api.testnet.abs.xyz"
NODE_ENV="staging" 
ENABLE_METRICS="true"
```

### Production Environment
```bash
# Full production configuration
DISCORD_TOKEN="prod_bot_token_here"
DATABASE_URL="postgresql://user:pass@prod-db:5432/piptip?pgbouncer=true&connection_limit=1&sslmode=require"
ABSTRACT_RPC_URL="https://api.mainnet.abs.xyz"
NODE_ENV="production"
ENABLE_METRICS="true"
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/prod-alerts"
```

## 🔄 Migration from Old Environment

If upgrading from a previous deployment:

### 1. Backup Current Environment
```bash
cp .env .env.backup.$(date +%Y%m%d)
```

### 2. Add New Required Variables
```bash
# New in this version
echo "GIT_SHA=$(git rev-parse --short HEAD)" >> .env
echo "ENABLE_METRICS=true" >> .env
echo "SLOW_QUERY_THRESHOLD_MS=300" >> .env
```

### 3. Update Database URL for PgBouncer
```bash
# Old format
DATABASE_URL="postgresql://user:pass@host:5432/db"

# New format (add pgbouncer params)
DATABASE_URL="postgresql://user:pass@host:5432/db?pgbouncer=true&connection_limit=1"
```

## 🚨 Security Incident Response

### If Secrets Are Compromised

1. **Immediate Actions**:
   ```bash
   # Stop the application
   pm2 stop pipbot
   
   # Rotate compromised secrets
   # Update Discord bot token in Discord Developer Portal
   # Update database password in Supabase/PostgreSQL
   # Generate new treasury private key
   ```

2. **Update Environment**:
   ```bash
   # Update .env with new secrets
   nano .env
   
   # Restart application
   pm2 restart pipbot
   ```

3. **Verify Security**:
   ```bash
   # Check health with new credentials
   curl -s http://localhost:3000/health/healthz
   
   # Monitor logs for any issues
   pm2 logs pipbot --follow
   ```

### Access Logging

Monitor environment file access:
```bash
# Add to cron for monitoring
echo "0 */6 * * * ls -la /opt/piptip/.env >> /var/log/env-access.log" | crontab -
```

## 📊 Monitoring Environment Health

### Environment Variable Drift Detection
```bash
#!/bin/bash
# check_env_drift.sh - Detect unexpected environment changes

EXPECTED_COUNT=25  # Adjust based on your setup
CURRENT_COUNT=$(grep -c "=" .env)

if [[ $CURRENT_COUNT -ne $EXPECTED_COUNT ]]; then
  echo "⚠️  Environment variable count changed: $CURRENT_COUNT (expected $EXPECTED_COUNT)"
fi

# Check for suspicious additions
if grep -q "DEBUG\|TEST\|TEMP" .env; then
  echo "⚠️  Temporary environment variables detected"
fi
```

### Automated Environment Backup
```bash
#!/bin/bash
# backup_env.sh - Automated environment backup

BACKUP_DIR="/opt/backups/env"
mkdir -p "$BACKUP_DIR"

# Create encrypted backup of environment
gpg --cipher-algo AES256 --compress-algo 1 --s2k-mode 3 \
    --s2k-digest-algo SHA512 --s2k-count 65536 --force-mdc \
    --quiet --symmetric --output "$BACKUP_DIR/.env.$(date +%Y%m%d).gpg" .env

# Keep only last 30 days
find "$BACKUP_DIR" -name "*.gpg" -mtime +30 -delete
```

## 🔗 External Dependencies

### Required External Services
- **Discord API**: Bot functionality, command handling
- **Supabase/PostgreSQL**: Primary database
- **Abstract Chain RPC**: Blockchain interactions
- **GitHub**: CI/CD pipeline triggers

### Optional External Services  
- **Discord Webhook**: Alert notifications
- **Monitoring Services**: External health checks
- **Log Aggregation**: Centralized logging

### Service Health Checks
```bash
# Check external service availability
curl -s https://discord.com/api/v10/gateway | jq .url  # Discord
curl -s "$ABSTRACT_RPC_URL" -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'  # RPC
```

This environment audit ensures all required variables are documented, secured, and properly validated for reliable PIPTip deployments.