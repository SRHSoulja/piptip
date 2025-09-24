// src/interactions/buttons/settings.ts - Settings button handlers
import type { ButtonInteraction, StringSelectMenuInteraction } from "discord.js";
import {
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType
} from "discord.js";
import { getGuildSettings, updateGuildSettings, type GuildChannelSettings } from "../../services/channel_manager.js";

export async function handleSettingsMode(i: ButtonInteraction) {
  const embed = new EmbedBuilder()
    .setTitle("⚙️ Channel Mode Selection")
    .setDescription("Choose how PIPTip should work in your server:")
    .setColor(0x5865F2)
    .addFields(
      {
        name: "🌐 Allow All",
        value: "PIPTip works in all channels (default)\nYou can still block specific channels",
        inline: true
      },
      {
        name: "✅ Whitelist",
        value: "PIPTip only works in channels you choose\nMore restrictive, better control",
        inline: true
      },
      {
        name: "🚫 Blacklist",
        value: "PIPTip works everywhere except blocked channels\nUseful for excluding admin channels",
        inline: true
      }
    );

  const modeSelector = new ActionRowBuilder<StringSelectMenuBuilder>()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("pip:select_mode")
        .setPlaceholder("Choose channel mode...")
        .addOptions(
          {
            label: "🌐 Allow All",
            value: "ALLOW_ALL",
            description: "Works in all channels (can block specific ones)"
          },
          {
            label: "✅ Whitelist Mode",
            value: "WHITELIST",
            description: "Only works in channels you specifically allow"
          },
          {
            label: "🚫 Blacklist Mode",
            value: "BLACKLIST",
            description: "Works everywhere except blocked channels"
          }
        )
    );

  await i.update({
    embeds: [embed],
    components: [modeSelector]
  });
}

export async function handleSelectMode(i: StringSelectMenuInteraction) {
  const mode = i.values[0] as 'ALLOW_ALL' | 'WHITELIST' | 'BLACKLIST';

  await updateGuildSettings(i.guildId!, { channelMode: mode });

  const modeNames = {
    'ALLOW_ALL': '🌐 Allow All',
    'WHITELIST': '✅ Whitelist Mode',
    'BLACKLIST': '🚫 Blacklist Mode'
  };

  await i.update({
    content: `✅ **Mode Updated**\n\nChannel mode changed to **${modeNames[mode]}**\n\nUse \`/pip_settings channels\` to configure specific channels.`,
    embeds: [],
    components: []
  });
}

export async function handleSettingsChannels(i: ButtonInteraction) {
  const settings = await getGuildSettings(i.guildId!);

  const embed = new EmbedBuilder()
    .setTitle("📝 Channel Management")
    .setDescription(`Current mode: **${settings.channelMode.replace('_', ' ')}**`)
    .setColor(0x5865F2);

  const actionRow = new ActionRowBuilder<ButtonBuilder>();

  if (settings.channelMode === 'WHITELIST') {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId("pip:add_allowed")
        .setLabel("Add Allowed Channels")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅")
    );

    if (settings.allowedChannels.length > 0) {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId("pip:remove_allowed")
          .setLabel("Remove Allowed")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("❌")
      );
    }
  }

  if (settings.channelMode === 'BLACKLIST' || settings.channelMode === 'ALLOW_ALL') {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId("pip:add_blocked")
        .setLabel("Block Channels")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🚫")
    );

    if (settings.blockedChannels.length > 0) {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId("pip:remove_blocked")
          .setLabel("Unblock Channels")
          .setStyle(ButtonStyle.Success)
          .setEmoji("✅")
      );
    }
  }

  actionRow.addComponents(
    new ButtonBuilder()
      .setCustomId("pip:feature_channels")
      .setLabel("Feature Settings")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🎯")
  );

  await i.update({
    embeds: [embed],
    components: [actionRow]
  });
}

export async function handleAddAllowed(i: ButtonInteraction) {
  const channelSelector = new ActionRowBuilder<ChannelSelectMenuBuilder>()
    .addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("pip:select_allowed")
        .setPlaceholder("Select channels to allow...")
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)
        .setMaxValues(10)
    );

  await i.update({
    content: "📝 **Select Allowed Channels**\n\nChoose which channels PIPTip should work in:",
    components: [channelSelector],
    embeds: []
  });
}

export async function handleAddBlocked(i: ButtonInteraction) {
  const channelSelector = new ActionRowBuilder<ChannelSelectMenuBuilder>()
    .addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("pip:select_blocked")
        .setPlaceholder("Select channels to block...")
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice)
        .setMaxValues(10)
    );

  await i.update({
    content: "🚫 **Select Blocked Channels**\n\nChoose which channels PIPTip should NOT work in:",
    components: [channelSelector],
    embeds: []
  });
}

export async function handleSelectAllowed(i: any) { // ChannelSelectMenuInteraction
  const settings = await getGuildSettings(i.guildId!);
  const newChannels = i.values as string[];

  // Merge with existing allowed channels
  const updatedAllowed = [...new Set([...settings.allowedChannels, ...newChannels])];

  await updateGuildSettings(i.guildId!, { allowedChannels: updatedAllowed });

  const channelMentions = newChannels.map(id => `<#${id}>`).join(", ");

  await i.update({
    content: `✅ **Channels Added**\n\nPIPTip is now allowed in: ${channelMentions}\n\nUse \`/pip_settings channels\` to view all settings.`,
    components: [],
    embeds: []
  });
}

