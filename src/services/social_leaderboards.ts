// src/services/social_leaderboards.ts - Social scoring and comprehensive leaderboard system

import { prisma } from "./db.js";
import { EmbedBuilder } from "discord.js";
import { formatAchievementBadge } from "./achievement_display.js";
import { getUserLevel } from "./penguin_levels.js";

// Social score calculation weights
export const SOCIAL_WEIGHTS = {
  TIPS_SENT: 3,        // Generous sharing
  TIPS_RECEIVED: 1,    // Community appreciation
  GROUP_TIPS_CREATED: 10, // Colony leadership
  GROUP_TIP_CONTRIBUTIONS: 5, // Community support
  GROUP_TIP_CLAIMS: 3, // Participation
  ACHIEVEMENTS: 5,      // Personal growth
  STREAK_CURRENT: 2,   // Current performance
  STREAK_LONGEST: 1,   // Historical performance
  LEVEL: 8,           // Overall progression
  MEMBERSHIP_ACTIVE: 15, // Premium contribution
  REFERRALS: 20,      // Community growth
  DAYS_ACTIVE: 1      // Consistency
};

// Calculate user's social score
export async function calculateSocialScore(discordId: string): Promise<{
  totalScore: number;
  breakdown: Record<string, number>;
  rank?: number;
}> {
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
            status: 'ACTIVE',
            expiresAt: { gt: new Date() }
          }
        }
      }
    });

    if (!user) {
      return { totalScore: 0, breakdown: {} };
    }

    // Get level information
    const levelInfo = await getUserLevel(discordId);

    // Calculate activity days (simplified - could be enhanced with actual login tracking)
    const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const estimatedActiveDays = Math.min(accountAge, Math.floor(accountAge * 0.3)); // Estimate 30% activity

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

// Get top penguins by social score
export async function getSocialLeaderboard(limit: number = 10): Promise<Array<{
  discordId: string;
  username?: string;
  totalScore: number;
  level: any;
  rank: number;
  achievements: number;
  streak: number;
  tips: number;
}>> {
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
            status: 'ACTIVE',
            expiresAt: { gt: new Date() }
          },
          select: { id: true }
        },
        createdAt: true
      },
      take: 500 // Limit for performance
    });

    // Calculate scores for all users
    const userScores = await Promise.all(
      users.map(async (user) => {
        const scoreData = await calculateSocialScore(user.discordId);
        const levelInfo = await getUserLevel(user.discordId);

        return {
          discordId: user.discordId,
          totalScore: scoreData.totalScore,
          level: levelInfo.currentLevel,
          achievements: user.unlockedAchievements.length,
          streak: user.streak?.currentWins || 0,
          tips: user.tipsSent.length + user.tipsReceived.length
        };
      })
    );

    // Sort by total score and add ranks
    const sorted = userScores
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, limit)
      .map((user, index) => ({ ...user, rank: index + 1 }));

    return sorted;

  } catch (error) {
    console.error("Error getting social leaderboard:", error);
    return [];
  }
}

