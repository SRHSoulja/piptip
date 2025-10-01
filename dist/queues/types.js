import { z } from "zod";
var JobPriority = /* @__PURE__ */ ((JobPriority2) => {
  JobPriority2[JobPriority2["CRITICAL"] = 1] = "CRITICAL";
  JobPriority2[JobPriority2["HIGH"] = 2] = "HIGH";
  JobPriority2[JobPriority2["NORMAL"] = 3] = "NORMAL";
  JobPriority2[JobPriority2["LOW"] = 4] = "LOW";
  return JobPriority2;
})(JobPriority || {});
var JobStatus = /* @__PURE__ */ ((JobStatus2) => {
  JobStatus2["PENDING"] = "pending";
  JobStatus2["ACTIVE"] = "active";
  JobStatus2["COMPLETED"] = "completed";
  JobStatus2["FAILED"] = "failed";
  JobStatus2["DELAYED"] = "delayed";
  JobStatus2["WAITING_CHILDREN"] = "waiting-children";
  return JobStatus2;
})(JobStatus || {});
const MarketResolutionJobSchema = z.object({
  marketId: z.string().uuid(),
  resolutionType: z.enum(["manual", "automated", "disputed"]),
  outcome: z.object({
    winningOption: z.number().int().min(0),
    price: z.number().positive().optional(),
    confidence: z.number().min(0).max(1).optional()
  }),
  resolvedBy: z.string().min(1),
  metadata: z.object({
    source: z.string().optional(),
    timestamp: z.number(),
    verificationAttempts: z.number().int().min(0).default(0)
  })
});
const PayoutJobSchema = z.object({
  marketId: z.string().uuid(),
  resolutionId: z.string().uuid(),
  totalPool: z.string(),
  // BigInt as string for precision
  winningShares: z.string(),
  // BigInt as string
  payouts: z.array(z.object({
    userId: z.string().min(1),
    amount: z.string(),
    // BigInt as string
    shares: z.string(),
    // BigInt as string
    tokenId: z.string().uuid()
  })),
  idempotencyKey: z.string().min(1),
  metadata: z.object({
    feeAmount: z.string().optional(),
    // Platform fee
    treasuryShare: z.string().optional(),
    timestamp: z.number()
  })
});
const ReconciliationJobSchema = z.object({
  type: z.enum(["user_balance", "market_pool", "treasury", "full_audit"]),
  scope: z.object({
    userId: z.string().optional(),
    marketId: z.string().uuid().optional(),
    tokenId: z.string().uuid().optional(),
    startTime: z.number().optional(),
    endTime: z.number().optional()
  }),
  toleranceThreshold: z.string().default("0.01"),
  // BigInt as string, allowed drift
  metadata: z.object({
    triggeredBy: z.enum(["scheduled", "manual", "alert"]),
    expectedBalance: z.string().optional(),
    // For targeted reconciliation
    timestamp: z.number()
  })
});
const DiscordOutboxJobSchema = z.object({
  type: z.enum(["notification", "announcement", "alert", "dm"]),
  recipients: z.array(z.object({
    type: z.enum(["user", "channel", "guild"]),
    id: z.string().min(1)
    // Discord ID
  })),
  content: z.object({
    embeds: z.array(z.any()).optional(),
    components: z.array(z.any()).optional(),
    content: z.string().optional(),
    files: z.array(z.any()).optional()
  }),
  options: z.object({
    ephemeral: z.boolean().default(false),
    deleteAfter: z.number().optional(),
    // Seconds
    rateLimitKey: z.string().optional()
    // For rate limiting
  }),
  idempotencyKey: z.string().min(1),
  metadata: z.object({
    source: z.string(),
    // Which service/event triggered this
    timestamp: z.number(),
    priority: z.enum(["urgent", "normal", "low"]).default("normal")
  })
});
const DeadLetterJobSchema = z.object({
  originalQueue: z.string().min(1),
  originalJobId: z.string().min(1),
  originalPayload: z.any(),
  failureReason: z.string().min(1),
  attempts: z.number().int().min(1),
  lastError: z.object({
    message: z.string(),
    stack: z.string().optional(),
    timestamp: z.number()
  }),
  metadata: z.object({
    canRetry: z.boolean(),
    requiresManualReview: z.boolean(),
    estimatedResolution: z.string().optional(),
    escalationLevel: z.enum(["low", "medium", "high", "critical"])
  })
});
const DEFAULT_RETRY_CONFIGS = {
  "market-resolution": {
    attempts: 3,
    backoffType: "exponential",
    backoffDelay: 2e3,
    maxBackoffDelay: 3e4
  },
  "payouts": {
    attempts: 5,
    backoffType: "exponential",
    backoffDelay: 1e3,
    maxBackoffDelay: 6e4
  },
  "reconciliation": {
    attempts: 2,
    backoffType: "fixed",
    backoffDelay: 5e3
  },
  "discord-outbox": {
    attempts: 10,
    backoffType: "exponential",
    backoffDelay: 500,
    maxBackoffDelay: 3e4
  },
  "dead-letter": {
    attempts: 1,
    backoffType: "fixed",
    backoffDelay: 0
  }
};
function validateMarketResolutionJob(data) {
  return MarketResolutionJobSchema.parse(data);
}
function validatePayoutJob(data) {
  return PayoutJobSchema.parse(data);
}
function validateReconciliationJob(data) {
  return ReconciliationJobSchema.parse(data);
}
function validateDiscordOutboxJob(data) {
  return DiscordOutboxJobSchema.parse(data);
}
function validateDeadLetterJob(data) {
  return DeadLetterJobSchema.parse(data);
}
function createMarketResolutionJob(data) {
  return {
    ...data,
    timestamp: Date.now(),
    priority: 1 /* CRITICAL */,
    retryConfig: DEFAULT_RETRY_CONFIGS["market-resolution"]
  };
}
function createPayoutJob(data) {
  return {
    ...data,
    timestamp: Date.now(),
    priority: 1 /* CRITICAL */,
    retryConfig: DEFAULT_RETRY_CONFIGS["payouts"]
  };
}
function createReconciliationJob(data) {
  return {
    ...data,
    timestamp: Date.now(),
    priority: 3 /* NORMAL */,
    retryConfig: DEFAULT_RETRY_CONFIGS["reconciliation"]
  };
}
function createDiscordOutboxJob(data) {
  return {
    ...data,
    timestamp: Date.now(),
    priority: 2 /* HIGH */,
    retryConfig: DEFAULT_RETRY_CONFIGS["discord-outbox"]
  };
}
function createDeadLetterJob(data) {
  return {
    ...data,
    timestamp: Date.now(),
    priority: 4 /* LOW */,
    retryConfig: DEFAULT_RETRY_CONFIGS["dead-letter"]
  };
}
console.log("\u{1F680} Job type definitions loaded with Zod validation");
export {
  DEFAULT_RETRY_CONFIGS,
  DeadLetterJobSchema,
  DiscordOutboxJobSchema,
  JobPriority,
  JobStatus,
  MarketResolutionJobSchema,
  PayoutJobSchema,
  ReconciliationJobSchema,
  createDeadLetterJob,
  createDiscordOutboxJob,
  createMarketResolutionJob,
  createPayoutJob,
  createReconciliationJob,
  validateDeadLetterJob,
  validateDiscordOutboxJob,
  validateMarketResolutionJob,
  validatePayoutJob,
  validateReconciliationJob
};
//# sourceMappingURL=types.js.map