export async function handleSelectBlocked(i: any) { // ChannelSelectMenuInteraction
  const settings = await getGuildSettings(i.guildId!);
  const newChannels = i.values as string[];

  // Merge with existing blocked channels
  const updatedBlocked = [...new Set([...settings.blockedChannels, ...newChannels])];

  await updateGuildSettings(i.guildId!, { blockedChannels: updatedBlocked });

  const channelMentions = newChannels.map(id => `<#${id}>`).join(", ");

  await i.update({
    content: `🚫 **Channels Blocked**\n\nPIPTip is now blocked in: ${channelMentions}\n\nUse \`/pip_settings channels\` to view all settings.`,
    components: [],
    embeds: []
  });
}

export async function handleFeatureChannels(i: ButtonInteraction) {
  const embed = new EmbedBuilder()
    .setTitle("🎯 Feature-Specific Channels")
    .setDescription("Configure which channels specific features can use:")
    .setColor(0x5865F2)
    .addFields(
      {
        name: "💸 Tip Commands",
        value: "Restrict `/pip_tip` to specific channels",
        inline: true
      },
      {
        name: "🎮 Game Commands",
        value: "Restrict `/pip_game` to specific channels",
        inline: true
      },
      {
        name: "📢 Announcements",
        value: "Set a channel for bot announcements",
        inline: true
      }
    );

  const featureRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("pip:config_tips")
        .setLabel("Configure Tips")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("💸"),
      new ButtonBuilder()
        .setCustomId("pip:config_games")
        .setLabel("Configure Games")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🎮"),
      new ButtonBuilder()
        .setCustomId("pip:config_announcements")
        .setLabel("Announcements")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("📢")
    );

  await i.update({
    embeds: [embed],
    components: [featureRow]
  });
}

// Preset handlers
export async function handleSetupEverywhere(i: ButtonInteraction) {
  await updateGuildSettings(i.guildId!, {
    channelMode: 'ALLOW_ALL',
    allowedChannels: [],
    blockedChannels: [],
    tipChannels: [],
    gameChannels: []
  });

  await i.update({
    content: "✅ **Setup Complete - Everywhere Mode**\n\nPIPTip now works in all channels! You can use `/pip_settings` to fine-tune restrictions later.",
    components: [],
    embeds: []
  });
}

export async function handleSetupGaming(i: ButtonInteraction) {
  const guild = i.guild!;
  const gameChannels: string[] = [];
  const tipChannels: string[] = [];

  // Look for gaming-related channels
  guild.channels.cache.forEach(channel => {
    if (!channel.isTextBased()) return;
    const name = channel.name.toLowerCase();

    if (name.includes('game') || name.includes('gaming') || name.includes('play') || name.includes('pip')) {
      gameChannels.push(channel.id);
    }
    if (name.includes('tip') || name.includes('economy') || name.includes('money')) {
      tipChannels.push(channel.id);
    }
  });

  await updateGuildSettings(i.guildId!, {
    channelMode: 'ALLOW_ALL',
    tipChannels: tipChannels.length > 0 ? tipChannels : [],
    gameChannels: gameChannels.length > 0 ? gameChannels : [],
    blockedChannels: []
  });

  let message = "✅ **Gaming Setup Complete**\n\n";

  if (gameChannels.length > 0) {
    message += `🎮 Games restricted to: ${gameChannels.map(id => `<#${id}>`).join(", ")}\n`;
  }
  if (tipChannels.length > 0) {
    message += `💸 Tips restricted to: ${tipChannels.map(id => `<#${id}>`).join(", ")}\n`;
  }
  if (gameChannels.length === 0 && tipChannels.length === 0) {
    message += "No gaming channels detected. Use `/pip_settings` to configure manually.";
  }

  await i.update({
    content: message,
    components: [],
    embeds: []
  });
}

export async function handleSetupStrict(i: ButtonInteraction) {
  const guild = i.guild!;
  let pipChannel = guild.channels.cache.find(c =>
    c.isTextBased() && c.name.toLowerCase().includes('piptip')
  );

  if (!pipChannel) {
    // Look for bot/command channels
    pipChannel = guild.channels.cache.find(c =>
      c.isTextBased() && (
        c.name.toLowerCase().includes('bot') ||
        c.name.toLowerCase().includes('command')
      )
    );
  }

  if (pipChannel) {
    await updateGuildSettings(i.guildId!, {
      channelMode: 'WHITELIST',
      allowedChannels: [pipChannel.id],
      tipChannels: [],
      gameChannels: []
    });

    await i.update({
      content: `✅ **Strict Setup Complete**\n\nPIPTip is now restricted to <#${pipChannel.id}> only.\n\nUse \`/pip_settings\` to add more channels if needed.`,
      components: [],
      embeds: []
    });
  } else {
    await i.update({
      content: "❌ **No suitable channel found**\n\nPlease create a #piptip or #bot-commands channel first, then try again.",
      components: [],
      embeds: []
    });
  }
}