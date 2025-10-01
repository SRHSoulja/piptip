import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { prisma } from "../services/db.js";
import { getStreakStats, formatStreakText } from "../services/streaks.js";
import { areAchievementsEnabled } from "../services/emergency_controls.js";
import { getUserAchievements, formatAchievementBadge, getAchievementCategoryInfo } from "../services/achievement_display.js";
import { createPenguinError } from "../utils/penguin_messages.js";
async function pipAchievements(i) {
  try {
    if (!await areAchievementsEnabled()) {
      return i.reply({
        content: "\u{1F6AB} Achievement system is temporarily disabled",
        flags: MessageFlags.Ephemeral
      });
    }
    const targetUser = i.options.getUser("user") || i.user;
    if (!targetUser.id.match(/^\d{17,19}$/)) {
      return i.reply({
        content: "\u274C Invalid user ID format",
        flags: MessageFlags.Ephemeral
      });
    }
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
          "You need to join the penguin colony first! Use `/pip_profile` to get started and begin your journey to earning achievement badges! \u{1F427}",
          { personality: "friendly", emoji: "\u{1F427}" }
        ),
        flags: MessageFlags.Ephemeral
      });
    }
    const totalGames = user.wins + user.losses + user.ties;
    const winRate = totalGames > 0 ? (user.wins / totalGames * 100).toFixed(1) : "0.0";
    const embed = new EmbedBuilder().setTitle(`\u{1F3C6} ${targetUser.username}'s Achievements`).setColor(16766720).setThumbnail(targetUser.displayAvatarURL()).setTimestamp();
    const streakText = formatStreakText(streakStats.currentWins, streakStats.longestWins);
    embed.addFields({
      name: "\u{1F525} Current Status",
      value: [
        streakText,
        `\u{1F4CA} **Win Rate:** ${winRate}% (${user.wins}W-${user.losses}L-${user.ties}T)`,
        `\u{1F4C5} **Member Since:** <t:${Math.floor(user.createdAt.getTime() / 1e3)}:D>`,
        `\u{1F3C6} **Total Achievements:** ${achievements.length}`
      ].join("\n"),
      inline: false
    });
    const achievementsByCategory = /* @__PURE__ */ new Map();
    for (const achievement of achievements) {
      const categoryList = achievementsByCategory.get(achievement.category) || [];
      categoryList.push(achievement);
      achievementsByCategory.set(achievement.category, categoryList);
    }
    if (achievements.length > 0) {
      const categoryOrder = ["streaks", "tips", "deposits", "referrals", "veteran", "special"];
      for (const category of categoryOrder) {
        const categoryAchievements = achievementsByCategory.get(category) || [];
        if (categoryAchievements.length > 0) {
          const categoryInfo = getAchievementCategoryInfo(category);
          const badges = categoryAchievements.sort((a, b) => new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime()).slice(0, 4).map((achievement) => {
            const badge = formatAchievementBadge(achievement, true);
            const date = `<t:${Math.floor(new Date(achievement.unlockedAt).getTime() / 1e3)}:R>`;
            return `${badge}
*Unlocked ${date}*`;
          }).join("\n\n");
          const moreCount = categoryAchievements.length > 4 ? categoryAchievements.length - 4 : 0;
          const finalValue = badges + (moreCount > 0 ? `

*+${moreCount} more ${categoryInfo.name.toLowerCase()}*` : "");
          embed.addFields({
            name: `${categoryInfo.emoji} ${categoryInfo.name} (${categoryAchievements.length})`,
            value: finalValue.substring(0, 1024),
            inline: false
          });
        }
      }
      const rarityCount = achievements.reduce((acc, achievement) => {
        acc[achievement.rarity] = (acc[achievement.rarity] || 0) + 1;
        return acc;
      }, {});
      const rarityText = Object.entries(rarityCount).map(([rarity, count]) => {
        const rarityEmojis = {
          common: "\u{1F427}",
          rare: "\u{1F427}\u2728",
          epic: "\u{1F427}\u{1F31F}",
          legendary: "\u{1F427}\u{1F451}"
        };
        const rarityNames = {
          common: "Common Penguins",
          rare: "Rare Penguins",
          epic: "Epic Penguins",
          legendary: "Legendary Penguins"
        };
        return `${rarityEmojis[rarity]} **${count}** ${rarityNames[rarity]}`;
      }).join("\n");
      if (rarityText) {
        embed.addFields({
          name: "\u{1F48E} Penguin Collection",
          value: rarityText,
          inline: false
        });
      }
    } else {
      embed.addFields({
        name: "\u{1F427} Start Your Penguin Journey!",
        value: "\u{1F3AF} **Get started with these activities:**\n\u2022 \u{1F94A} Play Penguin-Ice-Pebble matches\n\u2022 \u{1F41F} Share fish with colony members\n\u2022 \u{1F4B0} Build up your fish reserves\n\u2022 \u{1F465} Invite friends to join the colony\n\n*Your first achievement is just a waddle away!* \u{1F427}\u2728",
        inline: false
      });
    }
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("achievements_refresh").setLabel("\u{1F504} Refresh Achievements").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F427}"),
      new ButtonBuilder().setCustomId("achievements_categories").setLabel("\u{1F4CB} Browse Colony Honors").setStyle(ButtonStyle.Primary).setEmoji("\u{1F3C6}"),
      new ButtonBuilder().setCustomId("achievements_progress").setLabel("\u{1F4CA} View Progress").setStyle(ButtonStyle.Success).setEmoji("\u{1F4C8}")
    );
    await i.reply({
      embeds: [embed],
      components: [buttons]
    });
  } catch (error) {
    console.error("Error in pip_achievements:", error);
    await i.reply({
      content: `\u274C Error loading achievements: ${error?.message || "Unknown error"}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {
    });
  }
}
export {
  pipAchievements as default
};
//# sourceMappingURL=pip_achievements.js.map
