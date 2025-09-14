// src/web/admin/quick-wins.ts - Immediate value admin endpoints

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../services/db.js';
import { invalidateDefinitionCache } from '../../services/dynamic_achievements.js';

const router = Router();

// Strict rate limiting for emergency operations
const emergencyRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Very restrictive for emergency operations
  message: {
    error: 'Too many emergency operations from this IP',
    retryAfter: '5 minutes'
  }
});

// Admin auth middleware
router.use(async (req: any, res: any, next: any) => {
  if (req.headers.authorization !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Apply strict rate limiting to emergency endpoints
router.use('/emergency', emergencyRateLimit);

// QUICK WIN #1: Emergency disable/enable without redeploy
router.post('/emergency/:action', async (req, res) => {
  try {
    const { action } = req.params; // 'disable-all' or 'enable-all'
    const { category, reason } = req.body;

    let affected = 0;

    switch (action) {
      case 'disable-all':
        const result = await prisma.achievementDefinition.updateMany({
          where: category ? { category, isEnabled: true } : { isEnabled: true },
          data: {
            isEnabled: false,
            version: { increment: 1 }
          }
        });
        affected = result.count;
        break;

      case 'enable-all':
        const enableResult = await prisma.achievementDefinition.updateMany({
          where: category ? { category, isEnabled: false } : { isEnabled: false },
          data: {
            isEnabled: true,
            version: { increment: 1 }
          }
        });
        affected = enableResult.count;
        break;

      default:
        return res.status(400).json({ error: 'Invalid action. Use disable-all or enable-all' });
    }

    invalidateDefinitionCache();

    console.log(`🚨 EMERGENCY ${action.toUpperCase()}: ${affected} achievements affected${category ? ` (category: ${category})` : ''} - Reason: ${reason || 'Not specified'}`);

    res.json({
      success: true,
      action,
      affected,
      category: category || 'all',
      reason,
      message: `Emergency ${action} completed - ${affected} achievements affected`,
      timestamp: new Date()
    });

  } catch (error) {
    console.error(`Emergency ${req.params.action} failed:`, error);
    res.status(500).json({
      error: 'Emergency action failed',
      details: String(error)
    });
  }
});

// QUICK WIN #2: Bulk threshold adjustment
router.post('/bulk-threshold', async (req, res) => {
  try {
    const { achievementIds, multiplier, newThreshold } = req.body;

    if (!achievementIds || !Array.isArray(achievementIds)) {
      return res.status(400).json({ error: 'achievementIds array required' });
    }

    let updateData: any = { version: { increment: 1 } };

    if (newThreshold !== undefined) {
      updateData.threshold = Number(newThreshold);
    } else if (multiplier !== undefined) {
      // Get current thresholds and multiply
      const definitions = await prisma.achievementDefinition.findMany({
        where: { id: { in: achievementIds } },
        select: { id: true, threshold: true }
      });

      // Individual updates needed for multiplier
      const updates = definitions.map(def =>
        prisma.achievementDefinition.update({
          where: { id: def.id },
          data: {
            threshold: Number(def.threshold) * Number(multiplier),
            version: { increment: 1 }
          }
        })
      );

      await Promise.all(updates);

      invalidateDefinitionCache();

      return res.json({
        success: true,
        operation: 'bulk-threshold-multiply',
        affected: definitions.length,
        multiplier,
        message: `Applied ${multiplier}x multiplier to ${definitions.length} achievements`
      });
    } else {
      return res.status(400).json({ error: 'Either multiplier or newThreshold required' });
    }

    // Simple threshold update
    const result = await prisma.achievementDefinition.updateMany({
      where: { id: { in: achievementIds } },
      data: updateData
    });

    invalidateDefinitionCache();

    res.json({
      success: true,
      operation: 'bulk-threshold-set',
      affected: result.count,
      newThreshold,
      message: `Set threshold to ${newThreshold} for ${result.count} achievements`
    });

  } catch (error) {
    res.status(500).json({
      error: 'Bulk threshold update failed',
      details: String(error)
    });
  }
});

// QUICK WIN #3: Instant achievement statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const [
      totalDefinitions,
      enabledDefinitions,
      totalUnlocks,
      totalProgress,
      categoryBreakdown,
      rarityBreakdown,
      recentActivity
    ] = await Promise.all([
      prisma.achievementDefinition.count(),
      prisma.achievementDefinition.count({ where: { isEnabled: true } }),
      prisma.userAchievement.count(),
      prisma.userAchievementProgress.count(),

      prisma.achievementDefinition.groupBy({
        by: ['category'],
        _count: { id: true },
        where: { isEnabled: true }
      }),

      prisma.achievementDefinition.groupBy({
        by: ['rarity'],
        _count: { id: true },
        where: { isEnabled: true }
      }),

      prisma.userAchievement.count({
        where: {
          unlockedAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      })
    ]);

    // Calculate completion rates
    const completionRates = await Promise.all(
      (await prisma.achievementDefinition.findMany({
        where: { isEnabled: true },
        select: { id: true, name: true }
      })).map(async (def) => {
        const [unlocks, progress] = await Promise.all([
          prisma.userAchievement.count({ where: { definitionId: def.id } }),
          prisma.userAchievementProgress.count({ where: { definitionId: def.id } })
        ]);

        return {
          id: def.id,
          name: def.name,
          unlocks,
          progress,
          completionRate: progress > 0 ? ((unlocks / progress) * 100).toFixed(1) : '0'
        };
      })
    );

    // Sort by completion rate to find easy/hard achievements
    completionRates.sort((a, b) => parseFloat(b.completionRate) - parseFloat(a.completionRate));

    res.json({
      overview: {
        totalDefinitions,
        enabledDefinitions,
        totalUnlocks,
        totalProgress,
        avgUnlocksPerUser: totalProgress > 0 ? (totalUnlocks / totalProgress).toFixed(1) : '0',
        recentActivity: recentActivity
      },
      breakdown: {
        byCategory: categoryBreakdown,
        byRarity: rarityBreakdown
      },
      completionAnalysis: {
        easiest: completionRates.slice(0, 5),
        hardest: completionRates.slice(-5).reverse(),
        averageCompletionRate: completionRates.length > 0
          ? (completionRates.reduce((sum, item) => sum + parseFloat(item.completionRate), 0) / completionRates.length).toFixed(1)
          : '0'
      },
      generatedAt: new Date()
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to generate statistics',
      details: String(error)
    });
  }
});

