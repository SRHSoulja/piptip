// src/services/dynamic_achievements.ts - Netflix-style dynamic achievement engine

import { prisma } from "./db.js";
import { cacheWithMetrics, CacheKeys, CacheTTL, getCache } from "./cache.js";
import { startTimer, endTimer } from "./performance.js";

// Achievement criteria types
export type CriteriaType = 'count' | 'sum' | 'streak' | 'unique' | 'custom';

// Achievement criteria configuration
export interface CriteriaConfig {
  // For 'count': { field: 'matches_won', filter: { status: 'completed' } }
  // For 'sum': { field: 'amount', table: 'tips', filter: { status: 'completed' } }
  // For 'streak': { field: 'current_wins', resetOnLoss: true }
  // For 'unique': { field: 'recipient_id', table: 'tips' }
  // For 'custom': { function: 'calculateDepositsThisWeek', params: {} }
  [key: string]: any;
}

export interface AchievementDefinitionFull {
  id: number;
  name: string;
  description: string;
  category: string;
  criteriaType: CriteriaType;
  criteriaData: CriteriaConfig;
  threshold: number;
  iconEmoji: string;
  badgeColor: string;
  rarity: string;
  isEnabled: boolean;
  isVisible: boolean;
  isRepeatable: boolean;
  cooldownHours?: number;
  startDate?: Date;
  endDate?: Date;
  sortOrder: number;
  tier: number;
  version: number;
}

// Global definition cache with invalidation
let definitionCache: Map<number, AchievementDefinitionFull> | null = null;
let cacheLastUpdated = 0;
const DEFINITION_CACHE_TTL = 30000; // 30 seconds

// Load achievement definitions from database with aggressive caching
export async function getAchievementDefinitions(forceRefresh = false): Promise<AchievementDefinitionFull[]> {
  const now = Date.now();

  if (!forceRefresh && definitionCache && (now - cacheLastUpdated) < DEFINITION_CACHE_TTL) {
    return Array.from(definitionCache.values());
  }

  startTimer('load_definitions');

  try {
    const definitions = await prisma.achievementDefinition.findMany({
      where: {
        isEnabled: true,
        AND: [
          {
            OR: [
              { startDate: null },
              { startDate: { lte: new Date() } }
            ]
          },
          {
            OR: [
              { endDate: null },
              { endDate: { gte: new Date() } }
            ]
          }
        ]
      },
      orderBy: [
        { category: 'asc' },
        { sortOrder: 'asc' },
        { tier: 'asc' }
      ]
    });

    // Convert to cache format
    definitionCache = new Map();
    const result: AchievementDefinitionFull[] = definitions.map(def => {
      const full: AchievementDefinitionFull = {
        id: def.id,
        name: def.name,
        description: def.description,
        category: def.category,
        criteriaType: def.criteriaType as CriteriaType,
        criteriaData: def.criteriaData as CriteriaConfig,
        threshold: Number(def.threshold),
        iconEmoji: def.iconEmoji,
        badgeColor: def.badgeColor,
        rarity: def.rarity,
        isEnabled: def.isEnabled,
        isVisible: def.isVisible,
        isRepeatable: def.isRepeatable,
        cooldownHours: def.cooldownHours ?? undefined,
        startDate: def.startDate ?? undefined,
        endDate: def.endDate ?? undefined,
        sortOrder: def.sortOrder,
        tier: def.tier,
        version: def.version
      };

      definitionCache!.set(def.id, full);
      return full;
    });

    cacheLastUpdated = now;
    endTimer('load_definitions', { count: result.length });

    console.log(`📋 Loaded ${result.length} achievement definitions`);
    return result;

  } catch (error) {
    endTimer('load_definitions', { success: false, error: String(error) });
    throw error;
  }
}

// Invalidate definition cache (call when admin makes changes)
export function invalidateDefinitionCache(): void {
  definitionCache = null;
  cacheLastUpdated = 0;
  console.log('🔄 Achievement definition cache invalidated');
}

// Event-driven achievement checking
export async function processAchievementEvent(
  userId: number,
  eventType: 'match' | 'tip' | 'deposit' | 'referral' | 'custom',
  eventData: any
): Promise<string[]> {
  startTimer('achievement_event');

  try {
    const definitions = await getAchievementDefinitions();
    const relevantDefinitions = definitions.filter(def =>
      def.category === eventType || def.criteriaType === 'custom'
    );

    const newAchievements: string[] = [];

    for (const definition of relevantDefinitions) {
      try {
        const shouldCheck = await shouldCheckAchievement(userId, definition);
        if (!shouldCheck) continue;

        const currentProgress = await calculateProgress(userId, definition, eventData);

        // Update progress tracking
        await updateUserProgress(userId, definition.id, currentProgress, eventData);

        // Check if achievement should be unlocked
        if (currentProgress >= definition.threshold) {
          const unlocked = await unlockAchievement(userId, definition, currentProgress, eventData);
          if (unlocked) {
            newAchievements.push(formatAchievementUnlock(definition));
          }
        }

      } catch (error) {
        console.error(`Error processing achievement ${definition.name} for user ${userId}:`, error);
      }
    }

    endTimer('achievement_event', {
      userId,
      eventType,
      relevantDefinitions: relevantDefinitions.length,
      newAchievements: newAchievements.length
    });

    return newAchievements;

  } catch (error) {
    endTimer('achievement_event', { success: false, error: String(error) });
    throw error;
  }
}

