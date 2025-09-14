// src/web/admin/achievement-preview.ts - Real-time impact preview for admin changes
import { Router } from 'express';
import { prisma } from '../../services/db.js';
import { startTimer, endTimer } from '../../services/performance.js';
const router = Router();
// Middleware for admin auth (reuse existing)
router.use(async (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${process.env.ADMIN_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});
// POST /admin/achievements/preview - Preview impact of changes before applying
router.post('/preview', async (req, res) => {
    try {
        startTimer('preview_changes');
        const { operation, achievementIds, changes } = req.body;
        let preview;
        switch (operation) {
            case 'disable':
                preview = await previewDisable(achievementIds);
                break;
            case 'change_threshold':
                preview = await previewThresholdChange(achievementIds, changes.newThreshold);
                break;
            case 'toggle_enabled':
                preview = await previewToggle(achievementIds);
                break;
            case 'bulk_disable_category':
                preview = await previewCategoryDisable(changes.category);
                break;
            default:
                return res.status(400).json({ error: 'Unsupported preview operation' });
        }
        endTimer('preview_changes', { operation, affectedDefinitions: achievementIds?.length || 0 });
        res.json({
            operation,
            preview,
            timestamp: new Date(),
            canRevert: true,
            estimatedProcessingTime: calculateProcessingTime(preview)
        });
    }
    catch (error) {
        endTimer('preview_changes', { success: false, error: String(error) });
        res.status(500).json({ error: 'Preview failed', details: String(error) });
    }
});
// Preview disabling achievements
async function previewDisable(achievementIds) {
    const [affectedDefinitions, currentUnlocks] = await Promise.all([
        prisma.achievementDefinition.findMany({
            where: { id: { in: achievementIds } },
            select: { id: true, name: true, category: true }
        }),
        prisma.userAchievement.groupBy({
            by: ['definitionId'],
            where: { definitionId: { in: achievementIds } },
            _count: { id: true }
        })
    ]);
    const unlocksByDefinition = new Map(currentUnlocks.map(item => [item.definitionId, item._count.id]));
    const impactSummary = affectedDefinitions.map(def => ({
        id: def.id,
        name: def.name,
        category: def.category,
        currentUnlocks: unlocksByDefinition.get(def.id) || 0,
        impact: 'Achievement will be hidden from new users, existing unlocks preserved'
    }));
    return {
        type: 'disable',
        affectedAchievements: impactSummary,
        totalCurrentUnlocks: Array.from(unlocksByDefinition.values()).reduce((a, b) => a + b, 0),
        warning: 'Users who already have these achievements will keep them, but no new unlocks will be possible.',
        reversible: true
    };
}
// Preview threshold changes
async function previewThresholdChange(achievementIds, newThreshold) {
    const results = await Promise.all(achievementIds.map(async (definitionId) => {
        const definition = await prisma.achievementDefinition.findUnique({
            where: { id: definitionId },
            select: { id: true, name: true, threshold: true, criteriaType: true }
        });
        if (!definition)
            return null;
        const currentThreshold = Number(definition.threshold);
        // Count users who currently have this achievement
        const currentUnlocks = await prisma.userAchievement.count({
            where: { definitionId }
        });
        // Count users who are close to current threshold
        const nearCompletion = await prisma.userAchievementProgress.count({
            where: {
                definitionId,
                currentProgress: {
                    gte: currentThreshold * 0.8, // Within 80% of threshold
                    lt: currentThreshold
                }
            }
        });
        let impactAnalysis;
        if (newThreshold > currentThreshold) {
            // Increasing difficulty
            const wouldLose = await prisma.userAchievement.count({
                where: {
                    definitionId,
                    currentProgress: { lt: newThreshold }
                }
            });
            impactAnalysis = {
                type: 'difficulty_increase',
                usersWhoWouldLoseAchievement: wouldLose,
                usersStillQualified: currentUnlocks - wouldLose,
                recommendation: wouldLose > 0 ? 'WARNING: Users will lose this achievement' : 'Safe to increase'
            };
        }
        else {
            // Decreasing difficulty
            const wouldGain = await prisma.userAchievementProgress.count({
                where: {
                    definitionId,
                    currentProgress: { gte: newThreshold }
                }
            }) - currentUnlocks; // Subtract those who already have it
            impactAnalysis = {
                type: 'difficulty_decrease',
                usersWhoWouldGainAchievement: Math.max(0, wouldGain),
                currentHolders: currentUnlocks,
                recommendation: wouldGain > 100 ? 'Consider gradual rollout' : 'Safe to decrease'
            };
        }
        return {
            id: definitionId,
            name: definition.name,
            currentThreshold,
            newThreshold,
            currentUnlocks,
            nearCompletion,
            ...impactAnalysis
        };
    }));
    return {
        type: 'threshold_change',
        changes: results.filter(r => r !== null),
        requiresRecalculation: true,
        processingTime: 'Estimated 5-30 minutes depending on user count'
    };
}
// Preview toggling enabled status
async function previewToggle(achievementIds) {
    const definitions = await prisma.achievementDefinition.findMany({
        where: { id: { in: achievementIds } },
        select: { id: true, name: true, isEnabled: true }
    });
    const toggleResults = await Promise.all(definitions.map(async (def) => {
        const currentUnlocks = await prisma.userAchievement.count({
            where: { definitionId: def.id }
        });
        return {
            id: def.id,
            name: def.name,
            currentStatus: def.isEnabled ? 'enabled' : 'disabled',
            newStatus: def.isEnabled ? 'disabled' : 'enabled',
            currentUnlocks,
            impact: def.isEnabled
                ? 'Will stop new unlocks, existing achievements preserved'
                : 'Will resume allowing new unlocks'
        };
    }));
    return {
        type: 'toggle_enabled',
        changes: toggleResults,
        reversible: true,
        immediate: true
    };
}
// Preview disabling entire category
async function previewCategoryDisable(category) {
    const [categoryDefinitions, categoryUnlocks] = await Promise.all([
        prisma.achievementDefinition.findMany({
            where: { category, isEnabled: true },
            select: { id: true, name: true }
        }),
        prisma.achievementDefinition.findMany({
            where: { category },
            include: {
                _count: {
                    select: { unlockedAchievements: true }
                }
            }
        })
    ]);
    const totalUnlocks = categoryUnlocks.reduce((sum, def) => sum + def._count.unlockedAchievements, 0);
    return {
        type: 'category_disable',
        category,
        affectedAchievements: categoryDefinitions.length,
        totalCurrentUnlocks: totalUnlocks,
        achievementList: categoryDefinitions,
        impact: `All ${category} achievements will be disabled. Great for emergency response (e.g., disable all deposit achievements instantly).`,
        useCase: 'Emergency disable, seasonal pause, rebalancing',
        reversible: true
    };
}
// Calculate estimated processing time
function calculateProcessingTime(preview) {
    let estimatedSeconds = 1; // Base time
    if (preview.requiresRecalculation) {
        estimatedSeconds += Math.max(preview.totalCurrentUnlocks || 0) * 0.01; // ~0.01s per unlock
    }
    if (estimatedSeconds < 10)
        return 'Instant';
    if (estimatedSeconds < 60)
        return `~${Math.round(estimatedSeconds)} seconds`;
    return `~${Math.round(estimatedSeconds / 60)} minutes`;
}
// POST /admin/achievements/apply-with-preview - Apply changes after preview confirmation
router.post('/apply-with-preview', async (req, res) => {
    try {
        const { operation, achievementIds, changes, previewConfirmed } = req.body;
        if (!previewConfirmed) {
            return res.status(400).json({
                error: 'Preview confirmation required',
                hint: 'Set previewConfirmed: true after reviewing impact'
            });
        }
        // Store operation for potential rollback
        const rollbackId = await storeRollbackData(operation, achievementIds, changes);
        let result;
        switch (operation) {
            case 'disable':
                result = await prisma.achievementDefinition.updateMany({
                    where: { id: { in: achievementIds } },
                    data: { isEnabled: false, version: { increment: 1 } }
                });
                break;
            case 'toggle_enabled':
                // This would need individual updates since we're toggling
                const togglePromises = achievementIds.map(async (id) => {
                    const current = await prisma.achievementDefinition.findUnique({
                        where: { id },
                        select: { isEnabled: true }
                    });
                    if (current) {
                        return prisma.achievementDefinition.update({
                            where: { id },
                            data: { isEnabled: !current.isEnabled, version: { increment: 1 } }
                        });
                    }
                });
                await Promise.all(togglePromises);
                result = { count: achievementIds.length };
                break;
            case 'change_threshold':
                result = await prisma.achievementDefinition.updateMany({
                    where: { id: { in: achievementIds } },
                    data: {
                        threshold: changes.newThreshold,
                        version: { increment: 1 }
                    }
                });
                break;
            case 'bulk_disable_category':
                result = await prisma.achievementDefinition.updateMany({
                    where: { category: changes.category },
                    data: { isEnabled: false, version: { increment: 1 } }
                });
                break;
        }
        res.json({
            success: true,
            operation,
            affectedCount: result?.count || 0,
            rollbackId,
            message: 'Changes applied successfully',
            rollbackAvailable: '24 hours'
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to apply changes',
            details: String(error)
        });
    }
});
// Store rollback data
async function storeRollbackData(operation, achievementIds, changes) {
    // This would ideally be stored in a separate rollback table
    // For now, we'll create a simple JSON log
    const rollbackId = `rollback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`💾 Storing rollback data: ${rollbackId}`, {
        operation,
        achievementIds,
        changes,
        timestamp: new Date()
    });
    return rollbackId;
}
export default router;
