import { prisma } from "./db.js";
import { placeTournamentAwareParticipation, processWinningsWithContext } from "./tournament_context.js";
async function placeParticipationWithTournamentContext(params) {
  const { userId, discordId, marketId, amount, side } = params;
  try {
    const result = await placeTournamentAwareParticipation({
      userId,
      marketId,
      amount,
      side
    });
    if (result.success) {
      console.log(`\u{1F3AF} Participation placed: ${discordId} wagered ${amount} PIPChips on ${side} ${result.usedTournamentBalance ? "(Tournament)" : "(Regular)"}`);
    }
    return result;
  } catch (error) {
    console.error("Tournament integration participation error:", error);
    return { success: false, error: "Failed to place participation" };
  }
}
async function processPayoutsWithTournamentContext(marketId, outcome) {
  try {
    const participations = await prisma.predictionParticipation.findMany({
      where: { marketId },
      select: {
        id: true,
        userId: true,
        marketId: true,
        side: true,
        amount: true,
        tokenSymbol: true,
        sharesPurchased: true,
        createdAt: true
      }
    });
    console.log(`\u{1F3AF} Processing ${participations.length} participations for market ${marketId} with outcome ${outcome}`);
    for (const participation of participations) {
      const won = participation.side === outcome;
      let payout = 0;
      if (won) {
        payout = Number(participation.amount) * 2;
      } else {
        payout = 0;
      }
      const userIdNum = parseInt(participation.userId);
      if (payout > 0) {
        await processWinningsWithContext(
          userIdNum,
          marketId,
          payout,
          won
        );
      }
      console.log(`${won ? "\u2705 Win" : "\u274C Loss"}: User ${participation.userId} ${won ? `gets ${payout}` : "loses"} PIPChips`);
    }
  } catch (error) {
    console.error("Tournament payout processing error:", error);
  }
}
async function getUserBalanceContext(userId) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tournamentParticipants: {
          where: {
            tournament: { status: "ACTIVE" }
          },
          include: { tournament: { include: { participants: true } } }
        }
      }
    });
    if (!user) {
      return { mode: "regular", balance: 0 };
    }
    if (user.inTournamentMode && user.activeTournamentId && user.tournamentParticipants.length > 0) {
      const participant = user.tournamentParticipants[0];
      return {
        mode: "tournament",
        balance: participant.pipchipsBalance,
        tournamentInfo: {
          name: participant.tournament.name,
          participants: participant.tournament.participants.length
        }
      };
    }
    return {
      mode: "regular",
      balance: Number(user.pipchipsBalance)
    };
  } catch (error) {
    console.error("Get balance context error:", error);
    return { mode: "regular", balance: 0 };
  }
}
async function canUserPlaceParticipation(userId, amount) {
  try {
    const context = await getUserBalanceContext(userId);
    if (context.balance < amount) {
      return {
        canParticipate: false,
        reason: `Insufficient ${context.mode === "tournament" ? "tournament" : "regular"} PIPChips (${context.balance} available, ${amount} needed)`,
        mode: context.mode
      };
    }
    return { canParticipate: true, mode: context.mode };
  } catch (error) {
    console.error("Can user participate check error:", error);
    return { canParticipate: false, reason: "Error checking balance", mode: "regular" };
  }
}
async function getActiveUserTournamentStatus(userId) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tournamentParticipants: {
          where: {
            tournament: { status: "ACTIVE" }
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
    console.error("Tournament status error:", error);
    return null;
  }
}
async function createTournament(params) {
  try {
    const tournament = await prisma.tournamentSession.create({
      data: {
        name: params.name,
        description: params.description,
        entryFeeUSD: params.entryFeeUSD,
        startTime: params.startTime,
        endTime: params.endTime,
        status: "UPCOMING",
        maxPlayers: params.maxPlayers,
        prizeTokens: params.prizeTokens,
        prizeDistribution: {
          "1": 40,
          "2": 25,
          "3": 15,
          "4-10": 20
        },
        startingPIPChips: 1e4
      }
    });
    console.log(`\u{1F3C6} Tournament created: ${tournament.name} (${tournament.id})`);
    return { success: true, tournamentId: tournament.id };
  } catch (error) {
    console.error("Tournament creation error:", error);
    return { success: false, error: "Failed to create tournament" };
  }
}
export {
  canUserPlaceParticipation,
  createTournament,
  getActiveUserTournamentStatus,
  getUserBalanceContext,
  placeParticipationWithTournamentContext,
  processPayoutsWithTournamentContext
};
//# sourceMappingURL=tournament_integration.js.map
