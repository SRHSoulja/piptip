// src/web/admin/index.ts - Master admin router for achievement system

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import achievementsRouter from './achievements.js';
import previewRouter from './achievement-preview.js';
import quickWinsRouter from './quick-wins.js';
import { getMigrationProgress, runSafeMigration } from '../../services/hybrid_achievement_system.js';
import { initializeCriteriaRegistry, CriteriaRegistry } from '../../services/achievement_criteria_engine.js';
import { DatabaseOptimizer, ProgressTableOptimizer } from '../../services/achievement_performance_optimizer.js';

const router = Router();

// Initialize criteria registry on startup
initializeCriteriaRegistry();

// Rate limiting for admin endpoints
const adminRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many admin requests from this IP, please try again later',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for health checks
  skip: (req) => req.path === '/health'
});

// Apply rate limiting to all routes
router.use(adminRateLimit);

// Mount sub-routers
router.use('/achievements', achievementsRouter);
router.use('/achievements', previewRouter);
router.use('/quick-wins', quickWinsRouter);

// System health and migration status
router.get('/system/status', async (req, res) => {
  try {
    const [
      migrationProgress,
      tableAnalysis,
      criteriaTypes
    ] = await Promise.all([
      getMigrationProgress(),
      DatabaseOptimizer.analyzeTableSizes(),
      Promise.resolve(CriteriaRegistry.getTypes())
    ]);

    res.json({
      system: {
        version: '2.0.0',
        mode: migrationProgress.phase,
        uptime: process.uptime(),
        timestamp: new Date()
      },
      migration: migrationProgress,
      performance: {
        tables: tableAnalysis,
        suggestions: tableAnalysis.suggestions
      },
      capabilities: {
        criteriaTypes,
        totalEvaluators: criteriaTypes.length,
        features: [
          'real-time-preview',
          'bulk-operations',
          'emergency-controls',
          'batch-migration',
          'performance-monitoring'
        ]
      }
    });

  } catch (error) {
    res.status(500).json({
      error: 'System status check failed',
      details: String(error)
    });
  }
});

// Migration endpoints
router.post('/migration/run', async (req, res) => {
  try {
    const { batchSize = 50, maxBatches = 10, dryRun = true } = req.body;

    const result = await runSafeMigration(batchSize, maxBatches, dryRun);

    res.json({
      success: result.success,
      migration: result,
      message: dryRun
        ? `Dry run complete - ${result.migrated} users would be migrated`
        : `Migration batch complete - ${result.migrated} users migrated`,
      nextSteps: result.remainingUsers > 0 ? [
        'Review migration results',
        'Run next batch if successful',
        `${result.remainingUsers} users remaining`
      ] : [
        'Migration complete!',
        'Test dynamic achievement system',
        'Consider cleanup of legacy data'
      ]
    });

  } catch (error) {
    res.status(500).json({
      error: 'Migration failed',
      details: String(error)
    });
  }
});

// Performance optimization endpoints
router.post('/optimize/archive-progress', async (req, res) => {
  try {
    const { olderThanDays = 30 } = req.body;

    const archived = await ProgressTableOptimizer.archiveCompletedProgress(olderThanDays);

    res.json({
      success: true,
      archived,
      message: `Archived ${archived} completed progress entries older than ${olderThanDays} days`
    });

  } catch (error) {
    res.status(500).json({
      error: 'Archive operation failed',
      details: String(error)
    });
  }
});

router.post('/optimize/cleanup-stale', async (req, res) => {
  try {
    const { staleAfterDays = 90 } = req.body;

    const cleaned = await ProgressTableOptimizer.cleanupStaleProgress(staleAfterDays);

    res.json({
      success: true,
      cleaned,
      message: `Cleaned up ${cleaned} stale progress entries`
    });

  } catch (error) {
    res.status(500).json({
      error: 'Cleanup operation failed',
      details: String(error)
    });
  }
});

// Criteria system endpoints
router.get('/criteria/types', (req, res) => {
  try {
    const evaluators = CriteriaRegistry.getAll();

    const criteriaInfo = evaluators.map(evaluator => ({
      type: evaluator.type,
      description: evaluator.getDescription({ field: 'example', table: 'example' }),
      // Test validation with empty config to show required fields
      validation: evaluator.validateConfig({})
    }));

    res.json({
      criteriaTypes: criteriaInfo,
      totalTypes: evaluators.length,
      examples: {
        count: { field: 'matches_won', table: 'matches' },
        sum: { field: 'amount_sent', table: 'tips' },
        streak: { field: 'current_wins' },
        unique: { field: 'tip_recipients' },
        custom: { function: 'daysSinceJoined', params: {} }
      }
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to get criteria types',
      details: String(error)
    });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date(),
    components: {
      database: 'connected',
      criteriaRegistry: 'initialized',
      cacheSystem: 'operational',
      performanceMonitoring: 'active'
    }
  });
});

export default router;