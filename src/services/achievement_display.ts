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

// Format achievement badge for display
export function formatAchievementBadge(achievement: any): string {
  const rarityIndicators = {
    common: '',
    rare: '✨',
    epic: '🌟',
    legendary: '👑'
  };

  const rarityIndicator = rarityIndicators[achievement.rarity as keyof typeof rarityIndicators] || '';

  if (achievement.unlockCount && achievement.unlockCount > 1) {
    return `${achievement.iconEmoji} **${achievement.name}** ${rarityIndicator} (×${achievement.unlockCount})`;
  }

  return `${achievement.iconEmoji} **${achievement.name}** ${rarityIndicator}`;
}