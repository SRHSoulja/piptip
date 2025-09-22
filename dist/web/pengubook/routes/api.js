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
            // Format balances with max 2 decimal places, remove trailing zeros
            const formattedBalances = balances.map(balance => {
                const amount = Number(balance.amount.toString());
                const formatted = amount.toFixed(2).replace(/\.?0+$/, "");
                return {
                    ...balance,
                    amount: formatted
                };
            });
            res.json({ success: true, balances: formattedBalances });
        }
        catch (error) {
            console.error("Balance fetch error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch balance" });
        }
    },
    // User data endpoint (tokens and balances)
    async userData(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            // Get active tokens
            const { getActiveTokens } = await import("../../../services/token.js");
            const tokens = await getActiveTokens();
            // Get user balances
            const user = await findOrCreateUser(currentUser.discordId);
            const balances = await prisma.userBalance.findMany({
                where: { userId: user.id },
                include: { Token: true }
            });
            // Format balances for easy lookup (max 2 decimal places, remove trailing zeros)
            const balanceMap = {};
            balances.forEach(balance => {
                const amount = Number(balance.amount.toString());
                // Format to 2 decimal places and remove trailing zeros
                const formatted = amount.toFixed(2).replace(/\.?0+$/, "");
                balanceMap[balance.tokenId] = formatted;
            });
            res.json({
                success: true,
                tokens: tokens.map(token => ({
                    id: token.id,
                    symbol: token.symbol,
                    decimals: token.decimals,
                    active: token.active
                })),
                balances: balanceMap
            });
        }
        catch (error) {
            console.error("User data fetch error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch user data" });
        }
    },
    // Tip API endpoint
    async tip(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            const { targetDiscordId, tokenId, amount, message } = req.body;
            // Validate inputs
            if (!targetDiscordId || !tokenId || !amount) {
                return res.status(400).json({
                    success: false,
                    error: "Missing required fields: targetDiscordId, tokenId, amount"
                });
            }
            // Validate amount
            if (typeof amount !== 'number' || amount <= 0 || amount > 1e15) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid amount"
                });
            }
            // Check decimal places
            const decimalPlaces = (amount.toString().split('.')[1] || '').length;
            if (decimalPlaces > 2) {
                return res.status(400).json({
                    success: false,
                    error: "Amount can have maximum 2 decimal places"
                });
            }
            // Prevent self-tipping
            if (targetDiscordId === currentUser.discordId) {
                return res.status(400).json({
                    success: false,
                    error: "You cannot tip yourself"
                });
            }
            // Import tip processor
            const { processTip } = await import("../../../services/tip_processor.js");
            const { getDiscordClient } = await import("../../../services/discord_users.js");
            const client = getDiscordClient();
            if (!client) {
                return res.status(500).json({
                    success: false,
                    error: "Discord client not available"
                });
            }
            // Process the tip
            const tipData = {
                amount,
                tipType: 'direct',
                targetUserId: targetDiscordId,
                note: message || "",
                tokenId: parseInt(tokenId),
                userId: currentUser.discordId,
                guildId: null, // PenguBook tips don't belong to a specific guild
                channelId: null,
                fromPenguBook: true
            };
            const result = await processTip(tipData, client);
            if (result.success) {
                // Note: PenguBook message is automatically created by tip processor
                // when fromPenguBook: true is set in tipData above
                return res.json({
                    success: true,
                    message: result.message,
                    details: result.details
                });
            }
            else {
                return res.status(400).json({
                    success: false,
                    error: result.message || "Failed to process tip"
                });
            }
        }
        catch (error) {
            console.error("Tip API error:", error);
            res.status(500).json({ success: false, error: "Failed to process tip" });
        }
    }
};