// QUICK WIN #4: Category management
router.get('/categories', async (req, res) => {
  try {
    const categories = await prisma.achievementDefinition.groupBy({
      by: ['category'],
      _count: { id: true },
      _avg: { threshold: true },
      where: { isEnabled: true }
    });

    const categoryDetails = await Promise.all(
      categories.map(async (cat) => {
        const [unlocks, easiest, hardest] = await Promise.all([
          prisma.userAchievement.count({
            where: {
              definition: { category: cat.category }
            }
          }),

          prisma.achievementDefinition.findFirst({
            where: { category: cat.category, isEnabled: true },
            orderBy: { threshold: 'asc' },
            select: { name: true, threshold: true }
          }),

          prisma.achievementDefinition.findFirst({
            where: { category: cat.category, isEnabled: true },
            orderBy: { threshold: 'desc' },
            select: { name: true, threshold: true }
          })
        ]);

        return {
          category: cat.category,
          definitionsCount: cat._count.id,
          averageThreshold: cat._avg.threshold ? Number(cat._avg.threshold).toFixed(1) : '0',
          totalUnlocks: unlocks,
          easiestAchievement: easiest,
          hardestAchievement: hardest
        };
      })
    );

    res.json({
      categories: categoryDetails,
      totalCategories: categories.length,
      generatedAt: new Date()
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch categories',
      details: String(error)
    });
  }
});

// QUICK WIN #5: User achievement lookup (for support)
router.get('/user-lookup/:discordId', async (req, res) => {
  try {
    const { discordId } = req.params;

    const user = await prisma.user.findUnique({
      where: { discordId },
      include: {
        unlockedAchievements: {
          include: {
            definition: {
              select: { name: true, category: true, rarity: true, threshold: true }
            }
          },
          orderBy: { unlockedAt: 'desc' }
        },
        achievementProgress: {
          include: {
            definition: {
              select: { name: true, category: true, threshold: true }
            }
          },
          where: {
            currentProgress: { gt: 0 }
          },
          orderBy: { lastProgressAt: 'desc' }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate progress percentages
    const progressWithPercentages = user.achievementProgress.map(p => ({
      id: p.id,
      achievementName: p.definition.name,
      category: p.definition.category,
      currentProgress: Number(p.currentProgress),
      threshold: Number(p.definition.threshold),
      progressPercent: ((Number(p.currentProgress) / Number(p.definition.threshold)) * 100).toFixed(1),
      lastProgressAt: p.lastProgressAt
    }));

    res.json({
      user: {
        discordId: user.discordId,
        joinedAt: user.createdAt,
        totalUnlocked: user.unlockedAchievements.length,
        activeProgress: user.achievementProgress.length
      },
      unlockedAchievements: user.unlockedAchievements.map(ua => ({
        name: ua.definition.name,
        category: ua.definition.category,
        rarity: ua.definition.rarity,
        unlockedAt: ua.unlockedAt,
        progress: `${ua.currentProgress}/${ua.targetProgress}`,
        unlockCount: ua.unlockCount
      })),
      activeProgress: progressWithPercentages,
      nearCompletion: progressWithPercentages.filter(p => parseFloat(p.progressPercent) >= 80),
      generatedAt: new Date()
    });

  } catch (error) {
    res.status(500).json({
      error: 'User lookup failed',
      details: String(error)
    });
  }
});

export default router;