import { Router } from "express";
import { prisma } from "../../services/db.js";
import { getSyncMonitor } from "../../services/sync_monitor.js";
import { withdrawalLimiter } from "../../services/withdrawal_limiter.js";
import { resilientDiscordUpdates } from "../../services/resilient_discord_updates.js";
import { discordRateLimiter } from "../../services/discord_rate_limiter.js";
import { getTimerStatus } from "../../features/group_tip_expiry.js";
import { getAppConfig } from "../../services/app_config_cache.js";
const systemRouter = Router();
systemRouter.get("/system/status", async (req, res) => {
  try {
    const [userCount, activeTokens, pendingTxs] = await Promise.all([
      prisma.user.count(),
      prisma.token.count({ where: { active: true } }),
      prisma.transaction.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1e3) } } })
    ]);
    res.json({
      ok: true,
      database: true,
      rpc: true,
      // Could add actual RPC check
      treasury: process.env.TREASURY_ADDRESS || "Not configured",
      activeTokens,
      activeUsers: userCount,
      pendingTxs,
      uptime: process.uptime(),
      memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to get system status" });
  }
});
systemRouter.get("/system/db-stats", async (req, res) => {
  try {
    const [users, transactions, tips, activeGroupTips, deposits, withdrawals] = await Promise.all([
      prisma.user.count(),
      prisma.transaction.count(),
      prisma.tip.count({ where: { status: "COMPLETED" } }),
      prisma.groupTip.count({ where: { status: "ACTIVE" } }),
      prisma.transaction.count({ where: { type: "DEPOSIT" } }),
      prisma.transaction.count({ where: { type: "WITHDRAW" } })
    ]);
    res.json({
      ok: true,
      users,
      transactions,
      tips,
      activeGroupTips,
      deposits,
      withdrawals,
      dbSize: "Unknown"
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to get database stats" });
  }
});
systemRouter.post("/system/clear-caches", async (req, res) => {
  try {
    const { invalidateTreasuryCache } = await import("../../services/treasury.js");
    invalidateTreasuryCache();
    if (global.gc) {
      global.gc();
    }
    console.log("\u{1F5D1}\uFE0F Admin cleared all system caches");
    res.json({ ok: true, message: "All caches cleared successfully" });
  } catch (error) {
    console.error("Failed to clear caches:", error);
    res.status(500).json({ ok: false, error: `Failed to clear caches: ${error.message}` });
  }
});
systemRouter.post("/emergency/pause-withdrawals", async (req, res) => {
  try {
    const config = await getAppConfig();
    if (config) {
      await prisma.appConfig.update({
        where: { id: config.id },
        data: { withdrawalsPaused: true }
      });
    } else {
      await prisma.appConfig.create({
        data: { withdrawalsPaused: true }
      });
    }
    console.log("\u{1F6A8} EMERGENCY: Withdrawals paused by admin");
    res.json({ ok: true, message: "Withdrawals paused - all withdrawal commands will be disabled" });
  } catch (error) {
    console.error("Failed to pause withdrawals:", error);
    res.status(500).json({ ok: false, error: `Failed to pause withdrawals: ${error.message}` });
  }
});
systemRouter.post("/emergency/pause-tipping", async (req, res) => {
  try {
    const config = await getAppConfig();
    if (config) {
      await prisma.appConfig.update({
        where: { id: config.id },
        data: { tippingPaused: true }
      });
    } else {
      await prisma.appConfig.create({
        data: { tippingPaused: true }
      });
    }
    console.log("\u{1F6A8} EMERGENCY: Tipping paused by admin");
    res.json({ ok: true, message: "Tipping paused - all tip commands will be disabled" });
  } catch (error) {
    console.error("Failed to pause tipping:", error);
    res.status(500).json({ ok: false, error: `Failed to pause tipping: ${error.message}` });
  }
});
systemRouter.post("/emergency/enable", async (req, res) => {
  try {
    const config = await getAppConfig();
    if (config) {
      await prisma.appConfig.update({
        where: { id: config.id },
        data: {
          emergencyMode: true,
          withdrawalsPaused: true,
          tippingPaused: true
        }
      });
    } else {
      await prisma.appConfig.create({
        data: {
          emergencyMode: true,
          withdrawalsPaused: true,
          tippingPaused: true
        }
      });
    }
    console.log("\u{1F6A8} EMERGENCY MODE ENABLED: All financial operations paused");
    res.json({ ok: true, message: "Emergency mode enabled - all financial operations paused" });
  } catch (error) {
    console.error("Failed to enable emergency mode:", error);
    res.status(500).json({ ok: false, error: `Failed to enable emergency mode: ${error.message}` });
  }
});
systemRouter.post("/emergency/resume-all", async (req, res) => {
  try {
    const config = await getAppConfig();
    if (config) {
      await prisma.appConfig.update({
        where: { id: config.id },
        data: {
          emergencyMode: false,
          withdrawalsPaused: false,
          tippingPaused: false
        }
      });
    } else {
      await prisma.appConfig.create({
        data: {
          emergencyMode: false,
          withdrawalsPaused: false,
          tippingPaused: false
        }
      });
    }
    console.log("\u2705 EMERGENCY RESOLVED: All operations resumed");
    res.json({ ok: true, message: "All operations resumed - emergency mode disabled" });
  } catch (error) {
    console.error("Failed to resume operations:", error);
    res.status(500).json({ ok: false, error: `Failed to resume operations: ${error.message}` });
  }
});
systemRouter.get("/emergency/status", async (req, res) => {
  try {
    const config = await getAppConfig();
    const status = {
      emergencyMode: config?.emergencyMode || false,
      withdrawalsPaused: config?.withdrawalsPaused || false,
      tippingPaused: config?.tippingPaused || false
    };
    res.json({ ok: true, status });
  } catch (error) {
    console.error("Failed to get emergency status:", error);
    res.status(500).json({ ok: false, error: `Failed to get emergency status: ${error.message}` });
  }
});
systemRouter.post("/system/grand-reset", async (req, res) => {
  try {
    const confirmToken = req.body?.confirmToken;
    if (confirmToken !== "RESET_ALL_DATA_PERMANENTLY") {
      return res.status(400).json({
        ok: false,
        error: 'Grand reset requires confirmation token in request body: { "confirmToken": "RESET_ALL_DATA_PERMANENTLY" }'
      });
    }
    console.log("\u{1F6A8} GRAND RESET INITIATED: Wiping all user and financial data...");
    try {
      const { clearAllTimers } = await import("../../features/group_tip_expiry.js");
      clearAllTimers();
      console.log("\u{1F9F9} Cleared active group tip timers before reset");
    } catch (error) {
      console.warn("\u26A0\uFE0F Could not clear group tip timers:", error);
    }
    const deletions = await prisma.$transaction(async (tx) => {
      const notifications = await tx.notification.deleteMany({});
      const groupTipClaims = await tx.groupTipClaim.deleteMany({});
      const groupTips = await tx.groupTip.deleteMany({});
      const tips = await tx.tip.deleteMany({});
      const matches = await tx.match.deleteMany({});
      const userBalances = await tx.userBalance.deleteMany({});
      const tierMemberships = await tx.tierMembership.deleteMany({});
      const transactions = await tx.transaction.deleteMany({});
      const processedDeposits = await tx.processedDeposit.deleteMany({});
      const webhookEvents = await tx.webhookEvent.deleteMany({});
      const users = await tx.user.deleteMany({});
      return {
        users: users.count,
        transactions: transactions.count,
        tips: tips.count,
        groupTips: groupTips.count,
        groupTipClaims: groupTipClaims.count,
        matches: matches.count,
        userBalances: userBalances.count,
        tierMemberships: tierMemberships.count,
        notifications: notifications.count,
        processedDeposits: processedDeposits.count,
        webhookEvents: webhookEvents.count
      };
    });
    const totalDeleted = Object.values(deletions).reduce((sum, count) => sum + count, 0);
    console.log("\u{1F4A5} GRAND RESET COMPLETED:", {
      totalRecordsDeleted: totalDeleted,
      breakdown: deletions
    });
    res.json({
      ok: true,
      message: "Grand reset completed - all user data and financial records wiped",
      deletedCounts: deletions,
      totalDeleted
    });
  } catch (error) {
    console.error("Failed to perform grand reset:", error);
    res.status(500).json({ ok: false, error: `Grand reset failed: ${error.message}` });
  }
});
systemRouter.get("/system/stats", async (req, res) => {
  try {
    const stats = await prisma.$transaction(async (tx) => {
      const [
        users,
        transactions,
        tips,
        groupTips,
        matches,
        userBalances,
        tierMemberships,
        notifications
      ] = await Promise.all([
        tx.user.count(),
        tx.transaction.count(),
        tx.tip.count(),
        tx.groupTip.count(),
        tx.match.count(),
        tx.userBalance.count(),
        tx.tierMembership.count(),
        tx.notification.count()
      ]);
      return {
        users,
        transactions,
        tips,
        groupTips,
        matches,
        userBalances,
        tierMemberships,
        notifications
      };
    });
    const totalRecords = Object.values(stats).reduce((sum, count) => sum + count, 0);
    res.json({
      ok: true,
      stats,
      totalRecords
    });
  } catch (error) {
    console.error("Failed to get system stats:", error);
    res.status(500).json({ ok: false, error: `Failed to get stats: ${error.message}` });
  }
});
systemRouter.get("/sync/status", async (req, res) => {
  try {
    const syncMonitor = getSyncMonitor(prisma);
    const status = await syncMonitor.checkSync();
    res.json({
      ok: true,
      sync: {
        lastCheck: status.lastCheck,
        schemaInSync: status.schemaInSync,
        migrationsApplied: status.migrationsApplied,
        connectionHealthy: status.connectionHealthy,
        issueCount: status.issues.length,
        issues: status.issues,
        overallHealthy: status.schemaInSync && status.migrationsApplied && status.connectionHealthy && status.issues.length === 0
      }
    });
  } catch (error) {
    console.error("Failed to get sync status:", error);
    res.status(500).json({ ok: false, error: `Failed to get sync status: ${error.message}` });
  }
});
systemRouter.post("/sync/fix", async (req, res) => {
  try {
    const syncMonitor = getSyncMonitor(prisma);
    const currentStatus = await syncMonitor.checkSync();
    if (currentStatus.issues.length === 0) {
      return res.json({
        ok: true,
        message: "No sync issues detected - system is already synchronized",
        fixed: false
      });
    }
    console.log("\u{1F527} Admin triggered sync fix via API");
    const fixed = await syncMonitor.autoFixSync();
    const newStatus = await syncMonitor.checkSync();
    res.json({
      ok: true,
      message: fixed ? "Sync issues automatically resolved" : "Some issues could not be automatically fixed",
      fixed,
      beforeIssues: currentStatus.issues,
      afterIssues: newStatus.issues,
      sync: {
        schemaInSync: newStatus.schemaInSync,
        migrationsApplied: newStatus.migrationsApplied,
        connectionHealthy: newStatus.connectionHealthy
      }
    });
  } catch (error) {
    console.error("Failed to fix sync issues:", error);
    res.status(500).json({ ok: false, error: `Failed to fix sync: ${error.message}` });
  }
});
systemRouter.post("/sync/validate", async (req, res) => {
  try {
    console.log("\u{1F50D} Admin triggered comprehensive sync validation");
    const { execSync } = await import("child_process");
    const syncMonitor = getSyncMonitor(prisma);
    const validation = await syncMonitor.checkSync();
    const allGood = validation.schemaInSync && validation.migrationsApplied && validation.connectionHealthy && validation.issues.length === 0;
    res.json({
      ok: allGood,
      message: allGood ? "Database is fully synchronized" : "Synchronization issues detected",
      synchronized: allGood,
      issueCount: validation.issues.length,
      issues: validation.issues,
      sync: {
        schemaInSync: validation.schemaInSync,
        migrationsApplied: validation.migrationsApplied,
        connectionHealthy: validation.connectionHealthy
      }
    });
  } catch (error) {
    console.error("Failed to validate sync:", error);
    res.status(500).json({ ok: false, error: `Validation failed: ${error.message}` });
  }
});
systemRouter.post("/migrations/apply", async (req, res) => {
  try {
    console.log("\u{1F4DD} Admin triggered migration deployment");
    const { execSync } = await import("child_process");
    const status = execSync("npx prisma migrate status", { encoding: "utf-8" });
    if (status.includes("Database schema is up to date")) {
      return res.json({
        ok: true,
        message: "No migrations to apply - database is up to date",
        applied: false
      });
    }
    execSync("npx prisma migrate deploy", { stdio: "inherit" });
    execSync("npx prisma generate", { stdio: "inherit" });
    res.json({
      ok: true,
      message: "Migrations applied successfully",
      applied: true
    });
  } catch (error) {
    console.error("Failed to apply migrations:", error);
    res.status(500).json({ ok: false, error: `Migration failed: ${error.message}` });
  }
});
systemRouter.get("/migrations/status", async (req, res) => {
  try {
    const { execSync } = await import("child_process");
    const status = execSync("npx prisma migrate status", { encoding: "utf-8" });
    const upToDate = status.includes("Database schema is up to date");
    const pendingMigrations = status.includes("following migrations have not yet been applied");
    res.json({
      ok: true,
      upToDate,
      pendingMigrations,
      statusText: status.trim()
    });
  } catch (error) {
    console.error("Failed to get migration status:", error);
    res.status(500).json({ ok: false, error: `Migration status failed: ${error.message}` });
  }
});
systemRouter.get("/withdrawals/stats", async (req, res) => {
  try {
    const { hours = "24" } = req.query;
    const timeframeHours = parseInt(hours);
    const stats = await withdrawalLimiter.getWithdrawalStats(timeframeHours);
    res.json({
      ok: true,
      protection: {
        active: true,
        timeframe: `${timeframeHours} hours`,
        ...stats
      }
    });
  } catch (error) {
    console.error("Failed to get withdrawal stats:", error);
    res.status(500).json({ ok: false, error: `Failed to get withdrawal stats: ${error.message}` });
  }
});
systemRouter.post("/withdrawals/clear-cooldowns", async (req, res) => {
  try {
    const { confirmToken } = req.body;
    if (confirmToken !== "CLEAR_ALL_COOLDOWNS") {
      return res.status(400).json({
        ok: false,
        error: 'Confirmation required: { "confirmToken": "CLEAR_ALL_COOLDOWNS" }'
      });
    }
    withdrawalLimiter.clearCooldowns();
    console.log("\u{1F504} Admin cleared all withdrawal cooldowns");
    res.json({
      ok: true,
      message: "All withdrawal cooldowns and rate limiting cleared",
      warning: "Users can now bypass progressive cooldowns until they withdrawal again"
    });
  } catch (error) {
    console.error("Failed to clear withdrawal cooldowns:", error);
    res.status(500).json({ ok: false, error: `Failed to clear cooldowns: ${error.message}` });
  }
});
systemRouter.get("/discord/status", async (req, res) => {
  try {
    const discordQueueStatus = resilientDiscordUpdates.getQueueStatus();
    const rateLimiterStatus = discordRateLimiter.getStatus();
    const timerStatus = getTimerStatus();
    res.json({
      ok: true,
      discord: {
        reliabilityQueue: {
          queueSize: discordQueueStatus.queueSize,
          pendingUpdates: discordQueueStatus.updates,
          healthy: discordQueueStatus.queueSize < 50
          // Alert if more than 50 failed updates
        },
        rateLimiter: {
          endpointQueues: rateLimiterStatus,
          totalQueued: Object.values(rateLimiterStatus).reduce((sum, endpoint) => sum + endpoint.queueLength, 0),
          processing: Object.values(rateLimiterStatus).filter((endpoint) => endpoint.processing).length
        },
        groupTipTimers: {
          activeTimers: timerStatus.active,
          timers: timerStatus.timers
        }
      }
    });
  } catch (error) {
    console.error("Failed to get Discord status:", error);
    res.status(500).json({ ok: false, error: `Failed to get Discord status: ${error.message}` });
  }
});
systemRouter.post("/discord/retry-failed", async (req, res) => {
  try {
    await resilientDiscordUpdates.forceRetryAll();
    console.log("\u{1F504} Admin triggered retry of all failed Discord updates");
    res.json({
      ok: true,
      message: "All failed Discord updates queued for immediate retry"
    });
  } catch (error) {
    console.error("Failed to retry Discord updates:", error);
    res.status(500).json({ ok: false, error: `Failed to retry updates: ${error.message}` });
  }
});
systemRouter.post("/discord/clear-queue", async (req, res) => {
  try {
    const { confirmToken } = req.body;
    if (confirmToken !== "CLEAR_DISCORD_QUEUE") {
      return res.status(400).json({
        ok: false,
        error: 'Confirmation required: { "confirmToken": "CLEAR_DISCORD_QUEUE" }'
      });
    }
    resilientDiscordUpdates.clearQueue();
    console.log("\u{1F5D1}\uFE0F Admin cleared Discord update queue");
    res.json({
      ok: true,
      message: "Discord update queue cleared",
      warning: "Pending Discord updates have been discarded"
    });
  } catch (error) {
    console.error("Failed to clear Discord queue:", error);
    res.status(500).json({ ok: false, error: `Failed to clear queue: ${error.message}` });
  }
});
export {
  systemRouter
};
//# sourceMappingURL=system.js.map
