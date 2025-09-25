// src/queues/workers/market_resolution.ts - Market resolution worker with comprehensive retry logic
import { Worker, Job } from 'bullmq';
import { redis, marketResolutionQueue } from '../config.js';
import { MarketResolutionJobData, validateMarketResolutionJob, JobStatus } from '../types.js';
import { prisma } from '../../services/db.js';
import { priceAPI } from '../../services/price_api.js';
import { Prisma } from '@prisma/client';
import { logJobProcessing, logMarketOperation, createLogger } from '../../utils/logger.js';

export class MarketResolutionWorker {
  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      'market-resolution',
      this.processJob.bind(this),
      {
        connection: redis,
        concurrency: 5, // Process up to 5 resolutions simultaneously
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        stalledInterval: 30000, // 30 seconds
        maxStalledCount: 3,
      }
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job: Job) => {
      console.log(`✅ Market resolution job ${job.id} completed for market ${job.data.marketId}`);
    });

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      console.error(`❌ Market resolution job ${job?.id} failed:`, error);

      // Escalate critical failures
      if (job && this.isCriticalFailure(error)) {
        this.escalateFailure(job, error);
      }
    });

    this.worker.on('stalled', (jobId: string) => {
      console.warn(`⚠️ Market resolution job ${jobId} stalled - may need manual intervention`);
    });

    this.worker.on('error', (error: Error) => {
      console.error('❌ Market resolution worker error:', error);
    });
  }

  private async processJob(job: Job): Promise<void> {
    const startTime = Date.now();
    console.log(`🔄 Processing market resolution job ${job.id}`);

    try {
      // Validate job payload
      const jobData = validateMarketResolutionJob(job.data);

      // Check for duplicate processing (idempotency)
      const existingResolution = await this.checkExistingResolution(jobData.marketId, jobData);
      if (existingResolution) {
        console.log(`✅ Market ${jobData.marketId} already resolved - skipping duplicate`);
        return;
      }

      // Start database transaction for atomic resolution
      await prisma.$transaction(async (tx) => {
        await this.resolveMarket(tx, jobData, job);
      }, {
        maxWait: 10000, // 10 seconds
        timeout: 30000, // 30 seconds
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });

      const duration = Date.now() - startTime;
      console.log(`✅ Market ${jobData.marketId} resolved successfully in ${duration}ms`);

      // Queue payout processing
      await this.queuePayoutProcessing(jobData);

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Market resolution failed after ${duration}ms:`, error);

      // Enhanced error context for debugging
      await this.logResolutionError(job, error as Error);

      throw error; // Re-throw for BullMQ retry handling
    }
  }

  private async checkExistingResolution(
    marketId: string,
    jobData: MarketResolutionJobData
  ): Promise<boolean> {
    const existing = await prisma.predictionMarket.findUnique({
      where: { id: marketId },
      select: {
        status: true,
        resolvedAt: true,
        outcome: true,
        resolvedBy: true,
      }
    });

    if (!existing) {
      throw new Error(`Market ${marketId} not found`);
    }

    // Already resolved
    if (existing.status === 'RESOLVED' && existing.resolvedAt) {
      return true;
    }

    // Check for concurrent resolution attempts
    const recentResolution = await redis.get(`market:resolving:${marketId}`);
    if (recentResolution) {
      const data = JSON.parse(recentResolution);
      const timeDiff = Date.now() - data.timestamp;

      // If resolution started more than 5 minutes ago, allow retry
      if (timeDiff > 300000) {
        await redis.del(`market:resolving:${marketId}`);
        return false;
      }

      return true; // Another resolution in progress
    }

    // Mark as being resolved
    await redis.setex(
      `market:resolving:${marketId}`,
      300, // 5 minutes
      JSON.stringify({
        jobId: jobData.id,
        timestamp: Date.now(),
        resolvedBy: jobData.resolvedBy
      })
    );

    return false;
  }

  private async resolveMarket(
    tx: Prisma.TransactionClient,
    jobData: MarketResolutionJobData,
    job: Job
  ): Promise<void> {
    // Fetch market with related data
    const market = await tx.predictionMarket.findUnique({
      where: { id: jobData.marketId },
      include: {
        participations: true
      }
    });

    if (!market) {
      throw new Error(`Market ${jobData.marketId} not found`);
    }

    if (market.status === 'RESOLVED') {
      console.log(`Market ${jobData.marketId} already resolved`);
      return;
    }

    // Validate winning option against market outcomes
    if (jobData.outcome.winningOption < 0 || jobData.outcome.winningOption >= market.marketOutcomes.length) {
      throw new Error(`Invalid winning option ${jobData.outcome.winningOption} for market with ${market.marketOutcomes.length} options`);
    }

    // Get current token price for automated resolutions
    let resolutionPrice = jobData.outcome.price;
    if (jobData.resolutionType === 'automated' && !resolutionPrice) {
      try {
        const tokenData = await priceAPI.getTokenPrices([market.tokenSymbol]);
        if (tokenData.success && tokenData.prices[market.tokenSymbol]) {
          resolutionPrice = tokenData.prices[market.tokenSymbol];
        } else {
          throw new Error(`No price data for ${market.tokenSymbol}`);
        }
        console.log(`📊 Resolved ${market.tokenSymbol} price: $${resolutionPrice}`);
      } catch (error) {
        console.error(`Failed to get price for ${market.tokenSymbol}:`, error);

        // For price prediction markets, this is critical
        if (market.marketType === 'PRICE_ABOVE_BELOW') {
          throw new Error(`Cannot resolve price market without current price data: ${error}`);
        }
      }
    }

    // Calculate total pool and winning shares
    const totalPool = market.participations.reduce((sum: bigint, p: any) => sum + BigInt(p.amount), 0n);
    const winningParticipations = market.participations.filter((p: any) => p.side === market.marketOutcomes[jobData.outcome.winningOption]);
    const winningShares = winningParticipations.reduce((sum: bigint, p: any) => sum + BigInt(p.amount), 0n);

    // Update market status
    await tx.predictionMarket.update({
      where: { id: jobData.marketId },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        outcome: market.marketOutcomes[jobData.outcome.winningOption],
        resolvedBy: jobData.resolvedBy,
      }
    });

    // Note: PredictionParticipation doesn't have status/resolved fields in current schema
    // The resolution is tracked at the market level
    console.log(`Market resolution complete - ${winningParticipations.length} winning participations out of ${market.participations.length} total`);

    console.log(`📊 Market ${jobData.marketId} resolved: Option ${jobData.outcome.winningOption} won with ${winningShares.toString()} shares out of ${totalPool.toString()} total pool`);

    // Clean up resolution lock
    await redis.del(`market:resolving:${jobData.marketId}`);
  }

  private async queuePayoutProcessing(jobData: MarketResolutionJobData): Promise<void> {
    // Import here to avoid circular dependencies
    const { payoutQueue } = await import('../config.js');
    const { createPayoutJob } = await import('../types.js');

    // Fetch resolved market data for payout job
    const market = await prisma.predictionMarket.findUnique({
      where: { id: jobData.marketId },
      include: {
        participations: true
      }
    });

    if (!market || market.status !== 'RESOLVED') {
      throw new Error(`Cannot queue payouts for unresolved market ${jobData.marketId}`);
    }

    // Calculate totals from participations
    const totalPool = market.participations.reduce((sum: bigint, p: any) => sum + BigInt(p.amount), 0n);
    const winningParticipations = market.participations.filter((p: any) => p.side === market.outcome);
    const winningShares = winningParticipations.reduce((sum: bigint, p: any) => sum + BigInt(p.amount), 0n);

    const payoutJobData = createPayoutJob({
      marketId: market.id,
      resolutionId: `resolution_${market.id}_${Date.now()}`,
      totalPool: totalPool.toString(),
      winningShares: winningShares.toString(),
      payouts: winningParticipations.map((pred: any) => ({
        userId: pred.userId,
        amount: pred.amount.toString(),
        shares: pred.amount.toString(),
        tokenId: '1', // Use a default token ID or get from market context
      })),
      idempotencyKey: `payout_${market.id}_${market.resolvedAt?.getTime()}`,
      metadata: {
        feeAmount: '0', // Calculate platform fee if applicable
        treasuryShare: '0',
        timestamp: Date.now(),
      }
    });

    await payoutQueue.add(
      'process-payouts',
      payoutJobData,
      {
        priority: 1, // High priority
        delay: 1000, // Small delay to ensure resolution is committed
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      }
    );

    console.log(`💰 Payout job queued for market ${jobData.marketId} with ${winningParticipations.length} winners`);
  }

  private isCriticalFailure(error: Error): boolean {
    const criticalPatterns = [
      /database.*connection/i,
      /transaction.*deadlock/i,
      /constraint.*violation/i,
      /market.*not.*found/i,
      /duplicate.*resolution/i,
    ];

    return criticalPatterns.some(pattern => pattern.test(error.message));
  }

  private async escalateFailure(job: Job, error: Error): Promise<void> {
    console.error(`🚨 CRITICAL: Market resolution failure requires immediate attention`);
    console.error(`Job ID: ${job.id}, Market ID: ${job.data.marketId}`);
    console.error(`Error: ${error.message}`);

    // Add to dead letter queue for manual review
    const { deadLetterQueue } = await import('../config.js');
    const { createDeadLetterJob } = await import('../types.js');

    const deadLetterData = createDeadLetterJob({
      originalQueue: 'market-resolution',
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
        canRetry: !this.isCriticalFailure(error),
        requiresManualReview: true,
        escalationLevel: 'critical',
        estimatedResolution: 'immediate',
      }
    });

    await deadLetterQueue.add('critical-failure', deadLetterData, {
      priority: 1,
      removeOnComplete: false, // Keep for audit
      removeOnFail: false,
    });
  }

  private async logResolutionError(job: Job, error: Error): Promise<void> {
    const errorContext = {
      jobId: job.id,
      marketId: job.data.marketId,
      attempt: job.attemptsMade,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.constructor.name,
      },
      timestamp: new Date().toISOString(),
      jobData: job.data,
    };

    // Store error context in Redis for debugging
    await redis.setex(
      `market:resolution:error:${job.data.marketId}:${job.id}`,
      86400, // 24 hours
      JSON.stringify(errorContext)
    );

    console.error('📝 Market resolution error context stored:', errorContext);
  }

  public async close(): Promise<void> {
    await this.worker.close();
    console.log('✅ Market resolution worker closed');
  }

  public async pause(): Promise<void> {
    await this.worker.pause();
    console.log('⏸️ Market resolution worker paused');
  }

  public async resume(): Promise<void> {
    await this.worker.resume();
    console.log('▶️ Market resolution worker resumed');
  }

  // Health check method
  public getStatus() {
    return {
      isRunning: this.worker.isRunning(),
      isPaused: this.worker.isPaused(),
      concurrency: 5,
    };
  }
}

// Export singleton instance
export const marketResolutionWorker = new MarketResolutionWorker();

console.log('🚀 Market resolution worker initialized with retry logic and error handling');