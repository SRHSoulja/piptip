import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { pipchipsService } from "../services/pipchips_service.js";
import { ensureUser } from "../services/balances.js";
async function pipBalance(i) {
  try {
    await i.deferReply({ ephemeral: true });
    await ensureUser(i.user.id);
    const [balance, streakInfo] = await Promise.all([
      pipchipsService.getUserBalance(i.user.id),
      pipchipsService.getStreakInfo(i.user.id)
    ]);
    const formatNumber = (num) => {
      return num.toLocaleString();
    };
    const embed = new EmbedBuilder().setTitle("\u{1F4B0} Your PIPChips Balance").setColor(3900150).setAuthor({
      name: i.user.displayName,
      iconURL: i.user.displayAvatarURL()
    });
    embed.addFields({
      name: "\u{1F3B0} Current Balance",
      value: `**${formatNumber(balance.balance)}** PIPChips`,
      inline: true
    });
    const streakEmoji = streakInfo.currentStreak >= 7 ? "\u{1F525}" : streakInfo.currentStreak >= 3 ? "\u2B50" : "\u{1F4C5}";
    embed.addFields({
      name: `${streakEmoji} Daily Streak`,
      value: [
        `**Current:** ${streakInfo.currentStreak} days`,
        `**Best:** ${streakInfo.longestStreak} days`,
        `**Multiplier:** ${streakInfo.streakMultiplier}x`
      ].join("\n"),
      inline: true
    });
    embed.addFields({
      name: "\u{1F4CA} Statistics",
      value: [
        `**Total Earned:** ${formatNumber(balance.earnedTotal)}`,
        `**Total Spent:** ${formatNumber(balance.spentTotal)}`,
        `**Total Bought:** ${formatNumber(balance.boughtTotal)}`
      ].join("\n"),
      inline: false
    });
    if (streakInfo.canClaim) {
      embed.addFields({
        name: "\u{1F381} Daily Bonus Available!",
        value: `Claim your daily bonus now to continue your ${streakInfo.currentStreak}-day streak!`,
        inline: false
      });
      embed.setColor(1096065);
    } else {
      const hours = Math.floor(streakInfo.hoursUntilNext);
      const minutes = Math.floor((streakInfo.hoursUntilNext - hours) * 60);
      embed.addFields({
        name: "\u23F0 Next Daily Bonus",
        value: `Available in ${hours}h ${minutes}m`,
        inline: false
      });
    }
    if (balance.lastDaily) {
      embed.setFooter({
        text: `Last daily claimed: ${balance.lastDaily.toLocaleDateString()}`
      });
    } else {
      embed.setFooter({
        text: "Tip: Use /pip_daily to claim your daily bonus!"
      });
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("claim_daily").setLabel(streakInfo.canClaim ? "Claim Daily Bonus" : "Daily Claimed").setStyle(streakInfo.canClaim ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji("\u{1F381}").setDisabled(!streakInfo.canClaim),
      new ButtonBuilder().setCustomId("view_transactions").setLabel("Transaction History").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4CA}"),
      new ButtonBuilder().setCustomId("buy_chips").setLabel("Buy More Chips").setStyle(ButtonStyle.Primary).setEmoji("\u{1F4B0}")
    );
    await i.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    console.error("Balance command error:", error);
    if (i.deferred) {
      await i.editReply({
        content: `\u274C **Error loading balance**
${error?.message || String(error)}`
      });
    } else {
      await i.reply({
        content: `\u274C **Error loading balance**
${error?.message || String(error)}`,
        ephemeral: true
      });
    }
  }
}
export {
  pipBalance as default
};
//# sourceMappingURL=pip_balance.js.map
