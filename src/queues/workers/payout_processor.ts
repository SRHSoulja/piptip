// src/queues/workers/payout_processor.ts - Payout processor for PredictionMarket system
import { Worker, Job } from 'bullmq';
import { redis, payoutQueue } from '../config.js';
import { PayoutJobData, validatePayoutJob } from '../types.js';
import { prisma } from '../../services/db.js';
import { Prisma } from '@prisma/client';
import { PredictionMarketService } from '../../services/prediction_markets.js';

export class PayoutProcessor {
  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      'payouts',
      this.processJob.bind(this),
      {
        connection: redis,
        concurrency: 3, // Conservative concurrency for financial operations
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        stalledInterval: 60000, // 60 seconds for financial operations
        maxStalledCount: 2, // Lower threshold for payout jobs
      }
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job: Job) => {
      console.log(`✅ Payout job ${job.id} completed for market ${job.data.marketId}`);
    });

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      console.error(`❌ Payout job ${job?.id} failed:`, error);

      // All payout failures are critical
      if (job) {
        this.escalatePayoutFailure(job, error);
      }
    });

    this.worker.on('stalled', (jobId: string) => {
      console.warn(`⚠️ Payout job ${jobId} stalled - potential financial inconsistency`);
    });

    this.worker.on('error', (error: Error) => {
      console.error('❌ Payout processor error:', error);
    });
  }

  private async processJob(job: Job): Promise<void> {
    const startTime = Date.now();
    console.log(`💰 Processing payout job ${job.id}`);

    try {
      // Validate job payload
      const jobData = validatePayoutJob(job.data);

      // Critical idempotency check
      const existingPayout = await this.checkIdempotency(jobData.idempotencyKey);
      if (existingPayout) {
        console.log(`✅ Payout ${jobData.idempotencyKey} already processed - skipping duplicate`);
        return;
      }

      // Acquire distributed lock for this market's payouts
      const lockKey = `payout:lock:${jobData.marketId}`;
      const lockAcquired = await this.acquirePayoutLock(lockKey);

      if (!lockAcquired) {
        throw new Error(`Cannot acquire payout lock for market ${jobData.marketId} - concurrent payout in progress`);
      }

      try {
        // Process payouts using the existing prediction market system
        await this.processMarketPayouts(jobData, job);

        const duration = Date.now() - startTime;
        console.log(`✅ Payouts processed for market ${jobData.marketId} in ${duration}ms`);

      } finally {
        // Always release the lock
        await this.releasePayoutLock(lockKey);
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Payout processing failed after ${duration}ms:`, error);

      // Log detailed error for financial operations
      await this.logPayoutError(job, error as Error);

      throw error; // Re-throw for BullMQ retry handling
    }
  }

  private async checkIdempotency(idempotencyKey: string): Promise<boolean> {
    // Check Redis first for fast lookup
    const redisKey = `payout:processed:${idempotencyKey}`;
    const cached = await redis.get(redisKey);
    if (cached) {
      return true;
    }

    // Check database for persistent record
    const existing = await prisma.payout.findUnique({
      where: { idempotencyKey },
      select: { id: true, processedAt: true }
    });

    if (existing) {
      // Cache the result for future checks
      await redis.setex(redisKey, 3600, JSON.stringify({
        processed: true,
        timestamp: existing.processedAt?.getTime(),
      }));
      return true;
    }

    return false;
  }

  private async acquirePayoutLock(lockKey: string): Promise<boolean> {
    const lockValue = `${Date.now()}_${Math.random()}`;
    const result = await redis.set(lockKey, lockValue, 'PX', 300000, 'NX'); // 5 minute lock
    return result === 'OK';
  }

  private async releasePayoutLock(lockKey: string): Promise<void> {
    await redis.del(lockKey);
  }

  private async processMarketPayouts(
    jobData: PayoutJobData,
    job: Job
  ): Promise<void> {
    // Use existing transaction wrapper for financial operations
    await prisma.$transaction(async (tx) => {
      // Verify market exists and is ready for payouts
      const market = await tx.predictionMarket.findUnique({
        where: { id: jobData.marketId },
        include: {
          participations: true
        }
      });

      if (!market) {
        throw new Error(`Market ${jobData.marketId} not found`);
      }

      if (market.status !== 'RESOLVED') {
        throw new Error(`Market ${jobData.marketId} is not resolved - cannot process payouts`);
      }

      // Create idempotency record first
      await tx.payout.create({
        data: {
          id: `payout_${jobData.marketId}_${Date.now()}`,
          marketId: jobData.marketId,
          idempotencyKey: jobData.idempotencyKey,
          totalAmount: jobData.totalPool,
          winningShares: jobData.winningShares,
          status: 'PROCESSING',
          processedAt: new Date(),
          metadata: jobData.metadata as any,
        }
      });

      // Extract winning outcome from resolved market
      const outcome = market.outcome; // 'YES' or 'NO'
      if (!outcome) {
        throw new Error(`Market ${jobData.marketId} has no outcome - cannot process payouts`);
      }

      // Use existing resolveMarket function for payout calculations
      // Note: This function handles the parimutuel calculations and balance updates
      const marketService = new PredictionMarketService();
      const result = await marketService.resolveMarket(jobData.marketId, outcome as 'YES' | 'NO' | 'CANCEL');

      if (!result.success) {
        throw new Error(`Failed to process payouts for market ${jobData.marketId}`);
      }

      // Update payout record as completed
      const payoutCount = result.payouts?.length || 0;
      const totalProcessed = result.payouts?.reduce((sum: number, p: any) => sum + p.amount, 0) || 0;

      await tx.payout.update({
        where: { idempotencyKey: jobData.idempotencyKey },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          payoutCount: payoutCount,
          actualTotal: totalProcessed.toString(),
        }
      });

      console.log(`💰 Processed ${payoutCount} payouts totaling ${totalProcessed} tokens`);

      // Queue Discord notifications for winners via outbox
      if (result.payouts && result.payouts.length > 0) {
        await this.queuePayoutNotificationsViaOutbox(tx, market, result.payouts);
      }

      // Cache successful processing
      await redis.setex(
        `payout:processed:${jobData.idempotencyKey}`,
        86400, // 24 hours
        JSON.stringify({
          processed: true,
          timestamp: Date.now(),
          totalAmount: totalProcessed.toString(),
          payoutCount: payoutCount,
        })
      );
    }, {
      maxWait: 30000, // 30 seconds
      timeout: 120000, // 2 minutes for complex payouts
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
  }

  private async queuePayoutNotificationsViaOutbox(
    tx: Prisma.TransactionClient,
    market: any,
    payouts: Array<{ userId: string; amount: number }>
  ): Promise<void> {
    // Import helper to avoid circular dependencies
    const { queuePayoutNotification } = await import('../../services/outbox/outbox_helpers.js');

    // Queue notification for each successful payout using outbox pattern
    for (const payout of payouts) {
      await queuePayoutNotification(tx, payout.userId, {
        amount: payout.amount.toString(),
        marketId: market.id,
        marketTitle: market.title,
      });
    }

    console.log(`📨 Queued ${payouts.length} payout notifications via outbox`);
  }

  private async escalatePayoutFailure(job: Job, error: Error): Promise<void> {
    console.error(`🚨 CRITICAL PAYOUT FAILURE: Requires immediate financial review`);
    console.error(`Job ID: ${job.id}, Market ID: ${job.data.marketId}`);
    console.error(`Error: ${error.message}`);

    // Add to dead letter queue with high priority
    const { deadLetterQueue } = await import('../config.js');
    const { createDeadLetterJob } = await import('../types.js');

    const deadLetterData = createDeadLetterJob({
      originalQueue: 'payouts',
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
        canRetry: false, // Manual review required for financial operations
        requiresManualReview: true,
        escalationLevel: 'critical',
        estimatedResolution: 'immediate - financial integrity at risk',
      }
    });

    await deadLetterQueue.add('payout-failure', deadLetterData, {
      priority: 1, // Highest priority
      removeOnComplete: false,
      removeOnFail: false,
    });

    // Lock the market to prevent further operations
    await redis.setex(
      `market:locked:${job.data.marketId}`,
      3600, // 1 hour
      JSON.stringify({
        reason: 'payout_failure',
        timestamp: Date.now(),
        jobId: job.id,
      })
    );
  }

  private async logPayoutError(job: Job, error: Error): Promise<void> {
    const errorContext = {
      jobId: job.id,
      marketId: job.data.marketId,
      idempotencyKey: job.data.idempotencyKey,
      attempt: job.attemptsMade,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.constructor.name,
      },
      timestamp: new Date().toISOString(),
      payoutData: {
        totalPool: job.data.totalPool,
        winningShares: job.data.winningShares,
        payoutCount: job.data.payouts.length,
      },
    };

    // Store error context for financial audit
    await redis.setex(
      `payout:error:${job.data.marketId}:${job.id}`,
      172800, // 48 hours for financial errors
      JSON.stringify(errorContext)
    );

    console.error('📝 Payout error context stored for audit:', errorContext);
  }

  public async close(): Promise<void> {
    await this.worker.close();
    console.log('✅ Payout processor closed');
  }

  public async pause(): Promise<void> {
    await this.worker.pause();
    console.log('⏸️ Payout processor paused');
  }

  public async resume(): Promise<void> {
    await this.worker.resume();
    console.log('▶️ Payout processor resumed');
  }

  public getStatus() {
    return {
      isRunning: this.worker.isRunning(),
      isPaused: this.worker.isPaused(),
      concurrency: 3,
    };
  }
}

// Export singleton instance
export const payoutProcessor = new PayoutProcessor();

console.log('🚀 Payout processor initialized for PredictionMarket system');