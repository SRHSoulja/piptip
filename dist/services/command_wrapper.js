import { prisma } from "./db.js";
import { logCompleteTransaction } from "./tx_logger.js";
async function withTransactionLogging(operation, userId, handler, options) {
  const { guildId, trackBalanceChanges = false, metadata } = options || {};
  return prisma.$transaction(async (tx) => {
    let beforeBalances = /* @__PURE__ */ new Map();
    if (trackBalanceChanges) {
      const user = await tx.user.findUnique({
        where: { discordId: userId },
        include: {
          balances: {
            include: { Token: { select: { decimals: true } } }
          }
        }
      });
      if (user) {
        for (const balance of user.balances) {
          const key = `${user.id}_${balance.tokenId}`;
          const atomic = BigInt(parseFloat(balance.amount.toString()) * Math.pow(10, balance.Token.decimals));
          beforeBalances.set(key, atomic);
        }
      }
    }
    const result = await handler(tx);
    if (trackBalanceChanges) {
      const user = await tx.user.findUnique({
        where: { discordId: userId },
        include: {
          balances: {
            include: { Token: { select: { decimals: true } } }
          }
        }
      });
      const balanceChanges = [];
      if (user) {
        for (const balance of user.balances) {
          const key = `${user.id}_${balance.tokenId}`;
          const afterAtomic = BigInt(parseFloat(balance.amount.toString()) * Math.pow(10, balance.Token.decimals));
          const beforeAtomic = beforeBalances.get(key) || 0n;
          const delta = afterAtomic - beforeAtomic;
          if (delta !== 0n) {
            balanceChanges.push({
              tokenId: balance.tokenId,
              userId: user.id,
              amountDelta: delta,
              reason: `command_${operation.toLowerCase()}`
            });
          }
        }
      }
      if (balanceChanges.length > 0) {
        const idempotencyKey = `cmd_${operation}_${userId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        await logCompleteTransaction(tx, {
          operation: `COMMAND_${operation.toUpperCase()}`,
          userId: user?.id,
          guildId,
          balanceChanges,
          metadata: {
            command: operation,
            ...metadata
          },
          idempotencyKey,
          source: "BOT"
        });
      }
    } else {
      const user = await tx.user.findUnique({
        where: { discordId: userId },
        select: { id: true }
      });
      if (user) {
        const idempotencyKey = `cmd_${operation}_${userId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        await logCompleteTransaction(tx, {
          operation: `COMMAND_${operation.toUpperCase()}`,
          userId: user.id,
          guildId,
          balanceChanges: [],
          // No balance changes
          metadata: {
            command: operation,
            ...metadata
          },
          idempotencyKey,
          source: "BOT"
        });
      }
    }
    return result;
  });
}
async function withCommandLogging(operation, userId, handler, options) {
  const result = await handler();
  setImmediate(async () => {
    try {
      const user = await prisma.user.findUnique({
        where: { discordId: userId },
        select: { id: true }
      });
      if (user) {
        const idempotencyKey = `cmd_${operation}_${userId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        await prisma.$transaction(async (tx) => {
          await logCompleteTransaction(tx, {
            operation: `COMMAND_${operation.toUpperCase()}`,
            userId: user.id,
            guildId: options?.guildId,
            balanceChanges: [],
            metadata: {
              command: operation,
              ...options?.metadata
            },
            idempotencyKey,
            source: "BOT"
          });
        });
      }
    } catch (error) {
      console.warn(`Failed to log command execution for ${operation}:`, error);
    }
  });
  return result;
}
async function withButtonTransactionLogging(buttonId, userId, handler, options) {
  return withTransactionLogging(
    `BUTTON_${buttonId.toUpperCase()}`,
    userId,
    handler,
    {
      ...options,
      trackBalanceChanges: true,
      metadata: {
        buttonId,
        ...options?.metadata
      }
    }
  );
}
export {
  withButtonTransactionLogging,
  withCommandLogging,
  withTransactionLogging
};
//# sourceMappingURL=command_wrapper.js.map
