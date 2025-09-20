// src/services/penguin_levels.ts - User level and title progression system

import { prisma } from "./db.js";

// Penguin level system with themed titles
export interface PenguinLevel {
  level: number;
  title: string;
  emoji: string;
  xpRequired: number;
  xpToNext: number;
  description: string;
  unlockMessage: string;
  benefits: string[];
}

// Experience point sources
export const XP_SOURCES = {
  MATCH_WIN: 50,
  MATCH_LOSS: 15,
  MATCH_TIE: 25,
  TIP_SENT: 5,
  TIP_RECEIVED: 3,
  DEPOSIT: 10,
  ACHIEVEMENT_UNLOCK: 100,
  DAILY_LOGIN: 20,
  REFERRAL: 200,
  GROUP_TIP_CREATE: 25,
  GROUP_TIP_CLAIM: 15
};

// Penguin level progression table
export const PENGUIN_LEVELS: PenguinLevel[] = [
  {
    level: 1,
    title: "Hatchling",
    emoji: "🥚",
    xpRequired: 0,
    xpToNext: 100,
    description: "A brand new penguin just starting their colony journey",
    unlockMessage: "Welcome to the penguin colony! 🐧",
    benefits: ["Basic colony access", "Fish sharing"]
  },
  {
    level: 2,
    title: "Fledgling",
    emoji: "🐣",
    xpRequired: 100,
    xpToNext: 150,
    description: "Learning the ropes of penguin life",
    unlockMessage: "You're growing into a proper penguin! 🐧✨",
    benefits: ["Match participation", "Tip notifications", "+5% XP bonus"]
  },
  {
    level: 3,
    title: "Waddle Walker",
    emoji: "🐧",
    xpRequired: 250,
    xpToNext: 200,
    description: "Mastering the art of the penguin waddle",
    unlockMessage: "Look at you waddle! So graceful! 🐧👟",
    benefits: ["Enhanced achievements", "Profile customization", "+10% XP bonus"]
  },
  {
    level: 4,
    title: "Fish Hunter",
    emoji: "🎣",
    xpRequired: 450,
    xpToNext: 300,
    description: "Skilled at finding and sharing the best fish",
    unlockMessage: "You've become a master fish hunter! 🎣🐟",
    benefits: ["Enhanced match rewards", "Fish sharing bonuses", "+15% XP bonus"]
  },
  {
    level: 5,
    title: "Ice Slider",
    emoji: "🧊",
    xpRequired: 750,
    xpToNext: 400,
    description: "Effortlessly gliding across the ice fields",
    unlockMessage: "Sliding on ice like a true penguin pro! 🧊⚡",
    benefits: ["Streak protection", "Premium match access", "+20% XP bonus"]
  },
  {
    level: 6,
    title: "Colony Guardian",
    emoji: "🛡️",
    xpRequired: 1150,
    xpToNext: 500,
    description: "Protecting and nurturing fellow colony members",
    unlockMessage: "The colony trusts you as their guardian! 🛡️🐧",
    benefits: ["Moderator tools", "Community events", "+25% XP bonus"]
  },
  {
    level: 7,
    title: "Pebble Master",
    emoji: "🪨",
    xpRequired: 1650,
    xpToNext: 650,
    description: "Legendary skill in the ancient art of Penguin-Ice-Pebble",
    unlockMessage: "You've mastered the sacred pebble arts! 🪨👑",
    benefits: ["Advanced match features", "Special events", "+30% XP bonus"]
  },
  {
    level: 8,
    title: "Arctic Veteran",
    emoji: "❄️",
    xpRequired: 2300,
    xpToNext: 800,
    description: "A weathered penguin with vast arctic experience",
    unlockMessage: "Your arctic wisdom is unmatched! ❄️🎖️",
    benefits: ["Veteran status", "Special badges", "+35% XP bonus"]
  },
  {
    level: 9,
    title: "Emperor's Advisor",
    emoji: "👑",
    xpRequired: 3100,
    xpToNext: 1000,
    description: "Trusted counsel to the penguin royalty",
    unlockMessage: "The Emperor recognizes your wisdom! 👑🐧",
    benefits: ["Royal privileges", "Exclusive events", "+40% XP bonus"]
  },
  {
    level: 10,
    title: "Penguin Emperor",
    emoji: "🐧👑",
    xpRequired: 4100,
    xpToNext: 0,
    description: "The ultimate penguin - ruler of the entire colony",
    unlockMessage: "ALL HAIL THE PENGUIN EMPEROR! 🐧👑🎉",
    benefits: ["Maximum prestige", "All features unlocked", "+50% XP bonus"]
  }
];

