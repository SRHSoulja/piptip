import { metrics, recordError } from "../metrics/index.js";
import { createLogger } from "../utils/logger.js";
const logger = createLogger("metrics-middleware");
const metricsMiddleware = (req, res, next) => {
  const startTime = Date.now();
  const route = req.route?.path || req.path;
  metrics.requestRate.observe(
    { endpoint: route, method: req.method },
    1
  );
  res.on("finish", () => {
    const duration = (Date.now() - startTime) / 1e3;
    try {
      const statusClass = Math.floor(res.statusCode / 100);
      metrics.requestRate.observe(
        { endpoint: route, method: req.method },
        duration
      );
      if (duration > 5) {
        logger.warn({
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration,
          userAgent: req.get("user-agent")
        }, "Slow request detected");
      }
      if (statusClass >= 4) {
        recordError(
          `http_${statusClass}xx`,
          statusClass === 5 ? "high" : "medium",
          "http"
        );
      }
    } catch (error) {
      logger.error({ error }, "Failed to record request metrics");
    }
  });
  next();
};
const databaseMetricsWrapper = (operation, table, queryFn) => {
  const startTime = Date.now();
  return queryFn().then((result) => {
    const duration = Date.now() - startTime;
    metrics.databaseQueryDuration.observe({ operation, table }, duration / 1e3);
    if (duration > 1e3) {
      logger.warn({
        operation,
        table,
        duration
      }, "Slow database query detected");
    }
    return result;
  }).catch((error) => {
    const duration = Date.now() - startTime;
    metrics.databaseQueryDuration.observe({ operation, table }, duration / 1e3);
    recordError("database_query_failed", "high", "database");
    logger.error({
      operation,
      table,
      duration,
      error
    }, "Database query failed");
    throw error;
  });
};
const redisMetricsWrapper = (operation, operationFn) => {
  const startTime = Date.now();
  return operationFn().then((result) => {
    const duration = Date.now() - startTime;
    metrics.redisOperationDuration.observe({ operation }, duration / 1e3);
    return result;
  }).catch((error) => {
    const duration = Date.now() - startTime;
    metrics.redisOperationDuration.observe({ operation }, duration / 1e3);
    recordError("redis_operation_failed", "high", "redis");
    logger.error({
      operation,
      duration,
      error
    }, "Redis operation failed");
    throw error;
  });
};
const trackDatabaseConnections = (count) => {
  metrics.databaseConnections.set(count);
};
const updateActiveMarketCount = async () => {
  try {
    const { prisma } = await import("../services/db.js");
    const activeMarketsByGuild = await prisma.predictionMarket.groupBy({
      by: ["creatorId"],
      // Using creatorId as proxy for guild - adjust if needed
      where: {
        status: "ACTIVE"
      },
      _count: {
        id: true
      }
    });
    activeMarketsByGuild.forEach(({ creatorId, _count }) => {
      metrics.activeMarkets.set({ guild_id: creatorId || "unknown" }, _count.id);
    });
    const tvlByToken = await prisma.predictionMarket.groupBy({
      by: ["tokenSymbol"],
      where: {
        status: { in: ["ACTIVE", "RESOLVED"] }
      },
      _sum: {
        totalYesBets: true,
        totalNoBets: true
      }
    });
    tvlByToken.forEach(({ tokenSymbol, _sum }) => {
      const totalLocked = (_sum.totalYesBets || 0) + (_sum.totalNoBets || 0);
      metrics.totalValueLocked.set({ token_symbol: tokenSymbol || "unknown" }, totalLocked);
    });
  } catch (error) {
    recordError("metrics_update_failed", "medium", "metrics");
    logger.error({ error }, "Failed to update active market metrics");
  }
};
const startBusinessMetricsCollection = () => {
  setInterval(updateActiveMarketCount, 12e4);
  setInterval(async () => {
    try {
      const { prisma } = await import("../services/db.js");
      const activeUsers24h = await prisma.predictionParticipation.groupBy({
        by: ["userId"],
        where: {
          createdAt: {
            gte: new Date(Date.now() - 864e5)
            // 24 hours
          }
        },
        _count: {
          userId: true
        }
      });
      metrics.activeUsers.set(
        { period: "24h", guild_id: "all" },
        activeUsers24h.length
      );
      const activeUsers7d = await prisma.predictionParticipation.groupBy({
        by: ["userId"],
        where: {
          createdAt: {
            gte: new Date(Date.now() - 6048e5)
            // 7 days
          }
        },
        _count: {
          userId: true
        }
      });
      metrics.activeUsers.set(
        { period: "7d", guild_id: "all" },
        activeUsers7d.length
      );
    } catch (error) {
      recordError("user_metrics_failed", "low", "metrics");
      logger.error({ error }, "Failed to update user activity metrics");
    }
  }, 3e5);
  logger.info("Business metrics collection started");
};
console.log("\u{1F680} Metrics middleware initialized");
export {
  databaseMetricsWrapper,
  metricsMiddleware,
  redisMetricsWrapper,
  startBusinessMetricsCollection,
  trackDatabaseConnections,
  updateActiveMarketCount
};
//# sourceMappingURL=metrics.js.map
