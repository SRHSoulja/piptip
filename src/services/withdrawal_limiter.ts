// src/services/withdrawal_limiter.ts - Gas drain protection with progressive cooldowns

import { prisma } from './db.js';

interface WithdrawalAttempt {
  userId: number;
  amount: number;
  timestamp: Date;
  blocked: boolean;
}

interface WithdrawalLimits {
  allowed: boolean;
  reason?: string;
  cooldownMinutes?: number;
  nextAttemptAt?: Date;
}

class WithdrawalLimiterService {
  // SECURITY: Database-backed persistent tracking (no memory bypass or restart issues)

  async checkWithdrawalAllowed(
    userId: number,
    tokenId: number,
    amount: number
  ): Promise<WithdrawalLimits> {

    // SECURITY: Check cooldown from database (persistent across restarts)
    const recentCooldownAttempt = await prisma.withdrawalAttempt.findFirst({
      where: {
        userId,
        blocked: true,
        reason: { contains: "Cooldown" },
        createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } // 6 hours max cooldown
      },
      orderBy: { createdAt: 'desc' }
    });

    if (recentCooldownAttempt) {
      // Extract cooldown minutes from reason (e.g., "Cooldown: 60 minutes")
      const reasonMatch = recentCooldownAttempt.reason?.match(/Cooldown: (\d+) minutes/);
      const cooldownMinutes = reasonMatch ? parseInt(reasonMatch[1]) : 60;
      const cooldownEnd = new Date(recentCooldownAttempt.createdAt.getTime() + cooldownMinutes * 60000);

      if (cooldownEnd > new Date()) {
        const minutesLeft = Math.ceil((cooldownEnd.getTime() - Date.now()) / 60000);
        return {
          allowed: false,
          reason: `Cooldown active. Try again in ${minutesLeft} minutes`,
          cooldownMinutes: minutesLeft,
          nextAttemptAt: cooldownEnd
        };
      }
    }

