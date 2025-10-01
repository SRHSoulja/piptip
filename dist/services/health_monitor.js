import { dbCircuitBreaker, discordCircuitBreaker } from "./circuit_breaker.js";
class HealthMonitor {
  startTime = Date.now();
  lastHealthCheck = 0;
  cachedHealth = null;
  async getHealth() {
    const now = Date.now();
    if (this.cachedHealth && now - this.lastHealthCheck < 3e4) {
      return this.cachedHealth;
    }
    const health = {
      status: "healthy",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      components: {
        database: await this.checkDatabase(),
        discord: this.checkDiscord(),
        timers: await this.checkTimers(),
        memory: this.checkMemory()
      },
      uptime: Math.floor((now - this.startTime) / 1e3)
    };
    const componentStatuses = Object.values(health.components).map((c) => c.status);
    if (componentStatuses.includes("unhealthy")) {
      health.status = "unhealthy";
    } else if (componentStatuses.includes("degraded")) {
      health.status = "degraded";
    }
    this.cachedHealth = health;
    this.lastHealthCheck = now;
    return health;
  }
  async checkDatabase() {
    const circuitState = dbCircuitBreaker.getState();
    if (circuitState.state === "OPEN") {
      return {
        status: "unhealthy",
        message: `Circuit breaker OPEN (${circuitState.failureCount} failures)`
      };
    }
    try {
      const start = Date.now();
      const { resilientDb } = await import("./resilient_db.js");
      const isHealthy = await resilientDb.healthCheck(2e3);
      const latency = Date.now() - start;
      if (!isHealthy) {
        return {
          status: "unhealthy",
          message: "Database connection failed",
          latency
        };
      }
      if (latency > 1e3) {
        return { status: "degraded", message: "High latency", latency };
      }
      return { status: "healthy", latency };
    } catch (error) {
      const isConnectionError = error.message?.includes("terminating connection") || error.message?.includes("administrator command");
      return {
        status: "unhealthy",
        message: isConnectionError ? "DB connection terminated" : error.message.slice(0, 100)
      };
    }
  }
  checkDiscord() {
    const circuitState = discordCircuitBreaker.getState();
    if (circuitState.state === "OPEN") {
      return {
        status: "degraded",
        message: `Circuit breaker OPEN (${circuitState.failureCount} failures)`
      };
    }
    return { status: "healthy" };
  }
  async checkTimers() {
    try {
      const { getTimerStatus } = await import("../features/group_tip_expiry.js");
      const timerStats = getTimerStatus();
      return {
        status: "healthy",
        message: `${timerStats.active} active timers`
      };
    } catch (error) {
      return {
        status: "degraded",
        message: "Timer status unavailable"
      };
    }
  }
  checkMemory() {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
    if (heapUsedMB > 1800) {
      return {
        status: "degraded",
        message: `High memory usage: ${heapUsedMB}MB/${heapTotalMB}MB`
      };
    }
    return {
      status: "healthy",
      message: `${heapUsedMB}MB/${heapTotalMB}MB`
    };
  }
  startPeriodicHealthChecks() {
    setInterval(async () => {
      try {
        const health = await this.getHealth();
        if (health.status !== "healthy") {
          console.warn("Health check:", JSON.stringify(health, null, 2));
        }
      } catch (error) {
        console.error("Health check failed:", error);
      }
    }, 3e5);
  }
}
const healthMonitor = new HealthMonitor();
async function healthEndpoint(req, res) {
  try {
    const health = await healthMonitor.getHealth();
    const statusCode = {
      "healthy": 200,
      "degraded": 200,
      "unhealthy": 503
    }[health.status];
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      message: error.message,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
}
export {
  healthEndpoint,
  healthMonitor
};
//# sourceMappingURL=health_monitor.js.map
