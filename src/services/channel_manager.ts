// src/services/channel_manager.ts - Channel management and restriction system
import { prisma } from "./db.js";
import type { Guild, GuildChannel, TextChannel, ChatInputCommandInteraction } from "discord.js";

export interface GuildChannelSettings {
  guildId: string;
  channelMode: 'ALLOW_ALL' | 'WHITELIST' | 'BLACKLIST';
  allowedChannels: string[];
  blockedChannels: string[];
  tipChannels: string[];
  gameChannels: string[];
  announcementChannel?: string;
  perChannelCooldowns: Record<string, number>;
  featureRestrictions: Record<string, string[]>;
  autoSuggestChannels: boolean;
}

const DEFAULT_SETTINGS: Omit<GuildChannelSettings, 'guildId'> = {
  channelMode: 'ALLOW_ALL',
  allowedChannels: [],
  blockedChannels: [],
  tipChannels: [],
  gameChannels: [],
  announcementChannel: undefined,
  perChannelCooldowns: {},
  featureRestrictions: {},
  autoSuggestChannels: true
};

// Cache for guild settings
const settingsCache = new Map<string, GuildChannelSettings>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = new Map<string, number>();

export async function getGuildSettings(guildId: string): Promise<GuildChannelSettings> {
  // Check cache first
  const cached = settingsCache.get(guildId);
  const cacheTime = cacheTimestamps.get(guildId);

  if (cached && cacheTime && Date.now() - cacheTime < CACHE_TTL) {
    return cached;
  }

  try {
    const dbSettings = await prisma.guildSettings.findUnique({
      where: { guildId }
    });

    let settings: GuildChannelSettings;

    if (dbSettings) {
      settings = {
        guildId,
        channelMode: dbSettings.channelMode as any,
        allowedChannels: Array.isArray(dbSettings.allowedChannels) ? dbSettings.allowedChannels as string[] : [],
        blockedChannels: Array.isArray(dbSettings.blockedChannels) ? dbSettings.blockedChannels as string[] : [],
        tipChannels: Array.isArray(dbSettings.tipChannels) ? dbSettings.tipChannels as string[] : [],
        gameChannels: Array.isArray(dbSettings.gameChannels) ? dbSettings.gameChannels as string[] : [],
        announcementChannel: dbSettings.announcementChannel || undefined,
        perChannelCooldowns: typeof dbSettings.perChannelCooldowns === 'object' ? dbSettings.perChannelCooldowns as any : {},
        featureRestrictions: typeof dbSettings.featureRestrictions === 'object' ? dbSettings.featureRestrictions as any : {},
        autoSuggestChannels: dbSettings.autoSuggestChannels
      };
    } else {
      // Create default settings
      settings = { guildId, ...DEFAULT_SETTINGS };
      await createGuildSettings(guildId, settings);
    }

    // Update cache
    settingsCache.set(guildId, settings);
    cacheTimestamps.set(guildId, Date.now());

    return settings;
  } catch (error) {
    console.error("Error fetching guild settings:", error);
    return { guildId, ...DEFAULT_SETTINGS };
  }
}

export async function updateGuildSettings(guildId: string, updates: Partial<GuildChannelSettings>): Promise<void> {
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
        updatedAt: new Date()
      },
      create: {
        guildId,
        channelMode: updates.channelMode || 'ALLOW_ALL',
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

    // Clear cache
    settingsCache.delete(guildId);
    cacheTimestamps.delete(guildId);
  } catch (error) {
    console.error("Error updating guild settings:", error);
    throw error;
  }
}

async function createGuildSettings(guildId: string, settings: GuildChannelSettings): Promise<void> {
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
    // Ignore duplicate key errors
    if ((error as any).code !== 'P2002') {
      console.error("Error creating guild settings:", error);
    }
  }
}

export type CommandCategory = 'tip' | 'game' | 'profile' | 'admin' | 'general';

