import { Worker } from "bullmq";
import { redis } from "../config.js";
import { validateMarketResolutionJob } from "../types.js";
import { prisma } from "../../services/db.js";
import { priceAPI } from "../../services/price_api.js";
import { Prisma } from "@prisma/client";
class MarketResolutionWorker {
  worker;
  constructor() {
    this.worker = new Worker(
      "market-resolution",
      this.processJob.bind(this),
      {
        connection: redis,
        concurrency: 5,
        // Process up to 5 resolutions simultaneously
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        stalledInterval: 3e4,
        // 30 seconds
        maxStalledCount: 3
      }
    );
    this.setupEventHandlers();
  }
  setupEventHandlers() {
    this.worker.on("completed", (job) => {
      console.log(`\u2705 Market resolution job ${job.id} completed for market ${job.data.marketId}`);
    });
    this.worker.on("failed", (job, error) => {
      console.error(`\u274C Market resolution job ${job?.id} failed:`, error);
      if (job && this.isCriticalFailure(error)) {
        this.escalateFailure(job, error);
      }
    });
    this.worker.on("stalled", (jobId) => {
      console.warn(`\u26A0\uFE0F Market resolution job ${jobId} stalled - may need manual intervention`);
    });
    this.worker.on("error", (error) => {
      console.error("\u274C Market resolution worker error:", error);
    });
  }
  async processJob(job) {
    const startTime = Date.now();
    console.log(`\u{1F504} Processing market resolution job ${job.id}`);
    try {
      const jobData = validateMarketResolutionJob(job.data);
      const existingResolution = await this.checkExistingResolution(jobData.marketId, jobData);
      if (existingResolution) {
        console.log(`\u2705 Market ${jobData.marketId} already resolved - skipping duplicate`);
        return;
      }
      await prisma.$transaction(async (tx) => {
        await this.resolveMarket(tx, jobData, job);
      }, {
        maxWait: 1e4,
        // 10 seconds
        timeout: 3e4,
        // 30 seconds
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
      const duration = Date.now() - startTime;
      console.log(`\u2705 Market ${jobData.marketId} resolved successfully in ${duration}ms`);
      await this.queuePayoutProcessing(jobData);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`\u274C Market resolution failed after ${duration}ms:`, error);
      await this.logResolutionError(job, error);
      throw error;
    }
  }
  async checkExistingResolution(marketId, jobData) {
    const existing = await prisma.predictionMarket.findUnique({
      where: { id: marketId },
      select: {
        status: true,
        resolvedAt: true,
        outcome: true,
        resolvedBy: true
      }
    });
    if (!existing) {
      throw new Error(`Market ${marketId} not found`);
    }
    if (existing.status === "RESOLVED" && existing.resolvedAt) {
      return true;
    }
    const recentResolution = await redis.get(`market:resolving:${marketId}`);
    if (recentResolution) {
      const data = JSON.parse(recentResolution);
      const timeDiff = Date.now() - data.timestamp;
      if (timeDiff > 3e5) {
        await redis.del(`market:resolving:${marketId}`);
        return false;
      }
      return true;
    }
    await redis.setex(
      `market:resolving:${marketId}`,
      300,
      // 5 minutes
      JSON.stringify({
        jobId: jobData.id,
        timestamp: Date.now(),
        resolvedBy: jobData.resolvedBy
      })
    );
    return false;
  }
  async resolveMarket(tx, jobData, job) {
    const market = await tx.predictionMarket.findUnique({
      where: { id: jobData.marketId },
      include: {
        participations: true
      }
    });
    if (!market) {
      throw new Error(`Market ${jobData.marketId} not found`);
    }
    if (market.status === "RESOLVED") {
      console.log(`Market ${jobData.marketId} already resolved`);
      return;
    }
    if (jobData.outcome.winningOption < 0 || jobData.outcome.winningOption >= market.marketOutcomes.length) {
      throw new Error(`Invalid winning option ${jobData.outcome.winningOption} for market with ${market.marketOutcomes.length} options`);
    }
    let resolutionPrice = jobData.outcome.price;
    if (jobData.resolutionType === "automated" && !resolutionPrice) {
      try {
        const tokenData = await priceAPI.getTokenPrices([market.tokenSymbol]);
        if (tokenData.success && tokenData.prices[market.tokenSymbol]) {
          resolutionPrice = tokenData.prices[market.tokenSymbol];
        } else {
          throw new Error(`No price data for ${market.tokenSymbol}`);
        }
        console.log(`\u{1F4CA} Resolved ${market.tokenSymbol} price: $${resolutionPrice}`);
      } catch (error) {
        console.error(`Failed to get price for ${market.tokenSymbol}:`, error);
        if (market.marketType === "PRICE_ABOVE_BELOW") {
          throw new Error(`Cannot resolve price market without current price data: ${error}`);
        }
      }
    }
    const totalPool = market.participations.reduce((sum, p) => sum + BigInt(p.amount), 0n);
    const winningParticipations = market.participations.filter((p) => p.side === market.marketOutcomes[jobData.outcome.winningOption]);
    const winningShares = winningParticipations.reduce((sum, p) => sum + BigInt(p.amount), 0n);
    await tx.predictionMarket.update({
      where: { id: jobData.marketId },
      data: {
        status: "RESOLVED",
        resolvedAt: /* @__PURE__ */ new Date(),
        outcome: market.marketOutcomes[jobData.outcome.winningOption],
        resolvedBy: jobData.resolvedBy
      }
    });
    console.log(`Market resolution complete - ${winningParticipations.length} winning participations out of ${market.participations.length} total`);
    console.log(`\u{1F4CA} Market ${jobData.marketId} resolved: Option ${jobData.outcome.winningOption} won with ${winningShares.toString()} shares out of ${totalPool.toString()} total pool`);
    await redis.del(`market:resolving:${jobData.marketId}`);
  }
  async queuePayoutProcessing(jobData) {
    const { payoutQueue } = await import("../config.js");
    const { createPayoutJob } = await import("../types.js");
    const market = await prisma.predictionMarket.findUnique({
      where: { id: jobData.marketId },
      include: {
        participations: true
      }
    });
    if (!market || market.status !== "RESOLVED") {
      throw new Error(`Cannot queue payouts for unresolved market ${jobData.marketId}`);
    }
    const totalPool = market.participations.reduce((sum, p) => sum + BigInt(p.amount), 0n);
    const winningParticipations = market.participations.filter((p) => p.side === market.outcome);
    const winningShares = winningParticipations.reduce((sum, p) => sum + BigInt(p.amount), 0n);
    const payoutJobData = createPayoutJob({
      marketId: market.id,
      resolutionId: `resolution_${market.id}_${Date.now()}`,
      totalPool: totalPool.toString(),
      winningShares: winningShares.toString(),
      payouts: winningParticipations.map((pred) => ({
        userId: pred.userId,
        amount: pred.amount.toString(),
        shares: pred.amount.toString(),
        tokenId: "1"
        // Use a default token ID or get from market context
      })),
      idempotencyKey: `payout_${market.id}_${market.resolvedAt?.getTime()}`,
      metadata: {
        feeAmount: "0",
        // Calculate platform fee if applicable
        treasuryShare: "0",
        timestamp: Date.now()
      }
    });
    await payoutQueue.add(
      "process-payouts",
      payoutJobData,
      {
        priority: 1,
        // High priority
        delay: 1e3,
        // Small delay to ensure resolution is committed
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 }
      }
    );
    console.log(`\u{1F4B0} Payout job queued for market ${jobData.marketId} with ${winningParticipations.length} winners`);
  }
  isCriticalFailure(error) {
    const criticalPatterns = [
      /database.*connection/i,
      /transaction.*deadlock/i,
      /constraint.*violation/i,
      /market.*not.*found/i,
      /duplicate.*resolution/i
    ];
    return criticalPatterns.some((pattern) => pattern.test(error.message));
  }
  async escalateFailure(job, error) {
    console.error(`\u{1F6A8} CRITICAL: Market resolution failure requires immediate attention`);
    console.error(`Job ID: ${job.id}, Market ID: ${job.data.marketId}`);
    console.error(`Error: ${error.message}`);
    const { deadLetterQueue } = await import("../config.js");
    const { createDeadLetterJob } = await import("../types.js");
    const deadLetterData = createDeadLetterJob({
      originalQueue: "market-resolution",
      originalJobId: job.id || "unknown",
      originalPayload: job.data,
      failureReason: error.message,
      attempts: job.attemptsMade || 0,
      lastError: {
        message: error.message,
        stack: error.stack || "",
        timestamp: Date.now()
      },
      metadata: {
        canRetry: !this.isCriticalFailure(error),
        requiresManualReview: true,
        escalationLevel: "critical",
        estimatedResolution: "immediate"
      }
    });
    await deadLetterQueue.add("critical-failure", deadLetterData, {
      priority: 1,
      removeOnComplete: false,
      // Keep for audit
      removeOnFail: false
    });
  }
  async logResolutionError(job, error) {
    const errorContext = {
      jobId: job.id,
      marketId: job.data.marketId,
      attempt: job.attemptsMade,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.constructor.name
      },
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      jobData: job.data
    };
    await redis.setex(
      `market:resolution:error:${job.data.marketId}:${job.id}`,
      86400,
      // 24 hours
      JSON.stringify(errorContext)
    );
    console.error("\u{1F4DD} Market resolution error context stored:", errorContext);
  }
  async close() {
    await this.worker.close();
    console.log("\u2705 Market resolution worker closed");
  }
  async pause() {
    await this.worker.pause();
    console.log("\u23F8\uFE0F Market resolution worker paused");
  }
  async resume() {
    await this.worker.resume();
    console.log("\u25B6\uFE0F Market resolution worker resumed");
  }
  // Health check method
  getStatus() {
    return {
      isRunning: this.worker.isRunning(),
      isPaused: this.worker.isPaused(),
      concurrency: 5
    };
  }
}
const marketResolutionWorker = new MarketResolutionWorker();
console.log("\u{1F680} Market resolution worker initialized with retry logic and error handling");
export {
  MarketResolutionWorker,
  marketResolutionWorker
};
//# sourceMappingURL=market_resolution.js.map
