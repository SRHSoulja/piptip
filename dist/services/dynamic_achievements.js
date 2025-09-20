// src/services/dynamic_achievements.ts - Netflix-style dynamic achievement engine
import { prisma } from "./db.js";
import { startTimer, endTimer } from "./performance.js";
import { awardAchievementXP } from "./xp_integration.js";
// Global definition cache with invalidation
let definitionCache = null;
let cacheLastUpdated = 0;
const DEFINITION_CACHE_TTL = 30000; // 30 seconds
// Load achievement definitions from database with aggressive caching
export async function getAchievementDefinitions(forceRefresh = false) {
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
        const result = definitions.map(def => {
            const full = {
                id: def.id,
                name: def.name,
                description: def.description,
                category: def.category,
                criteriaType: def.criteriaType,
                criteriaData: def.criteriaData,
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
            definitionCache.set(def.id, full);
            return full;
        });
        cacheLastUpdated = now;
        endTimer('load_definitions', { count: result.length });
        console.log(`📋 Loaded ${result.length} achievement definitions`);
        return result;
    }
    catch (error) {
        endTimer('load_definitions', { success: false, error: String(error) });
        throw error;
    }
}
// Invalidate definition cache (call when admin makes changes)
export function invalidateDefinitionCache() {
    definitionCache = null;
    cacheLastUpdated = 0;
    console.log('🔄 Achievement definition cache invalidated');
}
// Event-driven achievement checking
export async function processAchievementEvent(userId, eventType, eventData) {
    startTimer('achievement_event');
    try {
        const definitions = await getAchievementDefinitions();
        const relevantDefinitions = definitions.filter(def => def.category === eventType || def.criteriaType === 'custom');
        const newAchievements = [];
        for (const definition of relevantDefinitions) {
            try {
                const shouldCheck = await shouldCheckAchievement(userId, definition);
                if (!shouldCheck)
                    continue;
                const currentProgress = await calculateProgress(userId, definition, eventData);
                // Update progress tracking
                await updateUserProgress(userId, definition.id, currentProgress, eventData);
                // Check if achievement should be unlocked (atomic to prevent double-unlocks)
                if (currentProgress >= definition.threshold) {
                    try {
                        const unlocked = await unlockAchievement(userId, definition, currentProgress, eventData);
                        if (unlocked) {
                            newAchievements.push(formatAchievementUnlock(definition));
                        }
                    }
                    catch (error) {
                        // Likely already unlocked by concurrent process - ignore
                        if (!error.message?.includes('already unlocked')) {
                            throw error;
                        }
                    }
                }
            }
            catch (error) {
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
    }
    catch (error) {
        endTimer('achievement_event', { success: false, error: String(error) });
        throw error;
    }
}
// Check if we should process this achievement for this user
async function shouldCheckAchievement(userId, definition) {
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
        if (existing)
            return false;
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
        if (recentUnlock)
            return false;
    }
    return true;
}
// Calculate current progress for an achievement
async function calculateProgress(userId, definition, eventData) {
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
    }
    catch (error) {
        endTimer('calculate_progress', { success: false, error: String(error) });
        throw error;
    }
}
// Count-based progress calculation
async function calculateCountProgress(userId, criteria) {
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
async function calculateSumProgress(userId, criteria) {
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
async function calculateStreakProgress(userId, criteria) {
    const { field } = criteria;
    const streak = await prisma.userStreak.findUnique({
        where: { userId },
        select: {
            currentWins: true,
            longestWins: true
        }
    });
    if (!streak)
        return 0;
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
async function calculateUniqueProgress(userId, criteria) {
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
async function calculateCustomProgress(userId, criteria, eventData) {
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
async function calculateDepositsThisWeek(userId, params) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // This would need actual deposit tracking implementation
    console.warn('depositsThisWeek calculation not implemented');
    return 0;
}
async function calculateTipsToday(userId, params) {
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
async function calculateUniqueTokensUsed(userId, params) {
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
async function updateUserProgress(userId, definitionId, currentProgress, eventData) {
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
async function unlockAchievement(userId, definition, currentProgress, eventData) {
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
        // Award XP for achievement unlock
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { discordId: true }
            });
            if (user?.discordId) {
                await awardAchievementXP(user.discordId, definition.name);
            }
        }
        catch (xpError) {
            console.warn('Failed to award XP for achievement:', xpError);
        }
        console.log(`🏆 Achievement unlocked: ${definition.name} for user ${userId} (progress: ${currentProgress}/${definition.threshold})`);
        return true;
    }
    catch (error) {
        console.error('Error unlocking achievement:', error);
        return false;
    }
}
// Format achievement unlock message
function formatAchievementUnlock(definition) {
    return `${definition.iconEmoji} **${definition.name}** - ${definition.description}`;
}
// Batch processing for all users (scheduled job)
export async function batchProcessAchievements(category, limit = 100) {
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
                    if (!shouldCheck)
                        continue;
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
            }
            catch (error) {
                console.error(`Error in batch processing for user ${user.id}:`, error);
            }
        }
        endTimer('batch_process', {
            category,
            usersProcessed: totalProcessed,
            definitionsChecked: relevantDefinitions.length
        });
        return totalProcessed;
    }
    catch (error) {
        endTimer('batch_process', { success: false, error: String(error) });
        throw error;
    }
}
