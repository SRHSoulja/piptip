import { prisma } from "./db.js";
import { Prisma } from "@prisma/client";
import { createLogger, logFinancialOperation } from "../utils/logger.js";
import { logCompleteTransaction } from "./tx_logger.js";
const logger = createLogger("pipchips-service");
const PIPCHIPS_TOKEN_ID = 2;
class PIPChipsService {
  /**
   * Get user's PIPChips balance and stats
   */
  async getUserBalance(discordId) {
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        pipchipsBalance: true,
        pipchipsEarnedTotal: true,
        pipchipsSpentTotal: true,
        pipchipsBoughtTotal: true,
        dailyStreak: true,
        longestDailyStreak: true,
        lastPipchipsDaily: true
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
      lastDaily: user.lastPipchipsDaily
    };
  }
  /**
   * Process PIPChips transaction with full logging and validation
   */
  async processTransaction(transaction) {
    const financialLog = logFinancialOperation(
      `pipchips_${transaction.type.toLowerCase()}`,
      transaction.userId,
      transaction.amount.toString()
    );
    try {
      financialLog.start();
      const result = await prisma.$transaction(async (tx) => {
        return await this.processTransactionInternal(tx, transaction);
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
      financialLog.success({ newBalance: result.toString() });
      return result;
    } catch (error) {
      financialLog.error(error);
      logger.error({
        error,
        transaction
      }, "PIPChips transaction failed");
      throw error;
    }
  }
  /**
   * Credit PIPChips to user (positive amount)
   */
  async creditPIPChips(userId, amount, type, referenceId, description, metadata) {
    if (amount <= 0) {
      throw new Error("Credit amount must be positive");
    }
    return this.processTransaction({
      userId,
      amount,
      type,
      referenceId,
      description,
      metadata
    });
  }
  /**
   * Debit PIPChips from user (negative amount)
   */
  async debitPIPChips(userId, amount, type, referenceId, description, metadata) {
    if (amount <= 0) {
      throw new Error("Debit amount must be positive");
    }
    return this.processTransaction({
      userId,
      amount: -amount,
      type,
      referenceId,
      description,
      metadata
    });
  }
  /**
   * Get daily streak information and eligibility
   */
  async getStreakInfo(discordId) {
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        dailyStreak: true,
        longestDailyStreak: true,
        lastPipchipsDaily: true
      }
    });
    if (!user) {
      throw new Error(`User ${discordId} not found`);
    }
    const now = /* @__PURE__ */ new Date();
    const lastClaim = user.lastPipchipsDaily;
    let canClaim = true;
    let hoursUntilNext = 0;
    if (lastClaim) {
      const hoursSinceLastClaim = (now.getTime() - lastClaim.getTime()) / (1e3 * 60 * 60);
      if (hoursSinceLastClaim < 24) {
        canClaim = false;
        hoursUntilNext = 24 - hoursSinceLastClaim;
      }
    }
    const streakMultiplier = this.calculateStreakMultiplier(user.dailyStreak);
    return {
      currentStreak: user.dailyStreak,
      longestStreak: user.longestDailyStreak,
      lastClaimDate: lastClaim,
      canClaim,
      hoursUntilNext,
      streakMultiplier
    };
  }
  /**
   * Process daily bonus claim with streak logic
   */
  async claimDailyBonus(discordId) {
    const streakInfo = await this.getStreakInfo(discordId);
    if (!streakInfo.canClaim) {
      throw new Error(`Cannot claim yet. Wait ${streakInfo.hoursUntilNext.toFixed(1)} hours.`);
    }
    const baseDailyAmount = await this.getAdminSetting("daily_bonus_amount", 500);
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { discordId },
        select: {
          dailyStreak: true,
          longestDailyStreak: true,
          lastPipchipsDaily: true
        }
      });
      if (!user) {
        throw new Error(`User ${discordId} not found`);
      }
      const now = /* @__PURE__ */ new Date();
      let newStreak = 1;
      if (user.lastPipchipsDaily) {
        const hoursSinceLastClaim = (now.getTime() - user.lastPipchipsDaily.getTime()) / (1e3 * 60 * 60);
        if (hoursSinceLastClaim < 48) {
          newStreak = user.dailyStreak + 1;
        }
      }
      const newLongestStreak = Math.max(newStreak, user.longestDailyStreak);
      const streakMultiplier = this.calculateStreakMultiplier(newStreak);
      const totalAmount = BigInt(Math.floor(baseDailyAmount * streakMultiplier));
      await tx.user.update({
        where: { discordId },
        data: {
          dailyStreak: newStreak,
          longestDailyStreak: newLongestStreak,
          lastPipchipsDaily: now
        }
      });
      const balanceAfter = await this.processTransactionInternal(tx, {
        userId: discordId,
        amount: totalAmount,
        type: newStreak === 1 ? "DAILY_BONUS" : "STREAK_BONUS",
        description: `Daily bonus (${newStreak} day streak, ${streakMultiplier}x multiplier)`,
        metadata: {
          baseAmount: baseDailyAmount,
          streakMultiplier,
          streakDays: newStreak
        }
      });
      logger.info({
        userId: discordId,
        streak: newStreak,
        multiplier: streakMultiplier,
        amount: totalAmount.toString(),
        newBalance: balanceAfter.toString()
      }, "Daily bonus claimed");
      return {
        amount: totalAmount,
        newStreak,
        streakMultiplier,
        newBalance: balanceAfter
      };
    });
  }
  /**
   * Calculate streak multiplier based on days
   */
  calculateStreakMultiplier(streakDays) {
    if (streakDays >= 100) return 10;
    if (streakDays >= 30) return 5;
    if (streakDays >= 7) return 2;
    return 1;
  }
  /**
   * Internal transaction processor for use within existing transactions
   */
  async processTransactionInternal(tx, transaction) {
    const user = await tx.user.findUnique({
      where: { discordId: transaction.userId },
      select: {
        id: true,
        pipchipsBalance: true,
        pipchipsEarnedTotal: true,
        pipchipsSpentTotal: true,
        pipchipsBoughtTotal: true
      }
    });
    if (!user) {
      throw new Error(`User ${transaction.userId} not found`);
    }
    const currentBalance = user.pipchipsBalance;
    const amount = transaction.amount;
    if (amount < 0 && currentBalance < -amount) {
      throw new Error(`Insufficient balance: ${currentBalance} < ${-amount}`);
    }
    const newBalance = currentBalance + amount;
    const updates = {
      pipchipsBalance: newBalance
    };
    if (amount > 0) {
      updates.pipchipsEarnedTotal = user.pipchipsEarnedTotal + amount;
      if (transaction.type === "PURCHASE") {
        updates.pipchipsBoughtTotal = user.pipchipsBoughtTotal + amount;
      }
    } else {
      updates.pipchipsSpentTotal = user.pipchipsSpentTotal + -amount;
    }
    await tx.user.update({
      where: { discordId: transaction.userId },
      data: updates
    });
    await tx.pipchipsTransaction.create({
      data: {
        userId: transaction.userId,
        amount: transaction.amount,
        transactionType: transaction.type,
        referenceId: transaction.referenceId,
        balanceAfter: newBalance,
        description: transaction.description,
        metadata: transaction.metadata
      }
    });
    const operation = this.mapPipchipsTypeToTransactionType(transaction.type);
    try {
      const logResult = await logCompleteTransaction(tx, {
        source: "BOT",
        operation,
        userId: user.id,
        idempotencyKey: `pipchips_${transaction.userId}_${Date.now()}_${Math.random()}`,
        opRef: transaction.referenceId,
        metadata: {
          description: transaction.description,
          pipchipsType: transaction.type,
          referenceId: transaction.referenceId
        },
        balanceChanges: [
          {
            tokenId: PIPCHIPS_TOKEN_ID,
            userId: user.id,
            amountDelta: amount,
            reason: this.getPipchipsBalanceDeltaReason(transaction.type, amount > 0n)
          }
        ]
      });
      logger.info({
        operation,
        transactionId: logResult.transactionId,
        balanceDeltaCount: logResult.balanceDeltaIds.length
      }, "PIPChips transaction logged to unified system");
    } catch (error) {
      logger.error({
        error,
        operation,
        userId: user.id,
        amount: amount.toString()
      }, "Failed to log PIPChips transaction to unified system");
    }
    return newBalance;
  }
  /**
   * Map PipchipsTransactionType to Transaction type
   */
  mapPipchipsTypeToTransactionType(type) {
    switch (type) {
      case "PREDICTION_BET":
        return "PIPCHIPS_BET";
      case "BET_WON":
        return "PIPCHIPS_PAYOUT";
      case "BET_REFUNDED":
        return "PIPCHIPS_REFUND";
      case "DAILY_BONUS":
      case "STREAK_BONUS":
      case "STARTING_BONUS":
        return "PIPCHIPS_BONUS";
      case "PURCHASE":
        return "PIPCHIPS_PURCHASE";
      default:
        return "PIPCHIPS_OTHER";
    }
  }
  /**
   * Get appropriate reason for BalanceDelta
   */
  getPipchipsBalanceDeltaReason(type, isCredit) {
    if (isCredit) {
      switch (type) {
        case "BET_WON":
          return "prediction_won";
        case "BET_REFUNDED":
          return "prediction_refunded";
        case "DAILY_BONUS":
          return "daily_bonus";
        case "STREAK_BONUS":
          return "streak_bonus";
        case "STARTING_BONUS":
          return "welcome_bonus";
        case "PURCHASE":
          return "pipchips_purchase";
        default:
          return "pipchips_credit";
      }
    } else {
      switch (type) {
        case "PREDICTION_BET":
          return "prediction_bet";
        default:
          return "pipchips_debit";
      }
    }
  }
  /**
   * Get admin setting with default fallback
   */
  async getAdminSetting(key, defaultValue) {
    try {
      const setting = await prisma.adminSetting.findUnique({
        where: { key }
      });
      return setting ? setting.value : defaultValue;
    } catch (error) {
      logger.warn({ key, error }, "Failed to get admin setting, using default");
      return defaultValue;
    }
  }
  /**
   * Get user's transaction history
   */
  async getTransactionHistory(discordId, limit = 50, offset = 0, type) {
    const where = { userId: discordId };
    if (type) {
      where.transactionType = type;
    }
    return await prisma.pipchipsTransaction.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amount: true,
        transactionType: true,
        referenceId: true,
        balanceAfter: true,
        description: true,
        createdAt: true
      }
    });
  }
  /**
   * Initialize new user with starting balance
   */
  async initializeNewUser(discordId) {
    const startingBalance = await this.getAdminSetting("starting_pipchips", 1e4);
    await this.creditPIPChips(
      discordId,
      BigInt(startingBalance),
      "STARTING_BONUS",
      void 0,
      "Welcome bonus for new user"
    );
    logger.info({
      userId: discordId,
      amount: startingBalance
    }, "New user initialized with starting PIPChips");
  }
  /**
   * Validate sufficient balance for operation
   */
  async validateBalance(discordId, requiredAmount) {
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
        by: ["userId"],
        where: {
          createdAt: {
            gte: new Date(Date.now() - 864e5)
            // 24 hours
          }
        }
      }),
      prisma.pipchipsTransaction.count({
        where: {
          transactionType: { in: ["DAILY_BONUS", "STREAK_BONUS"] },
          createdAt: {
            gte: new Date(Date.now() - 864e5)
            // 24 hours
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
      dailyClaims24h
    };
  }
}
const pipchipsService = new PIPChipsService();
console.log("\u{1F3B0} PIPChips service initialized with transaction logging and streak bonuses");
export {
  PIPChipsService,
  pipchipsService
};
//# sourceMappingURL=pipchips_service.js.map
