import { prisma } from "./db.js";
import { startTimer, endTimer } from "./performance.js";
class ProgressTableOptimizer {
  // Archive completed achievements to reduce table size
  static async archiveCompletedProgress(olderThanDays = 30) {
    startTimer("archive_progress");
    try {
      const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1e3);
      const toArchive = await prisma.userAchievementProgress.findMany({
        where: {
          lastProgressAt: { lt: cutoffDate },
          // Only archive if user has actually unlocked the achievement
          user: {
            unlockedAchievements: {
              some: {
                definitionId: {
                  in: await prisma.userAchievementProgress.findMany({
                    where: { lastProgressAt: { lt: cutoffDate } },
                    select: { definitionId: true }
                  }).then((records) => records.map((r) => r.definitionId))
                }
              }
            }
          }
        },
        include: {
          user: { select: { discordId: true } },
          definition: { select: { name: true } }
        }
      });
      if (toArchive.length === 0) {
        endTimer("archive_progress", { archived: 0 });
        return 0;
      }
      console.log(`\u{1F4E6} Would archive ${toArchive.length} completed progress entries`);
      endTimer("archive_progress", { archived: toArchive.length });
      return toArchive.length;
    } catch (error) {
      endTimer("archive_progress", { success: false, error: String(error) });
      throw error;
    }
  }
  // Clean up stale progress entries (no activity for months)
  static async cleanupStaleProgress(staleAfterDays = 90) {
    const cutoffDate = new Date(Date.now() - staleAfterDays * 24 * 60 * 60 * 1e3);
    const staleCount = await prisma.userAchievementProgress.count({
      where: {
        lastProgressAt: { lt: cutoffDate },
        currentProgress: 0
        // No progress made
      }
    });
    console.log(`\u{1F9F9} Found ${staleCount} stale progress entries (no activity for ${staleAfterDays} days)`);
    return staleCount;
  }
  // Create missing progress entries for new achievements
  static async ensureProgressTracking(definitionId, batchSize = 1e3) {
    startTimer("ensure_progress");
    try {
      const usersWithoutProgress = await prisma.user.findMany({
        where: {
          NOT: {
            achievementProgress: {
              some: { definitionId }
            }
          }
        },
        select: { id: true },
        take: batchSize
      });
      if (usersWithoutProgress.length === 0) {
        endTimer("ensure_progress", { created: 0 });
        return 0;
      }
      const progressData = usersWithoutProgress.map((user) => ({
        userId: user.id,
        definitionId,
        currentProgress: 0,
        lastProgressAt: /* @__PURE__ */ new Date(),
        lastCheckedAt: /* @__PURE__ */ new Date()
      }));
      await prisma.userAchievementProgress.createMany({
        data: progressData,
        skipDuplicates: true
      });
      endTimer("ensure_progress", { created: progressData.length });
      return progressData.length;
    } catch (error) {
      endTimer("ensure_progress", { success: false, error: String(error) });
      throw error;
    }
  }
}
class BatchProcessor {
  // Process achievement checks in optimized batches
  static async batchProcessAchievementChecks(definitionIds, batchSize = 100, maxConcurrent = 3) {
    startTimer("batch_process_checks");
    let totalProcessed = 0;
    let totalUnlocked = 0;
    let totalErrors = 0;
    try {
      const users = await prisma.user.findMany({
        select: { id: true, discordId: true }
      });
      console.log(`\u26A1 Starting batch processing: ${users.length} users \xD7 ${definitionIds.length} definitions`);
      for (let i = 0; i < users.length; i += batchSize) {
        const userBatch = users.slice(i, i + batchSize);
        const definitionBatches = [];
        for (let j = 0; j < definitionIds.length; j += maxConcurrent) {
          definitionBatches.push(definitionIds.slice(j, j + maxConcurrent));
        }
        for (const defBatch of definitionBatches) {
          const batchPromises = defBatch.map(
            (definitionId) => processBatchForDefinition(userBatch, definitionId)
          );
          const batchResults = await Promise.allSettled(batchPromises);
          for (const result of batchResults) {
            if (result.status === "fulfilled") {
              totalProcessed += result.value.processed;
              totalUnlocked += result.value.unlocked;
            } else {
              totalErrors++;
              console.error("Batch processing error:", result.reason);
            }
          }
        }
        if ((i + batchSize) % 1e3 === 0) {
          console.log(`\u{1F4CA} Progress: ${i + batchSize}/${users.length} users processed`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      endTimer("batch_process_checks", {
        totalProcessed,
        totalUnlocked,
        totalErrors
      });
      return {
        processed: totalProcessed,
        unlocked: totalUnlocked,
        errors: totalErrors
      };
    } catch (error) {
      endTimer("batch_process_checks", { success: false, error: String(error) });
      throw error;
    }
  }
  // Transaction-optimized progress updates
  static async batchUpdateProgress(updates) {
    if (updates.length === 0) return 0;
    startTimer("batch_update_progress");
    try {
      let updated = 0;
      const updatesByDefinition = updates.reduce((acc, update) => {
        if (!acc[update.definitionId]) {
          acc[update.definitionId] = [];
        }
        acc[update.definitionId].push(update);
        return acc;
      }, {});
      for (const [definitionId, defUpdates] of Object.entries(updatesByDefinition)) {
        await prisma.$transaction(async (tx) => {
          for (const update of defUpdates) {
            await tx.userAchievementProgress.upsert({
              where: {
                userId_definitionId: {
                  userId: update.userId,
                  definitionId: update.definitionId
                }
              },
              create: {
                userId: update.userId,
                definitionId: update.definitionId,
                currentProgress: update.progress,
                lastProgressAt: /* @__PURE__ */ new Date(),
                lastCheckedAt: /* @__PURE__ */ new Date(),
                progressData: update.data
              },
              update: {
                currentProgress: update.progress,
                lastProgressAt: /* @__PURE__ */ new Date(),
                lastCheckedAt: /* @__PURE__ */ new Date(),
                progressData: update.data
              }
            });
            updated++;
          }
        });
      }
      endTimer("batch_update_progress", { updated });
      return updated;
    } catch (error) {
      endTimer("batch_update_progress", { success: false, error: String(error) });
      throw error;
    }
  }
}
async function processBatchForDefinition(users, definitionId) {
  const definition = await prisma.achievementDefinition.findUnique({
    where: { id: definitionId }
  });
  if (!definition) {
    throw new Error(`Definition ${definitionId} not found`);
  }
  let processed = 0;
  let unlocked = 0;
  for (const user of users) {
    try {
      const progress = await calculateProgressSimplified(user.id, definition);
      await prisma.userAchievementProgress.upsert({
        where: {
          userId_definitionId: {
            userId: user.id,
            definitionId: definition.id
          }
        },
        create: {
          userId: user.id,
          definitionId: definition.id,
          currentProgress: progress,
          lastProgressAt: /* @__PURE__ */ new Date(),
          lastCheckedAt: /* @__PURE__ */ new Date()
        },
        update: {
          currentProgress: progress,
          lastCheckedAt: /* @__PURE__ */ new Date()
        }
      });
      if (progress >= Number(definition.threshold)) {
        const existing = await prisma.userAchievement.findUnique({
          where: {
            userId_definitionId: {
              userId: user.id,
              definitionId: definition.id
            }
          }
        });
        if (!existing) {
          await prisma.userAchievement.create({
            data: {
              userId: user.id,
              definitionId: definition.id,
              currentProgress: progress,
              targetProgress: Number(definition.threshold),
              unlockedAt: /* @__PURE__ */ new Date(),
              lastUnlockedAt: /* @__PURE__ */ new Date(),
              unlockCount: 1
            }
          });
          unlocked++;
        }
      }
      processed++;
    } catch (error) {
      console.error(`Error processing user ${user.discordId} for definition ${definitionId}:`, error);
    }
  }
  return { processed, unlocked };
}
async function calculateProgressSimplified(userId, definition) {
  const { criteriaType } = definition;
  switch (criteriaType) {
    case "count":
      if (definition.criteriaData.field === "matches_won") {
        const stats = await prisma.userStats.findUnique({
          where: { userId },
          select: { matchesWon: true }
        });
        return stats?.matchesWon || 0;
      }
      break;
    case "streak":
      const streak = await prisma.userStreak.findUnique({
        where: { userId },
        select: { currentWins: true, longestWins: true }
      });
      return definition.criteriaData.field === "current_wins" ? streak?.currentWins || 0 : streak?.longestWins || 0;
    case "sum":
      if (definition.criteriaData.field === "total_tips_sent") {
        const stats = await prisma.userStats.findUnique({
          where: { userId },
          select: { totalTipAmountSent: true }
        });
        return Number(stats?.totalTipAmountSent || 0);
      }
      break;
  }
  return 0;
}
class DatabaseOptimizer {
  // Analyze table sizes and suggest optimizations
  static async analyzeTableSizes() {
    const [progressCount, achievementCount] = await Promise.all([
      prisma.userAchievementProgress.count(),
      prisma.userAchievement.count()
    ]);
    const suggestions = [];
    if (progressCount > 1e5) {
      suggestions.push("Consider archiving completed progress entries older than 30 days");
    }
    if (progressCount > 5e5) {
      suggestions.push("Implement progress table partitioning by month or user ID ranges");
    }
    if (achievementCount > 5e4) {
      suggestions.push("Achievement unlocks are healthy - no action needed");
    }
    return {
      userAchievementProgress: progressCount,
      userAchievement: achievementCount,
      suggestions
    };
  }
  // Optimize indexes for common queries
  static async suggestIndexOptimizations() {
    const suggestions = [];
    suggestions.push("Ensure index on (definitionId, currentProgress) for leaderboard queries");
    suggestions.push("Consider composite index on (userId, lastProgressAt) for user progress history");
    suggestions.push("Verify index on (lastCheckedAt) for batch processing queries");
    return suggestions;
  }
}
export {
  BatchProcessor,
  DatabaseOptimizer,
  ProgressTableOptimizer
};
//# sourceMappingURL=achievement_performance_optimizer.js.map
