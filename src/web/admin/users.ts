// src/web/admin/users.ts
import { Router } from "express";
import { prisma } from "../../services/db.js";
import { fetchMultipleUsernames, getDiscordClient } from "../../services/discord_users.js";

export const usersRouter = Router();

// Auto-complete search for users (returns multiple matches)
usersRouter.get("/users/autocomplete", async (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query || query.length < 2) return res.json({ ok: true, users: [] });

    // Search by Discord ID or username pattern
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { discordId: { contains: query } },
          // We could add username search if we stored it, but for now just Discord ID
        ]
      },
      take: 10, // Limit to 10 results for autocomplete
      select: {
        id: true,
        discordId: true,
        agwAddress: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Skip Discord username fetching for now to speed up autocomplete
    // const discordIds = users.map(u => u.discordId);
    // let usernames = new Map();
    // try {
    //   const client = getDiscordClient();
    //   if (client && discordIds.length > 0) {
    //     usernames = await fetchMultipleUsernames(client, discordIds);
    //   }
    // } catch (error) {
    //   console.warn("Failed to fetch usernames for autocomplete:", error);
    // }

    const formattedUsers = users.map(user => ({
      ...user,
      username: `User ${user.discordId.slice(0, 8)}...`,
    }));

    res.json({ ok: true, users: formattedUsers });
  } catch (error) {
    console.error("Autocomplete search failed:", error);
    res.status(500).json({ ok: false, error: "Search failed" });
  }
});

usersRouter.get("/users/search", async (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ ok: false, error: "Query parameter required" });

    let user;
    if (/^[0-9]{17,20}$/.test(query)) {
      // Discord ID search
      user = await prisma.user.findUnique({
        where: { discordId: query },
        include: {
          balances: { include: { Token: true } },
          tierMemberships: {
            where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
            include: { tier: true }
          }
        }
      });
    } else if (/^0x[a-fA-F0-9]{40}$/.test(query)) {
      // Wallet address search
      user = await prisma.user.findFirst({
        where: { agwAddress: query.toLowerCase() },
        include: {
          balances: { include: { Token: true } },
          tierMemberships: {
            where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
            include: { tier: true }
          }
        }
      });
    }

    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    // Get tip statistics for the user
    const [tipsSent, tipsReceived] = await Promise.all([
      prisma.tip.aggregate({
        where: { fromUserId: user.id },
        _count: { id: true },
        _sum: { amountAtomic: true }
      }),
      prisma.tip.aggregate({
        where: { toUserId: user.id },
        _count: { id: true },
        _sum: { amountAtomic: true }
      })
    ]);

    // Fetch Discord username
    let username = `User ${user.discordId.slice(0, 8)}...`;
    try {
      const client = getDiscordClient();
      if (client) {
        const usernames = await fetchMultipleUsernames(client, [user.discordId]);
        username = usernames.get(user.discordId) || username;
      }
    } catch (error) {
      console.warn("Failed to fetch username:", error);
    }

    const formattedUser = {
      ...user,
      username,
      totalTipsSent: tipsSent._count.id || 0,
      totalTipsReceived: tipsReceived._count.id || 0,
      totalAmountSent: tipsSent._sum.amountAtomic?.toString() || "0",
      totalAmountReceived: tipsReceived._sum.amountAtomic?.toString() || "0",
      balances: user.balances?.map((b: any) => ({
        amount: Number(b.amount),
        tokenSymbol: b.Token.symbol
      })) || [],
      membershipDetails: user.tierMemberships?.map((m: any) => ({
        tierName: m.tier.name,
        status: m.status,
        expiresAt: m.expiresAt
      })) || []
    };

    res.json({ ok: true, user: formattedUser });
  } catch {
    res.status(500).json({ ok: false, error: "Search failed" });
  }
});

