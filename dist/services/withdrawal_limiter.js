import { prisma } from "./db.js";
class WithdrawalLimiterService {
  // SECURITY: Database-backed persistent tracking (no memory bypass or restart issues)
  async checkWithdrawalAllowed(userId, tokenId, amount) {
    const recentCooldownAttempt = await prisma.withdrawalAttempt.findFirst({
      where: {
        userId,
        blocked: true,
        reason: { contains: "Cooldown" },
        createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1e3) }
        // 6 hours max cooldown
      },
      orderBy: { createdAt: "desc" }
    });
    if (recentCooldownAttempt) {
      const reasonMatch = recentCooldownAttempt.reason?.match(/Cooldown: (\d+) minutes/);
      const cooldownMinutes2 = reasonMatch ? parseInt(reasonMatch[1]) : 60;
      const cooldownEnd = new Date(recentCooldownAttempt.createdAt.getTime() + cooldownMinutes2 * 6e4);
      if (cooldownEnd > /* @__PURE__ */ new Date()) {
        const minutesLeft = Math.ceil((cooldownEnd.getTime() - Date.now()) / 6e4);
        return {
          allowed: false,
          reason: `Cooldown active. Try again in ${minutesLeft} minutes`,
          cooldownMinutes: minutesLeft,
          nextAttemptAt: cooldownEnd
        };
      }
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true }
    });
    if (!user) {
      return {
        allowed: false,
        reason: "User not found"
      };
    }
    const accountAgeDays = Math.floor((Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1e3));
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1e3);
    const recentAttempts = await prisma.withdrawalAttempt.findMany({
      where: {
        userId,
        tokenId,
        createdAt: { gte: twentyFourHoursAgo }
      },
      select: {
        amount: true,
        createdAt: true,
        tokenId: true,
        blocked: true,
        reason: true
      },
      orderBy: { createdAt: "desc" }
    });
    const recentWithdrawals = recentAttempts;
    let maxWithdrawalsPerDay;
    if (accountAgeDays < 1) {
      maxWithdrawalsPerDay = 1;
    } else if (accountAgeDays < 7) {
      maxWithdrawalsPerDay = 2;
    } else if (accountAgeDays < 30) {
      maxWithdrawalsPerDay = 3;
    } else {
      maxWithdrawalsPerDay = 5;
    }
    const limitCheck = await prisma.$transaction(async (tx) => {
      const currentAttempts = await tx.withdrawalAttempt.count({
        where: {
          userId,
          tokenId,
          createdAt: { gte: twentyFourHoursAgo }
        }
      });
      if (currentAttempts >= maxWithdrawalsPerDay) {
        await tx.withdrawalAttempt.create({
          data: {
            userId,
            tokenId,
            amount,
            blocked: true,
            reason: `Daily limit exceeded (${currentAttempts}/${maxWithdrawalsPerDay} for ${accountAgeDays} day old account)`,
            ipAddress: "system",
            userAgent: "rate_limiter"
          }
        });
        return {
          allowed: false,
          reason: `Daily withdrawal limit reached (${maxWithdrawalsPerDay}/day for ${accountAgeDays} day old account). Try again tomorrow.`
        };
      }
      return { allowed: true };
    });
    if (!limitCheck.allowed) {
      return limitCheck;
    }
    let cooldownMinutes = 0;
    if (amount < 10) {
      cooldownMinutes = 0;
    } else if (amount < 100) {
      cooldownMinutes = 60;
    } else {
      cooldownMinutes = 360;
    }
    const recentCount = recentWithdrawals.length;
    if (recentCount >= 2) {
      cooldownMinutes += (recentCount - 1) * 30;
    }
    const lastHour = new Date(Date.now() - 60 * 60 * 1e3);
    const recentHourAttempts = recentWithdrawals.filter((w) => w.createdAt >= lastHour);
    if (recentHourAttempts.length >= 2) {
      cooldownMinutes = Math.max(cooldownMinutes, 120);
    }
    return {
      allowed: true,
      cooldownMinutes,
      nextAttemptAt: cooldownMinutes > 0 ? new Date(Date.now() + cooldownMinutes * 60 * 1e3) : void 0
    };
  }
  // SECURITY: Record successful withdrawal in database (persistent tracking)
  async recordSuccessfulWithdrawal(userId, tokenId, amount) {
    await prisma.withdrawalAttempt.create({
      data: {
        userId,
        tokenId,
        amount,
        blocked: false,
        reason: "Successful withdrawal"
      }
    });
  }
  // SECURITY: Record blocked withdrawal in database (persistent tracking)
  async recordBlockedWithdrawal(userId, tokenId, amount, reason, ipAddress, userAgent) {
    console.log(`\u{1F6AB} Blocked withdrawal: User ${userId}, Amount ${amount}, Reason: ${reason}`);
    await prisma.withdrawalAttempt.create({
      data: {
        userId,
        tokenId,
        amount,
        blocked: true,
        reason,
        ipAddress,
        userAgent
      }
    });
    if (reason.includes("rate limit") || reason.includes("velocity")) {
      const cooldownMinutes = reason.includes("velocity") ? 120 : 60;
      await prisma.withdrawalAttempt.create({
        data: {
          userId,
          tokenId,
          amount: 0,
          // Cooldown record
          blocked: true,
          reason: `Cooldown: ${cooldownMinutes} minutes`
        }
      });
    }
  }
  // Admin function to check withdrawal patterns
  async getWithdrawalStats(timeframeHours = 24) {
    const since = new Date(Date.now() - timeframeHours * 60 * 60 * 1e3);
    const [totalWithdrawals, blockedCount, uniqueUsers, gasSpent] = await Promise.all([
      prisma.transaction.count({
        where: {
          type: "WITHDRAW",
          createdAt: { gte: since }
        }
      }),
      // SECURITY: Count blocked attempts from database (accurate persistent tracking)
      prisma.withdrawalAttempt.count({
        where: {
          blocked: true,
          createdAt: { gte: since }
        }
      }),
      prisma.transaction.groupBy({
        by: ["userId"],
        where: {
          type: "WITHDRAW",
          createdAt: { gte: since }
        },
        _count: { userId: true }
      }).then((results) => results.length),
      // Estimate gas cost (each withdrawal ≈ 0.001 ETH gas)
      prisma.transaction.count({
        where: {
          type: "WITHDRAW",
          createdAt: { gte: since }
        }
      }).then((count) => count * 1e-3)
    ]);
    return {
      timeframeHours,
      totalWithdrawals,
      blockedAttempts: blockedCount,
      uniqueUsers,
      estimatedGasSpentETH: gasSpent,
      successRate: totalWithdrawals > 0 ? ((totalWithdrawals - blockedCount) / totalWithdrawals * 100).toFixed(1) : "100"
    };
  }
  // Reset cooldowns (admin emergency function)
  async clearCooldowns() {
    const result = await prisma.withdrawalAttempt.deleteMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1e3) }
        // Last 24 hours
      }
    });
    console.log(`\u{1F504} Cleared ${result.count} recent withdrawal attempts from database`);
  }
}
const withdrawalLimiter = new WithdrawalLimiterService();
export {
  withdrawalLimiter
};
//# sourceMappingURL=withdrawal_limiter.js.map
