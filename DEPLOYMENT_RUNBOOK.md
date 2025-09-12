# PIPTip Production Deployment Runbook

## Overview

This runbook provides step-by-step procedures for safely deploying PIPTip to production environments. It includes validation checks, deployment procedures, rollback processes, and monitoring guidelines.

## Pre-Deployment Validation

### 1. Environment Preparation

**Required Environment Variables:**
```bash
# Core Discord Configuration
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
GUILD_ID=your_guild_id

# Database Configuration  
DATABASE_URL=postgresql://user:pass@host:port/db

# Blockchain Configuration
ABSTRACT_RPC_URL=https://abstract-mainnet.g.alchemy.com/v2/your_key
ABSTRACT_CHAIN_ID=2741
TREASURY_AGW_ADDRESS=0xYourTreasuryAddress
AGW_SESSION_PRIVATE_KEY=your_private_key
TOKEN_ADDRESS=0xYourTokenAddress
TOKEN_DECIMALS=18

# Security Configuration
ADMIN_SECRET=super-long-admin-bearer
INTERNAL_BEARER=super-long-random-string-here
SESSION_SECRET=change_me_to_random_string

# Application Configuration
PUBLIC_BASE_URL=https://your-domain.com
PORT=3000
HOUSE_FEE_BPS=200
TIP_FEE_BPS=100
WITHDRAW_MAX_PER_TX=50
WITHDRAW_DAILY_CAP=500

# Optional Performance Configuration
GIT_SHA=commit_hash_here
```

**Environment Validation:**
```bash
# Validate all required environment variables
npx tsx src/services/env_validator.ts
```

### 2. Code Quality Validation

**Build and Type Check:**
```bash
# Clean install dependencies
npm ci --omit=dev --silent

# Generate Prisma client
npx prisma generate

# TypeScript validation
npx tsc --noEmit --pretty false

# Build application
npm run build

# Verify no test imports in production code
node scripts/check-test-imports.cjs
```

**Optional Code Quality:**
```bash
# ESLint (if configured)
npx eslint --max-warnings=0 src/

# Prettier (if configured)  
npx prettier --check src/
```

### 3. Database Validation

**Migration Status:**
```bash
# Verify all migrations are applied
npx prisma migrate status
```

**Data Integrity:**
```bash
# Run comprehensive integrity checks
npx tsx scripts/db_integrity_check.ts
```

### 4. Comprehensive Validation

**Full Deployment Validation:**
```bash
# Run complete validation suite
npx tsx scripts/deployment_validation.ts
```

This script orchestrates all validation steps and provides a comprehensive readiness report.

## Deployment Procedures

### Automated Deployment (GitHub Actions)

The CI/CD pipeline automatically deploys to production when code is pushed to the `main` branch:

1. **Trigger Conditions:**
   - Push to `main` branch
   - All build and test checks pass
   - Required environment variables configured as GitHub Secrets

2. **Deployment Secrets Required:**
   ```
   SSH_HOST - Production server IP/hostname
   SSH_USERNAME - SSH username for deployment
   SSH_PRIVATE_KEY - SSH private key for authentication
   SSH_PORT - SSH port (optional, defaults to 22)
   APP_PATH - Application path on server (optional, defaults to /opt/piptip)
   HEALTH_CHECK_URL - Health check URL (optional, defaults to http://localhost:3000/health/healthz)
   ```

3. **Deployment Process:**
   - Code checkout and artifact download
   - SSH connection to production server
   - Git fetch and reset to latest main
   - Dependency installation (`npm ci --omit=dev`)
   - Prisma client generation and migration
   - Application build
   - PM2 process reload
   - Health check validation with retries
   - Automatic rollback on failure

### Manual Deployment

**Prerequisites:**
- SSH access to production server
- PM2 configured with `pipbot` process name
- Environment variables configured in production `.env`

**Deployment Steps:**

1. **Connect to Production Server:**
   ```bash
   ssh user@your-production-server
   cd /opt/piptip  # or your app directory
   ```

2. **Backup Current State:**
   ```bash
   # Get current commit for rollback
   PREVIOUS_COMMIT=$(git rev-parse HEAD)
   echo "Previous commit: $PREVIOUS_COMMIT"
   
   # Optional: Backup database
   npx tsx scripts/backup_db.ts
   ```

3. **Deploy New Code:**
   ```bash
   # Fetch and deploy latest code
   git fetch origin main
   git reset --hard origin/main
   
   # Install dependencies
   npm ci --omit=dev --silent
   
   # Generate Prisma client
   npx prisma generate
   
   # Run migrations
   npx prisma migrate deploy
   
   # Build application
   npm run build
   ```

