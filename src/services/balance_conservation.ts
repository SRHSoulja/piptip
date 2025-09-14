// SECURITY: System-wide balance conservation validation
// Ensures total user balances = total transaction amounts at all times

import { prisma } from './db.js';

interface BalanceConservationResult {
  isValid: boolean;
  totalUserBalances: string;
  totalTransactionAmounts: string;
  difference: string;
  details: string;
}

interface TokenBalanceCheck {
  tokenId: number;
  tokenSymbol: string;
  userBalanceTotal: string;
  transactionTotal: string;
  difference: string;
  isValid: boolean;
}

class BalanceConservationService {

  // SECURITY: Validate system-wide balance conservation
  static async validateSystemBalance(): Promise<BalanceConservationResult> {
    try {
      // Get total user balances across all tokens
      const userBalanceTotals = await prisma.userBalance.groupBy({
        by: ['tokenId'],
        _sum: {
          amount: true
        }
      });

      // Get total transaction amounts (credits - debits)
      const transactionTotals = await prisma.transaction.groupBy({
        by: ['tokenId'],
        _sum: {
          amount: true
        }
      });

      let totalUserBalance = 0;
      let totalTransactionAmount = 0;

      // Calculate totals across all tokens
      for (const balance of userBalanceTotals) {
        totalUserBalance += Number(balance._sum.amount || 0);
      }

      for (const transaction of transactionTotals) {
        // Only count deposits (positive) and subtract withdrawals (negative)
        const amount = Number(transaction._sum.amount || 0);
        if (amount > 0) {
          totalTransactionAmount += amount; // Deposits add to system
        } else {
          totalTransactionAmount += amount; // Withdrawals subtract from system
        }
      }

      const difference = Math.abs(totalUserBalance - totalTransactionAmount);
      const toleranceLimit = 0.001; // 0.001 token tolerance for rounding

      return {
        isValid: difference <= toleranceLimit,
        totalUserBalances: totalUserBalance.toFixed(18),
        totalTransactionAmounts: totalTransactionAmount.toFixed(18),
        difference: difference.toFixed(18),
        details: difference <= toleranceLimit
          ? 'Balance conservation maintained'
          : `VIOLATION: ${difference.toFixed(6)} token discrepancy exceeds tolerance`
      };

    } catch (error) {
      return {
        isValid: false,
        totalUserBalances: '0',
        totalTransactionAmounts: '0',
        difference: '0',
        details: `Error during validation: ${String(error)}`
      };
    }
  }

  // SECURITY: Check balance conservation per token
  static async validateTokenBalance(tokenId: number): Promise<TokenBalanceCheck> {
    try {
      const token = await prisma.token.findUnique({
        where: { id: tokenId },
        select: { symbol: true }
      });

      if (!token) {
        throw new Error(`Token ${tokenId} not found`);
      }

      // Sum all user balances for this token
      const userBalanceSum = await prisma.userBalance.aggregate({
        where: { tokenId },
        _sum: { amount: true }
      });

      // Sum all transactions for this token (deposits positive, withdrawals negative)
      const transactionSum = await prisma.transaction.aggregate({
        where: { tokenId },
        _sum: { amount: true }
      });

      const userTotal = Number(userBalanceSum._sum.amount || 0);
      const transactionTotal = Number(transactionSum._sum.amount || 0);
      const difference = Math.abs(userTotal - transactionTotal);

      return {
        tokenId,
        tokenSymbol: token.symbol,
        userBalanceTotal: userTotal.toFixed(18),
        transactionTotal: transactionTotal.toFixed(18),
        difference: difference.toFixed(18),
        isValid: difference <= 0.001 // Tolerance for rounding errors
      };

    } catch (error) {
      return {
        tokenId,
        tokenSymbol: 'UNKNOWN',
        userBalanceTotal: '0',
        transactionTotal: '0',
        difference: '0',
        isValid: false
      };
    }
  }

