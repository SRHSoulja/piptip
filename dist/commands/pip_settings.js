import {
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import { getGuildSettings, updateGuildSettings, getChannelActivity, suggestChannelsForGuild } from "../services/channel_manager.js";
async function pipSettings(i) {
  try {
    if (!i.guildId) {
      return i.reply({
        content: "\u274C This command can only be used in servers.",
        flags: MessageFlags.Ephemeral
      });
    }
    const member = i.guild?.members.cache.get(i.user.id);
    if (!member || !member.permissions.has("Administrator") && !member.permissions.has("ManageGuild")) {
      return i.reply({
        content: [
          "\u{1F512} **Permission Required**",
          "",
          "You need **Administrator** or **Manage Server** permissions to configure PIPTip settings.",
          "",
          "Ask a server administrator to set up channel restrictions."
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }
    const subcommand = i.options.getSubcommand();
    switch (subcommand) {
      case "channels":
        return handleChannelSettings(i);
      case "setup":
        return handleQuickSetup(i);
      case "activity":
        return handleActivityView(i);
      case "reset":
        return handleReset(i);
      default:
        return handleChannelSettings(i);
    }
  } catch (error) {
    console.error("Settings command error:", error);
    await i.reply({
      content: `\u274C **Error loading settings**
${error?.message || String(error)}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {
    });
  }
}
async function handleChannelSettings(i) {
  const settings = await getGuildSettings(i.guildId);
  const guild = i.guild;
  const allowedChannelNames = settings.allowedChannels.map((id) => guild.channels.cache.get(id)?.name || `#${id}`).slice(0, 5);
  const blockedChannelNames = settings.blockedChannels.map((id) => guild.channels.cache.get(id)?.name || `#${id}`).slice(0, 5);
  const tipChannelNames = settings.tipChannels.map((id) => guild.channels.cache.get(id)?.name || `#${id}`).slice(0, 3);
  const gameChannelNames = settings.gameChannels.map((id) => guild.channels.cache.get(id)?.name || `#${id}`).slice(0, 3);
  const embed = new EmbedBuilder().setTitle("\u2699\uFE0F PIPTip Channel Settings").setDescription([
    `**Current Mode:** ${getModeEmoji(settings.channelMode)} ${settings.channelMode.replace("_", " ")}`,
    "",
    getModeDescription(settings.channelMode)
  ].join("\n")).setColor(5793266).addFields(
    {
      name: "\u{1F4DD} Allowed Channels",
      value: settings.channelMode === "WHITELIST" && allowedChannelNames.length > 0 ? allowedChannelNames.join(", ") + (settings.allowedChannels.length > 5 ? ` +${settings.allowedChannels.length - 5} more` : "") : settings.channelMode === "WHITELIST" ? "No channels configured" : "Not applicable",
      inline: true
    },
    {
      name: "\u{1F6AB} Blocked Channels",
      value: blockedChannelNames.length > 0 ? blockedChannelNames.join(", ") + (settings.blockedChannels.length > 5 ? ` +${settings.blockedChannels.length - 5} more` : "") : "None",
      inline: true
    },
    {
      name: "\u{1F4B8} Tip Channels",
      value: tipChannelNames.length > 0 ? tipChannelNames.join(", ") : "All allowed channels",
      inline: true
    },
    {
      name: "\u{1F3AE} Game Channels",
      value: gameChannelNames.length > 0 ? gameChannelNames.join(", ") : "All allowed channels",
      inline: true
    },
    {
      name: "\u{1F4E2} Announcements",
      value: settings.announcementChannel ? guild.channels.cache.get(settings.announcementChannel)?.name || "Unknown channel" : "No specific channel",
      inline: true
    },
    {
      name: "\u{1F527} Quick Actions",
      value: "Use the buttons below to configure your settings",
      inline: false
    }
  ).setTimestamp();
  const actionRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pip:settings_mode").setLabel("Change Mode").setStyle(ButtonStyle.Primary).setEmoji("\u2699\uFE0F"),
    new ButtonBuilder().setCustomId("pip:settings_channels").setLabel("Manage Channels").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4DD}"),
    new ButtonBuilder().setCustomId("pip:settings_features").setLabel("Feature Settings").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F3AF}")
  );
  const actionRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pip:settings_activity").setLabel("View Activity").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4CA}"),
    new ButtonBuilder().setCustomId("pip:settings_presets").setLabel("Quick Presets").setStyle(ButtonStyle.Secondary).setEmoji("\u26A1"),
    new ButtonBuilder().setCustomId("pip:settings_reset").setLabel("Reset Settings").setStyle(ButtonStyle.Danger).setEmoji("\u{1F5D1}\uFE0F")
  );
  await i.reply({
    embeds: [embed],
    components: [actionRow1, actionRow2],
    flags: MessageFlags.Ephemeral
  });
}
async function handleQuickSetup(i) {
  const guild = i.guild;
  const suggestions = await suggestChannelsForGuild(guild);
  const embed = new EmbedBuilder().setTitle("\u{1F680} Quick Setup Wizard").setDescription("Choose how you'd like PIPTip to work in your server:").setColor(65280);
  const setupRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pip:setup_everywhere").setLabel("\u{1F310} Everywhere").setStyle(ButtonStyle.Success).setEmoji("\u{1F310}"),
    new ButtonBuilder().setCustomId("pip:setup_specific").setLabel("\u{1F4DD} Specific Channels").setStyle(ButtonStyle.Primary).setEmoji("\u{1F4DD}"),
    new ButtonBuilder().setCustomId("pip:setup_exclude").setLabel("\u{1F6AB} Exclude Channels").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F6AB}")
  );
  const presetRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pip:setup_gaming").setLabel("\u{1F3AE} Gaming Setup").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F3AE}"),
    new ButtonBuilder().setCustomId("pip:setup_community").setLabel("\u{1F4AC} Community Setup").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4AC}"),
    new ButtonBuilder().setCustomId("pip:setup_strict").setLabel("\u{1F512} Strict Setup").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F512}")
  );
  if (suggestions.suggested.length > 0) {
    embed.addFields({
      name: "\u{1F4A1} Suggested Channels",
      value: suggestions.suggested.map((s) => `\u2022 **#${s.name}** - ${s.reason}`).slice(0, 5).join("\n"),
      inline: false
    });
  }
  if (suggestions.autoCreate.length > 0) {
    embed.addFields({
      name: "\u26A1 Auto-Create Options",
      value: suggestions.autoCreate.map((s) => `\u2022 **#${s.name}** - ${s.reason}`).join("\n"),
      inline: false
    });
  }
  await i.reply({
    embeds: [embed],
    components: [setupRow, presetRow],
    flags: MessageFlags.Ephemeral
  });
}
async function handleActivityView(i) {
  const hours = i.options.getInteger("hours") || 24;
  const activity = await getChannelActivity(i.guildId, hours);
  const guild = i.guild;
  const channelStats = Object.entries(activity.channelStats).sort(([, a], [, b]) => b.count - a.count).slice(0, 10);
  const embed = new EmbedBuilder().setTitle("\u{1F4CA} Channel Activity Report").setDescription(`Activity over the last ${hours} hours`).setColor(3447003).addFields(
    {
      name: "\u{1F4C8} Summary",
      value: [
        `**Total Commands:** ${activity.totalCommands}`,
        `**Active Channels:** ${Object.keys(activity.channelStats).length}`,
        `**Most Popular:** ${activity.popularCommands[0]?.command || "None"} (${activity.popularCommands[0]?.count || 0} uses)`
      ].join("\n"),
      inline: false
    }
  );
  if (channelStats.length > 0) {
    const channelList = channelStats.map(([channelId, stats]) => {
      const channel = guild.channels.cache.get(channelId);
      const successRate = stats.count > 0 ? Math.round(stats.success / stats.count * 100) : 0;
      return `**#${channel?.name || "Unknown"}** - ${stats.count} commands (${successRate}% success)`;
    }).join("\n");
    embed.addFields({
      name: "\u{1F525} Most Active Channels",
      value: channelList,
      inline: false
    });
  }
  if (activity.popularCommands.length > 0) {
    const commandList = activity.popularCommands.slice(0, 5).map(
      (cmd) => `**${cmd.command}** - ${cmd.count} uses`
    ).join("\n");
    embed.addFields({
      name: "\u2B50 Popular Commands",
      value: commandList,
      inline: false
    });
  }
  const refreshRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pip:activity_refresh").setLabel("\u{1F504} Refresh").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("pip:activity_export").setLabel("\u{1F4CA} Export Data").setStyle(ButtonStyle.Primary)
  );
  await i.reply({
    embeds: [embed],
    components: [refreshRow],
    flags: MessageFlags.Ephemeral
  });
}
async function handleReset(i) {
  await updateGuildSettings(i.guildId, {
    channelMode: "ALLOW_ALL",
    allowedChannels: [],
    blockedChannels: [],
    tipChannels: [],
    gameChannels: [],
    announcementChannel: void 0,
    perChannelCooldowns: {},
    featureRestrictions: {},
    autoSuggestChannels: true
  });
  await i.reply({
    content: "\u2705 **Settings Reset**\n\nAll channel restrictions have been cleared. PIPTip will now work in all channels.",
    flags: MessageFlags.Ephemeral
  });
}
function getModeEmoji(mode) {
  switch (mode) {
    case "ALLOW_ALL":
      return "\u{1F310}";
    case "WHITELIST":
      return "\u2705";
    case "BLACKLIST":
      return "\u{1F6AB}";
    default:
      return "\u2699\uFE0F";
  }
}
function getModeDescription(mode) {
  switch (mode) {
    case "ALLOW_ALL":
      return "PIPTip works in all channels (except those specifically blocked)";
    case "WHITELIST":
      return "PIPTip only works in channels you've specifically allowed";
    case "BLACKLIST":
      return "PIPTip works everywhere except channels you've blocked";
    default:
      return "Unknown mode";
  }
}
export {
  pipSettings as default
};
//# sourceMappingURL=pip_settings.js.map
