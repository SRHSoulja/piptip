import { prisma } from "./db.js";
import { logCompleteTransaction } from "./tx_logger.js";
import { getTPIPBalance } from "./tpip_service.js";
const TPIP_TOKEN_ID = 4;
async function placeTournamentBet(params) {
  const { marketId, userId, discordId, side, amount, tournamentId, guildId } = params;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { inTournamentMode: true, activeTournamentId: true }
    });
    if (!user?.inTournamentMode || user.activeTournamentId !== tournamentId) {
      return { success: false, error: "User not in this tournament" };
    }
    const tpipBalance = await getTPIPBalance(userId);
    const amountBigInt = BigInt(amount);
    if (tpipBalance < amountBigInt) {
      return {
        success: false,
        error: `Insufficient TPIP: have ${tpipBalance}, need ${amountBigInt}`
      };
    }
    const market = await prisma.predictionMarket.findUnique({
      where: { id: marketId }
    });
    if (!market) {
      return { success: false, error: "Market not found" };
    }
    if (market.status !== "ACTIVE") {
      return { success: false, error: "Market is not active" };
    }
    const updatedMarket = await prisma.$transaction(async (tx) => {
      await logCompleteTransaction(tx, {
        source: "BOT",
        operation: "TOURNAMENT_WAGER",
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
          reason: "tournament_wager"
        }]
      });
      await tx.userBalance.update({
        where: {
          userId_tokenId: { userId, tokenId: TPIP_TOKEN_ID }
        },
        data: {
          amount: { decrement: amountBigInt.toString() }
        }
      });
      await tx.predictionParticipation.create({
        data: {
          userId: discordId,
          marketId,
          side,
          amount,
          tokenSymbol: "TPIP"
        }
      });
      const updateData = side === "YES" ? {
        totalYesBets: { increment: amount },
        totalBetCount: { increment: 1 }
      } : {
        totalNoBets: { increment: amount },
        totalBetCount: { increment: 1 }
      };
      return await tx.predictionMarket.update({
        where: { id: marketId },
        data: updateData
      });
    }, { timeout: 15e3 });
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
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Tournament bet failed"
    };
  }
}
async function resolveTournamentMarket(marketId, outcome, tournamentId) {
  try {
    const market = await prisma.predictionMarket.findUnique({
      where: { id: marketId },
      include: { participations: true }
    });
    if (!market) {
      return { success: false, error: "Market not found" };
    }
    if (market.status !== "ACTIVE") {
      return { success: false, error: "Market already resolved" };
    }
    if (outcome === "CANCEL") {
      return await cancelTournamentMarket(marketId, tournamentId);
    }
    const totalPool = market.totalYesBets + market.totalNoBets;
    const payouts = [];
    await prisma.$transaction(async (tx) => {
      const winningParticipations = market.participations.filter((p) => p.side === outcome);
      const winningPool = outcome === "YES" ? market.totalYesBets : market.totalNoBets;
      for (const participation of winningParticipations) {
        const winShare = participation.amount / winningPool;
        const payout = Math.floor(winShare * totalPool);
        if (payout > 0) {
          const user = await tx.user.findFirst({
            where: { discordId: participation.userId }
          });
          if (!user) continue;
          await logCompleteTransaction(tx, {
            source: "BOT",
            operation: "TOURNAMENT_WIN",
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
              reason: "tournament_win"
            }]
          });
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
      await tx.predictionMarket.update({
        where: { id: marketId },
        data: {
          status: "RESOLVED",
          outcome
        }
      });
    }, { timeout: 3e4 });
    return { success: true, payouts };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Market resolution failed"
    };
  }
}
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
      for (const participation of market.participations) {
        if (participation.amount > 0) {
          const user = await tx.user.findFirst({
            where: { discordId: participation.userId }
          });
          if (!user) continue;
          await logCompleteTransaction(tx, {
            source: "BOT",
            operation: "TOURNAMENT_REFUND",
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
              reason: "tournament_refund"
            }]
          });
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
      await tx.predictionMarket.update({
        where: { id: marketId },
        data: {
          status: "RESOLVED",
          outcome: "CANCEL"
        }
      });
    }, { timeout: 3e4 });
    return { success: true, payouts: refunds };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Market cancellation failed"
    };
  }
}
export {
  placeTournamentBet,
  resolveTournamentMarket
};
//# sourceMappingURL=tournament_prediction_markets.js.map
