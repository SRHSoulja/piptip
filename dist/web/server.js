import { Router } from "express";
import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { getGuildSettings, updateGuildSettings, getChannelActivity } from "../services/channel_manager.js";
import { getDiscordClient } from "../services/discord_users.js";
const serverRouter = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
async function verifyGuildAdmin(discordId, accessToken, guildId) {
  try {
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
    const guild = guilds.find((g) => g.id === guildId);
    if (!guild) {
      return { hasPermission: false };
    }
    const permissions = parseInt(guild.permissions);
    const hasAdminPerms = (permissions & 8) === 8 || (permissions & 32) === 32;
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
function requireAuth(req, res, next) {
  if (!req.session?.discordId || !req.session?.accessToken) {
    return res.redirect(`/auth/discord?redirect=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}
async function requireGuildAdmin(req, res, next) {
  const { guildId } = req.params;
  const { discordId, accessToken } = req.session;
  if (!guildId || !/^[0-9]+$/.test(guildId)) {
    return res.status(400).send("Invalid guild ID");
  }
  const verification = await verifyGuildAdmin(discordId, accessToken, guildId);
  if (!verification.hasPermission) {
    return res.status(403).send(`
      <h2>Access Denied</h2>
      <p>You don't have administrator permissions in this server.</p>
      <p>You need either <strong>Administrator</strong> or <strong>Manage Server</strong> permissions to access this dashboard.</p>
      <a href="/pengubook">\u2190 Back to PenguBook</a>
    `);
  }
  req.guildInfo = verification;
  next();
}
serverRouter.get("/:guildId", requireAuth, requireGuildAdmin, async (req, res) => {
  try {
    const { guildId } = req.params;
    const guildInfo = req.guildInfo;
    const htmlPath = join(__dirname, "server", "dashboard.html");
    let html = await readFile(htmlPath, "utf-8");
    html = html.replaceAll("{{GUILD_ID}}", guildId);
    html = html.replaceAll("{{GUILD_NAME}}", guildInfo.guildName || `Server ${guildId.slice(-4)}`);
    html = html.replaceAll("{{USER_NAME}}", req.session.username || "User");
    res.send(html);
  } catch (error) {
    console.error("Error loading server dashboard:", error);
    res.status(500).send("Failed to load server dashboard");
  }
});
serverRouter.get("/:guildId/api/settings", requireAuth, requireGuildAdmin, async (req, res) => {
  try {
    const { guildId } = req.params;
    const settings = await getGuildSettings(guildId);
    const guildInfo = req.guildInfo;
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
serverRouter.put("/:guildId/api/settings", requireAuth, requireGuildAdmin, async (req, res) => {
  try {
    const { guildId } = req.params;
    const updateData = req.body;
    if (updateData.channelMode && !["ALLOW_ALL", "WHITELIST", "BLACKLIST"].includes(updateData.channelMode)) {
      return res.status(400).json({ ok: false, error: "Invalid channel mode" });
    }
    const updatedSettings = await updateGuildSettings(guildId, updateData);
    res.json({ ok: true, settings: updatedSettings });
  } catch (error) {
    console.error("Error updating server settings:", error);
    res.status(500).json({ ok: false, error: "Failed to update server settings" });
  }
});
serverRouter.post("/:guildId/api/settings/reset", requireAuth, requireGuildAdmin, async (req, res) => {
  try {
    const { guildId } = req.params;
    const defaultSettings = {
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
serverRouter.get("/:guildId/api/activity", requireAuth, requireGuildAdmin, async (req, res) => {
  try {
    const { guildId } = req.params;
    const hours = parseInt(req.query.hours) || 24;
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
serverRouter.get("/:guildId/api/channels", requireAuth, requireGuildAdmin, async (req, res) => {
  try {
    const { guildId } = req.params;
    const client = getDiscordClient();
    if (!client) {
      return res.status(503).json({ ok: false, error: "Bot client not available" });
    }
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ ok: false, error: "Guild not found" });
    }
    const channels = guild.channels.cache.filter((channel) => channel.isTextBased() || channel.isVoiceBased()).map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      position: "position" in channel ? channel.position : 0
    })).sort((a, b) => a.position - b.position);
    res.json({ ok: true, channels });
  } catch (error) {
    console.error("Error fetching server channels:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch server channels" });
  }
});
serverRouter.get("/:guildId/api/info", requireAuth, requireGuildAdmin, async (req, res) => {
  try {
    const { guildId } = req.params;
    const guildInfo = req.guildInfo;
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
serverRouter.get("/", requireAuth, async (req, res) => {
  try {
    const { accessToken } = req.session;
    const guildsResponse = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!guildsResponse.ok) {
      throw new Error("Failed to fetch user guilds");
    }
    const guilds = await guildsResponse.json();
    const adminGuilds = guilds.filter((guild) => {
      const permissions = parseInt(guild.permissions);
      return (permissions & 8) === 8 || (permissions & 32) === 32;
    });
    const htmlPath = join(__dirname, "server", "select.html");
    let html = await readFile(htmlPath, "utf-8");
    html = html.replaceAll("{{SERVERS_JSON}}", JSON.stringify(adminGuilds));
    html = html.replaceAll("{{USER_NAME}}", req.session.username || "User");
    res.send(html);
  } catch (error) {
    console.error("Error loading server list:", error);
    res.status(500).send("Failed to load server list");
  }
});
export {
  serverRouter
};
//# sourceMappingURL=server.js.map
