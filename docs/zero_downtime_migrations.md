# Zero-Downtime Database Migration Guide

This document outlines best practices for performing database migrations in production without service interruption.

## Overview

PIPTip uses Prisma migrations with PostgreSQL. Most migrations are safe for zero-downtime deployment, but some operations require special handling to avoid blocking production traffic.

## Safe Migration Operations

These operations can be performed without downtime:

✅ **Adding new tables**
✅ **Adding new columns (with defaults)**
✅ **Adding new indexes (see considerations below)**
✅ **Creating new foreign key constraints on small tables**
✅ **Dropping unused columns/tables** (after code deployment)
✅ **Altering column defaults**
✅ **Adding CHECK constraints as NOT VALID, then validating**

## Potentially Blocking Operations

These operations may cause downtime or performance issues:

⚠️ **Adding indexes on large tables** (without CONCURRENTLY)
⚠️ **Adding NOT NULL constraints** (without proper migration strategy)
⚠️ **Renaming columns/tables** (requires coordinated code changes)
⚠️ **Changing column types** (may require table rewrites)
⚠️ **Adding foreign key constraints on large tables**

## Large Index Creation Strategy

When Prisma generates a migration that creates indexes on large tables, follow this process:

### 1. Identify Problematic Migrations

Look for migrations containing:
```sql
CREATE INDEX "ix_name" ON "table_name" ("column");
```

On tables with >100k rows, this may block for several minutes.

### 2. Manual Index Creation Process

**Step 1: Edit the migration file**
```sql
-- Before (blocking):
CREATE INDEX "tip_created_at_idx" ON "Tip" ("createdAt");

-- After (non-blocking):
CREATE INDEX CONCURRENTLY "tip_created_at_idx" ON "Tip" ("createdAt");
```

**Step 2: Remove transaction wrapper**
Since `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, edit the migration:

```sql
-- Remove the BEGIN; and COMMIT; statements from the migration file
-- The file should start directly with the CREATE INDEX CONCURRENTLY statement
```

**Step 3: Apply manually before deployment**
```bash
# Connect to production database
psql $DATABASE_URL

# Run the CREATE INDEX CONCURRENTLY statement manually
CREATE INDEX CONCURRENTLY "tip_created_at_idx" ON "Tip" ("createdAt");

# Verify index was created
\d+ "Tip"
```

**Step 4: Mark migration as applied**
```bash
# Mark the migration as applied without running it
npx prisma migrate resolve --applied 20240101000000_add_tip_index
```

**Step 5: Deploy normally**
```bash
./deploy.sh
```

The deployment will skip the already-applied migration.

## Adding NOT NULL Constraints

To add NOT NULL constraints safely:

### Option 1: Multi-step Migration
```sql
-- Migration 1: Add column with default
ALTER TABLE "User" ADD COLUMN "email" TEXT DEFAULT '';

-- Migration 2: Backfill data
UPDATE "User" SET "email" = "discordId" || '@discord.placeholder' WHERE "email" = '';

-- Migration 3: Add NOT NULL constraint
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
```

### Option 2: Add CHECK constraint first
```sql
-- Migration 1: Add CHECK constraint as NOT VALID (non-blocking)
ALTER TABLE "User" ADD CONSTRAINT "user_email_not_null" CHECK ("email" IS NOT NULL) NOT VALID;

-- Migration 2: Validate constraint (may be slow but non-blocking for new writes)
ALTER TABLE "User" VALIDATE CONSTRAINT "user_email_not_null";

-- Migration 3: Add NOT NULL (fast since constraint already enforced)
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "User" DROP CONSTRAINT "user_email_not_null";
```

## Column Renaming Strategy

Column renames require coordinated application deployment:

### Step 1: Add new column
```sql
-- Migration 1: Add new column
ALTER TABLE "User" ADD COLUMN "discord_id" TEXT;
UPDATE "User" SET "discord_id" = "discordId";
```

### Step 2: Deploy application that writes to both columns
Update application code to read from `discord_id` but write to both columns.

### Step 3: Backfill and drop old column
```sql
-- Migration 2: Final cleanup
UPDATE "User" SET "discord_id" = "discordId" WHERE "discord_id" IS NULL;
ALTER TABLE "User" DROP COLUMN "discordId";
```

## Pre-Deployment Checklist

Before running migrations on large tables:

- [ ] **Estimate migration time**: Test on staging with production-sized data
- [ ] **Check active connections**: Monitor current database load
- [ ] **Backup verification**: Ensure recent backup exists
- [ ] **Rollback plan**: Document rollback procedure
- [ ] **Monitor resources**: Watch CPU, memory, and disk I/O during migration
- [ ] **Communication**: Notify team of potential maintenance window

## Migration Monitoring

During large migrations, monitor:

```sql
-- Check active queries
SELECT pid, state, query_start, query 
FROM pg_stat_activity 
WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%';

-- Check locks
SELECT blocked_locks.pid AS blocked_pid,
       blocked_activity.usename AS blocked_user,
       blocking_locks.pid AS blocking_pid,
       blocking_activity.usename AS blocking_user,
       blocked_activity.query AS blocked_statement,
       blocking_activity.query AS current_statement_in_blocking_process
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks 
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

## Emergency Procedures

### Cancel Long-Running Migration
```sql
-- Find the migration process
SELECT pid, state, query_start, left(query, 100)
FROM pg_stat_activity 
WHERE query ILIKE '%CREATE INDEX%' OR query ILIKE '%ALTER TABLE%';

-- Cancel the query (replace PID)
SELECT pg_cancel_backend(12345);

-- If necessary, terminate connection
SELECT pg_terminate_backend(12345);
```

### Rollback Failed Migration
If a migration fails partway through:

1. **Check migration status**
   ```bash
   npx prisma migrate status
   ```

2. **Manual cleanup if needed**
   ```sql
   -- Drop partially created indexes
   DROP INDEX CONCURRENTLY IF EXISTS "problematic_index";
   
   -- Revert schema changes manually
   ```

3. **Reset migration state**
   ```bash
   npx prisma migrate resolve --rolled-back 20240101000000_failed_migration
   ```

## Supabase-Specific Considerations

When using Supabase:

- **Connection limits**: Use PgBouncer with `?pgbouncer=true&connection_limit=1`
- **Query timeout**: Long migrations may timeout; use direct psql connection
- **Monitoring**: Use Supabase dashboard to monitor database performance
- **Backups**: Leverage Supabase's automatic backup system

### Supabase PgBouncer Settings
```bash
# Add to DATABASE_URL for production
DATABASE_URL="postgresql://user:pass@host:port/db?pgbouncer=true&connection_limit=1"
```

## Testing Migration Performance

Before production deployment:

```sql
-- Create test table with production-like size
CREATE TABLE test_tips AS SELECT * FROM "Tip";

-- Time index creation
\timing on
CREATE INDEX CONCURRENTLY test_idx ON test_tips ("createdAt");
\timing off

-- Clean up
DROP TABLE test_tips;
```

## Best Practices Summary

1. **Always test migrations on staging** with production-sized data
2. **Use `CREATE INDEX CONCURRENTLY`** for indexes on large tables
3. **Plan multi-step migrations** for breaking changes
4. **Monitor database performance** during deployments
5. **Have rollback procedures ready** before starting
6. **Communicate maintenance windows** for risky operations
7. **Use database snapshots** as rollback points for major changes