  // SECURITY: Comprehensive system integrity check
  static async performFullIntegrityCheck(): Promise<{
    overallValid: boolean;
    systemBalance: BalanceConservationResult;
    tokenChecks: TokenBalanceCheck[];
    negativeBalances: number;
    impossibleStates: string[];
  }> {

    const results = {
      overallValid: true,
      systemBalance: await this.validateSystemBalance(),
      tokenChecks: [] as TokenBalanceCheck[],
      negativeBalances: 0,
      impossibleStates: [] as string[]
    };

    // Check each token individually
    const tokens = await prisma.token.findMany({
      where: { active: true },
      select: { id: true }
    });

    for (const token of tokens) {
      const tokenCheck = await this.validateTokenBalance(token.id);
      results.tokenChecks.push(tokenCheck);

      if (!tokenCheck.isValid) {
        results.overallValid = false;
      }
    }

    // Check for negative balances (should be impossible with constraints)
    const negativeBalanceCount = await prisma.userBalance.count({
      where: { amount: { lt: 0 } }
    });
    results.negativeBalances = negativeBalanceCount;

    if (negativeBalanceCount > 0) {
      results.overallValid = false;
      results.impossibleStates.push(`${negativeBalanceCount} negative balances found`);
    }

    // Check for impossible user statistics
    const impossibleUsers = await prisma.user.findMany({
      where: {
        OR: [
          { wins: { lt: 0 } },
          { losses: { lt: 0 } },
          { ties: { lt: 0 } }
        ]
      },
      select: { id: true, discordId: true, wins: true, losses: true, ties: true }
    });

    if (impossibleUsers.length > 0) {
      results.overallValid = false;
      results.impossibleStates.push(`${impossibleUsers.length} users with negative statistics`);
    }

    // Overall system validation
    if (!results.systemBalance.isValid) {
      results.overallValid = false;
    }

    return results;
  }

  // SECURITY: Emergency balance audit for production monitoring
  static async emergencyBalanceAudit(): Promise<boolean> {
    console.log('🚨 Running emergency balance conservation audit...');

    const audit = await this.performFullIntegrityCheck();

    if (!audit.overallValid) {
      console.error('💥 CRITICAL: Balance conservation violation detected!');
      console.error('System Balance:', audit.systemBalance);
      console.error('Negative Balances:', audit.negativeBalances);
      console.error('Impossible States:', audit.impossibleStates);

      // Alert admin dashboard
      console.error('🚨 IMMEDIATE ACTION REQUIRED: Contact development team');

      return false;
    }

    console.log('✅ Balance conservation audit passed');
    return true;
  }

  // SECURITY: Validate balance before critical operations
  static async preTransactionValidation(userId: number, tokenId: number, amount: bigint): Promise<boolean> {
    try {
      // Check user balance
      const userBalance = await prisma.userBalance.findUnique({
        where: { userId_tokenId: { userId, tokenId } }
      });

      if (!userBalance) {
        console.warn(`⚠️ No balance record for user ${userId} token ${tokenId}`);
        return false;
      }

      // Convert to atomic for comparison
      const token = await prisma.token.findUnique({ where: { id: tokenId } });
      if (!token) return false;

      const balanceAtomic = BigInt(userBalance.amount.toString()) * BigInt(10 ** token.decimals);

      if (balanceAtomic < amount) {
        console.warn(`⚠️ Insufficient balance: User ${userId} has ${balanceAtomic} but needs ${amount}`);
        return false;
      }

      return true;

    } catch (error) {
      console.error('Error in pre-transaction validation:', error);
      return false;
    }
  }
}

// SECURITY: Automated balance monitoring (runs every hour in production)
setInterval(async () => {
  try {
    const isValid = await BalanceConservationService.emergencyBalanceAudit();

    if (!isValid) {
      // In production, this would trigger alerts to admin team
      console.error('🚨 AUTOMATED ALERT: Balance conservation violation detected at', new Date().toISOString());
    }
  } catch (error) {
    console.error('Error in automated balance monitoring:', error);
  }
}, 60 * 60 * 1000); // Every hour

export { BalanceConservationService };