// src/web/admin/channels.ts - Channel management admin interface
import { Router } from "express";
import { prisma } from "../../services/db.js";
import { getDiscordClient, fetchMultipleServernames } from "../../services/discord_users.js";
import { getGuildSettings, updateGuildSettings, getChannelActivity } from "../../services/channel_manager.js";
export const channelsRouter = Router();
// Get all guild settings with server names
channelsRouter.get("/channels", async (_req, res) => {
    try {
        const settings = await prisma.guildSettings.findMany({
            orderBy: { createdAt: "desc" }
        });
        // Fetch Discord server names
        const client = getDiscordClient();
        const guildIds = settings.map(s => s.guildId);
        let servernames = new Map();
        if (client) {
            try {
                servernames = await fetchMultipleServernames(client, guildIds);
                console.log(`Fetched ${servernames.size} server names for channel admin`);
            }
            catch (error) {
                console.error("Failed to fetch server names:", error);
            }
        }
        // Enrich settings with server names and parse JSON fields
        const enrichedSettings = settings.map(setting => ({
            ...setting,
            servername: servernames.get(setting.guildId) || `Server#${setting.guildId.slice(-4)}`,
            allowedChannels: Array.isArray(setting.allowedChannels) ? setting.allowedChannels : [],
            blockedChannels: Array.isArray(setting.blockedChannels) ? setting.blockedChannels : [],
            tipChannels: Array.isArray(setting.tipChannels) ? setting.tipChannels : [],
            gameChannels: Array.isArray(setting.gameChannels) ? setting.gameChannels : [],
            perChannelCooldowns: typeof setting.perChannelCooldowns === 'object' ? setting.perChannelCooldowns : {},
            featureRestrictions: typeof setting.featureRestrictions === 'object' ? setting.featureRestrictions : {}
        }));
        res.json({ ok: true, settings: enrichedSettings });
    }
    catch (error) {
        console.error("Failed to fetch channel settings:", error);
        res.status(500).json({ ok: false, error: "Failed to fetch channel settings" });
    }
});
// Get specific guild settings
channelsRouter.get("/channels/:guildId", async (req, res) => {
    try {
        const { guildId } = req.params;
        if (!guildId || !/^[0-9]+$/.test(guildId)) {
            return res.status(400).json({ ok: false, error: "Valid guild ID is required" });
        }
        const settings = await getGuildSettings(guildId);
        // Fetch server name
        const client = getDiscordClient();
        let servername = `Server#${guildId.slice(-4)}`;
        if (client) {
            try {
                const servernames = await fetchMultipleServernames(client, [guildId]);
                servername = servernames.get(guildId) || servername;
            }
            catch (error) {
                console.error("Failed to fetch server name:", error);
            }
        }
        res.json({
            ok: true,
            settings: {
                ...settings,
                servername
            }
        });
    }
    catch (error) {
        console.error("Failed to fetch guild settings:", error);
        res.status(500).json({ ok: false, error: "Failed to fetch guild settings" });
    }
});
// Update guild settings
channelsRouter.put("/channels/:guildId", async (req, res) => {
    try {
        const { guildId } = req.params;
        if (!guildId || !/^[0-9]+$/.test(guildId)) {
            return res.status(400).json({ ok: false, error: "Valid guild ID is required" });
        }
        const updateData = req.body;
        // Validate update data
        if (updateData.channelMode && !['ALLOW_ALL', 'WHITELIST', 'BLACKLIST'].includes(updateData.channelMode)) {
            return res.status(400).json({ ok: false, error: "Invalid channel mode" });
        }
        const updatedSettings = await updateGuildSettings(guildId, updateData);
        res.json({ ok: true, settings: updatedSettings });
    }
    catch (error) {
        console.error("Failed to update guild settings:", error);
        res.status(500).json({ ok: false, error: "Failed to update guild settings" });
    }
});
// Reset guild settings to defaults
channelsRouter.post("/channels/:guildId/reset", async (req, res) => {
    try {
        const { guildId } = req.params;
        if (!guildId || !/^[0-9]+$/.test(guildId)) {
            return res.status(400).json({ ok: false, error: "Valid guild ID is required" });
        }
        const defaultSettings = {
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
        const resetSettings = await updateGuildSettings(guildId, defaultSettings);
        res.json({ ok: true, settings: resetSettings, message: "Guild settings reset to defaults" });
    }
    catch (error) {
        console.error("Failed to reset guild settings:", error);
        res.status(500).json({ ok: false, error: "Failed to reset guild settings" });
    }
});
// Get channel activity for a guild
channelsRouter.get("/channels/:guildId/activity", async (req, res) => {
    try {
        const { guildId } = req.params;
        const hours = parseInt(req.query.hours) || 24;
        if (!guildId || !/^[0-9]+$/.test(guildId)) {
            return res.status(400).json({ ok: false, error: "Valid guild ID is required" });
        }
        if (hours < 1 || hours > 168) {
            return res.status(400).json({ ok: false, error: "Hours must be between 1 and 168" });
        }
        const activity = await getChannelActivity(guildId, hours);
        res.json({ ok: true, activity });
    }
    catch (error) {
        console.error("Failed to fetch channel activity:", error);
        res.status(500).json({ ok: false, error: "Failed to fetch channel activity" });
    }
});
// Get aggregated channel statistics across all guilds
channelsRouter.get("/channels/stats/overview", async (_req, res) => {
    try {
        const [totalSettings, settingsByMode, recentActivity] = await Promise.all([
            prisma.guildSettings.count(),
            prisma.guildSettings.groupBy({
                by: ['channelMode'],
                _count: true
            }),
            prisma.channelActivity.count({
                where: {
                    timestamp: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
                    }
                }
            })
        ]);
        const modeStats = settingsByMode.reduce((acc, item) => {
            acc[item.channelMode] = item._count;
            return acc;
        }, {});
        res.json({
            ok: true,
            stats: {
                totalGuilds: totalSettings,
                settingsByMode: modeStats,
                recentActivity: recentActivity,
                lastUpdated: new Date()
            }
        });
    }
    catch (error) {
        console.error("Failed to fetch channel overview stats:", error);
        res.status(500).json({ ok: false, error: "Failed to fetch overview stats" });
    }
});
// Get most active guilds by command usage
channelsRouter.get("/channels/stats/most-active", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const hours = parseInt(req.query.hours) || 24;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        const activityData = await prisma.channelActivity.groupBy({
            by: ['guildId'],
            where: {
                timestamp: { gte: since }
            },
            _count: {
                id: true
            },
            orderBy: {
                _count: {
                    id: 'desc'
                }
            },
            take: limit
        });
        // Fetch server names for the most active guilds
        const client = getDiscordClient();
        const guildIds = activityData.map(item => item.guildId);
        let servernames = new Map();
        if (client) {
            try {
                servernames = await fetchMultipleServernames(client, guildIds);
            }
            catch (error) {
                console.error("Failed to fetch server names:", error);
            }
        }
        const enrichedData = activityData.map(item => ({
            guildId: item.guildId,
            servername: servernames.get(item.guildId) || `Server#${item.guildId.slice(-4)}`,
            totalCommands: item._count.id || 0,
            activityCount: item._count.id || 0
        }));
        res.json({ ok: true, mostActive: enrichedData });
    }
    catch (error) {
        console.error("Failed to fetch most active guilds:", error);
        res.status(500).json({ ok: false, error: "Failed to fetch most active guilds" });
    }
});
// Bulk operations for channel settings
channelsRouter.post("/channels/bulk/update-mode", async (req, res) => {
    try {
        const { guildIds, channelMode } = req.body;
        if (!Array.isArray(guildIds) || guildIds.length === 0) {
            return res.status(400).json({ ok: false, error: "Guild IDs array is required" });
        }
        if (!['ALLOW_ALL', 'WHITELIST', 'BLACKLIST'].includes(channelMode)) {
            return res.status(400).json({ ok: false, error: "Invalid channel mode" });
        }
        // Validate all guild IDs
        for (const guildId of guildIds) {
            if (!guildId || !/^[0-9]+$/.test(guildId)) {
                return res.status(400).json({ ok: false, error: `Invalid guild ID: ${guildId}` });
            }
        }
        const updated = await prisma.guildSettings.updateMany({
            where: {
                guildId: {
                    in: guildIds
                }
            },
            data: {
                channelMode
            }
        });
        res.json({
            ok: true,
            updated: updated.count,
            message: `Updated channel mode to ${channelMode} for ${updated.count} guilds`
        });
    }
    catch (error) {
        console.error("Failed to bulk update channel mode:", error);
        res.status(500).json({ ok: false, error: "Failed to bulk update channel mode" });
    }
});
// Get channel restrictions summary for a guild
channelsRouter.get("/channels/:guildId/summary", async (req, res) => {
    try {
        const { guildId } = req.params;
        if (!guildId || !/^[0-9]+$/.test(guildId)) {
            return res.status(400).json({ ok: false, error: "Valid guild ID is required" });
        }
        const settings = await getGuildSettings(guildId);
        // Calculate summary statistics
        const summary = {
            mode: settings.channelMode,
            totalRestrictions: settings.allowedChannels.length + settings.blockedChannels.length,
            allowedChannels: settings.allowedChannels.length,
            blockedChannels: settings.blockedChannels.length,
            tipChannels: settings.tipChannels.length,
            gameChannels: settings.gameChannels.length,
            hasAnnouncementChannel: !!settings.announcementChannel,
            cooldownsConfigured: Object.keys(settings.perChannelCooldowns || {}).length,
            featureRestrictionsCount: Object.keys(settings.featureRestrictions || {}).length,
            autoSuggestEnabled: settings.autoSuggestChannels
        };
        res.json({ ok: true, summary });
    }
    catch (error) {
        console.error("Failed to get channel summary:", error);
        res.status(500).json({ ok: false, error: "Failed to get channel summary" });
    }
});
