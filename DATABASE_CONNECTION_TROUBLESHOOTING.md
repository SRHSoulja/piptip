# Database Connection Troubleshooting

**Date:** 2025-10-01
**Status:** 🚨 CRITICAL - Database Unreachable
**Error:** `Can't reach database server at aws-1-us-east-2.pooler.supabase.com:5432`

## Current Symptoms

- All Prisma queries failing with connection timeout
- Railway logs showing 500+ errors/second (before fix)
- Profile commands failing with database connection errors
- Social leaderboard calculations failing

## Root Cause Analysis

The Supabase database at `aws-1-us-east-2.pooler.supabase.com:5432` is unreachable. This could be caused by:

1. **Supabase Infrastructure Issues**
   - Database paused due to inactivity (free tier)
   - Service outage or maintenance
   - Regional connectivity issues

2. **Configuration Issues**
   - Wrong connection string in Railway environment
   - Missing connection pooler configuration
   - SSL certificate issues

3. **Network/Firewall Issues**
   - Railway IP blocked by Supabase
   - DNS resolution failure
   - Port 5432 blocked

## Immediate Actions Required

### Step 1: Check Supabase Dashboard

Go to https://supabase.com/dashboard and verify:

- [ ] **Project Status**: Is the database running? (green indicator)
- [ ] **Auto-Pause**: Has the database paused due to inactivity?
  - Free tier databases pause after 7 days of inactivity
  - **FIX**: Upgrade to Pro tier ($25/month) to disable auto-pause
- [ ] **Connection Details**: Get current connection string from Settings → Database

### Step 2: Verify Connection String Format

Your `DATABASE_URL` in Railway should look like:

```bash
# Supabase Connection Pooler (PgBouncer - RECOMMENDED)
postgresql://postgres.[project-ref]:[password]@aws-1-us-east-2.pooler.supabase.com:5432/postgres?pgbouncer=true

# OR Direct Connection (not recommended for production)
postgresql://postgres.[project-ref]:[password]@aws-1-us-east-2.aws.neon.tech:5432/postgres
```

**Key differences:**
- **Pooler URL**: `*.pooler.supabase.com` - Uses PgBouncer for connection pooling
- **Direct URL**: `*.aws.neon.tech` - Direct Postgres connection
- **Port**: Always `5432` for Supabase

### Step 3: Update Railway Environment Variables

In Railway dashboard:

1. Go to your PIPtip project
2. Click **Variables** tab
3. Find `DATABASE_URL`
4. Click **Edit** and update with fresh connection string from Supabase
5. **IMPORTANT**: Click **Deploy** to restart the app with new variables

### Step 4: Test Connection from Railway

After updating `DATABASE_URL`, the bot will restart automatically. Check logs for:

**Success:**
```
Prisma schema loaded from prisma/schema.prisma
✅ Datasource "db": PostgreSQL database
Bot login initiated
```

**Still failing:**
```
Can't reach database server at aws-1-us-east-2.pooler.supabase.com:5432
```

## Connection String Components

### Anatomy of a Supabase Connection String

```
postgresql://USER:PASSWORD@HOST:PORT/DATABASE?OPTIONS
           │    │         │    │    │        │
           │    │         │    │    │        └─ Connection options
           │    │         │    │    └─ Database name (usually "postgres")
           │    │         │    └─ Port (5432 for Postgres)
           │    │         └─ Host (pooler or direct)
           │    └─ Database password from Supabase dashboard
           └─ Username (usually "postgres.[project-ref]")
```

### Required Connection Options

For Supabase with PgBouncer pooler:

```bash
?pgbouncer=true&pool_size=15&connection_limit=20
```

- `pgbouncer=true`: Enable PgBouncer compatibility mode
- `pool_size=15`: Prisma connection pool size
- `connection_limit=20`: Max connections per pool

## Common Issues and Fixes

### Issue 1: Database Paused (Free Tier)

**Symptoms:**
- Connection fails after period of inactivity
- Supabase dashboard shows "Paused" status

**Fix:**
1. Go to Supabase dashboard
2. Click **Resume** on paused project
3. Database will restart in ~30 seconds
4. Railway app will reconnect automatically

**Prevention:**
- Upgrade to Supabase Pro ($25/month) - removes auto-pause
- OR: Set up cron job to ping database every 6 days

