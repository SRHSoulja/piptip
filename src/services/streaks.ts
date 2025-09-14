// src/services/streaks.ts - Win streak system with achievements
import { prisma } from "./db.js";
import { findOrCreateUser } from "./user_helpers.js";
// Cache functions will be replaced with simple cache service
import { cacheWithMetrics, CacheKeys, CacheTTL } from "./cache.js";
import { areAchievementsEnabled, isStreakProtectionEnabled } from "./emergency_controls.js";

// Update user streak after a match with tier-based protection
export async function updateStreak(discordId: string, won: boolean): Promise<{ newStreak: number; achievement?: string; protectionUsed?: string }> {
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
    let protectionUsed: string | undefined;

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
      // Check for streak protection before resetting (if globally enabled)
      let protection: StreakProtection = { hasProtection: false };

      if (await isStreakProtectionEnabled()) {
        protection = await checkStreakProtection(user.id, userStreak.currentWins);
      } else {
        console.log(`⚠️ Streak protection disabled globally - no protection for ${discordId}`);
      }

      if (protection.hasProtection) {
        // Keep current streak
        newCurrentWins = userStreak.currentWins;
        protectionUsed = protection.reason;

        // Use shield if applicable
        if (protection.type === 'shield') {
          await useStreakShield(user.id);
        }
      } else {
        // Loss resets current streak
        newCurrentWins = 0;
      }
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

    // Invalidate user cache after streak update
    // Cache will auto-expire

    // Invalidate leaderboard cache if streak changed significantly
    if (Math.abs(newCurrentWins - userStreak.currentWins) >= 1) {
      // Cache will auto-expire
    }

    // Check for achievements (if globally enabled)
    let achievementUnlocked: string | undefined;

    if (await areAchievementsEnabled()) {

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
    } else {
      console.log(`⚠️ Achievements disabled globally - no achievements processed for ${discordId}`);
    }

    return {
      newStreak: newCurrentWins,
      achievement: achievementUnlocked,
      protectionUsed
    };

  } catch (error) {
    console.error("Error updating streak:", error);
    return { newStreak: 0 };
  }
}

// Get user's streak stats (cached)
export async function getStreakStats(discordId: string) {
  try {
    return await cacheWithMetrics(
      CacheKeys.userStreak(discordId),
      async () => {
        const user = await prisma.user.findUnique({
          where: { discordId },
          include: {
            streak: true
          }
        });

        if (!user) {
          return {
            currentWins: 0,
            longestWins: 0,
            lastGameAt: null
          };
        }

        return {
          currentWins: user.streak?.currentWins || 0,
          longestWins: user.streak?.longestWins || 0,
          lastGameAt: user.streak?.lastGameAt
        };
      },
      CacheTTL.streak
    );
  } catch (error) {
    console.error("Error getting streak stats:", error);
    return {
      currentWins: 0,
      longestWins: 0,
      lastGameAt: null
    };
  }
}

// Get user's achievements (cached)
export async function getUserAchievements(discordId: string) {
  try {
    return await cacheWithMetrics(
      CacheKeys.userAchievements(discordId),
      async () => {
        return await prisma.achievement.findMany({
          where: { user: { discordId } },
          orderBy: { unlockedAt: 'desc' }
        });
      },
      CacheTTL.achievements
    );
  } catch (error) {
    console.error("Error getting achievements:", error);
    return [];
  }
}

