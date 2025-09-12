// src/services/metrics.ts - Production metrics and monitoring
import 'dotenv/config';

// Counter storage
interface CounterStore {
  refunds_issued_total: { single: number; group: number };
  refund_failures_total: Record<string, number>;
  unique_violation_claims_total: number;
  slow_queries_total: number;
  negative_balance_attempts_total: number;
}

// In-process metrics store
const counters: CounterStore = {
  refunds_issued_total: { single: 0, group: 0 },
  refund_failures_total: {},
  unique_violation_claims_total: 0,
  slow_queries_total: 0,
  negative_balance_attempts_total: 0,
};

// Last alert timestamps to prevent spam
const lastAlertTimes: Record<string, number> = {};
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Configuration
const SLOW_QUERY_THRESHOLD_5MIN = parseInt(process.env.SLOW_QUERY_ALERT_THRESHOLD || '25');
const METRICS_SUMMARY_INTERVAL_MS = 60 * 1000; // 60 seconds

// Start periodic metrics summary
let summaryInterval: NodeJS.Timeout | null = null;

export function startMetricsSummary(): void {
  if (summaryInterval) return;
  
  summaryInterval = setInterval(() => {
    emitMetricsSummary();
  }, METRICS_SUMMARY_INTERVAL_MS);
}

export function stopMetricsSummary(): void {
  if (summaryInterval) {
    clearInterval(summaryInterval);
    summaryInterval = null;
  }
}

// Emit structured log line for metrics summary
function emitMetricsSummary(): void {
  console.log(JSON.stringify({
    type: 'metrics_summary',
    timestamp: new Date().toISOString(),
    counters: {
      refunds_issued_total: counters.refunds_issued_total,
      refund_failures_total: counters.refund_failures_total,
      unique_violation_claims_total: counters.unique_violation_claims_total,
      slow_queries_total: counters.slow_queries_total,
      negative_balance_attempts_total: counters.negative_balance_attempts_total,
    }
  }));
}

// Counter increment functions with structured logging
export function incrementRefundIssued(type: 'single' | 'group'): void {
  counters.refunds_issued_total[type]++;
  
  console.log(JSON.stringify({
    type: 'metric_increment',
    timestamp: new Date().toISOString(),
    metric: 'refunds_issued_total',
    labels: { type },
    value: counters.refunds_issued_total[type]
  }));
}

export function incrementRefundFailure(reason: string): void {
  if (!counters.refund_failures_total[reason]) {
    counters.refund_failures_total[reason] = 0;
  }
  counters.refund_failures_total[reason]++;
  
  console.log(JSON.stringify({
    type: 'metric_increment',
    timestamp: new Date().toISOString(),
    metric: 'refund_failures_total',
    labels: { reason },
    value: counters.refund_failures_total[reason]
  }));
  
  // Trigger alert for refund failures
  sendAlert('refund_failure', `Refund failure detected: ${reason}`, { reason });
}

export function incrementUniqueViolationClaims(): void {
  counters.unique_violation_claims_total++;
  
  console.log(JSON.stringify({
    type: 'metric_increment',
    timestamp: new Date().toISOString(),
    metric: 'unique_violation_claims_total',
    value: counters.unique_violation_claims_total
  }));
}

export function incrementSlowQueries(): void {
  counters.slow_queries_total++;
  
  console.log(JSON.stringify({
    type: 'metric_increment',
    timestamp: new Date().toISOString(),
    metric: 'slow_queries_total',
    value: counters.slow_queries_total
  }));
  
  // Check if we should alert on slow queries (last 5 minutes)
  checkSlowQueryAlert();
}

export function incrementNegativeBalanceAttempts(): void {
  counters.negative_balance_attempts_total++;
  
  console.log(JSON.stringify({
    type: 'metric_increment',
    timestamp: new Date().toISOString(),
    metric: 'negative_balance_attempts_total',
    value: counters.negative_balance_attempts_total
  }));
  
  // Immediate alert for negative balance attempts (should be 0 in steady state)
  sendAlert('negative_balance', 'Negative balance attempt detected', {
    total_attempts: counters.negative_balance_attempts_total
  });
}

