// src/web/admin/servers.ts
import { Router } from "express";
import { prisma } from "../../services/db.js";
import { getDiscordClient, fetchMultipleServernames } from "../../services/discord_users.js";
import { registerCommandsForApprovedGuilds } from "../../services/command_registry.js";
import { getCommandsJson } from "../../services/commands_def.js";

export const serversRouter = Router();

serversRouter.get("/servers", async (_req, res) => {
  try {
    const servers = await prisma.approvedServer.findMany({
      orderBy: { createdAt: "desc" }
    });

    // Fetch Discord server names
    const client = getDiscordClient();
    const guildIds = servers.map(s => s.guildId);
    let servernames = new Map<string, string>();
    
    if (client) {
      try {
        servernames = await fetchMultipleServernames(client, guildIds);
        console.log(`Fetched ${servernames.size} server names for admin interface`);
      } catch (error) {
        console.error("Failed to fetch server names:", error);
      }
    }

    // Enrich servers with names
    const enrichedServers = servers.map(server => ({
      ...server,
      servername: servernames.get(server.guildId) || `Server#${server.guildId.slice(-4)}`
    }));

    res.json({ ok: true, servers: enrichedServers });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to fetch servers" });
  }
});

serversRouter.post("/servers", async (req, res) => {
  try {
    const { guildId, note } = req.body;
    
    if (!guildId || !/^[0-9]+$/.test(guildId)) {
      return res.status(400).json({ ok: false, error: "Valid guild ID is required" });
    }

    const server = await prisma.approvedServer.create({
      data: {
        guildId,
        note: note?.trim() || null,
        enabled: true
      }
    });

    // Register commands for the new guild
    try {
      const cmds = getCommandsJson();
      await registerCommandsForApprovedGuilds(cmds);
    } catch (error) {
      console.error("Failed to register commands for new guild:", error);
    }

    res.json({ ok: true, server });
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(400).json({ ok: false, error: "Server already exists" });
    }
    res.status(500).json({ ok: false, error: "Failed to add server" });
  }
});

serversRouter.put("/servers/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid server ID" });

    const { enabled, note } = req.body;
    const data: any = {};

    if (typeof enabled === "boolean") data.enabled = enabled;
    if (note !== undefined) data.note = note?.trim() || null;

    const server = await prisma.approvedServer.update({ where: { id }, data });
    res.json({ ok: true, server });
  } catch (error: any) {
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, error: "Server not found" });
    }
    res.status(500).json({ ok: false, error: "Failed to update server" });
  }
});

serversRouter.delete("/servers/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid server ID" });

    await prisma.approvedServer.delete({ where: { id } });
    res.json({ ok: true, message: "Server deleted successfully" });
  } catch (error: any) {
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, error: "Server not found" });
    }
    res.status(500).json({ ok: false, error: "Failed to delete server" });
  }
});