import { execSync } from "child_process";
class SyncMonitor {
  prisma;
  checkInterval = null;
  lastStatus = {
    lastCheck: /* @__PURE__ */ new Date(),
    schemaInSync: false,
    migrationsApplied: false,
    connectionHealthy: false,
    issues: []
  };
  constructor(prisma) {
    this.prisma = prisma;
  }
  async checkSync() {
    const status = {
      lastCheck: /* @__PURE__ */ new Date(),
      schemaInSync: false,
      migrationsApplied: false,
      connectionHealthy: false,
      issues: []
    };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      status.connectionHealthy = true;
    } catch (error) {
      status.issues.push(`Database connection failed: ${error.message}`);
    }
    try {
      const diff = execSync("npx prisma db diff --exit-code --schema=./prisma/schema.prisma", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      });
      status.schemaInSync = !diff.trim();
    } catch (error) {
      if (error.status === 2) {
        status.issues.push("Schema drift detected - Prisma schema differs from database");
      } else {
        status.issues.push(`Schema check failed: ${error.message}`);
      }
    }
    try {
      const migrationStatus = execSync("npx prisma migrate status", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      });
      status.migrationsApplied = migrationStatus.includes("Database schema is up to date");
      if (!status.migrationsApplied) {
        status.issues.push("Pending migrations detected");
      }
    } catch (error) {
      status.issues.push(`Migration status check failed: ${error.message}`);
    }
    this.lastStatus = status;
    return status;
  }
  async autoFixSync() {
    console.log("\u{1F527} Auto-fixing synchronization issues...");
    try {
      console.log("   \u{1F4E6} Regenerating Prisma client...");
      execSync("npx prisma generate", { stdio: "inherit" });
      if (!this.lastStatus.migrationsApplied) {
        console.log("   \u{1F4DD} Applying pending migrations...");
        try {
          execSync("npx prisma migrate deploy", { stdio: "inherit" });
        } catch (error) {
          console.warn("   \u26A0\uFE0F  Migration failed - manual intervention may be needed");
          return false;
        }
      }
      const newStatus = await this.checkSync();
      const isFixed = newStatus.schemaInSync && newStatus.migrationsApplied && newStatus.connectionHealthy;
      if (isFixed) {
        console.log("   \u2705 Sync issues automatically resolved");
      } else {
        console.log("   \u274C Could not automatically resolve all issues");
        newStatus.issues.forEach((issue) => console.log(`      \u2022 ${issue}`));
      }
      return isFixed;
    } catch (error) {
      console.error("   \u274C Auto-fix failed:", error.message);
      return false;
    }
  }
  startMonitoring(intervalMinutes = 5) {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    console.log(`\u{1F504} Starting sync monitoring (checking every ${intervalMinutes} minutes)`);
    this.checkSync().then((status) => {
      this.logStatus(status);
    }).catch((error) => {
      console.error("Initial sync check failed:", error);
    });
    this.checkInterval = setInterval(async () => {
      try {
        const status = await this.checkSync();
        if (status.issues.length > 0 || this.hasStatusChanged(status)) {
          this.logStatus(status);
          if (status.issues.length > 0 && process.env.AUTO_FIX_SYNC === "true") {
            await this.autoFixSync();
          }
        }
      } catch (error) {
        console.error("Sync monitoring check failed:", error);
      }
    }, intervalMinutes * 60 * 1e3);
  }
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log("\u23F9\uFE0F  Sync monitoring stopped");
    }
  }
  getLastStatus() {
    return this.lastStatus;
  }
  hasStatusChanged(newStatus) {
    return this.lastStatus.schemaInSync !== newStatus.schemaInSync || this.lastStatus.migrationsApplied !== newStatus.migrationsApplied || this.lastStatus.connectionHealthy !== newStatus.connectionHealthy || this.lastStatus.issues.length !== newStatus.issues.length;
  }
  logStatus(status) {
    const allGood = status.schemaInSync && status.migrationsApplied && status.connectionHealthy && status.issues.length === 0;
    if (allGood) {
      console.log("\u2705 Database sync status: All systems synchronized");
    } else {
      console.log("\u26A0\uFE0F  Database sync status: Issues detected");
      console.log(`   Schema in sync: ${status.schemaInSync ? "\u2705" : "\u274C"}`);
      console.log(`   Migrations applied: ${status.migrationsApplied ? "\u2705" : "\u274C"}`);
      console.log(`   Connection healthy: ${status.connectionHealthy ? "\u2705" : "\u274C"}`);
      if (status.issues.length > 0) {
        console.log("   Issues:");
        status.issues.forEach((issue) => console.log(`     \u2022 ${issue}`));
      }
    }
  }
}
let syncMonitorInstance = null;
function getSyncMonitor(prisma) {
  if (!syncMonitorInstance) {
    syncMonitorInstance = new SyncMonitor(prisma);
  }
  return syncMonitorInstance;
}
export {
  SyncMonitor,
  getSyncMonitor
};
//# sourceMappingURL=sync_monitor.js.map
