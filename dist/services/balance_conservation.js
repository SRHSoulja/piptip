import { prisma } from "./db.js";
class BalanceConservationService {
  // SECURITY: Validate system-wide balance conservation
  static async validateSystemBalance() {
    try {
      const userBalanceTotals = await prisma.userBalance.groupBy({
        by: ["tokenId"],
        _sum: {
          amount: true
        }
      });
      const transactionTotals = await prisma.transaction.groupBy({
        by: ["tokenId"],
        _sum: {
          amount: true
        }
      });
      let totalUserBalance = 0;
      let totalTransactionAmount = 0;
      for (const balance of userBalanceTotals) {
        totalUserBalance += Number(balance._sum.amount || 0);
      }
      for (const transaction of transactionTotals) {
        const amount = Number(transaction._sum.amount || 0);
        totalTransactionAmount += amount;
      }
      const difference = Math.abs(totalUserBalance - totalTransactionAmount);
      const toleranceLimit = 1e-3;
      return {
        isValid: difference <= toleranceLimit,
        totalUserBalances: totalUserBalance.toFixed(18),
        totalTransactionAmounts: totalTransactionAmount.toFixed(18),
        difference: difference.toFixed(18),
        details: difference <= toleranceLimit ? "Balance conservation maintained" : `VIOLATION: ${difference.toFixed(6)} token discrepancy exceeds tolerance`
      };
    } catch (error) {
      return {
        isValid: false,
        totalUserBalances: "0",
        totalTransactionAmounts: "0",
        difference: "0",
        details: `Error during validation: ${String(error)}`
      };
    }
  }
  // SECURITY: Check balance conservation per token
  static async validateTokenBalance(tokenId) {
    try {
      const token = await prisma.token.findUnique({
        where: { id: tokenId },
        select: { symbol: true }
      });
      if (!token) {
        throw new Error(`Token ${tokenId} not found`);
      }
      const userBalanceSum = await prisma.userBalance.aggregate({
        where: { tokenId },
        _sum: { amount: true }
      });
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
        isValid: difference <= 1e-3
        // Tolerance for rounding errors
      };
    } catch (error) {
      return {
        tokenId,
        tokenSymbol: "UNKNOWN",
        userBalanceTotal: "0",
        transactionTotal: "0",
        difference: "0",
        isValid: false
      };
    }
  }
  // SECURITY: Comprehensive system integrity check
  static async performFullIntegrityCheck() {
    const results = {
      overallValid: true,
      systemBalance: await this.validateSystemBalance(),
      tokenChecks: [],
      negativeBalances: 0,
      impossibleStates: []
    };
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
    const negativeBalanceCount = await prisma.userBalance.count({
      where: { amount: { lt: 0 } }
    });
    results.negativeBalances = negativeBalanceCount;
    if (negativeBalanceCount > 0) {
      results.overallValid = false;
      results.impossibleStates.push(`${negativeBalanceCount} negative balances found`);
    }
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
    if (!results.systemBalance.isValid) {
      results.overallValid = false;
    }
    return results;
  }
  // SECURITY: Emergency balance audit for production monitoring
  static async emergencyBalanceAudit() {
    console.log("\u{1F6A8} Running emergency balance conservation audit...");
    const audit = await this.performFullIntegrityCheck();
    if (!audit.overallValid) {
      console.error("\u{1F4A5} CRITICAL: Balance conservation violation detected!");
      console.error("System Balance:", audit.systemBalance);
      console.error("Negative Balances:", audit.negativeBalances);
      console.error("Impossible States:", audit.impossibleStates);
      console.error("\u{1F6A8} IMMEDIATE ACTION REQUIRED: Contact development team");
      return false;
    }
    console.log("\u2705 Balance conservation audit passed");
    return true;
  }
  // SECURITY: Validate balance before critical operations
  static async preTransactionValidation(userId, tokenId, amount) {
    try {
      const userBalance = await prisma.userBalance.findUnique({
        where: { userId_tokenId: { userId, tokenId } }
      });
      if (!userBalance) {
        console.warn(`\u26A0\uFE0F No balance record for user ${userId} token ${tokenId}`);
        return false;
      }
      const token = await prisma.token.findUnique({ where: { id: tokenId } });
      if (!token) return false;
      const balanceDecimal = Number(userBalance.amount.toString());
      const balanceAtomic = BigInt(Math.floor(balanceDecimal * 10 ** token.decimals));
      if (balanceAtomic < amount) {
        console.warn(`\u26A0\uFE0F Insufficient balance: User ${userId} has ${balanceAtomic} but needs ${amount}`);
        return false;
      }
      return true;
    } catch (error) {
      console.error("Error in pre-transaction validation:", error);
      return false;
    }
  }
}
setInterval(async () => {
  try {
    const isValid = await BalanceConservationService.emergencyBalanceAudit();
    if (!isValid) {
      console.error("\u{1F6A8} AUTOMATED ALERT: Balance conservation violation detected at", (/* @__PURE__ */ new Date()).toISOString());
    }
  } catch (error) {
    console.error("Error in automated balance monitoring:", error);
  }
}, 60 * 60 * 1e3);
export {
  BalanceConservationService
};
//# sourceMappingURL=balance_conservation.js.map
