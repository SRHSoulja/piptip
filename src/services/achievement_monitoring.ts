// src/services/achievement_monitoring.ts - Real-time achievement monitoring

import { EventEmitter } from 'events';
import { prisma } from './db.js';
import { startTimer, endTimer } from './performance.js';
import { timingSafeEqual } from 'crypto';

// Event types for achievement monitoring
export interface AchievementEvent {
  type: 'unlock' | 'progress' | 'definition_change';
  timestamp: Date;
  userId?: number;
  definitionId?: number;
  data: any;
}

// Real-time achievement monitor
class AchievementMonitor extends EventEmitter {
  private isActive = false;
  private intervals: NodeJS.Timeout[] = [];

  // Start monitoring system
  start(): void {
    if (this.isActive) return;

    this.isActive = true;
    console.log('📊 Starting real-time achievement monitoring...');

    // Monitor recent unlocks every 30 seconds
    const unlockMonitor = setInterval(() => {
      this.checkRecentUnlocks().catch(console.error);
    }, 30000);

    // Monitor progress changes every 60 seconds
    const progressMonitor = setInterval(() => {
      this.checkProgressChanges().catch(console.error);
    }, 60000);

    // Generate analytics summary every 5 minutes
    const analyticsMonitor = setInterval(() => {
      this.generateAnalyticsSummary().catch(console.error);
    }, 5 * 60 * 1000);

    this.intervals.push(unlockMonitor, progressMonitor, analyticsMonitor);

    this.emit('monitor_started');
  }

  // Stop monitoring system
  stop(): void {
    if (!this.isActive) return;

    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    this.isActive = false;

    console.log('📊 Achievement monitoring stopped');
    this.emit('monitor_stopped');
  }

  // Check for recent achievement unlocks
  private async checkRecentUnlocks(): Promise<void> {
    startTimer('monitor_recent_unlocks');

    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

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
        orderBy: { unlockedAt: 'desc' }
      });

      if (recentUnlocks.length > 0) {
        console.log(`🎉 ${recentUnlocks.length} achievements unlocked in the last 5 minutes`);

        // Emit events for each unlock
        for (const unlock of recentUnlocks) {
          this.emit('achievement_unlocked', {
            type: 'unlock',
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
          } as AchievementEvent);
        }

        // Check for rare achievement unlocks
        const rareUnlocks = recentUnlocks.filter(u =>
          ['rare', 'epic', 'legendary'].includes(u.definition.rarity)
        );

        if (rareUnlocks.length > 0) {
          this.emit('rare_achievement_unlocked', rareUnlocks);
        }
      }

      endTimer('monitor_recent_unlocks', { count: recentUnlocks.length });

    } catch (error) {
      endTimer('monitor_recent_unlocks', { success: false, error: String(error) });
      console.error('Error checking recent unlocks:', error);
    }
  }

  // Check for significant progress changes
  private async checkProgressChanges(): Promise<void> {
    startTimer('monitor_progress_changes');

    try {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

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
        orderBy: { lastProgressAt: 'desc' },
        take: 50 // Limit to prevent spam
      });

      if (recentProgress.length > 0) {
        // Find users close to unlocking (90%+ progress)
        const nearCompletion = recentProgress.filter(p => {
          const progressPercent = Number(p.currentProgress) / Number(p.definition.threshold);
          return progressPercent >= 0.9 && progressPercent < 1.0;
        });

        if (nearCompletion.length > 0) {
          this.emit('achievements_near_completion', nearCompletion);
        }

        // Emit progress update events
        for (const progress of recentProgress) {
          this.emit('achievement_progress', {
            type: 'progress',
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
          } as AchievementEvent);
        }
      }

      endTimer('monitor_progress_changes', { count: recentProgress.length });

    } catch (error) {
      endTimer('monitor_progress_changes', { success: false, error: String(error) });
      console.error('Error checking progress changes:', error);
    }
  }

  // Generate analytics summary
  private async generateAnalyticsSummary(): Promise<void> {
    startTimer('analytics_summary');

    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

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
          by: ['userId'],
          where: { lastProgressAt: { gte: oneDayAgo } },
          _count: { userId: true }
        }),

        // Most active achievement categories
        prisma.userAchievement.findMany({
          where: { unlockedAt: { gte: oneDayAgo } },
          include: {
            definition: { select: { category: true } }
          }
        }).then(unlocks => {
          const categoryCount = unlocks.reduce((acc, unlock) => {
            const category = unlock.definition.category;
            acc[category] = (acc[category] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          return Object.entries(categoryCount)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([category, count]) => ({ category, count }));
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

          return allDefinitions
            .filter(def => def._count.progressTracking > 10)
            .map(def => ({
              id: def.id,
              name: def.name,
              category: def.category,
              threshold: def.threshold,
              unlock_count: def._count.unlockedAchievements,
              progress_count: def._count.progressTracking,
              completion_rate: def._count.progressTracking > 0
                ? (def._count.unlockedAchievements / def._count.progressTracking)
                : 0
            }))
            .filter(def => def.completion_rate < 0.1)
            .sort((a, b) => a.completion_rate - b.completion_rate)
            .slice(0, 5);
        })()
      ]);

      const summary = {
        timestamp: now,
        metrics: {
          hourlyUnlocks,
          dailyUnlocks,
          activeUsers: activeUsers.length,
          unlockRate: activeUsers.length > 0 ? (dailyUnlocks / activeUsers.length).toFixed(2) : '0'
        },
        topCategories,
        difficultAchievements: difficultAchievements as any[]
      };

      // Emit summary event
      this.emit('analytics_summary', summary);

      // Log notable metrics
      if (hourlyUnlocks > 0) {
        console.log(`📈 Achievement activity: ${hourlyUnlocks} unlocks in the last hour, ${dailyUnlocks} in the last day`);
      }

      if (summary.difficultAchievements.length > 0) {
        console.log(`⚠️ Found ${summary.difficultAchievements.length} achievements with low completion rates (<10%)`);
      }

      endTimer('analytics_summary', {
        hourlyUnlocks,
        dailyUnlocks,
        activeUsers: activeUsers.length
      });

    } catch (error) {
      endTimer('analytics_summary', { success: false, error: String(error) });
      console.error('Error generating analytics summary:', error);
    }
  }

  // Get current monitoring status
  getStatus(): { isActive: boolean; uptime?: number; eventCounts: Record<string, number> } {
    return {
      isActive: this.isActive,
      uptime: this.isActive ? Date.now() : undefined,
      eventCounts: (this as any)._eventsCount || {}
    };
  }
}

