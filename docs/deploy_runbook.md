# PIPTip Deployment & Rollback Runbook

This document provides step-by-step procedures for deploying PIPTip and performing emergency rollbacks.

## Quick Reference

| Scenario | Time to Rollback | Command |
|----------|------------------|---------|
| **Application rollback** | ~2 minutes | `./deploy.sh --rollback <commit>` |
| **Database rollback** | ~10-30 minutes | Restore Supabase snapshot |
| **Emergency stop** | ~30 seconds | `pm2 stop pipbot` |
| **Feature flag disable** | ~1 minute | Update .env, `pm2 reload pipbot` |

## 🚀 Standard Deployment Process

### 1. Pre-Deployment Checklist

- [ ] **Code review approved** and merged to main
- [ ] **Tests passing** in CI/CD pipeline  
- [ ] **Database migrations reviewed** (see [zero-downtime guide](./zero_downtime_migrations.md))
- [ ] **Environment variables updated** if needed
- [ ] **Backup verification** - latest Supabase backup exists
- [ ] **Team notification** of deployment window
- [ ] **Rollback plan identified** (specific commit SHA)

### 2. Automatic Deployment (GitHub Actions)

Deployments trigger automatically on pushes to `main`:

```bash
# Monitor deployment
gh run watch

# View deployment logs
gh run view --log
```

### 3. Manual Deployment

For manual deployments or testing:

```bash
# Dry run first
./deploy.sh --dry-run

# Full deployment with health checks
./deploy.sh

# Skip health checks if needed
./deploy.sh --skip-health-check
```

### 4. Post-Deployment Verification

```bash
# Check application health
curl -s http://localhost:3000/health/healthz | jq .

# Verify PM2 status
pm2 status pipbot

# Check recent logs
pm2 logs pipbot --lines 50

# Test critical endpoints
curl -s http://localhost:3000/health/healthz/detailed | jq .

# Verify Discord bot is responsive (send test command in Discord)
```

## 🔄 Rollback Procedures

### Application Rollback (Fast - <2 minutes)

Use this for application bugs, performance issues, or non-database problems.

#### Step 1: Identify Target Commit
```bash
# View recent commits
git log --oneline -10

# Or check current deployment version
curl -s http://localhost:3000/health/healthz | jq .version
```

#### Step 2: Execute Rollback
```bash
cd /opt/piptip  # or your app directory

# Quick rollback to specific commit
git checkout <previous_commit_sha>
npm ci --omit=dev --silent
npx prisma generate
npm run build

# Update environment with rollback version
sed -i "s/^GIT_SHA=.*/GIT_SHA=$(git rev-parse --short HEAD)/" .env

# Reload PM2
pm2 reload pipbot --update-env
```

#### Step 3: Verify Rollback
```bash
# Check health and version
curl -s http://localhost:3000/health/healthz | jq .

# Verify PM2 status
pm2 describe pipbot

# Test critical functionality
```

### Database Rollback (Slow - 10-30 minutes)

Use this for database corruption, failed migrations, or data integrity issues.

#### Step 1: Stop Application
```bash
# Stop application to prevent writes during restore
pm2 stop pipbot
```

#### Step 2: Restore Database

**Option A: Supabase Dashboard**
1. Go to Supabase dashboard > Settings > Database
2. Click "Point-in-time Recovery" or "Backups"
3. Select restore point (before the problematic deployment)
4. Follow Supabase restoration process

**Option B: Supabase CLI**
```bash
# List available backups
supabase backups list --project-ref <project-ref>

# Restore from specific backup
supabase db restore --project-ref <project-ref> --backup-id <backup-id>
```

**Option C: Manual SQL Restore**
```bash
# If you have SQL dumps from our backup service
psql $DATABASE_URL < backups/piptip_backup_YYYY-MM-DD.sql
```

#### Step 3: Application Rollback
```bash
# Rollback application to match database state
git checkout <commit_matching_db_schema>
npm ci --omit=dev --silent
npx prisma generate
npm run build

# Start application
pm2 start pipbot
```

#### Step 4: Verify System Health
```bash
# Check database connectivity
npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM \"User\";"

# Verify application health
curl -s http://localhost:3000/health/healthz | jq .

# Test critical user flows
```

### Emergency Stop (Immediate)

For critical issues requiring immediate service halt:

```bash
# Stop application immediately
pm2 stop pipbot

# Or kill process if PM2 is unresponsive
pkill -f "tsx src/index.ts"

# Put up maintenance page (if configured)
# nginx: cp maintenance.html /var/www/html/index.html
```

### Feature Flag Rollback (Fast - ~1 minute)

For disabling problematic features without full rollback:

#### Step 1: Identify Feature Flags
Common feature flags in `.env`:
```bash
ENABLE_METRICS=false          # Disable monitoring
ENABLE_GROUP_TIPS=false       # Disable group tipping
ENABLE_GAMES=false            # Disable game features  
MAINTENANCE_MODE=true         # Enable maintenance mode
```

#### Step 2: Update Configuration
```bash
# Edit environment variables
nano .env

# Or use sed for specific flags
sed -i 's/ENABLE_GROUP_TIPS=true/ENABLE_GROUP_TIPS=false/' .env
```

