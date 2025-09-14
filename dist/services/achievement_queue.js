// src/services/achievement_queue.ts - Background job queue for achievement processing
import { prisma } from './db.js';
import { checkTipAchievements, checkDepositAchievements, checkEngagementAchievements, updateStreak } from './streaks.js';
import { queueAchievementNotifications } from './notifications.js';
// In-memory job queue (for small scale - can be replaced with Redis queue later)
class AchievementJobQueue {
    jobs = [];
    processing = false;
    maxConcurrent = 3;
    activeJobs = 0;
    maxRetries = 3;
    retryDelay = 1000; // 1 second
    // Add job to queue
    enqueue(job) {
        const jobId = `${job.type}_${job.userId}_${Date.now()}`;
        const fullJob = {
            ...job,
            id: jobId,
            createdAt: new Date(),
            attempts: 0
        };
        // Insert job based on priority (higher priority first)
        const insertIndex = this.jobs.findIndex(j => j.priority < fullJob.priority);
        if (insertIndex === -1) {
            this.jobs.push(fullJob);
        }
        else {
            this.jobs.splice(insertIndex, 0, fullJob);
        }
        console.log(`Achievement job queued: ${jobId} (priority: ${job.priority})`);
        // Start processing if not already running
        if (!this.processing) {
            this.startProcessing();
        }
        return jobId;
    }
    // Start processing jobs
    async startProcessing() {
        if (this.processing)
            return;
        this.processing = true;
        console.log('Started achievement job processing');
        while (this.jobs.length > 0 || this.activeJobs > 0) {
            // Process jobs concurrently up to maxConcurrent
            while (this.activeJobs < this.maxConcurrent && this.jobs.length > 0) {
                const job = this.jobs.shift();
                if (job) {
                    this.activeJobs++;
                    this.processJob(job).finally(() => {
                        this.activeJobs--;
                    });
                }
            }
            // Wait a bit before checking for more jobs
            if (this.jobs.length === 0 && this.activeJobs === 0) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        this.processing = false;
        console.log('Achievement job processing completed');
    }
    // Process individual job
    async processJob(job) {
        console.log(`Processing achievement job: ${job.id} (attempt ${job.attempts + 1})`);
        try {
            job.attempts++;
            let achievements = [];
            switch (job.type) {
                case 'tip':
                    achievements = await this.processTipAchievements(job);
                    break;
                case 'deposit':
                    achievements = await this.processDepositAchievements(job);
                    break;
                case 'match':
                    achievements = await this.processMatchAchievements(job);
                    break;
                case 'engagement':
                    achievements = await this.processEngagementAchievements(job);
                    break;
            }
            // Send notifications if achievements were unlocked
            if (achievements.length > 0) {
                await queueAchievementNotifications(job.userId.toString(), achievements, job.type);
                console.log(`Achievement job ${job.id} completed with ${achievements.length} new achievements`);
            }
            else {
                console.log(`Achievement job ${job.id} completed with no new achievements`);
            }
        }
        catch (error) {
            console.error(`Achievement job ${job.id} failed:`, error);
            // Retry if under max attempts
            if (job.attempts < this.maxRetries) {
                console.log(`Retrying achievement job ${job.id} in ${this.retryDelay}ms`);
                setTimeout(() => {
                    this.jobs.unshift(job); // Add back to front of queue
                }, this.retryDelay * job.attempts); // Exponential backoff
            }
            else {
                console.error(`Achievement job ${job.id} failed permanently after ${job.attempts} attempts`);
            }
        }
    }
    // Process tip-related achievements
    async processTipAchievements(job) {
        const { tipCount, tipAmount } = job.data;
        return await checkTipAchievements(job.userId, tipCount, tipAmount);
    }
    // Process deposit-related achievements
    async processDepositAchievements(job) {
        const { depositAmount } = job.data;
        return await checkDepositAchievements(job.userId, depositAmount);
    }
    // Process match-related achievements (streak updates)
    async processMatchAchievements(job) {
        const { won } = job.data;
        const result = await updateStreak(job.discordId, won);
        const achievements = [];
        if (result.achievement) {
            achievements.push(result.achievement);
        }
        // Also check engagement achievements after match
        const engagementAchievements = await checkEngagementAchievements(job.userId);
        achievements.push(...engagementAchievements);
        return achievements;
    }
    // Process engagement-related achievements
    async processEngagementAchievements(job) {
        return await checkEngagementAchievements(job.userId);
    }
    // Get queue status
    getStatus() {
        return {
            queueLength: this.jobs.length,
            processing: this.processing,
            activeJobs: this.activeJobs,
            totalCompleted: 0 // Could track this with a counter
        };
    }
    // Clear queue (for testing/emergency)
    clear() {
        this.jobs = [];
        console.log('Achievement job queue cleared');
    }
}
// Singleton queue instance
const achievementQueue = new AchievementJobQueue();
// Public API functions
export function queueTipAchievements(userId, discordId, tipCount, tipAmount) {
    return achievementQueue.enqueue({
        type: 'tip',
        userId,
        discordId,
        data: { tipCount, tipAmount },
        priority: 1 // Normal priority
    });
}
export function queueDepositAchievements(userId, discordId, depositAmount) {
    return achievementQueue.enqueue({
        type: 'deposit',
        userId,
        discordId,
        data: { depositAmount },
        priority: 2 // Higher priority for deposits
    });
}
export function queueMatchAchievements(userId, discordId, won) {
    return achievementQueue.enqueue({
        type: 'match',
        userId,
        discordId,
        data: { won },
        priority: 3 // Highest priority for matches (streaks are time-sensitive)
    });
}
export function queueEngagementAchievements(userId, discordId) {
    return achievementQueue.enqueue({
        type: 'engagement',
        userId,
        discordId,
        data: {},
        priority: 0 // Lowest priority
    });
}
// Get queue status (for monitoring)
export function getAchievementQueueStatus() {
    return achievementQueue.getStatus();
}
// Clear queue (for testing)
export function clearAchievementQueue() {
    achievementQueue.clear();
}
// Optimized function to get user data needed for achievement checking
export async function getUserAchievementData(discordId) {
    try {
        const user = await prisma.user.findUnique({
            where: { discordId },
            select: { id: true }
        });
        if (!user)
            return null;
        // Get aggregated data in parallel
        const [tipCountResult, depositSumResult] = await Promise.all([
            // Count completed tips
            prisma.tip.count({
                where: { fromUserId: user.id, status: 'COMPLETED' }
            }),
            // Sum deposits (from transactions)
            prisma.transaction.aggregate({
                where: {
                    userId: user.id,
                    type: 'DEPOSIT'
                },
                _sum: { amount: true }
            })
        ]);
        return {
            userId: user.id,
            tipCount: tipCountResult,
            totalDeposited: Number(depositSumResult._sum.amount || 0)
        };
    }
    catch (error) {
        console.error('Error getting user achievement data:', error);
        return null;
    }
}
// Health check function
export function achievementQueueHealthCheck() {
    const status = achievementQueue.getStatus();
    // Consider unhealthy if queue is too backed up
    return status.queueLength < 100;
}
