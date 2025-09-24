// src/services/emergency_controls.ts - Emergency shutdown and rollback procedures
import { prisma } from "./db.js";
import { predictionMarkets } from "./prediction_markets.js";

interface AppConfigCache {
  achievementsEnabled: boolean;
  streakProtectionEnabled: boolean;
  lastFetched: number;
}

let configCache: AppConfigCache | null = null;
const CACHE_TTL_MS = 30_000;

async function getAppConfig(): Promise<AppConfigCache> {
  const now = Date.now();

  if (configCache && now - configCache.lastFetched < CACHE_TTL_MS) {
    return configCache;
  }

  try {
    const config = await prisma.appConfig.findFirst({
      select: {
        achievementsEnabled: true,
        streakProtectionEnabled: true
      }
    });

    configCache = {
      achievementsEnabled: config?.achievementsEnabled ?? true,
      streakProtectionEnabled: config?.streakProtectionEnabled ?? true,
      lastFetched: now
    };

    return configCache;
  } catch (error) {
    console.warn("Failed to fetch app config, using defaults:", error);

    configCache = {
      achievementsEnabled: true,
      streakProtectionEnabled: true,
      lastFetched: now
    };

    return configCache;
  }
}

export async function areAchievementsEnabled(): Promise<boolean> {
  const config = await getAppConfig();
  return config.achievementsEnabled;
}

export async function isStreakProtectionEnabled(): Promise<boolean> {
  const config = await getAppConfig();
  return config.streakProtectionEnabled;
}

export async function disableAchievements(): Promise<void> {
  await prisma.appConfig.updateMany({
    data: { achievementsEnabled: false }
  });

  configCache = null;
  console.log("🚨 EMERGENCY: Achievements system DISABLED");
}

export async function enableAchievements(): Promise<void> {
  await prisma.appConfig.updateMany({
    data: { achievementsEnabled: true }
  });

  configCache = null;
  console.log("✅ Achievements system ENABLED");
}

export async function disableStreakProtection(): Promise<void> {
  await prisma.appConfig.updateMany({
    data: { streakProtectionEnabled: false }
  });

  configCache = null;
  console.log("🚨 EMERGENCY: Streak protection DISABLED");
}

interface EmergencyState {
  predictionsDisabled: boolean;
  tippingDisabled: boolean;
  withdrawalsDisabled: boolean;
  depositsDisabled: boolean;
  newRegistrationsDisabled: boolean;
  reason: string;
  timestamp: Date;
  triggeredBy: string;
}

export class EmergencyControlsService {

  /**
   * Emergency shutdown - disable all critical functions
   */
  async emergencyShutdown(params: {
    reason: string;
    triggeredBy: string;
    disablePredictions?: boolean;
    disableTipping?: boolean;
    disableWithdrawals?: boolean;
    disableDeposits?: boolean;
    disableRegistrations?: boolean;
  }): Promise<{ success: boolean; message: string }> {
    try {
      const shutdownConfig = {
        predictionsDisabled: params.disablePredictions ?? true,
        tippingDisabled: params.disableTipping ?? true,
        withdrawalsDisabled: params.disableWithdrawals ?? true,
        depositsDisabled: params.disableDeposits ?? true,
        newRegistrationsDisabled: params.disableRegistrations ?? true,
        reason: params.reason,
        timestamp: new Date(),
        triggeredBy: params.triggeredBy
      };

      // Update AppConfig to disable all systems
      await prisma.appConfig.updateMany({
        data: {
          emergencyMode: true,
          withdrawalsPaused: shutdownConfig.withdrawalsDisabled,
          tippingPaused: shutdownConfig.tippingDisabled,
          achievementsEnabled: false,
          streakProtectionEnabled: false
        }
      });

      // Cancel all active prediction markets if predictions are disabled
      if (shutdownConfig.predictionsDisabled) {
        await this.cancelAllActiveMarkets(params.triggeredBy, params.reason);
      }

      // Log emergency action
      await this.logEmergencyAction('EMERGENCY_SHUTDOWN', shutdownConfig, params.triggeredBy);

      console.error(`🚨 EMERGENCY SHUTDOWN ACTIVATED by ${params.triggeredBy}: ${params.reason}`);

      return {
        success: true,
        message: `Emergency shutdown activated. All critical systems disabled. Reason: ${params.reason}`
      };

    } catch (error) {
      console.error('Emergency shutdown failed:', error);
      return {
        success: false,
        message: 'Emergency shutdown failed - manual intervention required'
      };
    }
  }

