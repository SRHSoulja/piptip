// src/middleware/metrics.ts - Express middleware for automatic metrics collection
import { Request, Response, NextFunction } from 'express';
import { metrics, recordError } from '../metrics/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('metrics-middleware');

/**
 * Middleware to collect HTTP request metrics
 */
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const route = req.route?.path || req.path;

  // Track request start
  metrics.requestRate.observe(
    { endpoint: route, method: req.method },
    1
  );

  // Capture response metrics when request completes
  res.on('finish', () => {
    const duration = (Date.now() - startTime) / 1000;

    try {
      // Record response time by status code class
      const statusClass = Math.floor(res.statusCode / 100);

      // Update request rate summary
      metrics.requestRate.observe(
        { endpoint: route, method: req.method },
        duration
      );

      // Log slow requests
      if (duration > 5) { // 5+ seconds
        logger.warn({
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration,
          userAgent: req.get('user-agent'),
        }, 'Slow request detected');
      }

      // Record errors for 4xx and 5xx responses
      if (statusClass >= 4) {
        recordError(
          `http_${statusClass}xx`,
          statusClass === 5 ? 'high' : 'medium',
          'http'
        );
      }

    } catch (error) {
      logger.error({ error }, 'Failed to record request metrics');
    }
  });

  next();
};

/**
 * Middleware to collect database query metrics
 */
export const databaseMetricsWrapper = <T>(
  operation: string,
  table: string,
  queryFn: () => Promise<T>
): Promise<T> => {
  const startTime = Date.now();

  return queryFn()
    .then(result => {
      const duration = Date.now() - startTime;
      metrics.databaseQueryDuration.observe({ operation, table }, duration / 1000);

      if (duration > 1000) { // 1+ second
        logger.warn({
          operation,
          table,
          duration,
        }, 'Slow database query detected');
      }

      return result;
    })
    .catch(error => {
      const duration = Date.now() - startTime;
      metrics.databaseQueryDuration.observe({ operation, table }, duration / 1000);

      recordError('database_query_failed', 'high', 'database');

      logger.error({
        operation,
        table,
        duration,
        error,
      }, 'Database query failed');

      throw error;
    });
};

/**
 * Middleware to collect Redis operation metrics
 */
export const redisMetricsWrapper = <T>(
  operation: string,
  operationFn: () => Promise<T>
): Promise<T> => {
  const startTime = Date.now();

  return operationFn()
    .then(result => {
      const duration = Date.now() - startTime;
      metrics.redisOperationDuration.observe({ operation }, duration / 1000);
      return result;
    })
    .catch(error => {
      const duration = Date.now() - startTime;
      metrics.redisOperationDuration.observe({ operation }, duration / 1000);

      recordError('redis_operation_failed', 'high', 'redis');

      logger.error({
        operation,
        duration,
        error,
      }, 'Redis operation failed');

      throw error;
    });
};

/**
 * Utility to track active database connections
 */
export const trackDatabaseConnections = (count: number): void => {
  metrics.databaseConnections.set(count);
};

/**
 * Utility to update active market counts
 */
export const updateActiveMarketCount = async (): Promise<void> => {
  try {
    const { prisma } = await import('../services/db.js');

    // Get active markets by guild
    const activeMarketsByGuild = await prisma.predictionMarket.groupBy({
      by: ['creatorId'], // Using creatorId as proxy for guild - adjust if needed
      where: {
        status: 'ACTIVE'
      },
      _count: {
        id: true
      }
    });

    // Update metrics for each guild
    activeMarketsByGuild.forEach(({ creatorId, _count }) => {
      metrics.activeMarkets.set({ guild_id: creatorId || 'unknown' }, _count.id);
    });

    // Get total TVL by token
    const tvlByToken = await prisma.predictionMarket.groupBy({
      by: ['tokenSymbol'],
      where: {
        status: { in: ['ACTIVE', 'RESOLVED'] }
      },
      _sum: {
        totalYesBets: true,
        totalNoBets: true,
      }
    });

    // Update TVL metrics
    tvlByToken.forEach(({ tokenSymbol, _sum }) => {
      const totalLocked = (_sum.totalYesBets || 0) + (_sum.totalNoBets || 0);
      metrics.totalValueLocked.set({ token_symbol: tokenSymbol || 'unknown' }, totalLocked);
    });

  } catch (error) {
    recordError('metrics_update_failed', 'medium', 'metrics');
    logger.error({ error }, 'Failed to update active market metrics');
  }
};

/**
 * Start periodic business metrics collection
 */
export const startBusinessMetricsCollection = (): void => {
  // Update market and TVL metrics every 2 minutes
  setInterval(updateActiveMarketCount, 120000);

  // Update user activity metrics every 5 minutes
  setInterval(async () => {
    try {
      const { prisma } = await import('../services/db.js');

      // Active users in last 24 hours (users who placed participations)
      const activeUsers24h = await prisma.predictionParticipation.groupBy({
        by: ['userId'],
        where: {
          createdAt: {
            gte: new Date(Date.now() - 86400000) // 24 hours
          }
        },
        _count: {
          userId: true
        }
      });

      metrics.activeUsers.set(
        { period: '24h', guild_id: 'all' },
        activeUsers24h.length
      );

      // Active users in last 7 days
      const activeUsers7d = await prisma.predictionParticipation.groupBy({
        by: ['userId'],
        where: {
          createdAt: {
            gte: new Date(Date.now() - 604800000) // 7 days
          }
        },
        _count: {
          userId: true
        }
      });

      metrics.activeUsers.set(
        { period: '7d', guild_id: 'all' },
        activeUsers7d.length
      );

    } catch (error) {
      recordError('user_metrics_failed', 'low', 'metrics');
      logger.error({ error }, 'Failed to update user activity metrics');
    }
  }, 300000);

  logger.info('Business metrics collection started');
};

console.log('🚀 Metrics middleware initialized');