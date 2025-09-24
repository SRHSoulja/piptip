// src/metrics/index.ts - Comprehensive Prometheus metrics for PipTip production monitoring
import { register, Counter, Histogram, Gauge, Summary, collectDefaultMetrics } from 'prom-client';
// Clear any existing metrics
register.clear();
// Collect default Node.js metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({
    register,
    prefix: 'piptip_nodejs_',
    gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5], // Garbage collection buckets
    eventLoopMonitoringPrecision: 10,
});
// Business Metrics - Core Platform
export const metrics = {
    // === PREDICTION MARKET METRICS ===
    marketsCreated: new Counter({
        name: 'piptip_markets_created_total',
        help: 'Total number of prediction markets created',
        labelNames: ['creator_type', 'market_type', 'guild_id'],
    }),
    marketsResolved: new Counter({
        name: 'piptip_markets_resolved_total',
        help: 'Total number of markets resolved',
        labelNames: ['resolution_type', 'outcome', 'guild_id'],
    }),
    betsPlaced: new Counter({
        name: 'piptip_bets_placed_total',
        help: 'Total number of bets placed',
        labelNames: ['outcome', 'token_symbol', 'guild_id'],
    }),
    betVolume: new Counter({
        name: 'piptip_bet_volume_total',
        help: 'Total betting volume in tokens',
        labelNames: ['token_symbol', 'outcome', 'guild_id'],
    }),
    activeMarkets: new Gauge({
        name: 'piptip_active_markets_count',
        help: 'Number of currently active markets',
        labelNames: ['guild_id'],
    }),
    totalValueLocked: new Gauge({
        name: 'piptip_total_value_locked',
        help: 'Total value locked across all markets',
        labelNames: ['token_symbol'],
    }),
    // === FINANCIAL METRICS ===
    payoutsProcessed: new Counter({
        name: 'piptip_payouts_processed_total',
        help: 'Total number of payouts processed',
        labelNames: ['status', 'market_id'],
    }),
    payoutVolume: new Counter({
        name: 'piptip_payout_volume_total',
        help: 'Total volume of payouts distributed',
        labelNames: ['token_symbol', 'status'],
    }),
    balanceDriftDetected: new Counter({
        name: 'piptip_balance_drift_detected_total',
        help: 'Number of balance reconciliation drifts detected',
        labelNames: ['severity', 'type'],
    }),
    balanceCorrections: new Counter({
        name: 'piptip_balance_corrections_total',
        help: 'Number of automatic balance corrections made',
        labelNames: ['type', 'severity'],
    }),
    // === JOB QUEUE METRICS ===
    jobsProcessed: new Counter({
        name: 'piptip_jobs_processed_total',
        help: 'Total number of queue jobs processed',
        labelNames: ['queue_name', 'status'],
    }),
    jobProcessingDuration: new Histogram({
        name: 'piptip_job_processing_duration_seconds',
        help: 'Time taken to process queue jobs',
        labelNames: ['queue_name', 'job_type'],
        buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    }),
    queueSize: new Gauge({
        name: 'piptip_queue_size',
        help: 'Number of jobs in each queue by status',
        labelNames: ['queue_name', 'status'],
    }),
    deadLetterQueueSize: new Gauge({
        name: 'piptip_dead_letter_queue_size',
        help: 'Number of jobs in dead letter queue',
        labelNames: ['escalation_level', 'requires_review'],
    }),
    // === DISCORD INTEGRATION METRICS ===
    discordInteractions: new Counter({
        name: 'piptip_discord_interactions_total',
        help: 'Total Discord interactions handled',
        labelNames: ['command', 'status', 'guild_id'],
    }),
    discordInteractionDuration: new Histogram({
        name: 'piptip_discord_interaction_duration_seconds',
        help: 'Time taken to process Discord interactions',
        labelNames: ['command'],
        buckets: [0.1, 0.3, 0.5, 1, 2, 3, 5],
    }),
    discordMessagesDelivered: new Counter({
        name: 'piptip_discord_messages_delivered_total',
        help: 'Discord messages delivered via outbox',
        labelNames: ['message_type', 'status', 'priority'],
    }),
    discordRateLimitHits: new Counter({
        name: 'piptip_discord_rate_limit_hits_total',
        help: 'Number of times Discord rate limits were hit',
        labelNames: ['endpoint_type'],
    }),
    // === USER ENGAGEMENT METRICS ===
    activeUsers: new Gauge({
        name: 'piptip_active_users_count',
        help: 'Number of active users in time period',
        labelNames: ['period', 'guild_id'],
    }),
    userRetention: new Gauge({
        name: 'piptip_user_retention_rate',
        help: 'User retention rate by time period',
        labelNames: ['period', 'cohort'],
    }),
    // === PERFORMANCE METRICS ===
    databaseQueryDuration: new Histogram({
        name: 'piptip_database_query_duration_seconds',
        help: 'Database query execution time',
        labelNames: ['operation', 'table'],
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    }),
    databaseConnections: new Gauge({
        name: 'piptip_database_connections_active',
        help: 'Number of active database connections',
    }),
    redisOperationDuration: new Histogram({
        name: 'piptip_redis_operation_duration_seconds',
        help: 'Redis operation execution time',
        labelNames: ['operation'],
        buckets: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1],
    }),
    // === ERROR TRACKING ===
    errors: new Counter({
        name: 'piptip_errors_total',
        help: 'Total number of errors by type and severity',
        labelNames: ['error_type', 'severity', 'component'],
    }),
    criticalAlerts: new Counter({
        name: 'piptip_critical_alerts_total',
        help: 'Critical system alerts requiring immediate attention',
        labelNames: ['alert_type', 'component'],
    }),
    // === RECONCILIATION METRICS ===
    reconciliationRuns: new Counter({
        name: 'piptip_reconciliation_runs_total',
        help: 'Number of reconciliation processes run',
        labelNames: ['type', 'status'],
    }),
    reconciliationDuration: new Histogram({
        name: 'piptip_reconciliation_duration_seconds',
        help: 'Time taken for reconciliation processes',
        labelNames: ['type'],
        buckets: [1, 5, 10, 30, 60, 300],
    }),
    // === SYSTEM HEALTH ===
    uptime: new Gauge({
        name: 'piptip_uptime_seconds',
        help: 'Application uptime in seconds',
    }),
    memoryUsage: new Gauge({
        name: 'piptip_memory_usage_bytes',
        help: 'Memory usage by type',
        labelNames: ['type'],
    }),
    requestRate: new Summary({
        name: 'piptip_request_rate',
        help: 'Request rate summary',
        labelNames: ['endpoint', 'method'],
        percentiles: [0.5, 0.9, 0.95, 0.99],
        maxAgeSeconds: 600,
        ageBuckets: 5,
    }),
};
// Register all metrics
Object.values(metrics).forEach(metric => {
    register.registerMetric(metric);
});
// === METRIC HELPER FUNCTIONS ===
/**
 * Update queue metrics
 */
