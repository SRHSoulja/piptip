import { prisma } from "./db.js";
import { EmbedBuilder } from "discord.js";
import { getUserLevel } from "./penguin_levels.js";
const SOCIAL_WEIGHTS = {
  TIPS_SENT: 3,
  // Generous sharing
  TIPS_RECEIVED: 1,
  // Community appreciation
  GROUP_TIPS_CREATED: 10,
  // Colony leadership
  GROUP_TIP_CONTRIBUTIONS: 5,
  // Community support
  GROUP_TIP_CLAIMS: 3,
  // Participation
  ACHIEVEMENTS: 5,
  // Personal growth
  STREAK_CURRENT: 2,
  // Current performance
  STREAK_LONGEST: 1,
  // Historical performance
  LEVEL: 8,
  // Overall progression
  MEMBERSHIP_ACTIVE: 15,
  // Premium contribution
  REFERRALS: 20,
  // Community growth
  DAYS_ACTIVE: 1
  // Consistency
};
async function calculateSocialScore(discordId) {
  try {
    const user = await prisma.user.findUnique({
      where: { discordId },
      include: {
        tipsSent: { select: { id: true } },
        tipsReceived: { select: { id: true } },
        groupTipsCreated: { select: { id: true } },
        groupTipContributions: { select: { id: true } },
        groupTipsClaimed: { select: { id: true } },
        unlockedAchievements: { select: { id: true } },
        streak: true,
        tierMemberships: {
          where: {
            status: "ACTIVE",
            expiresAt: { gt: /* @__PURE__ */ new Date() }
          }
        }
      }
    });
    if (!user) {
      return { totalScore: 0, breakdown: {} };
    }
    const levelInfo = await getUserLevel(discordId);
    const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1e3 * 60 * 60 * 24));
    const estimatedActiveDays = Math.min(accountAge, Math.floor(accountAge * 0.3));
    const breakdown = {
      tipsSent: user.tipsSent.length * SOCIAL_WEIGHTS.TIPS_SENT,
      tipsReceived: user.tipsReceived.length * SOCIAL_WEIGHTS.TIPS_RECEIVED,
      groupTipsCreated: user.groupTipsCreated.length * SOCIAL_WEIGHTS.GROUP_TIPS_CREATED,
      groupTipContributions: user.groupTipContributions.length * SOCIAL_WEIGHTS.GROUP_TIP_CONTRIBUTIONS,
      groupTipClaims: user.groupTipsClaimed.length * SOCIAL_WEIGHTS.GROUP_TIP_CLAIMS,
      achievements: user.unlockedAchievements.length * SOCIAL_WEIGHTS.ACHIEVEMENTS,
      currentStreak: (user.streak?.currentWins || 0) * SOCIAL_WEIGHTS.STREAK_CURRENT,
      longestStreak: (user.streak?.longestWins || 0) * SOCIAL_WEIGHTS.STREAK_LONGEST,
      level: levelInfo.currentLevel.level * SOCIAL_WEIGHTS.LEVEL,
      membership: user.tierMemberships.length > 0 ? SOCIAL_WEIGHTS.MEMBERSHIP_ACTIVE : 0,
      activeDays: estimatedActiveDays * SOCIAL_WEIGHTS.DAYS_ACTIVE
    };
    const totalScore = Object.values(breakdown).reduce((sum, score) => sum + score, 0);
    return { totalScore, breakdown };
  } catch (error) {
    console.error("Error calculating social score:", error);
    return { totalScore: 0, breakdown: {} };
  }
}
async function getSocialLeaderboard(limit = 10) {
  try {
    const users = await prisma.user.findMany({
      select: {
        discordId: true,
        tipsSent: { select: { id: true } },
        tipsReceived: { select: { id: true } },
        groupTipsCreated: { select: { id: true } },
        groupTipContributions: { select: { id: true } },
        groupTipsClaimed: { select: { id: true } },
        unlockedAchievements: { select: { id: true } },
        streak: true,
        tierMemberships: {
          where: {
            status: "ACTIVE",
            expiresAt: { gt: /* @__PURE__ */ new Date() }
          },
          select: { id: true }
        },
        createdAt: true
      },
      take: 500
      // Limit for performance
    });
    let dbFailed = false;
    let failedCount = 0;
    const userScores = await Promise.all(
      users.map(async (user) => {
        if (dbFailed) {
          return null;
        }
        try {
          const scoreData = await Promise.race([
            calculateSocialScore(user.discordId),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Score calculation timeout")), 5e3))
          ]);
          const levelInfo = await Promise.race([
            getUserLevel(user.discordId),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Level fetch timeout")), 5e3))
          ]);
          return {
            discordId: user.discordId,
            totalScore: scoreData.totalScore,
            level: levelInfo.currentLevel,
            achievements: user.unlockedAchievements.length,
            streak: user.streak?.currentWins || 0,
            tips: user.tipsSent.length + user.tipsReceived.length
          };
        } catch (error) {
          if (error?.message?.includes("database") || error?.message?.includes("connection")) {
            dbFailed = true;
          }
          failedCount++;
          return null;
        }
      })
    );
    if (failedCount > 0) {
      console.error(`Social leaderboard: ${failedCount} user score calculations failed${dbFailed ? " (database connection lost)" : ""}`);
    }
    const validScores = userScores.filter((score) => score !== null);
    if (validScores.length === 0) {
      return [];
    }
    const sorted = validScores.sort((a, b) => b.totalScore - a.totalScore).slice(0, limit).map((user, index) => ({ ...user, rank: index + 1 }));
    return sorted;
  } catch (error) {
    console.error("Error getting social leaderboard:", error);
    return [];
  }
}
async function getLevelLeaderboard(limit = 10) {
  try {
    const users = await prisma.user.findMany({
      where: {
        totalXP: { gt: 0 }
      },
      orderBy: [
        { totalXP: "desc" },
        { createdAt: "asc" }
        // Tie-breaker: older accounts rank higher
      ],
      take: limit,
      select: {
        discordId: true,
        totalXP: true
      }
    });
    const leaderboard = await Promise.all(
      users.map(async (user, index) => {
        const levelInfo = await getUserLevel(user.discordId);
        return {
          discordId: user.discordId,
          level: levelInfo.currentLevel,
          totalXP: user.totalXP || 0,
          rank: index + 1
        };
      })
    );
    return leaderboard;
  } catch (error) {
    console.error("Error getting level leaderboard:", error);
    return [];
  }
}
async function getAchievementLeaderboard(limit = 10) {
  try {
    const users = await prisma.user.findMany({
      include: {
        unlockedAchievements: {
          include: {
            definition: true
          },
          orderBy: { unlockedAt: "desc" },
          take: 1
        }
      },
      orderBy: {
        unlockedAchievements: {
          _count: "desc"
        }
      },
      take: limit
    });
    return users.map((user, index) => ({
      discordId: user.discordId,
      achievementCount: user.unlockedAchievements.length,
      recentAchievement: user.unlockedAchievements[0] || null,
      rank: index + 1
    }));
  } catch (error) {
    console.error("Error getting achievement leaderboard:", error);
    return [];
  }
}
async function getGenerosityLeaderboard(limit = 10) {
  try {
    const users = await prisma.user.findMany({
      include: {
        tipsSent: {
          where: { status: "COMPLETED" },
          select: {
            toUserId: true,
            amountAtomic: true
          }
        },
        tipsReceived: {
          where: { status: "COMPLETED" },
          select: { id: true }
        }
      },
      orderBy: {
        tipsSent: {
          _count: "desc"
        }
      },
      take: limit
    });
    return users.map((user, index) => {
      const uniqueRecipients = new Set(user.tipsSent.map((tip) => tip.toUserId)).size;
      return {
        discordId: user.discordId,
        tipsSent: user.tipsSent.length,
        tipsReceived: user.tipsReceived.length,
        uniqueRecipients,
        rank: index + 1
      };
    });
  } catch (error) {
    console.error("Error getting generosity leaderboard:", error);
    return [];
  }
}
async function getStreakLeaderboard(limit = 10) {
  try {
    const streaks = await prisma.userStreak.findMany({
      where: {
        currentWins: { gt: 0 }
      },
      orderBy: [
        { currentWins: "desc" },
        { longestWins: "desc" },
        { lastGameAt: "desc" }
      ],
      take: limit,
      include: {
        user: {
          select: { discordId: true }
        }
      }
    });
    return streaks.map((streak, index) => ({
      discordId: streak.user.discordId,
      currentWins: streak.currentWins,
      longestWins: streak.longestWins,
      rank: index + 1
    }));
  } catch (error) {
    console.error("Error getting streak leaderboard:", error);
    return [];
  }
}
function createLeaderboardEmbed(type, data, userRank) {
  const configs = {
    social: {
      title: "\u{1F3C6} Social Colony Leaderboard",
      description: "Top penguins by overall colony contribution",
      emoji: "\u{1F31F}",
      color: 16766720
    },
    level: {
      title: "\u{1F396}\uFE0F Penguin Level Leaderboard",
      description: "Highest ranking penguins in the colony",
      emoji: "\u{1F427}",
      color: 6809849
    },
    achievements: {
      title: "\u{1F3C5} Achievement Hunters",
      description: "Penguins with the most achievements",
      emoji: "\u{1F3C6}",
      color: 16096779
    },
    generosity: {
      title: "\u{1F49D} Most Generous Penguins",
      description: "Top fish sharers in the colony",
      emoji: "\u{1F41F}",
      color: 3725737
    },
    streaks: {
      title: "\u{1F525} Win Streak Champions",
      description: "Penguins on fire with consecutive wins",
      emoji: "\u26A1",
      color: 16739179
    }
  };
  const config = configs[type];
  const embed = new EmbedBuilder().setTitle(config.title).setDescription(config.description).setColor(config.color).setTimestamp();
  if (data.length === 0) {
    embed.addFields({
      name: "\u{1F427} Empty Leaderboard",
      value: "No data available yet. Be the first to make the leaderboard!",
      inline: false
    });
    return embed;
  }
  const entries = data.map((entry, index) => {
    const rankEmoji = index === 0 ? "\u{1F947}" : index === 1 ? "\u{1F948}" : index === 2 ? "\u{1F949}" : "\u{1F427}";
    let details = "";
    switch (type) {
      case "social":
        details = `**Score:** ${entry.totalScore.toLocaleString()} | **Level:** ${entry.level.level} ${entry.level.title}`;
        break;
      case "level":
        details = `**${entry.level.title}** (Level ${entry.level.level}) | **XP:** ${entry.totalXP.toLocaleString()}`;
        break;
      case "achievements":
        details = `**${entry.achievementCount}** achievements earned`;
        break;
      case "generosity":
        details = `**${entry.tipsSent}** tips sent to **${entry.uniqueRecipients}** penguins`;
        break;
      case "streaks":
        details = `**${entry.currentWins}** current wins | **${entry.longestWins}** best streak`;
        break;
    }
    return `${rankEmoji} **#${entry.rank}** <@${entry.discordId}>
${details}`;
  });
  const maxLength = 1024;
  let currentChunk = "";
  let chunkIndex = 1;
  for (const entry of entries) {
    if ((currentChunk + entry + "\n\n").length > maxLength) {
      embed.addFields({
        name: chunkIndex === 1 ? `${config.emoji} Rankings` : `${config.emoji} Rankings (continued)`,
        value: currentChunk,
        inline: false
      });
      currentChunk = entry + "\n\n";
      chunkIndex++;
    } else {
      currentChunk += entry + "\n\n";
    }
  }
  if (currentChunk) {
    embed.addFields({
      name: chunkIndex === 1 ? `${config.emoji} Rankings` : `${config.emoji} Rankings (continued)`,
      value: currentChunk,
      inline: false
    });
  }
  if (userRank !== void 0) {
    embed.addFields({
      name: "\u{1F4CD} Your Position",
      value: userRank <= data.length ? `You're ranked #${userRank}!` : `You're not in the top ${data.length} yet. Keep waddling!`,
      inline: false
    });
  }
  return embed;
}
async function getUserRank(discordId, type) {
  try {
    let leaderboard = [];
    switch (type) {
      case "social":
        leaderboard = await getSocialLeaderboard(100);
        break;
      case "level":
        leaderboard = await getLevelLeaderboard(100);
        break;
      case "achievements":
        leaderboard = await getAchievementLeaderboard(100);
        break;
      case "generosity":
        leaderboard = await getGenerosityLeaderboard(100);
        break;
      case "streaks":
        leaderboard = await getStreakLeaderboard(100);
        break;
    }
    const userEntry = leaderboard.find((entry) => entry.discordId === discordId);
    return userEntry?.rank || 0;
  } catch (error) {
    console.error("Error getting user rank:", error);
    return 0;
  }
}
export {
  SOCIAL_WEIGHTS,
  calculateSocialScore,
  createLeaderboardEmbed,
  getAchievementLeaderboard,
  getGenerosityLeaderboard,
  getLevelLeaderboard,
  getSocialLeaderboard,
  getStreakLeaderboard,
  getUserRank
};
//# sourceMappingURL=social_leaderboards.js.map