// Get user's current level and XP
export async function getUserLevel(discordId: string): Promise<{
  currentLevel: PenguinLevel;
  currentXP: number;
  xpToNextLevel: number;
  progress: number;
}> {
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
    let progress = 100; // Max level reached

    if (nextLevel) {
      xpToNextLevel = nextLevel.xpRequired - currentXP;
      const levelXPRange = nextLevel.xpRequired - currentLevel.xpRequired;
      const earnedInLevel = currentXP - currentLevel.xpRequired;
      progress = levelXPRange > 0 ? Math.floor((earnedInLevel / levelXPRange) * 100) : 100;
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

// Calculate level from total XP
function calculateLevel(totalXP: number): PenguinLevel {
  for (let i = PENGUIN_LEVELS.length - 1; i >= 0; i--) {
    if (totalXP >= PENGUIN_LEVELS[i].xpRequired) {
      return PENGUIN_LEVELS[i];
    }
  }
  return PENGUIN_LEVELS[0]; // Default to level 1
}

// Award XP and check for level up
export async function awardXP(
  discordId: string,
  xpAmount: number,
  source: string
): Promise<{
  newXP: number;
  levelUp?: boolean;
  newLevel?: PenguinLevel;
  previousLevel?: PenguinLevel;
}> {
  try {
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: { id: true, totalXP: true }
    });

    if (!user) {
      throw new Error("User not found");
    }

    const previousXP = user.totalXP || 0;
    const previousLevel = calculateLevel(previousXP);

    // Apply XP bonus based on current level
    const xpBonus = getXPBonus(previousLevel.level);
    const finalXP = Math.floor(xpAmount * (1 + xpBonus));

    const newXP = previousXP + finalXP;
    const newLevel = calculateLevel(newXP);

    // Update user's total XP
    await prisma.user.update({
      where: { discordId },
      data: { totalXP: newXP }
    });

    // Log XP transaction
    await prisma.xpTransaction.create({
      data: {
        userId: user.id,
        amount: finalXP,
        reason: source,
        metadata: JSON.stringify({ totalXPAfter: newXP })
      }
    }).catch(() => {}); // Ignore if table doesn't exist

    const levelUp = newLevel.level > previousLevel.level;

    return {
      newXP,
      levelUp,
      newLevel: levelUp ? newLevel : undefined,
      previousLevel: levelUp ? previousLevel : undefined
    };

  } catch (error) {
    console.error("Error awarding XP:", error);
    return { newXP: 0 };
  }
}

// Get XP bonus percentage for current level
function getXPBonus(level: number): number {
  const levelData = PENGUIN_LEVELS.find(l => l.level === level);
  if (!levelData) return 0;

  // Extract bonus percentage from benefits
  const bonusBenefit = levelData.benefits.find(b => b.includes("XP bonus"));
  if (!bonusBenefit) return 0;

  const match = bonusBenefit.match(/\+(\d+)%/);
  return match ? parseInt(match[1]) / 100 : 0;
}

// Format level display for embeds
export function formatLevelDisplay(levelInfo: {
  currentLevel: PenguinLevel;
  currentXP: number;
  xpToNextLevel: number;
  progress: number;
}): string {
  const { currentLevel, currentXP, xpToNextLevel, progress } = levelInfo;

  // Create progress bar
  const progressBar = createLevelProgressBar(progress);

  let display = `${currentLevel.emoji} **${currentLevel.title}** (Level ${currentLevel.level})\n`;
  display += `*${currentLevel.description}*\n\n`;
  display += `🌟 **Total XP:** ${currentXP.toLocaleString()}\n`;

  if (xpToNextLevel > 0) {
    display += `📈 **Next Level:** ${xpToNextLevel.toLocaleString()} XP away\n`;
    display += `${progressBar}`;
  } else {
    display += `👑 **MAX LEVEL ACHIEVED!** 🎉\n`;
    display += `🐧👑🐧👑🐧👑🐧👑🐧👑`;
  }

  return display;
}

// Create progress bar for level display
function createLevelProgressBar(progress: number, length: number = 10): string {
  const filled = Math.floor((progress / 100) * length);
  const empty = length - filled;

  const filledChar = "🐧";
  const emptyChar = "❄️";

  const bar = filledChar.repeat(filled) + emptyChar.repeat(empty);
  return `${bar} ${progress}%`;
}

// Get level-based features/permissions
export function getUserPermissions(level: number): {
  hasStreakProtection: boolean;
  hasModeratorTools: boolean;
  hasAdvancedFeatures: boolean;
  hasSpecialEvents: boolean;
  xpBonusPercent: number;
} {
  return {
    hasStreakProtection: level >= 5,
    hasModeratorTools: level >= 6,
    hasAdvancedFeatures: level >= 7,
    hasSpecialEvents: level >= 8,
    xpBonusPercent: getXPBonus(level) * 100
  };
}