usersRouter.get("/users/top", async (req, res) => {
  try {
    console.log("🔍 Loading top users...");
    const users = await prisma.user.findMany({
      take: 100,
      include: {
        balances: { include: { Token: true } },
        tierMemberships: {
          where: { status: 'ACTIVE', expiresAt: { gt: new Date() } },
          include: { tier: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`📊 Found ${users.length} users in database`);

    // Get tip statistics for each user
    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const [tipsSent, tipsReceived] = await Promise.all([
          prisma.tip.aggregate({
            where: { fromUserId: user.id },
            _count: { id: true },
            _sum: { amountAtomic: true }
          }),
          prisma.tip.aggregate({
            where: { toUserId: user.id },
            _count: { id: true },
            _sum: { amountAtomic: true }
          })
        ]);

        return {
          ...user,
          totalTipsSent: tipsSent._count.id || 0,
          totalTipsReceived: tipsReceived._count.id || 0,
          totalAmountSent: tipsSent._sum.amountAtomic?.toString() || "0",
          totalAmountReceived: tipsReceived._sum.amountAtomic?.toString() || "0"
        };
      })
    );

    // Fetch Discord usernames
    const discordIds = users.map(u => u.discordId);
    let usernames = new Map();
    try {
      const client = getDiscordClient();
      if (client && discordIds.length > 0) {
        usernames = await fetchMultipleUsernames(client, discordIds);
      }
    } catch (error) {
      console.warn("Failed to fetch usernames:", error);
    }

    const formattedUsers = usersWithStats.map(user => ({
      ...user,
      username: usernames.get(user.discordId) || `User ${user.discordId.slice(0, 8)}...`,
      balances: user.balances?.map((b: any) => ({
        amount: Number(b.amount),
        tokenSymbol: b.Token.symbol
      })) || [],
      membershipDetails: user.tierMemberships?.map((m: any) => ({
        tierName: m.tier.name,
        status: m.status,
        expiresAt: m.expiresAt
      })) || []
    }));

    console.log(`✅ Returning ${formattedUsers.length} formatted users to client`);
    res.json({ ok: true, users: formattedUsers });
  } catch (error) {
    console.error("❌ Failed to load top users:", error);
    res.status(500).json({ ok: false, error: "Failed to load users" });
  }
});

usersRouter.post("/users/adjust-balance", async (req, res) => {
  try {
    const { discordId, tokenId, amount, reason } = req.body;

    if (!discordId || !tokenId || typeof amount !== 'number') {
      return res.status(400).json({ ok: false, error: "Missing required parameters" });
    }

    const user = await prisma.user.findUnique({ where: { discordId } });
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const token = await prisma.token.findUnique({ where: { id: tokenId } });
    if (!token) return res.status(404).json({ ok: false, error: "Token not found" });

    await prisma.userBalance.upsert({
      where: { userId_tokenId: { userId: user.id, tokenId } },
      update: { amount },
      create: { userId: user.id, tokenId, amount }
    });

    await prisma.transaction.create({
      data: {
        type: 'ADMIN_ADJUSTMENT',
        userId: user.id,
        tokenId,
        amount,
        fee: '0',
        metadata: reason || 'Admin balance adjustment'
      }
    });

    res.json({ ok: true, message: "Balance adjusted successfully" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to adjust balance" });
  }
});

usersRouter.delete("/users/:discordId", async (req, res) => {
  try {
    const { discordId } = req.params;
    const { confirmed, hardDelete } = req.body;

    if (!discordId) {
      return res.status(400).json({ ok: false, error: "Discord ID required" });
    }

    if (!confirmed) {
      return res.status(400).json({ ok: false, error: "Deletion must be confirmed" });
    }

    const user = await prisma.user.findUnique({ where: { discordId } });
    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    if (hardDelete) {
      // HARD DELETE: Completely remove all records (for admin cleanup)
      await prisma.$transaction(async (tx) => {
        await tx.userBalance.deleteMany({ where: { userId: user.id } });
        await tx.transaction.deleteMany({ where: { OR: [{ userId: user.id }, { otherUserId: user.id }] } });
        await tx.tierMembership.deleteMany({ where: { userId: user.id } });
        await tx.tip.deleteMany({ where: { OR: [{ fromUserId: user.id }, { toUserId: user.id }] } });
        await tx.groupTipClaim.deleteMany({ where: { userId: user.id } });
        await tx.groupTip.deleteMany({ where: { creatorId: user.id } });
        await tx.match.deleteMany({ where: { OR: [{ challengerId: user.id }, { joinerId: user.id }] } });
        await tx.notification.deleteMany({ where: { userId: user.id } });
        await tx.user.delete({ where: { id: user.id } });
      });

      res.json({ ok: true, message: "User and all associated data permanently deleted" });
    } else {
      // SOFT DELETE: Anonymize user data but preserve transaction history
      await prisma.$transaction(async (tx) => {
        // Delete personal data
        await tx.userBalance.deleteMany({ where: { userId: user.id } });
        await tx.tierMembership.deleteMany({ where: { userId: user.id } });
        await tx.notification.deleteMany({ where: { userId: user.id } });
        
        // Anonymize transactions (set user references to null)
        await tx.transaction.updateMany({
          where: { userId: user.id },
          data: { userId: null }
        });
        await tx.transaction.updateMany({
          where: { otherUserId: user.id },
          data: { otherUserId: null }
        });
        
        // Anonymize tips 
        await tx.tip.updateMany({
          where: { fromUserId: user.id },
          data: { fromUserId: null }
        });
        await tx.tip.updateMany({
          where: { toUserId: user.id },
          data: { toUserId: null }
        });
        
        // Anonymize matches
        await tx.match.updateMany({
          where: { challengerId: user.id },
          data: { challengerId: null }
        });
        await tx.match.updateMany({
          where: { joinerId: user.id },
          data: { joinerId: null }
        });
        await tx.match.updateMany({
          where: { winnerUserId: user.id },
          data: { winnerUserId: null }
        });
        
        // Anonymize group tips
        await tx.groupTip.updateMany({
          where: { creatorId: user.id },
          data: { creatorId: null }
        });
        await tx.groupTipClaim.updateMany({
          where: { userId: user.id },
          data: { userId: null }
        });
        
        // Finally delete the user record
        await tx.user.delete({ where: { id: user.id } });
      });

      res.json({ ok: true, message: "User deleted and data anonymized (transaction history preserved)" });
    }
  } catch (error) {
    console.error("Failed to delete user:", error);
    res.status(500).json({ ok: false, error: "Failed to delete user" });
  }
});