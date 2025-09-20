// src/services/achievement_display.ts - Display helpers for dynamic achievements

import { prisma } from "./db.js";

// Get user achievements for display
export async function getUserAchievements(discordId: string) {
  const user = await prisma.user.findUnique({
    where: { discordId },
    include: {
      unlockedAchievements: {
        include: {
          definition: true
        },
        orderBy: { unlockedAt: 'desc' }
      }
    }
  });

  if (!user) return [];

  return user.unlockedAchievements.map(achievement => ({
    id: achievement.id,
    name: achievement.definition.name,
    description: achievement.definition.description,
    category: achievement.definition.category,
    iconEmoji: achievement.definition.iconEmoji,
    badgeColor: achievement.definition.badgeColor,
    rarity: achievement.definition.rarity,
    unlockedAt: achievement.unlockedAt,
    progress: achievement.currentProgress,
    target: achievement.targetProgress,
    unlockCount: achievement.unlockCount
  }));
}

// Enhanced achievement badge formatting with progress and rarity styling
export function formatAchievementBadge(achievement: any, showProgress: boolean = false): string {
  const rarityIndicators = {
    common: '🐧',
    rare: '🐧✨',
    epic: '🐧🌟',
    legendary: '🐧👑'
  };

  const rarityBorders = {
    common: '',
    rare: '✨',
    epic: '🌟',
    legendary: '👑'
  };

  const rarityIndicator = rarityIndicators[achievement.rarity as keyof typeof rarityIndicators] || '🐧';
  const rarityBorder = rarityBorders[achievement.rarity as keyof typeof rarityBorders] || '';

  let badge = `${achievement.iconEmoji} **${achievement.name}** ${rarityIndicator}`;

  // Add unlock count for repeated achievements
  if (achievement.unlockCount && achievement.unlockCount > 1) {
    badge += ` (×${achievement.unlockCount})`;
  }

  // Add progress bar for incomplete achievements
  if (showProgress && achievement.progress !== undefined && achievement.target) {
    const progressPercent = Math.min(100, Math.floor((achievement.progress / achievement.target) * 100));
    const progressBar = createProgressBar(progressPercent);
    badge += `\n${progressBar} ${achievement.progress}/${achievement.target}`;
  }

  // Add rarity border for epic+ achievements
  if (rarityBorder) {
    badge = `${rarityBorder} ${badge} ${rarityBorder}`;
  }

  return badge;
}

// Create visual progress bar
function createProgressBar(percent: number, length: number = 10): string {
  const filled = Math.floor((percent / 100) * length);
  const empty = length - filled;

  let bar = '🐧'.repeat(filled) + '❄️'.repeat(empty);

  // Add percentage with penguin milestone markers
  if (percent >= 100) {
    return `🎉 ${bar} 100% 🏆`;
  } else if (percent >= 75) {
    return `⚡ ${bar} ${percent}%`;
  } else if (percent >= 50) {
    return `🔥 ${bar} ${percent}%`;
  } else if (percent >= 25) {
    return `✨ ${bar} ${percent}%`;
  } else {
    return `❄️ ${bar} ${percent}%`;
  }
}

// Get achievement category display info
export function getAchievementCategoryInfo(category: string) {
  const categoryData = {
    streaks: {
      name: "🔥 Victory Streaks",
      description: "Consecutive wins and impressive runs",
      emoji: "🔥",
      color: 0xff6b6b
    },
    tips: {
      name: "💸 Fish Sharing",
      description: "Generous fish sharing with colony members",
      emoji: "🐟",
      color: 0x38d9a9
    },
    deposits: {
      name: "💰 Fish Gathering",
      description: "Building up your fish reserves",
      emoji: "🏦",
      color: 0xffd93d
    },
    referrals: {
      name: "👥 Colony Growth",
      description: "Bringing new penguins to the colony",
      emoji: "🐧",
      color: 0x74c0fc
    },
    veteran: {
      name: "🎖️ Elder Status",
      description: "Time-honored colony members",
      emoji: "👑",
      color: 0xa78bfa
    },
    special: {
      name: "✨ Special Honors",
      description: "Unique and rare accomplishments",
      emoji: "⭐",
      color: 0xf59e0b
    }
  };

  return categoryData[category as keyof typeof categoryData] || {
    name: "🏆 Achievements",
    description: "Various accomplishments",
    emoji: "🏆",
    color: 0x6bcf7f
  };
}

// Format achievement for detailed display
export function formatDetailedAchievement(achievement: any): string {
  const timeAgo = `<t:${Math.floor(new Date(achievement.unlockedAt).getTime() / 1000)}:R>`;
  const categoryInfo = getAchievementCategoryInfo(achievement.category);

  let details = `${achievement.iconEmoji} **${achievement.name}**\n`;
  details += `${achievement.description}\n`;
  details += `${categoryInfo.emoji} *${categoryInfo.name}* • Unlocked ${timeAgo}`;

  if (achievement.unlockCount > 1) {
    details += `\n🔢 **Earned ${achievement.unlockCount} times**`;
  }

  return details;
}