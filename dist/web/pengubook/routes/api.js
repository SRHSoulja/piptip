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
    // GET /pengubook/api/token-price/:tokenSymbol?chain=...
    async tokenPrice(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            const tokenSymbolOrAddress = req.params.tokenSymbol;
            const preferredChain = req.query.chain;
            if (!tokenSymbolOrAddress) {
                return res.status(400).json({ success: false, error: "Token symbol or address required" });
            }
            console.log(`🔍 API request for token: ${tokenSymbolOrAddress}, chain: ${preferredChain}`);
            // Use the enhanced market resolver with Abstract priority and chain support
            const { marketResolver } = await import('../../../services/market_resolver.js');
            const tokenData = await marketResolver.fetchDexScreenerPrice(tokenSymbolOrAddress, preferredChain);
            if (!tokenData.success) {
                return res.json({
                    success: false,
                    error: tokenData.error || `Token ${tokenSymbolOrAddress} not found`,
                    tokenSymbol: tokenSymbolOrAddress
                });
            }
            return res.json({
                success: true,
                tokenSymbol: tokenData.symbol,
                price: tokenData.price,
                change24h: tokenData.priceChange24h,
                volume24h: tokenData.volume24h,
                liquidity: tokenData.liquidity,
                chain: tokenData.chain,
                address: tokenData.address,
                warning: tokenData.warning,
                isAbstractChain: tokenData.isAbstractChain,
                isVerifiedToken: tokenData.isVerifiedToken,
                source: "Enhanced DexScreener with Abstract Priority",
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
                // Get proper display names for both users with better fallbacks
                let targetUserHandle = `Player ${targetDiscordId.slice(-4)}`;
                let userHandle = `Player ${currentUser.discordId.slice(-4)}`;
                const client = getDiscordClient();
                if (client && client.isReady()) {
                    try {
                        // Fetch target user
                        const targetDiscordUser = await client.users.fetch(targetDiscordId);
                        targetUserHandle = targetDiscordUser.displayName || targetDiscordUser.username || targetUserHandle;
                        // Fetch current user
                        const currentDiscordUser = await client.users.fetch(currentUser.discordId);
                        userHandle = currentDiscordUser.displayName || currentDiscordUser.username || userHandle;
                    }
                    catch (error) {
                        console.log('Discord API fetch failed, using fallback names');
                        // Keep fallback values
                    }
                }
                else {
                    console.log('Discord client not available, using fallback names');
                }
                // Create activity feed item with both user handles
                await prisma.activityFeedItem.create({
                    data: {
                        userId: fromUser.id,
                        type: 'reaction',
                        data: {
                            reactionType: reactionType,
                            targetUserId: targetUser.id,
                            targetUserHandle: targetUserHandle,
                            userHandle: userHandle // Store the acting user's handle
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
                // Get proper display names for both users with better fallbacks
                let targetUserHandle = `Player ${targetDiscordId.slice(-4)}`;
                let userHandle = `Player ${currentUser.discordId.slice(-4)}`;
                const client = getDiscordClient();
                if (client && client.isReady()) {
                    try {
                        // Fetch target user
                        const targetDiscordUser = await client.users.fetch(targetDiscordId);
                        targetUserHandle = targetDiscordUser.displayName || targetDiscordUser.username || targetUserHandle;
                        // Fetch current user
                        const currentDiscordUser = await client.users.fetch(currentUser.discordId);
                        userHandle = currentDiscordUser.displayName || currentDiscordUser.username || userHandle;
                    }
                    catch (error) {
                        console.log('Discord API fetch failed, using fallback names');
                        // Keep fallback values
                    }
                }
                else {
                    console.log('Discord client not available, using fallback names');
                }
                // Create activity feed item with both user handles
                await prisma.activityFeedItem.create({
                    data: {
                        userId: fromUser.id,
                        type: 'follow',
                        data: {
                            targetUserId: targetUser.id,
                            targetUserHandle: targetUserHandle,
                            userHandle: userHandle // Store the acting user's handle
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
            // Helper function to get Discord username with fallback to stored data
            const getDiscordUsername = async (discordId, storedHandle) => {
                // If we have a stored handle and it's not a fallback format, use it
                if (storedHandle && !storedHandle.startsWith('User#')) {
                    return storedHandle;
                }
                try {
                    const client = getDiscordClient();
                    if (client) {
                        const user = await client.users.fetch(discordId);
                        return user.displayName || user.username || storedHandle || `User#${discordId.slice(-4)}`;
                    }
                }
                catch (error) {
                    // Fallback to stored handle or default format
                }
                return storedHandle || `User#${discordId.slice(-4)}`;
            };
            // Format activities for display with enhanced data
            const formattedActivities = await Promise.all(activities.map(async (activity) => {
                const data = activity.data;
                let text = '';
                let icon = '📝';
                // Get proper username using stored data when available
                // For new activities, data.userHandle should be available
                // For old activities, we need to fetch from Discord or use fallback
                let username = data.userHandle;
                if (!username) {
                    username = await getDiscordUsername(activity.user.discordId, undefined);
                    // If still no username, provide a better fallback
                    if (username.startsWith('User#')) {
                        username = `Player ${activity.user.discordId.slice(-4)}`;
                    }
                }
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
                        text = `${username} reacted with ${icon} to ${data.targetUserHandle}`;
                        break;
                    case 'follow':
                        icon = '👥';
                        text = `${username} started following ${data.targetUserHandle}`;
                        break;
                    case 'tip':
                        icon = '💸';
                        // Parse tip amount and token - data.amount might be "2 ABSTER" format
                        let amount = data.amount || '0';
                        let token = data.token || data.tokenSymbol || 'Unknown';
                        // If amount already includes token symbol, parse it
                        if (typeof amount === 'string' && amount.includes(' ')) {
                            const parts = amount.trim().split(' ');
                            amount = parts[0]; // Numeric part
                            if (!data.token) {
                                token = parts[1]; // Token symbol from amount if not separately provided
                            }
                        }
                        // Clean up token symbol (remove duplicates)
                        if (typeof token === 'string' && token.includes(' ')) {
                            const parts = token.trim().split(' ');
                            token = parts[0]; // Use first part
                        }
                        let tipDisplay = `${amount} ${token}`;
                        // Check if data already includes USD value
                        if (data.usdValue && data.usdValue > 0) {
                            tipDisplay += ` ($${data.usdValue.toFixed(2)} USD)`;
                        }
                        else if (data.usdPrice && data.usdPrice > 0) {
                            const numericAmount = parseFloat(amount.toString());
                            if (!isNaN(numericAmount)) {
                                const usdValue = numericAmount * data.usdPrice;
                                tipDisplay += ` ($${usdValue.toFixed(2)} USD)`;
                            }
                        }
                        // Get target user's proper handle
                        const targetHandle = data.targetUserHandle && !data.targetUserHandle.startsWith('User#')
                            ? data.targetUserHandle
                            : `User#${String(data.targetUserId).slice(-4)}`;
                        text = `${username} sent a tip of ${tipDisplay} to ${targetHandle}`;
                        break;
                    case 'achievement':
                        icon = '🏆';
                        text = `${username} unlocked achievement: ${data.achievementName}`;
                        break;
                    case 'join':
                        icon = '💎';
                        text = `${username} joined PenguBook`;
                        break;
                    default:
                        text = `${username} performed an action`;
                }
                return {
                    icon,
                    text,
                    time: getTimeAgo(activity.createdAt),
                    type: activity.type,
                    userId: activity.user.discordId
                };
            }));
            return res.json({
                success: true,
                activities: formattedActivities
            });
        }
        catch (error) {
            console.error("Activity feed API error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch activity feed" });
        }
    },
    // Search users for compose message
    async searchUsers(req, res) {
        try {
            const currentUser = getCurrentUser(req);
            if (!currentUser) {
                return res.status(401).json({ success: false, error: "Not authenticated" });
            }
            const query = req.query.q;
            if (!query || query.length < 2) {
                return res.json({ success: true, users: [] });
            }
            // Search all users (not just PenguBook users) for messaging
            const users = await prisma.user.findMany({
                where: {
                    AND: [
                        { discordId: { not: currentUser.discordId } }, // Exclude self
                        {
                            OR: [
                                { discordId: { contains: query, mode: 'insensitive' } },
                                // Search by Discord ID partial match
                            ]
                        }
                    ]
                },
                select: {
                    discordId: true,
                    createdAt: true,
                    wins: true,
                    bio: true,
                    showInPenguBook: true
                },
                take: 15,
                orderBy: [
                    { showInPenguBook: 'desc' }, // PenguBook users first
                    { wins: 'desc' }, // Popular users first
                    { createdAt: 'desc' }
                ]
            });
            // Enhance with Discord usernames and filter by name too
            const client = getDiscordClient();
            console.log(`[Search API] Discord client available: ${!!client}, ready: ${client?.isReady()}`);
            const enhancedUsers = await Promise.all(users.map(async (user) => {
                let displayName = `Player ${user.discordId.slice(-4)}`;
                let avatarURL = `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discordId.slice(-1)) % 6}.png`;
                if (client && client.isReady()) {
                    try {
                        // Add timeout to Discord API call
                        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Discord fetch timeout')), 2000));
                        const fetchPromise = client.users.fetch(user.discordId);
                        const discordUser = await Promise.race([fetchPromise, timeoutPromise]);
                        const newDisplayName = discordUser.displayName || discordUser.username || displayName;
                        console.log(`[Search API] Fetched ${user.discordId}: ${newDisplayName}`);
                        displayName = newDisplayName;
                        avatarURL = discordUser.displayAvatarURL({ size: 64 });
                    }
                    catch (error) {
                        // Keep fallback values
                        console.log(`[Search API] Failed to fetch Discord user ${user.discordId}: ${error.message}`);
                    }
                }
                else {
                    console.log(`[Search API] Discord client not available for ${user.discordId}`);
                }
                return {
                    discordId: user.discordId,
                    displayName: displayName + (user.showInPenguBook ? ' 📖' : ''),
                    avatarURL,
                    wins: user.wins,
                    bioText: user.bio?.substring(0, 100) || '',
                    inPenguBook: user.showInPenguBook,
                    rawDisplayName: displayName
                };
            }));
            // Filter by username after fetching Discord names
            const filteredUsers = enhancedUsers.filter(user => {
                const lowerQuery = query.toLowerCase();
                // Search by Discord ID
                if (user.discordId.toLowerCase().includes(lowerQuery)) {
                    return true;
                }
                // Search by display name (if we got it from Discord)
                if (user.rawDisplayName && !user.rawDisplayName.startsWith('Player ') &&
                    user.rawDisplayName.toLowerCase().includes(lowerQuery)) {
                    return true;
                }
                // Search in bio text
                if (user.bioText && user.bioText.toLowerCase().includes(lowerQuery)) {
                    return true;
                }
                return false;
            });
            return res.json({
                success: true,
                users: filteredUsers.slice(0, 10) // Limit to top 10 results
            });
        }
        catch (error) {
            console.error("User search API error:", error);
            res.status(500).json({ success: false, error: "Failed to search users" });
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
