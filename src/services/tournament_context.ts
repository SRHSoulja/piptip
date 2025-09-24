// src/services/tournament_context.ts - Context-based tournament system with isolated PIPChips
import { prisma } from "./db.js";
import { Decimal } from "@prisma/client/runtime/library";

export interface TournamentEntry {
  tournamentId: string;
  userId: number;
  tokenType: string;
  entryFeeAmount: number;
}

export interface TournamentBet {
  userId: number;
  marketId: string;
  amount: number;
  side: string;
}

/**
 * Enter a tournament with token payment and isolated PIPChips balance
 */
export async function enterTournament(params: TournamentEntry): Promise<{ success: boolean; error?: string }> {
  try {
    const { tournamentId, userId, tokenType, entryFeeAmount } = params;

    // Get tournament details
    const tournament = await prisma.tournamentSession.findUnique({
      where: { id: tournamentId },
      include: { participants: true }
    });

    if (!tournament) {
      return { success: false, error: 'Tournament not found' };
    }

    if (tournament.status !== 'UPCOMING' && tournament.status !== 'ACTIVE') {
      return { success: false, error: 'Tournament is not accepting entries' };
    }

    // Check if already entered
    const existingEntry = await prisma.tournamentParticipant.findUnique({
      where: {
        tournamentId_userId: { tournamentId, userId }
      }
    });

    if (existingEntry) {
      return { success: false, error: 'Already entered in this tournament' };
    }

    // Check participant limits
    if (tournament.maxPlayers && tournament.participants.length >= tournament.maxPlayers) {
      return { success: false, error: 'Tournament is full' };
    }

    // Get token for entry fee
    const token = await prisma.token.findFirst({
      where: { symbol: tokenType, active: true }
    });

    if (!token) {
      return { success: false, error: `Token ${tokenType} not found or not active` };
    }

    // Check user balance
    const userBalance = await prisma.userBalance.findUnique({
      where: {
        userId_tokenId: { userId, tokenId: token.id }
      }
    });

    if (!userBalance || Number(userBalance.amount) < entryFeeAmount) {
      return { success: false, error: `Insufficient ${tokenType} balance` };
    }

    // Process tournament entry in transaction
    await prisma.$transaction(async (tx) => {
      // Deduct entry fee from user balance
      await tx.userBalance.update({
        where: {
          userId_tokenId: { userId, tokenId: token.id }
        },
        data: {
          amount: {
            decrement: new Decimal(entryFeeAmount)
          }
        }
      });

      // Create tournament participant with isolated PIPChips
      await tx.tournamentParticipant.create({
        data: {
          tournamentId,
          userId,
          pipchipsStart: tournament.startingPIPChips,
          pipchipsBalance: tournament.startingPIPChips,
          entryTokenId: token.id,
          entryAmount: new Decimal(entryFeeAmount)
        }
      });

      // Put user into tournament mode
      await tx.user.update({
        where: { id: userId },
        data: {
          inTournamentMode: true,
          activeTournamentId: tournamentId
        }
      });

      // Log entry fee transaction
      await tx.transaction.create({
        data: {
          userId,
          tokenId: token.id,
          amount: new Decimal(-entryFeeAmount),
          type: 'TOURNAMENT_ENTRY',
          description: `Tournament entry: ${tournament.name}`,
          metadata: {
            tournamentId,
            tournamentName: tournament.name
          }
        }
      });

      // Log PIPChips allocation
      await tx.pipchipsTransaction.create({
        data: {
          userId,
          amount: tournament.startingPIPChips,
          type: 'TOURNAMENT_ENTRY',
          description: `Tournament starting PIPChips: ${tournament.name}`,
          metadata: {
            tournamentId,
            isTournamentBalance: true,
            tokenUsedForEntry: tokenType,
            entryFeeAmount
          }
        }
      });
    });

    console.log(`✅ User ${userId} entered tournament ${tournamentId} with ${tournament.startingPIPChips} PIPChips`);
    return { success: true };

  } catch (error) {
    console.error('Tournament entry error:', error);
    return { success: false, error: 'Failed to enter tournament' };
  }
}

/**
 * Place a bet using tournament context (isolated PIPChips vs regular balance)
 */
