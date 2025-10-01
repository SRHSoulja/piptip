import { EmbedBuilder, MessageFlags } from "discord.js";
import { prisma } from "../services/db.js";
import { getStreakLeaderboard } from "../services/streaks.js";
import { formatDecimalWithUSD } from "../services/token.js";
import { getCachedTokenPrices } from "../services/price_api.js";
import { cacheWithMetrics, CacheKeys, CacheTTL } from "../services/cache.js";
import { withTiming } from "../services/performance.js";
async function pipLeaderboard(i) {
  try {
    const category = i.options.getString("category") || "streaks";
    const validCategories = ["streaks", "wins", "winrate", "tips_sent", "tips_received", "referrals", "wealth"];
    if (!validCategories.includes(category)) {
      return i.reply({
        content: "\u274C Invalid leaderboard category",
        flags: MessageFlags.Ephemeral
      });
    }
    const limit = 10;
    const embed = await withTiming(
      "leaderboard_query",
      async () => {
        let embedResult;
        switch (category) {
          case "streaks":
            embedResult = await buildStreakLeaderboard(limit);
            break;
          case "wins":
            embedResult = await buildWinsLeaderboard(limit);
            break;
          case "winrate":
            embedResult = await buildWinRateLeaderboard(limit);
            break;
          case "tips_sent":
            embedResult = await buildTipsSentLeaderboard(limit);
            break;
          case "tips_received":
            embedResult = await buildTipsReceivedLeaderboard(limit);
            break;
          case "referrals":
            embedResult = await buildReferralLeaderboard(limit);
            break;
          case "wealth":
            embedResult = await buildWealthLeaderboard(limit);
            break;
          default:
            embedResult = await buildStreakLeaderboard(limit);
        }
        return embedResult;
      },
      { category }
    );
    await i.reply({
      embeds: [embed]
    });
  } catch (error) {
    console.error("Error in pip_leaderboard:", error);
    await i.reply({
      content: `\u274C Error loading leaderboard: ${error?.message || "Unknown error"}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {
    });
  }
}
async function buildStreakLeaderboard(limit) {
  const leaderboard = await getStreakLeaderboard(limit);
  const embed = new EmbedBuilder().setTitle("\u{1F525} Win Streak Leaderboard").setColor(16739179).setDescription("Top players by current win streak").setTimestamp();
  if (leaderboard.length === 0) {
    embed.addFields({
      name: "No Active Streaks",
      value: "Be the first to start a win streak!",
      inline: false
    });
  } else {
    const entries = await Promise.all(
      leaderboard.map(async (entry) => {
        const user = await prisma.user.findUnique({
          where: { discordId: entry.discordId },
          select: { discordId: true }
        });
        const medal = getMedal(entry.rank);
        const lastGameText = entry.lastGameAt ? `<t:${Math.floor(entry.lastGameAt.getTime() / 1e3)}:R>` : "Never";
        return `${medal} **#${entry.rank}** <@${entry.discordId}>
\u{1F525} Current: **${entry.currentWins}** | Best: **${entry.longestWins}**
Last game: ${lastGameText}
`;
      })
    );
    embed.addFields({
      name: "Top Players",
      value: entries.join("\n").substring(0, 1024),
      inline: false
    });
  }
  return embed;
}
async function buildWinsLeaderboard(limit) {
  const topWinners = await cacheWithMetrics(
    CacheKeys.leaderboard("wins"),
    async () => {
      return prisma.userStats.findMany({
        where: { matchesWon: { gt: 0 } },
        orderBy: [
          { matchesWon: "desc" },
          { updatedAt: "desc" }
        ],
        take: limit,
        include: {
          user: {
            select: {
              discordId: true,
              wins: true,
              losses: true,
              ties: true
            }
          }
        }
      });
    },
    CacheTTL.leaderboard
  );
  const embed = new EmbedBuilder().setTitle("\u{1F3C6} Total Wins Leaderboard").setColor(16766720).setDescription("Top players by total match wins").setTimestamp();
  if (topWinners.length === 0) {
    embed.addFields({
      name: "No Winners Yet",
      value: "Play matches to get on the leaderboard!",
      inline: false
    });
  } else {
    const entries = topWinners.map((stats, index) => {
      const rank = index + 1;
      const medal = getMedal(rank);
      const user = stats.user;
      const total = user.wins + user.losses + user.ties;
      const winRate = total > 0 ? (user.wins / total * 100).toFixed(1) : "0.0";
      return `${medal} **#${rank}** <@${user.discordId}>
\u{1F3C6} **${user.wins}** wins | ${winRate}% WR
Record: ${user.wins}W-${user.losses}L-${user.ties}T
`;
    });
    embed.addFields({
      name: "Top Winners",
      value: entries.join("\n").substring(0, 1024),
      inline: false
    });
  }
  return embed;
}
async function buildWinRateLeaderboard(limit) {
  const players = await prisma.user.findMany({
    where: {
      wins: { gt: 0 }
    },
    select: {
      discordId: true,
      wins: true,
      losses: true,
      ties: true
    }
  });
  const withWinRate = players.map((p) => {
    const total = p.wins + p.losses + p.ties;
    const winRate = total > 0 ? p.wins / total * 100 : 0;
    return { ...p, total, winRate };
  }).filter((p) => p.total >= 10).sort((a, b) => b.winRate - a.winRate).slice(0, limit);
  const embed = new EmbedBuilder().setTitle("\u{1F4CA} Win Rate Leaderboard").setColor(65280).setDescription("Top players by win percentage (min. 10 games)").setTimestamp();
  if (withWinRate.length === 0) {
    embed.addFields({
      name: "No Qualified Players",
      value: "Play at least 10 matches to qualify!",
      inline: false
    });
  } else {
    const entries = withWinRate.map((user, index) => {
      const rank = index + 1;
      const medal = getMedal(rank);
      return `${medal} **#${rank}** <@${user.discordId}>
\u{1F4CA} **${user.winRate.toFixed(1)}%** win rate
Record: ${user.wins}W-${user.losses}L-${user.ties}T (${user.total} games)
`;
    });
    embed.addFields({
      name: "Top Win Rates",
      value: entries.join("\n").substring(0, 1024),
      inline: false
    });
  }
  return embed;
}
async function buildTipsSentLeaderboard(limit) {
  const topTippers = await cacheWithMetrics(
    CacheKeys.leaderboard("tips_sent"),
    async () => {
      return prisma.userStats.findMany({
        where: { totalTipsSent: { gt: 0 } },
        orderBy: { totalTipsSent: "desc" },
        take: limit,
        include: {
          user: {
            select: { discordId: true }
          }
        }
      });
    },
    CacheTTL.leaderboard
  );
  const embed = new EmbedBuilder().setTitle("\u{1F4B8} Most Generous Tippers").setColor(10181046).setDescription("Top players by tips sent").setTimestamp();
  if (topTippers.length === 0) {
    embed.addFields({
      name: "No Tips Yet",
      value: "Be the first to tip!",
      inline: false
    });
  } else {
    const entries = topTippers.map((stats, index) => {
      const rank = index + 1;
      const medal = getMedal(rank);
      return `${medal} **#${rank}** <@${stats.user.discordId}>
\u{1F4B8} **${stats.totalTipsSent}** tips sent
`;
    });
    embed.addFields({
      name: "Most Generous",
      value: entries.filter((e) => e).join("\n").substring(0, 1024),
      inline: false
    });
  }
  return embed;
}
async function buildTipsReceivedLeaderboard(limit) {
  const topReceivers = await prisma.userStats.findMany({
    where: { totalTipsReceived: { gt: 0 } },
    orderBy: { totalTipsReceived: "desc" },
    take: limit,
    include: {
      user: {
        select: { discordId: true }
      }
    }
  });
  const embed = new EmbedBuilder().setTitle("\u{1F49D} Most Popular Recipients").setColor(15277667).setDescription("Top players by tips received").setTimestamp();
  if (topReceivers.length === 0) {
    embed.addFields({
      name: "No Tips Yet",
      value: "Start tipping to see the leaderboard!",
      inline: false
    });
  } else {
    const entries = topReceivers.map((stats, index) => {
      const rank = index + 1;
      const medal = getMedal(rank);
      return `${medal} **#${rank}** <@${stats.user.discordId}>
\u{1F49D} **${stats.totalTipsReceived}** tips received
`;
    });
    embed.addFields({
      name: "Most Popular",
      value: entries.filter((e) => e).join("\n").substring(0, 1024),
      inline: false
    });
  }
  return embed;
}
async function buildReferralLeaderboard(limit) {
  const topReferrers = await prisma.referral.groupBy({
    by: ["referrerId"],
    where: {
      verifiedAt: { not: null }
    },
    _count: { id: true },
    orderBy: {
      _count: { id: "desc" }
    },
    take: limit
  });
  const embed = new EmbedBuilder().setTitle("\u{1F465} Referral Champions").setColor(3447003).setDescription("Top players by verified referrals").setTimestamp();
  if (topReferrers.length === 0) {
    embed.addFields({
      name: "No Referrals Yet",
      value: "Invite friends to join PIPtip!",
      inline: false
    });
  } else {
    const entries = await Promise.all(
      topReferrers.map(async (referrer, index) => {
        const user = await prisma.user.findUnique({
          where: { id: referrer.referrerId },
          select: { discordId: true }
        });
        if (!user) return "";
        const rank = index + 1;
        const medal = getMedal(rank);
        return `${medal} **#${rank}** <@${user.discordId}>
\u{1F465} **${referrer._count?.id || 0}** verified referrals
`;
      })
    );
    embed.addFields({
      name: "Top Referrers",
      value: entries.filter((e) => e).join("\n").substring(0, 1024),
      inline: false
    });
  }
  return embed;
}
async function buildWealthLeaderboard(limit) {
  const usersWithBalances = await prisma.userBalance.findMany({
    where: {
      amount: { gt: 0 }
    },
    include: {
      User: true,
      Token: true
    }
  });
  const userWealth = /* @__PURE__ */ new Map();
  const tokenSymbols = [...new Set(usersWithBalances.map((b) => b.Token.symbol))];
  const prices = await getCachedTokenPrices(tokenSymbols);
  for (const balance of usersWithBalances) {
    const userId = balance.User.discordId;
    const current = userWealth.get(userId) || {
      discordId: userId,
      totalUSDValue: 0,
      breakdown: []
    };
    const tokenAmount = Number(balance.amount);
    const tokenPrice = prices[balance.Token.symbol] || 0;
    const usdValue = tokenAmount * tokenPrice;
    current.totalUSDValue += usdValue;
    const formattedAmount = await formatDecimalWithUSD(balance.amount, balance.Token.symbol, { compact: true });
    current.breakdown.push(formattedAmount);
    userWealth.set(userId, current);
  }
  const sorted = Array.from(userWealth.values()).sort((a, b) => b.totalUSDValue - a.totalUSDValue).slice(0, limit);
  const embed = new EmbedBuilder().setTitle("\u{1F4B0} Wealth Leaderboard").setColor(15844367).setDescription(`Top players by total USD value \u2022 Powered by ${priceResult.source}`).setTimestamp();
  if (sorted.length === 0) {
    embed.addFields({
      name: "No Balances Yet",
      value: "Deposit tokens to get on the leaderboard!",
      inline: false
    });
  } else {
    const entries = sorted.map((user, index) => {
      const rank = index + 1;
      const medal = getMedal(rank);
      const totalUSDFormatted = user.totalUSDValue < 1 ? `$${user.totalUSDValue.toFixed(4).replace(/\.?0+$/, "")}` : `$${user.totalUSDValue.toFixed(2).replace(/\.?0+$/, "")}`;
      return `${medal} **#${rank}** <@${user.discordId}> \u2022 **${totalUSDFormatted}**
\u{1F4B0} ${user.breakdown.join(" + ")}
`;
    });
    embed.addFields({
      name: "Wealthiest Players",
      value: entries.join("\n").substring(0, 1024),
      inline: false
    });
  }
  return embed;
}
function getMedal(rank) {
  switch (rank) {
    case 1:
      return "\u{1F947}";
    case 2:
      return "\u{1F948}";
    case 3:
      return "\u{1F949}";
    default:
      return `**${rank}.**`;
  }
}
export {
  pipLeaderboard as default
};
//# sourceMappingURL=pip_leaderboard.js.map