// Get penguin level leaderboard
export async function getLevelLeaderboard(limit: number = 10): Promise<Array<{
  discordId: string;
  level: any;
  totalXP: number;
  rank: number;
}>> {
  try {
    const users = await prisma.user.findMany({
      where: {
        totalXP: { gt: 0 }
      },
      orderBy: [
        { totalXP: 'desc' },
        { createdAt: 'asc' } // Tie-breaker: older accounts rank higher
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

// Get achievement leaderboard
export async function getAchievementLeaderboard(limit: number = 10): Promise<Array<{
  discordId: string;
  achievementCount: number;
  recentAchievement?: any;
  rank: number;
}>> {
  try {
    const users = await prisma.user.findMany({
      include: {
        unlockedAchievements: {
          include: {
            definition: true
          },
          orderBy: { unlockedAt: 'desc' },
          take: 1
        }
      },
      orderBy: {
        unlockedAchievements: {
          _count: 'desc'
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

// Get generosity leaderboard (tips sent)
export async function getGenerosityLeaderboard(limit: number = 10): Promise<Array<{
  discordId: string;
  tipsSent: number;
  tipsReceived: number;
  uniqueRecipients: number;
  rank: number;
}>> {
  try {
    const users = await prisma.user.findMany({
      include: {
        tipsSent: {
          where: { status: 'COMPLETED' },
          select: {
            toUserId: true,
            amountAtomic: true
          }
        },
        tipsReceived: {
          where: { status: 'COMPLETED' },
          select: { id: true }
        }
      },
      orderBy: {
        tipsSent: {
          _count: 'desc'
        }
      },
      take: limit
    });

    return users.map((user, index) => {
      const uniqueRecipients = new Set(user.tipsSent.map(tip => tip.toUserId)).size;

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

// Get streak leaderboard
export async function getStreakLeaderboard(limit: number = 10): Promise<Array<{
  discordId: string;
  currentWins: number;
  longestWins: number;
  rank: number;
}>> {
  try {
    const streaks = await prisma.userStreak.findMany({
      where: {
        currentWins: { gt: 0 }
      },
      orderBy: [
        { currentWins: 'desc' },
        { longestWins: 'desc' },
        { lastGameAt: 'desc' }
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

// Create leaderboard embed
export function createLeaderboardEmbed(
  type: 'social' | 'level' | 'achievements' | 'generosity' | 'streaks',
  data: any[],
  userRank?: number
): EmbedBuilder {
  const configs = {
    social: {
      title: "🏆 Social Colony Leaderboard",
      description: "Top penguins by overall colony contribution",
      emoji: "🌟",
      color: 0xFFD700
    },
    level: {
      title: "🎖️ Penguin Level Leaderboard",
      description: "Highest ranking penguins in the colony",
      emoji: "🐧",
      color: 0x67e8f9
    },
    achievements: {
      title: "🏅 Achievement Hunters",
      description: "Penguins with the most achievements",
      emoji: "🏆",
      color: 0xf59e0b
    },
    generosity: {
      title: "💝 Most Generous Penguins",
      description: "Top fish sharers in the colony",
      emoji: "🐟",
      color: 0x38d9a9
    },
    streaks: {
      title: "🔥 Win Streak Champions",
      description: "Penguins on fire with consecutive wins",
      emoji: "⚡",
      color: 0xff6b6b
    }
  };

  const config = configs[type];
  const embed = new EmbedBuilder()
    .setTitle(config.title)
    .setDescription(config.description)
    .setColor(config.color)
    .setTimestamp();

  if (data.length === 0) {
    embed.addFields({
      name: "🐧 Empty Leaderboard",
      value: "No data available yet. Be the first to make the leaderboard!",
      inline: false
    });
    return embed;
  }

  // Format leaderboard entries
  const entries = data.map((entry, index) => {
    const rankEmoji = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "🐧";

    let details = "";
    switch (type) {
      case 'social':
        details = `**Score:** ${entry.totalScore.toLocaleString()} | **Level:** ${entry.level.level} ${entry.level.title}`;
        break;
      case 'level':
        details = `**${entry.level.title}** (Level ${entry.level.level}) | **XP:** ${entry.totalXP.toLocaleString()}`;
        break;
      case 'achievements':
        details = `**${entry.achievementCount}** achievements earned`;
        break;
      case 'generosity':
        details = `**${entry.tipsSent}** tips sent to **${entry.uniqueRecipients}** penguins`;
        break;
      case 'streaks':
        details = `**${entry.currentWins}** current wins | **${entry.longestWins}** best streak`;
        break;
    }

    return `${rankEmoji} **#${entry.rank}** <@${entry.discordId}>\n${details}`;
  });

  // Split into chunks if too long
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

  // Add user's rank if provided
  if (userRank !== undefined) {
    embed.addFields({
      name: "📍 Your Position",
      value: userRank <= data.length ? `You're ranked #${userRank}!` : `You're not in the top ${data.length} yet. Keep waddling!`,
      inline: false
    });
  }

  return embed;
}

// Get user's rank in specific leaderboard
export async function getUserRank(discordId: string, type: 'social' | 'level' | 'achievements' | 'generosity' | 'streaks'): Promise<number> {
  try {
    let leaderboard: any[] = [];

    switch (type) {
      case 'social':
        leaderboard = await getSocialLeaderboard(100);
        break;
      case 'level':
        leaderboard = await getLevelLeaderboard(100);
        break;
      case 'achievements':
        leaderboard = await getAchievementLeaderboard(100);
        break;
      case 'generosity':
        leaderboard = await getGenerosityLeaderboard(100);
        break;
      case 'streaks':
        leaderboard = await getStreakLeaderboard(100);
        break;
    }

    const userEntry = leaderboard.find(entry => entry.discordId === discordId);
    return userEntry?.rank || 0;

  } catch (error) {
    console.error("Error getting user rank:", error);
    return 0;
  }
}