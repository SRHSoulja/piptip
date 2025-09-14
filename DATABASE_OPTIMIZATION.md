# Database Connection Optimization for Launch

## Quick Connection Pool Setup

Add to your DATABASE_URL in production:
```bash
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=0&schema=public"
```

### Why These Settings:
- `connection_limit=10`: Perfect for 500 concurrent users (current scale)
- `pool_timeout=0`: No timeout waiting for connections (fail fast if pool exhausted)
- Avoids over-engineering for future scale

## Launch Monitoring Commands

```bash
# Monitor connection usage
SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = 'active';

# Check slow queries during launch
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## When to Scale Up:
- **500+ concurrent users**: Increase to connection_limit=15
- **1000+ concurrent users**: Consider connection_limit=20
- **Database CPU >80%**: Add read replica for UserStats queries

**Current Status**: Perfectly sized for 2-3 server limited launch ✅