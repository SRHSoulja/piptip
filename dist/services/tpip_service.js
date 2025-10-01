/**
 * Tournament PIPChips (TPIP) Service
 *
 * TPIP is a completely separate currency from PIPChips:
 * - Users purchase TPIP with Abstract tokens (ABSTR, etc.)
 * - TPIP is used exclusively for tournament play
 * - TPIP balances reset to zero at tournament conclusion
 * - Never crosses paths with regular PIPChips economy
 */
import { prisma } from "./db.js";
import { logCompleteTransaction } from "./tx_logger.js";
const TPIP_TOKEN_ID = 4; // Tournament PIPChips token ID
const TPIP_PURCHASE_RATE = 1; // 1 ABSTR = 1 TPIP (adjustable)
/**
 * Purchase TPIP with Abstract tokens
 * Separate economy from PIPChips - users buy TPIP specifically for tournaments
 */
export async function purchaseTPIP(params) {
    const { userId, discordId, tokenId, amount, guildId } = params;
    // Validate amount is bigint
    if (typeof amount !== 'bigint') {
        return {
            success: false,
            error: `Invalid amount type: expected bigint, got ${typeof amount} (value: ${amount})`
        };
    }
    try {
        // Get tokens
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
        // Calculate TPIP amount
        // Abstract tokens have 18 decimals, TPIP has 0 decimals
        // Convert atomic Abstract amount to whole TPIP (1:1 rate at decimal level)
        const tpipAmount = amount / (10n ** BigInt(sourceToken.decimals));
        // Execute purchase in transaction
        const result = await prisma.$transaction(async (tx) => {
            // 1. Check user has sufficient source token balance
            const userBalance = await tx.userBalance.findUnique({
                where: {
                    userId_tokenId: { userId, tokenId }
                }
            });
            // Convert Decimal to bigint safely
            // Use toFixed() to avoid scientific notation from toString()
            const currentBalance = userBalance ? BigInt(userBalance.amount.toFixed(0)) : 0n;
            if (currentBalance < amount) {
                throw new Error(`Insufficient ${sourceToken.symbol} balance`);
            }
            // 2. Log source token debit (Abstract token spent)
            const debitTx = await logCompleteTransaction(tx, {
                source: 'BOT',
                operation: 'TPIP_PURCHASE',
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
                        amountDelta: -amount, // Debit Abstract token
                        reason: 'tpip_purchase'
                    }]
            });
            // 3. Update Abstract token balance (debit)
            await tx.userBalance.update({
                where: {
                    userId_tokenId: { userId, tokenId }
                },
                data: {
                    amount: { decrement: amount.toString() }
                }
            });
            // 4. Log TPIP credit (TPIP received)
            const creditTx = await logCompleteTransaction(tx, {
                source: 'BOT',
                operation: 'TPIP_CREDIT',
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
                        amountDelta: tpipAmount, // Credit TPIP
                        reason: 'tpip_purchase'
                    }]
            });
            // 5. Update TPIP balance (credit) or create if doesn't exist
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
        }, { timeout: 15000 });
        return {
            success: true,
            tpipAmount: result.tpipAmount,
            transactionId: result.creditTxId
        };
    }
    catch (error) {
        console.error("TPIP purchase error details:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "TPIP purchase failed"
        };
    }
}
/**
 * Get user's TPIP balance
 * Completely separate from PIPChips balance
 */
export async function getTPIPBalance(userId) {
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
/**
 * Reset all TPIP balances to zero for tournament participants
 * Called at tournament conclusion
 */
export async function resetTournamentTPIP(params) {
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
                // Get current TPIP balance
                const balance = await tx.userBalance.findUnique({
                    where: {
                        userId_tokenId: { userId, tokenId: tpipToken.id }
                    }
                });
                const currentBalance = balance ? BigInt(balance.amount.toFixed(0)) : 0n;
                // Skip if already zero
                if (currentBalance === 0n) {
                    continue;
                }
                // Log TPIP reset to zero
                await logCompleteTransaction(tx, {
                    source: 'BOT',
                    operation: 'TOURNAMENT_TPIP_RESET',
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
                            amountDelta: -currentBalance, // Debit to zero
                            reason: 'tournament_conclusion_reset'
                        }]
                });
                // Update UserBalance to zero
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
        }, { timeout: 30000 }); // Longer timeout for multiple resets
        return { success: true, resetCount };
    }
    catch (error) {
        return {
            success: false,
            resetCount: 0,
            error: error instanceof Error ? error.message : "TPIP reset failed"
        };
    }
}
/**
 * Transfer TPIP between users (for tournament prizes/payouts)
 * Separate from PIPChips transfers
 */
export async function transferTPIP(params) {
    const { fromUserId, toUserId, amount, reason, guildId, tournamentId } = params;
    try {
        const tpipToken = await prisma.token.findFirst({
            where: { symbol: "TPIP" }
        });
        if (!tpipToken) {
            return { success: false, error: "TPIP token not found" };
        }
        await prisma.$transaction(async (tx) => {
            // Check sender balance
            const senderBalance = await tx.userBalance.findUnique({
                where: {
                    userId_tokenId: { userId: fromUserId, tokenId: tpipToken.id }
                }
            });
            const senderBalanceAmount = senderBalance ? BigInt(senderBalance.amount.toFixed(0)) : 0n;
            if (senderBalanceAmount < amount) {
                throw new Error("Insufficient TPIP balance");
            }
            // Log sender debit
            await logCompleteTransaction(tx, {
                source: 'BOT',
                operation: 'TPIP_TRANSFER',
                userId: fromUserId,
                guildId: guildId ?? null,
                idempotencyKey: `tpip_transfer_from_${fromUserId}_${toUserId}_${Date.now()}`,
                opRef: tournamentId ? `tournament_${tournamentId}` : undefined,
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
                        reason: 'tpip_transfer_sent'
                    }]
            });
            // Update sender balance (debit)
            await tx.userBalance.update({
                where: {
                    userId_tokenId: { userId: fromUserId, tokenId: tpipToken.id }
                },
                data: {
                    amount: { decrement: amount.toString() }
                }
            });
            // Log receiver credit
            await logCompleteTransaction(tx, {
                source: 'BOT',
                operation: 'TPIP_TRANSFER',
                userId: toUserId,
                guildId: guildId ?? null,
                idempotencyKey: `tpip_transfer_to_${fromUserId}_${toUserId}_${Date.now()}`,
                opRef: tournamentId ? `tournament_${tournamentId}` : undefined,
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
                        reason: 'tpip_transfer_received'
                    }]
            });
            // Update receiver balance (credit)
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
        }, { timeout: 15000 });
        return { success: true };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "TPIP transfer failed"
        };
    }
}
/**
 * Get tournament TPIP state for a user
 */
export async function getTournamentTPIPState(userId) {
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
        tournamentId: user?.activeTournamentId ?? undefined,
        isActive: user?.inTournamentMode ?? false
    };
}
