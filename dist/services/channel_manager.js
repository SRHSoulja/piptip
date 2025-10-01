import { prisma } from "./db.js";
const DEFAULT_SETTINGS = {
  channelMode: "ALLOW_ALL",
  allowedChannels: [],
  blockedChannels: [],
  tipChannels: [],
  gameChannels: [],
  announcementChannel: void 0,
  perChannelCooldowns: {},
  featureRestrictions: {},
  autoSuggestChannels: true
};
const settingsCache = /* @__PURE__ */ new Map();
const CACHE_TTL = 5 * 60 * 1e3;
const cacheTimestamps = /* @__PURE__ */ new Map();
async function getGuildSettings(guildId) {
  const cached = settingsCache.get(guildId);
  const cacheTime = cacheTimestamps.get(guildId);
  if (cached && cacheTime && Date.now() - cacheTime < CACHE_TTL) {
    return cached;
  }
  try {
    const dbSettings = await prisma.guildSettings.findUnique({
      where: { guildId }
    });
    let settings;
    if (dbSettings) {
      settings = {
        guildId,
        channelMode: dbSettings.channelMode,
        allowedChannels: Array.isArray(dbSettings.allowedChannels) ? dbSettings.allowedChannels : [],
        blockedChannels: Array.isArray(dbSettings.blockedChannels) ? dbSettings.blockedChannels : [],
        tipChannels: Array.isArray(dbSettings.tipChannels) ? dbSettings.tipChannels : [],
        gameChannels: Array.isArray(dbSettings.gameChannels) ? dbSettings.gameChannels : [],
        announcementChannel: dbSettings.announcementChannel || void 0,
        perChannelCooldowns: typeof dbSettings.perChannelCooldowns === "object" ? dbSettings.perChannelCooldowns : {},
        featureRestrictions: typeof dbSettings.featureRestrictions === "object" ? dbSettings.featureRestrictions : {},
        autoSuggestChannels: dbSettings.autoSuggestChannels
      };
    } else {
      settings = { guildId, ...DEFAULT_SETTINGS };
      await createGuildSettings(guildId, settings);
    }
    settingsCache.set(guildId, settings);
    cacheTimestamps.set(guildId, Date.now());
    return settings;
  } catch (error) {
    console.error("Error fetching guild settings:", error);
    return { guildId, ...DEFAULT_SETTINGS };
  }
}
async function updateGuildSettings(guildId, updates) {
  try {
    await prisma.guildSettings.upsert({
      where: { guildId },
      update: {
        channelMode: updates.channelMode,
        allowedChannels: updates.allowedChannels,
        blockedChannels: updates.blockedChannels,
        tipChannels: updates.tipChannels,
        gameChannels: updates.gameChannels,
        announcementChannel: updates.announcementChannel,
        perChannelCooldowns: updates.perChannelCooldowns,
        featureRestrictions: updates.featureRestrictions,
        autoSuggestChannels: updates.autoSuggestChannels,
        updatedAt: /* @__PURE__ */ new Date()
      },
      create: {
        guildId,
        channelMode: updates.channelMode || "ALLOW_ALL",
        allowedChannels: updates.allowedChannels || [],
        blockedChannels: updates.blockedChannels || [],
        tipChannels: updates.tipChannels || [],
        gameChannels: updates.gameChannels || [],
        announcementChannel: updates.announcementChannel,
        perChannelCooldowns: updates.perChannelCooldowns || {},
        featureRestrictions: updates.featureRestrictions || {},
        autoSuggestChannels: updates.autoSuggestChannels ?? true
      }
    });
    settingsCache.delete(guildId);
    cacheTimestamps.delete(guildId);
  } catch (error) {
    console.error("Error updating guild settings:", error);
    throw error;
  }
}
async function createGuildSettings(guildId, settings) {
  try {
    await prisma.guildSettings.create({
      data: {
        guildId,
        channelMode: settings.channelMode,
        allowedChannels: settings.allowedChannels,
        blockedChannels: settings.blockedChannels,
        tipChannels: settings.tipChannels,
        gameChannels: settings.gameChannels,
        announcementChannel: settings.announcementChannel,
        perChannelCooldowns: settings.perChannelCooldowns,
        featureRestrictions: settings.featureRestrictions,
        autoSuggestChannels: settings.autoSuggestChannels
      }
    });
  } catch (error) {
    if (error.code !== "P2002") {
      console.error("Error creating guild settings:", error);
    }
  }
}
async function checkChannelPermissions(interaction, commandCategory = "general") {
  if (!interaction.guildId || !interaction.channelId) {
    return { allowed: true };
  }
  const settings = await getGuildSettings(interaction.guildId);
  const featureChannels = settings.featureRestrictions[commandCategory];
  if (featureChannels && featureChannels.length > 0) {
    if (!featureChannels.includes(interaction.channelId)) {
      return {
        allowed: false,
        reason: `${commandCategory} commands are restricted to specific channels`,
        suggestedChannels: featureChannels
      };
    }
  }
  if (commandCategory === "tip" && settings.tipChannels.length > 0) {
    if (!settings.tipChannels.includes(interaction.channelId)) {
      return {
        allowed: false,
        reason: "Tip commands are restricted to specific channels",
        suggestedChannels: settings.tipChannels
      };
    }
  }
  if (commandCategory === "game" && settings.gameChannels.length > 0) {
    if (!settings.gameChannels.includes(interaction.channelId)) {
      return {
        allowed: false,
        reason: "Game commands are restricted to specific channels",
        suggestedChannels: settings.gameChannels
      };
    }
  }
  switch (settings.channelMode) {
    case "WHITELIST":
      if (settings.allowedChannels.length > 0 && !settings.allowedChannels.includes(interaction.channelId)) {
        return {
          allowed: false,
          reason: "Commands are only allowed in whitelisted channels",
          suggestedChannels: settings.allowedChannels
        };
      }
      break;
    case "BLACKLIST":
      if (settings.blockedChannels.includes(interaction.channelId)) {
        return {
          allowed: false,
          reason: "Commands are blocked in this channel"
        };
      }
      break;
    case "ALLOW_ALL":
    default:
      if (settings.blockedChannels.includes(interaction.channelId)) {
        return {
          allowed: false,
          reason: "Commands are blocked in this channel"
        };
      }
      break;
  }
  return { allowed: true };
}
async function logChannelActivity(guildId, channelId, commandType, commandName, userId, success = true) {
  try {
    await prisma.channelActivity.create({
      data: {
        guildId,
        channelId,
        commandType,
        commandName,
        userId,
        success,
        timestamp: /* @__PURE__ */ new Date()
      }
    });
  } catch (error) {
    console.error("Error logging channel activity:", error);
  }
}
async function getChannelActivity(guildId, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1e3);
  try {
    const activities = await prisma.channelActivity.findMany({
      where: {
        guildId,
        timestamp: { gte: since }
      },
      orderBy: { timestamp: "desc" }
    });
    const channelStats = {};
    const commandCounts = {};
    for (const activity of activities) {
      if (!channelStats[activity.channelId]) {
        channelStats[activity.channelId] = { count: 0, success: 0, commandTypes: {} };
      }
      channelStats[activity.channelId].count++;
      if (activity.success) channelStats[activity.channelId].success++;
      if (!channelStats[activity.channelId].commandTypes[activity.commandType]) {
        channelStats[activity.channelId].commandTypes[activity.commandType] = 0;
      }
      channelStats[activity.channelId].commandTypes[activity.commandType]++;
      commandCounts[activity.commandName] = (commandCounts[activity.commandName] || 0) + 1;
    }
    const popularCommands = Object.entries(commandCounts).map(([command, count]) => ({ command, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    return {
      totalCommands: activities.length,
      channelStats,
      popularCommands
    };
  } catch (error) {
    console.error("Error getting channel activity:", error);
    return { totalCommands: 0, channelStats: {}, popularCommands: [] };
  }
}
async function suggestChannelsForGuild(guild) {
  const suggested = [];
  const autoCreate = [];
  const botKeywords = ["bot", "command", "spam"];
  const gameKeywords = ["game", "gaming", "play", "battle", "pip"];
  const tipKeywords = ["tip", "economy", "money", "coin", "token"];
  const generalKeywords = ["general", "main", "chat"];
  guild.channels.cache.forEach((channel) => {
    if (!channel.isTextBased()) return;
    const name = channel.name.toLowerCase();
    if (botKeywords.some((word) => name.includes(word))) {
      suggested.push({
        id: channel.id,
        name: channel.name,
        reason: "Bot commands channel"
      });
    } else if (gameKeywords.some((word) => name.includes(word))) {
      suggested.push({
        id: channel.id,
        name: channel.name,
        reason: "Gaming channel"
      });
    } else if (tipKeywords.some((word) => name.includes(word))) {
      suggested.push({
        id: channel.id,
        name: channel.name,
        reason: "Economy/tipping channel"
      });
    } else if (generalKeywords.some((word) => name.includes(word))) {
      suggested.push({
        id: channel.id,
        name: channel.name,
        reason: "General chat"
      });
    }
  });
  if (suggested.length === 0) {
    autoCreate.push({
      name: "piptip",
      type: "text",
      reason: "Dedicated PIPTip channel for all commands"
    });
  } else if (!suggested.some((s) => s.reason.includes("Bot") || s.reason.includes("Gaming"))) {
    autoCreate.push({
      name: "pip-games",
      type: "text",
      reason: "Dedicated channel for PIPTip games"
    });
  }
  return { suggested, autoCreate };
}
function invalidateGuildCache(guildId) {
  settingsCache.delete(guildId);
  cacheTimestamps.delete(guildId);
}
export {
  checkChannelPermissions,
  getChannelActivity,
  getGuildSettings,
  invalidateGuildCache,
  logChannelActivity,
  suggestChannelsForGuild,
  updateGuildSettings
};
//# sourceMappingURL=channel_manager.js.map
