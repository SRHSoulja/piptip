import { getCurrentUser } from "../../auth.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { getDiscordClient } from "../../../services/discord_users.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { prisma } from "../../../services/db.js";
export const apiHandlers = {
    // GET /pengubook/api/unread-count
    async unreadCount(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            const count = await getUnreadMessageCount(currentUser.discordId);
            res.json({ success: true, count });
        }
        catch (error) {
            console.error("Unread count fetch error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch unread count" });
        }
    },
    // GET /pengubook/api/discord-user/:discordId
    async discordUser(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser)
                return res.status(401).json({ success: false, error: "Not authenticated" });
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
            }
            catch (error) {
                res.json({
                    success: true,
                    username: `User#${discordId.slice(-4)}`,
                    avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1)) % 6}.png`
                });
            }
        }
        catch (error) {
            console.error("Discord user fetch error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch user info" });
        }
    },
    // Profile API endpoint
    async profile(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            if (req.method === 'GET') {
                const user = await findOrCreateUser(currentUser.discordId);
                res.json({
                    success: true,
                    profile: {
                        bio: user.bio,
                        showInPenguBook: user.showInPenguBook,
                        bioViewCount: user.bioViewCount
                    }
                });
            }
            else if (req.method === 'POST') {
                const { bio, showInPenguBook } = req.body;
                const user = await findOrCreateUser(currentUser.discordId);
                const updateData = {};
                if (bio !== undefined) {
                    const trimmedBio = bio.trim();
                    if (trimmedBio.length > 500) {
                        return res.status(400).json({ success: false, error: "Bio must be 500 characters or less" });
                    }
                    updateData.bio = trimmedBio || null;
                    updateData.bioLastUpdated = new Date();
                }
                if (showInPenguBook !== undefined) {
                    if (typeof showInPenguBook !== 'boolean') {
                        return res.status(400).json({ success: false, error: "showInPenguBook must be a boolean" });
                    }
                    updateData.showInPenguBook = showInPenguBook;
                }
                await prisma.user.update({
                    where: { id: user.id },
                    data: updateData
                });
                res.json({ success: true });
            }
            else {
                res.status(405).json({ success: false, error: "Method not allowed" });
            }
        }
        catch (error) {
            console.error("Profile API error:", error);
            res.status(500).json({ success: false, error: "Failed to process profile request" });
        }
    },
    // Balance API endpoint
    async balance(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            const user = await findOrCreateUser(currentUser.discordId);
            const balances = await prisma.userBalance.findMany({
                where: { userId: user.id },
                include: { Token: true },
                orderBy: { Token: { symbol: "asc" } }
            });
            res.json({ success: true, balances });
        }
        catch (error) {
            console.error("Balance fetch error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch balance" });
        }
    },
    // Tip API endpoint (placeholder)
    async tip(req, res) {
        res.status(501).json({
            success: false,
            error: "Tip API not yet implemented. Use Discord commands for tipping."
        });
    }
};
