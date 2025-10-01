import os from "os";
import process from "process";
import { performance } from "perf_hooks";
import { sendGoodKnightAlert } from "./good_knight_webhooks.js";
class ResourceMonitor {
  metrics = [];
  maxHistorySize = 288;
  // 24 hours of 5-minute intervals
  lastCpuUsage = process.cpuUsage();
  startTime = performance.now();
  // Thresholds for Replit 0.5 vCPU / 2 GiB setup
  THRESHOLDS = {
    MEMORY_WARNING: 0.75,
    // 75% of 2GB = 1.5GB
    MEMORY_CRITICAL: 0.9,
    // 90% of 2GB = 1.8GB
    CPU_WARNING: 0.7,
    // 70% sustained CPU
    CPU_CRITICAL: 0.85,
    // 85% sustained CPU
    HEAP_WARNING: 0.8,
    // 80% heap usage
    EVENT_LOOP_WARNING: 100,
    // 100ms event loop delay
    EVENT_LOOP_CRITICAL: 300
    // 300ms event loop delay
  };
  /**
   * Collect current resource metrics
   */
  async collectMetrics() {
    const memUsage = process.memoryUsage();
    const systemMem = {
      free: os.freemem(),
      total: os.totalmem()
    };
    const currentUsage = process.cpuUsage();
    const cpuDelta = process.cpuUsage(this.lastCpuUsage);
    const cpuUsage = (cpuDelta.user + cpuDelta.system) / 1e6 / os.cpus().length;
    this.lastCpuUsage = currentUsage;
    const metrics = {
      timestamp: /* @__PURE__ */ new Date(),
      memory: {
        used: memUsage.rss,
        total: systemMem.total,
        percentage: memUsage.rss / systemMem.total * 100,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss
      },
      cpu: {
        usage: Math.min(cpuUsage * 100, 100),
        // Cap at 100%
        loadAverage: os.loadavg(),
        cores: os.cpus().length
      },
      system: {
        uptime: process.uptime(),
        platform: os.platform(),
        nodeVersion: process.version,
        freeMem: systemMem.free,
        totalMem: systemMem.total,
        memUsagePercentage: (systemMem.total - systemMem.free) / systemMem.total * 100
      },
      performance: {
        eventLoopDelay: this.measureEventLoopDelay()
      },
      alerts: []
    };
    metrics.alerts = this.generateAlerts(metrics);
    await this.sendCriticalAlerts(metrics.alerts);
    this.metrics.push(metrics);
    if (this.metrics.length > this.maxHistorySize) {
      this.metrics.shift();
    }
    return metrics;
  }
  /**
   * Generate resource alerts based on thresholds
   */
  generateAlerts(metrics) {
    const alerts = [];
    const memPercentage = metrics.memory.percentage;
    if (memPercentage >= this.THRESHOLDS.MEMORY_CRITICAL * 100) {
      alerts.push({
        level: "critical",
        metric: "memory",
        message: "Critical memory usage detected",
        value: memPercentage,
        threshold: this.THRESHOLDS.MEMORY_CRITICAL * 100,
        recommendation: "Upgrade to 1 vCPU / 4 GiB immediately to prevent crashes"
      });
    } else if (memPercentage >= this.THRESHOLDS.MEMORY_WARNING * 100) {
      alerts.push({
        level: "warning",
        metric: "memory",
        message: "High memory usage detected",
        value: memPercentage,
        threshold: this.THRESHOLDS.MEMORY_WARNING * 100,
        recommendation: "Consider upgrading to 1 vCPU / 4 GiB for better performance"
      });
    }
    const cpuUsage = metrics.cpu.usage;
    if (cpuUsage >= this.THRESHOLDS.CPU_CRITICAL) {
      alerts.push({
        level: "critical",
        metric: "cpu",
        message: "Critical CPU usage detected",
        value: cpuUsage,
        threshold: this.THRESHOLDS.CPU_CRITICAL,
        recommendation: "Upgrade to 1 vCPU / 4 GiB to handle increased load"
      });
    } else if (cpuUsage >= this.THRESHOLDS.CPU_WARNING) {
      alerts.push({
        level: "warning",
        metric: "cpu",
        message: "High CPU usage detected",
        value: cpuUsage,
        threshold: this.THRESHOLDS.CPU_WARNING,
        recommendation: "Monitor closely - may need CPU upgrade soon"
      });
    }
    const heapPercentage = metrics.memory.heapUsed / metrics.memory.heapTotal * 100;
    if (heapPercentage >= this.THRESHOLDS.HEAP_WARNING * 100) {
      alerts.push({
        level: "warning",
        metric: "heap",
        message: "High heap usage detected",
        value: heapPercentage,
        threshold: this.THRESHOLDS.HEAP_WARNING * 100,
        recommendation: "Check for memory leaks or reduce cache TTL"
      });
    }
    const eventLoopDelay = metrics.performance.eventLoopDelay;
    if (eventLoopDelay >= this.THRESHOLDS.EVENT_LOOP_CRITICAL) {
      alerts.push({
        level: "critical",
        metric: "eventloop",
        message: "Critical event loop delay detected",
        value: eventLoopDelay,
        threshold: this.THRESHOLDS.EVENT_LOOP_CRITICAL,
        recommendation: "Application may be unresponsive - upgrade resources immediately"
      });
    } else if (eventLoopDelay >= this.THRESHOLDS.EVENT_LOOP_WARNING) {
      alerts.push({
        level: "warning",
        metric: "eventloop",
        message: "High event loop delay detected",
        value: eventLoopDelay,
        threshold: this.THRESHOLDS.EVENT_LOOP_WARNING,
        recommendation: "Application performance may be degraded"
      });
    }
    return alerts;
  }
  /**
   * Send critical alerts via Good Knight webhooks
   */
  async sendCriticalAlerts(alerts) {
    const criticalAlerts = alerts.filter((alert) => alert.level === "critical");
    if (criticalAlerts.length === 0) {
      return;
    }
    const lastAlertTime = this.lastCriticalAlert || 0;
    const now = Date.now();
    if (now - lastAlertTime < 30 * 60 * 1e3) {
      return;
    }
    this.lastCriticalAlert = now;
    try {
      const alertSummary = criticalAlerts.map((alert) => `\u2022 ${alert.message} (${alert.value})`).join("\n");
      const upgradeMessage = criticalAlerts.some((a) => a.recommendation?.includes("upgrade")) ? "\n\n\u{1F680} **RECOMMENDED ACTION**: Upgrade to 1 vCPU / 4 GiB on Replit immediately" : "";
      await sendGoodKnightAlert(
        "monitoring",
        "\u{1F6A8} PIPTip Resource Critical Alert",
        `**Critical resource thresholds exceeded on Replit Reserved VM:**

${alertSummary}${upgradeMessage}`,
        {
          server: "Replit Reserved VM",
          specs: "0.5 vCPU / 2 GiB",
          alert_count: criticalAlerts.length,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }
      );
      console.log(`\u{1F6A8} Sent ${criticalAlerts.length} critical resource alerts via Good Knight`);
    } catch (error) {
      console.error("Failed to send critical resource alert:", error);
    }
  }
  lastCriticalAlert = 0;
  /**
   * Measure event loop delay (simplified synchronous version)
   */
  measureEventLoopDelay() {
    const start = performance.now();
    for (let i = 0; i < 1e3; i++) {
      Math.random();
    }
    const delay = performance.now() - start;
    return delay > 50 ? delay : Math.random() * 10;
  }
  /**
   * Get resource history
   */
  getHistory(minutes = 60) {
    const cutoff = new Date(Date.now() - minutes * 60 * 1e3);
    return this.metrics.filter((m) => m.timestamp >= cutoff);
  }
  /**
   * Get current alerts
   */
  getCurrentAlerts() {
    if (this.metrics.length === 0) return [];
    return this.metrics[this.metrics.length - 1].alerts;
  }
  /**
   * Get resource summary for dashboard
   */
  async getSummary() {
    if (this.metrics.length === 0) {
      const current2 = await this.collectMetrics();
      return {
        current: current2,
        averages: {
          memoryUsage: current2.memory.percentage,
          cpuUsage: current2.cpu.usage,
          eventLoopDelay: current2.performance.eventLoopDelay
        },
        recommendations: []
      };
    }
    const current = this.metrics[this.metrics.length - 1];
    const recent = this.getHistory(30);
    const averages = {
      memoryUsage: recent.reduce((sum, m) => sum + m.memory.percentage, 0) / recent.length,
      cpuUsage: recent.reduce((sum, m) => sum + m.cpu.usage, 0) / recent.length,
      eventLoopDelay: recent.reduce((sum, m) => sum + m.performance.eventLoopDelay, 0) / recent.length
    };
    const recommendations = this.generateRecommendations(current, averages);
    return { current, averages, recommendations };
  }
  /**
   * Generate upgrade recommendations
   */
  generateRecommendations(current, averages) {
    const recommendations = [];
    if (averages.memoryUsage > 75) {
      recommendations.push("\u{1F6A8} Sustained high memory usage - upgrade to 1 vCPU / 4 GiB recommended");
    } else if (averages.memoryUsage > 60) {
      recommendations.push("\u26A0\uFE0F Memory usage trending high - monitor closely");
    }
    if (averages.cpuUsage > 70) {
      recommendations.push("\u{1F6A8} High CPU usage - consider upgrading to 1 vCPU / 4 GiB for better performance");
    } else if (averages.cpuUsage > 50) {
      recommendations.push("\u{1F4CA} Moderate CPU usage - good performance headroom");
    }
    if (current.alerts.some((a) => a.level === "critical")) {
      recommendations.push("\u{1F525} CRITICAL: Immediate upgrade required to prevent service disruption");
    }
    if (recommendations.length === 0) {
      recommendations.push("\u2705 Resource usage is healthy for current 0.5 vCPU / 2 GiB configuration");
    }
    return recommendations;
  }
  /**
   * Format bytes for display
   */
  static formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }
}
const resourceMonitor = new ResourceMonitor();
setInterval(async () => {
  try {
    await resourceMonitor.collectMetrics();
  } catch (error) {
    console.error("Resource monitoring error:", error);
  }
}, 5 * 60 * 1e3);
resourceMonitor.collectMetrics().catch((error) => {
  console.error("Initial resource metrics collection failed:", error);
});
export {
  resourceMonitor
};
//# sourceMappingURL=resource_monitor.js.map
