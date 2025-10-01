import { prisma } from "./db.js";
import { invalidateDefinitionCache, getAchievementDefinitions } from "./dynamic_achievements.js";
import { startTimer, endTimer } from "./performance.js";
async function grantAchievement(userId, definitionId, adminId, reason, skipValidation = false) {
  startTimer("grant_achievement");
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { discordId: true }
    });
    if (!user) {
      return { success: false, message: "User not found" };
    }
    const definition = await prisma.achievementDefinition.findUnique({
      where: { id: definitionId }
    });
    if (!definition) {
      return { success: false, message: "Achievement definition not found" };
    }
    if (!skipValidation && !definition.isRepeatable) {
      const existing = await prisma.userAchievement.findUnique({
        where: {
          userId_definitionId: {
            userId,
            definitionId
          }
        }
      });
      if (existing) {
        return {
          success: false,
          message: `User ${user.discordId} already has achievement "${definition.name}"`
        };
      }
    }
    if (!skipValidation && definition.isRepeatable && definition.cooldownHours) {
      const cooldownEnd = new Date(Date.now() - definition.cooldownHours * 60 * 60 * 1e3);
      const recentUnlock = await prisma.userAchievement.findFirst({
        where: {
          userId,
          definitionId,
          lastUnlockedAt: { gte: cooldownEnd }
        }
      });
      if (recentUnlock) {
        const hoursLeft = Math.ceil((recentUnlock.lastUnlockedAt.getTime() + definition.cooldownHours * 60 * 60 * 1e3 - Date.now()) / (60 * 60 * 1e3));
        return {
          success: false,
          message: `Cooldown active. ${hoursLeft} hours remaining.`
        };
      }
    }
    const granted = await prisma.userAchievement.upsert({
      where: {
        userId_definitionId: {
          userId,
          definitionId
        }
      },
      create: {
        userId,
        definitionId,
        currentProgress: Number(definition.threshold),
        targetProgress: Number(definition.threshold),
        unlockedAt: /* @__PURE__ */ new Date(),
        lastUnlockedAt: /* @__PURE__ */ new Date(),
        unlockCount: 1,
        data: {
          grantedBy: adminId,
          reason: reason || "Manual grant",
          grantedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      },
      update: {
        lastUnlockedAt: /* @__PURE__ */ new Date(),
        unlockCount: { increment: 1 },
        data: {
          grantedBy: adminId,
          reason: reason || "Manual grant (repeat)",
          grantedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      }
    });
    await prisma.userStats.upsert({
      where: { userId },
      create: {
        userId,
        achievementCount: 1
      },
      update: {
        achievementCount: { increment: 1 }
      }
    });
    await prisma.userAchievementProgress.upsert({
      where: {
        userId_definitionId: {
          userId,
          definitionId
        }
      },
      create: {
        userId,
        definitionId,
        currentProgress: Number(definition.threshold),
        lastProgressAt: /* @__PURE__ */ new Date(),
        lastCheckedAt: /* @__PURE__ */ new Date(),
        progressData: {
          grantedBy: adminId,
          reason
        }
      },
      update: {
        currentProgress: Number(definition.threshold),
        lastProgressAt: /* @__PURE__ */ new Date(),
        lastCheckedAt: /* @__PURE__ */ new Date(),
        progressData: {
          grantedBy: adminId,
          reason
        }
      }
    });
    endTimer("grant_achievement", {
      userId,
      definitionId,
      adminId,
      success: true
    });
    console.log(`\u{1F3C6} Manual grant: ${user.discordId} received "${definition.name}" by admin ${adminId}`);
    return {
      success: true,
      message: `Achievement "${definition.name}" granted to user ${user.discordId}`,
      data: {
        achievementId: granted.id,
        achievementName: definition.name,
        userDiscordId: user.discordId,
        unlockCount: granted.unlockCount
      }
    };
  } catch (error) {
    endTimer("grant_achievement", { success: false, error: String(error) });
    console.error("Error granting achievement:", error);
    return {
      success: false,
      message: `Failed to grant achievement: ${error}`
    };
  }
}
async function revokeAchievement(userId, definitionId, adminId, reason) {
  startTimer("revoke_achievement");
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { discordId: true }
    });
    if (!user) {
      return { success: false, message: "User not found" };
    }
    const userAchievement = await prisma.userAchievement.findUnique({
      where: {
        userId_definitionId: {
          userId,
          definitionId
        }
      },
      include: {
        definition: { select: { name: true } }
      }
    });
    if (!userAchievement) {
      return {
        success: false,
        message: "User does not have this achievement"
      };
    }
    const revocationData = {
      userId,
      definitionId,
      achievementName: userAchievement.definition.name,
      originalUnlockDate: userAchievement.unlockedAt,
      unlockCount: userAchievement.unlockCount,
      revokedBy: adminId,
      revokedAt: /* @__PURE__ */ new Date(),
      reason: reason || "Manual revocation"
    };
    await prisma.userAchievement.delete({
      where: {
        userId_definitionId: {
          userId,
          definitionId
        }
      }
    });
    await prisma.userStats.update({
      where: { userId },
      data: {
        achievementCount: { decrement: 1 }
      }
    });
    await prisma.userAchievementProgress.delete({
      where: {
        userId_definitionId: {
          userId,
          definitionId
        }
      }
    }).catch(() => {
    });
    console.log(`\u274C Manual revocation: ${user.discordId} lost "${userAchievement.definition.name}" by admin ${adminId}`);
    endTimer("revoke_achievement", {
      userId,
      definitionId,
      adminId,
      success: true
    });
    return {
      success: true,
      message: `Achievement "${userAchievement.definition.name}" revoked from user ${user.discordId}`,
      data: revocationData
    };
  } catch (error) {
    endTimer("revoke_achievement", { success: false, error: String(error) });
    console.error("Error revoking achievement:", error);
    return {
      success: false,
      message: `Failed to revoke achievement: ${error}`
    };
  }
}
async function resetAchievementProgress(userId, definitionId, adminId, reason) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { discordId: true }
    });
    if (!user) {
      return { success: false, message: "User not found" };
    }
    const definition = await prisma.achievementDefinition.findUnique({
      where: { id: definitionId },
      select: { name: true }
    });
    if (!definition) {
      return { success: false, message: "Achievement definition not found" };
    }
    await prisma.userAchievementProgress.upsert({
      where: {
        userId_definitionId: {
          userId,
          definitionId
        }
      },
      create: {
        userId,
        definitionId,
        currentProgress: 0,
        lastProgressAt: /* @__PURE__ */ new Date(),
        lastCheckedAt: /* @__PURE__ */ new Date(),
        progressData: {
          resetBy: adminId,
          resetAt: (/* @__PURE__ */ new Date()).toISOString(),
          reason: reason || "Manual reset"
        }
      },
      update: {
        currentProgress: 0,
        lastProgressAt: /* @__PURE__ */ new Date(),
        lastCheckedAt: /* @__PURE__ */ new Date(),
        progressData: {
          resetBy: adminId,
          resetAt: (/* @__PURE__ */ new Date()).toISOString(),
          reason: reason || "Manual reset"
        }
      }
    });
    console.log(`\u{1F504} Progress reset: ${user.discordId} progress for "${definition.name}" reset by admin ${adminId}`);
    return {
      success: true,
      message: `Progress reset for "${definition.name}" for user ${user.discordId}`,
      data: {
        userDiscordId: user.discordId,
        achievementName: definition.name,
        resetBy: adminId,
        resetAt: /* @__PURE__ */ new Date()
      }
    };
  } catch (error) {
    console.error("Error resetting achievement progress:", error);
    return {
      success: false,
      message: `Failed to reset progress: ${error}`
    };
  }
}
async function recalculateAchievements(options = {}) {
  startTimer("recalculate_achievements");
  const {
    userId,
    category,
    definitionIds,
    dryRun = false,
    batchSize = 100
  } = options;
  try {
    console.log(`\u{1F504} Starting achievement recalculation (${dryRun ? "DRY RUN" : "LIVE"})...`);
    let usersProcessed = 0;
    let achievementsGranted = 0;
    let achievementsRevoked = 0;
    const errors = [];
    const userWhere = {};
    if (userId) userWhere.id = userId;
    const users = await prisma.user.findMany({
      where: userWhere,
      select: { id: true, discordId: true },
      take: userId ? 1 : void 0
    });
    let definitions = await getAchievementDefinitions();
    if (category) {
      definitions = definitions.filter((def) => def.category === category);
    }
    if (definitionIds) {
      definitions = definitions.filter((def) => definitionIds.includes(def.id));
    }
    console.log(`\u{1F4CA} Processing ${users.length} users for ${definitions.length} achievement definitions`);
    for (let i = 0; i < users.length; i += batchSize) {
      const userBatch = users.slice(i, i + batchSize);
      for (const user of userBatch) {
        try {
          for (const definition of definitions) {
            const shouldHave = await calculateProgressForUser(user.id, definition);
            const currentAchievement = await prisma.userAchievement.findUnique({
              where: {
                userId_definitionId: {
                  userId: user.id,
                  definitionId: definition.id
                }
              }
            });
            const hasAchievement = currentAchievement !== null;
            const shouldHaveAchievement = shouldHave >= definition.threshold;
            if (shouldHaveAchievement && !hasAchievement) {
              if (!dryRun) {
                await grantAchievement(user.id, definition.id, "system_recalc", "Recalculation grant", true);
              }
              achievementsGranted++;
              console.log(`\u2795 ${dryRun ? "[DRY RUN] " : ""}Grant: ${user.discordId} \u2192 ${definition.name}`);
            } else if (!shouldHaveAchievement && hasAchievement) {
              if (!definition.isRepeatable || currentAchievement.unlockCount === 1) {
                if (!dryRun) {
                  await revokeAchievement(user.id, definition.id, "system_recalc", "Recalculation revocation");
                }
                achievementsRevoked++;
                console.log(`\u2796 ${dryRun ? "[DRY RUN] " : ""}Revoke: ${user.discordId} \u2190 ${definition.name}`);
              }
            } else {
              if (!dryRun) {
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
                    currentProgress: shouldHave,
                    lastProgressAt: /* @__PURE__ */ new Date(),
                    lastCheckedAt: /* @__PURE__ */ new Date()
                  },
                  update: {
                    currentProgress: shouldHave,
                    lastCheckedAt: /* @__PURE__ */ new Date()
                  }
                });
              }
            }
          }
          usersProcessed++;
        } catch (error) {
          errors.push(`User ${user.discordId}: ${error}`);
          console.error(`Error processing user ${user.discordId}:`, error);
        }
      }
      if ((i + userBatch.length) % 500 === 0) {
        console.log(`\u{1F4C8} Processed ${i + userBatch.length}/${users.length} users...`);
      }
    }
    const result = {
      success: true,
      message: `Recalculation complete. Processed ${usersProcessed} users.`,
      data: {
        usersProcessed,
        achievementsGranted,
        achievementsRevoked,
        errors,
        dryRun
      }
    };
    endTimer("recalculate_achievements", result.data);
    console.log(`\u2705 Recalculation ${dryRun ? "(DRY RUN) " : ""}complete:`);
    console.log(`   Users processed: ${usersProcessed}`);
    console.log(`   Achievements granted: ${achievementsGranted}`);
    console.log(`   Achievements revoked: ${achievementsRevoked}`);
    console.log(`   Errors: ${errors.length}`);
    return result;
  } catch (error) {
    endTimer("recalculate_achievements", { success: false, error: String(error) });
    console.error("Error in achievement recalculation:", error);
    return {
      success: false,
      message: `Recalculation failed: ${error}`,
      data: {
        usersProcessed: 0,
        achievementsGranted: 0,
        achievementsRevoked: 0,
        errors: [String(error)],
        dryRun
      }
    };
  }
}
async function calculateProgressForUser(userId, definition) {
  const { criteriaType, criteriaData } = definition;
  switch (criteriaType) {
    case "count":
      if (criteriaData.field === "matches_won") {
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
      if (!streak) return 0;
      return criteriaData.field === "current_wins" ? streak.currentWins : streak.longestWins;
    case "sum":
      if (criteriaData.field === "total_tips_sent") {
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
async function exportAchievementData(options = {}) {
  startTimer("export_achievement_data");
  const {
    includeProgress = true,
    includeDefinitions = true,
    userId,
    format = "json"
  } = options;
  try {
    const exportData = {
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      version: "1.0"
    };
    if (includeDefinitions) {
      exportData.definitions = await prisma.achievementDefinition.findMany({
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }]
      });
    }
    const whereClause = userId ? { userId } : {};
    exportData.userAchievements = await prisma.userAchievement.findMany({
      where: whereClause,
      include: {
        user: { select: { discordId: true } },
        definition: { select: { name: true, category: true } }
      }
    });
    if (includeProgress) {
      exportData.userProgress = await prisma.userAchievementProgress.findMany({
        where: whereClause,
        include: {
          user: { select: { discordId: true } },
          definition: { select: { name: true, category: true } }
        }
      });
    }
    endTimer("export_achievement_data", {
      definitions: exportData.definitions?.length || 0,
      achievements: exportData.userAchievements.length,
      progress: exportData.userProgress?.length || 0
    });
    return JSON.stringify(exportData, null, 2);
  } catch (error) {
    endTimer("export_achievement_data", { success: false, error: String(error) });
    throw error;
  }
}
async function importAchievementDefinitions(definitionsData, options = {}) {
  const { overwrite = false, dryRun = false } = options;
  let imported = 0;
  let skipped = 0;
  const errors = [];
  for (const definition of definitionsData) {
    try {
      if (!dryRun) {
        const existingCount = await prisma.achievementDefinition.count({
          where: { name: definition.name }
        });
        if (existingCount > 0 && !overwrite) {
          skipped++;
          continue;
        }
        if (overwrite && existingCount > 0) {
          await prisma.achievementDefinition.updateMany({
            where: { name: definition.name },
            data: {
              ...definition,
              id: void 0,
              createdAt: void 0,
              updatedAt: /* @__PURE__ */ new Date(),
              version: { increment: 1 }
            }
          });
        } else {
          await prisma.achievementDefinition.create({
            data: {
              ...definition,
              id: void 0,
              createdAt: void 0,
              updatedAt: void 0
            }
          });
        }
      }
      imported++;
    } catch (error) {
      errors.push(`${definition.name}: ${error}`);
    }
  }
  if (!dryRun) {
    invalidateDefinitionCache();
  }
  return { success: true, imported, skipped, errors };
}
export {
  exportAchievementData,
  grantAchievement,
  importAchievementDefinitions,
  recalculateAchievements,
  resetAchievementProgress,
  revokeAchievement
};
//# sourceMappingURL=achievement_admin.js.map
