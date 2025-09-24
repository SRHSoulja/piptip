import { deadLetterWorker } from '../../queues/workers/dead_letter_queue.js';
import { prisma } from '../../services/db.js';
export async function getDeadLetterDashboard(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const status = req.query.status || 'PENDING';
        const escalationLevel = req.query.escalation;
        // Build filter conditions
        const where = {};
        if (status && status !== 'ALL') {
            where.status = status;
        }
        if (escalationLevel && escalationLevel !== 'ALL') {
            where.escalationLevel = escalationLevel;
        }
        // Get dead letter jobs with pagination
        const jobs = await prisma.deadLetterJob.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
        });
        const totalJobs = await prisma.deadLetterJob.count({ where });
        const totalPages = Math.ceil(totalJobs / limit);
        // Get statistics
        const stats = await deadLetterWorker.getDeadLetterStats();
        res.render('admin/dead_letter_queue', {
            jobs,
            stats,
            currentPage: page,
            totalPages,
            totalJobs,
            limit,
            currentStatus: status,
            currentEscalation: escalationLevel,
            title: 'Dead Letter Queue Management'
        });
    }
    catch (error) {
        console.error('Error loading dead letter queue dashboard:', error);
        res.status(500).json({ error: 'Failed to load dashboard' });
    }
}
export async function getDeadLetterJob(req, res) {
    try {
        const { id } = req.params;
        const job = await deadLetterWorker.getDeadLetterJobById(id);
        if (!job) {
            return res.status(404).json({ error: 'Dead letter job not found' });
        }
        res.json({
            success: true,
            job: {
                ...job,
                originalPayload: job.originalPayload,
                lastError: job.lastError,
            }
        });
    }
    catch (error) {
        console.error('Error getting dead letter job:', error);
        res.status(500).json({ error: 'Failed to get job details' });
    }
}
export async function retryDeadLetterJob(req, res) {
    try {
        const { id } = req.params;
        const adminUserId = req.user?.id || 'unknown';
        // Validate admin permissions
        if (!req.user?.isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const success = await deadLetterWorker.retryDeadLetterJob(id, adminUserId);
        if (success) {
            res.json({
                success: true,
                message: 'Job queued for retry successfully'
            });
        }
        else {
            res.status(400).json({
                error: 'Failed to retry job. Check job status and queue availability.'
            });
        }
    }
    catch (error) {
        console.error('Error retrying dead letter job:', error);
        res.status(500).json({ error: 'Failed to retry job' });
    }
}
export async function dismissDeadLetterJob(req, res) {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const adminUserId = req.user?.id || 'unknown';
        // Validate admin permissions
        if (!req.user?.isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        if (!reason || reason.trim().length === 0) {
            return res.status(400).json({ error: 'Dismissal reason is required' });
        }
        const success = await deadLetterWorker.dismissDeadLetterJob(id, adminUserId, reason);
        if (success) {
            res.json({
                success: true,
                message: 'Job dismissed successfully'
            });
        }
        else {
            res.status(400).json({
                error: 'Failed to dismiss job. Check job status.'
            });
        }
    }
    catch (error) {
        console.error('Error dismissing dead letter job:', error);
        res.status(500).json({ error: 'Failed to dismiss job' });
    }
}
export async function getDeadLetterStats(req, res) {
    try {
        const stats = await deadLetterWorker.getDeadLetterStats();
        // Get additional queue health information
        const queueStats = await import('../../queues/config.js').then(m => m.getQueueHealth());
        res.json({
            success: true,
            deadLetterStats: stats,
            queueHealth: queueStats,
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('Error getting dead letter stats:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
}
export async function bulkRetryDeadLetterJobs(req, res) {
    try {
        const { jobIds } = req.body;
        const adminUserId = req.user?.id || 'unknown';
        // Validate admin permissions
        if (!req.user?.isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        if (!Array.isArray(jobIds) || jobIds.length === 0) {
            return res.status(400).json({ error: 'Job IDs array is required' });
        }
        if (jobIds.length > 50) {
            return res.status(400).json({ error: 'Cannot retry more than 50 jobs at once' });
        }
        const results = [];
        for (const jobId of jobIds) {
            try {
                const success = await deadLetterWorker.retryDeadLetterJob(jobId, adminUserId);
                results.push({ jobId, success });
            }
            catch (error) {
                results.push({ jobId, success: false, error: error.message });
            }
        }
        const successCount = results.filter(r => r.success).length;
        res.json({
            success: true,
            message: `Successfully retried ${successCount} out of ${jobIds.length} jobs`,
            results
        });
    }
    catch (error) {
        console.error('Error bulk retrying dead letter jobs:', error);
        res.status(500).json({ error: 'Failed to bulk retry jobs' });
    }
}
// API endpoint to clear old dismissed/resolved jobs
export async function cleanupDeadLetterJobs(req, res) {
    try {
        const { olderThanDays = 30 } = req.body;
        const adminUserId = req.user?.id || 'unknown';
        // Validate admin permissions
        if (!req.user?.isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
        const result = await prisma.deadLetterJob.deleteMany({
            where: {
                AND: [
                    {
                        status: {
                            in: ['DISMISSED', 'RESOLVED']
                        }
                    },
                    {
                        updatedAt: {
                            lt: cutoffDate
                        }
                    }
                ]
            }
        });
        console.log(`🧹 Cleaned up ${result.count} old dead letter jobs (older than ${olderThanDays} days) by admin ${adminUserId}`);
        res.json({
            success: true,
            message: `Cleaned up ${result.count} old dead letter jobs`,
            deletedCount: result.count
        });
    }
    catch (error) {
        console.error('Error cleaning up dead letter jobs:', error);
        res.status(500).json({ error: 'Failed to cleanup jobs' });
    }
}