export function updateQueueMetrics(queueName, stats) {
    Object.entries(stats).forEach(([status, count]) => {
        metrics.queueSize.set({ queue_name: queueName, status }, count);
    });
}
/**
 * Record job processing
 */
export function recordJobProcessing(queueName, jobType, status, duration) {
    metrics.jobsProcessed.inc({ queue_name: queueName, status });
    metrics.jobProcessingDuration.observe({ queue_name: queueName, job_type: jobType }, duration / 1000);
}
/**
 * Record Discord interaction
 */
export function recordDiscordInteraction(command, status, duration, guildId) {
    metrics.discordInteractions.inc({
        command,
        status,
        guild_id: guildId || 'dm'
    });
    metrics.discordInteractionDuration.observe({ command }, duration / 1000);
}
/**
 * Record database operation
 */
export function recordDatabaseOperation(operation, table, duration) {
    metrics.databaseQueryDuration.observe({ operation, table }, duration / 1000);
}
/**
 * Record market activity
 */
export function recordMarketActivity(type, data) {
    if (type === 'created') {
        metrics.marketsCreated.inc({
            creator_type: data.creatorType || 'user',
            market_type: data.marketType || 'binary',
            guild_id: data.guildId || 'unknown'
        });
    }
    else if (type === 'resolved') {
        metrics.marketsResolved.inc({
            resolution_type: data.resolutionType || 'manual',
            outcome: data.outcome || 'unknown',
            guild_id: data.guildId || 'unknown'
        });
    }
}
/**
 * Record betting activity
 */
export function recordBet(outcome, amount, tokenSymbol, guildId) {
    metrics.betsPlaced.inc({
        outcome,
        token_symbol: tokenSymbol,
        guild_id: guildId || 'unknown'
    });
    metrics.betVolume.inc({
        token_symbol: tokenSymbol,
        outcome,
        guild_id: guildId || 'unknown'
    }, amount);
}
/**
 * Record payout processing
 */
export function recordPayout(status, marketId, amount, tokenSymbol) {
    metrics.payoutsProcessed.inc({ status, market_id: marketId });
    metrics.payoutVolume.inc({ token_symbol: tokenSymbol, status }, amount);
}
/**
 * Record balance drift
 */
export function recordBalanceDrift(severity, type) {
    metrics.balanceDriftDetected.inc({ severity, type });
}
/**
 * Record error
 */
export function recordError(errorType, severity, component) {
    metrics.errors.inc({ error_type: errorType, severity, component });
    if (severity === 'critical') {
        metrics.criticalAlerts.inc({ alert_type: errorType, component });
    }
}
/**
 * Update system health metrics
 */
export function updateSystemHealth() {
    const process_memory = process.memoryUsage();
    metrics.memoryUsage.set({ type: 'rss' }, process_memory.rss);
    metrics.memoryUsage.set({ type: 'heap_used' }, process_memory.heapUsed);
    metrics.memoryUsage.set({ type: 'heap_total' }, process_memory.heapTotal);
    metrics.memoryUsage.set({ type: 'external' }, process_memory.external);
    metrics.uptime.set(process.uptime());
}
/**
 * Start periodic metrics collection
 */
export function startMetricsCollection() {
    // Update system health every 30 seconds
    setInterval(updateSystemHealth, 30000);
    // Update queue metrics every 10 seconds
    setInterval(async () => {
        try {
            const { getQueueHealth } = await import('../queues/config.js');
            const health = await getQueueHealth();
            Object.entries(health.queues).forEach(([queueName, stats]) => {
                if (stats.healthy) {
                    updateQueueMetrics(queueName, {
                        waiting: stats.waiting,
                        active: stats.active,
                        completed: stats.completed,
                        failed: stats.failed,
                    });
                }
            });
        }
        catch (error) {
            recordError('metrics_collection_failed', 'medium', 'metrics');
        }
    }, 10000);
    console.log('📊 Prometheus metrics collection started');
}
// Export the registry for /metrics endpoint
export { register };
console.log('🚀 Prometheus metrics system initialized');
