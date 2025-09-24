// src/services/tournament_integration.ts - Integration layer for tournament-aware predictions
import { prisma } from "./db.js";
import { placeTournamentAwareBet, processWinningsWithContext } from "./tournament_context.js";

/**
 * Tournament-aware wrapper for prediction market betting
 * This integrates with existing Discord commands and prediction systems
 */
export async function placeBetWithTournamentContext(params: {
  userId: number;
  discordId: string;
  marketId: string;
  amount: number;
  side: string;
}): Promise<{ success: boolean; error?: string; usedTournamentBalance?: boolean }> {
  const { userId, discordId, marketId, amount, side } = params;

  try {
    // Use tournament context-aware betting
    const result = await placeTournamentAwareBet({
      userId,
      marketId,
      amount,
      side
    });

    if (result.success) {
      console.log(`🎯 Bet placed: ${discordId} wagered ${amount} PIPChips on ${side} ${result.usedTournamentBalance ? '(Tournament)' : '(Regular)'}`);
    }

    return result;

  } catch (error) {
    console.error('Tournament integration bet error:', error);
    return { success: false, error: 'Failed to place bet' };
  }
}

/**
 * Tournament-aware payout processing for market resolutions
 */
export async function processPayoutsWithTournamentContext(marketId: string, outcome: 'YES' | 'NO'): Promise<void> {
  try {
    // Get all bets for this market
    const bets = await prisma.predictionBet.findMany({
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

    console.log(`🎯 Processing ${bets.length} bets for market ${marketId} with outcome ${outcome}`);

    for (const bet of bets) {
      const won = bet.side === outcome;
      let payout = 0;

      if (won) {
        // Calculate payout based on market maker or simple 2:1 ratio
        // For now, using simple calculation
        payout = Number(bet.amount) * 2; // Simplified - would use LMSR calculations
      } else {
        // Lost bet - no payout
        payout = 0;
      }

      // Process winnings with tournament context
      if (payout > 0) {
        await processWinningsWithContext(
          bet.user.id,
          marketId,
          payout,
          won
        );
      }

      // Log result
      console.log(`${won ? '✅ Win' : '❌ Loss'}: ${bet.user.discordId} ${won ? `gets ${payout}` : 'loses'} PIPChips ${bet.user.inTournamentMode ? '(Tournament)' : '(Regular)'}`);
    }

  } catch (error) {
    console.error('Tournament payout processing error:', error);
  }
}

/**
 * Get user's current balance context for display
 */
export async function getUserBalanceContext(userId: number): Promise<{
  mode: 'tournament' | 'regular';
  balance: number;
  tournamentInfo?: {
    name: string;
    rank?: number;
    participants: number;
  };
}> {
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

  } catch (error) {
    console.error('Get balance context error:', error);
    return { mode: 'regular', balance: 0 };
  }
}

/**
 * Check if user can place bet (respects tournament or regular balance)
 */
export async function canUserPlaceBet(userId: number, amount: number): Promise<{ canBet: boolean; reason?: string; mode: 'tournament' | 'regular' }> {
  try {
    const context = await getUserBalanceContext(userId);

    if (context.balance < amount) {
      return {
        canBet: false,
        reason: `Insufficient ${context.mode === 'tournament' ? 'tournament' : 'regular'} PIPChips (${context.balance} available, ${amount} needed)`,
        mode: context.mode
      };
    }

    return { canBet: true, mode: context.mode };

  } catch (error) {
    console.error('Can user bet check error:', error);
    return { canBet: false, reason: 'Error checking balance', mode: 'regular' };
  }
}

/**
 * Get tournament leaderboard for display in Discord
 */
export async function getActiveUserTournamentStatus(userId: number): Promise<{
  inTournament: boolean;
  tournamentName?: string;
  rank?: number;
  balance?: number;
  profit?: number;
  totalParticipants?: number;
} | null> {
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

  } catch (error) {
    console.error('Tournament status error:', error);
    return null;
  }
}

/**
 * Simple tournament creation for admins
 */
export async function createTournament(params: {
  name: string;
  description?: string;
  entryFeeUSD: number;
  startTime: Date;
  endTime: Date;
  prizeTokens: Array<{ tokenId: number; amount: number }>;
  maxPlayers?: number;
}): Promise<{ success: boolean; tournamentId?: string; error?: string }> {
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

  } catch (error) {
    console.error('Tournament creation error:', error);
    return { success: false, error: 'Failed to create tournament' };
  }
}