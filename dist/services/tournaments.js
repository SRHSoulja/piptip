import { prisma } from "./db.js";
import { Decimal } from "@prisma/client/runtime/library";
async function getTournamentConfig(tournamentId) {
  try {
    console.warn(`TODO: Implement tournament config storage for ID: ${tournamentId}`);
    return null;
  } catch (error) {
    console.error("Error getting tournament config:", error);
    return null;
  }
}
async function setTournamentConfig(config) {
  try {
    console.warn(`TODO: Save tournament config for ${config.name}`);
    return true;
  } catch (error) {
    console.error("Error setting tournament config:", error);
    return false;
  }
}
function calculatePrizeDistribution(config, totalParticipants) {
  const results = [];
  for (const [positionKey, percentage] of Object.entries(config.prizeDistribution)) {
    if (positionKey.includes("-")) {
      const [start, end] = positionKey.split("-").map(Number);
      const rangeSize = Math.min(end - start + 1, Math.max(0, totalParticipants - start + 1));
      const perPersonPercentage = percentage / rangeSize;
      for (let pos = start; pos <= Math.min(end, totalParticipants); pos++) {
        results.push({
          position: pos,
          percentage: perPersonPercentage,
          prizes: config.prizeTokens.map((token) => ({
            tokenId: token.tokenId,
            tokenSymbol: token.tokenSymbol,
            amount: token.amount * perPersonPercentage / 100
          }))
        });
      }
    } else {
      const position = Number(positionKey);
      if (position <= totalParticipants) {
        results.push({
          position,
          percentage,
          prizes: config.prizeTokens.map((token) => ({
            tokenId: token.tokenId,
            tokenSymbol: token.tokenSymbol,
            amount: token.amount * percentage / 100
          }))
        });
      }
    }
  }
  return results.sort((a, b) => a.position - b.position);
}
async function distributeTournamentPrizes(tournamentId, leaderboard) {
  const config = await getTournamentConfig(tournamentId);
  if (!config) {
    return { success: false, distributed: 0, errors: ["Tournament configuration not found"] };
  }
  const prizeDistribution = calculatePrizeDistribution(config, leaderboard.length);
  const errors = [];
  let distributed = 0;
  try {
    await prisma.$transaction(async (tx) => {
      for (const winner of leaderboard) {
        const prizeInfo = prizeDistribution.find((p) => p.position === winner.position);
        if (!prizeInfo || prizeInfo.prizes.length === 0) continue;
        try {
          for (const prize of prizeInfo.prizes) {
            if (prize.amount <= 0) continue;
            await tx.userBalance.upsert({
              where: {
                userId_tokenId: {
                  userId: winner.userId,
                  tokenId: prize.tokenId
                }
              },
              update: {
                amount: {
                  increment: new Decimal(prize.amount)
                }
              },
              create: {
                userId: winner.userId,
                tokenId: prize.tokenId,
                amount: new Decimal(prize.amount)
              }
            });
            await tx.pipchipsTransaction.create({
              data: {
                userId: winner.userId.toString(),
                amount: BigInt(prize.amount),
                transactionType: "TOURNAMENT_PRIZE",
                balanceAfter: BigInt(0),
                // Will be updated by service
                description: `Tournament prize: ${config.name} - Position #${winner.position}`,
                metadata: {
                  tournamentId,
                  tournamentName: config.name,
                  position: winner.position,
                  percentage: prizeInfo.percentage,
                  tokenSymbol: prize.tokenSymbol,
                  totalParticipants: leaderboard.length
                }
              }
            });
          }
          distributed++;
          console.log(`\u2705 Distributed prizes to ${winner.discordId} (position #${winner.position})`);
        } catch (error) {
          console.error(`\u274C Failed to distribute prizes to ${winner.discordId}:`, error);
          errors.push(`Failed to distribute prizes to position #${winner.position}: ${error}`);
        }
      }
    });
    console.log(`Tournament ${tournamentId} completed:`, {
      participants: leaderboard.length,
      prizesDistributed: distributed,
      errors
    });
    return {
      success: errors.length === 0,
      distributed,
      errors
    };
  } catch (error) {
    console.error("Error in tournament prize distribution transaction:", error);
    return {
      success: false,
      distributed,
      errors: [`Transaction failed: ${error}`]
    };
  }
}
async function calculateDynamicPrizePool(tournamentId) {
  try {
    console.warn(`TODO: Calculate dynamic prize pool for tournament ${tournamentId}`);
    const entries = [];
    const tokenPools = {};
    for (const entry of entries) {
      const tokenSymbol = entry.metadata?.tokenSymbol || "PIPChips";
      tokenPools[tokenSymbol] = (tokenPools[tokenSymbol] || 0) + Number(entry.amount);
    }
    const prizePool = {};
    for (const [token, amount] of Object.entries(tokenPools)) {
      prizePool[token] = amount * 0.8;
    }
    return prizePool;
  } catch (error) {
    console.error("Error calculating dynamic prize pool:", error);
    return {};
  }
}
async function getTournamentLeaderboard(tournamentId, limit = 50) {
  try {
    const users = await prisma.user.findMany({
      take: limit,
      orderBy: { createdAt: "desc" }
    });
    return users.map((user, index) => ({
      userId: user.id,
      discordId: user.discordId,
      score: Math.floor(Math.random() * 1e3),
      // Mock score
      position: index + 1
    }));
  } catch (error) {
    console.error("Error getting tournament leaderboard:", error);
    return [];
  }
}
async function displayTournamentPrizePool(tournamentId) {
  const config = await getTournamentConfig(tournamentId);
  if (!config) return null;
  const breakdown = {};
  for (const [positionKey, percentage] of Object.entries(config.prizeDistribution)) {
    const positionLabel = positionKey.includes("-") ? `\u{1F3C5} ${positionKey.replace("-", "th-")}th Place` : positionKey === "1" ? "\u{1F947} 1st Place" : positionKey === "2" ? "\u{1F948} 2nd Place" : positionKey === "3" ? "\u{1F949} 3rd Place" : `\u{1F3C5} ${positionKey}th Place`;
    if (positionKey.includes("-")) {
      const [start, end] = positionKey.split("-").map(Number);
      const rangeSize = end - start + 1;
      const perPersonPercentage = percentage / rangeSize;
      breakdown[positionLabel] = config.prizeTokens.map(
        (token) => `${(token.amount * perPersonPercentage / 100).toFixed(2)} ${token.tokenSymbol}`
      );
    } else {
      breakdown[positionLabel] = config.prizeTokens.map(
        (token) => `${(token.amount * percentage / 100).toFixed(2)} ${token.tokenSymbol}`
      );
    }
  }
  return {
    total: config.prizeTokens.map((p) => `${p.amount} ${p.tokenSymbol}`).join(" + "),
    breakdown
  };
}
export {
  calculateDynamicPrizePool,
  calculatePrizeDistribution,
  displayTournamentPrizePool,
  distributeTournamentPrizes,
  getTournamentConfig,
  getTournamentLeaderboard,
  setTournamentConfig
};
//# sourceMappingURL=tournaments.js.map
