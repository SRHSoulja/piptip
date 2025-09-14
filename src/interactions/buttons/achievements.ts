// src/interactions/buttons/achievements.ts
import type { ButtonInteraction } from "discord.js";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { prisma } from "../../services/db.js";
import { getUserAchievements, formatAchievementBadge, getStreakStats, formatStreakText } from "../../services/streaks.js";

// Handle refresh achievements button
export async function handleRefreshAchievements(i: ButtonInteraction) {
  try {
    // Defer the update to prevent timeout
    await i.deferUpdate();

    // Get the current user's achievements
    const [achievements, streakStats, user] = await Promise.all([
      getUserAchievements(i.user.id),
      getStreakStats(i.user.id),
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: {
          id: true,
          wins: true,
          losses: true,
          ties: true,
          createdAt: true
        }
      })
    ]);

    if (!user) {
      return i.editReply({
        content: "❌ You don't have an account yet! Use `/pip_profile` to get started.",
        embeds: [],
        components: []
      });
    }

    // Calculate total games and win rate
    const totalGames = user.wins + user.losses + user.ties;
    const winRate = totalGames > 0 ? ((user.wins / totalGames) * 100).toFixed(1) : "0.0";

    // Create refreshed embed
    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${i.user.username}'s Achievements`)
      .setColor(0xFFD700)
      .setThumbnail(i.user.displayAvatarURL())
      .setTimestamp();

    // Add current streak info
    const streakText = formatStreakText(streakStats.currentWins, streakStats.longestWins);
    embed.addFields({
      name: "🔥 Current Status",
      value: [
        streakText,
        `📊 **Win Rate:** ${winRate}% (${user.wins}W-${user.losses}L-${user.ties}T)`,
        `📅 **Member Since:** <t:${Math.floor(user.createdAt.getTime() / 1000)}:D>`
      ].join("\n"),
      inline: false
    });

    // Add achievements display
    if (achievements.length > 0) {
      const achievementText = achievements.slice(0, 5)
        .map((achievement: any) => formatAchievementBadge(achievement))
        .join("\n");

      embed.addFields({
        name: `🏆 Recent Achievements (${achievements.length} total)`,
        value: achievementText,
        inline: false
      });
    } else {
      embed.addFields({
        name: "🎯 No Achievements Yet",
        value: "Start playing matches and tipping to unlock achievements!",
        inline: false
      });
    }

    // Update the message with refreshed data
    await i.editReply({
      embeds: [embed],
      components: i.message.components // Keep existing buttons
    });

  } catch (error: any) {
    console.error("Error refreshing achievements:", error);
    await i.editReply({
      content: `❌ Error refreshing achievements: ${error?.message || "Unknown error"}`,
      embeds: [],
      components: []
    }).catch(() => {});
  }
}

// Handle show leaderboard button
export async function handleShowLeaderboard(i: ButtonInteraction) {
  try {
    // Reply with leaderboard selection
    await i.reply({
      content: "🏅 Use `/pip_leaderboard` to view different leaderboard categories!",
      flags: MessageFlags.Ephemeral
    });
  } catch (error: any) {
    console.error("Error showing leaderboard:", error);
    await i.reply({
      content: `❌ Error: ${error?.message || "Unknown error"}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }
}

// Handle view own achievements button
export async function handleViewOwnAchievements(i: ButtonInteraction) {
  try {
    // Defer reply since we need to fetch data
    await i.deferReply({ ephemeral: true });

    // Get the user's own achievements
    const [achievements, streakStats, user] = await Promise.all([
      getUserAchievements(i.user.id),
      getStreakStats(i.user.id),
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: {
          id: true,
          wins: true,
          losses: true,
          ties: true,
          createdAt: true
        }
      })
    ]);

    if (!user) {
      return i.editReply({
        content: "❌ You don't have an account yet! Use `/pip_profile` to get started."
      });
    }

    // Calculate stats
    const totalGames = user.wins + user.losses + user.ties;
    const winRate = totalGames > 0 ? ((user.wins / totalGames) * 100).toFixed(1) : "0.0";

    // Create personal achievements embed
    const embed = new EmbedBuilder()
      .setTitle(`🏆 Your Achievements`)
      .setColor(0xFFD700)
      .setThumbnail(i.user.displayAvatarURL())
      .setTimestamp();

    // Add streak and stats
    const streakText = formatStreakText(streakStats.currentWins, streakStats.longestWins);
    embed.addFields({
      name: "📊 Your Stats",
      value: [
        streakText,
        `**Win Rate:** ${winRate}% (${user.wins}W-${user.losses}L-${user.ties}T)`,
        `**Total Achievements:** ${achievements.length}`
      ].join("\n"),
      inline: false
    });

    // Add achievement list
    if (achievements.length > 0) {
      const achievementList = achievements.slice(0, 10)
        .map((achievement: any) => {
          const badge = formatAchievementBadge(achievement);
          const date = `<t:${Math.floor(achievement.unlockedAt.getTime() / 1000)}:R>`;
          return `${badge} - ${date}`;
        })
        .join("\n");

      embed.addFields({
        name: "🎖️ Your Achievements",
        value: achievementList,
        inline: false
      });

      if (achievements.length > 10) {
        embed.addFields({
          name: "📈 And More!",
          value: `You have ${achievements.length - 10} more achievements! Use \`/pip_achievements\` to see them all.`,
          inline: false
        });
      }
    } else {
      embed.addFields({
        name: "🎯 Start Your Journey",
        value: "You haven't unlocked any achievements yet. Start playing matches, tipping friends, and engaging with the community to earn achievements!",
        inline: false
      });
    }

    // Add buttons for quick actions
    const buttons = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("pip:refresh_achievements")
          .setLabel("🔄 Refresh")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("pip:dismiss_profile")
          .setLabel("❌ Dismiss")
          .setStyle(ButtonStyle.Secondary)
      );

    await i.editReply({
      embeds: [embed],
      components: [buttons]
    });

  } catch (error: any) {
    console.error("Error viewing own achievements:", error);
    await i.editReply({
      content: `❌ Error loading your achievements: ${error?.message || "Unknown error"}`
    }).catch(() => {});
  }
}