import { Worker } from "bullmq";
import { redis } from "../config.js";
import { validateDeadLetterJob } from "../types.js";
import { prisma } from "../../services/db.js";
class DeadLetterWorker {
  worker;
  constructor() {
    this.worker = new Worker(
      "dead-letter",
      this.processJob.bind(this),
      {
        connection: redis,
        concurrency: 1,
        // Process DLQ items sequentially for careful handling
        removeOnComplete: { count: 0 },
        // Never remove completed DLQ jobs
        removeOnFail: { count: 0 },
        // Never remove failed DLQ jobs
        stalledInterval: 12e4,
        // 2 minutes - longer for manual review items
        maxStalledCount: 1
        // Very conservative
      }
    );
    this.setupEventHandlers();
  }
  setupEventHandlers() {
    this.worker.on("completed", (job) => {
      console.log(`\u2705 Dead letter job ${job.id} processed successfully`);
    });
    this.worker.on("failed", (job, error) => {
      console.error(`\u274C Dead letter job ${job?.id} failed processing:`, error);
    });
    this.worker.on("stalled", (jobId) => {
      console.warn(`\u26A0\uFE0F Dead letter job ${jobId} stalled - may need admin intervention`);
    });
    this.worker.on("error", (error) => {
      console.error("\u274C Dead letter worker error:", error);
    });
  }
  async processJob(job) {
    console.log(`\u{1F6A8} Processing dead letter job ${job.id}`);
    try {
      const jobData = validateDeadLetterJob(job.data);
      await this.storeDeadLetterRecord(jobData, job);
      await this.logCriticalFailure(jobData);
      if (jobData.metadata.canRetry && !jobData.metadata.requiresManualReview) {
        await this.attemptAutomaticRetry(jobData);
      } else {
        console.log(`\u26A0\uFE0F Job ${job.id} requires manual review - stored for admin interface`);
      }
    } catch (error) {
      console.error(`\u274C Dead letter processing failed for job ${job.id}:`, error);
    }
  }
  async storeDeadLetterRecord(jobData, job) {
    await prisma.deadLetterJob.create({
      data: {
        id: `dlq_${job.id}_${Date.now()}`,
        originalQueue: jobData.originalQueue,
        originalJobId: jobData.originalJobId,
        originalPayload: jobData.originalPayload,
        failureReason: jobData.failureReason,
        attempts: jobData.attempts,
        lastError: jobData.lastError,
        canRetry: jobData.metadata.canRetry,
        requiresManualReview: jobData.metadata.requiresManualReview,
        escalationLevel: jobData.metadata.escalationLevel,
        estimatedResolution: jobData.metadata.estimatedResolution,
        status: "PENDING",
        createdAt: /* @__PURE__ */ new Date()
      }
    });
    const redisKey = `dlq:job:${job.id}`;
    await redis.setex(redisKey, 604800, JSON.stringify({
      // 7 days
      ...jobData,
      dlqJobId: job.id,
      timestamp: Date.now(),
      status: "PENDING"
    }));
    console.log(`\u{1F4DD} Dead letter record stored for job ${job.id} from ${jobData.originalQueue}`);
  }
  async logCriticalFailure(jobData) {
    const alertData = {
      level: jobData.metadata.escalationLevel,
      queue: jobData.originalQueue,
      jobId: jobData.originalJobId,
      reason: jobData.failureReason,
      attempts: jobData.attempts,
      canRetry: jobData.metadata.canRetry,
      requiresManualReview: jobData.metadata.requiresManualReview,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    await redis.setex(
      `alert:dlq:${jobData.originalQueue}:${Date.now()}`,
      86400,
      // 24 hours
      JSON.stringify(alertData)
    );
    if (jobData.metadata.escalationLevel === "critical") {
      console.error(`\u{1F6A8} CRITICAL FAILURE ALERT:`, alertData);
    }
  }
  async attemptAutomaticRetry(jobData) {
    if (!jobData.metadata.canRetry) {
      return;
    }
    const retryDelay = Math.min(3e5, 5e3 * Math.pow(2, jobData.attempts));
    try {
      const targetQueue = await this.getTargetQueue(jobData.originalQueue);
      if (targetQueue) {
        await targetQueue.add(
          `retry_${jobData.originalJobId}`,
          {
            ...jobData.originalPayload,
            _retryAttempt: (jobData.originalPayload._retryAttempt || 0) + 1,
            _fromDeadLetter: true,
            _dlqJobId: jobData.originalJobId
          },
          {
            delay: retryDelay,
            attempts: 1,
            // Only one attempt from DLQ
            removeOnComplete: 50,
            removeOnFail: 25
          }
        );
        console.log(`\u{1F504} Automatic retry queued for ${jobData.originalQueue} job ${jobData.originalJobId} with ${retryDelay}ms delay`);
        await this.updateDeadLetterStatus(jobData.originalJobId, "RETRIED");
      }
    } catch (error) {
      console.error(`Failed to automatically retry job ${jobData.originalJobId}:`, error);
    }
  }
  async getTargetQueue(queueName) {
    const {
      marketResolutionQueue,
      payoutQueue,
      reconciliationQueue,
      discordOutboxQueue
    } = await import("../config.js");
    const queueMap = {
      "market-resolution": marketResolutionQueue,
      "payouts": payoutQueue,
      "reconciliation": reconciliationQueue,
      "discord-outbox": discordOutboxQueue
    };
    return queueMap[queueName];
  }
  async updateDeadLetterStatus(originalJobId, status) {
    try {
      await prisma.deadLetterJob.updateMany({
        where: { originalJobId },
        data: {
          status,
          updatedAt: /* @__PURE__ */ new Date()
        }
      });
      const keys = await redis.keys(`dlq:job:*`);
      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const jobData = JSON.parse(data);
          if (jobData.originalJobId === originalJobId) {
            jobData.status = status;
            jobData.updatedAt = Date.now();
            await redis.setex(key, 604800, JSON.stringify(jobData));
            break;
          }
        }
      }
    } catch (error) {
      console.error("Failed to update dead letter status:", error);
    }
  }
  // Admin interface methods
  async getDeadLetterJobs(limit = 50, offset = 0) {
    const jobs = await prisma.deadLetterJob.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset
    });
    return jobs;
  }
  async getDeadLetterJobById(id) {
    return await prisma.deadLetterJob.findUnique({
      where: { id }
    });
  }
  async retryDeadLetterJob(id, adminUserId) {
    try {
      const dlqJob = await prisma.deadLetterJob.findUnique({
        where: { id }
      });
      if (!dlqJob) {
        console.error(`Dead letter job ${id} not found`);
        return false;
      }
      if (dlqJob.status !== "PENDING") {
        console.error(`Dead letter job ${id} is not in PENDING status`);
        return false;
      }
      const targetQueue = await this.getTargetQueue(dlqJob.originalQueue);
      if (!targetQueue) {
        console.error(`Target queue ${dlqJob.originalQueue} not found`);
        return false;
      }
      await targetQueue.add(
        `manual_retry_${dlqJob.originalJobId}_${Date.now()}`,
        {
          ...dlqJob.originalPayload || {},
          _manualRetry: true,
          _adminUserId: adminUserId,
          _dlqJobId: id
        },
        {
          attempts: 3,
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 25 }
        }
      );
      await prisma.deadLetterJob.update({
        where: { id },
        data: {
          status: "RETRIED",
          updatedAt: /* @__PURE__ */ new Date(),
          reviewedBy: adminUserId
        }
      });
      console.log(`\u2705 Manual retry initiated for dead letter job ${id} by admin ${adminUserId}`);
      return true;
    } catch (error) {
      console.error(`Failed to retry dead letter job ${id}:`, error);
      return false;
    }
  }
  async dismissDeadLetterJob(id, adminUserId, reason) {
    try {
      await prisma.deadLetterJob.update({
        where: { id },
        data: {
          status: "DISMISSED",
          updatedAt: /* @__PURE__ */ new Date(),
          reviewedBy: adminUserId,
          dismissalReason: reason
        }
      });
      console.log(`\u2705 Dead letter job ${id} dismissed by admin ${adminUserId}: ${reason}`);
      return true;
    } catch (error) {
      console.error(`Failed to dismiss dead letter job ${id}:`, error);
      return false;
    }
  }
  async getDeadLetterStats() {
    const stats = await prisma.deadLetterJob.groupBy({
      by: ["status", "escalationLevel", "originalQueue"],
      _count: {
        id: true
      }
    });
    const recentFailures = await prisma.deadLetterJob.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 864e5)
          // Last 24 hours
        }
      }
    });
    return {
      groupedStats: stats,
      recentFailures24h: recentFailures,
      totalPending: stats.filter((s) => s.status === "PENDING").reduce((sum, s) => sum + s._count.id, 0)
    };
  }
  async close() {
    await this.worker.close();
    console.log("\u2705 Dead letter worker closed");
  }
  async pause() {
    await this.worker.pause();
    console.log("\u23F8\uFE0F Dead letter worker paused");
  }
  async resume() {
    await this.worker.resume();
    console.log("\u25B6\uFE0F Dead letter worker resumed");
  }
  getStatus() {
    return {
      isRunning: this.worker.isRunning(),
      isPaused: this.worker.isPaused(),
      concurrency: 1
    };
  }
}
const deadLetterWorker = new DeadLetterWorker();
console.log("\u{1F680} Dead letter queue worker initialized with manual retry interface");
export {
  DeadLetterWorker,
  deadLetterWorker
};
//# sourceMappingURL=dead_letter_queue.js.map
