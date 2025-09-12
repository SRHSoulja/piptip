// src/web/health.ts - Health check endpoints
import express, { Request, Response } from 'express';
import { healthCheckQuery } from '../services/prisma_logger.js';
import { getMetricsSummary } from '../services/metrics.js';

export const healthRouter = express.Router();

// Basic health check - fast response for load balancers
healthRouter.get('/healthz', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    
    // Quick DB ping with 200ms timeout
    const dbHealthy = await healthCheckQuery(200);
    const responseTime = Date.now() - startTime;
    
    if (dbHealthy) {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.GIT_SHA || process.env.npm_package_version || '1.0.0',
        db: {
          status: 'connected',
          response_time_ms: responseTime
        }
      });
    } else {
      res.status(503).json({
        status: 'unhealthy', 
        timestamp: new Date().toISOString(),
        version: process.env.GIT_SHA || process.env.npm_package_version || '1.0.0',
        db: {
          status: 'disconnected',
          response_time_ms: responseTime
        }
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.GIT_SHA || process.env.npm_package_version || '1.0.0',
      error: errorMessage,
      db: {
        status: 'error'
      }
    });
  }
});

// Detailed health check with metrics
healthRouter.get('/healthz/detailed', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    
    // DB health check with longer timeout for detailed view
    const dbHealthy = await healthCheckQuery(1000);
    const responseTime = Date.now() - startTime;
    
    // Get current metrics summary
    const metrics = getMetricsSummary();
    
    const healthData = {
      status: dbHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.GIT_SHA || process.env.npm_package_version || '1.0.0',
      uptime_seconds: Math.floor(process.uptime()),
      memory_usage: {
        heap_used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heap_total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
      },
      db: {
        status: dbHealthy ? 'connected' : 'disconnected',
        response_time_ms: responseTime
      },
      metrics: {
        refunds_issued_total: metrics.refunds_issued_total,
        refund_failures_total: metrics.refund_failures_total,
        unique_violation_claims_total: metrics.unique_violation_claims_total,
        slow_queries_total: metrics.slow_queries_total,
        negative_balance_attempts_total: metrics.negative_balance_attempts_total
      }
    };
    
    res.status(dbHealthy ? 200 : 503).json(healthData);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.GIT_SHA || process.env.npm_package_version || '1.0.0',
      error: errorMessage,
      db: {
        status: 'error'
      }
    });
  }
});

// Legacy endpoint for backward compatibility  
healthRouter.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "piptip", status: "healthy" });
});
