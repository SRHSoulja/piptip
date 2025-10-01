import { prisma } from "./db.js";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
const DEFAULT_RETRY_OPTIONS = {
  maxAttempts: 3,
  baseDelayMs: 1e3,
  maxDelayMs: 1e4,
  exponentialBackoff: true
};
class DatabaseError extends Error {
  constructor(message, operation, cause) {
    super(message);
    this.operation = operation;
    this.cause = cause;
    this.name = "DatabaseError";
  }
}
async function withRetry(operation, operationName, options = {}) {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError = null;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      console.log(`\u{1F504} ${operationName} (attempt ${attempt}/${opts.maxAttempts})`);
      const result = await operation();
      if (attempt > 1) {
        console.log(`\u2705 ${operationName} succeeded after ${attempt} attempts`);
      }
      return result;
    } catch (error) {
      lastError = error;
      console.error(`\u274C ${operationName} failed (attempt ${attempt}/${opts.maxAttempts}):`, {
        error: error.message,
        code: error.code,
        type: error.constructor.name
      });
      if (attempt >= opts.maxAttempts) {
        break;
      }
      if (!isRetryableError(error)) {
        console.log(`\u{1F6AB} ${operationName} failed with non-retryable error, aborting`);
        break;
      }
      let delay = opts.baseDelayMs;
      if (opts.exponentialBackoff) {
        delay = Math.min(opts.baseDelayMs * Math.pow(2, attempt - 1), opts.maxDelayMs);
      }
      console.log(`\u23F3 Waiting ${delay}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (isConnectionError(error)) {
        try {
          console.log(`\u{1F50C} Attempting to reconnect to database...`);
          await prisma.$connect();
          console.log(`\u2705 Database reconnection successful`);
        } catch (reconnectError) {
          console.error(`\u274C Database reconnection failed:`, reconnectError.message);
        }
      }
    }
  }
  const errorMessage = `${operationName} failed after ${opts.maxAttempts} attempts`;
  console.error(`\u{1F480} ${errorMessage}`, { lastError: lastError?.message });
  throw new DatabaseError(errorMessage, operationName, lastError || void 0);
}
function isRetryableError(error) {
  if (isConnectionError(error)) return true;
  if (error.message?.includes("timeout")) return true;
  if (error instanceof PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P1000":
      // Authentication failed
      case "P1001":
      // Can't reach database server
      case "P1002":
      // Database server reached but timed out
      case "P1008":
      // Operations timed out
      case "P1017":
        return true;
      default:
        return false;
    }
  }
  if (error.message?.includes("terminating connection due to administrator command")) return true;
  if (error.message?.includes("Connection terminated unexpectedly")) return true;
  if (error.message?.includes("server closed the connection unexpectedly")) return true;
  if (error.message?.includes("Transaction timeout")) return true;
  if (error.message?.includes("operation exceeded")) return true;
  if (error.message?.includes("Database operation timeout")) return true;
  return false;
}
function isConnectionError(error) {
  if (error.message?.includes("Can't reach database server")) return true;
  if (error.message?.includes("terminating connection due to administrator command")) return true;
  if (error.message?.includes("Connection terminated unexpectedly")) return true;
  if (error.message?.includes("server closed the connection unexpectedly")) return true;
  if (error instanceof PrismaClientKnownRequestError) {
    return ["P1000", "P1001", "P1002", "P1017"].includes(error.code);
  }
  return false;
}
const performanceMetrics = {
  claimTimes: [],
  lastCleanup: Date.now(),
  trackClaim(duration) {
    this.claimTimes.push(duration);
    if (this.claimTimes.length > 100) {
      this.claimTimes.shift();
    }
    if (this.claimTimes.length % 50 === 0) {
      const avg = this.claimTimes.reduce((a, b) => a + b, 0) / this.claimTimes.length;
      const max = Math.max(...this.claimTimes);
      const recent = this.claimTimes.slice(-10);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      console.log(`\u{1F4CA} Claim Performance Stats: avg=${avg.toFixed(0)}ms, max=${max}ms, recent_avg=${recentAvg.toFixed(0)}ms`);
    }
  },
  getStats() {
    if (this.claimTimes.length === 0) return { avg: 0, max: 0, count: 0 };
    const avg = this.claimTimes.reduce((a, b) => a + b, 0) / this.claimTimes.length;
    const max = Math.max(...this.claimTimes);
    return { avg: Math.round(avg), max, count: this.claimTimes.length };
  }
};
const resilientDb = {
  async findGroupTip(id) {
    return withRetry(
      () => prisma.groupTip.findUnique({
        where: { id },
        include: {
          Creator: true,
          Token: true,
          claims: { include: { User: true }, orderBy: { claimedAt: "asc" } },
          contributions: { include: { contributor: true }, orderBy: { createdAt: "asc" } }
        }
      }),
      `findGroupTip(${id})`
    );
  },
  async findGroupTipFast(id) {
    return withRetry(
      () => prisma.groupTip.findUnique({
        where: { id },
        include: {
          Creator: true,
          Token: true,
          claims: { include: { User: true }, orderBy: { claimedAt: "asc" } },
          contributions: { include: { contributor: true }, orderBy: { createdAt: "asc" } }
        }
      }),
      `findGroupTipFast(${id})`,
      { maxAttempts: 10, baseDelayMs: 100, maxDelayMs: 1e3, exponentialBackoff: false }
      // Ultra-fast for severe DB issues
    );
  },
  async findGroupTipBasic(id) {
    return withRetry(
      () => prisma.groupTip.findUnique({
        where: { id },
        select: { id: true, expiresAt: true, status: true }
      }),
      `findGroupTipBasic(${id})`
    );
  },
  async finalizeGroupTip(groupTipId) {
    return withRetry(
      async () => {
        const { finalizeExpiredGroupTip } = await import("../features/finalizeExpiredGroupTip.js");
        return finalizeExpiredGroupTip(groupTipId);
      },
      `finalizeGroupTip(${groupTipId})`,
      { maxAttempts: 5, baseDelayMs: 2e3 }
      // More aggressive for critical operations
    );
  },
  async finalizeGroupTipFast(groupTipId) {
    return withRetry(
      async () => {
        const { finalizeExpiredGroupTip } = await import("../features/finalizeExpiredGroupTip.js");
        return finalizeExpiredGroupTip(groupTipId);
      },
      `finalizeGroupTipFast(${groupTipId})`,
      { maxAttempts: 10, baseDelayMs: 100, maxDelayMs: 1e3, exponentialBackoff: false }
      // Ultra-fast for severe DB issues
    );
  },
  async createGroupTipClaim(groupTipId, userId) {
    return withRetry(
      () => prisma.groupTipClaim.create({
        data: { groupTipId, userId }
      }),
      `createGroupTipClaim(${groupTipId}, ${userId})`
    );
  },
  async processGroupTipClaim(groupTipId, discordId) {
    const startTime = Date.now();
    return Promise.race([
      withRetry(
        async () => {
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
            new Promise(
              (_, reject) => setTimeout(() => reject(new Error("Pre-validation timeout")), 3e3)
            )
          ]);
          if (!quickValidation) throw new Error("Group tip not found");
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
          const user = await Promise.race([
            prisma.user.upsert({
              where: { discordId },
              update: {},
              create: { discordId }
            }),
            new Promise(
              (_, reject) => setTimeout(() => reject(new Error("User upsert timeout")), 2500)
            )
          ]);
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
            new Promise(
              (_, reject) => setTimeout(() => reject(new Error("Participation check timeout")), 3e3)
            )
          ]);
          if (existingContribution) {
            throw new Error("You've already contributed to this group tip! Contributors can't also claim! \u{1F41F}");
          }
          if (existingClaim) {
            throw new Error("You have already claimed this group tip");
          }
          const result = await Promise.race([
            prisma.$transaction(async (tx) => {
              await tx.groupTipClaim.create({
                data: { groupTipId, userId: user.id }
              });
              const claimCount = await tx.groupTipClaim.count({
                where: { groupTipId }
              });
              return {
                expired: false,
                groupTipId,
                newClaimCount: claimCount
              };
            }, {
              maxWait: 3e3,
              // More reasonable limits
              timeout: 5e3
              // 5 seconds max for transaction
            }),
            new Promise(
              (_, reject) => setTimeout(() => reject(new Error("Transaction timeout: Database operation exceeded 5 seconds")), 5e3)
            )
          ]);
          const duration = Date.now() - startTime;
          performanceMetrics.trackClaim(duration);
          console.log(`\u26A1 Claim processed in ${duration}ms for tip ${groupTipId}`);
          return result;
        },
        `processGroupTipClaim(${groupTipId}, ${discordId})`,
        { maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 100, exponentialBackoff: false }
        // Minimal retries for speed
      ),
      // Ultimate timeout - force reject after 10 seconds max
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error("Claim timeout: Database operation exceeded 10 seconds")), 1e4)
      )
    ]).catch((error) => {
      const duration = Date.now() - startTime;
      console.log(`\u274C Claim failed after ${duration}ms for tip ${groupTipId}: ${error.message}`);
      throw error;
    });
  },
  async updateGroupTipMessage(client, groupTipId) {
    return withRetry(
      async () => {
        const { updateGroupTipMessage } = await import("../features/group_tip_helpers.js");
        return updateGroupTipMessage(client, groupTipId);
      },
      `updateGroupTipMessage(${groupTipId})`
    );
  },
  async findOverdueGroupTips() {
    return withRetry(
      () => prisma.groupTip.findMany({
        where: { status: "ACTIVE", expiresAt: { lte: /* @__PURE__ */ new Date() } },
        select: { id: true }
      }),
      "findOverdueGroupTips"
    );
  },
  async findUpcomingGroupTips() {
    return withRetry(
      () => prisma.groupTip.findMany({
        where: { status: "ACTIVE", expiresAt: { gt: /* @__PURE__ */ new Date() } },
        select: { id: true, expiresAt: true }
      }),
      "findUpcomingGroupTips"
    );
  },
  async healthCheck(timeoutMs = 2e3) {
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise(
          (_, reject) => setTimeout(() => reject(new Error("Health check timeout")), timeoutMs)
        )
      ]);
      return true;
    } catch (error) {
      console.warn("Database health check failed:", error);
      return false;
    }
  },
  async checkUserGroupTipStatus(discordId, groupTipId) {
    return withRetry(
      async () => {
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
      },
      `checkUserGroupTipStatus(${discordId}, ${groupTipId})`
    );
  },
  /**
   * Get performance metrics for monitoring and optimization
   */
  getPerformanceStats() {
    return performanceMetrics.getStats();
  }
};
export {
  DatabaseError,
  resilientDb,
  withRetry
};
//# sourceMappingURL=resilient_db.js.map
