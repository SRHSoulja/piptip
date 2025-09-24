// src/web/api/metrics.ts - Prometheus metrics endpoint with authentication
import express from 'express';
import { register } from '../../metrics/index.js';
import { createLogger } from '../../utils/logger.js';

const router = express.Router();
const logger = createLogger('metrics-api');

/**
 * Prometheus metrics endpoint
 * Protected by bearer token authentication
 */
router.get('/metrics', authenticateMetrics, async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.send(metrics);

    logger.info({
      userAgent: req.get('user-agent'),
      ip: req.ip,
    }, 'Metrics scraped');

  } catch (error) {
    logger.error({ error }, 'Failed to generate metrics');
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});

/**
 * Health check endpoint with basic metrics
 */
router.get('/health', async (req, res) => {
  try {
    const { getQueueHealth } = await import('../../queues/config.js');
    const queueHealth = await getQueueHealth();

    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      redis: queueHealth.redis,
      queues: queueHealth.queues,
      version: process.env.npm_package_version || 'unknown',
    };

    // Check if any queues are unhealthy
    const hasUnhealthyQueues = Object.values(queueHealth.queues).some(
      (queue: any) => !queue.healthy
    );

    if (!queueHealth.redis || hasUnhealthyQueues) {
      healthStatus.status = 'degraded';
      res.status(503);
    }

    res.json(healthStatus);

  } catch (error) {
    logger.error({ error }, 'Health check failed');
    res.status(503).json({
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Detailed system stats endpoint (admin only)
 */
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const { getQueueHealth } = await import('../../queues/config.js');
    const { getOutboxHealth } = await import('../../services/outbox/outbox_helpers.js');

    const [queueHealth, outboxHealth] = await Promise.all([
      getQueueHealth(),
      getOutboxHealth(),
    ]);

    // Get recent reconciliation results
    const recentReconciliations = await (await import('../../services/db.js')).prisma.reconciliationResult.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        type: true,
        status: true,
        driftsFound: true,
        correctionsMade: true,
        createdAt: true,
      }
    });

    // Get recent dead letter jobs
    const recentDLQJobs = await (await import('../../services/db.js')).prisma.deadLetterJob.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 86400000) // Last 24 hours
        }
      }
    });

    const stats = {
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        version: process.env.npm_package_version || 'unknown',
        nodeVersion: process.version,
      },
      queues: queueHealth,
      outbox: outboxHealth,
      reconciliation: {
        recentRuns: recentReconciliations,
        totalDriftsFound: recentReconciliations.reduce((sum, r) => sum + r.driftsFound, 0),
        totalCorrections: recentReconciliations.reduce((sum, r) => sum + r.correctionsMade, 0),
      },
      deadLetterQueue: {
        recentJobs24h: recentDLQJobs,
      },
      timestamp: new Date().toISOString(),
    };

    res.json(stats);

  } catch (error) {
    logger.error({ error }, 'Failed to generate stats');
    res.status(500).json({ error: 'Failed to generate system stats' });
  }
});

/**
 * Authentication middleware for metrics endpoint
 */
function authenticateMetrics(req: any, res: any, next: any): void {
  const metricsToken = process.env.METRICS_TOKEN;

  if (!metricsToken) {
    logger.warn('METRICS_TOKEN not configured - metrics endpoint disabled');
    return res.status(503).json({
      error: 'Metrics endpoint not configured'
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Bearer token required'
    });
  }

  const token = authHeader.substring(7);
  if (token !== metricsToken) {
    logger.warn({
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }, 'Unauthorized metrics access attempt');

    return res.status(403).json({
      error: 'Invalid credentials'
    });
  }

  next();
}

/**
 * Admin authentication middleware
 */
function authenticateAdmin(req: any, res: any, next: any): void {
  const adminToken = process.env.ADMIN_SECRET;

  if (!adminToken) {
    return res.status(503).json({
      error: 'Admin endpoint not configured'
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Bearer token required'
    });
  }

  const token = authHeader.substring(7);
  if (token !== adminToken) {
    logger.warn({
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }, 'Unauthorized admin access attempt');

    return res.status(403).json({
      error: 'Invalid credentials'
    });
  }

  next();
}

export default router;