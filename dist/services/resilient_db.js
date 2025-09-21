// src/services/resilient_db.ts - Database operations with retry and fallback
import { prisma } from "./db.js";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
const DEFAULT_RETRY_OPTIONS = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    exponentialBackoff: true
};
export class DatabaseError extends Error {
    operation;
    cause;
    constructor(message, operation, cause) {
        super(message);
        this.operation = operation;
        this.cause = cause;
        this.name = 'DatabaseError';
    }
}
/**
 * Execute a database operation with automatic retry logic
 */
export async function withRetry(operation, operationName, options = {}) {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError = null;
    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
            console.log(`🔄 ${operationName} (attempt ${attempt}/${opts.maxAttempts})`);
            const result = await operation();
            if (attempt > 1) {
                console.log(`✅ ${operationName} succeeded after ${attempt} attempts`);
            }
            return result;
        }
        catch (error) {
            lastError = error;
            // Log the error details
            console.error(`❌ ${operationName} failed (attempt ${attempt}/${opts.maxAttempts}):`, {
                error: error.message,
                code: error.code,
                type: error.constructor.name
            });
            // Don't retry on final attempt
            if (attempt >= opts.maxAttempts) {
                break;
            }
            // Check if error is retryable
            if (!isRetryableError(error)) {
                console.log(`🚫 ${operationName} failed with non-retryable error, aborting`);
                break;
            }
            // Calculate delay with exponential backoff
            let delay = opts.baseDelayMs;
            if (opts.exponentialBackoff) {
                delay = Math.min(opts.baseDelayMs * Math.pow(2, attempt - 1), opts.maxDelayMs);
            }
            console.log(`⏳ Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            // Try to reconnect if it's a connection error
            if (isConnectionError(error)) {
                try {
                    console.log(`🔌 Attempting to reconnect to database...`);
                    await prisma.$connect();
                    console.log(`✅ Database reconnection successful`);
                }
                catch (reconnectError) {
                    console.error(`❌ Database reconnection failed:`, reconnectError.message);
                }
            }
        }
    }
    // All attempts failed
    const errorMessage = `${operationName} failed after ${opts.maxAttempts} attempts`;
    console.error(`💀 ${errorMessage}`, { lastError: lastError?.message });
    throw new DatabaseError(errorMessage, operationName, lastError || undefined);
}
/**
 * Check if an error is worth retrying
 */
function isRetryableError(error) {
    // Connection errors
    if (isConnectionError(error))
        return true;
    // Timeout errors
    if (error.message?.includes('timeout'))
        return true;
    // Specific Prisma error codes that are retryable
    if (error instanceof PrismaClientKnownRequestError) {
        switch (error.code) {
            case 'P1000': // Authentication failed
            case 'P1001': // Can't reach database server
            case 'P1002': // Database server reached but timed out
            case 'P1008': // Operations timed out
            case 'P1017': // Server has closed the connection
                return true;
            default:
                return false;
        }
    }
    // Database connection terminated
    if (error.message?.includes('terminating connection due to administrator command'))
        return true;
    if (error.message?.includes('Connection terminated unexpectedly'))
        return true;
    if (error.message?.includes('server closed the connection unexpectedly'))
        return true;
    // Transaction timeout errors - CRITICAL FIX
    if (error.message?.includes('Transaction timeout'))
        return true;
    if (error.message?.includes('operation exceeded'))
        return true;
    if (error.message?.includes('Database operation timeout'))
        return true;
    return false;
}
/**
 * Check if an error is specifically a connection error
 */
function isConnectionError(error) {
    if (error.message?.includes("Can't reach database server"))
        return true;
    if (error.message?.includes("terminating connection due to administrator command"))
        return true;
    if (error.message?.includes("Connection terminated unexpectedly"))
        return true;
    if (error.message?.includes("server closed the connection unexpectedly"))
        return true;
    if (error instanceof PrismaClientKnownRequestError) {
        return ['P1000', 'P1001', 'P1002', 'P1017'].includes(error.code);
    }
    return false;
}
/**
 * Performance tracking for optimization
 */
const performanceMetrics = {
    claimTimes: [],
    lastCleanup: Date.now(),
    trackClaim(duration) {
        this.claimTimes.push(duration);
        // Keep only last 100 claims for analysis
        if (this.claimTimes.length > 100) {
            this.claimTimes.shift();
        }
        // Log performance stats every 50 claims
        if (this.claimTimes.length % 50 === 0) {
            const avg = this.claimTimes.reduce((a, b) => a + b, 0) / this.claimTimes.length;
            const max = Math.max(...this.claimTimes);
            const recent = this.claimTimes.slice(-10);
            const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            console.log(`📊 Claim Performance Stats: avg=${avg.toFixed(0)}ms, max=${max}ms, recent_avg=${recentAvg.toFixed(0)}ms`);
        }
    },
    getStats() {
        if (this.claimTimes.length === 0)
            return { avg: 0, max: 0, count: 0 };
        const avg = this.claimTimes.reduce((a, b) => a + b, 0) / this.claimTimes.length;
        const max = Math.max(...this.claimTimes);
        return { avg: Math.round(avg), max, count: this.claimTimes.length };
    }
};
/**
 * Resilient database operations for critical group tip functionality
 */
export const resilientDb = {
    async findGroupTip(id) {
        return withRetry(() => prisma.groupTip.findUnique({
            where: { id },
            include: {
                Creator: true,
                Token: true,
                claims: { include: { User: true }, orderBy: { claimedAt: "asc" } },
                contributions: { include: { contributor: true }, orderBy: { createdAt: "asc" } },
            },
        }), `findGroupTip(${id})`);
    },
    async findGroupTipFast(id) {
        return withRetry(() => prisma.groupTip.findUnique({
            where: { id },
            include: {
                Creator: true,
                Token: true,
                claims: { include: { User: true }, orderBy: { claimedAt: "asc" } },
                contributions: { include: { contributor: true }, orderBy: { createdAt: "asc" } },
            },
        }), `findGroupTipFast(${id})`, { maxAttempts: 10, baseDelayMs: 100, maxDelayMs: 1000, exponentialBackoff: false } // Ultra-fast for severe DB issues
        );
    },
    async findGroupTipBasic(id) {
        return withRetry(() => prisma.groupTip.findUnique({
            where: { id },
            select: { id: true, expiresAt: true, status: true },
        }), `findGroupTipBasic(${id})`);
    },
    async finalizeGroupTip(groupTipId) {
        return withRetry(async () => {
            const { finalizeExpiredGroupTip } = await import("../features/finalizeExpiredGroupTip.js");
            return finalizeExpiredGroupTip(groupTipId);
        }, `finalizeGroupTip(${groupTipId})`, { maxAttempts: 5, baseDelayMs: 2000 } // More aggressive for critical operations
        );
    },
    async finalizeGroupTipFast(groupTipId) {
        return withRetry(async () => {
            const { finalizeExpiredGroupTip } = await import("../features/finalizeExpiredGroupTip.js");
            return finalizeExpiredGroupTip(groupTipId);
        }, `finalizeGroupTipFast(${groupTipId})`, { maxAttempts: 10, baseDelayMs: 100, maxDelayMs: 1000, exponentialBackoff: false } // Ultra-fast for severe DB issues
        );
    },
    async createGroupTipClaim(groupTipId, userId) {
        return withRetry(() => prisma.groupTipClaim.create({
            data: { groupTipId, userId }
        }), `createGroupTipClaim(${groupTipId}, ${userId})`);
    },
    async processGroupTipClaim(groupTipId, discordId) {
        const startTime = Date.now();
        // EMERGENCY: Wrap entire operation in timeout to prevent hanging
        return Promise.race([
            withRetry(async () => {
                // EMERGENCY OPTIMIZATION: Pre-validate outside transaction for speed
                const quickValidation = await Promise.race([
                    prisma.groupTip.findUnique({
                        where: { id: groupTipId },
                        select: {
                            id: true,
                            status: true,
                            expiresAt: true,
                            Creator: { select: { discordId: true } }
                        }
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Pre-validation timeout")), 600))
                ]);
                if (!quickValidation)
                    throw new Error("Group tip not found");
                const isExpired = quickValidation.expiresAt.getTime() < Date.now();
                if (isExpired) {
                    return { expired: true, status: quickValidation.status, groupTipId: quickValidation.id };
                }
                if (quickValidation.status !== "ACTIVE") {
                    throw new Error("This group tip is no longer active");
                }
                if (quickValidation.Creator && quickValidation.Creator.discordId === discordId) {
                    throw new Error("You cannot claim your own group tip");
                }
                // OPTIMIZATION: Super fast user lookup/creation
                const user = await Promise.race([
                    prisma.user.upsert({
                        where: { discordId },
                        update: {},
                        create: { discordId },
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("User upsert timeout")), 500))
                ]);
                // OPTIMIZATION: Check existing participation with minimal timeout
                const [existingContribution, existingClaim] = await Promise.race([
                    Promise.all([
                        prisma.groupTipContribution.findUnique({
                            where: {
                                groupTipId_contributorId: {
                                    groupTipId,
                                    contributorId: user.id
                                }
                            }
                        }),
                        prisma.groupTipClaim.findUnique({
                            where: {
                                groupTipId_userId: {
                                    groupTipId,
                                    userId: user.id
                                }
                            }
                        })
                    ]),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Participation check timeout")), 700))
                ]);
                if (existingContribution) {
                    throw new Error("You've already contributed to this group tip! Contributors can't also claim! 🐟");
                }
                if (existingClaim) {
                    throw new Error("You have already claimed this group tip");
                }
                // CRITICAL FIX: Super fast transaction with tight timeouts
                const result = await Promise.race([
                    prisma.$transaction(async (tx) => {
                        // Record claim
                        await tx.groupTipClaim.create({
                            data: { groupTipId, userId: user.id },
                        });
                        // Get current claim count after successful insert
                        const claimCount = await tx.groupTipClaim.count({
                            where: { groupTipId },
                        });
                        return {
                            expired: false,
                            groupTipId,
                            newClaimCount: claimCount,
                        };
                    }, {
                        maxWait: 800, // Very tight limits for fast response
                        timeout: 1000, // 1 second max for transaction
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Transaction timeout: Database operation exceeded 1 second")), 1000))
                ]);
                // Track successful claim performance
                const duration = Date.now() - startTime;
                performanceMetrics.trackClaim(duration);
                console.log(`⚡ Claim processed in ${duration}ms for tip ${groupTipId}`);
                return result;
            }, `processGroupTipClaim(${groupTipId}, ${discordId})`, { maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 100, exponentialBackoff: false } // Minimal retries for speed
            ),
            // Ultimate timeout - force reject after 1.8 seconds max
            new Promise((_, reject) => setTimeout(() => reject(new Error("Claim timeout: Database operation exceeded 1.8 seconds")), 1800))
        ]).catch(error => {
            // Track failed claim performance too
            const duration = Date.now() - startTime;
            console.log(`❌ Claim failed after ${duration}ms for tip ${groupTipId}: ${error.message}`);
            throw error;
        });
    },
    async updateGroupTipMessage(client, groupTipId) {
        return withRetry(async () => {
            const { updateGroupTipMessage } = await import("../features/group_tip_helpers.js");
            return updateGroupTipMessage(client, groupTipId);
        }, `updateGroupTipMessage(${groupTipId})`);
    },
    async findOverdueGroupTips() {
        return withRetry(() => prisma.groupTip.findMany({
            where: { status: "ACTIVE", expiresAt: { lte: new Date() } },
            select: { id: true },
        }), "findOverdueGroupTips");
    },
    async findUpcomingGroupTips() {
        return withRetry(() => prisma.groupTip.findMany({
            where: { status: "ACTIVE", expiresAt: { gt: new Date() } },
            select: { id: true, expiresAt: true },
        }), "findUpcomingGroupTips");
    },
    async healthCheck(timeoutMs = 2000) {
        try {
            await Promise.race([
                prisma.$queryRaw `SELECT 1`,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), timeoutMs))
            ]);
            return true;
        }
        catch (error) {
            console.warn('Database health check failed:', error);
            return false;
        }
    },
    async checkUserGroupTipStatus(discordId, groupTipId) {
        return withRetry(async () => {
            const user = await prisma.user.findUnique({
                where: { discordId }
            });
            if (!user) {
                return { hasUser: false, hasContribution: false, hasClaim: false };
            }
            const [existingContribution, existingClaim] = await Promise.all([
                prisma.groupTipContribution.findUnique({
                    where: {
                        groupTipId_contributorId: {
                            groupTipId,
                            contributorId: user.id
                        }
                    }
                }),
                prisma.groupTipClaim.findUnique({
                    where: {
                        groupTipId_userId: {
                            groupTipId,
                            userId: user.id
                        }
                    }
                })
            ]);
            return {
                hasUser: true,
                hasContribution: !!existingContribution,
                hasClaim: !!existingClaim
            };
        }, `checkUserGroupTipStatus(${discordId}, ${groupTipId})`);
    },
    /**
     * Get performance metrics for monitoring and optimization
     */
    getPerformanceStats() {
        return performanceMetrics.getStats();
    }
};
