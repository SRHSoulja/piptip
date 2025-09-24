// src/queues/types.ts - Strongly typed job definitions with Zod validation
import { z } from 'zod';
// Job priority levels (lower number = higher priority)
export var JobPriority;
(function (JobPriority) {
    JobPriority[JobPriority["CRITICAL"] = 1] = "CRITICAL";
    JobPriority[JobPriority["HIGH"] = 2] = "HIGH";
    JobPriority[JobPriority["NORMAL"] = 3] = "NORMAL";
    JobPriority[JobPriority["LOW"] = 4] = "LOW";
})(JobPriority || (JobPriority = {}));
// Job status tracking
export var JobStatus;
(function (JobStatus) {
    JobStatus["PENDING"] = "pending";
    JobStatus["ACTIVE"] = "active";
    JobStatus["COMPLETED"] = "completed";
    JobStatus["FAILED"] = "failed";
    JobStatus["DELAYED"] = "delayed";
    JobStatus["WAITING_CHILDREN"] = "waiting-children";
})(JobStatus || (JobStatus = {}));
// Market Resolution Job Payload
export const MarketResolutionJobSchema = z.object({
    marketId: z.string().uuid(),
    resolutionType: z.enum(['manual', 'automated', 'disputed']),
    outcome: z.object({
        winningOption: z.number().int().min(0),
        price: z.number().positive().optional(),
        confidence: z.number().min(0).max(1).optional(),
    }),
    resolvedBy: z.string().min(1),
    metadata: z.object({
        source: z.string().optional(),
        timestamp: z.number(),
        verificationAttempts: z.number().int().min(0).default(0),
    }),
});
// Payout Processing Job Payload
export const PayoutJobSchema = z.object({
    marketId: z.string().uuid(),
    resolutionId: z.string().uuid(),
    totalPool: z.string(), // BigInt as string for precision
    winningShares: z.string(), // BigInt as string
    payouts: z.array(z.object({
        userId: z.string().min(1),
        amount: z.string(), // BigInt as string
        shares: z.string(), // BigInt as string
        tokenId: z.string().uuid(),
    })),
    idempotencyKey: z.string().min(1),
    metadata: z.object({
        feeAmount: z.string().optional(), // Platform fee
        treasuryShare: z.string().optional(),
        timestamp: z.number(),
    }),
});
// Balance Reconciliation Job Payload
export const ReconciliationJobSchema = z.object({
    type: z.enum(['user_balance', 'market_pool', 'treasury', 'full_audit']),
    scope: z.object({
        userId: z.string().optional(),
        marketId: z.string().uuid().optional(),
        tokenId: z.string().uuid().optional(),
        startTime: z.number().optional(),
        endTime: z.number().optional(),
    }),
    toleranceThreshold: z.string().default('0.01'), // BigInt as string, allowed drift
    metadata: z.object({
        triggeredBy: z.enum(['scheduled', 'manual', 'alert']),
        expectedBalance: z.string().optional(), // For targeted reconciliation
        timestamp: z.number(),
    }),
});
// Discord Outbox Job Payload
export const DiscordOutboxJobSchema = z.object({
    type: z.enum(['notification', 'announcement', 'alert', 'dm']),
    recipients: z.array(z.object({
        type: z.enum(['user', 'channel', 'guild']),
        id: z.string().min(1), // Discord ID
    })),
    content: z.object({
        embeds: z.array(z.any()).optional(),
        components: z.array(z.any()).optional(),
        content: z.string().optional(),
        files: z.array(z.any()).optional(),
    }),
    options: z.object({
        ephemeral: z.boolean().default(false),
        deleteAfter: z.number().optional(), // Seconds
        rateLimitKey: z.string().optional(), // For rate limiting
    }),
    idempotencyKey: z.string().min(1),
    metadata: z.object({
        source: z.string(), // Which service/event triggered this
        timestamp: z.number(),
        priority: z.enum(['urgent', 'normal', 'low']).default('normal'),
    }),
});
// Dead Letter Queue Job Payload
export const DeadLetterJobSchema = z.object({
    originalQueue: z.string().min(1),
    originalJobId: z.string().min(1),
    originalPayload: z.any(),
    failureReason: z.string().min(1),
    attempts: z.number().int().min(1),
    lastError: z.object({
        message: z.string(),
        stack: z.string().optional(),
        timestamp: z.number(),
    }),
    metadata: z.object({
        canRetry: z.boolean(),
        requiresManualReview: z.boolean(),
        estimatedResolution: z.string().optional(),
        escalationLevel: z.enum(['low', 'medium', 'high', 'critical']),
    }),
});
// Default retry configurations per job type
export const DEFAULT_RETRY_CONFIGS = {
    'market-resolution': {
        attempts: 3,
        backoffType: 'exponential',
        backoffDelay: 2000,
        maxBackoffDelay: 30000,
    },
    'payouts': {
        attempts: 5,
        backoffType: 'exponential',
        backoffDelay: 1000,
        maxBackoffDelay: 60000,
    },
    'reconciliation': {
        attempts: 2,
        backoffType: 'fixed',
        backoffDelay: 5000,
    },
    'discord-outbox': {
        attempts: 10,
        backoffType: 'exponential',
        backoffDelay: 500,
        maxBackoffDelay: 30000,
    },
    'dead-letter': {
        attempts: 1,
        backoffType: 'fixed',
        backoffDelay: 0,
    },
};
// Job validation functions
export function validateMarketResolutionJob(data) {
    return MarketResolutionJobSchema.parse(data);
}
export function validatePayoutJob(data) {
    return PayoutJobSchema.parse(data);
}
export function validateReconciliationJob(data) {
    return ReconciliationJobSchema.parse(data);
}
export function validateDiscordOutboxJob(data) {
    return DiscordOutboxJobSchema.parse(data);
}
export function validateDeadLetterJob(data) {
    return DeadLetterJobSchema.parse(data);
}
// Job creation helpers with defaults
export function createMarketResolutionJob(data) {
    return {
        ...data,
        timestamp: Date.now(),
        priority: JobPriority.CRITICAL,
        retryConfig: DEFAULT_RETRY_CONFIGS['market-resolution'],
    };
}
export function createPayoutJob(data) {
    return {
        ...data,
        timestamp: Date.now(),
        priority: JobPriority.CRITICAL,
        retryConfig: DEFAULT_RETRY_CONFIGS['payouts'],
    };
}
export function createReconciliationJob(data) {
    return {
        ...data,
        timestamp: Date.now(),
        priority: JobPriority.NORMAL,
        retryConfig: DEFAULT_RETRY_CONFIGS['reconciliation'],
    };
}
export function createDiscordOutboxJob(data) {
    return {
        ...data,
        timestamp: Date.now(),
        priority: JobPriority.HIGH,
        retryConfig: DEFAULT_RETRY_CONFIGS['discord-outbox'],
    };
}
export function createDeadLetterJob(data) {
    return {
        ...data,
        timestamp: Date.now(),
        priority: JobPriority.LOW,
        retryConfig: DEFAULT_RETRY_CONFIGS['dead-letter'],
    };
}
console.log('🚀 Job type definitions loaded with Zod validation');
