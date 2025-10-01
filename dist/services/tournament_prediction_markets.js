/**
 * Tournament Prediction Markets - TPIP Only
 *
 * This is a separate prediction market system for tournaments that:
 * - Uses TPIP exclusively (never PIPChips)
 * - Operates only during active tournaments
 * - Resets all balances to zero at tournament conclusion
 * - Maintains complete isolation from regular prediction markets
 */
import { prisma } from "./db.js";
import { logCompleteTransaction } from "./tx_logger.js";
import { getTPIPBalance } from "./tpip_service.js";
const TPIP_TOKEN_ID = 4;
/**
 * Place a bet on a tournament market using TPIP only
 */
export async function placeTournamentBet(params) {
    const { marketId, userId, discordId, side, amount, tournamentId, guildId } = params;
    try {
        // Verify user is in tournament mode
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { inTournamentMode: true, activeTournamentId: true }
        });
        if (!user?.inTournamentMode || user.activeTournamentId !== tournamentId) {
            return { success: false, error: "User not in this tournament" };
        }
        // Check TPIP balance
        const tpipBalance = await getTPIPBalance(userId);
        const amountBigInt = BigInt(amount);
        if (tpipBalance < amountBigInt) {
            return {
                success: false,
                error: `Insufficient TPIP: have ${tpipBalance}, need ${amountBigInt}`
            };
        }
        // Get market
        const market = await prisma.predictionMarket.findUnique({
            where: { id: marketId }
        });
        if (!market) {
            return { success: false, error: "Market not found" };
        }
        if (market.status !== 'ACTIVE') {
            return { success: false, error: "Market is not active" };
        }
        // Place bet using TPIP
        const updatedMarket = await prisma.$transaction(async (tx) => {
            // 1. Debit TPIP from user
            await logCompleteTransaction(tx, {
                source: 'BOT',
                operation: 'TOURNAMENT_WAGER',
                userId,
                guildId: guildId ?? null,
                idempotencyKey: `tournament_wager_${marketId}_${userId}_${Date.now()}`,
                opRef: `market_${marketId}`,
                metadata: {
                    tournamentId,
                    marketId,
                    side,
                    amount,
                    marketTitle: market.title
                },
                balanceChanges: [{
                        tokenId: TPIP_TOKEN_ID,
                        userId,
                        amountDelta: -amountBigInt,
                        reason: 'tournament_wager'
                    }]
            });
            // Update TPIP balance
            await tx.userBalance.update({
                where: {
                    userId_tokenId: { userId, tokenId: TPIP_TOKEN_ID }
                },
                data: {
                    amount: { decrement: amountBigInt.toString() }
                }
            });
            // 2. Create participation record
            await tx.predictionParticipation.create({
                data: {
                    userId: discordId,
                    marketId,
                    side,
                    amount,
                    tokenSymbol: 'TPIP'
                }
            });
            // 3. Update market totals
            const updateData = side === 'YES'
                ? {
                    totalYesBets: { increment: amount },
                    totalBetCount: { increment: 1 }
                }
                : {
                    totalNoBets: { increment: amount },
                    totalBetCount: { increment: 1 }
                };
            return await tx.predictionMarket.update({
                where: { id: marketId },
                data: updateData
            });
        }, { timeout: 15000 });
        return {
            success: true,
            market: {
                id: updatedMarket.id,
                title: updatedMarket.title,
                tournamentId,
                status: updatedMarket.status,
                outcome: updatedMarket.outcome,
                totalYesBets: updatedMarket.totalYesBets,
                totalNoBets: updatedMarket.totalNoBets
            }
        };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Tournament bet failed"
        };
    }
}
/**
 * Resolve tournament market and distribute TPIP winnings
 */
