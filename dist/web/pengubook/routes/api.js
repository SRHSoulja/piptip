import { getCurrentUser } from "../../auth.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { getDiscordClient } from "../../../services/discord_users.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { prisma } from "../../../services/db.js";
import { priceAPI } from "../../../services/price_api.js";
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
    // GET /pengubook/api/token-price/:tokenSymbol
    async tokenPrice(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            const tokenSymbol = req.params.tokenSymbol.toUpperCase();
            if (!tokenSymbol) {
                return res.status(400).json({ success: false, error: "Token symbol required" });
            }
            // Fetch real-time price data from APIs
            const tokenData = await priceAPI.getTokenPrices([tokenSymbol]);
            if (!tokenData.success || !tokenData.prices[tokenSymbol]) {
                return res.json({
                    success: false,
                    error: `Token ${tokenSymbol} not found in price APIs`,
                    tokenSymbol
                });
            }
            const price = tokenData.prices[tokenSymbol];
            const change24h = tokenData.change24h?.[tokenSymbol] || null;
            return res.json({
                success: true,
                tokenSymbol,
                price,
                change24h,
                source: "DexScreener/CoinGecko",
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            console.error("Token price fetch error:", error);
            res.status(500).json({
                success: false,
                error: "API error fetching token price",
                tokenSymbol: req.params.tokenSymbol
            });
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
            const tokenSymbols = Array.from(new Set(balances.map(balance => balance.Token.symbol)));
            let priceResult = null;
            if (tokenSymbols.length > 0) {
                try {
                    priceResult = await priceAPI.getTokenPrices(tokenSymbols);
                }
                catch (error) {
                    console.warn("Failed to fetch USD prices for balances:", error);
                }
            }
            const priceMap = priceResult?.prices ?? {};
            const priceSource = priceResult?.source ?? "fallback";
            // Format balances with max 2 decimal places, remove trailing zeros, and attach USD estimates
            const formattedBalances = balances.map(balance => {
                const amountNumber = Number(balance.amount.toString());
                const amount = amountNumber.toFixed(2).replace(/\.?0+$/, "");
                const priceUSD = priceMap[balance.Token.symbol] ?? 0;
                const usdValue = priceUSD > 0 ? amountNumber * priceUSD : 0;
                let formattedUSD = null;
                if (priceUSD > 0) {
                    if (usdValue === 0) {
                        formattedUSD = "$0.00";
                    }
                    else if (usdValue < 0.01) {
                        formattedUSD = "< $0.01";
                    }
                    else {
                        formattedUSD = `$${usdValue.toFixed(2)}`;
                    }
                }
                return {
                    ...balance,
                    amount,
                    priceUSD: priceUSD > 0 ? priceUSD : null,
                    usdValue,
                    formattedUSD
                };
            });
            const totalUSD = formattedBalances.reduce((sum, balance) => sum + (balance.usdValue || 0), 0);
            const formattedTotalUSD = totalUSD > 0 ? `$${totalUSD.toFixed(2)}` : null;
            const priceDisclaimer = tokenSymbols.length > 0
                ? `USD estimates via ${priceSource.toUpperCase()}${priceSource === "fallback" ? " (estimates only)" : ""}`
                : null;
            res.json({
                success: true,
                balances: formattedBalances,
                totalUSD,
                formattedTotalUSD,
                priceSource,
                priceDisclaimer
            });
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
    },
    // Send message API endpoint
    async sendMessage(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            const { targetDiscordId, message } = req.body;
            // Validate inputs
            if (!targetDiscordId || !message) {
                return res.status(400).json({
                    success: false,
                    error: "Missing required fields: targetDiscordId, message"
                });
            }
            // Validate message length
            if (typeof message !== 'string' || message.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    error: "Message cannot be empty"
                });
            }
            if (message.length > 500) {
                return res.status(400).json({
                    success: false,
                    error: "Message must be 500 characters or less"
                });
            }
            // Prevent self-messaging
            if (targetDiscordId === currentUser.discordId) {
                return res.status(400).json({
                    success: false,
                    error: "You cannot message yourself"
                });
            }
            // Get both users
            const fromUser = await findOrCreateUser(currentUser.discordId);
            const targetUser = await findOrCreateUser(targetDiscordId);
            // Check if target user exists and allows PenguBook messages
            const targetUserData = await prisma.user.findUnique({
                where: { discordId: targetDiscordId }
            });
            if (!targetUserData || !targetUserData.showInPenguBook) {
                return res.status(400).json({
                    success: false,
                    error: "Target user not found or does not accept messages"
                });
            }
            // Create the PenguBook message
            await prisma.penguBookMessage.create({
                data: {
                    fromUserId: fromUser.id,
                    toUserId: targetUser.id,
                    message: message.trim(),
                    tipId: null, // This is a standalone message, not a tip
                    read: false
                }
            });
            return res.json({
                success: true,
                message: "Message sent successfully"
            });
        }
        catch (error) {
            console.error("Send message API error:", error);
            res.status(500).json({ success: false, error: "Failed to send message" });
        }
    },
    // Social reaction API endpoint
    async react(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            const { targetDiscordId, reactionType } = req.body;
            // Validate inputs
            if (!targetDiscordId || !reactionType) {
                return res.status(400).json({
                    success: false,
                    error: "Missing required fields: targetDiscordId, reactionType"
                });
            }
            // Validate reaction type
            const validReactions = ['like', 'fire', 'diamond', 'rocket', 'star'];
            if (!validReactions.includes(reactionType)) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid reaction type"
                });
            }
            // Prevent self-reactions
            if (targetDiscordId === currentUser.discordId) {
                return res.status(400).json({
                    success: false,
                    error: "You cannot react to yourself"
                });
            }
            const fromUser = await findOrCreateUser(currentUser.discordId);
            const targetUser = await findOrCreateUser(targetDiscordId);
            // Check if reaction already exists
            const existingReaction = await prisma.profileReaction.findUnique({
                where: {
                    giverId_receiverId_reactionType: {
                        giverId: fromUser.id,
                        receiverId: targetUser.id,
                        reactionType: reactionType
                    }
                }
            });
            let added = false;
            if (existingReaction) {
                // Remove existing reaction (toggle off)
                await prisma.profileReaction.delete({
                    where: { id: existingReaction.id }
                });
                added = false;
            }
            else {
                // Add new reaction
                await prisma.profileReaction.create({
                    data: {
                        giverId: fromUser.id,
                        receiverId: targetUser.id,
                        reactionType: reactionType
                    }
                });
                added = true;
                // Create activity feed item
                await prisma.activityFeedItem.create({
                    data: {
                        userId: fromUser.id,
                        type: 'reaction',
                        data: {
                            reactionType: reactionType,
                            targetUserId: targetUser.id,
                            targetUserHandle: `User#${targetDiscordId.slice(-4)}`
                        },
                        visibility: 'public'
                    }
                });
            }
            return res.json({
                success: true,
                added: added,
                message: added ? "Reaction added successfully" : "Reaction removed successfully"
            });
        }
        catch (error) {
            console.error("Reaction API error:", error);
            res.status(500).json({ success: false, error: "Failed to process reaction" });
        }
    },
    // Follow user API endpoint
    async follow(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            const { targetDiscordId } = req.body;
            if (!targetDiscordId) {
                return res.status(400).json({
                    success: false,
                    error: "Missing required field: targetDiscordId"
                });
            }
            // Prevent self-following
            if (targetDiscordId === currentUser.discordId) {
                return res.status(400).json({
                    success: false,
                    error: "You cannot follow yourself"
                });
            }
            const fromUser = await findOrCreateUser(currentUser.discordId);
            const targetUser = await findOrCreateUser(targetDiscordId);
            // Check if already following
            const existingFollow = await prisma.userFollow.findUnique({
                where: {
                    followerId_followingId: {
                        followerId: fromUser.id,
                        followingId: targetUser.id
                    }
                }
            });
            let following = false;
            if (existingFollow) {
                // Unfollow
                await prisma.userFollow.delete({
                    where: { id: existingFollow.id }
                });
                following = false;
            }
            else {
                // Follow
                await prisma.userFollow.create({
                    data: {
                        followerId: fromUser.id,
                        followingId: targetUser.id
                    }
                });
                following = true;
                // Create activity feed item
                await prisma.activityFeedItem.create({
                    data: {
                        userId: fromUser.id,
                        type: 'follow',
                        data: {
                            targetUserId: targetUser.id,
                            targetUserHandle: `User#${targetDiscordId.slice(-4)}`
                        },
                        visibility: 'public'
                    }
                });
            }
            return res.json({
                success: true,
                following: following,
                message: following ? "Now following user" : "Unfollowed user"
            });
        }
        catch (error) {
            console.error("Follow API error:", error);
            res.status(500).json({ success: false, error: "Failed to follow user" });
        }
    },
    // Get social data for a user
    async socialData(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            const targetDiscordId = req.params.discordId;
            const currentUserData = await findOrCreateUser(currentUser.discordId);
            const targetUser = await findOrCreateUser(targetDiscordId);
            // Get reaction counts for target user
            const reactionCounts = await prisma.profileReaction.groupBy({
                by: ['reactionType'],
                where: { receiverId: targetUser.id },
                _count: { reactionType: true }
            });
            // Build reactions object
            const reactions = {
                like: 0,
                fire: 0,
                diamond: 0,
                rocket: 0,
                star: 0
            };
            reactionCounts.forEach(count => {
                reactions[count.reactionType] = count._count.reactionType;
            });
            // Get current user's reactions to this target
            const userReactions = await prisma.profileReaction.findMany({
                where: {
                    giverId: currentUserData.id,
                    receiverId: targetUser.id
                },
                select: { reactionType: true }
            });
            // Check if current user is following target
            const isFollowing = await prisma.userFollow.findUnique({
                where: {
                    followerId_followingId: {
                        followerId: currentUserData.id,
                        followingId: targetUser.id
                    }
                }
            });
            // Get follower/following counts
            const followerCount = await prisma.userFollow.count({
                where: { followingId: targetUser.id }
            });
            const followingCount = await prisma.userFollow.count({
                where: { followerId: targetUser.id }
            });
            return res.json({
                success: true,
                reactions,
                userReactions: userReactions.map(r => r.reactionType),
                isFollowing: !!isFollowing,
                followerCount,
                followingCount
            });
        }
        catch (error) {
            console.error("Social data API error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch social data" });
        }
    },
    // Get activity feed
    async activityFeed(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            // Get recent public activity
            const activities = await prisma.activityFeedItem.findMany({
                where: { visibility: 'public' },
                include: {
                    user: {
                        select: {
                            discordId: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: 20
            });
            // Format activities for display
            const formattedActivities = activities.map(activity => {
                const data = activity.data;
                let text = '';
                let icon = '📝';
                switch (activity.type) {
                    case 'reaction':
                        const reactionEmojis = {
                            like: '👍',
                            fire: '🔥',
                            diamond: '💎',
                            rocket: '🚀',
                            star: '⭐'
                        };
                        icon = reactionEmojis[data.reactionType] || '👍';
                        text = `User#${activity.user.discordId.slice(-4)} reacted with ${icon} to ${data.targetUserHandle}`;
                        break;
                    case 'follow':
                        icon = '👥';
                        text = `User#${activity.user.discordId.slice(-4)} started following ${data.targetUserHandle}`;
                        break;
                    case 'tip':
                        icon = '💸';
                        text = `User#${activity.user.discordId.slice(-4)} sent a tip of ${data.amount} ${data.token}`;
                        break;
                    case 'achievement':
                        icon = '🏆';
                        text = `User#${activity.user.discordId.slice(-4)} unlocked achievement: ${data.achievementName}`;
                        break;
                    case 'join':
                        icon = '💎';
                        text = `User#${activity.user.discordId.slice(-4)} joined PenguBook`;
                        break;
                    default:
                        text = `User#${activity.user.discordId.slice(-4)} performed an action`;
                }
                return {
                    icon,
                    text,
                    time: getTimeAgo(activity.createdAt),
                    type: activity.type
                };
            });
            return res.json({
                success: true,
                activities: formattedActivities
            });
        }
        catch (error) {
            console.error("Activity feed API error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch activity feed" });
        }
    }
};
// Helper function to format time ago
function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffSeconds < 60)
        return 'just now';
    if (diffMinutes < 60)
        return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    if (diffHours < 24)
        return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays < 7)
        return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    return date.toLocaleDateString();
}
