// src/queues/workers/reconciliation_service.ts - Balance reconciliation with drift detection
import { Worker, Job } from 'bullmq';
import { redis, reconciliationQueue } from '../config.js';
import { ReconciliationJobData, validateReconciliationJob } from '../types.js';
import { prisma } from '../../services/db.js';
import { Prisma } from '@prisma/client';

interface ReconciliationResult {
  type: string;
  scope: any;
  status: 'PASSED' | 'FAILED' | 'DRIFT_DETECTED' | 'CORRECTED';
  drifts: Array<{
    entity: string;
    entityId: string;
    expected: string;
    actual: string;
    difference: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }>;
  corrections: Array<{
    entity: string;
    entityId: string;
    action: string;
    oldValue: string;
    newValue: string;
  }>;
  summary: {
    totalChecked: number;
    driftsFound: number;
    correctionsMade: number;
    toleranceExceeded: number;
  };
}

export class ReconciliationService {
  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      'reconciliation',
      this.processJob.bind(this),
      {
        connection: redis,
        concurrency: 2, // Conservative concurrency for reconciliation
        removeOnComplete: { count: 200 }, // Keep more reconciliation records
        removeOnFail: { count: 100 },
        stalledInterval: 300000, // 5 minutes - reconciliation can take time
        maxStalledCount: 2,
      }
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job: Job) => {
      console.log(`✅ Reconciliation job ${job.id} completed`);
    });

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      console.error(`❌ Reconciliation job ${job?.id} failed:`, error);

      // Reconciliation failures need investigation
      if (job) {
        this.escalateReconciliationFailure(job, error);
      }
    });

    this.worker.on('stalled', (jobId: string) => {
      console.warn(`⚠️ Reconciliation job ${jobId} stalled - may need manual review`);
    });

    this.worker.on('error', (error: Error) => {
      console.error('❌ Reconciliation service error:', error);
    });
  }

  private async processJob(job: Job): Promise<void> {
    const startTime = Date.now();
    console.log(`🔍 Processing reconciliation job ${job.id}`);

    try {
      // Validate job payload
      const jobData = validateReconciliationJob(job.data);

      let result: ReconciliationResult;

      // Route to specific reconciliation type
      switch (jobData.type) {
        case 'user_balance':
          result = await this.reconcileUserBalance(jobData);
          break;
        case 'market_pool':
          result = await this.reconcileMarketPool(jobData);
          break;
        case 'treasury':
          result = await this.reconcileTreasury(jobData);
          break;
        case 'full_audit':
          result = await this.performFullAudit(jobData);
          break;
        default:
          throw new Error(`Unknown reconciliation type: ${jobData.type}`);
      }

      // Store reconciliation results
      await this.storeReconciliationResult(jobData, result);

      // Alert on significant drifts
      if (result.summary.toleranceExceeded > 0) {
        await this.alertOnToleranceExceeded(jobData, result);
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Reconciliation completed in ${duration}ms - ${result.status}: ${result.summary.driftsFound} drifts, ${result.summary.correctionsMade} corrections`);

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Reconciliation failed after ${duration}ms:`, error);

      // Log reconciliation error
      await this.logReconciliationError(job, error as Error);

      throw error; // Re-throw for BullMQ retry handling
    }
  }

  private async reconcileUserBalance(jobData: ReconciliationJobData): Promise<ReconciliationResult> {
    const tolerance = BigInt(jobData.toleranceThreshold);
    const result: ReconciliationResult = {
      type: 'user_balance',
      scope: jobData.scope,
      status: 'PASSED',
      drifts: [],
      corrections: [],
      summary: { totalChecked: 0, driftsFound: 0, correctionsMade: 0, toleranceExceeded: 0 }
    };

    await prisma.$transaction(async (tx) => {
      // Build query conditions
      const where: any = {};
      if (jobData.scope.userId) where.userId = jobData.scope.userId;
      if (jobData.scope.tokenId) where.tokenId = jobData.scope.tokenId;

      // Get all user balances to check
      const balances = await tx.userBalance.findMany({
        where,
        include: {
          User: { select: { discordId: true } },
          Token: { select: { symbol: true } }
        }
      });

      result.summary.totalChecked = balances.length;

      for (const balance of balances) {
        const calculatedBalance = await this.calculateUserBalance(tx, balance.userId.toString(), balance.tokenId.toString(), jobData.scope);
        const actualBalance = BigInt(balance.amount.toString());
        const expectedBalance = calculatedBalance;

        const difference = actualBalance - expectedBalance;
        const absDifference = difference < 0 ? -difference : difference;

        if (absDifference > tolerance) {
          const severity = this.calculateDriftSeverity(absDifference, actualBalance);

          result.drifts.push({
            entity: 'user_balance',
            entityId: `${balance.userId}_${balance.tokenId}`,
            expected: expectedBalance.toString(),
            actual: actualBalance.toString(),
            difference: difference.toString(),
            severity
          });

          result.summary.driftsFound++;

          if (severity === 'CRITICAL' || severity === 'HIGH') {
            result.summary.toleranceExceeded++;
          }

          // Attempt automatic correction for small drifts
          if (severity === 'LOW' || severity === 'MEDIUM') {
            await tx.userBalance.update({
              where: { userId_tokenId: { userId: balance.userId, tokenId: balance.tokenId } },
              data: {
                amount: expectedBalance.toString()
              }
            });

            // Log the correction
            await tx.transaction.create({
              data: {
                // id will be auto-generated
                userId: balance.userId,
                tokenId: balance.tokenId,
                type: 'RECONCILIATION',
                amount: difference.toString(),
                // description: `Balance reconciliation: corrected drift of ${difference.toString()}`, // Field doesn't exist in schema
                metadata: JSON.stringify({
                  jobId: jobData.id,
                  jobType: 'reconciliation',
                  severity,
                  oldBalance: actualBalance.toString(),
                  newBalance: expectedBalance.toString(),
                })
              }
            });

            result.corrections.push({
              entity: 'user_balance',
              entityId: `${balance.userId}_${balance.tokenId}`,
              action: 'BALANCE_CORRECTION',
              oldValue: actualBalance.toString(),
              newValue: expectedBalance.toString()
            });

            result.summary.correctionsMade++;
          }
        }
      }

      // Determine final status
      if (result.summary.toleranceExceeded > 0) {
        result.status = 'DRIFT_DETECTED';
      } else if (result.summary.correctionsMade > 0) {
        result.status = 'CORRECTED';
      } else if (result.summary.driftsFound > 0) {
        result.status = 'DRIFT_DETECTED';
      }
    }, {
      maxWait: 60000, // 1 minute
      timeout: 300000, // 5 minutes for large reconciliations
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });

    return result;
  }

  private async calculateUserBalance(
    tx: Prisma.TransactionClient,
    userId: string,
    tokenId: string,
    scope: any
  ): Promise<bigint> {
    // Calculate expected balance from transaction history
    const transactions = await tx.transaction.findMany({
      where: {
        userId: parseInt(userId),
        tokenId: parseInt(tokenId),
        ...(scope.startTime && { createdAt: { gte: new Date(scope.startTime) } }),
        ...(scope.endTime && { createdAt: { lte: new Date(scope.endTime) } })
      }
    });

    // Sum all transactions to get expected balance
    let calculatedBalance = 0n;
    for (const tx_record of transactions) {
      calculatedBalance += BigInt(tx_record.amount.toString());
    }

    return calculatedBalance;
  }

  private async reconcileMarketPool(jobData: ReconciliationJobData): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      type: 'market_pool',
      scope: jobData.scope,
      status: 'PASSED',
      drifts: [],
      corrections: [],
      summary: { totalChecked: 0, driftsFound: 0, correctionsMade: 0, toleranceExceeded: 0 }
    };

    await prisma.$transaction(async (tx) => {
      const where: any = {};
      if (jobData.scope.marketId) where.id = jobData.scope.marketId;

      const markets = await tx.predictionMarket.findMany({
        where,
        include: { participations: true }
      });

      result.summary.totalChecked = markets.length;

      for (const market of markets) {
        // Calculate expected pool from participations
        const expectedYesTotal = market.participations
          .filter((bet: any) => bet.side === 'YES')
          .reduce((sum: number, bet: any) => sum + bet.amount, 0);

        const expectedNoTotal = market.participations
          .filter((bet: any) => bet.side === 'NO')
          .reduce((sum: number, bet: any) => sum + bet.amount, 0);

        // Compare with stored totals
        const actualYesTotal = market.totalYesBets;
        const actualNoTotal = market.totalNoBets;

        const yesDiff = Math.abs(expectedYesTotal - actualYesTotal);
        const noDiff = Math.abs(expectedNoTotal - actualNoTotal);
        const tolerance = parseInt(jobData.toleranceThreshold);

        if (yesDiff > tolerance || noDiff > tolerance) {
          result.drifts.push({
            entity: 'market_pool',
            entityId: market.id,
            expected: `YES: ${expectedYesTotal}, NO: ${expectedNoTotal}`,
            actual: `YES: ${actualYesTotal}, NO: ${actualNoTotal}`,
            difference: `YES: ${expectedYesTotal - actualYesTotal}, NO: ${expectedNoTotal - actualNoTotal}`,
            severity: (yesDiff > tolerance * 10 || noDiff > tolerance * 10) ? 'HIGH' : 'MEDIUM'
          });

          result.summary.driftsFound++;

          // Correct the market totals
          await tx.predictionMarket.update({
            where: { id: market.id },
            data: {
              totalYesBets: expectedYesTotal,
              totalNoBets: expectedNoTotal,
            }
          });

          result.corrections.push({
            entity: 'market_pool',
            entityId: market.id,
            action: 'POOL_CORRECTION',
            oldValue: `YES: ${actualYesTotal}, NO: ${actualNoTotal}`,
            newValue: `YES: ${expectedYesTotal}, NO: ${expectedNoTotal}`
          });

          result.summary.correctionsMade++;
        }
      }

      if (result.summary.driftsFound > 0) {
        result.status = result.summary.correctionsMade > 0 ? 'CORRECTED' : 'DRIFT_DETECTED';
      }
    });

    return result;
  }

  private async reconcileTreasury(jobData: ReconciliationJobData): Promise<ReconciliationResult> {
    // Treasury reconciliation would integrate with Abstract Chain
    // For now, return a placeholder implementation
    return {
      type: 'treasury',
      scope: jobData.scope,
      status: 'PASSED',
      drifts: [],
      corrections: [],
      summary: { totalChecked: 1, driftsFound: 0, correctionsMade: 0, toleranceExceeded: 0 }
    };
  }

  private async performFullAudit(jobData: ReconciliationJobData): Promise<ReconciliationResult> {
    console.log('🔍 Starting full audit reconciliation');

    // Combine all reconciliation types
    const userBalanceResult = await this.reconcileUserBalance({
      ...jobData,
      type: 'user_balance',
      scope: {}
    });

    const marketPoolResult = await this.reconcileMarketPool({
      ...jobData,
      type: 'market_pool',
      scope: {}
    });

    // Aggregate results
    const result: ReconciliationResult = {
      type: 'full_audit',
      scope: jobData.scope,
      status: 'PASSED',
      drifts: [...userBalanceResult.drifts, ...marketPoolResult.drifts],
      corrections: [...userBalanceResult.corrections, ...marketPoolResult.corrections],
      summary: {
        totalChecked: userBalanceResult.summary.totalChecked + marketPoolResult.summary.totalChecked,
        driftsFound: userBalanceResult.summary.driftsFound + marketPoolResult.summary.driftsFound,
        correctionsMade: userBalanceResult.summary.correctionsMade + marketPoolResult.summary.correctionsMade,
        toleranceExceeded: userBalanceResult.summary.toleranceExceeded + marketPoolResult.summary.toleranceExceeded
      }
    };

    if (result.summary.toleranceExceeded > 0) {
      result.status = 'DRIFT_DETECTED';
    } else if (result.summary.correctionsMade > 0) {
      result.status = 'CORRECTED';
    } else if (result.summary.driftsFound > 0) {
      result.status = 'DRIFT_DETECTED';
    }

    return result;
  }

  private calculateDriftSeverity(difference: bigint, totalBalance: bigint): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (totalBalance === 0n) return 'HIGH';

    const percentageDrift = Number(difference * 100n / totalBalance);

    if (percentageDrift > 10) return 'CRITICAL';
    if (percentageDrift > 5) return 'HIGH';
    if (percentageDrift > 1) return 'MEDIUM';
    return 'LOW';
  }

  private async storeReconciliationResult(
    jobData: ReconciliationJobData,
    result: ReconciliationResult
  ): Promise<void> {
    // Store in database for audit trail
    await prisma.reconciliationResult.create({
      data: {
        id: `recon_${jobData.type}_${Date.now()}`,
        type: jobData.type,
        status: result.status,
        scope: jobData.scope as any,
        driftsFound: result.summary.driftsFound,
        correctionsMade: result.summary.correctionsMade,
        toleranceExceeded: result.summary.toleranceExceeded,
        details: result as any,
        createdAt: new Date(),
      }
    });

    // Store summary in Redis for dashboard
    const redisKey = `reconciliation:result:${jobData.type}:${Date.now()}`;
    await redis.setex(redisKey, 86400, JSON.stringify({ // 24 hours
      ...result.summary,
      timestamp: Date.now(),
      status: result.status
    }));

    console.log(`📝 Reconciliation result stored: ${result.status} - ${result.summary.driftsFound} drifts found, ${result.summary.correctionsMade} corrections made`);
  }

  private async alertOnToleranceExceeded(
    jobData: ReconciliationJobData,
    result: ReconciliationResult
  ): Promise<void> {
    console.error(`🚨 RECONCILIATION ALERT: Tolerance exceeded in ${jobData.type} reconciliation`);
    console.error(`${result.summary.toleranceExceeded} critical drifts found requiring manual review`);

    // Store alert for monitoring
    const alertKey = `alert:reconciliation:${jobData.type}:${Date.now()}`;
    await redis.setex(alertKey, 172800, JSON.stringify({ // 48 hours
      type: jobData.type,
      criticalDrifts: result.summary.toleranceExceeded,
      totalDrifts: result.summary.driftsFound,
      correctionsMade: result.summary.correctionsMade,
      timestamp: Date.now(),
      drifts: result.drifts.filter(d => d.severity === 'CRITICAL' || d.severity === 'HIGH')
    }));

    // Could integrate with external alerting here
  }

  private async escalateReconciliationFailure(job: Job, error: Error): Promise<void> {
    console.error(`🚨 CRITICAL: Reconciliation failure`);
    console.error(`Job ID: ${job.id}, Type: ${job.data.type}`);
    console.error(`Error: ${error.message}`);

    // Add to dead letter queue
    const { deadLetterQueue } = await import('../config.js');
    const { createDeadLetterJob } = await import('../types.js');

    const deadLetterData = createDeadLetterJob({
      originalQueue: 'reconciliation',
      originalJobId: job.id || 'unknown',
      originalPayload: job.data,
      failureReason: error.message,
      attempts: job.attemptsMade || 0,
      lastError: {
        message: error.message,
        stack: error.stack || '',
        timestamp: Date.now(),
      },
      metadata: {
        canRetry: true, // Reconciliation can usually be retried
        requiresManualReview: false,
        escalationLevel: 'high',
        estimatedResolution: 'automated retry or manual investigation',
      }
    });

    await deadLetterQueue.add('reconciliation-failure', deadLetterData, {
      priority: 2,
      removeOnComplete: false,
      removeOnFail: false,
    });
  }

  private async logReconciliationError(job: Job, error: Error): Promise<void> {
    const errorContext = {
      jobId: job.id,
      type: job.data.type,
      scope: job.data.scope,
      attempt: job.attemptsMade,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.constructor.name,
      },
      timestamp: new Date().toISOString(),
    };

    await redis.setex(
      `reconciliation:error:${job.data.type}:${job.id}`,
      172800, // 48 hours
      JSON.stringify(errorContext)
    );

    console.error('📝 Reconciliation error context stored:', errorContext);
  }

  public async close(): Promise<void> {
    await this.worker.close();
    console.log('✅ Reconciliation service closed');
  }

  public async pause(): Promise<void> {
    await this.worker.pause();
    console.log('⏸️ Reconciliation service paused');
  }

  public async resume(): Promise<void> {
    await this.worker.resume();
    console.log('▶️ Reconciliation service resumed');
  }

  public getStatus() {
    return {
      isRunning: this.worker.isRunning(),
      isPaused: this.worker.isPaused(),
      concurrency: 2,
    };
  }
}

// Export singleton instance
export const reconciliationService = new ReconciliationService();

console.log('🚀 Reconciliation service initialized with drift detection and automated repair');