export async function resolveTournamentMarket(marketId, outcome, tournamentId) {
    try {
        const market = await prisma.predictionMarket.findUnique({
            where: { id: marketId },
            include: { participations: true }
        });
        if (!market) {
            return { success: false, error: "Market not found" };
        }
        if (market.status !== 'ACTIVE') {
            return { success: false, error: "Market already resolved" };
        }
        // Handle cancellation - refund all bets in TPIP
        if (outcome === 'CANCEL') {
            return await cancelTournamentMarket(marketId, tournamentId);
        }
        const totalPool = market.totalYesBets + market.totalNoBets;
        const payouts = [];
        await prisma.$transaction(async (tx) => {
            // 1. Calculate and distribute payouts (no rake for tournaments)
            const winningParticipations = market.participations.filter(p => p.side === outcome);
            const winningPool = outcome === 'YES' ? market.totalYesBets : market.totalNoBets;
            for (const participation of winningParticipations) {
                const winShare = participation.amount / winningPool;
                const payout = Math.floor(winShare * totalPool);
                if (payout > 0) {
                    // Get user ID from discord ID
                    const user = await tx.user.findFirst({
                        where: { discordId: participation.userId }
                    });
                    if (!user)
                        continue;
                    // Credit TPIP winnings
                    await logCompleteTransaction(tx, {
                        source: 'BOT',
                        operation: 'TOURNAMENT_WIN',
                        userId: user.id,
                        guildId: null,
                        idempotencyKey: `tournament_win_${marketId}_${user.id}`,
                        opRef: `market_${marketId}`,
                        metadata: {
                            tournamentId,
                            marketId,
                            marketTitle: market.title,
                            side: outcome,
                            payout
                        },
                        balanceChanges: [{
                                tokenId: TPIP_TOKEN_ID,
                                userId: user.id,
                                amountDelta: BigInt(payout),
                                reason: 'tournament_win'
                            }]
                    });
                    // Update TPIP balance
                    await tx.userBalance.upsert({
                        where: {
                            userId_tokenId: { userId: user.id, tokenId: TPIP_TOKEN_ID }
                        },
                        create: {
                            userId: user.id,
                            tokenId: TPIP_TOKEN_ID,
                            amount: payout.toString()
                        },
                        update: {
                            amount: { increment: payout.toString() }
                        }
                    });
                    payouts.push({ userId: user.id, amount: payout });
                }
            }
            // 2. Mark market as resolved
            await tx.predictionMarket.update({
                where: { id: marketId },
                data: {
                    status: 'RESOLVED',
                    outcome
                }
            });
        }, { timeout: 30000 });
        return { success: true, payouts };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Market resolution failed"
        };
    }
}
/**
 * Cancel tournament market and refund all bets in TPIP
 */
async function cancelTournamentMarket(marketId, tournamentId) {
    try {
        const market = await prisma.predictionMarket.findUnique({
            where: { id: marketId },
            include: { participations: true }
        });
        if (!market) {
            return { success: false, error: "Market not found" };
        }
        const refunds = [];
        await prisma.$transaction(async (tx) => {
            // Refund all participants in TPIP
            for (const participation of market.participations) {
                if (participation.amount > 0) {
                    const user = await tx.user.findFirst({
                        where: { discordId: participation.userId }
                    });
                    if (!user)
                        continue;
                    await logCompleteTransaction(tx, {
                        source: 'BOT',
                        operation: 'TOURNAMENT_REFUND',
                        userId: user.id,
                        guildId: null,
                        idempotencyKey: `tournament_refund_${marketId}_${user.id}`,
                        opRef: `market_${marketId}`,
                        metadata: {
                            tournamentId,
                            marketId,
                            marketTitle: market.title,
                            refundAmount: participation.amount
                        },
                        balanceChanges: [{
                                tokenId: TPIP_TOKEN_ID,
                                userId: user.id,
                                amountDelta: BigInt(participation.amount),
                                reason: 'tournament_refund'
                            }]
                    });
                    // Update TPIP balance
                    await tx.userBalance.upsert({
                        where: {
                            userId_tokenId: { userId: user.id, tokenId: TPIP_TOKEN_ID }
                        },
                        create: {
                            userId: user.id,
                            tokenId: TPIP_TOKEN_ID,
                            amount: participation.amount.toString()
                        },
                        update: {
                            amount: { increment: participation.amount.toString() }
                        }
                    });
                    refunds.push({ userId: user.id, amount: participation.amount });
                }
            }
            // Mark market as cancelled
            await tx.predictionMarket.update({
                where: { id: marketId },
                data: {
                    status: 'RESOLVED',
                    outcome: 'CANCEL'
                }
            });
        }, { timeout: 30000 });
        return { success: true, payouts: refunds };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Market cancellation failed"
        };
    }
}