export async function checkChannelPermissions(
  interaction: ChatInputCommandInteraction,
  commandCategory: CommandCategory = 'general'
): Promise<{ allowed: boolean; reason?: string; suggestedChannels?: string[] }> {
  if (!interaction.guildId || !interaction.channelId) {
    return { allowed: true }; // DMs are always allowed
  }

  const settings = await getGuildSettings(interaction.guildId);

  // Feature-specific channel restrictions
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

  // Category-specific channels (legacy support)
  if (commandCategory === 'tip' && settings.tipChannels.length > 0) {
    if (!settings.tipChannels.includes(interaction.channelId)) {
      return {
        allowed: false,
        reason: "Tip commands are restricted to specific channels",
        suggestedChannels: settings.tipChannels
      };
    }
  }

  if (commandCategory === 'game' && settings.gameChannels.length > 0) {
    if (!settings.gameChannels.includes(interaction.channelId)) {
      return {
        allowed: false,
        reason: "Game commands are restricted to specific channels",
        suggestedChannels: settings.gameChannels
      };
    }
  }

  // General channel mode restrictions
  switch (settings.channelMode) {
    case 'WHITELIST':
      if (settings.allowedChannels.length > 0 && !settings.allowedChannels.includes(interaction.channelId)) {
        return {
          allowed: false,
          reason: "Commands are only allowed in whitelisted channels",
          suggestedChannels: settings.allowedChannels
        };
      }
      break;

    case 'BLACKLIST':
      if (settings.blockedChannels.includes(interaction.channelId)) {
        return {
          allowed: false,
          reason: "Commands are blocked in this channel"
        };
      }
      break;

    case 'ALLOW_ALL':
    default:
      // Check if specifically blocked
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

export async function logChannelActivity(
  guildId: string,
  channelId: string,
  commandType: CommandCategory,
  commandName: string,
  userId: string,
  success: boolean = true
): Promise<void> {
  try {
    await prisma.channelActivity.create({
      data: {
        guildId,
        channelId,
        commandType,
        commandName,
        userId,
        success,
        timestamp: new Date()
      }
    });
  } catch (error) {
    console.error("Error logging channel activity:", error);
  }
}

export async function getChannelActivity(guildId: string, hours: number = 24): Promise<{
  totalCommands: number;
  channelStats: Record<string, { count: number; success: number; commandTypes: Record<string, number> }>;
  popularCommands: Array<{ command: string; count: number }>;
}> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  try {
    const activities = await prisma.channelActivity.findMany({
      where: {
        guildId,
        timestamp: { gte: since }
      },
      orderBy: { timestamp: 'desc' }
    });

    const channelStats: Record<string, { count: number; success: number; commandTypes: Record<string, number> }> = {};
    const commandCounts: Record<string, number> = {};

    for (const activity of activities) {
      // Channel stats
      if (!channelStats[activity.channelId]) {
        channelStats[activity.channelId] = { count: 0, success: 0, commandTypes: {} };
      }

      channelStats[activity.channelId].count++;
      if (activity.success) channelStats[activity.channelId].success++;

      if (!channelStats[activity.channelId].commandTypes[activity.commandType]) {
        channelStats[activity.channelId].commandTypes[activity.commandType] = 0;
      }
      channelStats[activity.channelId].commandTypes[activity.commandType]++;

      // Command popularity
      commandCounts[activity.commandName] = (commandCounts[activity.commandName] || 0) + 1;
    }

    const popularCommands = Object.entries(commandCounts)
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

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

export async function suggestChannelsForGuild(guild: Guild): Promise<{
  suggested: Array<{ id: string; name: string; reason: string }>;
  autoCreate: Array<{ name: string; type: string; reason: string }>;
}> {
  const suggested: Array<{ id: string; name: string; reason: string }> = [];
  const autoCreate: Array<{ name: string; type: string; reason: string }> = [];

  // Keywords that suggest PIPTip-friendly channels
  const botKeywords = ['bot', 'command', 'spam'];
  const gameKeywords = ['game', 'gaming', 'play', 'battle', 'pip'];
  const tipKeywords = ['tip', 'economy', 'money', 'coin', 'token'];
  const generalKeywords = ['general', 'main', 'chat'];

  guild.channels.cache.forEach(channel => {
    if (!channel.isTextBased()) return;

    const name = channel.name.toLowerCase();

    // Check for bot-specific channels
    if (botKeywords.some(word => name.includes(word))) {
      suggested.push({
        id: channel.id,
        name: channel.name,
        reason: "Bot commands channel"
      });
    }

    // Check for game channels
    else if (gameKeywords.some(word => name.includes(word))) {
      suggested.push({
        id: channel.id,
        name: channel.name,
        reason: "Gaming channel"
      });
    }

    // Check for economy/tip channels
    else if (tipKeywords.some(word => name.includes(word))) {
      suggested.push({
        id: channel.id,
        name: channel.name,
        reason: "Economy/tipping channel"
      });
    }

    // Check for general channels (lower priority)
    else if (generalKeywords.some(word => name.includes(word))) {
      suggested.push({
        id: channel.id,
        name: channel.name,
        reason: "General chat"
      });
    }
  });

  // Suggest auto-creation if no suitable channels found
  if (suggested.length === 0) {
    autoCreate.push({
      name: "piptip",
      type: "text",
      reason: "Dedicated PIPTip channel for all commands"
    });
  } else if (!suggested.some(s => s.reason.includes("Bot") || s.reason.includes("Gaming"))) {
    autoCreate.push({
      name: "pip-games",
      type: "text",
      reason: "Dedicated channel for PIPTip games"
    });
  }

  return { suggested, autoCreate };
}

export function invalidateGuildCache(guildId: string): void {
  settingsCache.delete(guildId);
  cacheTimestamps.delete(guildId);
}