// Check if we should process this achievement for this user
async function shouldCheckAchievement(userId: number, definition: AchievementDefinitionFull): Promise<boolean> {
  // Check if user already has this achievement (for non-repeatable)
  if (!definition.isRepeatable) {
    const existing = await prisma.userAchievement.findUnique({
      where: {
        userId_definitionId: {
          userId,
          definitionId: definition.id
        }
      }
    });

    if (existing) return false;
  }

  // Check cooldown for repeatable achievements
  if (definition.isRepeatable && definition.cooldownHours) {
    const cooldownEnd = new Date(Date.now() - (definition.cooldownHours * 60 * 60 * 1000));

    const recentUnlock = await prisma.userAchievement.findFirst({
      where: {
        userId,
        definitionId: definition.id,
        lastUnlockedAt: {
          gte: cooldownEnd
        }
      }
    });

    if (recentUnlock) return false;
  }

  return true;
}

// Calculate current progress for an achievement
async function calculateProgress(userId: number, definition: AchievementDefinitionFull, eventData: any): Promise<number> {
  const { criteriaType, criteriaData } = definition;

  startTimer('calculate_progress');

  try {
    let progress = 0;

    switch (criteriaType) {
      case 'count':
        progress = await calculateCountProgress(userId, criteriaData);
        break;

      case 'sum':
        progress = await calculateSumProgress(userId, criteriaData);
        break;

      case 'streak':
        progress = await calculateStreakProgress(userId, criteriaData);
        break;

      case 'unique':
        progress = await calculateUniqueProgress(userId, criteriaData);
        break;

      case 'custom':
        progress = await calculateCustomProgress(userId, criteriaData, eventData);
        break;

      default:
        throw new Error(`Unknown criteria type: ${criteriaType}`);
    }

    endTimer('calculate_progress', {
      criteriaType,
      userId,
      definitionId: definition.id,
      progress
    });

    return progress;

  } catch (error) {
    endTimer('calculate_progress', { success: false, error: String(error) });
    throw error;
  }
}

// Count-based progress calculation
async function calculateCountProgress(userId: number, criteria: CriteriaConfig): Promise<number> {
  const { table, field, filter = {} } = criteria;

  // Use UserStats table for optimized queries when possible
  if (table === 'matches' && field === 'won') {
    const stats = await prisma.userStats.findUnique({
      where: { userId },
      select: { matchesWon: true }
    });
    return stats?.matchesWon || 0;
  }

  if (table === 'tips' && field === 'sent') {
    const stats = await prisma.userStats.findUnique({
      where: { userId },
      select: { totalTipsSent: true }
    });
    return stats?.totalTipsSent || 0;
  }

  // Fallback to dynamic query (slower but flexible)
  // This would need to be implemented based on specific criteria
  console.warn(`Count calculation not optimized for ${table}.${field}`);
  return 0;
}

// Sum-based progress calculation
async function calculateSumProgress(userId: number, criteria: CriteriaConfig): Promise<number> {
  const { table, field, filter = {} } = criteria;

  // Use UserStats for optimized queries
  if (table === 'tips' && field === 'amount_sent') {
    const stats = await prisma.userStats.findUnique({
      where: { userId },
      select: { totalTipAmountSent: true }
    });
    return Number(stats?.totalTipAmountSent || 0);
  }

  if (table === 'deposits' && field === 'total_deposited') {
    const stats = await prisma.userStats.findUnique({
      where: { userId },
      select: { totalDeposited: true }
    });
    return Number(stats?.totalDeposited || 0);
  }

  console.warn(`Sum calculation not optimized for ${table}.${field}`);
  return 0;
}

// Streak-based progress calculation
async function calculateStreakProgress(userId: number, criteria: CriteriaConfig): Promise<number> {
  const { field } = criteria;

  const streak = await prisma.userStreak.findUnique({
    where: { userId },
    select: {
      currentWins: true,
      longestWins: true
    }
  });

  if (!streak) return 0;

  switch (field) {
    case 'current_wins':
      return streak.currentWins;
    case 'longest_wins':
      return streak.longestWins;
    default:
      return 0;
  }
}

