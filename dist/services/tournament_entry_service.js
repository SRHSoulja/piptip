/**
 * Tournament Entry Service - Multi-Token Payment → TPIP Allocation
 *
 * Handles tournament entry with flexible payment:
 * - Users can pay with any supported Abstract token
 * - Can mix multiple tokens to meet USD entry fee
 * - Uses RPC price feeds for real-time USD valuation
 * - Credits TPIP allocation once fee threshold is met
 * - All payments logged with Transaction + BalanceDelta
 */
import { prisma } from "./db.js";
import { logCompleteTransaction } from "./tx_logger.js";
import { getCachedTokenPrice } from "./price_api.js";
const TPIP_TOKEN_ID = 4;
/**
 * Enter tournament with multi-token payment
 *
 * @param userId - User's database ID
 * @param tournamentId - Tournament ID
 * @param payments - Array of token payments (can be multiple tokens)
 * @returns Result with TPIP allocation details
 */
export async function enterTournamentWithPayment(params) {
    const { userId, discordId, tournamentId, payments } = params;
    try {
        // Get tournament configuration
        const tournament = await prisma.tournament.findUnique({
            where: { id: tournamentId },
            select: {
                id: true,
                name: true,
                entryFee: true, // Assuming this is stored in USD
                startingPIPChips: true, // This becomes TPIP allocation
                guildId: true,
                status: true
            }
        });
        if (!tournament) {
            return { success: false, error: "Tournament not found" };
        }
        if (tournament.status !== "PENDING" && tournament.status !== "ACTIVE") {
            return { success: false, error: "Tournament is not accepting entries" };
        }
        const config = {
            id: tournament.id,
            name: tournament.name,
            entryFeeUSD: tournament.entryFee,
            tpipAllocation: tournament.startingPIPChips,
            guildId: tournament.guildId ?? undefined
        };
        // Validate payments array
        if (!payments || payments.length === 0) {
            return { success: false, error: "No payments provided" };
        }
        // Get all token details and validate balances
        const tokenDetails = [];
        for (const payment of payments) {
            // Get token info
            const token = await prisma.token.findUnique({
                where: { id: payment.tokenId }
            });
            if (!token) {
                return {
                    success: false,
                    error: `Token ID ${payment.tokenId} not found`
                };
            }
            // Get user balance
            const userBalance = await prisma.userBalance.findUnique({
                where: {
                    userId_tokenId: { userId, tokenId: payment.tokenId }
                }
            });
            const currentBalance = userBalance
                ? BigInt(userBalance.amount.toFixed(0))
                : 0n;
            if (currentBalance < payment.amount) {
                return {
                    success: false,
                    error: `Insufficient ${token.symbol}: have ${currentBalance}, need ${payment.amount}`
                };
            }
            // Get token price in USD
            const priceUSD = await getCachedTokenPrice(token.symbol);
            if (priceUSD === null || priceUSD === 0) {
                return {
                    success: false,
                    error: `Unable to get USD price for ${token.symbol}`
                };
            }
            // Calculate USD value of this payment
            const paymentDecimal = Number(payment.amount) / Math.pow(10, token.decimals);
            const usdValue = paymentDecimal * priceUSD;
            tokenDetails.push({
                id: token.id,
                symbol: token.symbol,
                decimals: token.decimals,
                payment: payment.amount,
                balance: currentBalance,
                price: priceUSD,
                usdValue
            });
        }
        // Calculate total USD value of all payments
        const totalUsdPaid = tokenDetails.reduce((sum, t) => sum + t.usdValue, 0);
        // Check if total payment meets entry fee
        if (totalUsdPaid < config.entryFeeUSD) {
            return {
                success: false,
                error: `Insufficient payment: need $${config.entryFeeUSD} USD, provided $${totalUsdPaid.toFixed(2)} USD`
            };
        }
        // Get TPIP token
        const tpipToken = await prisma.token.findUnique({
            where: { id: TPIP_TOKEN_ID }
        });
        if (!tpipToken) {
            return { success: false, error: "TPIP token not configured" };
        }
        // Execute entry in transaction
        await prisma.$transaction(async (tx) => {
            // 1. Debit all token payments
            for (const token of tokenDetails) {
                await logCompleteTransaction(tx, {
                    source: 'BOT',
                    operation: 'TOURNAMENT_ENTRY_PAYMENT',
                    userId,
                    guildId: config.guildId ?? null,
                    idempotencyKey: `tournament_entry_${tournamentId}_${userId}_${token.id}`,
                    opRef: `tournament_${tournamentId}`,
                    metadata: {
                        tournamentId,
                        tournamentName: config.name,
                        tokenSymbol: token.symbol,
                        paymentAmount: token.payment.toString(),
                        usdValue: token.usdValue,
                        tokenPriceUSD: token.price,
                        totalEntryFeeUSD: config.entryFeeUSD
                    },
                    balanceChanges: [{
                            tokenId: token.id,
                            userId,
                            amountDelta: -token.payment,
                            reason: 'tournament_entry_payment'
                        }]
                });
                // Update token balance
                await tx.userBalance.update({
                    where: {
                        userId_tokenId: { userId, tokenId: token.id }
                    },
                    data: {
                        amount: { decrement: token.payment.toString() }
                    }
                });
            }
            // 2. Credit TPIP allocation
            const tpipAllocation = BigInt(config.tpipAllocation);
            await logCompleteTransaction(tx, {
                source: 'BOT',
                operation: 'TPIP_ALLOCATION',
                userId,
                guildId: config.guildId ?? null,
                idempotencyKey: `tpip_allocation_${tournamentId}_${userId}`,
                opRef: `tournament_${tournamentId}`,
                metadata: {
                    tournamentId,
                    tournamentName: config.name,
                    tpipAllocation: config.tpipAllocation,
                    entryFeeUSD: config.entryFeeUSD,
                    totalPaidUSD: totalUsdPaid
                },
                balanceChanges: [{
                        tokenId: TPIP_TOKEN_ID,
                        userId,
                        amountDelta: tpipAllocation,
                        reason: 'tournament_entry_tpip_allocation'
                    }]
            });
            // Update TPIP balance
            await tx.userBalance.upsert({
                where: {
                    userId_tokenId: { userId, tokenId: TPIP_TOKEN_ID }
                },
                create: {
                    userId,
                    tokenId: TPIP_TOKEN_ID,
                    amount: tpipAllocation.toString()
                },
                update: {
                    amount: { increment: tpipAllocation.toString() }
                }
            });
            // 3. Create tournament participation record
            await tx.tournamentParticipant.upsert({
                where: {
                    tournamentId_userId: { tournamentId, userId }
                },
                create: {
                    tournamentId,
                    userId,
                    pipchipsBalance: config.tpipAllocation, // This tracks TPIP balance
                    isActive: true
                },
                update: {
                    isActive: true,
                    pipchipsBalance: config.tpipAllocation
                }
            });
            // 4. Update user tournament mode
            await tx.user.update({
                where: { id: userId },
                data: {
                    inTournamentMode: true,
                    activeTournamentId: tournamentId
                }
            });
        }, { timeout: 20000 });
        return {
            success: true,
            tpipAllocated: BigInt(config.tpipAllocation),
            totalUsdPaid,
            payments: tokenDetails.map(t => ({
                tokenId: t.id,
                tokenSymbol: t.symbol,
                amount: t.payment,
                usdValue: t.usdValue
            }))
        };
    }
    catch (error) {
        console.error("Tournament entry error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Tournament entry failed"
        };
    }
}
/**
 * Calculate required token amounts for tournament entry
 * Helps users understand how much of each token they need
 */
