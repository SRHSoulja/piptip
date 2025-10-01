import { prisma } from "./db.js";
async function getUserAchievements(discordId) {
  const user = await prisma.user.findUnique({
    where: { discordId },
    include: {
      unlockedAchievements: {
        include: {
          definition: true
        },
        orderBy: { unlockedAt: "desc" }
      }
    }
  });
  if (!user) return [];
  return user.unlockedAchievements.map((achievement) => ({
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
function formatAchievementBadge(achievement, showProgress = false) {
  const rarityIndicators = {
    common: "\u{1F427}",
    rare: "\u{1F427}\u2728",
    epic: "\u{1F427}\u{1F31F}",
    legendary: "\u{1F427}\u{1F451}"
  };
  const rarityBorders = {
    common: "",
    rare: "\u2728",
    epic: "\u{1F31F}",
    legendary: "\u{1F451}"
  };
  const rarityIndicator = rarityIndicators[achievement.rarity] || "\u{1F427}";
  const rarityBorder = rarityBorders[achievement.rarity] || "";
  let badge = `${achievement.iconEmoji} **${achievement.name}** ${rarityIndicator}`;
  if (achievement.unlockCount && achievement.unlockCount > 1) {
    badge += ` (\xD7${achievement.unlockCount})`;
  }
  if (showProgress && achievement.progress !== void 0 && achievement.target) {
    const progressPercent = Math.min(100, Math.floor(achievement.progress / achievement.target * 100));
    const progressBar = createProgressBar(progressPercent);
    badge += `
${progressBar} ${achievement.progress}/${achievement.target}`;
  }
  if (rarityBorder) {
    badge = `${rarityBorder} ${badge} ${rarityBorder}`;
  }
  return badge;
}
function createProgressBar(percent, length = 10) {
  const filled = Math.floor(percent / 100 * length);
  const empty = length - filled;
  let bar = "\u{1F427}".repeat(filled) + "\u2744\uFE0F".repeat(empty);
  if (percent >= 100) {
    return `\u{1F389} ${bar} 100% \u{1F3C6}`;
  } else if (percent >= 75) {
    return `\u26A1 ${bar} ${percent}%`;
  } else if (percent >= 50) {
    return `\u{1F525} ${bar} ${percent}%`;
  } else if (percent >= 25) {
    return `\u2728 ${bar} ${percent}%`;
  } else {
    return `\u2744\uFE0F ${bar} ${percent}%`;
  }
}
function getAchievementCategoryInfo(category) {
  const categoryData = {
    streaks: {
      name: "\u{1F525} Victory Streaks",
      description: "Consecutive wins and impressive runs",
      emoji: "\u{1F525}",
      color: 16739179
    },
    tips: {
      name: "\u{1F4B8} Fish Sharing",
      description: "Generous fish sharing with colony members",
      emoji: "\u{1F41F}",
      color: 3725737
    },
    deposits: {
      name: "\u{1F4B0} Fish Gathering",
      description: "Building up your fish reserves",
      emoji: "\u{1F3E6}",
      color: 16767293
    },
    referrals: {
      name: "\u{1F465} Colony Growth",
      description: "Bringing new penguins to the colony",
      emoji: "\u{1F427}",
      color: 7651580
    },
    veteran: {
      name: "\u{1F396}\uFE0F Elder Status",
      description: "Time-honored colony members",
      emoji: "\u{1F451}",
      color: 10980346
    },
    special: {
      name: "\u2728 Special Honors",
      description: "Unique and rare accomplishments",
      emoji: "\u2B50",
      color: 16096779
    }
  };
  return categoryData[category] || {
    name: "\u{1F3C6} Achievements",
    description: "Various accomplishments",
    emoji: "\u{1F3C6}",
    color: 7065471
  };
}
function formatDetailedAchievement(achievement) {
  const timeAgo = `<t:${Math.floor(new Date(achievement.unlockedAt).getTime() / 1e3)}:R>`;
  const categoryInfo = getAchievementCategoryInfo(achievement.category);
  let details = `${achievement.iconEmoji} **${achievement.name}**
`;
  details += `${achievement.description}
`;
  details += `${categoryInfo.emoji} *${categoryInfo.name}* \u2022 Unlocked ${timeAgo}`;
  if (achievement.unlockCount > 1) {
    details += `
\u{1F522} **Earned ${achievement.unlockCount} times**`;
  }
  return details;
}
export {
  formatAchievementBadge,
  formatDetailedAchievement,
  getAchievementCategoryInfo,
  getUserAchievements
};
//# sourceMappingURL=achievement_display.js.map
