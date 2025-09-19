// src/web/admin/achievements.ts - Achievement management REST API

import { Router } from 'express';
import { prisma } from '../../services/db.js';
import { invalidateDefinitionCache, getAchievementDefinitions, processAchievementEvent, batchProcessAchievements } from '../../services/dynamic_achievements.js';
import { startTimer, endTimer } from '../../services/performance.js';
import { validateAchievementData, validateBulkOperation, validateManualOperation } from '../../services/input_validation.js';
import { viewOnlyAdminMiddleware, basicAdminMiddleware } from '../../services/admin_auth.js';

const router = Router();

// View operations use simple auth (compatible with Replit)
// Modification operations use basic auth with rate limiting

// GET /admin/achievements - List all achievement definitions
router.get('/', viewOnlyAdminMiddleware(), async (req, res) => {
  try {
    startTimer('admin_list_achievements');

    const { category, enabled, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (category) where.category = category;
    if (enabled !== undefined) where.isEnabled = enabled === 'true';

    const [definitions, total] = await Promise.all([
      prisma.achievementDefinition.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
        include: {
          _count: {
            select: {
              unlockedAchievements: true,
              progressTracking: true
            }
          }
        }
      }),
      prisma.achievementDefinition.count({ where })
    ]);

    // Add completion statistics
    const enrichedDefinitions = await Promise.all(
      definitions.map(async (def) => {
        const stats = await prisma.userAchievement.aggregate({
          where: { definitionId: def.id },
          _avg: { currentProgress: true },
          _max: { currentProgress: true }
        });

        const totalUsers = await prisma.user.count();
        const completionRate = totalUsers > 0
          ? (def._count.unlockedAchievements / totalUsers * 100).toFixed(1)
          : '0.0';

        return {
          ...def,
          stats: {
            totalUnlocked: def._count.unlockedAchievements,
            totalTracking: def._count.progressTracking,
            completionRate: `${completionRate}%`,
            avgProgress: stats._avg.currentProgress ? Number(stats._avg.currentProgress).toFixed(1) : '0',
            maxProgress: stats._max.currentProgress ? Number(stats._max.currentProgress) : 0
          },
          _count: undefined
        };
      })
    );

    endTimer('admin_list_achievements', { total, page, limit });

    res.json({
      definitions: enrichedDefinitions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });

  } catch (error) {
    endTimer('admin_list_achievements', { success: false, error: String(error) });
    res.status(500).json({ error: 'Failed to fetch achievements', details: String(error) });
  }
});

// GET /admin/achievements/:id - Get specific achievement definition
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    const definition = await prisma.achievementDefinition.findUnique({
      where: { id },
      include: {
        unlockedAchievements: {
          take: 10,
          orderBy: { unlockedAt: 'desc' },
          include: {
            user: {
              select: { discordId: true }
            }
          }
        },
        progressTracking: {
          take: 10,
          orderBy: { lastProgressAt: 'desc' },
          include: {
            user: {
              select: { discordId: true }
            }
          }
        }
      }
    });

    if (!definition) {
      return res.status(404).json({ error: 'Achievement not found' });
    }

    // Add analytics
    const analytics = await getAchievementAnalytics(id);

    res.json({
      ...definition,
      analytics
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch achievement', details: String(error) });
  }
});

// POST /admin/achievements - Create new achievement definition
router.post('/', basicAdminMiddleware(), async (req, res) => {
  try {
    startTimer('admin_create_achievement');

    // Comprehensive input validation
    const validation = validateAchievementData(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors
      });
    }

    const {
      name,
      description,
      category,
      criteriaType,
      criteriaData,
      threshold,
      iconEmoji,
      badgeColor = '#FFD700',
      rarity = 'common',
      isEnabled = true,
      isVisible = true,
      isRepeatable = false,
      cooldownHours,
      startDate,
      endDate,
      sortOrder = 0,
      tier = 1
    } = req.body;

    // Validation
    if (!name || !description || !category || !criteriaType || !threshold) {
      return res.status(400).json({
        error: 'Missing required fields: name, description, category, criteriaType, threshold'
      });
    }

    const validCriteriaTypes = ['count', 'sum', 'streak', 'unique', 'custom'];
    if (!validCriteriaTypes.includes(criteriaType)) {
      return res.status(400).json({
        error: `Invalid criteriaType. Must be one of: ${validCriteriaTypes.join(', ')}`
      });
    }

    const definition = await prisma.achievementDefinition.create({
      data: {
        name,
        description,
        category,
        criteriaType,
        criteriaData,
        threshold: Number(threshold),
        iconEmoji: iconEmoji || '🏆',
        badgeColor,
        rarity,
        isEnabled,
        isVisible,
        isRepeatable,
        cooldownHours: cooldownHours ? Number(cooldownHours) : null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        sortOrder: Number(sortOrder),
        tier: Number(tier),
        createdBy: 'admin' // Could be extracted from JWT in production
      }
    });

    // Invalidate cache
    invalidateDefinitionCache();

    endTimer('admin_create_achievement', { definitionId: definition.id });

    res.status(201).json(definition);

  } catch (error) {
    endTimer('admin_create_achievement', { success: false, error: String(error) });

    // Handle unique constraint violations
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return res.status(409).json({ error: 'Achievement with this name already exists' });
    }

    res.status(500).json({ error: 'Failed to create achievement', details: String(error) });
  }
});

