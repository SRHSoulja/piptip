import { Router } from "express";
import { resourceMonitor } from "../../services/resource_monitor.js";
import { viewOnlyAdminMiddleware } from "../../services/admin_auth.js";
const router = Router();
router.use(viewOnlyAdminMiddleware());
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}
router.get("/", async (req, res) => {
  try {
    const summary = await resourceMonitor.getSummary();
    res.json({
      success: true,
      data: {
        current: {
          memory: {
            used: formatBytes(summary.current.memory.used),
            total: formatBytes(summary.current.memory.total),
            percentage: Math.round(summary.current.memory.percentage * 100) / 100,
            heap: {
              used: formatBytes(summary.current.memory.heapUsed),
              total: formatBytes(summary.current.memory.heapTotal),
              percentage: Math.round(summary.current.memory.heapUsed / summary.current.memory.heapTotal * 100)
            }
          },
          cpu: {
            usage: Math.round(summary.current.cpu.usage * 100) / 100,
            cores: summary.current.cpu.cores,
            loadAverage: summary.current.cpu.loadAverage.map((avg) => Math.round(avg * 100) / 100)
          },
          system: {
            uptime: Math.round(summary.current.system.uptime),
            platform: summary.current.system.platform,
            nodeVersion: summary.current.system.nodeVersion,
            freeMem: formatBytes(summary.current.system.freeMem),
            totalMem: formatBytes(summary.current.system.totalMem),
            memUsagePercentage: Math.round(summary.current.system.memUsagePercentage * 100) / 100
          },
          performance: {
            eventLoopDelay: Math.round(summary.current.performance.eventLoopDelay * 100) / 100
          }
        },
        averages: {
          memoryUsage: Math.round(summary.averages.memoryUsage * 100) / 100,
          cpuUsage: Math.round(summary.averages.cpuUsage * 100) / 100,
          eventLoopDelay: Math.round(summary.averages.eventLoopDelay * 100) / 100
        },
        alerts: summary.current.alerts,
        recommendations: summary.recommendations,
        timestamp: summary.current.timestamp
      }
    });
  } catch (error) {
    console.error("Resource monitoring error:", error);
    res.status(500).json({ success: false, error: "Failed to collect resource metrics" });
  }
});
router.get("/history", async (req, res) => {
  try {
    const minutes = parseInt(req.query.minutes) || 60;
    const maxMinutes = 720;
    const actualMinutes = Math.min(minutes, maxMinutes);
    const history = resourceMonitor.getHistory(actualMinutes);
    const formattedHistory = history.map((metric) => ({
      timestamp: metric.timestamp,
      memory: Math.round(metric.memory.percentage * 100) / 100,
      cpu: Math.round(metric.cpu.usage * 100) / 100,
      eventLoopDelay: Math.round(metric.performance.eventLoopDelay * 100) / 100,
      alertCount: metric.alerts.length,
      criticalAlerts: metric.alerts.filter((a) => a.level === "critical").length
    }));
    res.json({
      success: true,
      data: {
        history: formattedHistory,
        timeframe: `${actualMinutes} minutes`,
        dataPoints: formattedHistory.length
      }
    });
  } catch (error) {
    console.error("Resource history error:", error);
    res.status(500).json({ success: false, error: "Failed to retrieve resource history" });
  }
});
router.get("/alerts", async (req, res) => {
  try {
    const alerts = resourceMonitor.getCurrentAlerts();
    res.json({
      success: true,
      data: {
        alerts,
        summary: {
          total: alerts.length,
          critical: alerts.filter((a) => a.level === "critical").length,
          warning: alerts.filter((a) => a.level === "warning").length,
          info: alerts.filter((a) => a.level === "info").length
        }
      }
    });
  } catch (error) {
    console.error("Resource alerts error:", error);
    res.status(500).json({ success: false, error: "Failed to retrieve alerts" });
  }
});
router.get("/upgrade-check", async (req, res) => {
  try {
    const summary = await resourceMonitor.getSummary();
    const alerts = summary.current.alerts;
    const upgradeNeeded = {
      immediate: alerts.some((a) => a.level === "critical"),
      recommended: alerts.some((a) => a.level === "warning") || summary.averages.memoryUsage > 75 || summary.averages.cpuUsage > 70,
      currentSpecs: {
        vcpu: 0.5,
        ram: "2 GiB",
        cost: "Lower tier"
      },
      recommendedSpecs: {
        vcpu: 1,
        ram: "4 GiB",
        cost: "Higher tier, better performance"
      },
      reasoning: []
    };
    if (summary.averages.memoryUsage > 75) {
      upgradeNeeded.reasoning.push("High average memory usage (>75%)");
    }
    if (summary.averages.cpuUsage > 70) {
      upgradeNeeded.reasoning.push("High average CPU usage (>70%)");
    }
    if (alerts.some((a) => a.level === "critical")) {
      upgradeNeeded.reasoning.push("Critical resource alerts detected");
    }
    if (summary.current.performance.eventLoopDelay > 100) {
      upgradeNeeded.reasoning.push("High event loop delay affecting performance");
    }
    if (upgradeNeeded.reasoning.length === 0 && !upgradeNeeded.recommended) {
      upgradeNeeded.reasoning.push("Current resources are sufficient for current load");
    }
    res.json({
      success: true,
      data: upgradeNeeded
    });
  } catch (error) {
    console.error("Upgrade check error:", error);
    res.status(500).json({ success: false, error: "Failed to perform upgrade check" });
  }
});
export {
  router as resourcesRouter
};
//# sourceMappingURL=resources.js.map
