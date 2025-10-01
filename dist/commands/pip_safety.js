import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { responsibleGaming } from "../services/responsible_gaming.js";
async function pipSafety(i) {
  const subcommand = i.options.getSubcommand();
  switch (subcommand) {
    case "limits":
      return await handleLimits(i);
    case "exclude":
      return await handleSelfExclusion(i);
    case "status":
      return await handleStatus(i);
    case "reminder":
      return await handleReminder(i);
    default:
      await i.reply({
        content: "\u274C Unknown subcommand. Use `/pip_safety limits`, `/pip_safety exclude`, `/pip_safety status`, or `/pip_safety reminder`.",
        ephemeral: true
      });
  }
}
async function handleLimits(i) {
  const maxDailyLossInput = i.options.getInteger("max_daily_loss");
  const maxDailyPredictionsInput = i.options.getInteger("max_daily_predictions");
  if (maxDailyLossInput == null && maxDailyPredictionsInput == null) {
    const status = await responsibleGaming.getUserStatus(i.user.id);
    const embed2 = new EmbedBuilder().setTitle("\u{1F6E1}\uFE0F Your Prediction Safety Limits").setColor(5793266).addFields(
      {
        name: "\u{1F4CA} Current Daily Limits",
        value: `**Maximum Daily Loss**: ${status.limits.maxDailyLoss} tokens
**Maximum Daily Predictions**: ${status.limits.maxDailyPredictions} predictions
**Today's Activity**: ${status.limits.currentDailyPredictions}/${status.limits.maxDailyPredictions} predictions, ${status.limits.currentDailyLoss} tokens at risk`,
        inline: false
      },
      {
        name: "\u{1F4C8} Weekly Statistics",
        value: `**Predictions This Week**: ${status.weeklyStats.predictionsThisWeek}
**Potential Loss This Week**: ${status.weeklyStats.potentialLossThisWeek} tokens`,
        inline: false
      }
    ).setFooter({
      text: "\u{1F4A1} Use /pip_safety limits max_daily_loss:100 to set daily loss limit"
    }).setTimestamp();
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pip:safety_exclude_24h").setLabel("\u{1F6AB} Self-Exclude 24 Hours").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pip:safety_exclude_7d").setLabel("\u{1F6D1} Self-Exclude 7 Days").setStyle(ButtonStyle.Danger)
    );
    await i.reply({
      embeds: [embed2],
      components: [actionRow],
      ephemeral: true
    });
    return;
  }
  const result = await responsibleGaming.updateUserLimits(i.user.id, {
    maxDailyLoss: maxDailyLossInput ?? void 0,
    maxDailyPredictions: maxDailyPredictionsInput ?? void 0
  });
  const embed = new EmbedBuilder().setTitle(result.success ? "\u2705 Limits Updated" : "\u274C Update Failed").setDescription(result.message).setColor(result.success ? 65280 : 16711680).setTimestamp();
  await i.reply({
    embeds: [embed],
    ephemeral: true
  });
}
async function handleSelfExclusion(i) {
  const durationHours = i.options.getInteger("duration_hours") || 24;
  const result = await responsibleGaming.selfExclude(i.user.id, durationHours);
  const embed = new EmbedBuilder().setTitle(result.success ? "\u{1F6E1}\uFE0F Self-Exclusion Activated" : "\u274C Self-Exclusion Failed").setDescription(result.message).setColor(result.success ? 65280 : 16711680).setTimestamp();
  if (result.success) {
    embed.addFields({
      name: "\u{1F4DE} Need Support?",
      value: "**National Problem Gambling Helpline**: 1-800-522-4700\n**Online Support**: https://www.ncpgambling.org/\n**Crisis Text Line**: Text HOME to 741741",
      inline: false
    });
  }
  await i.reply({
    embeds: [embed],
    ephemeral: true
  });
}
async function handleStatus(i) {
  const status = await responsibleGaming.getUserStatus(i.user.id);
  const embed = new EmbedBuilder().setTitle("\u{1F6E1}\uFE0F Your Prediction Safety Status").setColor(status.limits.selfExcluded ? 16711680 : 5793266).addFields(
    {
      name: "\u{1F6AB} Exclusion Status",
      value: status.limits.selfExcluded ? `**Self-Excluded** until ${status.limits.selfExclusionEnd?.toLocaleDateString() || "permanently"}` : "**Active** - No exclusions",
      inline: false
    },
    {
      name: "\u{1F4CA} Daily Limits & Usage",
      value: `**Loss Limit**: ${status.limits.currentDailyLoss}/${status.limits.maxDailyLoss} tokens
**Prediction Limit**: ${status.limits.currentDailyPredictions}/${status.limits.maxDailyPredictions} predictions`,
      inline: true
    },
    {
      name: "\u{1F4C8} Weekly Activity",
      value: `**Predictions**: ${status.weeklyStats.predictionsThisWeek}
**Potential Loss**: ${status.weeklyStats.potentialLossThisWeek} tokens`,
      inline: true
    }
  ).setTimestamp();
  if (status.needsAgeReminder) {
    embed.addFields({
      name: "\u26A0\uFE0F Age Verification Reminder",
      value: "You must be 18+ to participate in predictions. Predictions are for entertainment only.",
      inline: false
    });
  }
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pip:safety_limits").setLabel("\u2699\uFE0F Set Limits").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("pip:safety_resources").setLabel("\u{1F4DE} Get Help").setStyle(ButtonStyle.Secondary)
  );
  await i.reply({
    embeds: [embed],
    components: [actionRow],
    ephemeral: true
  });
}
async function handleReminder(i) {
  const reminderMessage = responsibleGaming.generateResponsibleGamingMessage();
  const embed = new EmbedBuilder().setTitle("\u{1F6E1}\uFE0F Responsible Gaming").setDescription(reminderMessage).setColor(5793266).setTimestamp();
  await responsibleGaming.recordAgeReminderShown(i.user.id);
  await i.reply({
    embeds: [embed],
    ephemeral: true
  });
}
export {
  pipSafety as default
};
//# sourceMappingURL=pip_safety.js.map
