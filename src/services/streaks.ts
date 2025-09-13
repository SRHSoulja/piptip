// src/services/streaks.ts - Win streak system with achievements
import { prisma } from "./db.js";
import { findOrCreateUser } from "./user_helpers.js";

// Update user streak after a match
export async function updateStreak(discordId: string, won: boolean): Promise<{ newStreak: number; achievement?: string }> {
  try {
    const user = await findOrCreateUser(discordId);

    // Get or create user streak record
    let userStreak = await prisma.userStreak.findUnique({
      where: { userId: user.id }
    });

    if (!userStreak) {
      userStreak = await prisma.userStreak.create({
        data: {
          userId: user.id,
          currentWins: 0,
          longestWins: 0,
          lastGameAt: new Date()
        }
      });
    }

    const now = new Date();
    const timeSinceLastGame = userStreak.lastGameAt ? now.getTime() - userStreak.lastGameAt.getTime() : 0;
    const hoursAgo = timeSinceLastGame / (1000 * 60 * 60);

    let newCurrentWins = userStreak.currentWins;
    let newLongestWins = userStreak.longestWins;

    if (won) {
      // Reset streak if it's been more than 24 hours since last win
      if (hoursAgo > 24) {
        newCurrentWins = 1;
      } else {
        newCurrentWins = userStreak.currentWins + 1;
      }

      // Update longest streak if current exceeds it
      if (newCurrentWins > newLongestWins) {
        newLongestWins = newCurrentWins;
      }
    } else {
      // Loss resets current streak
      newCurrentWins = 0;
    }

    // Update streak record
    await prisma.userStreak.update({
      where: { userId: user.id },
      data: {
        currentWins: newCurrentWins,
        longestWins: newLongestWins,
        lastGameAt: now
      }
    });

    // Check for achievements
    let achievementUnlocked: string | undefined;

    if (won && newCurrentWins > userStreak.currentWins) {
      // Check for streak milestones
      const streakMilestones = [3, 5, 10, 15, 25, 50, 100];
      for (const milestone of streakMilestones) {
        if (newCurrentWins === milestone) {
          await createAchievement(user.id, "win_streak", milestone, {
            streak: milestone,
            date: now.toISOString()
          });
          achievementUnlocked = `🔥 ${milestone} Win Streak!`;
          break;
        }
      }

      // Check for longest streak achievements
      if (newCurrentWins === newLongestWins && newLongestWins > userStreak.longestWins) {
        const longestMilestones = [10, 25, 50, 100];
        for (const milestone of longestMilestones) {
          if (newLongestWins === milestone) {
            await createAchievement(user.id, "longest_streak", milestone, {
              longestStreak: milestone,
              date: now.toISOString()
            });
            achievementUnlocked = `🏆 Personal Best: ${milestone} Wins!`;
            break;
          }
        }
      }
    }

    return {
      newStreak: newCurrentWins,
      achievement: achievementUnlocked
    };

  } catch (error) {
    console.error("Error updating streak:", error);
    return { newStreak: 0 };
  }
}

// Get user's streak stats
export async function getStreakStats(discordId: string) {
  try {
    const user = await findOrCreateUser(discordId);

    const userStreak = await prisma.userStreak.findUnique({
      where: { userId: user.id }
    });

    return {
      currentWins: userStreak?.currentWins || 0,
      longestWins: userStreak?.longestWins || 0,
      lastGameAt: userStreak?.lastGameAt || null
    };
  } catch (error) {
    console.error("Error getting streak stats:", error);
    return {
      currentWins: 0,
      longestWins: 0,
      lastGameAt: null
    };
  }
}

// Get user's achievements
export async function getUserAchievements(discordId: string) {
  try {
    const user = await findOrCreateUser(discordId);

    const achievements = await prisma.achievement.findMany({
      where: { userId: user.id },
      orderBy: { unlockedAt: 'desc' }
    });

    return achievements.map(achievement => ({
      type: achievement.type,
      level: achievement.level,
      unlockedAt: achievement.unlockedAt,
      data: achievement.data ? JSON.parse(achievement.data as string) : null
    }));
  } catch (error) {
    console.error("Error getting achievements:", error);
    return [];
  }
}

// Get leaderboard for streaks
export async function getStreakLeaderboard(limit: number = 10) {
  try {
    const topStreaks = await prisma.userStreak.findMany({
      where: {
        currentWins: { gt: 0 }
      },
      orderBy: [
        { currentWins: 'desc' },
        { lastGameAt: 'desc' }
      ],
      take: limit,
      include: {
        user: {
          select: { discordId: true }
        }
      }
    });

    return topStreaks.map((streak, index) => ({
      rank: index + 1,
      discordId: streak.user.discordId,
      currentWins: streak.currentWins,
      longestWins: streak.longestWins,
      lastGameAt: streak.lastGameAt
    }));
  } catch (error) {
    console.error("Error getting streak leaderboard:", error);
    return [];
  }
}

// Format streak for display
export function formatStreakText(currentWins: number, longestWins: number): string {
  if (currentWins === 0) {
    return longestWins > 0 ? `Best streak: ${longestWins} wins` : "No win streak yet";
  }

  const emoji = getStreakEmoji(currentWins);
  let text = `${emoji} ${currentWins} win streak`;

  if (currentWins === longestWins && longestWins > 1) {
    text += " (Personal Best!)";
  } else if (longestWins > currentWins) {
    text += ` • Best: ${longestWins}`;
  }

  return text;
}

// Get emoji for streak level
function getStreakEmoji(wins: number): string {
  if (wins >= 100) return "💎";
  if (wins >= 50) return "🏆";
  if (wins >= 25) return "👑";
  if (wins >= 15) return "⚡";
  if (wins >= 10) return "🔥";
  if (wins >= 5) return "🌟";
  if (wins >= 3) return "✨";
  return "🎯";
}

// Create achievement (reusable utility)
async function createAchievement(userId: number, type: string, level: number, data?: any): Promise<void> {
  try {
    await prisma.achievement.create({
      data: {
        userId,
        type,
        level,
        data: data || undefined
      }
    });
  } catch (error) {
    // Achievement might already exist (unique constraint)
    console.log(`Achievement ${type} level ${level} already exists for user ${userId}`);
  }
}

// Get achievement badge text
export function formatAchievementBadge(achievement: any): string {
  switch (achievement.type) {
    case 'win_streak':
      return `🔥 ${achievement.level} Win Streak`;
    case 'longest_streak':
      return `🏆 ${achievement.level} Best Streak`;
    case 'referral_count':
      return `👥 ${achievement.level * 5} Referrals`;
    case 'total_tips':
      return `💰 ${achievement.level}k Tips Sent`;
    default:
      return `🎖️ ${achievement.type} ${achievement.level}`;
  }
}