// Get leaderboard for streaks (cached)
export async function getStreakLeaderboard(limit: number = 10) {
  try {
    const cachedResult = await cacheWithMetrics(
      CacheKeys.leaderboard('streaks'),
      async () => {
        const streakLeaderboard = await prisma.userStreak.findMany({
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
              select: {
                discordId: true
              }
            }
          }
        });

        return streakLeaderboard.map((entry: any) => ({
          discordId: entry.user.discordId,
          currentWins: entry.currentWins,
          longestWins: entry.longestWins,
          lastGameAt: entry.lastGameAt,
          rank: 0 // Will be set below
        }));
      },
      CacheTTL.leaderboard
    );
    return cachedResult.map((entry: any) => ({
      ...entry,
      lastGameAt: entry.lastGameAt ? new Date(entry.lastGameAt) : null
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

// Create achievement (reusable utility) - MOVED TO BOTTOM

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
    case 'big_tipper':
      return `💎 ${achievement.level * 100}+ Tip Sent`;
    case 'deposit_milestone':
      const milestones = [100, 250, 500, 1000, 2500, 5000];
      return `🏦 ${milestones[achievement.level - 1] || achievement.level * 500} Deposited`;
    case 'responsible_gamer':
      return `🛡️ Responsible Gaming`;
    case 'mindful_spender':
      return `💚 Mindful Spender x${achievement.level}`;
    case 'veteran_player':
      const labels = ['7 days', '1 month', '3 months', '6 months', '1 year'];
      return `🎖️ ${labels[achievement.level - 1] || 'Veteran'} Veteran`;
    case 'comeback_kid':
      return `💪 Comeback Kid`;
    case 'social_butterfly':
      return `🦋 ${achievement.level * 10} People Tipped`;
    case 'lucky_winner':
      return `🍀 Lucky Streak (${achievement.level} Wins)`;
    default:
      return `🎖️ ${achievement.type} ${achievement.level}`;
  }
}

// OPTIMIZED: Check and award tip-based achievements with batched queries
export async function checkTipAchievements(fromUserId: number, tipCount: number, tipAmount: number): Promise<string[]> {
  const achievements: string[] = [];

  try {
    // Get all existing achievements for this user in one query
    const existingAchievements = await prisma.achievement.findMany({
      where: {
        userId: fromUserId,
        type: { in: ["total_tips", "big_tipper", "social_butterfly"] }
      },
      select: { type: true, level: true }
    });

    const existingMap = new Map(
      existingAchievements.map((a: any) => [`${a.type}_${a.level}`, true])
    );

    // Batch achievement creation operations
    const achievementsToCreate: Array<{
      userId: number;
      type: string;
      level: number;
      data?: any;
      displayText: string;
    }> = [];

    // Total tips milestone (every 1000 tips) - only check new levels
    const totalTipLevel = Math.floor(tipCount / 1000);
    if (totalTipLevel > 0 && !existingMap.has(`total_tips_${totalTipLevel}`)) {
      achievementsToCreate.push({
        userId: fromUserId,
        type: "total_tips",
        level: totalTipLevel,
        displayText: `💰 ${totalTipLevel}k Tips Sent!`
      });
    }

    // Big tipper milestone - only check if this tip qualifies
    const bigTipMilestones = [100, 500, 1000, 5000, 10000];
    for (let i = 0; i < bigTipMilestones.length; i++) {
      const milestone = bigTipMilestones[i];
      if (tipAmount >= milestone && !existingMap.has(`big_tipper_${i + 1}`)) {
        achievementsToCreate.push({
          userId: fromUserId,
          type: "big_tipper",
          level: i + 1,
          displayText: `💎 ${milestone}+ Big Tip!`
        });
      }
    }

    // Social butterfly - only calculate if we don't have recent cache
    // Use more efficient count distinct query
    const uniqueRecipientsResult = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT "toUserId") as count
      FROM "Tip"
      WHERE "fromUserId" = ${fromUserId} AND "status" = 'COMPLETED'
    ` as [{ count: bigint }];

    const uniqueCount = Number(uniqueRecipientsResult[0]?.count || 0);
    const socialLevel = Math.floor(uniqueCount / 10);
    if (socialLevel > 0 && !existingMap.has(`social_butterfly_${socialLevel}`)) {
      achievementsToCreate.push({
        userId: fromUserId,
        type: "social_butterfly",
        level: socialLevel,
        displayText: `🦋 ${socialLevel * 10} People Tipped!`
      });
    }

    // Batch create achievements
    if (achievementsToCreate.length > 0) {
      try {
        await prisma.achievement.createMany({
          data: achievementsToCreate.map((a: any) => ({
            userId: a.userId,
            type: a.type,
            level: a.level,
            data: a.data ? JSON.stringify(a.data) : undefined
          })),
          skipDuplicates: true
        });

        // Add display texts for successful creations
        achievements.push(...achievementsToCreate.map((a: any) => a.displayText));

        // Invalidate user cache after new achievements
        const user = await prisma.user.findUnique({
          where: { id: fromUserId },
          select: { discordId: true }
        });
        if (user) {
          // Cache will auto-expire
        }

      } catch (error) {
        console.error("Error batch creating achievements:", error);
        // Fallback to individual creation if batch fails
        for (const achievement of achievementsToCreate) {
          const result = await createAchievement(achievement.userId, achievement.type, achievement.level, achievement.data);
          if (result) {
            achievements.push(achievement.displayText);
          }
        }
      }
    }

  } catch (error) {
    console.error("Error checking tip achievements:", error);
  }

  return achievements;
}

// Check and award deposit achievements with responsible gaming design
export async function checkDepositAchievements(userId: number, depositAmount: number): Promise<string[]> {
  const achievements: string[] = [];

  try {
    // Responsible deposit milestones (smaller, more frequent)
    const depositMilestones = [100, 250, 500, 1000, 2500, 5000];

    // Check for time-gating: max one deposit achievement per week
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentDepositAchievement = await prisma.achievement.findFirst({
      where: {
        userId,
        type: "deposit_milestone",
        unlockedAt: { gte: oneWeekAgo }
      },
      orderBy: { unlockedAt: 'desc' }
    });

    // If user got a deposit achievement in the last week, skip
    if (recentDepositAchievement) {
      const daysLeft = Math.ceil((recentDepositAchievement.unlockedAt.getTime() + 7 * 24 * 60 * 60 * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
      console.log(`User ${userId} has deposit achievement cooldown: ${daysLeft} days remaining`);

      // Check for responsible gaming achievement instead
      const responsibleResult = await createAchievement(userId, "responsible_gamer", 1);
      if (responsibleResult) {
        achievements.push(`🛡️ Responsible Gaming - Pacing deposits wisely!`);
      }
      return achievements;
    }

    // Award deposit milestones (time-gate enforced above)
    for (let i = 0; i < depositMilestones.length; i++) {
      const milestone = depositMilestones[i];
      if (depositAmount >= milestone) {
        const result = await createAchievement(userId, "deposit_milestone", i + 1);
        if (result !== null) {
          achievements.push(`🏦 ${milestone} Token Deposit!`);
          break; // Only award one per deposit
        }
      }
    }

    // Check for responsible gaming patterns
    const totalDeposits = await prisma.transaction.count({
      where: { userId, type: 'DEPOSIT' }
    });

    // Award for consistent small deposits vs large ones
    if (depositAmount <= 500 && totalDeposits > 10) {
      const result = await createAchievement(userId, "mindful_spender", Math.floor(totalDeposits / 10));
      if (result) {
        achievements.push(`💚 Mindful Spender - Consistent responsible deposits!`);
      }
    }

  } catch (error) {
    console.error("Error checking deposit achievements:", error);
  }

  return achievements;
}

// Check engagement-based achievements (replacing time-based ones)
export async function checkEngagementAchievements(userId: number): Promise<string[]> {
  const achievements: string[] = [];

  try {
    // Get user's activity patterns
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        createdAt: true,
        wins: true,
        losses: true,
        ties: true
      }
    });

    if (!user) return achievements;

    // Veteran player (account age milestones)
    const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const ageMilestones = [7, 30, 90, 180, 365]; // days
    for (let i = 0; i < ageMilestones.length; i++) {
      const milestone = ageMilestones[i];
      if (accountAge >= milestone) {
        const result = await createAchievement(userId, "veteran_player", i + 1);
        if (result !== null) {
          const label = milestone < 30 ? `${milestone} days` :
                       milestone < 365 ? `${Math.floor(milestone/30)} months` : "1 year";
          achievements.push(`🎖️ ${label} Veteran!`);
        }
      }
    }

    // Comeback kid (winning after losses)
    const totalGames = user.wins + user.losses + user.ties;
    if (totalGames >= 10 && user.wins > user.losses) {
      const result = await createAchievement(userId, "comeback_kid", 1);
      if (result !== null) {
        achievements.push(`💪 Comeback Kid!`);
      }
    }

  } catch (error) {
    console.error("Error checking engagement achievements:", error);
  }

  return achievements;
}

// Modified createAchievement to return success status
async function createAchievement(userId: number, type: string, level: number, data?: any): Promise<boolean | null> {
  try {
    await prisma.achievement.create({
      data: {
        userId,
        type,
        level,
        data: data ? JSON.stringify(data) : undefined
      }
    });
    return true;
  } catch (error) {
    // Achievement might already exist (unique constraint)
    console.log(`Achievement ${type} level ${level} already exists for user ${userId}`);
    return false;
  }
}

// Streak Protection System

interface StreakProtection {
  hasProtection: boolean;
  type?: 'grace' | 'shield';
  reason?: string;
}

// Check if user has streak protection available
async function checkStreakProtection(userId: number, currentStreak: number): Promise<StreakProtection> {
  // No protection for streaks less than 3
  if (currentStreak < 3) {
    return { hasProtection: false };
  }

  // Check for grace period (2 hours for all users)
  const lastGame = await prisma.userStreak.findUnique({
    where: { userId },
    select: { lastGameAt: true }
  });

  if (lastGame?.lastGameAt) {
    const hoursSinceLastGame = (Date.now() - lastGame.lastGameAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastGame <= 2) {
      return {
        hasProtection: true,
        type: 'grace',
        reason: '⏰ Grace Period - Streak protected (2 hour window)'
      };
    }
  }

  // Check for tier-based shield protection
  const activeMembership = await prisma.tierMembership.findFirst({
    where: {
      userId,
      status: 'ACTIVE',
      expiresAt: { gt: new Date() }
    },
    include: { tier: true },
    orderBy: { tier: { id: 'desc' } } // Get highest tier ID
  });

  if (!activeMembership) {
    return { hasProtection: false };
  }

  // Check shield availability based on tier
  const shieldCount = await getAvailableShields(userId, activeMembership.tier.id);

  if (shieldCount > 0) {
    return {
      hasProtection: true,
      type: 'shield',
      reason: `🛡️ Tier ${activeMembership.tier.id} Shield - Streak protected (${shieldCount} shields remaining)`
    };
  }

  return { hasProtection: false };
}

// Get available shields for a user based on tier
async function getAvailableShields(userId: number, tierLevel: number): Promise<number> {
  // Shield allocation per tier
  const shieldsPerTier: Record<number, { perMonth: number }> = {
    1: { perMonth: 1 },  // 1 shield per month
    2: { perMonth: 4 },  // 1 shield per week (4 per month)
    3: { perMonth: 8 }   // 2 shields per week (8 per month)
  };

  const tierConfig = shieldsPerTier[tierLevel] || { perMonth: 0 };

  if (tierConfig.perMonth === 0) {
    return 0;
  }

  // Check how many shields used this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const shieldsUsed = await prisma.achievement.count({
    where: {
      userId,
      type: 'shield_used',
      unlockedAt: { gte: startOfMonth }
    }
  });

  return Math.max(0, tierConfig.perMonth - shieldsUsed);
}

// Use a streak shield
async function useStreakShield(userId: number): Promise<void> {
  try {
    // Record shield usage as an achievement (for tracking)
    await prisma.achievement.create({
      data: {
        userId,
        type: 'shield_used',
        level: 1,
        data: JSON.stringify({ usedAt: new Date() })
      }
    });
    console.log(`Shield used by user ${userId}`);
  } catch (error) {
    console.error("Error using streak shield:", error);
  }
}