    // 2. Get user account age
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true }
    });

    if (!user) {
      return {
        allowed: false,
        reason: 'User not found'
      };
    }

    const accountAgeDays = Math.floor((Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000));

    // 3. SECURITY: Get 24-hour withdrawal attempts from database (both successful and blocked)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
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
      orderBy: { createdAt: 'desc' }
    });

    // Count both successful and blocked attempts for rate limiting
    const recentWithdrawals = recentAttempts;

    // 4. Apply rolling 24-hour count limits based on account age
    let maxWithdrawalsPerDay: number;
    if (accountAgeDays < 1) {
      maxWithdrawalsPerDay = 1; // Brand new accounts: 1 per day
    } else if (accountAgeDays < 7) {
      maxWithdrawalsPerDay = 2; // New accounts (< 1 week): 2 per day
    } else if (accountAgeDays < 30) {
      maxWithdrawalsPerDay = 3; // Established accounts (< 1 month): 3 per day
    } else {
      maxWithdrawalsPerDay = 5; // Mature accounts (1+ month): 5 per day
    }

    // SECURITY: Atomic check and record to prevent race conditions
    // Use database transaction to ensure no concurrent bypass
    const limitCheck = await prisma.$transaction(async (tx) => {
      // Re-check count within transaction for atomic operation
      const currentAttempts = await tx.withdrawalAttempt.count({
        where: {
          userId,
          tokenId,
          createdAt: { gte: twentyFourHoursAgo }
        }
      });

      if (currentAttempts >= maxWithdrawalsPerDay) {
        // SECURITY: Record blocked attempt immediately in same transaction
        await tx.withdrawalAttempt.create({
          data: {
            userId,
            tokenId,
            amount,
            blocked: true,
            reason: `Daily limit exceeded (${currentAttempts}/${maxWithdrawalsPerDay} for ${accountAgeDays} day old account)`,
            ipAddress: 'system',
            userAgent: 'rate_limiter'
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

    // 5. Amount-based progressive cooldowns
    let cooldownMinutes = 0;
    if (amount < 10) {
      cooldownMinutes = 0; // Small amounts: instant
    } else if (amount < 100) {
      cooldownMinutes = 60; // Medium amounts: 1 hour cooldown
    } else {
      cooldownMinutes = 360; // Large amounts: 6 hour cooldown
    }

    // 6. Progressive cooldown based on recent withdrawal frequency
    const recentCount = recentWithdrawals.length;
    if (recentCount >= 2) {
      // Each withdrawal after 2nd adds 30 minutes
      cooldownMinutes += (recentCount - 1) * 30;
    }

    // 7. Check velocity patterns (multiple rapid attempts)
    const lastHour = new Date(Date.now() - 60 * 60 * 1000);
    const recentHourAttempts = recentWithdrawals.filter(w => w.createdAt >= lastHour);

    if (recentHourAttempts.length >= 2) {
      cooldownMinutes = Math.max(cooldownMinutes, 120); // Minimum 2 hours for rapid attempts
    }

    // 8. SECURITY: Token-specific limits already applied above (filtered by tokenId)

    // Cooldowns are now handled in database via recordBlockedWithdrawal method

    return {
      allowed: true,
      cooldownMinutes,
      nextAttemptAt: cooldownMinutes > 0 ? new Date(Date.now() + cooldownMinutes * 60 * 1000) : undefined
    };
  }

  // SECURITY: Record successful withdrawal in database (persistent tracking)
  async recordSuccessfulWithdrawal(userId: number, tokenId: number, amount: number) {
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
  async recordBlockedWithdrawal(
    userId: number,
    tokenId: number,
    amount: number,
    reason: string,
    ipAddress?: string,
    userAgent?: string
  ) {
    console.log(`🚫 Blocked withdrawal: User ${userId}, Amount ${amount}, Reason: ${reason}`);

    // ATOMIC: Record blocked attempt in database (prevents concurrent bypass)
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

    // Set cooldown for repeated attempts (velocity protection)
    if (reason.includes('rate limit') || reason.includes('velocity')) {
      const cooldownMinutes = reason.includes('velocity') ? 120 : 60; // 2hrs for velocity, 1hr for rate limit
      await prisma.withdrawalAttempt.create({
        data: {
          userId,
          tokenId,
          amount: 0, // Cooldown record
          blocked: true,
          reason: `Cooldown: ${cooldownMinutes} minutes`
        }
      });
    }
  }

  // Admin function to check withdrawal patterns
  async getWithdrawalStats(timeframeHours: number = 24) {
    const since = new Date(Date.now() - timeframeHours * 60 * 60 * 1000);

    const [totalWithdrawals, blockedCount, uniqueUsers, gasSpent] = await Promise.all([
      prisma.transaction.count({
        where: {
          type: 'WITHDRAW',
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
        by: ['userId'],
        where: {
          type: 'WITHDRAW',
          createdAt: { gte: since }
        },
        _count: { userId: true }
      }).then(results => results.length),

      // Estimate gas cost (each withdrawal ≈ 0.001 ETH gas)
      prisma.transaction.count({
        where: {
          type: 'WITHDRAW',
          createdAt: { gte: since }
        }
      }).then(count => count * 0.001)
    ]);

    return {
      timeframeHours,
      totalWithdrawals,
      blockedAttempts: blockedCount,
      uniqueUsers,
      estimatedGasSpentETH: gasSpent,
      successRate: totalWithdrawals > 0 ? ((totalWithdrawals - blockedCount) / totalWithdrawals * 100).toFixed(1) : '100'
    };
  }

  // Reset cooldowns (admin emergency function)
  async clearCooldowns() {
    // Clear recent withdrawal attempts from database
    const result = await prisma.withdrawalAttempt.deleteMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
      }
    });
    console.log(`🔄 Cleared ${result.count} recent withdrawal attempts from database`);
  }
}

export const withdrawalLimiter = new WithdrawalLimiterService();