export async function calculateEntryPayment(params) {
    try {
        const { tournamentId, desiredPayments } = params;
        // Get tournament
        const tournament = await prisma.tournament.findUnique({
            where: { id: tournamentId },
            select: { entryFee: true }
        });
        if (!tournament) {
            return { success: false, error: "Tournament not found" };
        }
        const entryFeeUSD = tournament.entryFee;
        // Validate percentages sum to 100
        const totalPercentage = desiredPayments.reduce((sum, p) => sum + p.percentage, 0);
        if (Math.abs(totalPercentage - 100) > 0.01) {
            return {
                success: false,
                error: `Percentages must sum to 100, got ${totalPercentage}`
            };
        }
        const payments = [];
        for (const desired of desiredPayments) {
            const token = await prisma.token.findUnique({
                where: { id: desired.tokenId }
            });
            if (!token) {
                return { success: false, error: `Token ID ${desired.tokenId} not found` };
            }
            const priceUSD = await getCachedTokenPrice(token.symbol);
            if (priceUSD === null || priceUSD === 0) {
                return { success: false, error: `Unable to get price for ${token.symbol}` };
            }
            const usdValue = entryFeeUSD * (desired.percentage / 100);
            const tokenAmountDecimal = usdValue / priceUSD;
            const tokenAmountAtomic = BigInt(Math.ceil(tokenAmountDecimal * Math.pow(10, token.decimals)));
            payments.push({
                tokenId: token.id,
                tokenSymbol: token.symbol,
                amount: tokenAmountAtomic,
                amountDecimal: tokenAmountDecimal.toFixed(token.decimals),
                usdValue,
                percentage: desired.percentage
            });
        }
        return {
            success: true,
            payments,
            totalUSD: entryFeeUSD
        };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Calculation failed"
        };
    }
}
/**
 * Get user's tournament entry status
 */
export async function getTournamentEntryStatus(params) {
    const { userId, tournamentId } = params;
    // Check if user is participant
    const participant = await prisma.tournamentParticipant.findUnique({
        where: {
            tournamentId_userId: { tournamentId, userId }
        }
    });
    if (!participant) {
        return { isEntered: false };
    }
    // Get TPIP balance
    const tpipBalance = await prisma.userBalance.findUnique({
        where: {
            userId_tokenId: { userId, tokenId: TPIP_TOKEN_ID }
        }
    });
    // Get entry payment transactions
    const entryTxs = await prisma.transaction.findMany({
        where: {
            userId,
            type: 'TOURNAMENT_ENTRY_PAYMENT',
            opRef: `tournament_${tournamentId}`
        },
        include: {
            balanceDeltas: {
                include: {
                    token: true
                }
            }
        }
    });
    const entryPayments = entryTxs.map(tx => ({
        tokenSymbol: tx.balanceDeltas[0]?.token.symbol ?? 'UNKNOWN',
        amount: tx.amount.toString(),
        usdValue: tx.usdValue ?? 0
    }));
    return {
        isEntered: true,
        tpipBalance: tpipBalance ? BigInt(tpipBalance.amount.toFixed(0)) : 0n,
        entryPayments: entryPayments.length > 0 ? entryPayments : undefined
    };
}
