import "dotenv/config";
const counters = {
  refunds_issued_total: { single: 0, group: 0 },
  refund_failures_total: {},
  unique_violation_claims_total: 0,
  slow_queries_total: 0,
  negative_balance_attempts_total: 0
};
const lastAlertTimes = {};
const ALERT_COOLDOWN_MS = 5 * 60 * 1e3;
const SLOW_QUERY_THRESHOLD_5MIN = parseInt(process.env.SLOW_QUERY_ALERT_THRESHOLD || "25");
const METRICS_SUMMARY_INTERVAL_MS = 60 * 1e3;
let summaryInterval = null;
function startMetricsSummary() {
  if (summaryInterval) return;
  summaryInterval = setInterval(() => {
    emitMetricsSummary();
  }, METRICS_SUMMARY_INTERVAL_MS);
}
function stopMetricsSummary() {
  if (summaryInterval) {
    clearInterval(summaryInterval);
    summaryInterval = null;
  }
}
function emitMetricsSummary() {
  console.log(JSON.stringify({
    type: "metrics_summary",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    counters: {
      refunds_issued_total: counters.refunds_issued_total,
      refund_failures_total: counters.refund_failures_total,
      unique_violation_claims_total: counters.unique_violation_claims_total,
      slow_queries_total: counters.slow_queries_total,
      negative_balance_attempts_total: counters.negative_balance_attempts_total
    }
  }));
}
function incrementRefundIssued(type) {
  counters.refunds_issued_total[type]++;
  console.log(JSON.stringify({
    type: "metric_increment",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    metric: "refunds_issued_total",
    labels: { type },
    value: counters.refunds_issued_total[type]
  }));
}
function incrementRefundFailure(reason) {
  if (!counters.refund_failures_total[reason]) {
    counters.refund_failures_total[reason] = 0;
  }
  counters.refund_failures_total[reason]++;
  console.log(JSON.stringify({
    type: "metric_increment",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    metric: "refund_failures_total",
    labels: { reason },
    value: counters.refund_failures_total[reason]
  }));
  sendAlert("refund_failure", `Refund failure detected: ${reason}`, { reason });
}
function incrementUniqueViolationClaims() {
  counters.unique_violation_claims_total++;
  console.log(JSON.stringify({
    type: "metric_increment",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    metric: "unique_violation_claims_total",
    value: counters.unique_violation_claims_total
  }));
}
function incrementSlowQueries() {
  counters.slow_queries_total++;
  console.log(JSON.stringify({
    type: "metric_increment",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    metric: "slow_queries_total",
    value: counters.slow_queries_total
  }));
  checkSlowQueryAlert();
}
function incrementNegativeBalanceAttempts() {
  counters.negative_balance_attempts_total++;
  console.log(JSON.stringify({
    type: "metric_increment",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    metric: "negative_balance_attempts_total",
    value: counters.negative_balance_attempts_total
  }));
  sendAlert("negative_balance", "Negative balance attempt detected", {
    total_attempts: counters.negative_balance_attempts_total
  });
}
const slowQueryTimestamps = [];
function checkSlowQueryAlert() {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1e3;
  slowQueryTimestamps.push(now);
  while (slowQueryTimestamps.length > 0 && slowQueryTimestamps[0] < fiveMinutesAgo) {
    slowQueryTimestamps.shift();
  }
  if (slowQueryTimestamps.length > SLOW_QUERY_THRESHOLD_5MIN) {
    sendAlert("slow_queries", `Slow queries exceeded threshold: ${slowQueryTimestamps.length} in last 5 minutes`, {
      count_5min: slowQueryTimestamps.length,
      threshold: SLOW_QUERY_THRESHOLD_5MIN
    });
  }
}
import { sendGoodKnightAlert } from "./good_knight_webhooks.js";
async function sendAlert(alertType, message, context = {}) {
  console.log(`\u{1F6E1}\uFE0F Sending alert via Good Knight: ${alertType}`);
  const now = Date.now();
  const lastAlert = lastAlertTimes[alertType] || 0;
  if (now - lastAlert < ALERT_COOLDOWN_MS) {
    console.log(JSON.stringify({
      type: "alert_cooldown",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      alert_type: alertType,
      message: "Alert skipped due to cooldown"
    }));
    return;
  }
  lastAlertTimes[alertType] = now;
  const version = process.env.GIT_SHA || process.env.npm_package_version || "unknown";
  const environment = process.env.NODE_ENV || "development";
  const enhancedContext = {
    ...context,
    version,
    environment,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    priority: alertType === "negative_balance" ? "critical" : "high"
  };
  try {
    const success = await sendGoodKnightAlert("alert", `\u{1F6A8} ${alertType}`, message, enhancedContext);
    if (success) {
      console.log(JSON.stringify({
        type: "good_knight_alert_sent",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        alert_type: alertType,
        message: "Alert sent via Good Knight authorization"
      }));
    } else {
      throw new Error("Good Knight webhook authorization failed or not configured");
    }
  } catch (error) {
    console.error(JSON.stringify({
      type: "alert_error",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      alert_type: alertType,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
function getCounters() {
  return { ...counters };
}
function resetCounters() {
  counters.refunds_issued_total = { single: 0, group: 0 };
  counters.refund_failures_total = {};
  counters.unique_violation_claims_total = 0;
  counters.slow_queries_total = 0;
  counters.negative_balance_attempts_total = 0;
  slowQueryTimestamps.length = 0;
}
function getMetricsSummary() {
  return {
    refunds_issued_total: counters.refunds_issued_total,
    refund_failures_total: counters.refund_failures_total,
    unique_violation_claims_total: counters.unique_violation_claims_total,
    slow_queries_total: counters.slow_queries_total,
    negative_balance_attempts_total: counters.negative_balance_attempts_total
  };
}
async function testAlert(type, message) {
  delete lastAlertTimes[type];
  await sendAlert(type, message, { test: true });
}
if (process.env.NODE_ENV === "production" || process.env.ENABLE_METRICS === "true") {
  startMetricsSummary();
  console.log("\u{1F4CA} Metrics monitoring enabled");
}
export {
  getCounters,
  getMetricsSummary,
  incrementNegativeBalanceAttempts,
  incrementRefundFailure,
  incrementRefundIssued,
  incrementSlowQueries,
  incrementUniqueViolationClaims,
  resetCounters,
  startMetricsSummary,
  stopMetricsSummary,
  testAlert
};
//# sourceMappingURL=metrics.js.map