#### Step 3: Reload Application
```bash
# Reload with new environment
pm2 reload pipbot --update-env

# Verify feature is disabled
curl -s http://localhost:3000/health/healthz/detailed | jq .
```

## 📊 Monitoring During Deployments

### Health Check Monitoring
```bash
# Continuous health monitoring
watch -n 5 'curl -s http://localhost:3000/health/healthz | jq .'

# Monitor detailed metrics
watch -n 10 'curl -s http://localhost:3000/health/healthz/detailed | jq .metrics'
```

### Database Monitoring
```sql
-- Active connections
SELECT count(*) as active_connections 
FROM pg_stat_activity 
WHERE state = 'active';

-- Slow queries
SELECT query_start, state, query 
FROM pg_stat_activity 
WHERE state = 'active' 
AND query_start < now() - interval '30 seconds';

-- Database size
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname NOT IN ('information_schema','pg_catalog')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### PM2 Monitoring
```bash
# Real-time monitoring
pm2 monit

# Resource usage
pm2 show pipbot

# Log monitoring
pm2 logs pipbot --follow
```

## 🚨 Troubleshooting Common Issues

### Health Checks Failing

**Symptoms**: `/healthz` returns 503 or times out
```bash
# Check database connectivity
npx prisma db execute --stdin <<< "SELECT 1;"

# Check PM2 process
pm2 describe pipbot

# Check logs for errors
pm2 logs pipbot --lines 100
```

### Database Connection Issues

**Symptoms**: "Database connection failed" errors
```bash
# Test database URL
psql $DATABASE_URL -c "SELECT version();"

# Check connection limits
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# Restart with fresh connections
pm2 restart pipbot
```

### High Memory Usage

**Symptoms**: PM2 shows high memory, potential OOM kills
```bash
# Check memory usage
pm2 show pipbot

# Restart to clear memory
pm2 restart pipbot

# Monitor memory over time
watch -n 5 'pm2 show pipbot | grep memory'
```

### Migration Failures

**Symptoms**: `npx prisma migrate deploy` fails
```bash
# Check migration status
npx prisma migrate status

# Reset failed migration (DANGEROUS - backup first!)
npx prisma migrate resolve --rolled-back <migration-name>

# Apply migrations manually
psql $DATABASE_URL -f prisma/migrations/<migration>/migration.sql
npx prisma migrate resolve --applied <migration-name>
```

## 📋 Rollback Decision Matrix

| Issue Type | Scope | Rollback Method | Expected Downtime |
|------------|-------|-----------------|------------------|
| **Bug in new feature** | Application only | Application rollback | 1-2 minutes |
| **Performance regression** | Application only | Application rollback | 1-2 minutes |
| **Failed migration** | Database + App | Database restore | 10-30 minutes |
| **Data corruption** | Database + App | Database restore | 10-30 minutes |
| **Security issue** | Varies | Emergency stop + fix | Until patched |
| **Third-party service down** | External | Feature flags | 1 minute |
| **Memory leak** | Application only | PM2 restart | 30 seconds |

## 📞 Emergency Contacts & Resources

### Key Information
- **Application Directory**: `/opt/piptip`
- **PM2 Process Name**: `pipbot`
- **Health Endpoint**: `http://localhost:3000/health/healthz`
- **Admin Interface**: `http://localhost:3000/admin`
- **Database**: Supabase PostgreSQL

### Useful Commands Cheat Sheet
```bash
# Quick status check
pm2 status && curl -s localhost:3000/health/healthz | jq .status

# Emergency stop
pm2 stop pipbot

# Quick restart
pm2 restart pipbot

# View recent logs  
pm2 logs pipbot --lines 50

# Database quick test
npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM \"User\";"

# Rollback to previous commit
git checkout HEAD~1 && npm ci --omit=dev && npm run build && pm2 reload pipbot
```

### Supabase Resources
- **Dashboard**: https://app.supabase.com/project/[project-id]
- **Direct DB Access**: Use connection string from dashboard
- **Backup Documentation**: [Supabase Backup Guide](https://supabase.com/docs/guides/database/backups)

## 🔒 Security Considerations

### Deployment Security
- Never commit `.env` files to Git
- Use GitHub Actions secrets for sensitive data  
- Rotate database credentials after major incidents
- Review access logs after rollbacks

### Access Control
- Limit SSH access to deployment servers
- Use strong authentication for database access
- Monitor admin interface access
- Log all deployment activities

## 📈 Post-Incident Review

After any rollback, document:
1. **Timeline** of issue detection and resolution
2. **Root cause** analysis
3. **Impact** assessment (users affected, duration)
4. **Lessons learned** and prevention measures
5. **Process improvements** for future deployments

### Template Incident Report
```markdown
## Incident Summary
- **Date/Time**: 
- **Duration**: 
- **Affected Users**: 
- **Rollback Method**: 

## Timeline
- HH:MM - Issue detected
- HH:MM - Rollback initiated  
- HH:MM - Service restored

## Root Cause
[Description of underlying issue]

## Resolution
[Steps taken to resolve]

## Prevention
[Measures to prevent recurrence]
```