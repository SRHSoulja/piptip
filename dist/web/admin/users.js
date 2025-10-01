import { Router } from "express";
import { prisma } from "../../services/db.js";
import { fetchMultipleUsernames, getDiscordClient } from "../../services/discord_users.js";
const usersRouter = Router();
usersRouter.get("/users/autocomplete", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.length < 2) return res.json({ ok: true, users: [] });
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { discordId: { contains: query } }
          // We could add username search if we stored it, but for now just Discord ID
        ]
      },
      take: 10,
      // Limit to 10 results for autocomplete
      select: {
        id: true,
        discordId: true,
        agwAddress: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" }
    });
    const formattedUsers = users.map((user) => ({
      ...user,
      username: `User ${user.discordId.slice(0, 8)}...`
    }));
    res.json({ ok: true, users: formattedUsers });
  } catch (error) {
    console.error("Autocomplete search failed:", error);
    res.status(500).json({ ok: false, error: "Search failed" });
  }
});
usersRouter.get("/users/search", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ ok: false, error: "Query parameter required" });
    let user;
    if (/^[0-9]{17,20}$/.test(query)) {
      user = await prisma.user.findUnique({
        where: { discordId: query },
        include: {
          balances: { include: { Token: true } },
          tierMemberships: {
            where: { status: "ACTIVE", expiresAt: { gt: /* @__PURE__ */ new Date() } },
            include: { tier: true }
          }
        }
      });
    } else if (/^0x[a-fA-F0-9]{40}$/.test(query)) {
      user = await prisma.user.findFirst({
        where: { agwAddress: query.toLowerCase() },
        include: {
          balances: { include: { Token: true } },
          tierMemberships: {
            where: { status: "ACTIVE", expiresAt: { gt: /* @__PURE__ */ new Date() } },
            include: { tier: true }
          }
        }
      });
    }
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });
    const [tipsSent, tipsReceived, lastTip, lastMatch] = await Promise.all([
      prisma.tip.aggregate({
        where: { fromUserId: user.id, status: "COMPLETED" },
        _count: { id: true },
        _sum: { amountAtomic: true }
      }),
      prisma.tip.aggregate({
        where: { toUserId: user.id, status: "COMPLETED" },
        _count: { id: true },
        _sum: { amountAtomic: true }
      }),
      prisma.tip.findFirst({
        where: { OR: [{ fromUserId: user.id }, { toUserId: user.id }] },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
      }),
      prisma.match.findFirst({
        where: { OR: [{ challengerId: user.id }, { joinerId: user.id }] },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
      })
    ]);
    const lastActivity = [lastTip?.createdAt, lastMatch?.createdAt, user.updatedAt].filter((date) => date !== null && date !== void 0).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
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
      lastActivity,
      totalTipsSent: tipsSent._count.id || 0,
      totalTipsReceived: tipsReceived._count.id || 0,
      totalAmountSent: tipsSent._sum.amountAtomic?.toString() || "0",
      totalAmountReceived: tipsReceived._sum.amountAtomic?.toString() || "0",
      balances: user.balances?.map((b) => ({
        amount: Number(b.amount),
        tokenSymbol: b.Token.symbol
      })) || [],
      membershipDetails: user.tierMemberships?.map((m) => ({
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
    const users = await prisma.user.findMany({
      take: 10,
      // Start with just 10 users
      select: {
        id: true,
        discordId: true,
        agwAddress: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: "desc" }
    });
    const formattedUsers = users.map((user) => ({
      ...user,
      username: `User ${user.discordId.slice(0, 8)}...`,
      balances: [],
      membershipDetails: [],
      lastActivity: user.updatedAt,
      totalTipsSent: 0,
      totalTipsReceived: 0,
      totalAmountSent: "0",
      totalAmountReceived: "0"
    }));
    res.json({ ok: true, users: formattedUsers });
  } catch (error) {
    console.error("\u274C Failed to load top users:", error);
    console.error("\u274C Error details:", error instanceof Error ? error.message : String(error));
    console.error("\u274C Stack trace:", error instanceof Error ? error.stack : "No stack trace");
    res.status(500).json({ ok: false, error: "Failed to load users", details: error instanceof Error ? error.message : String(error) });
  }
});
usersRouter.post("/users/adjust-balance", async (req, res) => {
  try {
    const { discordId, tokenId, amount, reason } = req.body;
    if (!discordId || !tokenId || typeof amount !== "number") {
      return res.status(400).json({ ok: false, error: "Missing required parameters" });
    }
    const decimalPlaces = (amount.toString().split(".")[1] || "").length;
    if (decimalPlaces > 2) {
      return res.status(400).json({ ok: false, error: "Please limit your amount to 2 decimal places (e.g., 10.50)" });
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
        type: "ADMIN_ADJUSTMENT",
        userId: user.id,
        tokenId,
        amount,
        fee: "0",
        metadata: reason || "Admin balance adjustment"
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
      await prisma.$transaction(async (tx) => {
        await tx.userBalance.deleteMany({ where: { userId: user.id } });
        await tx.tierMembership.deleteMany({ where: { userId: user.id } });
        await tx.notification.deleteMany({ where: { userId: user.id } });
        await tx.transaction.updateMany({
          where: { userId: user.id },
          data: { userId: null }
        });
        await tx.transaction.updateMany({
          where: { otherUserId: user.id },
          data: { otherUserId: null }
        });
        await tx.tip.updateMany({
          where: { fromUserId: user.id },
          data: { fromUserId: null }
        });
        await tx.tip.updateMany({
          where: { toUserId: user.id },
          data: { toUserId: null }
        });
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
        await tx.groupTip.updateMany({
          where: { creatorId: user.id },
          data: { creatorId: null }
        });
        await tx.groupTipClaim.updateMany({
          where: { userId: user.id },
          data: { userId: null }
        });
        await tx.user.delete({ where: { id: user.id } });
      });
      res.json({ ok: true, message: "User deleted and data anonymized (transaction history preserved)" });
    }
  } catch (error) {
    console.error("Failed to delete user:", error);
    res.status(500).json({ ok: false, error: "Failed to delete user" });
  }
});
export {
  usersRouter
};
//# sourceMappingURL=users.js.map
