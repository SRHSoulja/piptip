import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType
} from "discord.js";
import { getGuildSettings, updateGuildSettings } from "../../services/channel_manager.js";
async function handleSettingsMode(i) {
  const embed = new EmbedBuilder().setTitle("\u2699\uFE0F Channel Mode Selection").setDescription("Choose how PIPTip should work in your server:").setColor(5793266).addFields(
    {
      name: "\u{1F310} Allow All",
      value: "PIPTip works in all channels (default)\nYou can still block specific channels",
      inline: true
    },
    {
      name: "\u2705 Whitelist",
      value: "PIPTip only works in channels you choose\nMore restrictive, better control",
      inline: true
    },
    {
      name: "\u{1F6AB} Blacklist",
      value: "PIPTip works everywhere except blocked channels\nUseful for excluding admin channels",
      inline: true
    }
  );
  const modeSelector = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId("pip:select_mode").setPlaceholder("Choose channel mode...").addOptions(
      {
        label: "\u{1F310} Allow All",
        value: "ALLOW_ALL",
        description: "Works in all channels (can block specific ones)"
      },
      {
        label: "\u2705 Whitelist Mode",
        value: "WHITELIST",
        description: "Only works in channels you specifically allow"
      },
      {
        label: "\u{1F6AB} Blacklist Mode",
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
async function handleSelectMode(i) {
  const mode = i.values[0];
  await updateGuildSettings(i.guildId, { channelMode: mode });
  const modeNames = {
    "ALLOW_ALL": "\u{1F310} Allow All",
    "WHITELIST": "\u2705 Whitelist Mode",
    "BLACKLIST": "\u{1F6AB} Blacklist Mode"
  };
  await i.update({
    content: `\u2705 **Mode Updated**

Channel mode changed to **${modeNames[mode]}**

Use \`/pip_settings channels\` to configure specific channels.`,
    embeds: [],
    components: []
  });
}
async function handleSettingsChannels(i) {
  const settings = await getGuildSettings(i.guildId);
  const embed = new EmbedBuilder().setTitle("\u{1F4DD} Channel Management").setDescription(`Current mode: **${settings.channelMode.replace("_", " ")}**`).setColor(5793266);
  const actionRow = new ActionRowBuilder();
  if (settings.channelMode === "WHITELIST") {
    actionRow.addComponents(
      new ButtonBuilder().setCustomId("pip:add_allowed").setLabel("Add Allowed Channels").setStyle(ButtonStyle.Success).setEmoji("\u2705")
    );
    if (settings.allowedChannels.length > 0) {
      actionRow.addComponents(
        new ButtonBuilder().setCustomId("pip:remove_allowed").setLabel("Remove Allowed").setStyle(ButtonStyle.Danger).setEmoji("\u274C")
      );
    }
  }
  if (settings.channelMode === "BLACKLIST" || settings.channelMode === "ALLOW_ALL") {
    actionRow.addComponents(
      new ButtonBuilder().setCustomId("pip:add_blocked").setLabel("Block Channels").setStyle(ButtonStyle.Danger).setEmoji("\u{1F6AB}")
    );
    if (settings.blockedChannels.length > 0) {
      actionRow.addComponents(
        new ButtonBuilder().setCustomId("pip:remove_blocked").setLabel("Unblock Channels").setStyle(ButtonStyle.Success).setEmoji("\u2705")
      );
    }
  }
  actionRow.addComponents(
    new ButtonBuilder().setCustomId("pip:feature_channels").setLabel("Feature Settings").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F3AF}")
  );
  await i.update({
    embeds: [embed],
    components: [actionRow]
  });
}
async function handleAddAllowed(i) {
  const channelSelector = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId("pip:select_allowed").setPlaceholder("Select channels to allow...").setChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice).setMaxValues(10)
  );
  await i.update({
    content: "\u{1F4DD} **Select Allowed Channels**\n\nChoose which channels PIPTip should work in:",
    components: [channelSelector],
    embeds: []
  });
}
async function handleAddBlocked(i) {
  const channelSelector = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId("pip:select_blocked").setPlaceholder("Select channels to block...").setChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice).setMaxValues(10)
  );
  await i.update({
    content: "\u{1F6AB} **Select Blocked Channels**\n\nChoose which channels PIPTip should NOT work in:",
    components: [channelSelector],
    embeds: []
  });
}
async function handleSelectAllowed(i) {
  const settings = await getGuildSettings(i.guildId);
  const newChannels = i.values;
  const updatedAllowed = [.../* @__PURE__ */ new Set([...settings.allowedChannels, ...newChannels])];
  await updateGuildSettings(i.guildId, { allowedChannels: updatedAllowed });
  const channelMentions = newChannels.map((id) => `<#${id}>`).join(", ");
  await i.update({
    content: `\u2705 **Channels Added**

PIPTip is now allowed in: ${channelMentions}

Use \`/pip_settings channels\` to view all settings.`,
    components: [],
    embeds: []
  });
}
async function handleSelectBlocked(i) {
  const settings = await getGuildSettings(i.guildId);
  const newChannels = i.values;
  const updatedBlocked = [.../* @__PURE__ */ new Set([...settings.blockedChannels, ...newChannels])];
  await updateGuildSettings(i.guildId, { blockedChannels: updatedBlocked });
  const channelMentions = newChannels.map((id) => `<#${id}>`).join(", ");
  await i.update({
    content: `\u{1F6AB} **Channels Blocked**

PIPTip is now blocked in: ${channelMentions}

Use \`/pip_settings channels\` to view all settings.`,
    components: [],
    embeds: []
  });
}
async function handleFeatureChannels(i) {
  const embed = new EmbedBuilder().setTitle("\u{1F3AF} Feature-Specific Channels").setDescription("Configure which channels specific features can use:").setColor(5793266).addFields(
    {
      name: "\u{1F4B8} Tip Commands",
      value: "Restrict `/pip_tip` to specific channels",
      inline: true
    },
    {
      name: "\u{1F3AE} Game Commands",
      value: "Restrict `/pip_game` to specific channels",
      inline: true
    },
    {
      name: "\u{1F4E2} Announcements",
      value: "Set a channel for bot announcements",
      inline: true
    }
  );
  const featureRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pip:config_tips").setLabel("Configure Tips").setStyle(ButtonStyle.Primary).setEmoji("\u{1F4B8}"),
    new ButtonBuilder().setCustomId("pip:config_games").setLabel("Configure Games").setStyle(ButtonStyle.Primary).setEmoji("\u{1F3AE}"),
    new ButtonBuilder().setCustomId("pip:config_announcements").setLabel("Announcements").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4E2}")
  );
  await i.update({
    embeds: [embed],
    components: [featureRow]
  });
}
async function handleSetupEverywhere(i) {
  await updateGuildSettings(i.guildId, {
    channelMode: "ALLOW_ALL",
    allowedChannels: [],
    blockedChannels: [],
    tipChannels: [],
    gameChannels: []
  });
  await i.update({
    content: "\u2705 **Setup Complete - Everywhere Mode**\n\nPIPTip now works in all channels! You can use `/pip_settings` to fine-tune restrictions later.",
    components: [],
    embeds: []
  });
}
async function handleSetupGaming(i) {
  const guild = i.guild;
  const gameChannels = [];
  const tipChannels = [];
  guild.channels.cache.forEach((channel) => {
    if (!channel.isTextBased()) return;
    const name = channel.name.toLowerCase();
    if (name.includes("game") || name.includes("gaming") || name.includes("play") || name.includes("pip")) {
      gameChannels.push(channel.id);
    }
    if (name.includes("tip") || name.includes("economy") || name.includes("money")) {
      tipChannels.push(channel.id);
    }
  });
  await updateGuildSettings(i.guildId, {
    channelMode: "ALLOW_ALL",
    tipChannels: tipChannels.length > 0 ? tipChannels : [],
    gameChannels: gameChannels.length > 0 ? gameChannels : [],
    blockedChannels: []
  });
  let message = "\u2705 **Gaming Setup Complete**\n\n";
  if (gameChannels.length > 0) {
    message += `\u{1F3AE} Games restricted to: ${gameChannels.map((id) => `<#${id}>`).join(", ")}
`;
  }
  if (tipChannels.length > 0) {
    message += `\u{1F4B8} Tips restricted to: ${tipChannels.map((id) => `<#${id}>`).join(", ")}
`;
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
async function handleSetupStrict(i) {
  const guild = i.guild;
  let pipChannel = guild.channels.cache.find(
    (c) => c.isTextBased() && c.name.toLowerCase().includes("piptip")
  );
  if (!pipChannel) {
    pipChannel = guild.channels.cache.find(
      (c) => c.isTextBased() && (c.name.toLowerCase().includes("bot") || c.name.toLowerCase().includes("command"))
    );
  }
  if (pipChannel) {
    await updateGuildSettings(i.guildId, {
      channelMode: "WHITELIST",
      allowedChannels: [pipChannel.id],
      tipChannels: [],
      gameChannels: []
    });
    await i.update({
      content: `\u2705 **Strict Setup Complete**

PIPTip is now restricted to <#${pipChannel.id}> only.

Use \`/pip_settings\` to add more channels if needed.`,
      components: [],
      embeds: []
    });
  } else {
    await i.update({
      content: "\u274C **No suitable channel found**\n\nPlease create a #piptip or #bot-commands channel first, then try again.",
      components: [],
      embeds: []
    });
  }
}
export {
  handleAddAllowed,
  handleAddBlocked,
  handleFeatureChannels,
  handleSelectAllowed,
  handleSelectBlocked,
  handleSelectMode,
  handleSettingsChannels,
  handleSettingsMode,
  handleSetupEverywhere,
  handleSetupGaming,
  handleSetupStrict
};
//# sourceMappingURL=settings.js.map
