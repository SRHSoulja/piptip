// src/queues/workers/reconciliation_service.ts - Balance reconciliation with drift detection
import { Worker } from 'bullmq';
import { redis } from '../config.js';
import { validateReconciliationJob } from '../types.js';
import { prisma } from '../../services/db.js';
import { Prisma } from '@prisma/client';
export class ReconciliationService {
    worker;
    constructor() {
        this.worker = new Worker('reconciliation', this.processJob.bind(this), {
            connection: redis,
            concurrency: 2, // Conservative concurrency for reconciliation
            removeOnComplete: { count: 200 }, // Keep more reconciliation records
            removeOnFail: { count: 100 },
            stalledInterval: 300000, // 5 minutes - reconciliation can take time
            maxStalledCount: 2,
        });
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.worker.on('completed', (job) => {
            console.log(`✅ Reconciliation job ${job.id} completed`);
        });
        this.worker.on('failed', (job, error) => {
            console.error(`❌ Reconciliation job ${job?.id} failed:`, error);
            // Reconciliation failures need investigation
            if (job) {
                this.escalateReconciliationFailure(job, error);
            }
        });
        this.worker.on('stalled', (jobId) => {
            console.warn(`⚠️ Reconciliation job ${jobId} stalled - may need manual review`);
        });
        this.worker.on('error', (error) => {
            console.error('❌ Reconciliation service error:', error);
        });
    }
    async processJob(job) {
        const startTime = Date.now();
        console.log(`🔍 Processing reconciliation job ${job.id}`);
        try {
            // Validate job payload
            const jobData = validateReconciliationJob(job.data);
            let result;
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
        }
        catch (error) {
            const duration = Date.now() - startTime;
            console.error(`❌ Reconciliation failed after ${duration}ms:`, error);
            // Log reconciliation error
            await this.logReconciliationError(job, error);
            throw error; // Re-throw for BullMQ retry handling
        }
    }
    async reconcileUserBalance(jobData) {
        const tolerance = BigInt(jobData.toleranceThreshold);
        const result = {
            type: 'user_balance',
            scope: jobData.scope,
            status: 'PASSED',
            drifts: [],
            corrections: [],
            summary: { totalChecked: 0, driftsFound: 0, correctionsMade: 0, toleranceExceeded: 0 }
        };
        await prisma.$transaction(async (tx) => {
            // Build query conditions
            const where = {};
            if (jobData.scope.userId)
                where.userId = jobData.scope.userId;
            if (jobData.scope.tokenId)
                where.tokenId = jobData.scope.tokenId;
            // Get all user balances to check
            const balances = await tx.userBalance.findMany({
                where,
                include: {
                    user: { select: { discordId: true } },
                    token: { select: { symbol: true } }
                }
            });
            result.summary.totalChecked = balances.length;
            for (const balance of balances) {
                const calculatedBalance = await this.calculateUserBalance(tx, balance.userId, balance.tokenId, jobData.scope);
                const actualBalance = BigInt(balance.amount);
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
                                amount: expectedBalance.toString(),
                                lastUpdated: new Date()
                            }
                        });
                        // Log the correction
                        await tx.transaction.create({
                            data: {
                                id: `reconciliation_${balance.userId}_${balance.tokenId}_${Date.now()}`,
                                userId: balance.userId,
                                tokenId: balance.tokenId,
                                type: 'RECONCILIATION',
                                amount: difference.toString(),
                                description: `Balance reconciliation: corrected drift of ${difference.toString()}`,
                                metadata: {
                                    jobId: jobData.id,
                                    jobType: 'reconciliation',
                                    severity,
                                    oldBalance: actualBalance.toString(),
                                    newBalance: expectedBalance.toString(),
                                }
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
            }
            else if (result.summary.correctionsMade > 0) {
                result.status = 'CORRECTED';
            }
            else if (result.summary.driftsFound > 0) {
                result.status = 'DRIFT_DETECTED';
            }
        }, {
            maxWait: 60000, // 1 minute
            timeout: 300000, // 5 minutes for large reconciliations
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
        return result;
    }
    async calculateUserBalance(tx, userId, tokenId, scope) {
        // Calculate expected balance from transaction history
        const transactions = await tx.transaction.findMany({
            where: {
                userId,
                tokenId,
                ...(scope.startTime && { createdAt: { gte: new Date(scope.startTime) } }),
                ...(scope.endTime && { createdAt: { lte: new Date(scope.endTime) } })
            }
        });
        // Sum all transactions to get expected balance
        let calculatedBalance = 0n;
        for (const tx_record of transactions) {
            calculatedBalance += BigInt(tx_record.amount);
        }
        return calculatedBalance;
    }
    async reconcileMarketPool(jobData) {
        const result = {
            type: 'market_pool',
            scope: jobData.scope,
            status: 'PASSED',
            drifts: [],
            corrections: [],
            summary: { totalChecked: 0, driftsFound: 0, correctionsMade: 0, toleranceExceeded: 0 }
        };
        await prisma.$transaction(async (tx) => {
            const where = {};
            if (jobData.scope.marketId)
                where.id = jobData.scope.marketId;
            const markets = await tx.predictionMarket.findMany({
                where,
                include: { bets: true }
            });
            result.summary.totalChecked = markets.length;
            for (const market of markets) {
                // Calculate expected pool from bets
                const expectedYesTotal = market.bets
                    .filter(bet => bet.side === 'YES')
                    .reduce((sum, bet) => sum + bet.amount, 0);
                const expectedNoTotal = market.bets
                    .filter(bet => bet.side === 'NO')
                    .reduce((sum, bet) => sum + bet.amount, 0);
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
    async reconcileTreasury(jobData) {
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
    async performFullAudit(jobData) {
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
        const result = {
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
        }
        else if (result.summary.correctionsMade > 0) {
            result.status = 'CORRECTED';
        }
        else if (result.summary.driftsFound > 0) {
            result.status = 'DRIFT_DETECTED';
        }
        return result;
    }
    calculateDriftSeverity(difference, totalBalance) {
        if (totalBalance === 0n)
            return 'HIGH';
        const percentageDrift = Number(difference * 100n / totalBalance);
        if (percentageDrift > 10)
            return 'CRITICAL';
        if (percentageDrift > 5)
            return 'HIGH';
        if (percentageDrift > 1)
            return 'MEDIUM';
        return 'LOW';
    }
    async storeReconciliationResult(jobData, result) {
        // Store in database for audit trail
        await prisma.reconciliationResult.create({
            data: {
                id: `recon_${jobData.type}_${Date.now()}`,
                type: jobData.type,
                status: result.status,
                scope: jobData.scope,
                driftsFound: result.summary.driftsFound,
                correctionsMade: result.summary.correctionsMade,
                toleranceExceeded: result.summary.toleranceExceeded,
                details: result,
                createdAt: new Date(),
            }
        });
        // Store summary in Redis for dashboard
        const redisKey = `reconciliation:result:${jobData.type}:${Date.now()}`;
        await redis.setex(redisKey, 86400, JSON.stringify({
            ...result.summary,
            timestamp: Date.now(),
            status: result.status
        }));
        console.log(`📝 Reconciliation result stored: ${result.status} - ${result.summary.driftsFound} drifts found, ${result.summary.correctionsMade} corrections made`);
    }
    async alertOnToleranceExceeded(jobData, result) {
        console.error(`🚨 RECONCILIATION ALERT: Tolerance exceeded in ${jobData.type} reconciliation`);
        console.error(`${result.summary.toleranceExceeded} critical drifts found requiring manual review`);
        // Store alert for monitoring
        const alertKey = `alert:reconciliation:${jobData.type}:${Date.now()}`;
        await redis.setex(alertKey, 172800, JSON.stringify({
            type: jobData.type,
            criticalDrifts: result.summary.toleranceExceeded,
            totalDrifts: result.summary.driftsFound,
            correctionsMade: result.summary.correctionsMade,
            timestamp: Date.now(),
            drifts: result.drifts.filter(d => d.severity === 'CRITICAL' || d.severity === 'HIGH')
        }));
        // Could integrate with external alerting here
    }
    async escalateReconciliationFailure(job, error) {
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
    async logReconciliationError(job, error) {
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
        await redis.setex(`reconciliation:error:${job.data.type}:${job.id}`, 172800, // 48 hours
        JSON.stringify(errorContext));
        console.error('📝 Reconciliation error context stored:', errorContext);
    }
    async close() {
        await this.worker.close();
        console.log('✅ Reconciliation service closed');
    }
    async pause() {
        await this.worker.pause();
        console.log('⏸️ Reconciliation service paused');
    }
    async resume() {
        await this.worker.resume();
        console.log('▶️ Reconciliation service resumed');
    }
    getStatus() {
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
