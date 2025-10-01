import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { prisma } from "../../services/db.js";
import { getUserAchievements, formatAchievementBadge, getStreakStats, formatStreakText } from "../../services/streaks.js";
async function handleRefreshAchievements(i) {
  try {
    await i.deferUpdate();
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
        content: "\u274C You don't have an account yet! Use `/pip_profile` to get started.",
        embeds: [],
        components: []
      });
    }
    const totalGames = user.wins + user.losses + user.ties;
    const winRate = totalGames > 0 ? (user.wins / totalGames * 100).toFixed(1) : "0.0";
    const embed = new EmbedBuilder().setTitle(`\u{1F3C6} ${i.user.username}'s Achievements`).setColor(16766720).setThumbnail(i.user.displayAvatarURL()).setTimestamp();
    const streakText = formatStreakText(streakStats.currentWins, streakStats.longestWins);
    embed.addFields({
      name: "\u{1F525} Current Status",
      value: [
        streakText,
        `\u{1F4CA} **Win Rate:** ${winRate}% (${user.wins}W-${user.losses}L-${user.ties}T)`,
        `\u{1F4C5} **Member Since:** <t:${Math.floor(user.createdAt.getTime() / 1e3)}:D>`
      ].join("\n"),
      inline: false
    });
    if (achievements.length > 0) {
      const achievementText = achievements.slice(0, 5).map((achievement) => formatAchievementBadge(achievement)).join("\n");
      embed.addFields({
        name: `\u{1F3C6} Recent Achievements (${achievements.length} total)`,
        value: achievementText,
        inline: false
      });
    } else {
      embed.addFields({
        name: "\u{1F3AF} No Achievements Yet",
        value: "Start playing matches and tipping to unlock achievements!",
        inline: false
      });
    }
    await i.editReply({
      embeds: [embed],
      components: i.message.components
      // Keep existing buttons
    });
  } catch (error) {
    console.error("Error refreshing achievements:", error);
    await i.editReply({
      content: `\u274C Error refreshing achievements: ${error?.message || "Unknown error"}`,
      embeds: [],
      components: []
    }).catch(() => {
    });
  }
}
async function handleShowLeaderboard(i) {
  try {
    await i.reply({
      content: "\u{1F3C5} Use `/pip_leaderboard` to view different leaderboard categories!",
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    console.error("Error showing leaderboard:", error);
    await i.reply({
      content: `\u274C Error: ${error?.message || "Unknown error"}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {
    });
  }
}
async function handleViewOwnAchievements(i) {
  try {
    await i.deferReply({ ephemeral: true });
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
        content: "\u274C You don't have an account yet! Use `/pip_profile` to get started."
      });
    }
    const totalGames = user.wins + user.losses + user.ties;
    const winRate = totalGames > 0 ? (user.wins / totalGames * 100).toFixed(1) : "0.0";
    const embed = new EmbedBuilder().setTitle(`\u{1F3C6} Your Achievements`).setColor(16766720).setThumbnail(i.user.displayAvatarURL()).setTimestamp();
    const streakText = formatStreakText(streakStats.currentWins, streakStats.longestWins);
    embed.addFields({
      name: "\u{1F4CA} Your Stats",
      value: [
        streakText,
        `**Win Rate:** ${winRate}% (${user.wins}W-${user.losses}L-${user.ties}T)`,
        `**Total Achievements:** ${achievements.length}`
      ].join("\n"),
      inline: false
    });
    if (achievements.length > 0) {
      const achievementList = achievements.slice(0, 10).map((achievement) => {
        const badge = formatAchievementBadge(achievement);
        const date = `<t:${Math.floor(achievement.unlockedAt.getTime() / 1e3)}:R>`;
        return `${badge} - ${date}`;
      }).join("\n");
      embed.addFields({
        name: "\u{1F396}\uFE0F Your Achievements",
        value: achievementList,
        inline: false
      });
      if (achievements.length > 10) {
        embed.addFields({
          name: "\u{1F4C8} And More!",
          value: `You have ${achievements.length - 10} more achievements! Use \`/pip_achievements\` to see them all.`,
          inline: false
        });
      }
    } else {
      embed.addFields({
        name: "\u{1F3AF} Start Your Journey",
        value: "You haven't unlocked any achievements yet. Start playing matches, tipping friends, and engaging with the community to earn achievements!",
        inline: false
      });
    }
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pip:refresh_achievements").setLabel("\u{1F504} Refresh").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pip:dismiss_profile").setLabel("\u274C Dismiss").setStyle(ButtonStyle.Secondary)
    );
    await i.editReply({
      embeds: [embed],
      components: [buttons]
    });
  } catch (error) {
    console.error("Error viewing own achievements:", error);
    await i.editReply({
      content: `\u274C Error loading your achievements: ${error?.message || "Unknown error"}`
    }).catch(() => {
    });
  }
}
export {
  handleRefreshAchievements,
  handleShowLeaderboard,
  handleViewOwnAchievements
};
//# sourceMappingURL=achievements.js.map