// Unique count-based progress calculation
async function calculateUniqueProgress(userId: number, criteria: CriteriaConfig): Promise<number> {
  const { field } = criteria;

  if (field === 'tip_recipients') {
    const stats = await prisma.userStats.findUnique({
      where: { userId },
      select: { uniqueRecipients: true }
    });
    return stats?.uniqueRecipients || 0;
  }

  console.warn(`Unique calculation not implemented for ${field}`);
  return 0;
}

// Custom progress calculation (extendable)
async function calculateCustomProgress(userId: number, criteria: CriteriaConfig, eventData: any): Promise<number> {
  const { function: functionName, params = {} } = criteria;

  switch (functionName) {
    case 'depositsThisWeek':
      return await calculateDepositsThisWeek(userId, params);

    case 'tipsToday':
      return await calculateTipsToday(userId, params);

    case 'uniqueTokensUsed':
      return await calculateUniqueTokensUsed(userId, params);

    default:
      console.warn(`Custom function not implemented: ${functionName}`);
      return 0;
  }
}

// Custom progress functions (examples)
async function calculateDepositsThisWeek(userId: number, params: any): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // This would need actual deposit tracking implementation
  console.warn('depositsThisWeek calculation not implemented');
  return 0;
}

async function calculateTipsToday(userId: number, params: any): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const count = await prisma.tip.count({
    where: {
      fromUserId: userId,
      createdAt: { gte: today },
      status: 'COMPLETED'
    }
  });

  return count;
}

async function calculateUniqueTokensUsed(userId: number, params: any): Promise<number> {
  const uniqueTokens = await prisma.tip.groupBy({
    by: ['tokenId'],
    where: {
      fromUserId: userId,
      status: 'COMPLETED'
    },
    _count: { tokenId: true }
  });

  return uniqueTokens.length;
}

// Update user progress tracking
async function updateUserProgress(userId: number, definitionId: number, currentProgress: number, eventData: any): Promise<void> {
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
      currentProgress,
      lastProgressAt: new Date(),
      lastCheckedAt: new Date(),
      progressData: eventData
    },
    update: {
      currentProgress,
      lastProgressAt: new Date(),
      lastCheckedAt: new Date(),
      progressData: eventData
    }
  });
}

// Unlock achievement for user
async function unlockAchievement(
  userId: number,
  definition: AchievementDefinitionFull,
  currentProgress: number,
  eventData: any
): Promise<boolean> {
  try {
    await prisma.userAchievement.upsert({
      where: {
        userId_definitionId: {
          userId,
          definitionId: definition.id
        }
      },
      create: {
        userId,
        definitionId: definition.id,
        currentProgress,
        targetProgress: definition.threshold,
        unlockedAt: new Date(),
        lastUnlockedAt: new Date(),
        unlockCount: 1,
        data: eventData
      },
      update: {
        lastUnlockedAt: new Date(),
        unlockCount: { increment: 1 },
        data: eventData
      }
    });

    // Update user stats
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

    console.log(`🏆 Achievement unlocked: ${definition.name} for user ${userId} (progress: ${currentProgress}/${definition.threshold})`);
    return true;

  } catch (error) {
    console.error('Error unlocking achievement:', error);
    return false;
  }
}

// Format achievement unlock message
function formatAchievementUnlock(definition: AchievementDefinitionFull): string {
  return `${definition.iconEmoji} **${definition.name}** - ${definition.description}`;
}

// Batch processing for all users (scheduled job)
export async function batchProcessAchievements(category?: string, limit: number = 100): Promise<number> {
  startTimer('batch_process');

  try {
    // Get users who need achievement checking
    const users = await prisma.user.findMany({
      select: { id: true },
      take: limit,
      orderBy: { id: 'asc' }
    });

    let totalProcessed = 0;
    const definitions = await getAchievementDefinitions();
    const relevantDefinitions = category
      ? definitions.filter(def => def.category === category)
      : definitions;

    for (const user of users) {
      try {
        const newAchievements = [];

        for (const definition of relevantDefinitions) {
          const shouldCheck = await shouldCheckAchievement(user.id, definition);
          if (!shouldCheck) continue;

          const currentProgress = await calculateProgress(user.id, definition, {});
          await updateUserProgress(user.id, definition.id, currentProgress, {});

          if (currentProgress >= definition.threshold) {
            const unlocked = await unlockAchievement(user.id, definition, currentProgress, {});
            if (unlocked) {
              newAchievements.push(definition.name);
            }
          }
        }

        if (newAchievements.length > 0) {
          console.log(`📈 Batch processed ${newAchievements.length} achievements for user ${user.id}`);
        }

        totalProcessed++;

      } catch (error) {
        console.error(`Error in batch processing for user ${user.id}:`, error);
      }
    }

    endTimer('batch_process', {
      category,
      usersProcessed: totalProcessed,
      definitionsChecked: relevantDefinitions.length
    });

    return totalProcessed;

  } catch (error) {
    endTimer('batch_process', { success: false, error: String(error) });
    throw error;
  }
}