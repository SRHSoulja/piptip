// src/web/admin/automation.ts - Admin endpoints for managing market automation
import { Router, Request, Response } from "express";
import { marketAutomationScheduler, AutomationConfig } from "../../services/market_automation_scheduler.js";
import { prisma } from "../../services/db.js";

export const automationAdminRouter = Router();

/**
 * GET /admin/automation/status - View automation status and statistics
 */
automationAdminRouter.get("/status", async (req: Request, res: Response) => {
  try {
    const status = marketAutomationScheduler.getStatus();
    const activeMarkets = await status.activeMarkets;

    // Get recent performance metrics
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentLogs = await prisma.autoMarketLog.findMany({
      where: {
        createdAt: { gte: last7Days }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    // Calculate success rates
    const totalAttempts = recentLogs.length;
    const successfulCreations = recentLogs.filter(log => log.success).length;
    const successRate = totalAttempts > 0 ? (successfulCreations / totalAttempts) * 100 : 0;

    // Group by type
    const cryptoLogs = recentLogs.filter(log => log.type === 'crypto');
    const sportsLogs = recentLogs.filter(log => log.type === 'sports');

    const analytics = {
      last7Days: {
        totalAttempts,
        successful: successfulCreations,
        failed: totalAttempts - successfulCreations,
        successRate: Math.round(successRate * 100) / 100,
        crypto: {
          attempts: cryptoLogs.length,
          successful: cryptoLogs.filter(log => log.success).length
        },
        sports: {
          attempts: sportsLogs.length,
          successful: sportsLogs.filter(log => log.success).length
        }
      }
    };

    res.json({
      success: true,
      status: {
        ...status,
        activeMarkets
      },
      analytics,
      recentLogs: recentLogs.slice(0, 10) // Last 10 for display
    });

  } catch (error) {
    console.error('Error getting automation status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get automation status'
    });
  }
});

/**
 * GET /admin/automation/config - Get current automation configuration
 */
automationAdminRouter.get("/config", (req: Request, res: Response) => {
  try {
    const config = marketAutomationScheduler.getConfig();
    res.json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Error getting automation config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get automation config'
    });
  }
});

/**
 * POST /admin/automation/config - Update automation configuration
 */
