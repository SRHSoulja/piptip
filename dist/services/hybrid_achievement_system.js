import { prisma } from "./db.js";
import { getUserAchievements as getLegacyAchievements } from "./streaks.js";
import { startTimer, endTimer } from "./performance.js";
async function getMigrationPhase() {
  try {
    const config = await prisma.appConfig.findFirst({
      select: {
        // Add migration phase field to AppConfig model
        // migrationPhase: true  // Will need schema update
      }
    });
    const dynamicCount = await prisma.achievementDefinition.count({
      where: { isEnabled: true }
    });
    const legacyCount = await prisma.achievement.count();
    if (dynamicCount === 0 && legacyCount > 0) return "legacy_only";
    if (dynamicCount > 0 && legacyCount > 0) return "hybrid";
    return "dynamic_only";
  } catch (error) {
    console.warn("Could not determine migration phase, defaulting to legacy:", error);
    return "legacy_only";
  }
}
async function getHybridAchievements(discordId) {
  const phase = await getMigrationPhase();
  startTimer("hybrid_achievements");
  try {
    switch (phase) {
      case "legacy_only":
        const legacyAchievements = await getLegacyAchievements(discordId);
        endTimer("hybrid_achievements", { phase, count: legacyAchievements.length });
        return legacyAchievements;
      case "hybrid":
        const [dynamicAchievements, hybridLegacyAchievements] = await Promise.all([
          getDynamicAchievements(discordId),
          getLegacyAchievements(discordId)
        ]);
        const migratedTypes = new Set(dynamicAchievements.map((a) => a.category));
        const filteredLegacy = hybridLegacyAchievements.filter(
          (a) => !migratedTypes.has(mapLegacyTypeToCategory(a.type))
        );
        const combined = [...dynamicAchievements, ...filteredLegacy];
        endTimer("hybrid_achievements", { phase, count: combined.length });
        return combined;
      case "dynamic_only":
        const dynamicOnly = await getDynamicAchievements(discordId);
        endTimer("hybrid_achievements", { phase, count: dynamicOnly.length });
        return dynamicOnly;
    }
  } catch (error) {
    endTimer("hybrid_achievements", { success: false, error: String(error) });
    throw error;
  }
}
async function getDynamicAchievements(discordId) {
  const user = await prisma.user.findUnique({
    where: { discordId },
    include: {
      unlockedAchievements: {
        include: { definition: true },
        orderBy: { unlockedAt: "desc" }
      }
    }
  });
  if (!user) return [];
  return user.unlockedAchievements.map((achievement) => ({
    id: achievement.id,
    name: achievement.definition.name,
    description: achievement.definition.description,
    category: achievement.definition.category,
    iconEmoji: achievement.definition.iconEmoji,
    badgeColor: achievement.definition.badgeColor,
    rarity: achievement.definition.rarity,
    unlockedAt: achievement.unlockedAt,
    progress: achievement.currentProgress,
    target: achievement.targetProgress,
    unlockCount: achievement.unlockCount,
    source: "dynamic"
    // Track source for debugging
  }));
}
function mapLegacyTypeToCategory(legacyType) {
  const mapping = {
    "win_streak": "streaks",
    "longest_streak": "streaks",
    "total_tips": "tips",
    "tip_count": "tips",
    "deposit_milestone": "deposits",
    "referral_count": "referrals"
  };
  return mapping[legacyType] || "special";
}
async function getMigrationProgress() {
  const [phase, legacyCount, dynamicCount, totalUsers, migratedUsers] = await Promise.all([
    getMigrationPhase(),
    prisma.achievement.count(),
    prisma.userAchievement.count(),
    prisma.user.count(),
    prisma.user.count({
      where: {
        unlockedAchievements: {
          some: {}
          // Users who have at least one dynamic achievement
        }
      }
    })
  ]);
  const completionPercent = totalUsers > 0 ? migratedUsers / totalUsers * 100 : 0;
  return {
    phase,
    legacyCount,
    dynamicCount,
    migratedUsers,
    totalUsers,
    completionPercent: Math.round(completionPercent * 100) / 100
  };
}
async function runSafeMigration(batchSize = 50, maxBatches = 10, dryRun = true) {
  console.log(`\u{1F504} Starting ${dryRun ? "DRY RUN" : "LIVE"} migration (batch size: ${batchSize})`);
  let processed = 0;
  let migrated = 0;
  const errors = [];
  try {
    const unmigrated = await prisma.user.findMany({
      where: {
        // Users with legacy achievements but no dynamic ones
        legacyAchievements: {
          some: {}
        },
        unlockedAchievements: {
          none: {}
        }
      },
      select: { id: true, discordId: true },
      take: batchSize * maxBatches
    });
    console.log(`\u{1F4CA} Found ${unmigrated.length} users to migrate`);
    for (let i = 0; i < unmigrated.length; i += batchSize) {
      const batch = unmigrated.slice(i, i + batchSize);
      console.log(`\u{1F4E6} Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} users`);
      for (const user of batch) {
        try {
          const result = await migrateSingleUser(user.id, dryRun);
          if (result.migrated > 0) {
            migrated++;
          }
          processed++;
          if (processed % 100 === 0) {
            console.log(`\u{1F4C8} Progress: ${processed} users processed, ${migrated} migrated`);
          }
        } catch (error) {
          errors.push(`User ${user.discordId}: ${error}`);
          console.error(`\u274C Error migrating user ${user.discordId}:`, error);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const remainingCount = await prisma.user.count({
      where: {
        legacyAchievements: { some: {} },
        unlockedAchievements: { none: {} }
      }
    });
    console.log(`\u2705 Migration batch complete:`);
    console.log(`   Processed: ${processed} users`);
    console.log(`   Migrated: ${migrated} users`);
    console.log(`   Errors: ${errors.length}`);
    console.log(`   Remaining: ${remainingCount} users`);
    return {
      success: true,
      processed,
      migrated,
      errors,
      remainingUsers: remainingCount
    };
  } catch (error) {
    console.error("\u{1F4A5} Migration batch failed:", error);
    return {
      success: false,
      processed,
      migrated,
      errors: [...errors, String(error)],
      remainingUsers: -1
    };
  }
}
async function migrateSingleUser(userId, dryRun = true) {
  const legacyAchievements = await prisma.achievement.findMany({
    where: { userId },
    include: { user: { select: { discordId: true } } }
  });
  let migrated = 0;
  const errors = [];
  for (const legacy of legacyAchievements) {
    try {
      const category = mapLegacyTypeToCategory(legacy.type);
      const definition = await findMatchingDefinition(legacy.type, legacy.level);
      if (!definition) {
        errors.push(`No dynamic definition found for ${legacy.type}:${legacy.level}`);
        continue;
      }
      if (!dryRun) {
        await prisma.userAchievement.create({
          data: {
            userId,
            definitionId: definition.id,
            currentProgress: Number(definition.threshold),
            targetProgress: Number(definition.threshold),
            unlockedAt: legacy.unlockedAt,
            lastUnlockedAt: legacy.unlockedAt,
            unlockCount: 1,
            data: {
              migratedFrom: {
                id: legacy.id,
                type: legacy.type,
                level: legacy.level
              }
            }
          }
        });
      }
      migrated++;
    } catch (error) {
      errors.push(`${legacy.type}:${legacy.level} - ${error}`);
    }
  }
  return { migrated, errors };
}
async function findMatchingDefinition(legacyType, level) {
  const mappings = {
    "win_streak": {
      3: "Hot Streak",
      5: "Win Streak 5",
      10: "Unstoppable",
      25: "Legendary Streak"
    },
    "total_tips": {
      1: "First Tip",
      50: "Generous Tipper",
      500: "Tip Master"
    }
  };
  const definitionName = mappings[legacyType]?.[level];
  if (!definitionName) return null;
  return await prisma.achievementDefinition.findFirst({
    where: { name: definitionName, isEnabled: true }
  });
}
export {
  getHybridAchievements,
  getMigrationProgress,
  runSafeMigration
};
//# sourceMappingURL=hybrid_achievement_system.js.map
