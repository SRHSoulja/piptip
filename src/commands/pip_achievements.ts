// src/commands/pip_achievements.ts - Dynamic Achievement System Command
import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { prisma } from "../services/db.js";
import { getStreakStats, formatStreakText } from "../services/streaks.js";
import { areAchievementsEnabled } from "../services/emergency_controls.js";
import { getUserAchievements, formatAchievementBadge, getAchievementCategoryInfo } from "../services/achievement_display.js";
import { PENGUIN_ERRORS, createPenguinError, createPenguinSuccess } from "../utils/penguin_messages.js";

export default async function pipAchievements(i: ChatInputCommandInteraction) {
  try {
    // Check if achievements are globally enabled
    if (!(await areAchievementsEnabled())) {
      return i.reply({
        content: "🚫 Achievement system is temporarily disabled",
        flags: MessageFlags.Ephemeral
      });
    }

    // Get user to check with validation
    const targetUser = i.options.getUser("user") || i.user;

    // Validate Discord user ID format (snowflake)
    if (!targetUser.id.match(/^\d{17,19}$/)) {
      return i.reply({
        content: "❌ Invalid user ID format",
        flags: MessageFlags.Ephemeral
      });
    }

    // Get user from database
    const [user, achievements, streakStats] = await Promise.all([
      prisma.user.findUnique({
        where: { discordId: targetUser.id },
        select: {
          id: true,
          wins: true,
          losses: true,
          ties: true,
          createdAt: true
        }
      }),
      getUserAchievements(targetUser.id),
      getStreakStats(targetUser.id)
    ]);

    if (!user) {
      return i.reply({
        content: createPenguinError(
          "No Penguin Colony Membership!",
          "You need to join the penguin colony first! Use `/pip_profile` to get started and begin your journey to earning achievement badges! 🐧",
          { personality: 'friendly', emoji: '🐧' }
        ),
        flags: MessageFlags.Ephemeral
      });
    }

    // Calculate total games and win rate
    const totalGames = user.wins + user.losses + user.ties;
    const winRate = totalGames > 0 ? ((user.wins / totalGames) * 100).toFixed(1) : "0.0";

    // Create main embed
    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${targetUser.username}'s Achievements`)
      .setColor(0xFFD700)
      .setThumbnail(targetUser.displayAvatarURL())
      .setTimestamp();

    // Add current stats section
    const streakText = formatStreakText(streakStats.currentWins, streakStats.longestWins);
    embed.addFields({
      name: "🔥 Current Status",
      value: [
        streakText,
        `📊 **Win Rate:** ${winRate}% (${user.wins}W-${user.losses}L-${user.ties}T)`,
        `📅 **Member Since:** <t:${Math.floor(user.createdAt.getTime() / 1000)}:D>`,
        `🏆 **Total Achievements:** ${achievements.length}`
      ].join("\n"),
      inline: false
    });

    // Group achievements by category
    const achievementsByCategory = new Map<string, any[]>();
    for (const achievement of achievements) {
      const categoryList = achievementsByCategory.get(achievement.category) || [];
      categoryList.push(achievement);
      achievementsByCategory.set(achievement.category, categoryList);
    }

    // Display achievements by category with enhanced styling
    if (achievements.length > 0) {
      const categoryOrder = ['streaks', 'tips', 'deposits', 'referrals', 'veteran', 'special'];

      for (const category of categoryOrder) {
        const categoryAchievements = achievementsByCategory.get(category) || [];
        if (categoryAchievements.length > 0) {
          const categoryInfo = getAchievementCategoryInfo(category);

          const badges = categoryAchievements
            .sort((a, b) => new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime())
            .slice(0, 4) // Reduced to 4 to make room for enhanced formatting
            .map((achievement: any) => {
              const badge = formatAchievementBadge(achievement, true); // Show progress
              const date = `<t:${Math.floor(new Date(achievement.unlockedAt).getTime() / 1000)}:R>`;
              return `${badge}\n*Unlocked ${date}*`;
            })
            .join("\n\n");

          // Show count if more achievements exist
          const moreCount = categoryAchievements.length > 4 ? categoryAchievements.length - 4 : 0;
          const finalValue = badges + (moreCount > 0 ? `\n\n*+${moreCount} more ${categoryInfo.name.toLowerCase()}*` : '');

          embed.addFields({
            name: `${categoryInfo.emoji} ${categoryInfo.name} (${categoryAchievements.length})`,
            value: finalValue.substring(0, 1024),
            inline: false
          });
        }
      }

      // Add rarity breakdown
      const rarityCount = achievements.reduce((acc: any, achievement: any) => {
        acc[achievement.rarity] = (acc[achievement.rarity] || 0) + 1;
        return acc;
      }, {});

      const rarityText = Object.entries(rarityCount)
        .map(([rarity, count]) => {
          const rarityEmojis = {
            common: "🐧",
            rare: "🐧✨",
            epic: "🐧🌟",
            legendary: "🐧👑"
          };
          const rarityNames = {
            common: "Common Penguins",
            rare: "Rare Penguins",
            epic: "Epic Penguins",
            legendary: "Legendary Penguins"
          };
          return `${rarityEmojis[rarity as keyof typeof rarityEmojis]} **${count}** ${rarityNames[rarity as keyof typeof rarityNames]}`;
        })
        .join("\n");

      if (rarityText) {
        embed.addFields({
          name: "💎 Penguin Collection",
          value: rarityText,
          inline: false
        });
      }

    } else {
      embed.addFields({
        name: "🐧 Start Your Penguin Journey!",
        value: "🎯 **Get started with these activities:**\n" +
               "• 🥊 Play Penguin-Ice-Pebble matches\n" +
               "• 🐟 Share fish with colony members\n" +
               "• 💰 Build up your fish reserves\n" +
               "• 👥 Invite friends to join the colony\n\n" +
               "*Your first achievement is just a waddle away!* 🐧✨",
        inline: false
      });
    }

    // Enhanced action buttons
    const buttons = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("achievements_refresh")
          .setLabel("🔄 Refresh Achievements")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🐧"),
        new ButtonBuilder()
          .setCustomId("achievements_categories")
          .setLabel("📋 Browse Colony Honors")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🏆"),
        new ButtonBuilder()
          .setCustomId("achievements_progress")
          .setLabel("📊 View Progress")
          .setStyle(ButtonStyle.Success)
          .setEmoji("📈")
      );

    await i.reply({
      embeds: [embed],
      components: [buttons]
    });

  } catch (error: any) {
    console.error("Error in pip_achievements:", error);
    await i.reply({
      content: `❌ Error loading achievements: ${error?.message || "Unknown error"}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }
}