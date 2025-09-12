# PIPTip Operability Guide

## Monitoring & Alerts

This document outlines the monitoring system, alerting thresholds, and investigation steps for PIPTip production operations.

## Health Endpoints

### `/healthz`
Basic health check endpoint optimized for load balancers and uptime monitoring.
- **Response Time**: <200ms database ping timeout
- **Returns**: HTTP 200 (healthy) or 503 (unhealthy)
- **Use**: Load balancer health checks, simple uptime monitoring

### `/healthz/detailed`
Comprehensive health check with metrics and system information.
- **Response Time**: <1000ms database ping timeout  
- **Returns**: HTTP 200/503 with detailed system metrics
- **Use**: Operational dashboards, detailed health monitoring

## Critical Metrics & Thresholds

### Database Performance
- **slow_queries_total**: Queries exceeding 300ms execution time
  - **Alert Threshold**: >10 slow queries in 5 minutes
  - **Investigation**: Check database connections, query patterns, potential table locks
  - **Action**: Review slow query logs for optimization opportunities

### Financial Operations
- **refunds_issued_total**: Successfully processed refund transactions
  - **Monitoring**: Track refund volume and patterns
  - **Expected**: Low volume during normal operations

- **refund_failures_total**: Failed refund attempts with categorized reasons
  - **Alert Threshold**: Any refund failure triggers immediate alert
  - **Investigation Steps**:
    1. Check refund failure reason in logs
    2. Verify database connectivity and transaction state
    3. Validate tip/group tip existence and current status
    4. Review user balance and token data integrity

### Security & Integrity
- **negative_balance_attempts_total**: Prevented negative balance transactions
  - **Alert Threshold**: >5 attempts in 1 minute
  - **Investigation Steps**:
    1. Review user balance calculation logic
    2. Check for concurrent transaction issues
    3. Validate tip/withdrawal amounts against available balances
    4. Monitor for potential abuse patterns

- **unique_violation_claims_total**: Duplicate group tip claim attempts
  - **Alert Threshold**: >20 violations in 5 minutes (spam detection)
  - **Investigation**: Review group tip claim patterns, potential bot activity

## Discord Webhook Alerts

Alerts are sent to configured Discord webhook with intelligent cooldown protection:
- **Cooldown Period**: 60 seconds per alert type
- **Alert Types**:
  - `refund_failure`: Immediate alert on any refund failure
  - `negative_balance`: Alert when negative balance attempts exceed threshold
  - `slow_queries`: Alert when slow query rate exceeds threshold

### Alert Configuration
Set environment variables:
```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
ALERT_COOLDOWN_SECONDS=60
```

## Structured Logging

All metrics and events are logged in structured JSON format:

```json
{
  "type": "metric_increment",
  "timestamp": "2025-09-11T19:45:32.123Z",
  "metric": "refund_failures_total",
  "labels": { "reason": "tip_not_found" },
  "value": 1
}
```

```json
{
  "type": "slow_query", 
  "timestamp": "2025-09-11T19:45:32.456Z",
  "duration_ms": 450,
  "operation": "TIP_READ",
  "sql": "SELECT tip.id, tip.amountAtomic FROM tip WHERE...",
  "params": ["123"]
}
```

## Investigation Runbooks

### High Refund Failures
1. **Check Alert Details**: Review failure reason and affected user/tip IDs
2. **Database Health**: Verify database connectivity via `/healthz/detailed`
3. **Transaction State**: Query tip/group tip status in database
4. **User Impact**: Confirm user balance integrity and transaction history
5. **Resolution**: Manual intervention may be required for stuck transactions

### Excessive Slow Queries  
1. **Identify Patterns**: Review slow query logs for common operations
2. **Database Load**: Check concurrent connections and active queries
3. **Query Optimization**: Analyze execution plans for problematic queries
4. **Scaling**: Consider connection pooling or read replica utilization

### Negative Balance Attempts
1. **User Analysis**: Identify affected users and transaction patterns
2. **Concurrency Issues**: Check for race conditions in balance calculations
3. **Data Integrity**: Verify balance calculations against transaction history
4. **Abuse Detection**: Monitor for unusual user behavior patterns

### System Health Issues
1. **Database Connectivity**: Test database ping times and connection stability
2. **Memory Usage**: Review heap utilization from `/healthz/detailed`
3. **Application Logs**: Check for error patterns and exception rates
4. **External Dependencies**: Verify Discord API and webhook connectivity

## Metric Collection

Metrics are collected in-process with periodic emission:
- **Collection Interval**: Real-time increment on events
- **Emission Interval**: 60-second periodic summaries
- **Retention**: Log-based retention (external log aggregation recommended)

## Production Considerations

- **Database Monitoring**: Implement external database monitoring for comprehensive visibility
- **Log Aggregation**: Configure external logging system (ELK, DataDog, etc.)
- **Alert Routing**: Set up multiple notification channels for critical alerts
- **Backup Monitoring**: Monitor database backup success and retention
- **Performance Baselines**: Establish baseline metrics for anomaly detection