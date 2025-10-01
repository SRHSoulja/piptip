import express from "express";
import { healthCheckQuery } from "../services/prisma_logger.js";
import { getMetricsSummary } from "../services/metrics.js";
import { healthEndpoint } from "../services/health_monitor.js";
const healthRouter = express.Router();
healthRouter.get("/healthz", async (req, res) => {
  try {
    const startTime = Date.now();
    const dbHealthy = await healthCheckQuery(200);
    const responseTime = Date.now() - startTime;
    if (dbHealthy) {
      res.status(200).json({
        status: "healthy",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        version: process.env.GIT_SHA || process.env.npm_package_version || "1.0.0",
        db: {
          status: "connected",
          response_time_ms: responseTime
        }
      });
    } else {
      res.status(503).json({
        status: "unhealthy",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        version: process.env.GIT_SHA || process.env.npm_package_version || "1.0.0",
        db: {
          status: "disconnected",
          response_time_ms: responseTime
        }
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(503).json({
      status: "unhealthy",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      version: process.env.GIT_SHA || process.env.npm_package_version || "1.0.0",
      error: errorMessage,
      db: {
        status: "error"
      }
    });
  }
});
healthRouter.get("/healthz/detailed", async (req, res) => {
  try {
    const startTime = Date.now();
    const dbHealthy = await healthCheckQuery(1e3);
    const responseTime = Date.now() - startTime;
    const metrics = getMetricsSummary();
    const healthData = {
      status: dbHealthy ? "healthy" : "unhealthy",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      version: process.env.GIT_SHA || process.env.npm_package_version || "1.0.0",
      uptime_seconds: Math.floor(process.uptime()),
      memory_usage: {
        heap_used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heap_total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
      },
      db: {
        status: dbHealthy ? "connected" : "disconnected",
        response_time_ms: responseTime
      },
      metrics: {
        refunds_issued_total: metrics.refunds_issued_total,
        refund_failures_total: metrics.refund_failures_total,
        unique_violation_claims_total: metrics.unique_violation_claims_total,
        slow_queries_total: metrics.slow_queries_total,
        negative_balance_attempts_total: metrics.negative_balance_attempts_total
      }
    };
    res.status(dbHealthy ? 200 : 503).json(healthData);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(503).json({
      status: "unhealthy",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      version: process.env.GIT_SHA || process.env.npm_package_version || "1.0.0",
      error: errorMessage,
      db: {
        status: "error"
      }
    });
  }
});
healthRouter.get("/monitoring", healthEndpoint);
healthRouter.get("/", (_req, res) => {
  res.json({ ok: true, service: "piptip", status: "healthy" });
});
export {
  healthRouter
};
//# sourceMappingURL=health.js.map
