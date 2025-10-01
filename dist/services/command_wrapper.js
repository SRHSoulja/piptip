import { prisma } from "./db.js";
import { logCompleteTransaction } from "./tx_logger.js";
/**
 * Wrap command handlers with transaction logging
 */
export async function withTransactionLogging(operation, userId, handler, options) {
    const { guildId, trackBalanceChanges = false, metadata } = options || {};
    return prisma.$transaction(async (tx) => {
        // Get user balances before operation (if tracking changes)
        let beforeBalances = new Map();
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
        // Execute the handler
        const result = await handler(tx);
        // Log command execution (even if no balance changes)
        if (trackBalanceChanges) {
            // Get user balances after operation
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
            // Only log if there were balance changes
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
                    source: 'BOT'
                });
            }
        }
        else {
            // Log command execution without balance tracking
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
                    balanceChanges: [], // No balance changes
                    metadata: {
                        command: operation,
                        ...metadata
                    },
                    idempotencyKey,
                    source: 'BOT'
                });
            }
        }
        return result;
    });
}
/**
 * Lightweight wrapper for commands that don't modify balances
 */
export async function withCommandLogging(operation, userId, handler, options) {
    const result = await handler();
    // Log asynchronously to avoid blocking the response
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
                        source: 'BOT'
                    });
                });
            }
        }
        catch (error) {
            console.warn(`Failed to log command execution for ${operation}:`, error);
        }
    });
    return result;
}
/**
 * Wrapper specifically for button interactions that may modify balances
 */
export async function withButtonTransactionLogging(buttonId, userId, handler, options) {
    return withTransactionLogging(`BUTTON_${buttonId.toUpperCase()}`, userId, handler, {
        ...options,
        trackBalanceChanges: true,
        metadata: {
            buttonId,
            ...options?.metadata
        }
    });
}
