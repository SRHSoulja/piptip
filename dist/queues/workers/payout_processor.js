import { Worker } from "bullmq";
import { redis } from "../config.js";
import { validatePayoutJob } from "../types.js";
import { prisma } from "../../services/db.js";
import { Prisma } from "@prisma/client";
import { PredictionMarketService } from "../../services/prediction_markets.js";
class PayoutProcessor {
  worker;
  constructor() {
    this.worker = new Worker(
      "payouts",
      this.processJob.bind(this),
      {
        connection: redis,
        concurrency: 3,
        // Conservative concurrency for financial operations
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        stalledInterval: 6e4,
        // 60 seconds for financial operations
        maxStalledCount: 2
        // Lower threshold for payout jobs
      }
    );
    this.setupEventHandlers();
  }
  setupEventHandlers() {
    this.worker.on("completed", (job) => {
      console.log(`\u2705 Payout job ${job.id} completed for market ${job.data.marketId}`);
    });
    this.worker.on("failed", (job, error) => {
      console.error(`\u274C Payout job ${job?.id} failed:`, error);
      if (job) {
        this.escalatePayoutFailure(job, error);
      }
    });
    this.worker.on("stalled", (jobId) => {
      console.warn(`\u26A0\uFE0F Payout job ${jobId} stalled - potential financial inconsistency`);
    });
    this.worker.on("error", (error) => {
      console.error("\u274C Payout processor error:", error);
    });
  }
  async processJob(job) {
    const startTime = Date.now();
    console.log(`\u{1F4B0} Processing payout job ${job.id}`);
    try {
      const jobData = validatePayoutJob(job.data);
      const existingPayout = await this.checkIdempotency(jobData.idempotencyKey);
      if (existingPayout) {
        console.log(`\u2705 Payout ${jobData.idempotencyKey} already processed - skipping duplicate`);
        return;
      }
      const lockKey = `payout:lock:${jobData.marketId}`;
      const lockAcquired = await this.acquirePayoutLock(lockKey);
      if (!lockAcquired) {
        throw new Error(`Cannot acquire payout lock for market ${jobData.marketId} - concurrent payout in progress`);
      }
      try {
        await this.processMarketPayouts(jobData, job);
        const duration = Date.now() - startTime;
        console.log(`\u2705 Payouts processed for market ${jobData.marketId} in ${duration}ms`);
      } finally {
        await this.releasePayoutLock(lockKey);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`\u274C Payout processing failed after ${duration}ms:`, error);
      await this.logPayoutError(job, error);
      throw error;
    }
  }
  async checkIdempotency(idempotencyKey) {
    const redisKey = `payout:processed:${idempotencyKey}`;
    const cached = await redis.get(redisKey);
    if (cached) {
      return true;
    }
    const existing = await prisma.payout.findUnique({
      where: { idempotencyKey },
      select: { id: true, processedAt: true }
    });
    if (existing) {
      await redis.setex(redisKey, 3600, JSON.stringify({
        processed: true,
        timestamp: existing.processedAt?.getTime()
      }));
      return true;
    }
    return false;
  }
  async acquirePayoutLock(lockKey) {
    const randomBytes = require("crypto").randomBytes(8);
    const lockValue = `${Date.now()}_${randomBytes.toString("hex")}`;
    const result = await redis.set(lockKey, lockValue, "PX", 3e5, "NX");
    return result === "OK";
  }
  async releasePayoutLock(lockKey) {
    await redis.del(lockKey);
  }
  async processMarketPayouts(jobData, job) {
    await prisma.$transaction(async (tx) => {
      const market = await tx.predictionMarket.findUnique({
        where: { id: jobData.marketId },
        include: {
          participations: true
        }
      });
      if (!market) {
        throw new Error(`Market ${jobData.marketId} not found`);
      }
      if (market.status !== "RESOLVED") {
        throw new Error(`Market ${jobData.marketId} is not resolved - cannot process payouts`);
      }
      await tx.payout.create({
        data: {
          id: `payout_${jobData.marketId}_${Date.now()}`,
          marketId: jobData.marketId,
          idempotencyKey: jobData.idempotencyKey,
          totalAmount: jobData.totalPool,
          winningShares: jobData.winningShares,
          status: "PROCESSING",
          processedAt: /* @__PURE__ */ new Date(),
          metadata: jobData.metadata
        }
      });
      const outcome = market.outcome;
      if (!outcome) {
        throw new Error(`Market ${jobData.marketId} has no outcome - cannot process payouts`);
      }
      const marketService = new PredictionMarketService();
      const result = await marketService.resolveMarket(jobData.marketId, outcome);
      if (!result.success) {
        throw new Error(`Failed to process payouts for market ${jobData.marketId}`);
      }
      const payoutCount = result.payouts?.length || 0;
      const totalProcessed = result.payouts?.reduce((sum, p) => sum + p.amount, 0) || 0;
      await tx.payout.update({
        where: { idempotencyKey: jobData.idempotencyKey },
        data: {
          status: "COMPLETED",
          completedAt: /* @__PURE__ */ new Date(),
          payoutCount,
          actualTotal: totalProcessed.toString()
        }
      });
      console.log(`\u{1F4B0} Processed ${payoutCount} payouts totaling ${totalProcessed} tokens`);
      if (result.payouts && result.payouts.length > 0) {
        await this.queuePayoutNotificationsViaOutbox(tx, market, result.payouts);
      }
      await redis.setex(
        `payout:processed:${jobData.idempotencyKey}`,
        86400,
        // 24 hours
        JSON.stringify({
          processed: true,
          timestamp: Date.now(),
          totalAmount: totalProcessed.toString(),
          payoutCount
        })
      );
    }, {
      maxWait: 3e4,
      // 30 seconds
      timeout: 12e4,
      // 2 minutes for complex payouts
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
  }
  async queuePayoutNotificationsViaOutbox(tx, market, payouts) {
    const { queuePayoutNotification } = await import("../../services/outbox/outbox_helpers.js");
    for (const payout of payouts) {
      await queuePayoutNotification(tx, payout.userId, {
        amount: payout.amount.toString(),
        marketId: market.id,
        marketTitle: market.title
      });
    }
    console.log(`\u{1F4E8} Queued ${payouts.length} payout notifications via outbox`);
  }
  async escalatePayoutFailure(job, error) {
    console.error(`\u{1F6A8} CRITICAL PAYOUT FAILURE: Requires immediate financial review`);
    console.error(`Job ID: ${job.id}, Market ID: ${job.data.marketId}`);
    console.error(`Error: ${error.message}`);
    const { deadLetterQueue } = await import("../config.js");
    const { createDeadLetterJob } = await import("../types.js");
    const deadLetterData = createDeadLetterJob({
      originalQueue: "payouts",
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
        canRetry: false,
        // Manual review required for financial operations
        requiresManualReview: true,
        escalationLevel: "critical",
        estimatedResolution: "immediate - financial integrity at risk"
      }
    });
    await deadLetterQueue.add("payout-failure", deadLetterData, {
      priority: 1,
      // Highest priority
      removeOnComplete: false,
      removeOnFail: false
    });
    await redis.setex(
      `market:locked:${job.data.marketId}`,
      3600,
      // 1 hour
      JSON.stringify({
        reason: "payout_failure",
        timestamp: Date.now(),
        jobId: job.id
      })
    );
  }
  async logPayoutError(job, error) {
    const errorContext = {
      jobId: job.id,
      marketId: job.data.marketId,
      idempotencyKey: job.data.idempotencyKey,
      attempt: job.attemptsMade,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.constructor.name
      },
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      payoutData: {
        totalPool: job.data.totalPool,
        winningShares: job.data.winningShares,
        payoutCount: job.data.payouts.length
      }
    };
    await redis.setex(
      `payout:error:${job.data.marketId}:${job.id}`,
      172800,
      // 48 hours for financial errors
      JSON.stringify(errorContext)
    );
    console.error("\u{1F4DD} Payout error context stored for audit:", errorContext);
  }
  async close() {
    await this.worker.close();
    console.log("\u2705 Payout processor closed");
  }
  async pause() {
    await this.worker.pause();
    console.log("\u23F8\uFE0F Payout processor paused");
  }
  async resume() {
    await this.worker.resume();
    console.log("\u25B6\uFE0F Payout processor resumed");
  }
  getStatus() {
    return {
      isRunning: this.worker.isRunning(),
      isPaused: this.worker.isPaused(),
      concurrency: 3
    };
  }
}
const payoutProcessor = new PayoutProcessor();
console.log("\u{1F680} Payout processor initialized for PredictionMarket system");
export {
  PayoutProcessor,
  payoutProcessor
};
//# sourceMappingURL=payout_processor.js.map
