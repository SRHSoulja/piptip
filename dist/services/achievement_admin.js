// src/services/achievement_admin.ts - Manual admin controls for achievements
import { prisma } from './db.js';
import { invalidateDefinitionCache, getAchievementDefinitions } from './dynamic_achievements.js';
import { startTimer, endTimer } from './performance.js';
// Grant achievement to specific user
export async function grantAchievement(userId, definitionId, adminId, reason, skipValidation = false) {
    startTimer('grant_achievement');
    try {
        // Validate user exists
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { discordId: true }
        });
        if (!user) {
            return { success: false, message: 'User not found' };
        }
        // Validate achievement definition exists
        const definition = await prisma.achievementDefinition.findUnique({
            where: { id: definitionId }
        });
        if (!definition) {
            return { success: false, message: 'Achievement definition not found' };
        }
        // Check if user already has this achievement (for non-repeatable)
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
        // Check cooldown for repeatable achievements
        if (!skipValidation && definition.isRepeatable && definition.cooldownHours) {
            const cooldownEnd = new Date(Date.now() - (definition.cooldownHours * 60 * 60 * 1000));
            const recentUnlock = await prisma.userAchievement.findFirst({
                where: {
                    userId,
                    definitionId,
                    lastUnlockedAt: { gte: cooldownEnd }
                }
            });
            if (recentUnlock) {
                const hoursLeft = Math.ceil((recentUnlock.lastUnlockedAt.getTime() + definition.cooldownHours * 60 * 60 * 1000 - Date.now()) / (60 * 60 * 1000));
                return {
                    success: false,
                    message: `Cooldown active. ${hoursLeft} hours remaining.`
                };
            }
        }
        // Grant the achievement
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
                unlockedAt: new Date(),
                lastUnlockedAt: new Date(),
                unlockCount: 1,
                data: {
                    grantedBy: adminId,
                    reason: reason || 'Manual grant',
                    grantedAt: new Date().toISOString()
                }
            },
            update: {
                lastUnlockedAt: new Date(),
                unlockCount: { increment: 1 },
                data: {
                    grantedBy: adminId,
                    reason: reason || 'Manual grant (repeat)',
                    grantedAt: new Date().toISOString()
                }
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
        // Update progress tracking
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
                lastProgressAt: new Date(),
                lastCheckedAt: new Date(),
                progressData: {
                    grantedBy: adminId,
                    reason
                }
            },
            update: {
                currentProgress: Number(definition.threshold),
                lastProgressAt: new Date(),
                lastCheckedAt: new Date(),
                progressData: {
                    grantedBy: adminId,
                    reason
                }
            }
        });
        endTimer('grant_achievement', {
            userId,
            definitionId,
            adminId,
            success: true
        });
        console.log(`🏆 Manual grant: ${user.discordId} received "${definition.name}" by admin ${adminId}`);
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
    }
    catch (error) {
        endTimer('grant_achievement', { success: false, error: String(error) });
        console.error('Error granting achievement:', error);
        return {
            success: false,
            message: `Failed to grant achievement: ${error}`
        };
    }
}
// Revoke achievement from user
export async function revokeAchievement(userId, definitionId, adminId, reason) {
    startTimer('revoke_achievement');
    try {
        // Validate user exists
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { discordId: true }
        });
        if (!user) {
            return { success: false, message: 'User not found' };
        }
        // Find the achievement
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
                message: 'User does not have this achievement'
            };
        }
        // Store revocation data before deletion
        const revocationData = {
            userId,
            definitionId,
            achievementName: userAchievement.definition.name,
            originalUnlockDate: userAchievement.unlockedAt,
            unlockCount: userAchievement.unlockCount,
            revokedBy: adminId,
            revokedAt: new Date(),
            reason: reason || 'Manual revocation'
        };
        // Delete the achievement
        await prisma.userAchievement.delete({
            where: {
                userId_definitionId: {
                    userId,
                    definitionId
                }
            }
        });
        // Update user stats
        await prisma.userStats.update({
            where: { userId },
            data: {
                achievementCount: { decrement: 1 }
            }
        });
        // Clear progress tracking
        await prisma.userAchievementProgress.delete({
            where: {
                userId_definitionId: {
                    userId,
                    definitionId
                }
            }
        }).catch(() => {
            // Progress might not exist, ignore
        });
        // Log the revocation (could store in a separate revocations table)
        console.log(`❌ Manual revocation: ${user.discordId} lost "${userAchievement.definition.name}" by admin ${adminId}`);
        endTimer('revoke_achievement', {
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
    }
    catch (error) {
        endTimer('revoke_achievement', { success: false, error: String(error) });
        console.error('Error revoking achievement:', error);
        return {
            success: false,
            message: `Failed to revoke achievement: ${error}`
        };
    }
}
// Reset user's progress for specific achievement
export async function resetAchievementProgress(userId, definitionId, adminId, reason) {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { discordId: true }
        });
        if (!user) {
            return { success: false, message: 'User not found' };
        }
        const definition = await prisma.achievementDefinition.findUnique({
            where: { id: definitionId },
            select: { name: true }
        });
        if (!definition) {
            return { success: false, message: 'Achievement definition not found' };
        }
        // Reset progress tracking
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
                lastProgressAt: new Date(),
                lastCheckedAt: new Date(),
                progressData: {
                    resetBy: adminId,
                    resetAt: new Date().toISOString(),
                    reason: reason || 'Manual reset'
                }
            },
            update: {
                currentProgress: 0,
                lastProgressAt: new Date(),
                lastCheckedAt: new Date(),
                progressData: {
                    resetBy: adminId,
                    resetAt: new Date().toISOString(),
                    reason: reason || 'Manual reset'
                }
            }
        });
        console.log(`🔄 Progress reset: ${user.discordId} progress for "${definition.name}" reset by admin ${adminId}`);
        return {
            success: true,
            message: `Progress reset for "${definition.name}" for user ${user.discordId}`,
            data: {
                userDiscordId: user.discordId,
                achievementName: definition.name,
                resetBy: adminId,
                resetAt: new Date()
            }
        };
    }
    catch (error) {
        console.error('Error resetting achievement progress:', error);
        return {
            success: false,
            message: `Failed to reset progress: ${error}`
        };
    }
}
// Recalculate achievements for all users (dry-run mode available)
export async function recalculateAchievements(options = {}) {
    startTimer('recalculate_achievements');
    const { userId, category, definitionIds, dryRun = false, batchSize = 100 } = options;
    try {
        console.log(`🔄 Starting achievement recalculation (${dryRun ? 'DRY RUN' : 'LIVE'})...`);
        let usersProcessed = 0;
        let achievementsGranted = 0;
        let achievementsRevoked = 0;
        const errors = [];
        // Get users to process
        const userWhere = {};
        if (userId)
            userWhere.id = userId;
        const users = await prisma.user.findMany({
            where: userWhere,
            select: { id: true, discordId: true },
            take: userId ? 1 : undefined
        });
        // Get achievement definitions to check
        let definitions = await getAchievementDefinitions();
        if (category) {
            definitions = definitions.filter(def => def.category === category);
        }
        if (definitionIds) {
            definitions = definitions.filter(def => definitionIds.includes(def.id));
        }
        console.log(`📊 Processing ${users.length} users for ${definitions.length} achievement definitions`);
        // Process users in batches
        for (let i = 0; i < users.length; i += batchSize) {
            const userBatch = users.slice(i, i + batchSize);
            for (const user of userBatch) {
                try {
                    for (const definition of definitions) {
                        // Calculate what the user's progress should be
                        const shouldHave = await calculateProgressForUser(user.id, definition);
                        // Check what they currently have
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
                        // Determine action needed
                        if (shouldHaveAchievement && !hasAchievement) {
                            // Grant achievement
                            if (!dryRun) {
                                await grantAchievement(user.id, definition.id, 'system_recalc', 'Recalculation grant', true);
                            }
                            achievementsGranted++;
                            console.log(`➕ ${dryRun ? '[DRY RUN] ' : ''}Grant: ${user.discordId} → ${definition.name}`);
                        }
                        else if (!shouldHaveAchievement && hasAchievement) {
                            // Revoke achievement (if not repeatable or has multiple unlocks)
                            if (!definition.isRepeatable || currentAchievement.unlockCount === 1) {
                                if (!dryRun) {
                                    await revokeAchievement(user.id, definition.id, 'system_recalc', 'Recalculation revocation');
                                }
                                achievementsRevoked++;
                                console.log(`➖ ${dryRun ? '[DRY RUN] ' : ''}Revoke: ${user.discordId} ← ${definition.name}`);
                            }
                        }
                        else {
                            // Update progress tracking if needed
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
                                        lastProgressAt: new Date(),
                                        lastCheckedAt: new Date()
                                    },
                                    update: {
                                        currentProgress: shouldHave,
                                        lastCheckedAt: new Date()
                                    }
                                });
                            }
                        }
                    }
                    usersProcessed++;
                }
                catch (error) {
                    errors.push(`User ${user.discordId}: ${error}`);
                    console.error(`Error processing user ${user.discordId}:`, error);
                }
            }
            // Progress update
            if ((i + userBatch.length) % 500 === 0) {
                console.log(`📈 Processed ${i + userBatch.length}/${users.length} users...`);
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
        endTimer('recalculate_achievements', result.data);
        console.log(`✅ Recalculation ${dryRun ? '(DRY RUN) ' : ''}complete:`);
        console.log(`   Users processed: ${usersProcessed}`);
        console.log(`   Achievements granted: ${achievementsGranted}`);
        console.log(`   Achievements revoked: ${achievementsRevoked}`);
        console.log(`   Errors: ${errors.length}`);
        return result;
    }
    catch (error) {
        endTimer('recalculate_achievements', { success: false, error: String(error) });
        console.error('Error in achievement recalculation:', error);
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
// Helper function to calculate what a user's progress should be
async function calculateProgressForUser(userId, definition) {
    // This is a simplified version - in practice, this would use the same
    // logic as the dynamic achievement processor
    const { criteriaType, criteriaData } = definition;
    switch (criteriaType) {
        case 'count':
            // Use UserStats for optimized queries
            if (criteriaData.field === 'matches_won') {
                const stats = await prisma.userStats.findUnique({
                    where: { userId },
                    select: { matchesWon: true }
                });
                return stats?.matchesWon || 0;
            }
            break;
        case 'streak':
            const streak = await prisma.userStreak.findUnique({
                where: { userId },
                select: { currentWins: true, longestWins: true }
            });
            if (!streak)
                return 0;
            return criteriaData.field === 'current_wins'
                ? streak.currentWins
                : streak.longestWins;
        case 'sum':
            if (criteriaData.field === 'total_tips_sent') {
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
// Export achievement data for backup/migration
export async function exportAchievementData(options = {}) {
    startTimer('export_achievement_data');
    const { includeProgress = true, includeDefinitions = true, userId, format = 'json' } = options;
    try {
        const exportData = {
            exportedAt: new Date().toISOString(),
            version: '1.0'
        };
        if (includeDefinitions) {
            exportData.definitions = await prisma.achievementDefinition.findMany({
                orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }]
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
        endTimer('export_achievement_data', {
            definitions: exportData.definitions?.length || 0,
            achievements: exportData.userAchievements.length,
            progress: exportData.userProgress?.length || 0
        });
        return JSON.stringify(exportData, null, 2);
    }
    catch (error) {
        endTimer('export_achievement_data', { success: false, error: String(error) });
        throw error;
    }
}
// Import achievement definitions
export async function importAchievementDefinitions(definitionsData, options = {}) {
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
                            id: undefined,
                            createdAt: undefined,
                            updatedAt: new Date(),
                            version: { increment: 1 }
                        }
                    });
                }
                else {
                    await prisma.achievementDefinition.create({
                        data: {
                            ...definition,
                            id: undefined,
                            createdAt: undefined,
                            updatedAt: undefined
                        }
                    });
                }
            }
            imported++;
        }
        catch (error) {
            errors.push(`${definition.name}: ${error}`);
        }
    }
    if (!dryRun) {
        invalidateDefinitionCache();
    }
    return { success: true, imported, skipped, errors };
}