export async function placeTournamentAwareBet(params: TournamentBet): Promise<{ success: boolean; error?: string; usedTournamentBalance?: boolean }> {
  try {
    const { userId, marketId, amount, side } = params;

    // Get user with tournament context
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tournamentParticipants: {
          where: {
            tournament: { status: 'ACTIVE' }
          },
          include: { tournament: true }
        }
      }
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Check if user is in active tournament mode
    if (user.inTournamentMode && user.activeTournamentId && user.tournamentParticipants.length > 0) {
      // USE TOURNAMENT BALANCE
      const participant = user.tournamentParticipants[0];

      if (participant.pipchipsBalance < amount) {
        return { success: false, error: 'Insufficient tournament PIPChips' };
      }

      // Process tournament bet
      await prisma.$transaction(async (tx) => {
        // Deduct from tournament balance
        await tx.tournamentParticipant.update({
          where: { id: participant.id },
          data: {
            pipchipsBalance: { decrement: amount },
            marketsPlayed: { increment: 1 },
            totalWagered: { increment: amount }
          }
        });

        // Create prediction bet with tournament context
        await tx.predictionBet.create({
          data: {
            userId,
            marketId,
            amount: new Decimal(amount),
            side,
            tokenSymbol: 'PIPChips', // Tournament PIPChips
            metadata: {
              tournamentId: user.activeTournamentId,
              isTournamentBet: true
            }
          }
        });

        // Log tournament-specific transaction
        await tx.pipchipsTransaction.create({
          data: {
            userId,
            amount: -amount,
            type: 'TOURNAMENT_BET',
            description: `Tournament bet: ${amount} PIPChips on ${side}`,
            metadata: {
              tournamentId: user.activeTournamentId,
              marketId,
              side,
              isTournamentBalance: true
            }
          }
        });
      });

      return { success: true, usedTournamentBalance: true };

    } else {
      // USE REGULAR PIPCHIPS BALANCE
      if (Number(user.pipchipsBalance) < amount) {
        return { success: false, error: 'Insufficient regular PIPChips' };
      }

      // Process regular bet using existing system
      await prisma.$transaction(async (tx) => {
        // Deduct from regular balance
        await tx.user.update({
          where: { id: userId },
          data: {
            pipchipsBalance: { decrement: amount },
            pipchipsSpentTotal: { increment: amount }
          }
        });

        // Create prediction bet
        await tx.predictionBet.create({
          data: {
            userId,
            marketId,
            amount: new Decimal(amount),
            side,
            tokenSymbol: 'PIPChips'
          }
        });

        // Log regular transaction
        await tx.pipchipsTransaction.create({
          data: {
            userId,
            amount: -amount,
            type: 'PREDICTION_BET',
            description: `Prediction bet: ${amount} PIPChips on ${side}`,
            metadata: { marketId, side }
          }
        });
      });

      return { success: true, usedTournamentBalance: false };
    }

  } catch (error) {
    console.error('Tournament-aware bet error:', error);
    return { success: false, error: 'Failed to place bet' };
  }
}

/**
 * Process bet winnings with tournament context awareness
 */
export async function processWinningsWithContext(userId: number, marketId: string, winnings: number, won: boolean): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tournamentParticipants: {
          where: {
            tournament: { status: 'ACTIVE' }
          }
        }
      }
    });

    if (!user) return;

    // Check if this was a tournament bet
    const bet = await prisma.predictionBet.findFirst({
      where: {
        userId,
        marketId
      },
      orderBy: { createdAt: 'desc' }
    });

    const isTournamentBet = bet?.metadata &&
      typeof bet.metadata === 'object' &&
      bet.metadata !== null &&
      'isTournamentBet' in bet.metadata &&
      bet.metadata.isTournamentBet === true;

    if (isTournamentBet && user.inTournamentMode && user.activeTournamentId && user.tournamentParticipants.length > 0) {
      // TOURNAMENT WINNINGS - Add to tournament balance
      const participant = user.tournamentParticipants[0];

      await prisma.$transaction(async (tx) => {
        // Credit tournament balance
        await tx.tournamentParticipant.update({
          where: { id: participant.id },
          data: {
            pipchipsBalance: { increment: winnings },
            correctPredictions: won ? { increment: 1 } : undefined
          }
        });

        // Log tournament winnings
        await tx.pipchipsTransaction.create({
          data: {
            userId,
            amount: winnings,
            type: 'TOURNAMENT_WIN',
            description: `Tournament bet ${won ? 'won' : 'refunded'}: ${winnings} PIPChips`,
            metadata: {
              tournamentId: user.activeTournamentId,
              marketId,
              won,
              isTournamentBalance: true
            }
          }
        });
      });

      console.log(`✅ Tournament winnings: ${winnings} PIPChips credited to tournament balance`);

    } else {
      // REGULAR WINNINGS - Add to regular balance
      await prisma.$transaction(async (tx) => {
        // Credit regular balance
        await tx.user.update({
          where: { id: userId },
          data: {
            pipchipsBalance: { increment: winnings },
            pipchipsEarnedTotal: { increment: winnings }
          }
        });

        // Log regular winnings
        await tx.pipchipsTransaction.create({
          data: {
            userId,
            amount: winnings,
            type: 'PREDICTION_WIN',
            description: `Prediction bet ${won ? 'won' : 'refunded'}: ${winnings} PIPChips`,
            metadata: { marketId, won }
          }
        });
      });

      console.log(`✅ Regular winnings: ${winnings} PIPChips credited to regular balance`);
    }

  } catch (error) {
    console.error('Process winnings context error:', error);
  }
}

