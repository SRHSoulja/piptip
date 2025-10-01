import { EventEmitter } from "events";
import { prisma } from "./db.js";
import { startTimer, endTimer } from "./performance.js";
import { timingSafeEqual } from "crypto";
class AchievementMonitor extends EventEmitter {
  isActive = false;
  intervals = [];
  // Start monitoring system
  start() {
    if (this.isActive) return;
    this.isActive = true;
    console.log("\u{1F4CA} Starting real-time achievement monitoring...");
    const unlockMonitor = setInterval(() => {
      this.checkRecentUnlocks().catch(console.error);
    }, 3e4);
    const progressMonitor = setInterval(() => {
      this.checkProgressChanges().catch(console.error);
    }, 6e4);
    const analyticsMonitor = setInterval(() => {
      this.generateAnalyticsSummary().catch(console.error);
    }, 5 * 60 * 1e3);
    this.intervals.push(unlockMonitor, progressMonitor, analyticsMonitor);
    this.emit("monitor_started");
  }
  // Stop monitoring system
  stop() {
    if (!this.isActive) return;
    this.intervals.forEach((interval) => clearInterval(interval));
    this.intervals = [];
    this.isActive = false;
    console.log("\u{1F4CA} Achievement monitoring stopped");
    this.emit("monitor_stopped");
  }
  // Check for recent achievement unlocks
  async checkRecentUnlocks() {
    startTimer("monitor_recent_unlocks");
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1e3);
      const recentUnlocks = await prisma.userAchievement.findMany({
        where: {
          unlockedAt: { gte: fiveMinutesAgo }
        },
        include: {
          user: {
            select: { discordId: true }
          },
          definition: {
            select: { name: true, iconEmoji: true, category: true, rarity: true }
          }
        },
        orderBy: { unlockedAt: "desc" }
      });
      if (recentUnlocks.length > 0) {
        console.log(`\u{1F389} ${recentUnlocks.length} achievements unlocked in the last 5 minutes`);
        for (const unlock of recentUnlocks) {
          this.emit("achievement_unlocked", {
            type: "unlock",
            timestamp: unlock.unlockedAt,
            userId: unlock.userId,
            definitionId: unlock.definitionId,
            data: {
              userDiscordId: unlock.user.discordId,
              achievementName: unlock.definition.name,
              iconEmoji: unlock.definition.iconEmoji,
              category: unlock.definition.category,
              rarity: unlock.definition.rarity,
              progress: unlock.currentProgress,
              target: unlock.targetProgress
            }
          });
        }
        const rareUnlocks = recentUnlocks.filter(
          (u) => ["rare", "epic", "legendary"].includes(u.definition.rarity)
        );
        if (rareUnlocks.length > 0) {
          this.emit("rare_achievement_unlocked", rareUnlocks);
        }
      }
      endTimer("monitor_recent_unlocks", { count: recentUnlocks.length });
    } catch (error) {
      endTimer("monitor_recent_unlocks", { success: false, error: String(error) });
      console.error("Error checking recent unlocks:", error);
    }
  }
  // Check for significant progress changes
  async checkProgressChanges() {
    startTimer("monitor_progress_changes");
    try {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1e3);
      const recentProgress = await prisma.userAchievementProgress.findMany({
        where: {
          lastProgressAt: { gte: oneMinuteAgo },
          currentProgress: { gt: 0 }
        },
        include: {
          user: { select: { discordId: true } },
          definition: {
            select: { name: true, threshold: true, category: true }
          }
        },
        orderBy: { lastProgressAt: "desc" },
        take: 50
        // Limit to prevent spam
      });
      if (recentProgress.length > 0) {
        const nearCompletion = recentProgress.filter((p) => {
          const progressPercent = Number(p.currentProgress) / Number(p.definition.threshold);
          return progressPercent >= 0.9 && progressPercent < 1;
        });
        if (nearCompletion.length > 0) {
          this.emit("achievements_near_completion", nearCompletion);
        }
        for (const progress of recentProgress) {
          this.emit("achievement_progress", {
            type: "progress",
            timestamp: progress.lastProgressAt,
            userId: progress.userId,
            definitionId: progress.definitionId,
            data: {
              userDiscordId: progress.user.discordId,
              achievementName: progress.definition.name,
              currentProgress: Number(progress.currentProgress),
              threshold: Number(progress.definition.threshold),
              progressPercent: (Number(progress.currentProgress) / Number(progress.definition.threshold) * 100).toFixed(1)
            }
          });
        }
      }
      endTimer("monitor_progress_changes", { count: recentProgress.length });
    } catch (error) {
      endTimer("monitor_progress_changes", { success: false, error: String(error) });
      console.error("Error checking progress changes:", error);
    }
  }
  // Generate analytics summary
  async generateAnalyticsSummary() {
    startTimer("analytics_summary");
    try {
      const now = /* @__PURE__ */ new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1e3);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
      const [
        hourlyUnlocks,
        dailyUnlocks,
        activeUsers,
        topCategories,
        difficultAchievements
      ] = await Promise.all([
        // Unlocks in the last hour
        prisma.userAchievement.count({
          where: { unlockedAt: { gte: oneHourAgo } }
        }),
        // Unlocks in the last day
        prisma.userAchievement.count({
          where: { unlockedAt: { gte: oneDayAgo } }
        }),
        // Users with recent achievement activity
        prisma.userAchievementProgress.groupBy({
          by: ["userId"],
          where: { lastProgressAt: { gte: oneDayAgo } },
          _count: { userId: true }
        }),
        // Most active achievement categories
        prisma.userAchievement.findMany({
          where: { unlockedAt: { gte: oneDayAgo } },
          include: {
            definition: { select: { category: true } }
          }
        }).then((unlocks) => {
          const categoryCount = unlocks.reduce((acc, unlock) => {
            const category = unlock.definition.category;
            acc[category] = (acc[category] || 0) + 1;
            return acc;
          }, {});
          return Object.entries(categoryCount).sort(([, a], [, b]) => b - a).slice(0, 5).map(([category, count]) => ({ category, count }));
        }),
        // Achievements with low completion rates (potentially too difficult)
        (async () => {
          const allDefinitions = await prisma.achievementDefinition.findMany({
            where: { isEnabled: true },
            include: {
              _count: {
                select: {
                  unlockedAchievements: true,
                  progressTracking: true
                }
              }
            }
          });
          return allDefinitions.filter((def) => def._count.progressTracking > 10).map((def) => ({
            id: def.id,
            name: def.name,
            category: def.category,
            threshold: def.threshold,
            unlock_count: def._count.unlockedAchievements,
            progress_count: def._count.progressTracking,
            completion_rate: def._count.progressTracking > 0 ? def._count.unlockedAchievements / def._count.progressTracking : 0
          })).filter((def) => def.completion_rate < 0.1).sort((a, b) => a.completion_rate - b.completion_rate).slice(0, 5);
        })()
      ]);
      const summary = {
        timestamp: now,
        metrics: {
          hourlyUnlocks,
          dailyUnlocks,
          activeUsers: activeUsers.length,
          unlockRate: activeUsers.length > 0 ? (dailyUnlocks / activeUsers.length).toFixed(2) : "0"
        },
        topCategories,
        difficultAchievements
      };
      this.emit("analytics_summary", summary);
      if (hourlyUnlocks > 0) {
        console.log(`\u{1F4C8} Achievement activity: ${hourlyUnlocks} unlocks in the last hour, ${dailyUnlocks} in the last day`);
      }
      if (summary.difficultAchievements.length > 0) {
        console.log(`\u26A0\uFE0F Found ${summary.difficultAchievements.length} achievements with low completion rates (<10%)`);
      }
      endTimer("analytics_summary", {
        hourlyUnlocks,
        dailyUnlocks,
        activeUsers: activeUsers.length
      });
    } catch (error) {
      endTimer("analytics_summary", { success: false, error: String(error) });
      console.error("Error generating analytics summary:", error);
    }
  }
  // Get current monitoring status
  getStatus() {
    return {
      isActive: this.isActive,
      uptime: this.isActive ? Date.now() : void 0,
      eventCounts: this._eventsCount || {}
    };
  }
}
const achievementMonitor = new AchievementMonitor();
achievementMonitor.on("achievement_unlocked", (event) => {
  const { data } = event;
  console.log(`\u{1F3C6} Achievement unlocked: ${data.userDiscordId} earned "${data.achievementName}" ${data.iconEmoji}`);
});
achievementMonitor.on("rare_achievement_unlocked", (unlocks) => {
  console.log(`\u2728 ${unlocks.length} rare achievements unlocked:`);
  unlocks.forEach((unlock) => {
    console.log(`  - ${unlock.user.discordId}: ${unlock.definition.name} (${unlock.definition.rarity})`);
  });
});
achievementMonitor.on("achievements_near_completion", (progress) => {
  console.log(`\u{1F3AF} ${progress.length} users close to unlocking achievements (90%+ progress)`);
});
achievementMonitor.on("analytics_summary", (summary) => {
  if (summary.metrics.hourlyUnlocks > 10) {
    console.log(`\u{1F680} High achievement activity detected: ${summary.metrics.hourlyUnlocks} unlocks in the last hour`);
  }
});
function startAchievementMonitoring() {
  achievementMonitor.start();
}
function stopAchievementMonitoring() {
  achievementMonitor.stop();
}
function getMonitoringStatus() {
  return achievementMonitor.getStatus();
}
function attachWebSocketHandlers(io) {
  const adminNamespace = io.of("/admin/achievements");
  adminNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token;
    const adminSecret = process.env.ADMIN_SECRET?.trim();
    if (!token || !adminSecret || token.length < 10 || adminSecret.length < 10) {
      return next(new Error("Unauthorized"));
    }
    try {
      const tokenBuffer = Buffer.from(String(token));
      const secretBuffer = Buffer.from(String(adminSecret));
      if (tokenBuffer.length !== secretBuffer.length) {
        return next(new Error("Unauthorized"));
      }
      if (!timingSafeEqual(tokenBuffer, secretBuffer)) {
        return next(new Error("Unauthorized"));
      }
    } catch (error) {
      return next(new Error("Unauthorized"));
    }
    next();
  });
  adminNamespace.on("connection", (socket) => {
    console.log(`\u{1F4E1} Admin connected to achievement monitoring: ${socket.id}`);
    socket.emit("monitoring_status", achievementMonitor.getStatus());
    const eventHandlers = {
      achievement_unlocked: (event) => {
        socket.emit("achievement_unlocked", event);
      },
      achievement_progress: (event) => {
        socket.emit("achievement_progress", event);
      },
      rare_achievement_unlocked: (unlocks) => {
        socket.emit("rare_achievement_unlocked", unlocks);
      },
      achievements_near_completion: (progress) => {
        socket.emit("achievements_near_completion", progress);
      },
      analytics_summary: (summary) => {
        socket.emit("analytics_summary", summary);
      }
    };
    Object.entries(eventHandlers).forEach(([event, handler]) => {
      achievementMonitor.on(event, handler);
    });
    socket.on("disconnect", () => {
      console.log(`\u{1F4E1} Admin disconnected from achievement monitoring: ${socket.id}`);
      Object.entries(eventHandlers).forEach(([event, handler]) => {
        achievementMonitor.removeListener(event, handler);
      });
    });
    socket.on("start_monitoring", () => {
      achievementMonitor.start();
      socket.emit("monitoring_status", achievementMonitor.getStatus());
    });
    socket.on("stop_monitoring", () => {
      achievementMonitor.stop();
      socket.emit("monitoring_status", achievementMonitor.getStatus());
    });
    socket.on("request_status", () => {
      socket.emit("monitoring_status", achievementMonitor.getStatus());
    });
  });
}
export {
  achievementMonitor,
  attachWebSocketHandlers,
  getMonitoringStatus,
  startAchievementMonitoring,
  stopAchievementMonitoring
};
//# sourceMappingURL=achievement_monitoring.js.map
