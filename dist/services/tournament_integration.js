// src/services/tournament_integration.ts - Integration layer for tournament-aware predictions
import { prisma } from "./db.js";
import { processWinningsWithContext } from "./tournament_context.js";
/**
 * Tournament-aware wrapper for prediction market betting
 * This integrates with existing Discord commands and prediction systems
 */
export async function placeParticipationWithTournamentContext(params) {
    const { userId, discordId, marketId, amount, side } = params;
    try {
        // Use tournament context-aware participation
        const result = await placeTournamentAwareParticipation({
            userId,
            marketId,
            amount,
            side
        });
        if (result.success) {
            console.log(`🎯 Participation placed: ${discordId} wagered ${amount} PIPChips on ${side} ${result.usedTournamentBalance ? '(Tournament)' : '(Regular)'}`);
        }
        return result;
    }
    catch (error) {
        console.error('Tournament integration participation error:', error);
        return { success: false, error: 'Failed to place participation' };
    }
}
/**
 * Tournament-aware payout processing for market resolutions
 */
export async function processPayoutsWithTournamentContext(marketId, outcome) {
    try {
        // Get all participations for this market
        const participations = await prisma.predictionParticipation.findMany({
            where: { marketId },
            include: {
                user: {
                    select: {
                        id: true,
                        discordId: true,
                        inTournamentMode: true,
                        activeTournamentId: true
                    }
                }
            }
        });
        console.log(`🎯 Processing ${participations.length} participations for market ${marketId} with outcome ${outcome}`);
        for (const participation of participations) {
            const won = participation.side === outcome;
            let payout = 0;
            if (won) {
                // Calculate payout based on market maker or simple 2:1 ratio
                // For now, using simple calculation
                payout = Number(participation.amount) * 2; // Simplified - would use LMSR calculations
            }
            else {
                // Lost participation - no payout
                payout = 0;
            }
            // Process winnings with tournament context
            if (payout > 0) {
                await processWinningsWithContext(participation.user.id, marketId, payout, won);
            }
            // Log result
            console.log(`${won ? '✅ Win' : '❌ Loss'}: ${participation.user.discordId} ${won ? `gets ${payout}` : 'loses'} PIPChips ${participation.user.inTournamentMode ? '(Tournament)' : '(Regular)'}`);
        }
    }
    catch (error) {
        console.error('Tournament payout processing error:', error);
    }
}
/**
 * Get user's current balance context for display
 */
export async function getUserBalanceContext(userId) {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                tournamentParticipants: {
                    where: {
                        tournament: { status: 'ACTIVE' }
                    },
                    include: { tournament: { include: { participants: true } } }
                }
            }
        });
        if (!user) {
            return { mode: 'regular', balance: 0 };
        }
        if (user.inTournamentMode && user.activeTournamentId && user.tournamentParticipants.length > 0) {
            const participant = user.tournamentParticipants[0];
            return {
                mode: 'tournament',
                balance: participant.pipchipsBalance,
                tournamentInfo: {
                    name: participant.tournament.name,
                    participants: participant.tournament.participants.length
                }
            };
        }
        return {
            mode: 'regular',
            balance: Number(user.pipchipsBalance)
        };
    }
    catch (error) {
        console.error('Get balance context error:', error);
        return { mode: 'regular', balance: 0 };
    }
}
/**
 * Check if user can place participation (respects tournament or regular balance)
 */
export async function canUserPlaceParticipation(userId, amount) {
    try {
        const context = await getUserBalanceContext(userId);
        if (context.balance < amount) {
            return {
                canParticipate: false,
                reason: `Insufficient ${context.mode === 'tournament' ? 'tournament' : 'regular'} PIPChips (${context.balance} available, ${amount} needed)`,
                mode: context.mode
            };
        }
        return { canParticipate: true, mode: context.mode };
    }
    catch (error) {
        console.error('Can user participate check error:', error);
        return { canParticipate: false, reason: 'Error checking balance', mode: 'regular' };
    }
}
/**
 * Get tournament leaderboard for display in Discord
 */
export async function getActiveUserTournamentStatus(userId) {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                tournamentParticipants: {
                    where: {
                        tournament: { status: 'ACTIVE' }
                    },
                    include: {
                        tournament: {
                            include: { participants: true }
                        }
                    }
                }
            }
        });
        if (!user || !user.inTournamentMode || user.tournamentParticipants.length === 0) {
            return { inTournament: false };
        }
        const participant = user.tournamentParticipants[0];
        const tournament = participant.tournament;
        // Get user's rank by comparing balance with other participants
        const betterParticipants = await prisma.tournamentParticipant.count({
            where: {
                tournamentId: tournament.id,
                pipchipsBalance: { gt: participant.pipchipsBalance }
            }
        });
        const rank = betterParticipants + 1;
        return {
            inTournament: true,
            tournamentName: tournament.name,
            rank,
            balance: participant.pipchipsBalance,
            profit: participant.pipchipsBalance - participant.pipchipsStart,
            totalParticipants: tournament.participants.length
        };
    }
    catch (error) {
        console.error('Tournament status error:', error);
        return null;
    }
}
/**
 * Simple tournament creation for admins
 */
export async function createTournament(params) {
    try {
        const tournament = await prisma.tournamentSession.create({
            data: {
                name: params.name,
                description: params.description,
                entryFeeUSD: params.entryFeeUSD,
                startTime: params.startTime,
                endTime: params.endTime,
                status: 'UPCOMING',
                maxPlayers: params.maxPlayers,
                prizeTokens: params.prizeTokens,
                prizeDistribution: {
                    "1": 40,
                    "2": 25,
                    "3": 15,
                    "4-10": 20
                },
                startingPIPChips: 10000
            }
        });
        console.log(`🏆 Tournament created: ${tournament.name} (${tournament.id})`);
        return { success: true, tournamentId: tournament.id };
    }
    catch (error) {
        console.error('Tournament creation error:', error);
        return { success: false, error: 'Failed to create tournament' };
    }
}
