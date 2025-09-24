// src/services/pipchips_service.ts - PIPChips virtual currency service with transaction logging
import { prisma } from './db.js';
import { Prisma, PipchipsTransactionType } from '@prisma/client';
import { createLogger, logFinancialOperation } from '../utils/logger.js';
import Decimal from 'decimal.js';

const logger = createLogger('pipchips-service');

interface PIPChipsTransaction {
  userId: string;
  amount: bigint;
  type: PipchipsTransactionType;
  referenceId?: string;
  description?: string;
  metadata?: any;
}

interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastClaimDate: Date | null;
  canClaim: boolean;
  hoursUntilNext: number;
  streakMultiplier: number;
}

export class PIPChipsService {
  /**
   * Get user's PIPChips balance and stats
   */
  async getUserBalance(discordId: string) {
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        pipchipsBalance: true,
        pipchipsEarnedTotal: true,
        pipchipsSpentTotal: true,
        pipchipsBoughtTotal: true,
        dailyStreak: true,
        longestDailyStreak: true,
        lastPipchipsDaily: true,
      }
    });

    if (!user) {
      throw new Error(`User ${discordId} not found`);
    }

    return {
      balance: user.pipchipsBalance,
      earnedTotal: user.pipchipsEarnedTotal,
      spentTotal: user.pipchipsSpentTotal,
      boughtTotal: user.pipchipsBoughtTotal,
      dailyStreak: user.dailyStreak,
      longestStreak: user.longestDailyStreak,
      lastDaily: user.lastPipchipsDaily,
    };
  }

  /**
   * Process PIPChips transaction with full logging and validation
   */
  async processTransaction(transaction: PIPChipsTransaction): Promise<bigint> {
    const financialLog = logFinancialOperation(
      `pipchips_${transaction.type.toLowerCase()}`,
      transaction.userId,
      transaction.amount.toString()
    );

    try {
      financialLog.start();

      const result = await prisma.$transaction(async (tx) => {
        // Get current user data
        const user = await tx.user.findUnique({
          where: { discordId: transaction.userId },
          select: {
            pipchipsBalance: true,
            pipchipsEarnedTotal: true,
            pipchipsSpentTotal: true,
            pipchipsBoughtTotal: true,
          }
        });

        if (!user) {
          throw new Error(`User ${transaction.userId} not found`);
        }

        const currentBalance = user.pipchipsBalance;
        const amount = transaction.amount;

        // Validate transaction
        if (amount < 0 && currentBalance < -amount) {
          throw new Error(`Insufficient balance: ${currentBalance} < ${-amount}`);
        }

        // Calculate new balance and totals
        const newBalance = currentBalance + amount;
        const updates: any = {
          pipchipsBalance: newBalance,
        };

        // Update running totals based on transaction type
        if (amount > 0) {
          updates.pipchipsEarnedTotal = user.pipchipsEarnedTotal + amount;

          if (transaction.type === 'PURCHASE') {
            updates.pipchipsBoughtTotal = user.pipchipsBoughtTotal + amount;
          }
        } else {
          updates.pipchipsSpentTotal = user.pipchipsSpentTotal + (-amount);
        }

        // Update user balance
        await tx.user.update({
          where: { discordId: transaction.userId },
          data: updates
        });

        // Log transaction
        await tx.pipchipsTransaction.create({
          data: {
            userId: transaction.userId,
            amount: transaction.amount,
            transactionType: transaction.type,
            referenceId: transaction.referenceId,
            balanceAfter: newBalance,
            description: transaction.description,
            metadata: transaction.metadata as any,
          }
        });

        logger.info({
          userId: transaction.userId,
          type: transaction.type,
          amount: amount.toString(),
          newBalance: newBalance.toString(),
          referenceId: transaction.referenceId,
        }, 'PIPChips transaction processed');

        return newBalance;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });

      financialLog.success({ newBalance: result.toString() });
      return result;

    } catch (error) {
      financialLog.error(error as Error);
      logger.error({
        error,
        transaction,
      }, 'PIPChips transaction failed');
      throw error;
    }
  }

  /**
   * Credit PIPChips to user (positive amount)
   */
  async creditPIPChips(
    userId: string,
    amount: bigint,
    type: PipchipsTransactionType,
    referenceId?: string,
    description?: string,
    metadata?: any
  ): Promise<bigint> {
    if (amount <= 0) {
      throw new Error('Credit amount must be positive');
    }

    return this.processTransaction({
      userId,
      amount,
      type,
      referenceId,
      description,
      metadata,
    });
  }

  /**
   * Debit PIPChips from user (negative amount)
   */
  async debitPIPChips(
    userId: string,
    amount: bigint,
    type: PipchipsTransactionType,
    referenceId?: string,
    description?: string,
    metadata?: any
  ): Promise<bigint> {
    if (amount <= 0) {
      throw new Error('Debit amount must be positive');
    }

    return this.processTransaction({
      userId,
      amount: -amount,
      type,
      referenceId,
      description,
      metadata,
    });
  }

  /**
   * Get daily streak information and eligibility
   */
  async getStreakInfo(discordId: string): Promise<StreakInfo> {
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        dailyStreak: true,
        longestDailyStreak: true,
        lastPipchipsDaily: true,
      }
    });

    if (!user) {
      throw new Error(`User ${discordId} not found`);
    }

    const now = new Date();
    const lastClaim = user.lastPipchipsDaily;

    let canClaim = true;
    let hoursUntilNext = 0;

    if (lastClaim) {
      const hoursSinceLastClaim = (now.getTime() - lastClaim.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastClaim < 24) {
        canClaim = false;
        hoursUntilNext = 24 - hoursSinceLastClaim;
      }
    }

    // Calculate streak multiplier based on current streak
    const streakMultiplier = this.calculateStreakMultiplier(user.dailyStreak);

    return {
      currentStreak: user.dailyStreak,
      longestStreak: user.longestDailyStreak,
      lastClaimDate: lastClaim,
      canClaim,
      hoursUntilNext,
      streakMultiplier,
    };
  }

  /**
   * Process daily bonus claim with streak logic
   */
  async claimDailyBonus(discordId: string): Promise<{
    amount: bigint;
    newStreak: number;
    streakMultiplier: number;
    newBalance: bigint;
  }> {
    const streakInfo = await this.getStreakInfo(discordId);

    if (!streakInfo.canClaim) {
      throw new Error(`Cannot claim yet. Wait ${streakInfo.hoursUntilNext.toFixed(1)} hours.`);
    }

    // Get base daily amount from admin settings
    const baseDailyAmount = await this.getAdminSetting('daily_bonus_amount', 500);

    return await prisma.$transaction(async (tx) => {
      // Update streak
      const user = await tx.user.findUnique({
        where: { discordId },
        select: {
          dailyStreak: true,
          longestDailyStreak: true,
          lastPipchipsDaily: true,
        }
      });

      if (!user) {
        throw new Error(`User ${discordId} not found`);
      }

      const now = new Date();
      let newStreak = 1;

      // Check if streak continues (claimed within 48 hours)
      if (user.lastPipchipsDaily) {
        const hoursSinceLastClaim = (now.getTime() - user.lastPipchipsDaily.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastClaim < 48) {
          newStreak = user.dailyStreak + 1;
        }
      }

      const newLongestStreak = Math.max(newStreak, user.longestDailyStreak);
      const streakMultiplier = this.calculateStreakMultiplier(newStreak);
      const totalAmount = BigInt(Math.floor(baseDailyAmount * streakMultiplier));

      // Update user streak data
      await tx.user.update({
        where: { discordId },
        data: {
          dailyStreak: newStreak,
          longestDailyStreak: newLongestStreak,
          lastPipchipsDaily: now,
        }
      });

      // Credit PIPChips (use internal transaction to avoid double transaction)
      const balanceAfter = await this.processTransactionInternal(tx, {
        userId: discordId,
        amount: totalAmount,
        type: newStreak === 1 ? 'DAILY_BONUS' : 'STREAK_BONUS',
        description: `Daily bonus (${newStreak} day streak, ${streakMultiplier}x multiplier)`,
        metadata: {
          baseAmount: baseDailyAmount,
          streakMultiplier,
          streakDays: newStreak,
        }
      });

      logger.info({
        userId: discordId,
        streak: newStreak,
        multiplier: streakMultiplier,
        amount: totalAmount.toString(),
        newBalance: balanceAfter.toString(),
      }, 'Daily bonus claimed');

      return {
        amount: totalAmount,
        newStreak,
        streakMultiplier,
        newBalance: balanceAfter,
      };
    });
  }

  /**
   * Calculate streak multiplier based on days
   */
  private calculateStreakMultiplier(streakDays: number): number {
    // Default multipliers - can be overridden by admin settings
    if (streakDays >= 100) return 10.0;
    if (streakDays >= 30) return 5.0;
    if (streakDays >= 7) return 2.0;
    return 1.0;
  }

  /**
   * Internal transaction processor for use within existing transactions
   */
  private async processTransactionInternal(
    tx: Prisma.TransactionClient,
    transaction: PIPChipsTransaction
  ): Promise<bigint> {
    // Get current user data
    const user = await tx.user.findUnique({
      where: { discordId: transaction.userId },
      select: {
        pipchipsBalance: true,
        pipchipsEarnedTotal: true,
        pipchipsSpentTotal: true,
        pipchipsBoughtTotal: true,
      }
    });

    if (!user) {
      throw new Error(`User ${transaction.userId} not found`);
    }

    const currentBalance = user.pipchipsBalance;
    const amount = transaction.amount;

    // Validate transaction
    if (amount < 0 && currentBalance < -amount) {
      throw new Error(`Insufficient balance: ${currentBalance} < ${-amount}`);
    }

    // Calculate new balance and totals
    const newBalance = currentBalance + amount;
    const updates: any = {
      pipchipsBalance: newBalance,
    };

    // Update running totals based on transaction type
    if (amount > 0) {
      updates.pipchipsEarnedTotal = user.pipchipsEarnedTotal + amount;

      if (transaction.type === 'PURCHASE') {
        updates.pipchipsBoughtTotal = user.pipchipsBoughtTotal + amount;
      }
    } else {
      updates.pipchipsSpentTotal = user.pipchipsSpentTotal + (-amount);
    }

    // Update user balance
    await tx.user.update({
      where: { discordId: transaction.userId },
      data: updates
    });

    // Log transaction
    await tx.pipchipsTransaction.create({
      data: {
        userId: transaction.userId,
        amount: transaction.amount,
        transactionType: transaction.type,
        referenceId: transaction.referenceId,
        balanceAfter: newBalance,
        description: transaction.description,
        metadata: transaction.metadata as any,
      }
    });

    return newBalance;
  }

  /**
   * Get admin setting with default fallback
   */
  private async getAdminSetting(key: string, defaultValue: any): Promise<any> {
    try {
      const setting = await prisma.adminSetting.findUnique({
        where: { key }
      });

      return setting ? setting.value : defaultValue;
    } catch (error) {
      logger.warn({ key, error }, 'Failed to get admin setting, using default');
      return defaultValue;
    }
  }

  /**
   * Get user's transaction history
   */
  async getTransactionHistory(
    discordId: string,
    limit = 50,
    offset = 0,
    type?: PipchipsTransactionType
  ) {
    const where: any = { userId: discordId };
    if (type) {
      where.transactionType = type;
    }

    return await prisma.pipchipsTransaction.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        transactionType: true,
        referenceId: true,
        balanceAfter: true,
        description: true,
        createdAt: true,
      }
    });
  }

  /**
   * Initialize new user with starting balance
   */
  async initializeNewUser(discordId: string): Promise<void> {
    const startingBalance = await this.getAdminSetting('starting_pipchips', 10000);

    await this.creditPIPChips(
      discordId,
      BigInt(startingBalance),
      'STARTING_BONUS',
      undefined,
      'Welcome bonus for new user'
    );

    logger.info({
      userId: discordId,
      amount: startingBalance,
    }, 'New user initialized with starting PIPChips');
  }

  /**
   * Validate sufficient balance for operation
   */
  async validateBalance(discordId: string, requiredAmount: bigint): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: { pipchipsBalance: true }
    });

    return user ? user.pipchipsBalance >= requiredAmount : false;
  }

  /**
   * Get PIPChips statistics for admin dashboard
   */
  async getSystemStats() {
    const [
      totalUsers,
      totalCirculation,
      totalEarned,
      totalSpent,
      totalBought,
      activeUsers24h,
      dailyClaims24h
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.aggregate({
        _sum: { pipchipsBalance: true }
      }),
      prisma.user.aggregate({
        _sum: { pipchipsEarnedTotal: true }
      }),
      prisma.user.aggregate({
        _sum: { pipchipsSpentTotal: true }
      }),
      prisma.user.aggregate({
        _sum: { pipchipsBoughtTotal: true }
      }),
      prisma.pipchipsTransaction.groupBy({
        by: ['userId'],
        where: {
          createdAt: {
            gte: new Date(Date.now() - 86400000) // 24 hours
          }
        }
      }),
      prisma.pipchipsTransaction.count({
        where: {
          transactionType: { in: ['DAILY_BONUS', 'STREAK_BONUS'] },
          createdAt: {
            gte: new Date(Date.now() - 86400000) // 24 hours
          }
        }
      })
    ]);

    return {
      totalUsers,
      totalCirculation: totalCirculation._sum.pipchipsBalance || 0n,
      totalEarned: totalEarned._sum.pipchipsEarnedTotal || 0n,
      totalSpent: totalSpent._sum.pipchipsSpentTotal || 0n,
      totalBought: totalBought._sum.pipchipsBoughtTotal || 0n,
      activeUsers24h: activeUsers24h.length,
      dailyClaims24h,
    };
  }
}

// Export singleton instance
export const pipchipsService = new PIPChipsService();

console.log('🎰 PIPChips service initialized with transaction logging and streak bonuses');