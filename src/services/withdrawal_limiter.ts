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
  // In-memory cache for recent attempts (clears on restart)
  private recentAttempts = new Map<number, WithdrawalAttempt[]>();
  private cooldowns = new Map<number, Date>();

  async checkWithdrawalAllowed(
    userId: number,
    tokenId: number,
    amount: number
  ): Promise<WithdrawalLimits> {

    // 1. Check if user is still in cooldown
    const existingCooldown = this.cooldowns.get(userId);
    if (existingCooldown && existingCooldown > new Date()) {
      const minutesLeft = Math.ceil((existingCooldown.getTime() - Date.now()) / 60000);
      return {
        allowed: false,
        reason: `Cooldown active. Try again in ${minutesLeft} minutes`,
        cooldownMinutes: minutesLeft,
        nextAttemptAt: existingCooldown
      };
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

    // 3. Get 24-hour withdrawal history from database
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentWithdrawals = await prisma.transaction.findMany({
      where: {
        userId,
        type: 'WITHDRAW',
        createdAt: { gte: twentyFourHoursAgo }
      },
      select: {
        amount: true,
        createdAt: true,
        tokenId: true
      },
      orderBy: { createdAt: 'desc' }
    });

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

    if (recentWithdrawals.length >= maxWithdrawalsPerDay) {
      return {
        allowed: false,
        reason: `Daily withdrawal limit reached (${maxWithdrawalsPerDay}/day for ${accountAgeDays} day old account). Try again tomorrow.`
      };
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

    // 8. Additional protection: Token-specific limits
    const tokenWithdrawals = recentWithdrawals.filter(w => w.tokenId === tokenId);
    if (tokenWithdrawals.length >= 3) {
      return {
        allowed: false,
        reason: 'Too many withdrawals for this token today. Try a different token or wait until tomorrow.'
      };
    }

    // Set cooldown if applicable
    if (cooldownMinutes > 0) {
      const nextAttempt = new Date(Date.now() + cooldownMinutes * 60 * 1000);
      this.cooldowns.set(userId, nextAttempt);
    }

    return {
      allowed: true,
      cooldownMinutes,
      nextAttemptAt: cooldownMinutes > 0 ? new Date(Date.now() + cooldownMinutes * 60 * 1000) : undefined
    };
  }

  async recordSuccessfulWithdrawal(userId: number, amount: number) {
    // Update in-memory tracking
    const attempts = this.recentAttempts.get(userId) || [];
    attempts.push({
      userId,
      amount,
      timestamp: new Date(),
      blocked: false
    });

    // Keep only last 24 hours
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    const filtered = attempts.filter(a => a.timestamp.getTime() > twentyFourHoursAgo);
    this.recentAttempts.set(userId, filtered);
  }

  async recordBlockedWithdrawal(userId: number, amount: number, reason: string) {
    console.log(`🚫 Blocked withdrawal: User ${userId}, Amount ${amount}, Reason: ${reason}`);

    // Track blocked attempts for monitoring
    const attempts = this.recentAttempts.get(userId) || [];
    attempts.push({
      userId,
      amount,
      timestamp: new Date(),
      blocked: true
    });
    this.recentAttempts.set(userId, attempts);
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

      // Count blocked attempts from memory (approximate)
      Array.from(this.recentAttempts.values())
        .flat()
        .filter(a => a.blocked && a.timestamp >= since).length,

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
  clearCooldowns() {
    this.cooldowns.clear();
    this.recentAttempts.clear();
    console.log('🔄 All withdrawal cooldowns and attempts cleared by admin');
  }
}

export const withdrawalLimiter = new WithdrawalLimiterService();