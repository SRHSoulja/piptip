// src/web/admin/users.ts
import { Router } from "express";
import { prisma } from "../../services/db.js";

export const usersRouter = Router();

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

    const formattedUser = {
      ...user,
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

    const formattedUsers = users.map(user => ({
      ...user,
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

    res.json({ ok: true, users: formattedUsers });
  } catch {
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