// PUT /admin/achievements/:id - Update achievement definition
router.put('/:id', async (req, res) => {
  try {
    startTimer('admin_update_achievement');

    const id = Number(req.params.id);
    const updateData = { ...req.body };

    // Remove fields that shouldn't be updated directly
    delete updateData.id;
    delete updateData.createdAt;
    delete updateData.createdBy;

    // Convert numeric fields
    if (updateData.threshold) updateData.threshold = Number(updateData.threshold);
    if (updateData.cooldownHours) updateData.cooldownHours = Number(updateData.cooldownHours);
    if (updateData.sortOrder) updateData.sortOrder = Number(updateData.sortOrder);
    if (updateData.tier) updateData.tier = Number(updateData.tier);

    // Convert date fields
    if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
    if (updateData.endDate) updateData.endDate = new Date(updateData.endDate);

    // Increment version for tracking
    updateData.version = { increment: 1 };
    updateData.updatedAt = new Date();

    const definition = await prisma.achievementDefinition.update({
      where: { id },
      data: updateData
    });

    // Invalidate cache
    invalidateDefinitionCache();

    endTimer('admin_update_achievement', { definitionId: id });

    res.json(definition);

  } catch (error) {
    endTimer('admin_update_achievement', { success: false, error: String(error) });

    if (error instanceof Error && error.message.includes('Record to update not found')) {
      return res.status(404).json({ error: 'Achievement not found' });
    }

    res.status(500).json({ error: 'Failed to update achievement', details: String(error) });
  }
});

// DELETE /admin/achievements/:id - Delete achievement definition
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    // Check if achievement has unlocks (prevent accidental deletion)
    const unlockCount = await prisma.userAchievement.count({
      where: { definitionId: id }
    });

    if (unlockCount > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        error: `Achievement has ${unlockCount} unlocks. Use ?force=true to delete anyway.`,
        unlockCount
      });
    }

    await prisma.achievementDefinition.delete({
      where: { id }
    });

    // Invalidate cache
    invalidateDefinitionCache();

    res.json({ message: 'Achievement deleted successfully', id });

  } catch (error) {
    if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
      return res.status(404).json({ error: 'Achievement not found' });
    }

    res.status(500).json({ error: 'Failed to delete achievement', details: String(error) });
  }
});

// POST /admin/achievements/:id/toggle - Quick enable/disable toggle
router.post('/:id/toggle', async (req, res) => {
  try {
    const id = Number(req.params.id);

    const current = await prisma.achievementDefinition.findUnique({
      where: { id },
      select: { isEnabled: true }
    });

    if (!current) {
      return res.status(404).json({ error: 'Achievement not found' });
    }

    const updated = await prisma.achievementDefinition.update({
      where: { id },
      data: {
        isEnabled: !current.isEnabled,
        version: { increment: 1 }
      }
    });

    invalidateDefinitionCache();

    res.json({
      id,
      isEnabled: updated.isEnabled,
      message: `Achievement ${updated.isEnabled ? 'enabled' : 'disabled'}`
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle achievement', details: String(error) });
  }
});

// POST /admin/achievements/bulk-operation - Bulk operations
router.post('/bulk-operation', async (req, res) => {
  try {
    startTimer('admin_bulk_operation');

    // Comprehensive input validation
    const validation = validateBulkOperation(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors
      });
    }

    const { operation, achievementIds, data = {} } = req.body;

    if (!operation || !achievementIds || !Array.isArray(achievementIds)) {
      return res.status(400).json({
        error: 'Missing required fields: operation, achievementIds (array)'
      });
    }

    let result;

    switch (operation) {
      case 'enable':
        result = await prisma.achievementDefinition.updateMany({
          where: { id: { in: achievementIds } },
          data: { isEnabled: true, version: { increment: 1 } }
        });
        break;

      case 'disable':
        result = await prisma.achievementDefinition.updateMany({
          where: { id: { in: achievementIds } },
          data: { isEnabled: false, version: { increment: 1 } }
        });
        break;

      case 'update-category':
        if (!data.category) {
          return res.status(400).json({ error: 'Category required for update-category operation' });
        }
        result = await prisma.achievementDefinition.updateMany({
          where: { id: { in: achievementIds } },
          data: { category: data.category, version: { increment: 1 } }
        });
        break;

      case 'update-tier':
        if (data.tier === undefined) {
          return res.status(400).json({ error: 'Tier required for update-tier operation' });
        }
        result = await prisma.achievementDefinition.updateMany({
          where: { id: { in: achievementIds } },
          data: { tier: Number(data.tier), version: { increment: 1 } }
        });
        break;

      default:
        return res.status(400).json({
          error: 'Invalid operation. Supported: enable, disable, update-category, update-tier'
        });
    }

    invalidateDefinitionCache();

    endTimer('admin_bulk_operation', {
      operation,
      affectedCount: result.count
    });

    res.json({
      operation,
      affectedCount: result.count,
      message: `Bulk ${operation} completed successfully`
    });

  } catch (error) {
    endTimer('admin_bulk_operation', { success: false, error: String(error) });
    res.status(500).json({ error: 'Bulk operation failed', details: String(error) });
  }
});