### Issue 2: Wrong Connection String

**Symptoms:**
- Connection fails immediately
- Error: `password authentication failed`

**Fix:**
1. Go to Supabase → Settings → Database
2. Copy **Connection String** under "Connection Pooling"
3. Click **Show password** to reveal actual password
4. Update `DATABASE_URL` in Railway

### Issue 3: SSL Certificate Issues

**Symptoms:**
- Connection fails with SSL/TLS errors

**Fix:**
Add `?sslmode=require` to connection string:

```bash
postgresql://user:pass@host:5432/postgres?pgbouncer=true&sslmode=require
```

### Issue 4: Too Many Connections

**Symptoms:**
- `FATAL: remaining connection slots reserved`
- `sorry, too many clients already`

**Fix:**
1. Reduce `pool_size` in connection string:
   ```bash
   ?pgbouncer=true&pool_size=5&connection_limit=10
   ```
2. Use Connection Pooler (pooler.supabase.com) instead of direct connection
3. Check for connection leaks in code

## Verification Steps

### 1. Test Connection Locally

Use `psql` to test connection string:

```bash
# Replace with your actual connection string
psql "postgresql://postgres.[project-ref]:[password]@aws-1-us-east-2.pooler.supabase.com:5432/postgres?pgbouncer=true"
```

**Expected output:**
```
psql (14.x)
SSL connection (protocol: TLSv1.3)
Type "help" for help.

postgres=>
```

### 2. Test from Railway

Add temporary debugging to `src/services/db.ts`:

```typescript
// Test connection on startup
prisma.$connect()
  .then(() => console.log('✅ Database connected successfully'))
  .catch(err => console.error('❌ Database connection failed:', err));
```

### 3. Check Prisma Client Generation

Verify Prisma client was generated with correct schema:

```bash
npx prisma generate
npx prisma db pull  # Verify schema matches database
```

## Railway-Specific Configuration

### Environment Variables Checklist

In Railway dashboard, verify these variables exist:

- [x] `DATABASE_URL` - Supabase connection string
- [x] `NETWORK` - Set to `testnet` or `mainnet`
- [x] `DISCORD_TOKEN` - Discord bot token
- [x] `PORT` - Should be `3000` (Railway sets automatically)

### Deployment Settings

Railway should have:

1. **Auto-deploy**: Enabled on main branch
2. **Health checks**: Disabled (we use custom health check)
3. **Restart policy**: On failure

## Supabase Dashboard Checklist

### Settings → Database

- [ ] **Connection pooling enabled**: Should show pooler URL
- [ ] **IPv4 allowed**: Railway uses IPv4
- [ ] **SSL enforcement**: Should be enabled
- [ ] **Compute hours remaining**: Check if you've hit free tier limits

### Settings → API

- [ ] **Project URL**: Should match your app
- [ ] **API Key**: anon/service_role keys active

## Escalation Path

If connection still fails after all checks:

1. **Check Supabase Status**: https://status.supabase.com
2. **Railway Status**: https://status.railway.app
3. **Contact Supabase Support**: support@supabase.io
   - Include project ref: `[project-ref]` from connection string
   - Include error logs from Railway
   - Mention using PgBouncer connection pooler

## Prevention: Health Check Monitoring

Add database health check to monitor connection:

```typescript
// src/web/admin.ts - Add to health check endpoint
app.get("/health", async (req, res) => {
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(503).json({
      status: "unhealthy",
      database: "disconnected",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
```

## Recovery Checklist

Once connection is restored:

- [ ] Verify bot commands work (`/pip_profile`)
- [ ] Check social leaderboard loads
- [ ] Verify admin panel accessible
- [ ] Monitor logs for connection errors
- [ ] Set up uptime monitoring (UptimeRobot, Better Uptime)

## Related Files

- `src/services/db.ts` - Prisma client initialization
- `prisma/schema.prisma` - Database schema
- `.env.example` - Environment variable template
- `src/services/social_leaderboards.ts` - Now has circuit breaker for DB failures

## Notes

**Log Spam Fix Applied**: `social_leaderboards.ts` now has circuit breaker that stops processing after first database error, preventing 500+ error logs when DB is down.

---

**Generated:** 2025-10-01
**Next Steps:** Check Supabase dashboard and verify DATABASE_URL in Railway
