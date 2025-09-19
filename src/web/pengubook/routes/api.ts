// src/web/pengubook/routes/api.ts - API endpoint handlers
import { Request, Response } from "express";
import { getCurrentUser } from "../../auth.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { getDiscordClient } from "../../../services/discord_users.js";

export const apiHandlers = {
  // GET /pengubook/api/unread-count
  async unreadCount(req: Request, res: Response) {
    try {
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }

      const count = await getUnreadMessageCount(currentUser.discordId);
      res.json({ success: true, count });
    } catch (error) {
      console.error("Unread count fetch error:", error);
      res.status(500).json({ success: false, error: "Failed to fetch unread count" });
    }
  },

  // GET /pengubook/api/discord-user/:discordId
  async discordUser(req: Request, res: Response) {
    try {
      const currentUser = getCurrentUser(req);
      if (!currentUser) return res.status(401).json({ success: false, error: "Not authenticated" });

      const discordId = req.params.discordId;
      const client = getDiscordClient();

      if (!client) {
        return res.json({
          success: true,
          username: `User#${discordId.slice(-4)}`,
          avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1)) % 6}.png`
        });
      }

      try {
        const user = await client.users.fetch(discordId);
        res.json({
          success: true,
          username: user.username || user.displayName || `User#${discordId.slice(-4)}`,
          avatarURL: user.displayAvatarURL({ size: 256, extension: 'png' })
        });
      } catch (error) {
        res.json({
          success: true,
          username: `User#${discordId.slice(-4)}`,
          avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1)) % 6}.png`
        });
      }
    } catch (error) {
      console.error("Discord user fetch error:", error);
      res.status(500).json({ success: false, error: "Failed to fetch user info" });
    }
  },

  // Placeholder handlers for other API endpoints
  async tip(req: Request, res: Response) {
    res.status(501).json({ success: false, error: "Tip API not yet implemented in modular structure" });
  },

  async profile(req: Request, res: Response) {
    res.status(501).json({ success: false, error: "Profile API not yet implemented in modular structure" });
  },

  async balance(req: Request, res: Response) {
    res.status(501).json({ success: false, error: "Balance API not yet implemented in modular structure" });
  }
};