  /**
   * Graceful recovery from emergency mode
   */
  async recoverFromEmergency(params: {
    triggeredBy: string;
    enablePredictions?: boolean;
    enableTipping?: boolean;
    enableWithdrawals?: boolean;
    enableDeposits?: boolean;
    enableRegistrations?: boolean;
  }): Promise<{ success: boolean; message: string }> {
    try {
      // Validate that it's safe to recover
      const safetyCheck = await this.performSafetyCheck();
      if (!safetyCheck.safe) {
        return {
          success: false,
          message: `Recovery blocked: ${safetyCheck.reason}`
        };
      }

      // Re-enable systems gradually
      await prisma.appConfig.updateMany({
        data: {
          emergencyMode: false,
          withdrawalsPaused: !(params.enableWithdrawals ?? true),
          tippingPaused: !(params.enableTipping ?? true),
          achievementsEnabled: true,
          streakProtectionEnabled: true
        }
      });

      const recoveryConfig = {
        predictionsEnabled: params.enablePredictions ?? true,
        tippingEnabled: params.enableTipping ?? true,
        withdrawalsEnabled: params.enableWithdrawals ?? true,
        depositsEnabled: params.enableDeposits ?? true,
        registrationsEnabled: params.enableRegistrations ?? true,
        timestamp: new Date(),
        triggeredBy: params.triggeredBy
      };

      await this.logEmergencyAction('RECOVERY_INITIATED', recoveryConfig, params.triggeredBy);

      console.log(`✅ Emergency recovery initiated by ${params.triggeredBy}`);

      return {
        success: true,
        message: 'Emergency recovery completed successfully. Systems are being restored.'
      };

    } catch (error) {
      console.error('Emergency recovery failed:', error);
      return {
        success: false,
        message: 'Emergency recovery failed - manual intervention required'
      };
    }
  }

