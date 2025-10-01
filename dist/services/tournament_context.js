import { prisma } from "./db.js";
import { Decimal } from "@prisma/client/runtime/library";
import { logCompleteTransaction } from "./tx_logger.js";
async function enterTournament(params) {
  try {
    const { tournamentId, userId, tokenType, entryFeeAmount } = params;
    const tournament = await prisma.tournamentSession.findUnique({
      where: { id: tournamentId },
      include: { participants: true }
    });
    if (!tournament) {
      return { success: false, error: "Tournament not found" };
    }
    if (tournament.status !== "UPCOMING" && tournament.status !== "ACTIVE") {
      return { success: false, error: "Tournament is not accepting entries" };
    }
    const existingEntry = await prisma.tournamentParticipant.findUnique({
      where: {
        tournamentId_userId: { tournamentId, userId }
      }
    });
    if (existingEntry) {
      return { success: false, error: "Already entered in this tournament" };
    }
    if (tournament.maxPlayers && tournament.participants.length >= tournament.maxPlayers) {
      return { success: false, error: "Tournament is full" };
    }
    const token = await prisma.token.findFirst({
      where: { symbol: tokenType, active: true }
    });
    if (!token) {
      return { success: false, error: `Token ${tokenType} not found or not active` };
    }
    const userBalance = await prisma.userBalance.findUnique({
      where: {
        userId_tokenId: { userId, tokenId: token.id }
      }
    });
    if (!userBalance || Number(userBalance.amount) < entryFeeAmount) {
      return { success: false, error: `Insufficient ${tokenType} balance` };
    }
    await prisma.$transaction(async (tx) => {
      const entryFeeAtomic = BigInt(Math.round(entryFeeAmount * 10 ** token.decimals));
      const idempotencyKey = `tournament_entry_${tournamentId}_${userId}`;
      await logCompleteTransaction(tx, {
        operation: "TOURNAMENT_ENTRY",
        userId,
        balanceChanges: [{
          tokenId: token.id,
          userId,
          amountDelta: -entryFeeAtomic,
          reason: "tournament_entry_fee"
        }],
        metadata: {
          tournamentId,
          tournamentName: tournament.name,
          startingPIPChips: tournament.startingPIPChips,
          tokenType
        },
        idempotencyKey,
        source: "BOT"
      });
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
      await tx.user.update({
        where: { id: userId },
        data: {
          inTournamentMode: true,
          activeTournamentId: tournamentId
        }
      });
      const currentUser = await tx.user.findUnique({ where: { id: userId } });
      await tx.pipchipsTransaction.create({
        data: {
          userId: userId.toString(),
          amount: BigInt(tournament.startingPIPChips),
          transactionType: "TOURNAMENT_ENTRY",
          description: `Tournament starting PIPChips: ${tournament.name}`,
          balanceAfter: currentUser?.pipchipsBalance || BigInt(0),
          metadata: {
            tournamentId,
            isTournamentBalance: true,
            tokenUsedForEntry: tokenType,
            entryFeeAmount
          }
        }
      });
    });
    console.log(`\u2705 User ${userId} entered tournament ${tournamentId} with ${tournament.startingPIPChips} PIPChips`);
    return { success: true };
  } catch (error) {
    console.error("Tournament entry error:", error);
    return { success: false, error: "Failed to enter tournament" };
  }
}
async function placeTournamentAwareParticipation(params) {
  try {
    const { userId, marketId, amount, side } = params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tournamentParticipants: {
          where: {
            tournament: { status: "ACTIVE" }
          },
          include: { tournament: true }
        }
      }
    });
    if (!user) {
      return { success: false, error: "User not found" };
    }
    if (user.inTournamentMode && user.activeTournamentId && user.tournamentParticipants.length > 0) {
      const participant = user.tournamentParticipants[0];
      if (participant.pipchipsBalance < amount) {
        return { success: false, error: "Insufficient tournament PIPChips" };
      }
      await prisma.$transaction(async (tx) => {
        await tx.tournamentParticipant.update({
          where: { id: participant.id },
          data: {
            pipchipsBalance: { decrement: amount },
            marketsPlayed: { increment: 1 },
            totalWagered: { increment: amount }
          }
        });
        await tx.predictionParticipation.create({
          data: {
            userId: userId.toString(),
            marketId,
            amount,
            side,
            tokenSymbol: "PIPChips"
          }
        });
        await tx.pipchipsTransaction.create({
          data: {
            userId: userId.toString(),
            amount: BigInt(-amount),
            transactionType: "TOURNAMENT_BET",
            description: `Tournament participation: ${amount} PIPChips on ${side}`,
            balanceAfter: BigInt(0),
            // Tournament balance - not tracked in regular pipchips
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
      if (Number(user.pipchipsBalance) < amount) {
        return { success: false, error: "Insufficient regular PIPChips" };
      }
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            pipchipsBalance: { decrement: amount },
            pipchipsSpentTotal: { increment: amount }
          }
        });
        await tx.predictionParticipation.create({
          data: {
            userId: userId.toString(),
            marketId,
            amount,
            side,
            tokenSymbol: "PIPChips"
          }
        });
        const updatedUser = await tx.user.findUnique({ where: { id: userId } });
        await tx.pipchipsTransaction.create({
          data: {
            userId: userId.toString(),
            amount: BigInt(-amount),
            transactionType: "BET_PLACED",
            description: `Prediction participation: ${amount} PIPChips on ${side}`,
            balanceAfter: updatedUser?.pipchipsBalance || BigInt(0),
            metadata: { marketId, side }
          }
        });
      });
      return { success: true, usedTournamentBalance: false };
    }
  } catch (error) {
    console.error("Tournament-aware participation error:", error);
    return { success: false, error: "Failed to place participation" };
  }
}
async function processWinningsWithContext(userId, marketId, winnings, won) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tournamentParticipants: {
          where: {
            tournament: { status: "ACTIVE" }
          }
        }
      }
    });
    if (!user) return;
    const participation = await prisma.predictionParticipation.findFirst({
      where: {
        userId: userId.toString(),
        marketId
      },
      orderBy: { createdAt: "desc" }
    });
    const isTournamentParticipation = user.inTournamentMode && user.activeTournamentId;
    if (isTournamentParticipation && user.inTournamentMode && user.activeTournamentId && user.tournamentParticipants.length > 0) {
      const participant = user.tournamentParticipants[0];
      await prisma.$transaction(async (tx) => {
        await tx.tournamentParticipant.update({
          where: { id: participant.id },
          data: {
            pipchipsBalance: { increment: winnings },
            correctPredictions: won ? { increment: 1 } : void 0
          }
        });
        await tx.pipchipsTransaction.create({
          data: {
            userId: userId.toString(),
            amount: BigInt(winnings),
            transactionType: "TOURNAMENT_WIN",
            description: `Tournament participation ${won ? "won" : "refunded"}: ${winnings} PIPChips`,
            balanceAfter: BigInt(0),
            // Tournament balance - not tracked in regular pipchips
            metadata: {
              tournamentId: user.activeTournamentId,
              marketId,
              won,
              isTournamentBalance: true
            }
          }
        });
      });
      console.log(`\u2705 Tournament winnings: ${winnings} PIPChips credited to tournament balance`);
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            pipchipsBalance: { increment: winnings },
            pipchipsEarnedTotal: { increment: winnings }
          }
        });
        const updatedUser = await tx.user.findUnique({ where: { id: userId } });
        await tx.pipchipsTransaction.create({
          data: {
            userId: userId.toString(),
            amount: BigInt(winnings),
            transactionType: "BET_WON",
            description: `Prediction participation ${won ? "won" : "refunded"}: ${winnings} PIPChips`,
            balanceAfter: updatedUser?.pipchipsBalance || BigInt(0),
            metadata: { marketId, won }
          }
        });
      });
      console.log(`\u2705 Regular winnings: ${winnings} PIPChips credited to regular balance`);
    }
  } catch (error) {
    console.error("Process winnings context error:", error);
  }
}
async function getTournamentLeaderboard(tournamentId) {
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
        { pipchipsBalance: "desc" },
        { correctPredictions: "desc" },
        { enteredAt: "asc" }
        // Earlier entry as tiebreaker
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
      winRate: p.marketsPlayed > 0 ? (p.correctPredictions / p.marketsPlayed * 100).toFixed(1) : "0",
      totalWagered: p.totalWagered,
      enteredAt: p.enteredAt
    }));
  } catch (error) {
    console.error("Tournament leaderboard error:", error);
    return [];
  }
}
async function exitTournamentMode(userId) {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        inTournamentMode: false,
        activeTournamentId: null
      }
    });
    console.log(`\u2705 User ${userId} exited tournament mode`);
  } catch (error) {
    console.error("Exit tournament mode error:", error);
  }
}
async function getUserDashboard(userId) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tournamentParticipants: {
          where: {
            tournament: { status: "ACTIVE" }
          },
          include: { tournament: true }
        }
      }
    });
    if (!user) return null;
    if (user.inTournamentMode && user.activeTournamentId && user.tournamentParticipants.length > 0) {
      const participant = user.tournamentParticipants[0];
      const leaderboard = await getTournamentLeaderboard(user.activeTournamentId);
      const userRank = leaderboard.find((p) => p.userId === userId)?.rank || null;
      return {
        mode: "tournament",
        balance: participant.pipchipsBalance,
        regularBalance: Number(user.pipchipsBalance),
        // Show but indicate it's inactive
        tournament: {
          id: participant.tournament.id,
          name: participant.tournament.name,
          description: participant.tournament.description,
          endsAt: participant.tournament.endTime,
          yourRank: userRank,
          totalParticipants: leaderboard.length,
          leaderboard: leaderboard.slice(0, 10),
          // Top 10
          stats: {
            profit: participant.pipchipsBalance - participant.pipchipsStart,
            marketsPlayed: participant.marketsPlayed,
            correctPredictions: participant.correctPredictions,
            winRate: participant.marketsPlayed > 0 ? (participant.correctPredictions / participant.marketsPlayed * 100).toFixed(1) : "0"
          }
        }
      };
    } else {
      return {
        mode: "regular",
        balance: Number(user.pipchipsBalance),
        tournamentBalance: null,
        nextTournament: await getNextTournament(),
        stats: {
          totalEarned: Number(user.pipchipsEarnedTotal),
          totalSpent: Number(user.pipchipsSpentTotal),
          winStreak: user.wins
          // Simplified - could get from matches
        }
      };
    }
  } catch (error) {
    console.error("User dashboard error:", error);
    return null;
  }
}
async function getNextTournament() {
  try {
    return await prisma.tournamentSession.findFirst({
      where: {
        status: "UPCOMING",
        startTime: { gt: /* @__PURE__ */ new Date() }
      },
      orderBy: { startTime: "asc" }
    });
  } catch (error) {
    console.error("Next tournament error:", error);
    return null;
  }
}
export {
  enterTournament,
  exitTournamentMode,
  getNextTournament,
  getTournamentLeaderboard,
  getUserDashboard,
  placeTournamentAwareParticipation,
  processWinningsWithContext
};
//# sourceMappingURL=tournament_context.js.map