// GET /admin/achievements/analytics/overview - System-wide analytics
router.get('/analytics/overview', async (req, res) => {
  try {
    startTimer('admin_analytics_overview');

    const [
      totalDefinitions,
      activeDefinitions,
      totalUnlocks,
      totalUsers,
      categoryStats,
      recentUnlocks,
      topAchievements
    ] = await Promise.all([
      prisma.achievementDefinition.count(),
      prisma.achievementDefinition.count({ where: { isEnabled: true } }),
      prisma.userAchievement.count(),
      prisma.user.count(),

      // Category breakdown
      prisma.achievementDefinition.groupBy({
        by: ['category'],
        _count: { id: true },
        where: { isEnabled: true }
      }),

      // Recent unlocks
      prisma.userAchievement.findMany({
        take: 10,
        orderBy: { unlockedAt: 'desc' },
        include: {
          user: { select: { discordId: true } },
          definition: { select: { name: true, iconEmoji: true } }
        }
      }),

      // Most unlocked achievements
      prisma.userAchievement.groupBy({
        by: ['definitionId'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10
      })
    ]);

    const topAchievementsWithNames = await Promise.all(
      topAchievements.map(async (item) => {
        const definition = await prisma.achievementDefinition.findUnique({
          where: { id: item.definitionId },
          select: { name: true, iconEmoji: true }
        });
        return {
          ...item,
          definition
        };
      })
    );

    endTimer('admin_analytics_overview');

    res.json({
      overview: {
        totalDefinitions,
        activeDefinitions,
        totalUnlocks,
        totalUsers,
        avgUnlocksPerUser: totalUsers > 0 ? (totalUnlocks / totalUsers).toFixed(1) : '0'
      },
      categoryStats,
      recentUnlocks,
      topAchievements: topAchievementsWithNames
    });

  } catch (error) {
    endTimer('admin_analytics_overview', { success: false, error: String(error) });
    res.status(500).json({ error: 'Failed to fetch analytics', details: String(error) });
  }
});

// Helper function for detailed achievement analytics
async function getAchievementAnalytics(definitionId: number) {
  const [unlockStats, progressStats, timeToUnlock] = await Promise.all([
    // Basic unlock statistics
    prisma.userAchievement.aggregate({
      where: { definitionId },
      _count: { id: true },
      _min: { unlockedAt: true },
      _max: { unlockedAt: true }
    }),

    // Progress distribution
    prisma.userAchievementProgress.aggregate({
      where: { definitionId },
      _avg: { currentProgress: true },
      _min: { currentProgress: true },
      _max: { currentProgress: true },
      _count: { id: true }
    }),

    // Time to unlock distribution
    prisma.$queryRaw`
      SELECT
        AVG(EXTRACT(EPOCH FROM (ua.unlocked_at - u.created_at)) / 3600) as avg_hours_to_unlock,
        MIN(EXTRACT(EPOCH FROM (ua.unlocked_at - u.created_at)) / 3600) as min_hours_to_unlock,
        MAX(EXTRACT(EPOCH FROM (ua.unlocked_at - u.created_at)) / 3600) as max_hours_to_unlock
      FROM user_achievement ua
      JOIN "User" u ON ua.user_id = u.id
      WHERE ua.definition_id = ${definitionId}
    `
  ]);

  return {
    unlockStats: {
      totalUnlocked: unlockStats._count.id,
      firstUnlock: unlockStats._min.unlockedAt,
      lastUnlock: unlockStats._max.unlockedAt
    },
    progressStats: {
      totalTracking: progressStats._count.id,
      avgProgress: progressStats._avg.currentProgress ? Number(progressStats._avg.currentProgress).toFixed(1) : '0',
      minProgress: progressStats._min.currentProgress || 0,
      maxProgress: progressStats._max.currentProgress || 0
    },
    timeToUnlock: Array.isArray(timeToUnlock) && timeToUnlock.length > 0 ? {
      avgHours: timeToUnlock[0].avg_hours_to_unlock ? Number(timeToUnlock[0].avg_hours_to_unlock).toFixed(1) : null,
      minHours: timeToUnlock[0].min_hours_to_unlock ? Number(timeToUnlock[0].min_hours_to_unlock).toFixed(1) : null,
      maxHours: timeToUnlock[0].max_hours_to_unlock ? Number(timeToUnlock[0].max_hours_to_unlock).toFixed(1) : null
    } : null
  };
}

export default router;