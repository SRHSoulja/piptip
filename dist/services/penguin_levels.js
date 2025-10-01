import { prisma } from "./db.js";
const XP_SOURCES = {
  MATCH_WIN: 50,
  MATCH_LOSS: 15,
  MATCH_TIE: 25,
  TIP_SENT: 5,
  TIP_RECEIVED: 3,
  DEPOSIT: 10,
  ACHIEVEMENT_UNLOCK: 25,
  // Reduced from 100 to prevent unhealthy achievement hunting
  DAILY_LOGIN: 20,
  REFERRAL: 200,
  GROUP_TIP_CREATE: 25,
  GROUP_TIP_CLAIM: 15,
  GROUP_TIP_CONTRIBUTE: 10
};
const DAILY_XP_CAPS = {
  MATCHES: 500,
  // Max 10 wins worth of XP per day
  TIPS: 200,
  // Max 40 tips worth of XP per day
  ACHIEVEMENTS: 100,
  // Max 4 achievements worth of XP per day
  TOTAL_DAILY: 1e3
  // Absolute daily maximum
};
const XP_COOLDOWNS = {
  MATCH: 6e4,
  // 1 minute between match XP awards
  TIP: 3e4,
  // 30 seconds between tip XP awards
  ACHIEVEMENT: 5e3
  // 5 seconds between achievement XP awards
};
const PENGUIN_LEVELS = [
  {
    level: 1,
    title: "Hatchling",
    emoji: "\u{1F95A}",
    xpRequired: 0,
    xpToNext: 100,
    description: "A brand new penguin just starting their colony journey",
    unlockMessage: "Welcome to the penguin colony! \u{1F427}",
    benefits: ["Basic colony access", "Fish sharing"]
  },
  {
    level: 2,
    title: "Fledgling",
    emoji: "\u{1F423}",
    xpRequired: 100,
    xpToNext: 150,
    description: "Learning the ropes of penguin life",
    unlockMessage: "You're growing into a proper penguin! \u{1F427}\u2728",
    benefits: ["Match participation", "Tip notifications", "+5% XP bonus"]
  },
  {
    level: 3,
    title: "Waddle Walker",
    emoji: "\u{1F427}",
    xpRequired: 250,
    xpToNext: 200,
    description: "Mastering the art of the penguin waddle",
    unlockMessage: "Look at you waddle! So graceful! \u{1F427}\u{1F45F}",
    benefits: ["Enhanced achievements", "Profile customization", "+10% XP bonus"]
  },
  {
    level: 4,
    title: "Fish Hunter",
    emoji: "\u{1F3A3}",
    xpRequired: 450,
    xpToNext: 300,
    description: "Skilled at finding and sharing the best fish",
    unlockMessage: "You've become a master fish hunter! \u{1F3A3}\u{1F41F}",
    benefits: ["Enhanced match rewards", "Fish sharing bonuses", "+15% XP bonus"]
  },
  {
    level: 5,
    title: "Ice Slider",
    emoji: "\u{1F9CA}",
    xpRequired: 750,
    xpToNext: 400,
    description: "Effortlessly gliding across the ice fields",
    unlockMessage: "Sliding on ice like a true penguin pro! \u{1F9CA}\u26A1",
    benefits: ["Streak protection", "Premium match access", "+20% XP bonus"]
  },
  {
    level: 6,
    title: "Colony Guardian",
    emoji: "\u{1F6E1}\uFE0F",
    xpRequired: 1150,
    xpToNext: 500,
    description: "Protecting and nurturing fellow colony members",
    unlockMessage: "The colony trusts you as their guardian! \u{1F6E1}\uFE0F\u{1F427}",
    benefits: ["Moderator tools", "Community events", "+25% XP bonus"]
  },
  {
    level: 7,
    title: "Pebble Master",
    emoji: "\u{1FAA8}",
    xpRequired: 1650,
    xpToNext: 650,
    description: "Legendary skill in the ancient art of Penguin-Ice-Pebble",
    unlockMessage: "You've mastered the sacred pebble arts! \u{1FAA8}\u{1F451}",
    benefits: ["Advanced match features", "Special events", "+30% XP bonus"]
  },
  {
    level: 8,
    title: "Arctic Veteran",
    emoji: "\u2744\uFE0F",
    xpRequired: 2300,
    xpToNext: 800,
    description: "A weathered penguin with vast arctic experience",
    unlockMessage: "Your arctic wisdom is unmatched! \u2744\uFE0F\u{1F396}\uFE0F",
    benefits: ["Veteran status", "Special badges", "+35% XP bonus"]
  },
  {
    level: 9,
    title: "Emperor's Advisor",
    emoji: "\u{1F451}",
    xpRequired: 3100,
    xpToNext: 1e3,
    description: "Trusted counsel to the penguin royalty",
    unlockMessage: "The Emperor recognizes your wisdom! \u{1F451}\u{1F427}",
    benefits: ["Royal privileges", "Exclusive events", "+40% XP bonus"]
  },
  {
    level: 10,
    title: "Penguin Emperor",
    emoji: "\u{1F427}\u{1F451}",
    xpRequired: 4100,
    xpToNext: 0,
    description: "The ultimate penguin - ruler of the entire colony",
    unlockMessage: "ALL HAIL THE PENGUIN EMPEROR! \u{1F427}\u{1F451}\u{1F389}",
    benefits: ["Maximum prestige", "All features unlocked", "+50% XP bonus"]
  }
];
async function getUserLevel(discordId) {
  try {
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        totalXP: true
      }
    });
    const currentXP = user?.totalXP || 0;
    const currentLevel = calculateLevel(currentXP);
    const nextLevel = PENGUIN_LEVELS[currentLevel.level] || null;
    let xpToNextLevel = 0;
    let progress = 100;
    if (nextLevel) {
      xpToNextLevel = nextLevel.xpRequired - currentXP;
      const levelXPRange = nextLevel.xpRequired - currentLevel.xpRequired;
      const earnedInLevel = currentXP - currentLevel.xpRequired;
      progress = levelXPRange > 0 ? Math.floor(earnedInLevel / levelXPRange * 100) : 100;
    }
    return {
      currentLevel,
      currentXP,
      xpToNextLevel: Math.max(0, xpToNextLevel),
      progress: Math.max(0, Math.min(100, progress))
    };
  } catch (error) {
    console.error("Error getting user level:", error);
    return {
      currentLevel: PENGUIN_LEVELS[0],
      currentXP: 0,
      xpToNextLevel: PENGUIN_LEVELS[1]?.xpRequired || 0,
      progress: 0
    };
  }
}
function calculateLevel(totalXP) {
  for (let i = PENGUIN_LEVELS.length - 1; i >= 0; i--) {
    if (totalXP >= PENGUIN_LEVELS[i].xpRequired) {
      return PENGUIN_LEVELS[i];
    }
  }
  return PENGUIN_LEVELS[0];
}
function getXPBonus(level) {
  if (level >= 10) return 0.5;
  if (level >= 9) return 0.4;
  if (level >= 8) return 0.35;
  if (level >= 7) return 0.3;
  if (level >= 6) return 0.25;
  if (level >= 5) return 0.2;
  if (level >= 4) return 0.15;
  if (level >= 3) return 0.1;
  if (level >= 2) return 0.05;
  return 0;
}
const dailyXpCache = /* @__PURE__ */ new Map();
async function awardXP(discordId, xpAmount, source) {
  if (typeof xpAmount !== "number" || !Number.isFinite(xpAmount)) {
    throw new Error("Invalid XP amount");
  }
  if (xpAmount < 0 || xpAmount > 1e4) {
    throw new Error("XP amount out of bounds (0-10000)");
  }
  if (!source || source.length > 100) {
    throw new Error("Invalid XP source");
  }
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const userDailyKey = `${discordId}:${today}`;
  const dailyData = dailyXpCache.get(userDailyKey) || { date: today, total: 0, byCategory: {} };
  const category = getXpCategory(source);
  const categoryXp = dailyData.byCategory[category] || 0;
  const categoryLimit = DAILY_XP_CAPS[category] || DAILY_XP_CAPS.TOTAL_DAILY;
  let cappedAmount = xpAmount;
  if (categoryXp + xpAmount > categoryLimit) {
    cappedAmount = Math.max(0, categoryLimit - categoryXp);
  }
  if (dailyData.total + cappedAmount > DAILY_XP_CAPS.TOTAL_DAILY) {
    cappedAmount = Math.max(0, DAILY_XP_CAPS.TOTAL_DAILY - dailyData.total);
  }
  dailyData.total += cappedAmount;
  dailyData.byCategory[category] = (dailyData.byCategory[category] || 0) + cappedAmount;
  dailyXpCache.set(userDailyKey, dailyData);
  if (cappedAmount < xpAmount) {
    console.log(`XP capped for user ${discordId}: ${xpAmount} -> ${cappedAmount} (${source})`);
  }
  if (cappedAmount <= 0) {
    return {
      newXP: 0,
      cappedAmount
    };
  }
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { discordId },
      select: { id: true, totalXP: true }
    });
    if (!user) {
      throw new Error("User not found");
    }
    const previousXP = user.totalXP || 0;
    const previousLevel = calculateLevel(previousXP);
    const xpBonus = getXPBonus(previousLevel.level);
    const finalXP = Math.floor(cappedAmount * (1 + xpBonus));
    const newXP = previousXP + finalXP;
    if (newXP > 2147483647) {
      throw new Error("XP overflow prevented");
    }
    const newLevel = calculateLevel(newXP);
    await tx.user.update({
      where: { discordId },
      data: { totalXP: { increment: finalXP } }
    });
    await tx.xpTransaction.create({
      data: {
        userId: user.id,
        amount: finalXP,
        reason: source,
        metadata: JSON.stringify({
          totalXPAfter: newXP,
          previousXP,
          bonus: xpBonus,
          originalAmount: xpAmount,
          cappedAmount,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        })
      }
    }).catch(() => {
    });
    const levelUp = newLevel.level > previousLevel.level;
    return {
      newXP,
      levelUp,
      newLevel: levelUp ? newLevel : void 0,
      previousLevel: levelUp ? previousLevel : void 0,
      cappedAmount
    };
  });
}
function getXpCategory(source) {
  if (source.includes("Match") || source.includes("WIN") || source.includes("LOSS")) {
    return "MATCHES";
  }
  if (source.includes("Tip") || source.includes("TIP")) {
    return "TIPS";
  }
  if (source.includes("Achievement") || source.includes("ACHIEVEMENT")) {
    return "ACHIEVEMENTS";
  }
  return "OTHER";
}
setInterval(() => {
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  for (const [key] of dailyXpCache) {
    if (!key.includes(today)) {
      dailyXpCache.delete(key);
    }
  }
}, 36e5);
function formatLevelDisplay(levelInfo) {
  const { currentLevel, currentXP, xpToNextLevel, progress } = levelInfo;
  const progressBar = createLevelProgressBar(progress);
  let display = `${currentLevel.emoji} **${currentLevel.title}** (Level ${currentLevel.level})
`;
  display += `*${currentLevel.description}*

`;
  display += `\u{1F31F} **Total XP:** ${currentXP.toLocaleString()}
`;
  if (xpToNextLevel > 0) {
    display += `\u{1F4C8} **Next Level:** ${xpToNextLevel.toLocaleString()} XP away
`;
    display += `${progressBar}`;
  } else {
    display += `\u{1F451} **MAX LEVEL ACHIEVED!** \u{1F389}
`;
    display += `\u{1F427}\u{1F451}\u{1F427}\u{1F451}\u{1F427}\u{1F451}\u{1F427}\u{1F451}\u{1F427}\u{1F451}`;
  }
  return display;
}
function createLevelProgressBar(progress, length = 10) {
  const filled = Math.floor(progress / 100 * length);
  const empty = length - filled;
  const filledChar = "\u{1F427}";
  const emptyChar = "\u2744\uFE0F";
  const bar = filledChar.repeat(filled) + emptyChar.repeat(empty);
  return `${bar} ${progress}%`;
}
function getUserPermissions(level) {
  return {
    hasStreakProtection: level >= 5,
    hasModeratorTools: level >= 6,
    hasAdvancedFeatures: level >= 7,
    hasSpecialEvents: level >= 8,
    xpBonusPercent: getXPBonus(level) * 100
  };
}
export {
  DAILY_XP_CAPS,
  PENGUIN_LEVELS,
  XP_COOLDOWNS,
  XP_SOURCES,
  awardXP,
  formatLevelDisplay,
  getUserLevel,
  getUserPermissions
};
//# sourceMappingURL=penguin_levels.js.map
