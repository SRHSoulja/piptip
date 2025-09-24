// src/services/prediction_markets.ts - Core parimutuel betting logic
import { prisma } from "./db.js";
import { responsibleGaming } from "./responsible_gaming.js";
/**
 * Core prediction market service handling parimutuel betting
 * The house NEVER bets - only facilitates and collects rake
 */
export class PredictionMarketService {
    /**
     * Create a new prediction market
     */
    async createMarket(params) {
        const market = await prisma.predictionMarket.create({
            data: {
                title: params.title,
                description: params.description,
                resolveAt: params.resolveAt,
                creatorId: params.creatorId,
                guildId: params.guildId,
                channelId: params.channelId,
                tokenSymbol: params.tokenSymbol,
                marketType: params.marketType,
                marketData: params.marketData,
                rakePercentage: params.rakePercentage || 3.0, // Default 3% rake
                minBet: params.minBet || 1,
                maxBet: params.maxBet || 10000,
                status: 'ACTIVE',
                totalYesBets: 0,
                totalNoBets: 0,
                totalBetCount: 0
            }
        });
        return this.mapDbMarket(market);
    }
    /**
     * Place a bet on a market
     * Returns updated market with new odds
     */
    async placeBet(params) {
        const { marketId, userId, side, amount } = params;
        try {
            // Get market and validate
            const market = await prisma.predictionMarket.findUnique({
                where: { id: marketId }
            });
            if (!market) {
                return { success: false, error: "Market not found" };
            }
            if (market.status !== 'ACTIVE') {
                return { success: false, error: "Market is not active" };
            }
            if (new Date() >= market.resolveAt) {
                return { success: false, error: "Market has expired" };
            }
            if (amount < market.minBet || amount > market.maxBet) {
                return { success: false, error: `Prediction must be between ${market.minBet} and ${market.maxBet} ${market.tokenSymbol}` };
            }
            // Check responsible gaming limits
            const gamingCheck = await responsibleGaming.canUserPredict(userId, amount, market.tokenSymbol);
            if (!gamingCheck.allowed) {
                return {
                    success: false,
                    error: gamingCheck.reason || "Prediction not allowed",
                };
            }
            // Check user has sufficient balance
            const user = await prisma.user.findFirst({
                where: { discordId: userId }
            });
            if (!user) {
                return { success: false, error: "User account not found. Use `/pip_profile` to create an account." };
            }
            const userBalance = await prisma.userBalance.findFirst({
                where: {
                    userId: user.id,
                    Token: { symbol: market.tokenSymbol }
                },
                include: { Token: true }
            });
            if (!userBalance || Number(userBalance.amount) < amount) {
                return { success: false, error: `Insufficient ${market.tokenSymbol} balance` };
            }
            // Execute bet transaction
            const result = await prisma.$transaction(async (tx) => {
                // Deduct bet amount from user balance
                await tx.userBalance.update({
                    where: { id: userBalance.id },
                    data: { amount: { decrement: amount } }
                });
                // Create bet record
                await tx.predictionBet.create({
                    data: {
                        marketId,
                        userId,
                        side,
                        amount,
                        tokenSymbol: market.tokenSymbol
                    }
                });
                // Update market totals
                const updates = {
                    totalBetCount: { increment: 1 }
                };
                if (side === 'YES') {
                    updates.totalYesBets = { increment: amount };
                }
                else {
                    updates.totalNoBets = { increment: amount };
                }
                const updatedMarket = await tx.predictionMarket.update({
                    where: { id: marketId },
                    data: updates
                });
                return updatedMarket;
            });
            return { success: true, market: this.mapDbMarket(result) };
        }
        catch (error) {
            console.error('Error placing bet:', error);
            return { success: false, error: "Failed to place bet" };
        }
    }
    /**
     * Calculate current odds for a market
     * Returns implied probability based on bet distribution
     */
    calculateOdds(market) {
        const totalPool = market.totalYesBets + market.totalNoBets;
        if (totalPool === 0) {
            // No bets yet - 50/50 odds
            return {
                yesOdds: 2.0,
                noOdds: 2.0,
                yesImpliedProb: 0.5,
                noImpliedProb: 0.5
            };
        }
        // Calculate implied probabilities
        const yesImpliedProb = market.totalYesBets / totalPool;
        const noImpliedProb = market.totalNoBets / totalPool;
        // Calculate odds (payout ratio)
        // If 60% bet YES, then YES odds = 1 / 0.6 = 1.67 (before rake)
        // Account for rake in payout calculations
        const rakeMultiplier = (100 - market.rakePercentage) / 100;
        const yesOdds = yesImpliedProb > 0 ? (1 / yesImpliedProb) * rakeMultiplier : 0;
        const noOdds = noImpliedProb > 0 ? (1 / noImpliedProb) * rakeMultiplier : 0;
        return { yesOdds, noOdds, yesImpliedProb, noImpliedProb };
    }
    /**
     * Resolve a market with the given outcome
     * Calculates and distributes payouts using parimutuel system
     */
    async resolveMarket(marketId, outcome) {
        try {
            const market = await prisma.predictionMarket.findUnique({
                where: { id: marketId },
                include: {
                    bets: true
                }
            });
            if (!market) {
                return { success: false, error: "Market not found" };
            }
            if (market.status !== 'ACTIVE') {
                return { success: false, error: "Market is not active" };
            }
            // Handle cancellation (refund all bets)
            if (outcome === 'CANCEL') {
                return await this.cancelMarket(marketId);
            }
            const totalPool = market.totalYesBets + market.totalNoBets;
            // If no bets or only one side has bets, cancel the market
            if (totalPool === 0 || market.totalYesBets === 0 || market.totalNoBets === 0) {
                console.log(`Market ${marketId} cancelled - insufficient betting on both sides`);
                return await this.cancelMarket(marketId);
            }
            // Calculate rake and prize pool
            const houseRake = totalPool * (market.rakePercentage / 100);
            const prizePool = totalPool - houseRake;
            // Get winning bets
            const winningBets = market.bets.filter(bet => bet.side === outcome);
            const winningPool = outcome === 'YES' ? market.totalYesBets : market.totalNoBets;
            // Calculate payouts (proportional to bet size)
            const payouts = [];
            for (const bet of winningBets) {
                const winShare = bet.amount / winningPool;
                const payout = winShare * prizePool;
                payouts.push({
                    userId: bet.userId,
                    amount: Math.floor(payout) // Round down to avoid fractional tokens
                });
            }
            // Execute payout transaction
            await prisma.$transaction(async (tx) => {
                // Update market status
                await tx.predictionMarket.update({
                    where: { id: marketId },
                    data: {
                        status: 'RESOLVED',
                        outcome
                    }
                });
                // Process payouts
                for (const payout of payouts) {
                    // Find user and their balance
                    const user = await tx.user.findFirst({
                        where: { discordId: payout.userId }
                    });
                    if (user) {
                        const userBalance = await tx.userBalance.findFirst({
                            where: {
                                userId: user.id,
                                Token: { symbol: market.tokenSymbol }
                            }
                        });
                        if (userBalance) {
                            await tx.userBalance.update({
                                where: { id: userBalance.id },
                                data: { amount: { increment: payout.amount } }
                            });
                        }
                    }
                    // Note: If user balance doesn't exist, they may have been removed from the system
                    // In a production system, you'd want to handle this case
                }
                // Add house rake to treasury (optional - depends on your tokenomics)
                // This could go to a treasury wallet or be distributed to token holders
            });
            console.log(`Market ${marketId} resolved with outcome ${outcome}. House rake: ${houseRake}, Payouts: ${payouts.length}`);
            return { success: true, payouts, houseRake };
        }
        catch (error) {
            console.error('Error resolving market:', error);
            return { success: false, error: "Failed to resolve market" };
        }
    }
    /**
     * Cancel a market and refund all bets
     */
    async cancelMarket(marketId) {
        try {
            const market = await prisma.predictionMarket.findUnique({
                where: { id: marketId },
                include: { bets: true }
            });
            if (!market) {
                return { success: false, error: "Market not found" };
            }
            // Refund all bets
            const refunds = [];
            await prisma.$transaction(async (tx) => {
                // Update market status
                await tx.predictionMarket.update({
                    where: { id: marketId },
                    data: { status: 'CANCELLED' }
                });
                // Process refunds
                for (const bet of market.bets) {
                    const user = await tx.user.findFirst({
                        where: { discordId: bet.userId }
                    });
                    if (user) {
                        const userBalance = await tx.userBalance.findFirst({
                            where: {
                                userId: user.id,
                                Token: { symbol: market.tokenSymbol }
                            }
                        });
                        if (userBalance) {
                            await tx.userBalance.update({
                                where: { id: userBalance.id },
                                data: { amount: { increment: bet.amount } }
                            });
                            refunds.push({
                                userId: bet.userId,
                                amount: bet.amount
                            });
                        }
                    }
                }
            });
            console.log(`Market ${marketId} cancelled. Refunded ${refunds.length} bets.`);
            return { success: true, payouts: refunds };
        }
        catch (error) {
            console.error('Error cancelling market:', error);
            return { success: false, error: "Failed to cancel market" };
        }
    }
    /**
     * Get market by ID
     */
    async getMarket(marketId) {
        const market = await prisma.predictionMarket.findUnique({
            where: { id: marketId }
        });
        return market ? this.mapDbMarket(market) : null;
    }
    /**
     * Get active markets for a guild
     */
    async getActiveMarkets(guildId) {
        const markets = await prisma.predictionMarket.findMany({
            where: {
                guildId,
                status: 'ACTIVE'
            },
            orderBy: { resolveAt: 'asc' }
        });
        return markets.map(m => this.mapDbMarket(m));
    }
    /**
     * Get expired markets that need resolution
     */
    async getExpiredMarkets() {
        const now = new Date();
        const markets = await prisma.predictionMarket.findMany({
            where: {
                status: 'ACTIVE',
                resolveAt: { lte: now }
            },
            orderBy: { resolveAt: 'asc' }
        });
        return markets.map(m => this.mapDbMarket(m));
    }
    /**
     * Get user's bets for a market
     */
    async getUserBets(marketId, userId) {
        const bets = await prisma.predictionBet.findMany({
            where: { marketId, userId },
            orderBy: { createdAt: 'desc' }
        });
        return bets.map(bet => ({
            id: bet.id,
            marketId: bet.marketId,
            userId: bet.userId,
            side: bet.side,
            amount: bet.amount,
            timestamp: bet.createdAt
        }));
    }
    /**
     * Get count of active markets created by a user
     */
    async getUserActiveMarketCount(userId) {
        return await prisma.predictionMarket.count({
            where: {
                creatorId: userId,
                status: 'ACTIVE'
            }
        });
    }
    /**
     * Map database market to service interface
     */
    mapDbMarket(dbMarket) {
        return {
            id: dbMarket.id,
            title: dbMarket.title,
            description: dbMarket.description,
            createdAt: dbMarket.createdAt,
            resolveAt: dbMarket.resolveAt,
            status: dbMarket.status,
            outcome: dbMarket.outcome,
            totalYesBets: dbMarket.totalYesBets,
            totalNoBets: dbMarket.totalNoBets,
            totalBetCount: dbMarket.totalBetCount,
            rakePercentage: dbMarket.rakePercentage,
            minBet: dbMarket.minBet,
            maxBet: dbMarket.maxBet,
            creatorId: dbMarket.creatorId,
            guildId: dbMarket.guildId,
            channelId: dbMarket.channelId,
            tokenSymbol: dbMarket.tokenSymbol,
            marketType: dbMarket.marketType,
            marketData: dbMarket.marketData
        };
    }
}
// Export singleton instance
export const predictionMarkets = new PredictionMarketService();
