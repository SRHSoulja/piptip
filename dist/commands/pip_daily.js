import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { pipchipsService } from "../services/pipchips_service.js";
import { ensureUser } from "../services/balances.js";
async function pipDaily(i) {
  try {
    await i.deferReply({ ephemeral: true });
    await ensureUser(i.user.id);
    const streakInfo = await pipchipsService.getStreakInfo(i.user.id);
    if (!streakInfo.canClaim) {
      const hours = Math.floor(streakInfo.hoursUntilNext);
      const minutes = Math.floor((streakInfo.hoursUntilNext - hours) * 60);
      const embed2 = new EmbedBuilder().setTitle("\u23F0 Daily Bonus Already Claimed").setDescription(`You've already claimed your daily bonus today!`).setColor(16096779).addFields(
        {
          name: "\u{1F525} Current Streak",
          value: `${streakInfo.currentStreak} days (${streakInfo.streakMultiplier}x multiplier)`,
          inline: true
        },
        {
          name: "\u23F0 Next Bonus Available",
          value: `${hours}h ${minutes}m`,
          inline: true
        }
      ).setFooter({ text: "Come back tomorrow to continue your streak!" });
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("view_balance").setLabel("View Balance").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4B0}"),
        new ButtonBuilder().setCustomId("buy_chips").setLabel("Buy More Chips").setStyle(ButtonStyle.Primary).setEmoji("\u{1F6D2}")
      );
      return i.editReply({ embeds: [embed2], components: [row2] });
    }
    const claimResult = await pipchipsService.claimDailyBonus(i.user.id);
    const formatNumber = (num) => {
      return num.toLocaleString();
    };
    let streakColor = 1096065;
    let streakEmoji = "\u{1F381}";
    let achievementText = "";
    if (claimResult.newStreak >= 100) {
      streakColor = 9133302;
      streakEmoji = "\u{1F451}";
      achievementText = "**LEGENDARY STREAK!** \u{1F3C6}";
    } else if (claimResult.newStreak >= 30) {
      streakColor = 16096779;
      streakEmoji = "\u{1F947}";
      achievementText = "**GOLD STREAK!** \u2B50";
    } else if (claimResult.newStreak >= 7) {
      streakColor = 15680580;
      streakEmoji = "\u{1F525}";
      achievementText = "**ON FIRE!** \u{1F680}";
    } else if (claimResult.newStreak >= 3) {
      streakColor = 3900150;
      streakEmoji = "\u2B50";
      achievementText = "**Building momentum!** \u{1F4AA}";
    }
    const embed = new EmbedBuilder().setTitle(`${streakEmoji} Daily Bonus Claimed!`).setDescription(achievementText || "Great job staying consistent! \u{1F389}").setColor(streakColor).addFields(
      {
        name: "\u{1F4B0} Bonus Earned",
        value: `**+${formatNumber(claimResult.amount)}** PIPChips`,
        inline: true
      },
      {
        name: "\u{1F525} Streak Bonus",
        value: `${claimResult.newStreak} days (${claimResult.streakMultiplier}x)`,
        inline: true
      },
      {
        name: "\u{1F4B3} New Balance",
        value: `**${formatNumber(claimResult.newBalance)}** PIPChips`,
        inline: false
      }
    );
    if (claimResult.newStreak === 1) {
      embed.addFields({
        name: "\u{1F31F} Welcome Back!",
        value: "Keep claiming daily to build your streak and earn bonus multipliers!",
        inline: false
      });
    } else if ([7, 14, 30, 50, 100].includes(claimResult.newStreak)) {
      const milestoneRewards = {
        7: "\u{1F525} Week warrior! Your multiplier increased!",
        14: "\u{1F48E} Two week champion! You're on a roll!",
        30: "\u{1F947} Monthly master! Gold streak achieved!",
        50: "\u{1F451} Streak royalty! You're unstoppable!",
        100: "\u{1F3C6} LEGENDARY STATUS! Maximum multiplier unlocked!"
      };
      embed.addFields({
        name: "\u{1F38A} Milestone Achievement!",
        value: milestoneRewards[claimResult.newStreak],
        inline: false
      });
    }
    embed.setFooter({
      text: "Come back tomorrow to continue your streak! Use PIPChips to make predictions in the web app."
    });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("view_balance").setLabel("View Full Balance").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4B0}"),
      new ButtonBuilder().setCustomId("web_predictions").setLabel("Make Predictions").setStyle(ButtonStyle.Primary).setEmoji("\u{1F3AF}").setURL(process.env.WEB_URL || "https://piptip.com"),
      // Will need to update this
      new ButtonBuilder().setCustomId("share_streak").setLabel("Share Streak").setStyle(ButtonStyle.Success).setEmoji("\u{1F4E2}")
    );
    await i.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    console.error("Daily command error:", error);
    if (i.deferred) {
      await i.editReply({
        content: `\u274C **Error claiming daily bonus**
${error?.message || String(error)}`
      });
    } else {
      await i.reply({
        content: `\u274C **Error claiming daily bonus**
${error?.message || String(error)}`,
        ephemeral: true
      });
    }
  }
}
export {
  pipDaily as default
};
//# sourceMappingURL=pip_daily.js.map
