// src/queues/workers/dead_letter_queue.ts - Dead letter queue processor with manual retry interface
import { Worker } from 'bullmq';
import { redis } from '../config.js';
import { validateDeadLetterJob } from '../types.js';
import { prisma } from '../../services/db.js';
export class DeadLetterWorker {
    worker;
    constructor() {
        this.worker = new Worker('dead-letter', this.processJob.bind(this), {
            connection: redis,
            concurrency: 1, // Process DLQ items sequentially for careful handling
            removeOnComplete: { count: 0 }, // Never remove completed DLQ jobs
            removeOnFail: { count: 0 }, // Never remove failed DLQ jobs
            stalledInterval: 120000, // 2 minutes - longer for manual review items
            maxStalledCount: 1, // Very conservative
        });
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.worker.on('completed', (job) => {
            console.log(`✅ Dead letter job ${job.id} processed successfully`);
        });
        this.worker.on('failed', (job, error) => {
            console.error(`❌ Dead letter job ${job?.id} failed processing:`, error);
            // DLQ failures are logged but not escalated further
        });
        this.worker.on('stalled', (jobId) => {
            console.warn(`⚠️ Dead letter job ${jobId} stalled - may need admin intervention`);
        });
        this.worker.on('error', (error) => {
            console.error('❌ Dead letter worker error:', error);
        });
    }
    async processJob(job) {
        console.log(`🚨 Processing dead letter job ${job.id}`);
        try {
            // Validate job payload
            const jobData = validateDeadLetterJob(job.data);
            // Store in persistent dead letter tracking
            await this.storeDeadLetterRecord(jobData, job);
            // Log critical failure for alerting
            await this.logCriticalFailure(jobData);
            // Check if automatic retry is possible
            if (jobData.metadata.canRetry && !jobData.metadata.requiresManualReview) {
                await this.attemptAutomaticRetry(jobData);
            }
            else {
                console.log(`⚠️ Job ${job.id} requires manual review - stored for admin interface`);
            }
        }
        catch (error) {
            console.error(`❌ Dead letter processing failed for job ${job.id}:`, error);
            // Don't re-throw - DLQ is the final destination
        }
    }
    async storeDeadLetterRecord(jobData, job) {
        // Create permanent record in database
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
                status: 'PENDING',
                createdAt: new Date(),
            }
        });
        // Store in Redis for fast admin interface access
        const redisKey = `dlq:job:${job.id}`;
        await redis.setex(redisKey, 604800, JSON.stringify({
            ...jobData,
            dlqJobId: job.id,
            timestamp: Date.now(),
            status: 'PENDING',
        }));
        console.log(`📝 Dead letter record stored for job ${job.id} from ${jobData.originalQueue}`);
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
            timestamp: new Date().toISOString(),
        };
        // Store alert for monitoring systems
        await redis.setex(`alert:dlq:${jobData.originalQueue}:${Date.now()}`, 86400, // 24 hours
        JSON.stringify(alertData));
        // Critical failures need immediate attention
        if (jobData.metadata.escalationLevel === 'critical') {
            console.error(`🚨 CRITICAL FAILURE ALERT:`, alertData);
            // Could integrate with external alerting here (PagerDuty, Slack, etc.)
            // await this.sendCriticalAlert(alertData);
        }
    }
    async attemptAutomaticRetry(jobData) {
        // Only retry if explicitly marked as safe
        if (!jobData.metadata.canRetry) {
            return;
        }
        // Apply exponential backoff for retries
        const retryDelay = Math.min(300000, 5000 * Math.pow(2, jobData.attempts)); // Max 5 minutes
        try {
            // Determine which queue to retry to
            const targetQueue = await this.getTargetQueue(jobData.originalQueue);
            if (targetQueue) {
                // Add back to original queue with retry markers
                await targetQueue.add(`retry_${jobData.originalJobId}`, {
                    ...jobData.originalPayload,
                    _retryAttempt: (jobData.originalPayload._retryAttempt || 0) + 1,
                    _fromDeadLetter: true,
                    _dlqJobId: jobData.originalJobId,
                }, {
                    delay: retryDelay,
                    attempts: 1, // Only one attempt from DLQ
                    removeOnComplete: 50,
                    removeOnFail: 25,
                });
                console.log(`🔄 Automatic retry queued for ${jobData.originalQueue} job ${jobData.originalJobId} with ${retryDelay}ms delay`);
                // Update DLQ status
                await this.updateDeadLetterStatus(jobData.originalJobId, 'RETRIED');
            }
        }
        catch (error) {
            console.error(`Failed to automatically retry job ${jobData.originalJobId}:`, error);
        }
    }
    async getTargetQueue(queueName) {
        const { marketResolutionQueue, payoutQueue, reconciliationQueue, discordOutboxQueue } = await import('../config.js');
        const queueMap = {
            'market-resolution': marketResolutionQueue,
            'payouts': payoutQueue,
            'reconciliation': reconciliationQueue,
            'discord-outbox': discordOutboxQueue,
        };
        return queueMap[queueName];
    }
    async updateDeadLetterStatus(originalJobId, status) {
        try {
            await prisma.deadLetterJob.updateMany({
                where: { originalJobId },
                data: {
                    status,
                    updatedAt: new Date(),
                }
            });
            // Update Redis cache
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
        }
        catch (error) {
            console.error('Failed to update dead letter status:', error);
        }
    }
    // Admin interface methods
    async getDeadLetterJobs(limit = 50, offset = 0) {
        const jobs = await prisma.deadLetterJob.findMany({
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
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
            if (dlqJob.status !== 'PENDING') {
                console.error(`Dead letter job ${id} is not in PENDING status`);
                return false;
            }
            // Attempt manual retry
            const targetQueue = await this.getTargetQueue(dlqJob.originalQueue);
            if (!targetQueue) {
                console.error(`Target queue ${dlqJob.originalQueue} not found`);
                return false;
            }
            await targetQueue.add(`manual_retry_${dlqJob.originalJobId}_${Date.now()}`, {
                ...(dlqJob.originalPayload || {}),
                _manualRetry: true,
                _adminUserId: adminUserId,
                _dlqJobId: id,
            }, {
                attempts: 3,
                removeOnComplete: { count: 50 },
                removeOnFail: { count: 25 },
            });
            // Update status
            await prisma.deadLetterJob.update({
                where: { id },
                data: {
                    status: 'RETRIED',
                    updatedAt: new Date(),
                    reviewedBy: adminUserId,
                }
            });
            console.log(`✅ Manual retry initiated for dead letter job ${id} by admin ${adminUserId}`);
            return true;
        }
        catch (error) {
            console.error(`Failed to retry dead letter job ${id}:`, error);
            return false;
        }
    }
    async dismissDeadLetterJob(id, adminUserId, reason) {
        try {
            await prisma.deadLetterJob.update({
                where: { id },
                data: {
                    status: 'DISMISSED',
                    updatedAt: new Date(),
                    reviewedBy: adminUserId,
                    dismissalReason: reason,
                }
            });
            console.log(`✅ Dead letter job ${id} dismissed by admin ${adminUserId}: ${reason}`);
            return true;
        }
        catch (error) {
            console.error(`Failed to dismiss dead letter job ${id}:`, error);
            return false;
        }
    }
    async getDeadLetterStats() {
        const stats = await prisma.deadLetterJob.groupBy({
            by: ['status', 'escalationLevel', 'originalQueue'],
            _count: {
                id: true
            }
        });
        // Get recent failure trends
        const recentFailures = await prisma.deadLetterJob.count({
            where: {
                createdAt: {
                    gte: new Date(Date.now() - 86400000) // Last 24 hours
                }
            }
        });
        return {
            groupedStats: stats,
            recentFailures24h: recentFailures,
            totalPending: stats.filter(s => s.status === 'PENDING').reduce((sum, s) => sum + s._count.id, 0),
        };
    }
    async close() {
        await this.worker.close();
        console.log('✅ Dead letter worker closed');
    }
    async pause() {
        await this.worker.pause();
        console.log('⏸️ Dead letter worker paused');
    }
    async resume() {
        await this.worker.resume();
        console.log('▶️ Dead letter worker resumed');
    }
    getStatus() {
        return {
            isRunning: this.worker.isRunning(),
            isPaused: this.worker.isPaused(),
            concurrency: 1,
        };
    }
}
// Export singleton instance
export const deadLetterWorker = new DeadLetterWorker();
console.log('🚀 Dead letter queue worker initialized with manual retry interface');