automationAdminRouter.post("/config", async (req: Request, res: Response) => {
  try {
    const updates: Partial<AutomationConfig> = req.body;

    // Validate required fields if provided
    if (updates.schedule) {
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      const invalidTimes = updates.schedule.filter(time => !timeRegex.test(time));
      if (invalidTimes.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Invalid time format: ${invalidTimes.join(', ')}. Use HH:MM format.`
        });
      }
    }

    if (updates.maxDailyMarkets && (updates.maxDailyMarkets < 0 || updates.maxDailyMarkets > 50)) {
      return res.status(400).json({
        success: false,
        error: 'maxDailyMarkets must be between 0 and 50'
      });
    }

    // Update configuration
    marketAutomationScheduler.updateConfig(updates);

    // Restart scheduler if enabled/disabled or schedule changed
    const needsRestart = updates.enabled !== undefined || updates.schedule !== undefined;
    if (needsRestart) {
      marketAutomationScheduler.stop();
      if (updates.enabled !== false) {
        marketAutomationScheduler.start();
      }
    }

    const newConfig = marketAutomationScheduler.getConfig();

    res.json({
      success: true,
      message: 'Configuration updated successfully',
      config: newConfig,
      restarted: needsRestart
    });

  } catch (error) {
    console.error('Error updating automation config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update automation config'
    });
  }
});

/**
 * POST /admin/automation/trigger - Manually trigger market creation
 */
automationAdminRouter.post("/trigger", async (req: Request, res: Response) => {
  try {
    const result = await marketAutomationScheduler.triggerManualCreation();

    if (result.success) {
      res.json({
        success: true,
        message: `Triggered manual creation, created ${result.markets.length} markets`,
        markets: result.markets
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Manual trigger failed'
      });
    }

  } catch (error) {
    console.error('Error triggering manual creation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger manual creation'
    });
  }
});

/**
 * POST /admin/automation/start - Start automation
 */
automationAdminRouter.post("/start", (req: Request, res: Response) => {
  try {
    marketAutomationScheduler.updateConfig({ enabled: true });
    marketAutomationScheduler.start();

    res.json({
      success: true,
      message: 'Automation started successfully'
    });

  } catch (error) {
    console.error('Error starting automation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start automation'
    });
  }
});

/**
 * POST /admin/automation/stop - Stop automation
 */
automationAdminRouter.post("/stop", (req: Request, res: Response) => {
  try {
    marketAutomationScheduler.updateConfig({ enabled: false });
    marketAutomationScheduler.stop();

    res.json({
      success: true,
      message: 'Automation stopped successfully'
    });

  } catch (error) {
    console.error('Error stopping automation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop automation'
    });
  }
});

/**
 * GET /admin/automation/logs - Get automation logs with filtering
 */
automationAdminRouter.get("/logs", async (req: Request, res: Response) => {
  try {
    const {
      type,
      success,
      limit = "50",
      offset = "0",
      days = "7"
    } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 50, 200);
    const offsetNum = parseInt(offset as string) || 0;
    const daysNum = parseInt(days as string) || 7;

    const since = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    const where: any = {
      createdAt: { gte: since }
    };

    if (type) {
      where.type = type;
    }

    if (success !== undefined) {
      where.success = success === 'true';
    }

    const logs = await prisma.autoMarketLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limitNum,
      skip: offsetNum
    });

    const total = await prisma.autoMarketLog.count({ where });

    res.json({
      success: true,
      logs: logs.map(log => ({
        ...log,
        config: typeof log.config === 'string' ? JSON.parse(log.config) : log.config,
        engagementMetrics: log.engagementMetrics ?
          (typeof log.engagementMetrics === 'string' ? JSON.parse(log.engagementMetrics as string) : log.engagementMetrics)
          : null
      })),
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < total
      }
    });

  } catch (error) {
    console.error('Error getting automation logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get automation logs'
    });
  }
});

/**
 * GET /admin/automation/analytics - Get detailed analytics
 */
automationAdminRouter.get("/analytics", async (req: Request, res: Response) => {
  try {
    const { days = "30" } = req.query;
    const daysNum = parseInt(days as string) || 30;
    const since = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    // Get all logs in period
    const logs = await prisma.autoMarketLog.findMany({
      where: {
        createdAt: { gte: since }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate daily breakdown
    const dailyStats: { [date: string]: any } = {};
    logs.forEach(log => {
      const date = log.createdAt.toISOString().split('T')[0];
      if (!dailyStats[date]) {
        dailyStats[date] = {
          total: 0,
          successful: 0,
          crypto: 0,
          sports: 0,
          errors: []
        };
      }
      dailyStats[date].total++;
      if (log.success) dailyStats[date].successful++;
      if (log.type === 'crypto') dailyStats[date].crypto++;
      if (log.type === 'sports') dailyStats[date].sports++;
      if (!log.success && log.error) {
        dailyStats[date].errors.push(log.error);
      }
    });

    // Calculate performance by type
    const cryptoLogs = logs.filter(log => log.type === 'crypto');
    const sportsLogs = logs.filter(log => log.type === 'sports');

    const performanceByType = {
      crypto: {
        total: cryptoLogs.length,
        successful: cryptoLogs.filter(log => log.success).length,
        successRate: cryptoLogs.length > 0 ?
          (cryptoLogs.filter(log => log.success).length / cryptoLogs.length) * 100 : 0
      },
      sports: {
        total: sportsLogs.length,
        successful: sportsLogs.filter(log => log.success).length,
        successRate: sportsLogs.length > 0 ?
          (sportsLogs.filter(log => log.success).length / sportsLogs.length) * 100 : 0
      }
    };

    // Most common errors
    const errors = logs
      .filter(log => !log.success && log.error)
      .map(log => log.error!);

    const errorCounts: { [error: string]: number } = {};
    errors.forEach(error => {
      errorCounts[error] = (errorCounts[error] || 0) + 1;
    });

    const topErrors = Object.entries(errorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([error, count]) => ({ error, count }));

    res.json({
      success: true,
      analytics: {
        period: {
          days: daysNum,
          startDate: since.toISOString(),
          endDate: new Date().toISOString()
        },
        overview: {
          totalAttempts: logs.length,
          successful: logs.filter(log => log.success).length,
          failed: logs.filter(log => !log.success).length,
          successRate: logs.length > 0 ?
            (logs.filter(log => log.success).length / logs.length) * 100 : 0
        },
        dailyBreakdown: Object.entries(dailyStats)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, stats]) => ({ date, ...stats })),
        performanceByType,
        topErrors
      }
    });

  } catch (error) {
    console.error('Error getting automation analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get automation analytics'
    });
  }
});

/**
 * DELETE /admin/automation/logs - Clear old automation logs
 */
automationAdminRouter.delete("/logs", async (req: Request, res: Response) => {
  try {
    const { olderThanDays = "30" } = req.query;
    const days = parseInt(olderThanDays as string) || 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const deleted = await prisma.autoMarketLog.deleteMany({
      where: {
        createdAt: { lt: cutoff }
      }
    });

    res.json({
      success: true,
      message: `Deleted ${deleted.count} logs older than ${days} days`,
      deletedCount: deleted.count
    });

  } catch (error) {
    console.error('Error deleting automation logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete automation logs'
    });
  }
});