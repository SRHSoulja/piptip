import { prisma } from "./db.js";
import { findOrCreateUser } from "./user_helpers.js";
import { cacheWithMetrics, CacheKeys, CacheTTL } from "./cache.js";
import { areAchievementsEnabled, isStreakProtectionEnabled } from "./emergency_controls.js";
async function updateStreak(discordId, won) {
  try {
    const user = await findOrCreateUser(discordId);
    let userStreak = await prisma.userStreak.findUnique({
      where: { userId: user.id }
    });
    if (!userStreak) {
      userStreak = await prisma.userStreak.create({
        data: {
          userId: user.id,
          currentWins: 0,
          longestWins: 0,
          lastGameAt: /* @__PURE__ */ new Date()
        }
      });
    }
    const now = /* @__PURE__ */ new Date();
    const timeSinceLastGame = userStreak.lastGameAt ? now.getTime() - userStreak.lastGameAt.getTime() : 0;
    const hoursAgo = timeSinceLastGame / (1e3 * 60 * 60);
    let newCurrentWins = userStreak.currentWins;
    let newLongestWins = userStreak.longestWins;
    let protectionUsed;
    if (won) {
      if (hoursAgo > 24) {
        newCurrentWins = 1;
      } else {
        newCurrentWins = userStreak.currentWins + 1;
      }
      if (newCurrentWins > newLongestWins) {
        newLongestWins = newCurrentWins;
      }
    } else {
      let protection = { hasProtection: false };
      if (await isStreakProtectionEnabled()) {
        protection = await checkStreakProtection(user.id, userStreak.currentWins);
      } else {
        console.log(`\u26A0\uFE0F Streak protection disabled globally - no protection for ${discordId}`);
      }
      if (protection.hasProtection) {
        newCurrentWins = userStreak.currentWins;
        protectionUsed = protection.reason;
        if (protection.type === "shield") {
          await useStreakShield(user.id);
        }
      } else {
        newCurrentWins = 0;
      }
    }
    await prisma.userStreak.update({
      where: { userId: user.id },
      data: {
        currentWins: newCurrentWins,
        longestWins: newLongestWins,
        lastGameAt: now
      }
    });
    if (Math.abs(newCurrentWins - userStreak.currentWins) >= 1) {
    }
    let achievementUnlocked;
    if (await areAchievementsEnabled()) {
      if (won && newCurrentWins > userStreak.currentWins) {
        const streakMilestones = [3, 5, 10, 15, 25, 50, 100];
        for (const milestone of streakMilestones) {
          if (newCurrentWins === milestone) {
            await createAchievement(user.id, "win_streak", milestone, {
              streak: milestone,
              date: now.toISOString()
            });
            achievementUnlocked = `\u{1F525}\u{1F427} ${milestone} Victory Streak!`;
            break;
          }
        }
        if (newCurrentWins === newLongestWins && newLongestWins > userStreak.longestWins) {
          const longestMilestones = [10, 25, 50, 100];
          for (const milestone of longestMilestones) {
            if (newLongestWins === milestone) {
              await createAchievement(user.id, "longest_streak", milestone, {
                longestStreak: milestone,
                date: now.toISOString()
              });
              achievementUnlocked = `\u{1F3C6}\u{1F427} Personal Best: ${milestone} Victories!`;
              break;
            }
          }
        }
      }
    } else {
      console.log(`\u26A0\uFE0F Achievements disabled globally - no achievements processed for ${discordId}`);
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
async function getStreakStats(discordId) {
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
async function getUserAchievements(discordId) {
  try {
    return await cacheWithMetrics(
      CacheKeys.userAchievements(discordId),
      async () => {
        return await prisma.achievement.findMany({
          where: { user: { discordId } },
          orderBy: { unlockedAt: "desc" }
        });
      },
      CacheTTL.achievements
    );
  } catch (error) {
    console.error("Error getting achievements:", error);
    return [];
  }
}
async function getStreakLeaderboard(limit = 10) {
  try {
    const cachedResult = await cacheWithMetrics(
      CacheKeys.leaderboard("streaks"),
      async () => {
        const streakLeaderboard = await prisma.userStreak.findMany({
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
              select: {
                discordId: true
              }
            }
          }
        });
        return streakLeaderboard.map((entry) => ({
          discordId: entry.user.discordId,
          currentWins: entry.currentWins,
          longestWins: entry.longestWins,
          lastGameAt: entry.lastGameAt,
          rank: 0
          // Will be set below
        }));
      },
      CacheTTL.leaderboard
    );
    return cachedResult.map((entry) => ({
      ...entry,
      lastGameAt: entry.lastGameAt ? new Date(entry.lastGameAt) : null
    }));
  } catch (error) {
    console.error("Error getting streak leaderboard:", error);
    return [];
  }
}
function formatStreakText(currentWins, longestWins) {
  if (currentWins === 0) {
    return longestWins > 0 ? `\u{1F427} Best streak: ${longestWins} victories` : "\u{1F427} No win streak yet - time to start hunting!";
  }
  const emoji = getStreakEmoji(currentWins);
  let text = `${emoji} ${currentWins} victory streak`;
  if (currentWins === longestWins && longestWins > 1) {
    text += " (\u{1F3C6} Personal Best!)";
  } else if (longestWins > currentWins) {
    text += ` \u2022 \u{1F3AF} Best: ${longestWins}`;
  }
  return text;
}
function getStreakEmoji(wins) {
  if (wins >= 100) return "\u{1F427}\u{1F48E}";
  if (wins >= 50) return "\u{1F427}\u{1F451}";
  if (wins >= 25) return "\u{1F427}\u26A1";
  if (wins >= 15) return "\u{1F525}\u{1F427}";
  if (wins >= 10) return "\u{1F31F}\u{1F427}";
  if (wins >= 5) return "\u2728\u{1F427}";
  if (wins >= 3) return "\u{1F3AF}\u{1F427}";
  return "\u{1F427}";
}
function formatAchievementBadge(achievement) {
  switch (achievement.type) {
    case "win_streak":
      return `\u{1F525}\u{1F427} ${achievement.level} Victory Streak`;
    case "longest_streak":
      return `\u{1F3C6}\u{1F427} ${achievement.level} Best Streak`;
    case "referral_count":
      return `\u{1F465}\u{1F427} ${achievement.level * 5} Colony Members`;
    case "total_tips":
      return `\u{1F4B0}\u{1F427} ${achievement.level}k Fish Shared`;
    case "big_tipper":
      return `\u{1F48E}\u{1F427} ${achievement.level * 100}+ Big Fish`;
    case "deposit_milestone":
      const milestones = [100, 250, 500, 1e3, 2500, 5e3];
      return `\u{1F3E6}\u{1F427} ${milestones[achievement.level - 1] || achievement.level * 500} Fish Deposited`;
    case "responsible_gamer":
      return `\u{1F6E1}\uFE0F\u{1F427} Responsible Penguin`;
    case "mindful_spender":
      return `\u{1F49A}\u{1F427} Wise Penguin x${achievement.level}`;
    case "veteran_player":
      const labels = ["7 days", "1 month", "3 months", "6 months", "1 year"];
      return `\u{1F396}\uFE0F\u{1F427} ${labels[achievement.level - 1] || "Veteran"} Colony Elder`;
    case "comeback_kid":
      return `\u{1F4AA}\u{1F427} Resilient Penguin`;
    case "social_butterfly":
      return `\u{1F98B}\u{1F427} ${achievement.level * 10} Friends Made`;
    case "lucky_winner":
      return `\u{1F340}\u{1F427} Lucky Streak (${achievement.level} Wins)`;
    default:
      return `\u{1F396}\uFE0F\u{1F427} ${achievement.type} ${achievement.level}`;
  }
}
async function checkTipAchievements(fromUserId, tipCount, tipAmount) {
  const achievements = [];
  try {
    const existingAchievements = await prisma.achievement.findMany({
      where: {
        userId: fromUserId,
        type: { in: ["total_tips", "big_tipper", "social_butterfly"] }
      },
      select: { type: true, level: true }
    });
    const existingMap = new Map(
      existingAchievements.map((a) => [`${a.type}_${a.level}`, true])
    );
    const achievementsToCreate = [];
    const totalTipLevel = Math.floor(tipCount / 1e3);
    if (totalTipLevel > 0 && !existingMap.has(`total_tips_${totalTipLevel}`)) {
      achievementsToCreate.push({
        userId: fromUserId,
        type: "total_tips",
        level: totalTipLevel,
        displayText: `\u{1F4B0}\u{1F427} ${totalTipLevel}k Fish Shared!`
      });
    }
    const bigTipMilestones = [100, 500, 1e3, 5e3, 1e4];
    for (let i = 0; i < bigTipMilestones.length; i++) {
      const milestone = bigTipMilestones[i];
      if (tipAmount >= milestone && !existingMap.has(`big_tipper_${i + 1}`)) {
        achievementsToCreate.push({
          userId: fromUserId,
          type: "big_tipper",
          level: i + 1,
          displayText: `\u{1F48E}\u{1F427} ${milestone}+ Big Fish!`
        });
      }
    }
    const uniqueRecipientsResult = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT "toUserId") as count
      FROM "Tip"
      WHERE "fromUserId" = ${fromUserId} AND "status" = 'COMPLETED'
    `;
    const uniqueCount = Number(uniqueRecipientsResult[0]?.count || 0);
    const socialLevel = Math.floor(uniqueCount / 10);
    if (socialLevel > 0 && !existingMap.has(`social_butterfly_${socialLevel}`)) {
      achievementsToCreate.push({
        userId: fromUserId,
        type: "social_butterfly",
        level: socialLevel,
        displayText: `\u{1F98B}\u{1F427} ${socialLevel * 10} Friends Made!`
      });
    }
    if (achievementsToCreate.length > 0) {
      try {
        await prisma.achievement.createMany({
          data: achievementsToCreate.map((a) => ({
            userId: a.userId,
            type: a.type,
            level: a.level,
            data: a.data ? JSON.stringify(a.data) : void 0
          })),
          skipDuplicates: true
        });
        achievements.push(...achievementsToCreate.map((a) => a.displayText));
        const user = await prisma.user.findUnique({
          where: { id: fromUserId },
          select: { discordId: true }
        });
        if (user) {
        }
      } catch (error) {
        console.error("Error batch creating achievements:", error);
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
async function checkDepositAchievements(userId, depositAmount) {
  const achievements = [];
  try {
    const depositMilestones = [100, 250, 500, 1e3, 2500, 5e3];
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3);
    const recentDepositAchievement = await prisma.achievement.findFirst({
      where: {
        userId,
        type: "deposit_milestone",
        unlockedAt: { gte: oneWeekAgo }
      },
      orderBy: { unlockedAt: "desc" }
    });
    if (recentDepositAchievement) {
      const daysLeft = Math.ceil((recentDepositAchievement.unlockedAt.getTime() + 7 * 24 * 60 * 60 * 1e3 - Date.now()) / (1e3 * 60 * 60 * 24));
      console.log(`User ${userId} has deposit achievement cooldown: ${daysLeft} days remaining`);
      const responsibleResult = await createAchievement(userId, "responsible_gamer", 1);
      if (responsibleResult) {
        achievements.push(`\u{1F6E1}\uFE0F\u{1F427} Responsible Penguin - Pacing deposits wisely!`);
      }
      return achievements;
    }
    for (let i = 0; i < depositMilestones.length; i++) {
      const milestone = depositMilestones[i];
      if (depositAmount >= milestone) {
        const result = await createAchievement(userId, "deposit_milestone", i + 1);
        if (result !== null) {
          achievements.push(`\u{1F3E6}\u{1F427} ${milestone} Fish Deposit!`);
          break;
        }
      }
    }
    const totalDeposits = await prisma.transaction.count({
      where: { userId, type: "DEPOSIT" }
    });
    if (depositAmount <= 500 && totalDeposits > 10) {
      const result = await createAchievement(userId, "mindful_spender", Math.floor(totalDeposits / 10));
      if (result) {
        achievements.push(`\u{1F49A}\u{1F427} Wise Penguin - Consistent responsible deposits!`);
      }
    }
  } catch (error) {
    console.error("Error checking deposit achievements:", error);
  }
  return achievements;
}
async function checkEngagementAchievements(userId) {
  const achievements = [];
  try {
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
    const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1e3 * 60 * 60 * 24));
    const ageMilestones = [7, 30, 90, 180, 365];
    for (let i = 0; i < ageMilestones.length; i++) {
      const milestone = ageMilestones[i];
      if (accountAge >= milestone) {
        const result = await createAchievement(userId, "veteran_player", i + 1);
        if (result !== null) {
          const label = milestone < 30 ? `${milestone} days` : milestone < 365 ? `${Math.floor(milestone / 30)} months` : "1 year";
          achievements.push(`\u{1F396}\uFE0F\u{1F427} ${label} Colony Elder!`);
        }
      }
    }
    const totalGames = user.wins + user.losses + user.ties;
    if (totalGames >= 10 && user.wins > user.losses) {
      const result = await createAchievement(userId, "comeback_kid", 1);
      if (result !== null) {
        achievements.push(`\u{1F4AA}\u{1F427} Resilient Penguin!`);
      }
    }
  } catch (error) {
    console.error("Error checking engagement achievements:", error);
  }
  return achievements;
}
async function createAchievement(userId, type, level, data) {
  try {
    await prisma.achievement.create({
      data: {
        userId,
        type,
        level,
        data: data ? JSON.stringify(data) : void 0
      }
    });
    return true;
  } catch (error) {
    console.log(`Achievement ${type} level ${level} already exists for user ${userId}`);
    return false;
  }
}
async function checkStreakProtection(userId, currentStreak) {
  if (currentStreak < 3) {
    return { hasProtection: false };
  }
  const lastGame = await prisma.userStreak.findUnique({
    where: { userId },
    select: { lastGameAt: true }
  });
  if (lastGame?.lastGameAt) {
    const hoursSinceLastGame = (Date.now() - lastGame.lastGameAt.getTime()) / (1e3 * 60 * 60);
    if (hoursSinceLastGame <= 2) {
      return {
        hasProtection: true,
        type: "grace",
        reason: "\u23F0 Grace Period - Streak protected (2 hour window)"
      };
    }
  }
  const activeMembership = await prisma.tierMembership.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      expiresAt: { gt: /* @__PURE__ */ new Date() }
    },
    include: { tier: true },
    orderBy: { tier: { id: "desc" } }
    // Get highest tier ID
  });
  if (!activeMembership) {
    return { hasProtection: false };
  }
  const shieldCount = await getAvailableShields(userId, activeMembership.tier.id);
  if (shieldCount > 0) {
    return {
      hasProtection: true,
      type: "shield",
      reason: `\u{1F6E1}\uFE0F Tier ${activeMembership.tier.id} Shield - Streak protected (${shieldCount} shields remaining)`
    };
  }
  return { hasProtection: false };
}
async function getAvailableShields(userId, tierLevel) {
  const shieldsPerTier = {
    1: { perMonth: 1 },
    // 1 shield per month
    2: { perMonth: 4 },
    // 1 shield per week (4 per month)
    3: { perMonth: 8 }
    // 2 shields per week (8 per month)
  };
  const tierConfig = shieldsPerTier[tierLevel] || { perMonth: 0 };
  if (tierConfig.perMonth === 0) {
    return 0;
  }
  const startOfMonth = /* @__PURE__ */ new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const shieldsUsed = await prisma.achievement.count({
    where: {
      userId,
      type: "shield_used",
      unlockedAt: { gte: startOfMonth }
    }
  });
  return Math.max(0, tierConfig.perMonth - shieldsUsed);
}
async function useStreakShield(userId) {
  try {
    await prisma.achievement.create({
      data: {
        userId,
        type: "shield_used",
        level: 1,
        data: JSON.stringify({ usedAt: /* @__PURE__ */ new Date() })
      }
    });
    console.log(`Shield used by user ${userId}`);
  } catch (error) {
    console.error("Error using streak shield:", error);
  }
}
export {
  checkDepositAchievements,
  checkEngagementAchievements,
  checkTipAchievements,
  formatAchievementBadge,
  formatStreakText,
  getStreakLeaderboard,
  getStreakStats,
  getUserAchievements,
  updateStreak
};
//# sourceMappingURL=streaks.js.map
