import { prisma } from "./db.js";
import { logCompleteTransaction } from "./tx_logger.js";
const TPIP_TOKEN_ID = 4;
const TPIP_PURCHASE_RATE = 1;
async function purchaseTPIP(params) {
  const { userId, discordId, tokenId, amount, guildId } = params;
  if (typeof amount !== "bigint") {
    return {
      success: false,
      error: `Invalid amount type: expected bigint, got ${typeof amount} (value: ${amount})`
    };
  }
  try {
    const [sourceToken, tpipToken] = await Promise.all([
      prisma.token.findUnique({ where: { id: tokenId } }),
      prisma.token.findFirst({ where: { symbol: "TPIP" } })
    ]);
    if (!sourceToken) {
      return { success: false, error: "Source token not found" };
    }
    if (!tpipToken) {
      return { success: false, error: "TPIP token not configured" };
    }
    const tpipAmount = amount / 10n ** BigInt(sourceToken.decimals);
    const result = await prisma.$transaction(async (tx) => {
      const userBalance = await tx.userBalance.findUnique({
        where: {
          userId_tokenId: { userId, tokenId }
        }
      });
      const currentBalance = userBalance ? BigInt(userBalance.amount.toFixed(0)) : 0n;
      if (currentBalance < amount) {
        throw new Error(`Insufficient ${sourceToken.symbol} balance`);
      }
      const debitTx = await logCompleteTransaction(tx, {
        source: "BOT",
        operation: "TPIP_PURCHASE",
        userId,
        guildId: guildId ?? null,
        idempotencyKey: `tpip_purchase_debit_${userId}_${Date.now()}`,
        opRef: `tpip_purchase_${userId}`,
        metadata: {
          sourceToken: sourceToken.symbol,
          sourceAmount: amount.toString(),
          tpipAmount: tpipAmount.toString(),
          rate: TPIP_PURCHASE_RATE
        },
        balanceChanges: [{
          tokenId,
          userId,
          amountDelta: -amount,
          // Debit Abstract token
          reason: "tpip_purchase"
        }]
      });
      await tx.userBalance.update({
        where: {
          userId_tokenId: { userId, tokenId }
        },
        data: {
          amount: { decrement: amount.toString() }
        }
      });
      const creditTx = await logCompleteTransaction(tx, {
        source: "BOT",
        operation: "TPIP_CREDIT",
        userId,
        guildId: guildId ?? null,
        idempotencyKey: `tpip_purchase_credit_${userId}_${Date.now()}`,
        opRef: `tpip_purchase_${userId}`,
        metadata: {
          sourceToken: sourceToken.symbol,
          sourceAmount: amount.toString(),
          tpipAmount: tpipAmount.toString(),
          rate: TPIP_PURCHASE_RATE
        },
        balanceChanges: [{
          tokenId: tpipToken.id,
          userId,
          amountDelta: tpipAmount,
          // Credit TPIP
          reason: "tpip_purchase"
        }]
      });
      await tx.userBalance.upsert({
        where: {
          userId_tokenId: { userId, tokenId: tpipToken.id }
        },
        create: {
          userId,
          tokenId: tpipToken.id,
          amount: tpipAmount.toString()
        },
        update: {
          amount: { increment: tpipAmount.toString() }
        }
      });
      return { debitTxId: debitTx.transactionId, creditTxId: creditTx.transactionId, tpipAmount };
    }, { timeout: 15e3 });
    return {
      success: true,
      tpipAmount: result.tpipAmount,
      transactionId: result.creditTxId
    };
  } catch (error) {
    console.error("TPIP purchase error details:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "TPIP purchase failed"
    };
  }
}
async function getTPIPBalance(userId) {
  const tpipToken = await prisma.token.findFirst({
    where: { symbol: "TPIP" }
  });
  if (!tpipToken) {
    return 0n;
  }
  const balance = await prisma.userBalance.findUnique({
    where: {
      userId_tokenId: { userId, tokenId: tpipToken.id }
    }
  });
  return balance ? BigInt(balance.amount.toFixed(0)) : 0n;
}
async function resetTournamentTPIP(params) {
  const { tournamentId, participantUserIds, guildId } = params;
  try {
    const tpipToken = await prisma.token.findFirst({
      where: { symbol: "TPIP" }
    });
    if (!tpipToken) {
      return { success: false, resetCount: 0, error: "TPIP token not found" };
    }
    let resetCount = 0;
    await prisma.$transaction(async (tx) => {
      for (const userId of participantUserIds) {
        const balance = await tx.userBalance.findUnique({
          where: {
            userId_tokenId: { userId, tokenId: tpipToken.id }
          }
        });
        const currentBalance = balance ? BigInt(balance.amount.toFixed(0)) : 0n;
        if (currentBalance === 0n) {
          continue;
        }
        await logCompleteTransaction(tx, {
          source: "BOT",
          operation: "TOURNAMENT_TPIP_RESET",
          userId,
          guildId: guildId ?? null,
          idempotencyKey: `tournament_reset_${tournamentId}_${userId}`,
          opRef: `tournament_${tournamentId}`,
          metadata: {
            tournamentId,
            previousBalance: currentBalance.toString(),
            resetToZero: true
          },
          balanceChanges: [{
            tokenId: tpipToken.id,
            userId,
            amountDelta: -currentBalance,
            // Debit to zero
            reason: "tournament_conclusion_reset"
          }]
        });
        await tx.userBalance.update({
          where: {
            userId_tokenId: { userId, tokenId: tpipToken.id }
          },
          data: {
            amount: "0"
          }
        });
        resetCount++;
      }
    }, { timeout: 3e4 });
    return { success: true, resetCount };
  } catch (error) {
    return {
      success: false,
      resetCount: 0,
      error: error instanceof Error ? error.message : "TPIP reset failed"
    };
  }
}
async function transferTPIP(params) {
  const { fromUserId, toUserId, amount, reason, guildId, tournamentId } = params;
  try {
    const tpipToken = await prisma.token.findFirst({
      where: { symbol: "TPIP" }
    });
    if (!tpipToken) {
      return { success: false, error: "TPIP token not found" };
    }
    await prisma.$transaction(async (tx) => {
      const senderBalance = await tx.userBalance.findUnique({
        where: {
          userId_tokenId: { userId: fromUserId, tokenId: tpipToken.id }
        }
      });
      const senderBalanceAmount = senderBalance ? BigInt(senderBalance.amount.toFixed(0)) : 0n;
      if (senderBalanceAmount < amount) {
        throw new Error("Insufficient TPIP balance");
      }
      await logCompleteTransaction(tx, {
        source: "BOT",
        operation: "TPIP_TRANSFER",
        userId: fromUserId,
        guildId: guildId ?? null,
        idempotencyKey: `tpip_transfer_from_${fromUserId}_${toUserId}_${Date.now()}`,
        opRef: tournamentId ? `tournament_${tournamentId}` : void 0,
        metadata: {
          fromUserId,
          toUserId,
          amount: amount.toString(),
          reason,
          tournamentId
        },
        balanceChanges: [{
          tokenId: tpipToken.id,
          userId: fromUserId,
          amountDelta: -amount,
          reason: "tpip_transfer_sent"
        }]
      });
      await tx.userBalance.update({
        where: {
          userId_tokenId: { userId: fromUserId, tokenId: tpipToken.id }
        },
        data: {
          amount: { decrement: amount.toString() }
        }
      });
      await logCompleteTransaction(tx, {
        source: "BOT",
        operation: "TPIP_TRANSFER",
        userId: toUserId,
        guildId: guildId ?? null,
        idempotencyKey: `tpip_transfer_to_${fromUserId}_${toUserId}_${Date.now()}`,
        opRef: tournamentId ? `tournament_${tournamentId}` : void 0,
        metadata: {
          fromUserId,
          toUserId,
          amount: amount.toString(),
          reason,
          tournamentId
        },
        balanceChanges: [{
          tokenId: tpipToken.id,
          userId: toUserId,
          amountDelta: amount,
          reason: "tpip_transfer_received"
        }]
      });
      await tx.userBalance.upsert({
        where: {
          userId_tokenId: { userId: toUserId, tokenId: tpipToken.id }
        },
        create: {
          userId: toUserId,
          tokenId: tpipToken.id,
          amount: amount.toString()
        },
        update: {
          amount: { increment: amount.toString() }
        }
      });
    }, { timeout: 15e3 });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "TPIP transfer failed"
    };
  }
}
async function getTournamentTPIPState(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      inTournamentMode: true,
      activeTournamentId: true
    }
  });
  const tpipBalance = await getTPIPBalance(userId);
  return {
    userId,
    tpipBalance,
    tournamentId: user?.activeTournamentId ?? void 0,
    isActive: user?.inTournamentMode ?? false
  };
}
export {
  getTPIPBalance,
  getTournamentTPIPState,
  purchaseTPIP,
  resetTournamentTPIP,
  transferTPIP
};
//# sourceMappingURL=tpip_service.js.map