  /**
   * Cancel all active prediction markets
   */
  private async cancelAllActiveMarkets(triggeredBy: string, reason: string): Promise<void> {
    try {
      const activeMarkets = await prisma.predictionMarket.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, title: true }
      });

      console.log(`🚫 Cancelling ${activeMarkets.length} active prediction markets due to emergency shutdown`);

      for (const market of activeMarkets) {
        try {
          const result = await predictionMarkets.resolveMarket(market.id, 'CANCEL');
          if (result.success) {
            console.log(`✅ Cancelled market: ${market.title}`);
          } else {
            console.error(`❌ Failed to cancel market ${market.id}: ${result.error}`);
          }
        } catch (error) {
          console.error(`❌ Error cancelling market ${market.id}:`, error);
        }
      }

      await this.logEmergencyAction('MARKETS_CANCELLED', {
        marketCount: activeMarkets.length,
        marketIds: activeMarkets.map(m => m.id),
        reason,
        timestamp: new Date()
      }, triggeredBy);

    } catch (error) {
      console.error('Failed to cancel active markets during emergency:', error);
    }
  }

  /**
   * Perform safety checks before recovery
   */
  private async performSafetyCheck(): Promise<{ safe: boolean; reason?: string }> {
    try {
      // Check database connectivity
      await prisma.$queryRaw`SELECT 1`;

      // Check for any ongoing financial operations
      const recentTransactions = await prisma.transaction.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
          }
        }
      });

      if (recentTransactions > 50) {
        return {
          safe: false,
          reason: `High transaction volume detected (${recentTransactions} in last 5 minutes)`
        };
      }

      // Check for system integrity
      const userCount = await prisma.user.count();
      const balanceCount = await prisma.userBalance.count();

      if (userCount === 0 || balanceCount === 0) {
        return {
          safe: false,
          reason: 'Database integrity check failed - critical data missing'
        };
      }

      return { safe: true };

    } catch (error) {
      console.error('Safety check failed:', error);
      return {
        safe: false,
        reason: 'Safety check failed - database connectivity issues'
      };
    }
  }

  /**
   * Get current emergency status
   */
  async getEmergencyStatus(): Promise<{
    emergencyMode: boolean;
    withdrawalsPaused: boolean;
    tippingPaused: boolean;
    lastEmergencyAction?: any;
  }> {
    try {
      const config = await prisma.appConfig.findFirst();

      const lastAction = await prisma.transaction.findFirst({
        where: {
          type: 'EMERGENCY_LOG'
        },
        orderBy: { createdAt: 'desc' }
      });

      return {
        emergencyMode: config?.emergencyMode ?? false,
        withdrawalsPaused: config?.withdrawalsPaused ?? false,
        tippingPaused: config?.tippingPaused ?? false,
        lastEmergencyAction: lastAction ? JSON.parse(lastAction.metadata || '{}') : null
      };

    } catch (error) {
      console.error('Failed to get emergency status:', error);
      return {
        emergencyMode: true, // Fail safe
        withdrawalsPaused: true,
        tippingPaused: true
      };
    }
  }

  /**
   * Test all critical systems
   */
  async performSystemHealthCheck(): Promise<{
    healthy: boolean;
    checks: Array<{ component: string; status: 'pass' | 'fail' | 'warning'; message?: string }>;
  }> {
    const checks = [];

    try {
      // Database connectivity
      try {
        await prisma.$queryRaw`SELECT 1`;
        checks.push({ component: 'Database', status: 'pass' as const });
      } catch (error) {
        checks.push({ component: 'Database', status: 'fail' as const, message: 'Connection failed' });
      }

      // User balance integrity
      try {
        const negativeBalances = await prisma.userBalance.count({
          where: { amount: { lt: 0 } }
        });
        if (negativeBalances > 0) {
          checks.push({
            component: 'Balance Integrity',
            status: 'fail' as const,
            message: `${negativeBalances} negative balances detected`
          });
        } else {
          checks.push({ component: 'Balance Integrity', status: 'pass' as const });
        }
      } catch (error) {
        checks.push({ component: 'Balance Integrity', status: 'fail' as const, message: 'Check failed' });
      }

      // Active markets count
      try {
        const activeMarkets = await prisma.predictionMarket.count({
          where: { status: 'ACTIVE' }
        });
        if (activeMarkets > 1000) {
          checks.push({
            component: 'Market Load',
            status: 'warning' as const,
            message: `High market count: ${activeMarkets}`
          });
        } else {
          checks.push({ component: 'Market Load', status: 'pass' as const });
        }
      } catch (error) {
        checks.push({ component: 'Market Load', status: 'fail' as const, message: 'Check failed' });
      }

      // Recent error count
      try {
        const recentErrors = await prisma.transaction.count({
          where: {
            type: 'ERROR_LOG',
            createdAt: {
              gte: new Date(Date.now() - 60 * 60 * 1000) // Last hour
            }
          }
        });
        if (recentErrors > 50) {
          checks.push({
            component: 'Error Rate',
            status: 'warning' as const,
            message: `High error count: ${recentErrors} in last hour`
          });
        } else {
          checks.push({ component: 'Error Rate', status: 'pass' as const });
        }
      } catch (error) {
        checks.push({ component: 'Error Rate', status: 'fail' as const, message: 'Check failed' });
      }

    } catch (error) {
      console.error('Health check failed:', error);
      checks.push({ component: 'System', status: 'fail' as const, message: 'Health check system failure' });
    }

    const healthy = checks.every(check => check.status === 'pass');

    return { healthy, checks };
  }

  /**
   * Log emergency actions for audit trail
   */
  private async logEmergencyAction(type: string, data: any, triggeredBy: string): Promise<void> {
    try {
      await prisma.transaction.create({
        data: {
          type: 'EMERGENCY_LOG',
          amount: 0,
          metadata: JSON.stringify({
            actionType: type,
            data,
            triggeredBy,
            timestamp: new Date().toISOString()
          })
        }
      });
    } catch (error) {
      console.error('Failed to log emergency action:', error);
    }
  }

  /**
   * Force kill switch - immediate shutdown of all systems
   */
  async forceKillSwitch(triggeredBy: string, reason: string): Promise<{ success: boolean; message: string }> {
    try {
      // Immediately disable everything at database level
      await prisma.$executeRaw`
        UPDATE "AppConfig" SET
          "emergencyMode" = true,
          "withdrawalsPaused" = true,
          "tippingPaused" = true,
          "achievementsEnabled" = false
      `;

      // Cancel all active markets immediately
      await prisma.$executeRaw`
        UPDATE "PredictionMarket" SET
          "status" = 'CANCELLED'
        WHERE "status" = 'ACTIVE'
      `;

      await this.logEmergencyAction('FORCE_KILL_SWITCH', {
        reason,
        timestamp: new Date(),
        action: 'IMMEDIATE_SHUTDOWN'
      }, triggeredBy);

      console.error(`🚨🚨🚨 FORCE KILL SWITCH ACTIVATED by ${triggeredBy}: ${reason}`);

      return {
        success: true,
        message: 'Force kill switch activated - all systems immediately disabled'
      };

    } catch (error) {
      console.error('Force kill switch failed:', error);
      return {
        success: false,
        message: 'Force kill switch failed - MANUAL INTERVENTION REQUIRED IMMEDIATELY'
      };
    }
  }
}

// Export singleton instance
export const emergencyControls = new EmergencyControlsService();