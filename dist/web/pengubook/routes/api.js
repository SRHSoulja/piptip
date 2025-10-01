import { getCurrentUser } from "../../auth.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { getDiscordClient } from "../../../services/discord_users.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { prisma } from "../../../services/db.js";
import { priceAPI } from "../../../services/price_api.js";
import { queueNotice } from "../../../services/notifier.js";
import { pipchipsService } from "../../../services/pipchips_service.js";
import { ensureUser } from "../../../services/balances.js";
const balanceCache = /* @__PURE__ */ new Map();
const BALANCE_CACHE_TTL = 30 * 1e3;
const unreadCountCache = /* @__PURE__ */ new Map();
const UNREAD_COUNT_CACHE_TTL = 5 * 1e3;
const apiHandlers = {
  // GET /pengubook/api/unread-count
  async unreadCount(req, res) {
    try {
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const cacheKey = `unread_${currentUser.discordId}`;
      const cached = unreadCountCache.get(cacheKey);
      console.log(`\u{1F50D} Unread count API called for user ${currentUser.discordId.slice(-4)}`);
      if (cached && Date.now() - cached.timestamp < UNREAD_COUNT_CACHE_TTL) {
        const age = Date.now() - cached.timestamp;
        console.log(`\u2705 Serving cached unread count (${age}ms old) for user ${currentUser.discordId.slice(-4)}`);
        return res.json(cached.data);
      }
      console.log(`\u{1F504} Unread cache miss for user ${currentUser.discordId.slice(-4)} - fetching fresh count`);
      const count = await getUnreadMessageCount(currentUser.discordId);
      const response = { success: true, count };
      unreadCountCache.set(cacheKey, {
        data: response,
        timestamp: Date.now()
      });
      console.log(`\u{1F4BE} Cached unread count (${count}) for user ${currentUser.discordId.slice(-4)}`);
      res.json(response);
    } catch (error) {
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
      console.log(`\u{1F50D} API request for token: ${tokenSymbolOrAddress}, chain: ${preferredChain}`);
      const { marketResolver } = await import("../../../services/market_resolver.js");
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
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (error) {
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
          avatarURL: user.displayAvatarURL({ size: 256, extension: "png" })
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
  // GET /pengubook/api/discord-users-batch (POST with Discord IDs in body)
  async discordUsersBatch(req, res) {
    try {
      const currentUser = getCurrentUser(req);
      if (!currentUser) return res.status(401).json({ success: false, error: "Not authenticated" });
      const { discordIds } = req.body;
      if (!Array.isArray(discordIds) || discordIds.length === 0) {
        return res.status(400).json({ success: false, error: "discordIds array required" });
      }
      if (discordIds.length > 100) {
        return res.status(400).json({ success: false, error: "Maximum 100 Discord IDs per batch" });
      }
      const client = getDiscordClient();
      const results = {};
      discordIds.forEach((discordId) => {
        results[discordId] = {
          username: `User#${discordId.slice(-4)}`,
          avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1)) % 6}.png`
        };
      });
      if (client && client.isReady()) {
        await Promise.allSettled(
          discordIds.map(async (discordId) => {
            try {
              const user = await client.users.fetch(discordId);
              results[discordId] = {
                username: user.displayName || user.username || `User#${discordId.slice(-4)}`,
                avatarURL: user.displayAvatarURL({ size: 256, extension: "png" })
              };
            } catch (error) {
            }
          })
        );
      }
      res.json({
        success: true,
        users: results
      });
    } catch (error) {
      console.error("Batch Discord user fetch error:", error);
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
      if (req.method === "GET") {
        const user = await findOrCreateUser(currentUser.discordId);
        res.json({
          success: true,
          profile: {
            bio: user.bio,
            showInPenguBook: user.showInPenguBook,
            bioViewCount: user.bioViewCount
          }
        });
      } else if (req.method === "POST") {
        const { bio, showInPenguBook } = req.body;
        const user = await findOrCreateUser(currentUser.discordId);
        const updateData = {};
        if (bio !== void 0) {
          const trimmedBio = bio.trim();
          if (trimmedBio.length > 500) {
            return res.status(400).json({ success: false, error: "Bio must be 500 characters or less" });
          }
          updateData.bio = trimmedBio || null;
          updateData.bioLastUpdated = /* @__PURE__ */ new Date();
        }
        if (showInPenguBook !== void 0) {
          if (typeof showInPenguBook !== "boolean") {
            return res.status(400).json({ success: false, error: "showInPenguBook must be a boolean" });
          }
          updateData.showInPenguBook = showInPenguBook;
        }
        await prisma.user.update({
          where: { id: user.id },
          data: updateData
        });
        res.json({ success: true });
      } else {
        res.status(405).json({ success: false, error: "Method not allowed" });
      }
    } catch (error) {
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
      const cacheKey = `balance_${currentUser.discordId}`;
      const cached = balanceCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < BALANCE_CACHE_TTL) {
        return res.json(cached.data);
      }
      const user = await findOrCreateUser(currentUser.discordId);
      const balances = await prisma.userBalance.findMany({
        where: { userId: user.id },
        include: { Token: true },
        orderBy: { Token: { symbol: "asc" } }
      });
      const tokenSymbols = Array.from(new Set(balances.map((balance) => balance.Token.symbol)));
      let priceResult = null;
      if (tokenSymbols.length > 0) {
        try {
          priceResult = await priceAPI.getTokenPrices(tokenSymbols);
        } catch (error) {
          console.warn("Failed to fetch USD prices for balances:", error);
        }
      }
      const priceMap = priceResult?.prices ?? {};
      const priceSource = priceResult?.source ?? "fallback";
      const formattedBalances = balances.map((balance) => {
        const amountNumber = Number(balance.amount.toString());
        const amount = amountNumber.toFixed(2).replace(/\.?0+$/, "");
        const priceUSD = priceMap[balance.Token.symbol] ?? 0;
        const usdValue = priceUSD > 0 ? amountNumber * priceUSD : 0;
        let formattedUSD = null;
        if (priceUSD > 0) {
          if (usdValue === 0) {
            formattedUSD = "$0.00";
          } else if (usdValue < 0.01) {
            formattedUSD = "< $0.01";
          } else {
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
      const priceDisclaimer = tokenSymbols.length > 0 ? `USD estimates via ${priceSource.toUpperCase()}${priceSource === "fallback" ? " (estimates only)" : ""}` : null;
      const response = {
        success: true,
        balances: formattedBalances,
        totalUSD,
        formattedTotalUSD,
        priceSource,
        priceDisclaimer
      };
      balanceCache.set(cacheKey, {
        data: response,
        timestamp: Date.now()
      });
      res.json(response);
    } catch (error) {
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
      const { getActiveTokens } = await import("../../../services/token.js");
      const tokens = await getActiveTokens();
      const user = await findOrCreateUser(currentUser.discordId);
      const balances = await prisma.userBalance.findMany({
        where: { userId: user.id },
        include: { Token: true }
      });
      const balanceMap = {};
      balances.forEach((balance) => {
        const amount = Number(balance.amount.toString());
        const formatted = amount.toFixed(2).replace(/\.?0+$/, "");
        balanceMap[balance.tokenId] = formatted;
      });
      res.json({
        success: true,
        tokens: tokens.map((token) => ({
          id: token.id,
          symbol: token.symbol,
          decimals: token.decimals,
          active: token.active
        })),
        balances: balanceMap
      });
    } catch (error) {
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
      if (!targetDiscordId || !tokenId || !amount) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: targetDiscordId, tokenId, amount"
        });
      }
      if (typeof amount !== "number" || amount <= 0 || amount > 1e15) {
        return res.status(400).json({
          success: false,
          error: "Invalid amount"
        });
      }
      const decimalPlaces = (amount.toString().split(".")[1] || "").length;
      if (decimalPlaces > 2) {
        return res.status(400).json({
          success: false,
          error: "Amount can have maximum 2 decimal places"
        });
      }
      if (targetDiscordId === currentUser.discordId) {
        return res.status(400).json({
          success: false,
          error: "You cannot tip yourself"
        });
      }
      const { processTip } = await import("../../../services/tip_processor.js");
      const { getDiscordClient: getDiscordClient2 } = await import("../../../services/discord_users.js");
      const client = getDiscordClient2();
      if (!client) {
        return res.status(500).json({
          success: false,
          error: "Discord client not available"
        });
      }
      const tipData = {
        amount,
        tipType: "direct",
        targetUserId: targetDiscordId,
        note: message || "",
        tokenId: parseInt(tokenId),
        userId: currentUser.discordId,
        guildId: null,
        // PenguBook tips don't belong to a specific guild
        channelId: null,
        fromPenguBook: true
      };
      const result = await processTip(tipData, client);
      if (result.success) {
        return res.json({
          success: true,
          message: result.message,
          details: result.details
        });
      } else {
        return res.status(400).json({
          success: false,
          error: result.message || "Failed to process tip"
        });
      }
    } catch (error) {
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
      if (!targetDiscordId || !message) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: targetDiscordId, message"
        });
      }
      if (typeof message !== "string" || message.trim().length === 0) {
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
      if (targetDiscordId === currentUser.discordId) {
        return res.status(400).json({
          success: false,
          error: "You cannot message yourself"
        });
      }
      const fromUser = await findOrCreateUser(currentUser.discordId);
      const targetUser = await findOrCreateUser(targetDiscordId);
      const targetUserData = await prisma.user.findUnique({
        where: { discordId: targetDiscordId }
      });
      if (!targetUserData || !targetUserData.showInPenguBook) {
        return res.status(400).json({
          success: false,
          error: "Target user not found or does not accept messages"
        });
      }
      const newMessage = await prisma.penguBookMessage.create({
        data: {
          fromUserId: fromUser.id,
          toUserId: targetUser.id,
          message: message.trim(),
          tipId: null,
          // This is a standalone message, not a tip
          read: false
        }
      });
      let senderName = `Player ${currentUser.discordId.slice(-4)}`;
      const client = getDiscordClient();
      if (client && client.isReady()) {
        try {
          const discordUser = await client.users.fetch(currentUser.discordId);
          senderName = discordUser.displayName || discordUser.username || senderName;
        } catch (error) {
        }
      }
      await queueNotice(targetUser.id, "pengubook_message", {
        senderName,
        message: message.trim(),
        messageId: newMessage.id
      });
      return res.json({
        success: true,
        message: "Message sent successfully"
      });
    } catch (error) {
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
      if (!targetDiscordId || !reactionType) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: targetDiscordId, reactionType"
        });
      }
      const validReactions = ["like", "fire", "diamond", "rocket", "star"];
      if (!validReactions.includes(reactionType)) {
        return res.status(400).json({
          success: false,
          error: "Invalid reaction type"
        });
      }
      if (targetDiscordId === currentUser.discordId) {
        return res.status(400).json({
          success: false,
          error: "You cannot react to yourself"
        });
      }
      const fromUser = await findOrCreateUser(currentUser.discordId);
      const targetUser = await findOrCreateUser(targetDiscordId);
      const existingReaction = await prisma.profileReaction.findUnique({
        where: {
          giverId_receiverId_reactionType: {
            giverId: fromUser.id,
            receiverId: targetUser.id,
            reactionType
          }
        }
      });
      let added = false;
      if (existingReaction) {
        await prisma.profileReaction.delete({
          where: { id: existingReaction.id }
        });
        added = false;
      } else {
        await prisma.profileReaction.create({
          data: {
            giverId: fromUser.id,
            receiverId: targetUser.id,
            reactionType
          }
        });
        added = true;
        let targetUserHandle = `Player ${targetDiscordId.slice(-4)}`;
        let userHandle = `Player ${currentUser.discordId.slice(-4)}`;
        const client = getDiscordClient();
        if (client && client.isReady()) {
          try {
            const targetDiscordUser = await client.users.fetch(targetDiscordId);
            targetUserHandle = targetDiscordUser.displayName || targetDiscordUser.username || targetUserHandle;
            const currentDiscordUser = await client.users.fetch(currentUser.discordId);
            userHandle = currentDiscordUser.displayName || currentDiscordUser.username || userHandle;
          } catch (error) {
            console.log("Discord API fetch failed, using fallback names");
          }
        } else {
          console.log("Discord client not available, using fallback names");
        }
        await prisma.activityFeedItem.create({
          data: {
            userId: fromUser.id,
            type: "reaction",
            data: {
              reactionType,
              targetUserId: targetUser.id,
              targetUserHandle,
              userHandle
              // Store the acting user's handle
            },
            visibility: "public"
          }
        });
      }
      return res.json({
        success: true,
        added,
        message: added ? "Reaction added successfully" : "Reaction removed successfully"
      });
    } catch (error) {
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
      if (targetDiscordId === currentUser.discordId) {
        return res.status(400).json({
          success: false,
          error: "You cannot follow yourself"
        });
      }
      const fromUser = await findOrCreateUser(currentUser.discordId);
      const targetUser = await findOrCreateUser(targetDiscordId);
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
        await prisma.userFollow.delete({
          where: { id: existingFollow.id }
        });
        following = false;
      } else {
        await prisma.userFollow.create({
          data: {
            followerId: fromUser.id,
            followingId: targetUser.id
          }
        });
        following = true;
        let targetUserHandle = `Player ${targetDiscordId.slice(-4)}`;
        let userHandle = `Player ${currentUser.discordId.slice(-4)}`;
        const client = getDiscordClient();
        if (client && client.isReady()) {
          try {
            const targetDiscordUser = await client.users.fetch(targetDiscordId);
            targetUserHandle = targetDiscordUser.displayName || targetDiscordUser.username || targetUserHandle;
            const currentDiscordUser = await client.users.fetch(currentUser.discordId);
            userHandle = currentDiscordUser.displayName || currentDiscordUser.username || userHandle;
          } catch (error) {
            console.log("Discord API fetch failed, using fallback names");
          }
        } else {
          console.log("Discord client not available, using fallback names");
        }
        await prisma.activityFeedItem.create({
          data: {
            userId: fromUser.id,
            type: "follow",
            data: {
              targetUserId: targetUser.id,
              targetUserHandle,
              userHandle
              // Store the acting user's handle
            },
            visibility: "public"
          }
        });
      }
      return res.json({
        success: true,
        following,
        message: following ? "Now following user" : "Unfollowed user"
      });
    } catch (error) {
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
      const reactionCounts = await prisma.profileReaction.groupBy({
        by: ["reactionType"],
        where: { receiverId: targetUser.id },
        _count: { reactionType: true }
      });
      const reactions = {
        like: 0,
        fire: 0,
        diamond: 0,
        rocket: 0,
        star: 0
      };
      reactionCounts.forEach((count) => {
        reactions[count.reactionType] = count._count.reactionType;
      });
      const userReactions = await prisma.profileReaction.findMany({
        where: {
          giverId: currentUserData.id,
          receiverId: targetUser.id
        },
        select: { reactionType: true }
      });
      const isFollowing = await prisma.userFollow.findUnique({
        where: {
          followerId_followingId: {
            followerId: currentUserData.id,
            followingId: targetUser.id
          }
        }
      });
      const followerCount = await prisma.userFollow.count({
        where: { followingId: targetUser.id }
      });
      const followingCount = await prisma.userFollow.count({
        where: { followerId: targetUser.id }
      });
      return res.json({
        success: true,
        reactions,
        userReactions: userReactions.map((r) => r.reactionType),
        isFollowing: !!isFollowing,
        followerCount,
        followingCount
      });
    } catch (error) {
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
      const activities = await prisma.activityFeedItem.findMany({
        where: { visibility: "public" },
        include: {
          user: {
            select: {
              discordId: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 20
      });
      const discordIdsNeedingFetch = activities.filter((activity) => {
        const data = activity.data;
        return !data.userHandle || data.userHandle.startsWith("User#");
      }).map((activity) => activity.user.discordId);
      const uniqueDiscordIds = [...new Set(discordIdsNeedingFetch)];
      const discordUserMap = /* @__PURE__ */ new Map();
      const client = getDiscordClient();
      if (client && client.isReady() && uniqueDiscordIds.length > 0) {
        await Promise.allSettled(
          uniqueDiscordIds.map(async (discordId) => {
            try {
              const user = await client.users.fetch(discordId);
              const displayName = user.displayName || user.username;
              if (displayName) {
                discordUserMap.set(discordId, displayName);
              }
            } catch (error) {
              discordUserMap.set(discordId, `Player ${discordId.slice(-4)}`);
            }
          })
        );
      }
      const formattedActivities = activities.map((activity) => {
        const data = activity.data;
        let text = "";
        let icon = "\u{1F4DD}";
        let username = data.userHandle;
        if (!username || username.startsWith("User#")) {
          username = discordUserMap.get(activity.user.discordId) || `Player ${activity.user.discordId.slice(-4)}`;
        }
        switch (activity.type) {
          case "reaction":
            const reactionEmojis = {
              like: "\u{1F44D}",
              fire: "\u{1F525}",
              diamond: "\u{1F48E}",
              rocket: "\u{1F680}",
              star: "\u2B50"
            };
            icon = reactionEmojis[data.reactionType] || "\u{1F44D}";
            text = `${username} reacted with ${icon} to ${data.targetUserHandle}`;
            break;
          case "follow":
            icon = "\u{1F465}";
            text = `${username} started following ${data.targetUserHandle}`;
            break;
          case "tip":
            icon = "\u{1F4B8}";
            let amount = data.amount || "0";
            let token = data.token || data.tokenSymbol || "Unknown";
            if (typeof amount === "string" && amount.includes(" ")) {
              const parts = amount.trim().split(" ");
              amount = parts[0];
              if (!data.token) {
                token = parts[1];
              }
            }
            if (typeof token === "string" && token.includes(" ")) {
              const parts = token.trim().split(" ");
              token = parts[0];
            }
            let tipDisplay = `${amount} ${token}`;
            if (data.usdValue && data.usdValue > 0) {
              tipDisplay += ` ($${data.usdValue.toFixed(2)} USD)`;
            } else if (data.usdPrice && data.usdPrice > 0) {
              const numericAmount = parseFloat(amount.toString());
              if (!isNaN(numericAmount)) {
                const usdValue = numericAmount * data.usdPrice;
                tipDisplay += ` ($${usdValue.toFixed(2)} USD)`;
              }
            }
            const targetHandle = data.targetUserHandle && !data.targetUserHandle.startsWith("User#") ? data.targetUserHandle : `User#${String(data.targetUserId).slice(-4)}`;
            text = `${username} sent a tip of ${tipDisplay} to ${targetHandle}`;
            break;
          case "achievement":
            icon = "\u{1F3C6}";
            text = `${username} unlocked achievement: ${data.achievementName}`;
            break;
          case "join":
            icon = "\u{1F48E}";
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
      });
      return res.json({
        success: true,
        activities: formattedActivities
      });
    } catch (error) {
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
      const isNumericQuery = /^\d+$/.test(query);
      let users;
      if (isNumericQuery) {
        users = await prisma.user.findMany({
          where: {
            AND: [
              { discordId: { not: currentUser.discordId } },
              // Exclude self
              { discordId: { contains: query, mode: "insensitive" } }
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
            { showInPenguBook: "desc" },
            { wins: "desc" },
            { createdAt: "desc" }
          ]
        });
      } else {
        users = await prisma.user.findMany({
          where: {
            discordId: { not: currentUser.discordId }
            // Exclude self
          },
          select: {
            discordId: true,
            createdAt: true,
            wins: true,
            bio: true,
            showInPenguBook: true
          },
          take: 50,
          // Get more users for username filtering
          orderBy: [
            { showInPenguBook: "desc" },
            { wins: "desc" },
            { createdAt: "desc" }
          ]
        });
      }
      const client = getDiscordClient();
      console.log(`[Search API] Discord client available: ${!!client}, ready: ${client?.isReady()}`);
      const uniqueDiscordIds = [...new Set(users.map((user) => user.discordId))];
      const discordUserMap = /* @__PURE__ */ new Map();
      if (client && client.isReady() && uniqueDiscordIds.length > 0) {
        console.log(`[Search API] Batch fetching ${uniqueDiscordIds.length} Discord users`);
        const results = await Promise.allSettled(
          uniqueDiscordIds.map(async (discordId) => {
            try {
              const timeoutPromise = new Promise(
                (_, reject) => setTimeout(() => reject(new Error("Discord fetch timeout")), 2e3)
              );
              const fetchPromise = client.users.fetch(discordId);
              const discordUser = await Promise.race([fetchPromise, timeoutPromise]);
              const displayName = discordUser.displayName || discordUser.username;
              const avatarURL = discordUser.displayAvatarURL({ size: 64 });
              if (displayName) {
                discordUserMap.set(discordId, { displayName, avatarURL });
                console.log(`[Search API] Fetched ${discordId}: ${displayName}`);
              }
            } catch (error) {
              console.log(`[Search API] Failed to fetch Discord user ${discordId}: ${error.message}`);
              discordUserMap.set(discordId, {
                displayName: `Player ${discordId.slice(-4)}`,
                avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1)) % 6}.png`
              });
            }
          })
        );
      }
      const enhancedUsers = users.map((user) => {
        const defaultDisplayName = `Player ${user.discordId.slice(-4)}`;
        const defaultAvatarURL = `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discordId.slice(-1)) % 6}.png`;
        const discordData = discordUserMap.get(user.discordId);
        const displayName = discordData?.displayName || defaultDisplayName;
        const avatarURL = discordData?.avatarURL || defaultAvatarURL;
        return {
          discordId: user.discordId,
          displayName: displayName + (user.showInPenguBook ? " \u{1F4D6}" : ""),
          avatarURL,
          wins: user.wins,
          bioText: user.bio?.substring(0, 100) || "",
          inPenguBook: user.showInPenguBook,
          rawDisplayName: displayName
        };
      });
      const filteredUsers = enhancedUsers.filter((user) => {
        const lowerQuery = query.toLowerCase();
        if (isNumericQuery) {
          return user.discordId.toLowerCase().includes(lowerQuery);
        }
        if (user.rawDisplayName && !user.rawDisplayName.startsWith("Player ")) {
          if (user.rawDisplayName.toLowerCase().includes(lowerQuery)) {
            console.log(`[Search API] Username match: "${user.rawDisplayName}" contains "${query}"`);
            return true;
          }
        }
        if (user.discordId.toLowerCase().includes(lowerQuery)) {
          console.log(`[Search API] ID match: "${user.discordId}" contains "${query}"`);
          return true;
        }
        if (user.bioText && user.bioText.toLowerCase().includes(lowerQuery)) {
          console.log(`[Search API] Bio match: "${user.bioText}" contains "${query}"`);
          return true;
        }
        return false;
      });
      console.log(`[Search API] Query "${query}" (numeric: ${isNumericQuery}) filtered ${enhancedUsers.length} users down to ${filteredUsers.length} results`);
      return res.json({
        success: true,
        users: filteredUsers.slice(0, 10)
        // Limit to top 10 results
      });
    } catch (error) {
      console.error("User search API error:", error);
      res.status(500).json({ success: false, error: "Failed to search users" });
    }
  },
  // POST /pengubook/api/claim-daily - Claim daily PIPChips
  async claimDaily(req, res) {
    try {
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      await ensureUser(currentUser.discordId);
      const streakInfo = await pipchipsService.getStreakInfo(currentUser.discordId);
      if (!streakInfo.canClaim) {
        const hours = Math.floor(streakInfo.hoursUntilNext);
        const minutes = Math.floor((streakInfo.hoursUntilNext - hours) * 60);
        return res.json({
          success: false,
          error: "Daily bonus already claimed",
          data: {
            currentStreak: streakInfo.currentStreak,
            streakMultiplier: streakInfo.streakMultiplier,
            hoursUntilNext: hours,
            minutesUntilNext: minutes,
            nextClaimTime: `${hours}h ${minutes}m`
          }
        });
      }
      const result = await pipchipsService.claimDailyBonus(currentUser.discordId);
      return res.json({
        success: true,
        message: "Daily bonus claimed successfully!",
        data: {
          bonusAmount: Number(result.amount),
          newBalance: Number(result.newBalance),
          newStreak: result.newStreak,
          streakMultiplier: result.streakMultiplier
        }
      });
    } catch (error) {
      console.error("Claim daily API error:", error);
      res.status(500).json({ success: false, error: "Failed to claim daily bonus" });
    }
  },
  // GET /pengubook/api/buy-chips-options - Get available PIPChips packages
  async buyChipsOptions(req, res) {
    try {
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const packages = await prisma.pipchipsPackage.findMany({
        where: {
          isActive: true
        },
        orderBy: [
          { tokenSymbol: "asc" },
          { pipchipsAmount: "asc" }
        ]
      });
      const packagesByToken = {};
      packages.forEach((pkg) => {
        if (!packagesByToken[pkg.tokenSymbol]) {
          packagesByToken[pkg.tokenSymbol] = [];
        }
        packagesByToken[pkg.tokenSymbol].push({
          id: pkg.id,
          pipchipsAmount: Number(pkg.pipchipsAmount),
          tokenCost: Number(pkg.tokenCost),
          tokenSymbol: pkg.tokenSymbol,
          description: `${Number(pkg.pipchipsAmount).toLocaleString()} PIPChips for ${Number(pkg.tokenCost)} ${pkg.tokenSymbol}`
        });
      });
      return res.json({
        success: true,
        packages: packagesByToken,
        availableTokens: Object.keys(packagesByToken)
      });
    } catch (error) {
      console.error("Buy chips options API error:", error);
      res.status(500).json({ success: false, error: "Failed to get chip packages" });
    }
  },
  // POST /pengubook/api/tip-preview - Preview tip with tax calculation
  async tipPreview(req, res) {
    try {
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const { tokenId, amount } = req.body;
      if (!tokenId || !amount) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: tokenId, amount"
        });
      }
      if (typeof amount !== "number" || amount <= 0 || amount > 1e15) {
        return res.status(400).json({
          success: false,
          error: "Invalid amount"
        });
      }
      const { getActiveTokens } = await import("../../../services/token.js");
      const tokens = await getActiveTokens();
      const token = tokens.find((t) => t.id === parseInt(tokenId));
      if (!token || !token.active) {
        return res.status(404).json({
          success: false,
          error: "Token not found or inactive"
        });
      }
      const { getConfig } = await import("../../../config.js");
      const { RoleTaxBenefitService } = await import("../../../services/role_tax_benefits.js");
      const { userHasActiveTaxFreeTier } = await import("../../../services/tiers.js");
      const { toAtomicDirect, formatAmount, bigToDecDirect } = await import("../../../services/token.js");
      const fromUser = await findOrCreateUser(currentUser.discordId);
      const cfg = await getConfig();
      const bestTaxBenefit = await RoleTaxBenefitService.getBestTaxBenefit(
        fromUser.id,
        "",
        // No guild for PenguBook tips
        currentUser.discordId
      );
      let feeBpsNum = token.tipFeeBps ?? cfg?.tipFeeBps ?? 100;
      if (bestTaxBenefit) {
        const taxReduction = bestTaxBenefit.exemptionRate / 100;
        feeBpsNum = Math.round(feeBpsNum * (1 - taxReduction));
      } else {
        const taxFree = await userHasActiveTaxFreeTier(fromUser.id);
        feeBpsNum = taxFree ? 0 : feeBpsNum;
      }
      const feeBps = BigInt(feeBpsNum);
      const atomic = toAtomicDirect(amount, token.decimals);
      let feeAtomic = atomic * feeBps / 10000n;
      const remainder = atomic * feeBps % 10000n;
      if (remainder > 0n) {
        feeAtomic = feeAtomic + 1n;
      }
      if (feeBps > 0n && feeAtomic === 0n) {
        feeAtomic = 1n;
      }
      const totalNeeded = atomic + feeAtomic;
      const feeFormatted = formatAmount(feeAtomic, token);
      const totalFormatted = formatAmount(totalNeeded, token);
      const originalFeeBps = token.tipFeeBps ?? cfg?.tipFeeBps ?? 100;
      const originalFee = atomic * BigInt(originalFeeBps) / 10000n;
      const taxSavedAtomic = originalFee - feeAtomic;
      const taxSavedFormatted = formatAmount(taxSavedAtomic, token);
      return res.json({
        success: true,
        preview: {
          amount,
          amountFormatted: formatAmount(atomic, token),
          fee: bigToDecDirect(feeAtomic, token.decimals),
          feeFormatted,
          total: bigToDecDirect(totalNeeded, token.decimals),
          totalFormatted,
          taxSaved: bigToDecDirect(taxSavedAtomic, token.decimals),
          taxSavedFormatted,
          tokenSymbol: token.symbol,
          effectiveFeeBps: Number(feeBps),
          originalFeeBps,
          benefitLabel: bestTaxBenefit?.label || null,
          exemptionRate: bestTaxBenefit?.exemptionRate || 0
        }
      });
    } catch (error) {
      console.error("Tip preview API error:", error);
      res.status(500).json({ success: false, error: "Failed to calculate tip preview" });
    }
  },
  // POST /pengubook/api/create-market - Create new PIPChips prediction market
  async createMarket(req, res) {
    try {
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      await ensureUser(currentUser.discordId);
      const { title, description, resolveAt, marketType = "YES_NO" } = req.body;
      if (!title || !description || !resolveAt) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: title, description, resolveAt"
        });
      }
      const resolveDate = new Date(resolveAt);
      const now = /* @__PURE__ */ new Date();
      if (resolveDate <= now) {
        return res.status(400).json({
          success: false,
          error: "Market must resolve in the future"
        });
      }
      const minResolveTime = new Date(now.getTime() + 60 * 60 * 1e3);
      if (resolveDate < minResolveTime) {
        return res.status(400).json({
          success: false,
          error: "Market must resolve at least 1 hour from now"
        });
      }
      const { checkMarketCreationPermission } = await import("../../../services/tiers.js");
      const tierPerms = await checkMarketCreationPermission(currentUser.discordId);
      if (!tierPerms.allowed || !tierPerms.permissions?.canCreateMarkets) {
        return res.status(403).json({
          success: false,
          error: "You don't have permission to create markets. Consider upgrading your tier."
        });
      }
      const { predictionMarkets } = await import("../../../services/prediction_markets.js");
      const marketParams = {
        title: title.trim(),
        description: description.trim(),
        resolveAt: resolveDate,
        creatorId: currentUser.discordId,
        guildId: "web",
        // Special identifier for web-created markets
        channelId: "pengubook",
        tokenSymbol: "PIPCHIPS",
        marketType,
        marketData: {
          source: "pengubook",
          createdVia: "web"
        },
        rakePercentage: tierPerms.permissions?.customRakePercent || 3
      };
      const market = await predictionMarkets.createMarket(marketParams);
      return res.json({
        success: true,
        message: "Market created successfully!",
        market: {
          id: market.id,
          title: market.title,
          description: market.description,
          resolveAt: market.resolveAt,
          marketType: market.marketType,
          outcomes: ["YES", "NO"],
          // Standard binary market outcomes
          liquidity: Number(market.liquidity),
          creator: currentUser.discordId,
          tierName: tierPerms.tierName,
          liquidityBonus: 0,
          // Will be calculated by the prediction markets service
          marketFee: tierPerms.permissions?.customRakePercent || 3
        }
      });
    } catch (error) {
      console.error("Create market API error:", error);
      res.status(500).json({
        success: false,
        error: error?.message || "Failed to create market"
      });
    }
  }
};
function getTimeAgo(date) {
  const now = /* @__PURE__ */ new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1e3);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffSeconds < 60) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}
export {
  apiHandlers
};
//# sourceMappingURL=api.js.map