// Singleton instance
const achievementMonitor = new AchievementMonitor();

// Event handlers for Discord notifications
achievementMonitor.on('achievement_unlocked', (event: AchievementEvent) => {
  // Could send Discord webhook notifications here
  const { data } = event;
  console.log(`🏆 Achievement unlocked: ${data.userDiscordId} earned "${data.achievementName}" ${data.iconEmoji}`);
});

achievementMonitor.on('rare_achievement_unlocked', (unlocks: any[]) => {
  console.log(`✨ ${unlocks.length} rare achievements unlocked:`);
  unlocks.forEach(unlock => {
    console.log(`  - ${unlock.user.discordId}: ${unlock.definition.name} (${unlock.definition.rarity})`);
  });
});

achievementMonitor.on('achievements_near_completion', (progress: any[]) => {
  console.log(`🎯 ${progress.length} users close to unlocking achievements (90%+ progress)`);
});

achievementMonitor.on('analytics_summary', (summary: any) => {
  if (summary.metrics.hourlyUnlocks > 10) {
    console.log(`🚀 High achievement activity detected: ${summary.metrics.hourlyUnlocks} unlocks in the last hour`);
  }
});

// Export functions and monitor instance
export { achievementMonitor };

export function startAchievementMonitoring(): void {
  achievementMonitor.start();
}

export function stopAchievementMonitoring(): void {
  achievementMonitor.stop();
}

export function getMonitoringStatus() {
  return achievementMonitor.getStatus();
}

// WebSocket endpoint for real-time admin dashboard
export function attachWebSocketHandlers(io: any): void {
  const adminNamespace = io.of('/admin/achievements');

  adminNamespace.use((socket: any, next: any) => {
    // Secure authentication middleware
    const token = socket.handshake.auth.token;
    const adminSecret = process.env.ADMIN_SECRET?.trim();

    if (!token || !adminSecret || token.length < 10 || adminSecret.length < 10) {
      return next(new Error('Unauthorized'));
    }

    // Constant-time comparison to prevent timing attacks
    try {
      const tokenBuffer = Buffer.from(String(token));
      const secretBuffer = Buffer.from(String(adminSecret));

      if (tokenBuffer.length !== secretBuffer.length) {
        return next(new Error('Unauthorized'));
      }

      if (!timingSafeEqual(tokenBuffer, secretBuffer)) {
        return next(new Error('Unauthorized'));
      }
    } catch (error) {
      return next(new Error('Unauthorized'));
    }

    next();
  });

  adminNamespace.on('connection', (socket: any) => {
    console.log(`📡 Admin connected to achievement monitoring: ${socket.id}`);

    // Send current status
    socket.emit('monitoring_status', achievementMonitor.getStatus());

    // Real-time event forwarding
    const eventHandlers = {
      achievement_unlocked: (event: AchievementEvent) => {
        socket.emit('achievement_unlocked', event);
      },
      achievement_progress: (event: AchievementEvent) => {
        socket.emit('achievement_progress', event);
      },
      rare_achievement_unlocked: (unlocks: any[]) => {
        socket.emit('rare_achievement_unlocked', unlocks);
      },
      achievements_near_completion: (progress: any[]) => {
        socket.emit('achievements_near_completion', progress);
      },
      analytics_summary: (summary: any) => {
        socket.emit('analytics_summary', summary);
      }
    };

    // Attach event listeners
    Object.entries(eventHandlers).forEach(([event, handler]) => {
      achievementMonitor.on(event, handler);
    });

    // Clean up on disconnect
    socket.on('disconnect', () => {
      console.log(`📡 Admin disconnected from achievement monitoring: ${socket.id}`);
      Object.entries(eventHandlers).forEach(([event, handler]) => {
        achievementMonitor.removeListener(event, handler);
      });
    });

    // Handle admin commands
    socket.on('start_monitoring', () => {
      achievementMonitor.start();
      socket.emit('monitoring_status', achievementMonitor.getStatus());
    });

    socket.on('stop_monitoring', () => {
      achievementMonitor.stop();
      socket.emit('monitoring_status', achievementMonitor.getStatus());
    });

    socket.on('request_status', () => {
      socket.emit('monitoring_status', achievementMonitor.getStatus());
    });
  });
}