// src/commands/pip_safety.ts - Responsible gaming and safety controls
import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { responsibleGaming } from "../services/responsible_gaming.js";

export default async function pipSafety(i: ChatInputCommandInteraction) {
  const subcommand = i.options.getSubcommand();

  switch (subcommand) {
    case 'limits':
      return await handleLimits(i);
    case 'exclude':
      return await handleSelfExclusion(i);
    case 'status':
      return await handleStatus(i);
    case 'reminder':
      return await handleReminder(i);
    default:
      await i.reply({
        content: "❌ Unknown subcommand. Use `/pip_safety limits`, `/pip_safety exclude`, `/pip_safety status`, or `/pip_safety reminder`.",
        ephemeral: true
      });
  }
}

async function handleLimits(i: ChatInputCommandInteraction) {
  const maxDailyLoss = i.options.getInteger('max_daily_loss');
  const maxDailyPredictions = i.options.getInteger('max_daily_predictions');

  if (!maxDailyLoss && !maxDailyPredictions) {
    // Show current limits
    const status = await responsibleGaming.getUserStatus(i.user.id);

    const embed = new EmbedBuilder()
      .setTitle("🛡️ Your Prediction Safety Limits")
      .setColor(0x5865F2)
      .addFields(
        {
          name: "📊 Current Daily Limits",
          value: `**Maximum Daily Loss**: ${status.limits.maxDailyLoss} tokens\n` +
                 `**Maximum Daily Predictions**: ${status.limits.maxDailyPredictions} predictions\n` +
                 `**Today's Activity**: ${status.limits.currentDailyPredictions}/${status.limits.maxDailyPredictions} predictions, ${status.limits.currentDailyLoss} tokens at risk`,
          inline: false
        },
        {
          name: "📈 Weekly Statistics",
          value: `**Predictions This Week**: ${status.weeklyStats.predictionsThisWeek}\n` +
                 `**Potential Loss This Week**: ${status.weeklyStats.potentialLossThisWeek} tokens`,
          inline: false
        }
      )
      .setFooter({
        text: "💡 Use /pip_safety limits max_daily_loss:100 to set daily loss limit"
      })
      .setTimestamp();

    const actionRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("pip:safety_exclude_24h")
          .setLabel("🚫 Self-Exclude 24 Hours")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("pip:safety_exclude_7d")
          .setLabel("🛑 Self-Exclude 7 Days")
          .setStyle(ButtonStyle.Danger)
      );

    await i.reply({
      embeds: [embed],
      components: [actionRow],
      ephemeral: true
    });
    return;
  }

  // Update limits
  const result = await responsibleGaming.updateUserLimits(i.user.id, {
    maxDailyLoss,
    maxDailyPredictions
  });

  const embed = new EmbedBuilder()
    .setTitle(result.success ? "✅ Limits Updated" : "❌ Update Failed")
    .setDescription(result.message)
    .setColor(result.success ? 0x00FF00 : 0xFF0000)
    .setTimestamp();

  await i.reply({
    embeds: [embed],
    ephemeral: true
  });
}

async function handleSelfExclusion(i: ChatInputCommandInteraction) {
  const durationHours = i.options.getInteger('duration_hours') || 24; // Default 24 hours

  const result = await responsibleGaming.selfExclude(i.user.id, durationHours);

  const embed = new EmbedBuilder()
    .setTitle(result.success ? "🛡️ Self-Exclusion Activated" : "❌ Self-Exclusion Failed")
    .setDescription(result.message)
    .setColor(result.success ? 0x00FF00 : 0xFF0000)
    .setTimestamp();

  if (result.success) {
    embed.addFields({
      name: "📞 Need Support?",
      value: "**National Problem Gambling Helpline**: 1-800-522-4700\n" +
             "**Online Support**: https://www.ncpgambling.org/\n" +
             "**Crisis Text Line**: Text HOME to 741741",
      inline: false
    });
  }

  await i.reply({
    embeds: [embed],
    ephemeral: true
  });
}

async function handleStatus(i: ChatInputCommandInteraction) {
  const status = await responsibleGaming.getUserStatus(i.user.id);

  const embed = new EmbedBuilder()
    .setTitle("🛡️ Your Prediction Safety Status")
    .setColor(status.limits.selfExcluded ? 0xFF0000 : 0x5865F2)
    .addFields(
      {
        name: "🚫 Exclusion Status",
        value: status.limits.selfExcluded
          ? `**Self-Excluded** until ${status.limits.selfExclusionEnd?.toLocaleDateString() || 'permanently'}`
          : "**Active** - No exclusions",
        inline: false
      },
      {
        name: "📊 Daily Limits & Usage",
        value: `**Loss Limit**: ${status.limits.currentDailyLoss}/${status.limits.maxDailyLoss} tokens\n` +
               `**Prediction Limit**: ${status.limits.currentDailyPredictions}/${status.limits.maxDailyPredictions} predictions`,
        inline: true
      },
      {
        name: "📈 Weekly Activity",
        value: `**Predictions**: ${status.weeklyStats.predictionsThisWeek}\n` +
               `**Potential Loss**: ${status.weeklyStats.potentialLossThisWeek} tokens`,
        inline: true
      }
    )
    .setTimestamp();

  if (status.needsAgeReminder) {
    embed.addFields({
      name: "⚠️ Age Verification Reminder",
      value: "You must be 18+ to participate in predictions. Predictions are for entertainment only.",
      inline: false
    });
  }

  const actionRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("pip:safety_limits")
        .setLabel("⚙️ Set Limits")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("pip:safety_resources")
        .setLabel("📞 Get Help")
        .setStyle(ButtonStyle.Secondary)
    );

  await i.reply({
    embeds: [embed],
    components: [actionRow],
    ephemeral: true
  });
}

async function handleReminder(i: ChatInputCommandInteraction) {
  const reminderMessage = responsibleGaming.generateResponsibleGamingMessage();

  const embed = new EmbedBuilder()
    .setTitle("🛡️ Responsible Gaming")
    .setDescription(reminderMessage)
    .setColor(0x5865F2)
    .setTimestamp();

  await responsibleGaming.recordAgeReminderShown(i.user.id);

  await i.reply({
    embeds: [embed],
    ephemeral: true
  });
}