// Slow query tracking for 5-minute window
const slowQueryTimestamps: number[] = [];

function checkSlowQueryAlert(): void {
  const now = Date.now();
  const fiveMinutesAgo = now - (5 * 60 * 1000);
  
  // Add current timestamp
  slowQueryTimestamps.push(now);
  
  // Remove timestamps older than 5 minutes
  while (slowQueryTimestamps.length > 0 && slowQueryTimestamps[0] < fiveMinutesAgo) {
    slowQueryTimestamps.shift();
  }
  
  // Check if we exceed threshold
  if (slowQueryTimestamps.length > SLOW_QUERY_THRESHOLD_5MIN) {
    sendAlert('slow_queries', `Slow queries exceeded threshold: ${slowQueryTimestamps.length} in last 5 minutes`, {
      count_5min: slowQueryTimestamps.length,
      threshold: SLOW_QUERY_THRESHOLD_5MIN
    });
  }
}

// Discord webhook alerting
async function sendAlert(alertType: string, message: string, context: Record<string, any> = {}): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('Discord webhook URL not configured, skipping alert');
    return;
  }
  
  // Check cooldown to prevent spam
  const now = Date.now();
  const lastAlert = lastAlertTimes[alertType] || 0;
  
  if (now - lastAlert < ALERT_COOLDOWN_MS) {
    console.log(JSON.stringify({
      type: 'alert_cooldown',
      timestamp: new Date().toISOString(),
      alert_type: alertType,
      message: 'Alert skipped due to cooldown'
    }));
    return;
  }
  
  lastAlertTimes[alertType] = now;
  
  // Get version info
  const version = process.env.GIT_SHA || process.env.npm_package_version || 'unknown';
  const environment = process.env.NODE_ENV || 'development';
  
  // Construct Discord message
  const embed = {
    title: `🚨 PIPTip Alert: ${alertType}`,
    description: message,
    color: alertType === 'negative_balance' ? 0xff0000 : 0xffaa00, // Red for negative balance, orange for others
    fields: [
      { name: 'Environment', value: environment, inline: true },
      { name: 'Version', value: version, inline: true },
      { name: 'Timestamp', value: new Date().toISOString(), inline: true },
      ...Object.entries(context).map(([key, value]) => ({
        name: key,
        value: String(value),
        inline: true
      }))
    ],
    footer: {
      text: 'PIPTip Monitoring'
    }
  };
  
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [embed]
      })
    });
    
    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
    }
    
    console.log(JSON.stringify({
      type: 'alert_sent',
      timestamp: new Date().toISOString(),
      alert_type: alertType,
      message: 'Discord alert sent successfully'
    }));
    
  } catch (error) {
    console.error(JSON.stringify({
      type: 'alert_error',
      timestamp: new Date().toISOString(),
      alert_type: alertType,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}

// Export counters for health checks and testing
export function getCounters(): CounterStore {
  return { ...counters };
}

// Reset counters (for testing)
export function resetCounters(): void {
  counters.refunds_issued_total = { single: 0, group: 0 };
  counters.refund_failures_total = {};
  counters.unique_violation_claims_total = 0;
  counters.slow_queries_total = 0;
  counters.negative_balance_attempts_total = 0;
  slowQueryTimestamps.length = 0;
}

// Get current metrics summary
export function getMetricsSummary(): any {
  return {
    refunds_issued_total: counters.refunds_issued_total,
    refund_failures_total: counters.refund_failures_total,
    unique_violation_claims_total: counters.unique_violation_claims_total,
    slow_queries_total: counters.slow_queries_total,
    negative_balance_attempts_total: counters.negative_balance_attempts_total
  };
}

// Force alert for testing
export async function testAlert(type: string, message: string): Promise<void> {
  // Bypass cooldown for testing
  delete lastAlertTimes[type];
  await sendAlert(type, message, { test: true });
}

// Initialize metrics on module load
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_METRICS === 'true') {
  startMetricsSummary();
  console.log('📊 Metrics monitoring enabled');
}