4. **Update Environment:**
   ```bash
   # Update Git SHA in environment
   CURRENT_COMMIT=$(git rev-parse --short HEAD)
   sed -i "s/^GIT_SHA=.*/GIT_SHA=$CURRENT_COMMIT/" .env
   ```

5. **Restart Services:**
   ```bash
   # Reload PM2 process
   pm2 reload pipbot --update-env
   
   # Wait for startup
   sleep 10
   ```

6. **Validate Deployment:**
   ```bash
   # Run health checks
   curl -f http://localhost:3000/health/healthz
   
   # Run smoke tests
   npx tsx scripts/smoke_tests.ts
   ```

## Post-Deployment Validation

### Health Check Endpoints

**Basic Health Check:**
```bash
curl http://localhost:3000/health/healthz
# Expected: {"status":"healthy","timestamp":"...","db":{"status":"connected"}}
```

**Readiness Check:**
```bash
curl http://localhost:3000/health/ready  
# Expected: HTTP 200 OK
```

**Liveness Check:**
```bash
curl http://localhost:3000/health/live
# Expected: HTTP 200 OK
```

### Comprehensive Smoke Testing

**Run Full Smoke Test Suite:**
```bash
npx tsx scripts/smoke_tests.ts
```

**Manual Smoke Tests:**
1. Discord bot responds to ping
2. Admin interface accessible with authentication
3. Database queries execute successfully  
4. Blockchain connectivity verified
5. No error logs in application output

### Monitoring

**PM2 Process Status:**
```bash
pm2 status pipbot
pm2 logs pipbot --lines 100
```

**System Resource Usage:**
```bash
pm2 monit  # Interactive monitoring
```

**Database Performance:**
```bash
# Check active connections
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# Check recent errors in logs
tail -f /var/log/postgresql/postgresql.log
```

## Rollback Procedures

### Automatic Rollback

The CI/CD pipeline includes automatic rollback on health check failure:

1. Health checks fail after 5 attempts with 5-second intervals
2. Git checkout to previous commit
3. Rebuild and restart application  
4. Exit with failure status

### Manual Rollback

**Quick Rollback (Git-based):**
```bash
# Rollback to previous commit
git checkout $PREVIOUS_COMMIT

# Reinstall dependencies
npm ci --omit=dev --silent

# Regenerate Prisma client
npx prisma generate

# Rebuild application
npm run build

# Restart services
pm2 reload pipbot --update-env

# Validate rollback
curl -f http://localhost:3000/health/healthz
```

**Database Rollback (if needed):**
```bash
# Identify problematic migration
npx prisma migrate status

# Reset to specific migration (DESTRUCTIVE)
npx prisma migrate reset --force

# Restore from backup
psql $DATABASE_URL < backup_file.sql
```

## Troubleshooting

### Common Issues

**Build Failures:**
- Check TypeScript errors: `npx tsc --noEmit`
- Verify dependencies: `npm ci --omit=dev`
- Check for test imports: `node scripts/check-test-imports.cjs`

**Database Issues:**
- Migration status: `npx prisma migrate status`
- Connection test: `npx tsx scripts/db_integrity_check.ts`
- Reset database: `npx prisma migrate reset --force` (DESTRUCTIVE)

**Health Check Failures:**
- Check application logs: `pm2 logs pipbot`
- Verify environment variables: `npx tsx scripts/env_validator.ts`
- Test database connection manually
- Check port availability: `netstat -tulpn | grep :3000`

**Discord Bot Issues:**
- Verify bot token validity
- Check guild permissions
- Confirm slash command registration

**Performance Issues:**
- Monitor resource usage: `pm2 monit`
- Check database query performance
- Review application logs for errors

### Emergency Contacts

- **Production Issues:** [Your emergency contact]
- **Database Issues:** [DBA contact]
- **Infrastructure:** [DevOps contact]

### Logging and Monitoring

**Application Logs:**
```bash
# PM2 logs
pm2 logs pipbot --lines 1000

# System logs
journalctl -u nginx -f
tail -f /var/log/application.log
```

**Key Metrics to Monitor:**
- Response times (< 2 seconds for health checks)
- Error rates (< 1% for normal operations)
- Database connection pool usage
- Memory and CPU utilization
- Discord API rate limit status

## Security Considerations

### Secrets Management
- Never commit secrets to version control
- Use environment variables for all sensitive data
- Rotate secrets regularly
- Implement secret scrubbing in logs

### Access Control
- Admin routes protected with Bearer tokens
- Internal APIs secured with separate authentication
- Database access restricted to application user
- SSH access limited to deployment accounts

### Data Protection
- Database backups encrypted at rest
- Network traffic encrypted in transit
- Sensitive data scrubbed from logs
- Regular security audits performed

---

*This runbook should be reviewed and updated regularly as the application and infrastructure evolve.*