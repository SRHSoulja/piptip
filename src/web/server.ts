// src/web/server.ts - Server admin dashboard for Discord server owners/admins
import { Router, Request, Response } from "express";
import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { getGuildSettings, updateGuildSettings, getChannelActivity, type GuildChannelSettings } from "../services/channel_manager.js";
import { getDiscordClient } from "../services/discord_users.js";

export const serverRouter = Router();

// Get current directory for file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper function to verify user has admin permissions in a guild
async function verifyGuildAdmin(discordId: string, accessToken: string, guildId: string): Promise<{ hasPermission: boolean; guildName?: string; userPermissions?: number }> {
  try {
    // Fetch user's guilds from Discord API
    const guildsResponse = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!guildsResponse.ok) {
      console.error("Failed to fetch user guilds:", guildsResponse.status);
      return { hasPermission: false };
    }

    const guilds = await guildsResponse.json();
    const guild = guilds.find((g: any) => g.id === guildId);

    if (!guild) {
      return { hasPermission: false };
    }

    // Check if user has Administrator or Manage Server permissions
    // Administrator = 0x8 (8), Manage Server = 0x20 (32)
    const permissions = parseInt(guild.permissions);
    const hasAdminPerms = (permissions & 0x8) === 0x8 || (permissions & 0x20) === 0x20;

    return {
      hasPermission: hasAdminPerms,
      guildName: guild.name,
      userPermissions: permissions
    };
  } catch (error) {
    console.error("Error verifying guild admin:", error);
    return { hasPermission: false };
  }
}

