import { scalingManager } from "./services/scaling_manager.js";
import { enhancedRedisCache } from "./services/redis_enhanced.js";
import { dbPerformanceOptimizer } from "./services/db_performance_optimizer.js";
import { cdnManager } from "./services/cdn_manager.js";
import cluster from "cluster";
import os from "os";
class ProductionCluster {
  startTime = Date.now();
  async initialize() {
    console.log("\u{1F680} Starting PIPTip Production Cluster...");
    console.log(`\u{1F4CA} System: ${os.cpus().length} CPUs, ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB RAM`);
    if (cluster.isPrimary) {
      await this.initializeMaster();
    } else {
      await this.initializeWorker();
    }
  }
  /**
   * Initialize master process for cluster coordination
   */
  async initializeMaster() {
    console.log(`\u{1F3AF} Master process ${process.pid} initializing...`);
    await this.initializeSharedServices();
    this.setupClusterEventHandlers();
    this.startPerformanceMonitoring();
    console.log("\u2705 Production cluster master ready");
    console.log(`\u{1F3C3} Startup time: ${Date.now() - this.startTime}ms`);
  }
  /**
   * Initialize worker process
   */
  async initializeWorker() {
    const workerId = cluster.worker?.id || "unknown";
    console.log(`\u{1F477} Worker ${workerId} (PID: ${process.pid}) initializing...`);
    try {
      const app = await import("./index.js");
      process.title = `piptip-worker-${workerId}`;
      console.log(`\u2705 Worker ${workerId} ready`);
      if (process.send) {
        process.send({
          type: "worker_ready",
          workerId,
          pid: process.pid,
          startupTime: Date.now() - this.startTime
        });
      }
    } catch (error) {
      console.error(`\u274C Worker ${workerId} failed to start:`, error);
      process.exit(1);
    }
  }
  /**
   * Initialize shared services (Redis, DB connections, etc.)
   */
  async initializeSharedServices() {
    try {
      console.log("\u{1F527} Initializing shared services...");
      console.log("\u{1F4E1} Connecting to Redis...");
      await enhancedRedisCache.testConnection();
      console.log("\u{1F5C4}\uFE0F Initializing database optimizer...");
      await dbPerformanceOptimizer.initialize();
      console.log("\u{1F30D} Initializing CDN manager...");
      const cdnStats = await cdnManager.getCDNStats();
      console.log(`\u{1F30D} CDN Status: ${cdnStats.enabled ? "enabled" : "disabled"} (${cdnStats.provider})`);
      console.log("\u2705 Shared services initialized");
    } catch (error) {
      console.error("\u274C Failed to initialize shared services:", error);
      process.exit(1);
    }
  }
  /**
   * Setup cluster event handlers for monitoring and recovery
   */
  setupClusterEventHandlers() {
    scalingManager.on("health_update", (stats) => {
      console.log(`\u{1F4CA} Cluster Health: ${stats.healthyNodes}/${stats.totalNodes} nodes, CPU: ${stats.avgCpuUsage.toFixed(1)}%, Mem: ${stats.avgMemoryUsage.toFixed(1)}%`);
    });
    scalingManager.on("scale_up", ({ from, to }) => {
      console.log(`\u{1F4C8} Scaled up: ${from} \u2192 ${to} workers`);
    });
    scalingManager.on("scale_down", ({ from, to }) => {
      console.log(`\u{1F4C9} Scaled down: ${from} \u2192 ${to} workers`);
    });
    process.on("SIGTERM", () => this.gracefulShutdown());
    process.on("SIGINT", () => this.gracefulShutdown());
    process.on("uncaughtException", (error) => {
      console.error("\u{1F6A8} Uncaught Exception in master:", error);
      this.gracefulShutdown();
    });
    process.on("unhandledRejection", (reason, promise) => {
      console.error("\u{1F6A8} Unhandled Rejection in master:", reason);
      console.error("Promise:", promise);
    });
  }
  /**
   * Start performance monitoring and metrics collection
   */
  startPerformanceMonitoring() {
    setInterval(() => {
      const stats = scalingManager.getScalingStats();
      console.log(
        `\u{1F4CA} Cluster Metrics:
        \u2022 Nodes: ${stats.currentNodes} (${stats.healthyNodes} healthy)
        \u2022 CPU: ${stats.cpuUsage.toFixed(1)}%
        \u2022 Memory: ${stats.memoryUsage.toFixed(1)}%
        \u2022 Connections: ${stats.connections.toLocaleString()}
        \u2022 Uptime: ${Math.round(stats.uptime / 60)}m`
      );
      const redisStats = enhancedRedisCache.getStats();
      if (redisStats.hitRate > 0) {
        console.log(`\u{1F4E1} Redis Cache: ${redisStats.hitRate.toFixed(1)}% hit rate, ${redisStats.totalKeys.toLocaleString()} keys`);
      }
    }, 3e4);
    setInterval(() => {
      this.generatePerformanceReport();
    }, 24 * 60 * 60 * 1e3);
  }
  /**
   * Generate comprehensive performance report
   */
  async generatePerformanceReport() {
    try {
      const clusterStats = scalingManager.getScalingStats();
      const redisStats = enhancedRedisCache.getStats();
      const dbStats = await dbPerformanceOptimizer.getPerformanceStats();
      const cdnStats = await cdnManager.getCDNStats();
      const report = {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        cluster: clusterStats,
        redis: redisStats,
        database: dbStats,
        cdn: cdnStats,
        uptime: Math.round(process.uptime() / 3600)
        // Hours
      };
      console.log(`\u{1F4C8} Daily Performance Report:
\u{1F3D7}\uFE0F  Cluster: ${clusterStats.currentNodes} nodes, ${clusterStats.healthyNodes} healthy
\u{1F4E1} Redis: ${redisStats.hitRate.toFixed(1)}% cache hit rate
\u{1F5C4}\uFE0F  Database: ${dbStats.slowQueries} slow queries, ${dbStats.cacheHitRatio.toFixed(1)}% cache hit
\u{1F30D} CDN: ${cdnStats.enabled ? cdnStats.cacheHitRate + "% hit rate" : "disabled"}
\u23F1\uFE0F  Uptime: ${report.uptime}h`);
    } catch (error) {
      console.error("\u274C Failed to generate performance report:", error);
    }
  }
  /**
   * Graceful shutdown handler
   */
  async gracefulShutdown() {
    console.log("\u{1F504} Production cluster shutting down gracefully...");
    try {
      setTimeout(() => {
        console.log("\u26A0\uFE0F Force shutdown after timeout");
        process.exit(1);
      }, 3e4);
      await enhancedRedisCache.close();
      await dbPerformanceOptimizer.close();
      console.log("\u2705 Production cluster shutdown complete");
      process.exit(0);
    } catch (error) {
      console.error("\u274C Error during graceful shutdown:", error);
      process.exit(1);
    }
  }
}
const productionCluster = new ProductionCluster();
productionCluster.initialize().catch((error) => {
  console.error("\u{1F4A5} Fatal error starting production cluster:", error);
  process.exit(1);
});
var cluster_default = productionCluster;
export {
  cluster_default as default
};
//# sourceMappingURL=cluster.js.map