/**
 * Get tournament leaderboard with real-time standings
 */
export async function getTournamentLeaderboard(tournamentId: string) {
  try {
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      include: {
        user: {
          select: {
            discordId: true,
            createdAt: true
          }
        }
      },
      orderBy: [
        { pipchipsBalance: 'desc' },
        { correctPredictions: 'desc' },
        { enteredAt: 'asc' } // Earlier entry as tiebreaker
      ]
    });

    return participants.map((p, index) => ({
      rank: index + 1,
      userId: p.userId,
      discordId: p.user.discordId,
      startingChips: p.pipchipsStart,
      currentChips: p.pipchipsBalance,
      profit: p.pipchipsBalance - p.pipchipsStart,
      profitPercent: ((p.pipchipsBalance - p.pipchipsStart) / p.pipchipsStart * 100).toFixed(1),
      marketsPlayed: p.marketsPlayed,
      correctPredictions: p.correctPredictions,
      winRate: p.marketsPlayed > 0
        ? (p.correctPredictions / p.marketsPlayed * 100).toFixed(1)
        : '0',
      totalWagered: p.totalWagered,
      enteredAt: p.enteredAt
    }));

  } catch (error) {
    console.error('Tournament leaderboard error:', error);
    return [];
  }
}

/**
 * Exit tournament mode (for tournament completion or user leaving)
 */
export async function exitTournamentMode(userId: number): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        inTournamentMode: false,
        activeTournamentId: null
      }
    });

    console.log(`✅ User ${userId} exited tournament mode`);
  } catch (error) {
    console.error('Exit tournament mode error:', error);
  }
}

/**
 * Get user dashboard data with tournament context
 */
export async function getUserDashboard(userId: number) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tournamentParticipants: {
          where: {
            tournament: { status: 'ACTIVE' }
          },
          include: { tournament: true }
        }
      }
    });

    if (!user) return null;

    if (user.inTournamentMode && user.activeTournamentId && user.tournamentParticipants.length > 0) {
      // TOURNAMENT MODE DASHBOARD
      const participant = user.tournamentParticipants[0];
      const leaderboard = await getTournamentLeaderboard(user.activeTournamentId);
      const userRank = leaderboard.find(p => p.userId === userId)?.rank || null;

      return {
        mode: 'tournament',
        balance: participant.pipchipsBalance,
        regularBalance: Number(user.pipchipsBalance), // Show but indicate it's inactive
        tournament: {
          id: participant.tournament.id,
          name: participant.tournament.name,
          description: participant.tournament.description,
          endsAt: participant.tournament.endTime,
          yourRank: userRank,
          totalParticipants: leaderboard.length,
          leaderboard: leaderboard.slice(0, 10), // Top 10
          stats: {
            profit: participant.pipchipsBalance - participant.pipchipsStart,
            marketsPlayed: participant.marketsPlayed,
            correctPredictions: participant.correctPredictions,
            winRate: participant.marketsPlayed > 0
              ? (participant.correctPredictions / participant.marketsPlayed * 100).toFixed(1)
              : '0'
          }
        }
      };

    } else {
      // REGULAR MODE DASHBOARD
      return {
        mode: 'regular',
        balance: Number(user.pipchipsBalance),
        tournamentBalance: null,
        nextTournament: await getNextTournament(),
        stats: {
          totalEarned: Number(user.pipchipsEarnedTotal),
          totalSpent: Number(user.pipchipsSpentTotal),
          winStreak: user.wins // Simplified - could get from matches
        }
      };
    }

  } catch (error) {
    console.error('User dashboard error:', error);
    return null;
  }
}

/**
 * Get next upcoming tournament
 */
export async function getNextTournament() {
  try {
    return await prisma.tournamentSession.findFirst({
      where: {
        status: 'UPCOMING',
        startTime: { gt: new Date() }
      },
      orderBy: { startTime: 'asc' }
    });
  } catch (error) {
    console.error('Next tournament error:', error);
    return null;
  }
}