// Middleware to check if user is logged in
function requireAuth(req: Request, res: Response, next: any) {
  if (!req.session?.discordId || !req.session?.accessToken) {
    return res.redirect(`/auth/discord?redirect=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

// Middleware to verify guild admin permissions
async function requireGuildAdmin(req: Request, res: Response, next: any) {
  const { guildId } = req.params;
  const { discordId, accessToken } = req.session;

  if (!guildId || !/^[0-9]+$/.test(guildId)) {
    return res.status(400).send("Invalid guild ID");
  }

  const verification = await verifyGuildAdmin(discordId!, accessToken!, guildId);

  if (!verification.hasPermission) {
    return res.status(403).send(`
      <h2>Access Denied</h2>
      <p>You don't have administrator permissions in this server.</p>
      <p>You need either <strong>Administrator</strong> or <strong>Manage Server</strong> permissions to access this dashboard.</p>
      <a href="/pengubook">← Back to PenguBook</a>
    `);
  }

  // Store guild info in request for use in routes
  (req as any).guildInfo = verification;
  next();
}

// GET /server/:guildId - Server admin dashboard
serverRouter.get("/:guildId", requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const guildInfo = (req as any).guildInfo;

    // Load the dashboard HTML template
    const htmlPath = join(__dirname, "server", "dashboard.html");
    let html = await readFile(htmlPath, "utf-8");

    // Replace placeholders with actual data
    html = html.replace("{{GUILD_ID}}", guildId);
    html = html.replace("{{GUILD_NAME}}", guildInfo.guildName || `Server ${guildId.slice(-4)}`);
    html = html.replace("{{USER_NAME}}", req.session.username || "User");

    res.send(html);
  } catch (error) {
    console.error("Error loading server dashboard:", error);
    res.status(500).send("Failed to load server dashboard");
  }
});

// API Routes for server admin functionality

// GET /server/:guildId/api/settings - Get server settings
serverRouter.get("/:guildId/api/settings", requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const settings = await getGuildSettings(guildId);
    const guildInfo = (req as any).guildInfo;

    res.json({
      ok: true,
      settings: {
        ...settings,
        guildName: guildInfo.guildName
      }
    });
  } catch (error) {
    console.error("Error fetching server settings:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch server settings" });
  }
});

// PUT /server/:guildId/api/settings - Update server settings
serverRouter.put("/:guildId/api/settings", requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const updateData = req.body as Partial<GuildChannelSettings>;

    // Validate update data
    if (updateData.channelMode && !['ALLOW_ALL', 'WHITELIST', 'BLACKLIST'].includes(updateData.channelMode)) {
      return res.status(400).json({ ok: false, error: "Invalid channel mode" });
    }

    const updatedSettings = await updateGuildSettings(guildId, updateData);

    res.json({ ok: true, settings: updatedSettings });
  } catch (error) {
    console.error("Error updating server settings:", error);
    res.status(500).json({ ok: false, error: "Failed to update server settings" });
  }
});

// POST /server/:guildId/api/settings/reset - Reset server settings
serverRouter.post("/:guildId/api/settings/reset", requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    const defaultSettings: Partial<GuildChannelSettings> = {
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

    res.json({
      ok: true,
      settings: resetSettings,
      message: "Server settings reset to defaults"
    });
  } catch (error) {
    console.error("Error resetting server settings:", error);
    res.status(500).json({ ok: false, error: "Failed to reset server settings" });
  }
});

// GET /server/:guildId/api/activity - Get server activity
serverRouter.get("/:guildId/api/activity", requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const hours = parseInt(req.query.hours as string) || 24;

    if (hours < 1 || hours > 168) {
      return res.status(400).json({ ok: false, error: "Hours must be between 1 and 168" });
    }

    const activity = await getChannelActivity(guildId, hours);

    res.json({ ok: true, activity });
  } catch (error) {
    console.error("Error fetching server activity:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch server activity" });
  }
});

// GET /server/:guildId/api/channels - Get server channels (from Discord API)
serverRouter.get("/:guildId/api/channels", requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;

    // Get channels from Discord bot client (if available)
    const client = getDiscordClient();
    if (!client) {
      return res.status(503).json({ ok: false, error: "Bot client not available" });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ ok: false, error: "Guild not found" });
    }

    const channels = guild.channels.cache
      .filter(channel => channel.isTextBased() || channel.isVoiceBased())
      .map(channel => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        position: 'position' in channel ? channel.position : 0
      }))
      .sort((a, b) => a.position - b.position);

    res.json({ ok: true, channels });
  } catch (error) {
    console.error("Error fetching server channels:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch server channels" });
  }
});

// GET /server/:guildId/api/info - Get basic server info
serverRouter.get("/:guildId/api/info", requireAuth, requireGuildAdmin, async (req: Request, res: Response) => {
  try {
    const { guildId } = req.params;
    const guildInfo = (req as any).guildInfo;

    // Get additional info from Discord bot client if available
    const client = getDiscordClient();
    let memberCount = 0;
    let iconUrl = null;

    if (client) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        memberCount = guild.memberCount;
        iconUrl = guild.iconURL({ size: 128 });
      }
    }

    res.json({
      ok: true,
      info: {
        guildId,
        name: guildInfo.guildName,
        memberCount,
        iconUrl,
        userPermissions: guildInfo.userPermissions
      }
    });
  } catch (error) {
    console.error("Error fetching server info:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch server info" });
  }
});

// GET /server - List user's servers (for server selection)
serverRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { accessToken } = req.session;

    // Fetch user's guilds from Discord API
    const guildsResponse = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!guildsResponse.ok) {
      throw new Error("Failed to fetch user guilds");
    }

    const guilds = await guildsResponse.json();

    // Filter to only guilds where user has admin permissions
    const adminGuilds = guilds.filter((guild: any) => {
      const permissions = parseInt(guild.permissions);
      return (permissions & 0x8) === 0x8 || (permissions & 0x20) === 0x20;
    });

    // Load server selection HTML
    const htmlPath = join(__dirname, "server", "select.html");
    let html = await readFile(htmlPath, "utf-8");

    // Replace placeholder with server data
    html = html.replace("{{SERVERS_JSON}}", JSON.stringify(adminGuilds));
    html = html.replace("{{USER_NAME}}", req.session.username || "User");

    res.send(html);
  } catch (error) {
    console.error("Error loading server list:", error);
    res.status(500).send("Failed to load server list");
  }
});