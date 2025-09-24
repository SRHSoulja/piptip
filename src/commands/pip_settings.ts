// src/commands/pip_settings.ts - Channel management and server settings
import {
  MessageFlags,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType
} from "discord.js";
import { getGuildSettings, updateGuildSettings, getChannelActivity, suggestChannelsForGuild } from "../services/channel_manager.js";

export default async function pipSettings(i: ChatInputCommandInteraction) {
  try {
    if (!i.guildId) {
      return i.reply({
        content: "❌ This command can only be used in servers.",
        flags: MessageFlags.Ephemeral
      });
    }

    // Check if user has permission to manage settings
    const member = i.guild?.members.cache.get(i.user.id);
    if (!member || (!member.permissions.has("Administrator") && !member.permissions.has("ManageGuild"))) {
      return i.reply({
        content: [
          "🔒 **Permission Required**",
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
      case 'channels':
        return handleChannelSettings(i);
      case 'setup':
        return handleQuickSetup(i);
      case 'activity':
        return handleActivityView(i);
      case 'reset':
        return handleReset(i);
      default:
        return handleChannelSettings(i);
    }

  } catch (error: any) {
    console.error("Settings command error:", error);
    await i.reply({
      content: `❌ **Error loading settings**\n${error?.message || String(error)}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }
}

async function handleChannelSettings(i: ChatInputCommandInteraction) {
  const settings = await getGuildSettings(i.guildId!);
  const guild = i.guild!;

  // Get channel names for display
  const allowedChannelNames = settings.allowedChannels
    .map(id => guild.channels.cache.get(id)?.name || `#${id}`)
    .slice(0, 5);

  const blockedChannelNames = settings.blockedChannels
    .map(id => guild.channels.cache.get(id)?.name || `#${id}`)
    .slice(0, 5);

  const tipChannelNames = settings.tipChannels
    .map(id => guild.channels.cache.get(id)?.name || `#${id}`)
    .slice(0, 3);

  const gameChannelNames = settings.gameChannels
    .map(id => guild.channels.cache.get(id)?.name || `#${id}`)
    .slice(0, 3);

  const embed = new EmbedBuilder()
    .setTitle("⚙️ PIPTip Channel Settings")
    .setDescription([
      `**Current Mode:** ${getModeEmoji(settings.channelMode)} ${settings.channelMode.replace('_', ' ')}`,
      "",
      getModeDescription(settings.channelMode)
    ].join("\n"))
    .setColor(0x5865F2)
    .addFields(
      {
        name: "📝 Allowed Channels",
        value: settings.channelMode === 'WHITELIST' && allowedChannelNames.length > 0
          ? allowedChannelNames.join(", ") + (settings.allowedChannels.length > 5 ? ` +${settings.allowedChannels.length - 5} more` : "")
          : settings.channelMode === 'WHITELIST' ? "No channels configured" : "Not applicable",
        inline: true
      },
      {
        name: "🚫 Blocked Channels",
        value: blockedChannelNames.length > 0
          ? blockedChannelNames.join(", ") + (settings.blockedChannels.length > 5 ? ` +${settings.blockedChannels.length - 5} more` : "")
          : "None",
        inline: true
      },
      {
        name: "💸 Tip Channels",
        value: tipChannelNames.length > 0
          ? tipChannelNames.join(", ")
          : "All allowed channels",
        inline: true
      },
      {
        name: "🎮 Game Channels",
        value: gameChannelNames.length > 0
          ? gameChannelNames.join(", ")
          : "All allowed channels",
        inline: true
      },
      {
        name: "📢 Announcements",
        value: settings.announcementChannel
          ? guild.channels.cache.get(settings.announcementChannel)?.name || "Unknown channel"
          : "No specific channel",
        inline: true
      },
      {
        name: "🔧 Quick Actions",
        value: "Use the buttons below to configure your settings",
        inline: false
      }
    )
    .setTimestamp();

  // Action buttons
  const actionRow1 = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("pip:settings_mode")
        .setLabel("Change Mode")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("⚙️"),
      new ButtonBuilder()
        .setCustomId("pip:settings_channels")
        .setLabel("Manage Channels")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("📝"),
      new ButtonBuilder()
        .setCustomId("pip:settings_features")
        .setLabel("Feature Settings")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🎯")
    );

  const actionRow2 = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("pip:settings_activity")
        .setLabel("View Activity")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("📊"),
      new ButtonBuilder()
        .setCustomId("pip:settings_presets")
        .setLabel("Quick Presets")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("⚡"),
      new ButtonBuilder()
        .setCustomId("pip:settings_reset")
        .setLabel("Reset Settings")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🗑️")
    );

  await i.reply({
    embeds: [embed],
    components: [actionRow1, actionRow2],
    flags: MessageFlags.Ephemeral
  });
}

async function handleQuickSetup(i: ChatInputCommandInteraction) {
  const guild = i.guild!;
  const suggestions = await suggestChannelsForGuild(guild);

  const embed = new EmbedBuilder()
    .setTitle("🚀 Quick Setup Wizard")
    .setDescription("Choose how you'd like PIPTip to work in your server:")
    .setColor(0x00FF00);

  // Setup options
  const setupRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("pip:setup_everywhere")
        .setLabel("🌐 Everywhere")
        .setStyle(ButtonStyle.Success)
        .setEmoji("🌐"),
      new ButtonBuilder()
        .setCustomId("pip:setup_specific")
        .setLabel("📝 Specific Channels")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📝"),
      new ButtonBuilder()
        .setCustomId("pip:setup_exclude")
        .setLabel("🚫 Exclude Channels")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🚫")
    );

  const presetRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("pip:setup_gaming")
        .setLabel("🎮 Gaming Setup")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🎮"),
      new ButtonBuilder()
        .setCustomId("pip:setup_community")
        .setLabel("💬 Community Setup")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("💬"),
      new ButtonBuilder()
        .setCustomId("pip:setup_strict")
        .setLabel("🔒 Strict Setup")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔒")
    );

  if (suggestions.suggested.length > 0) {
    embed.addFields({
      name: "💡 Suggested Channels",
      value: suggestions.suggested.map(s => `• **#${s.name}** - ${s.reason}`).slice(0, 5).join("\n"),
      inline: false
    });
  }

  if (suggestions.autoCreate.length > 0) {
    embed.addFields({
      name: "⚡ Auto-Create Options",
      value: suggestions.autoCreate.map(s => `• **#${s.name}** - ${s.reason}`).join("\n"),
      inline: false
    });
  }

  await i.reply({
    embeds: [embed],
    components: [setupRow, presetRow],
    flags: MessageFlags.Ephemeral
  });
}

async function handleActivityView(i: ChatInputCommandInteraction) {
  const hours = i.options.getInteger('hours') || 24;
  const activity = await getChannelActivity(i.guildId!, hours);

  const guild = i.guild!;

  // Get top channels by activity
  const channelStats = Object.entries(activity.channelStats)
    .sort(([,a], [,b]) => b.count - a.count)
    .slice(0, 10);

  const embed = new EmbedBuilder()
    .setTitle("📊 Channel Activity Report")
    .setDescription(`Activity over the last ${hours} hours`)
    .setColor(0x3498DB)
    .addFields(
      {
        name: "📈 Summary",
        value: [
          `**Total Commands:** ${activity.totalCommands}`,
          `**Active Channels:** ${Object.keys(activity.channelStats).length}`,
          `**Most Popular:** ${activity.popularCommands[0]?.command || 'None'} (${activity.popularCommands[0]?.count || 0} uses)`
        ].join("\n"),
        inline: false
      }
    );

  if (channelStats.length > 0) {
    const channelList = channelStats.map(([channelId, stats]) => {
      const channel = guild.channels.cache.get(channelId);
      const successRate = stats.count > 0 ? Math.round((stats.success / stats.count) * 100) : 0;
      return `**#${channel?.name || 'Unknown'}** - ${stats.count} commands (${successRate}% success)`;
    }).join("\n");

    embed.addFields({
      name: "🔥 Most Active Channels",
      value: channelList,
      inline: false
    });
  }

  if (activity.popularCommands.length > 0) {
    const commandList = activity.popularCommands.slice(0, 5).map(cmd =>
      `**${cmd.command}** - ${cmd.count} uses`
    ).join("\n");

    embed.addFields({
      name: "⭐ Popular Commands",
      value: commandList,
      inline: false
    });
  }

  const refreshRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("pip:activity_refresh")
        .setLabel("🔄 Refresh")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("pip:activity_export")
        .setLabel("📊 Export Data")
        .setStyle(ButtonStyle.Primary)
    );

  await i.reply({
    embeds: [embed],
    components: [refreshRow],
    flags: MessageFlags.Ephemeral
  });
}

async function handleReset(i: ChatInputCommandInteraction) {
  await updateGuildSettings(i.guildId!, {
    channelMode: 'ALLOW_ALL',
    allowedChannels: [],
    blockedChannels: [],
    tipChannels: [],
    gameChannels: [],
    announcementChannel: undefined,
    perChannelCooldowns: {},
    featureRestrictions: {},
    autoSuggestChannels: true
  });

  await i.reply({
    content: "✅ **Settings Reset**\n\nAll channel restrictions have been cleared. PIPTip will now work in all channels.",
    flags: MessageFlags.Ephemeral
  });
}

function getModeEmoji(mode: string): string {
  switch (mode) {
    case 'ALLOW_ALL': return '🌐';
    case 'WHITELIST': return '✅';
    case 'BLACKLIST': return '🚫';
    default: return '⚙️';
  }
}

function getModeDescription(mode: string): string {
  switch (mode) {
    case 'ALLOW_ALL':
      return "PIPTip works in all channels (except those specifically blocked)";
    case 'WHITELIST':
      return "PIPTip only works in channels you've specifically allowed";
    case 'BLACKLIST':
      return "PIPTip works everywhere except channels you've blocked";
    default:
      return "Unknown mode";
  }
}