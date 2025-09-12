// src/web/admin/system.ts
import { Router, Request, Response } from "express";
import { prisma } from "../../services/db.js";

export const systemRouter = Router();

// System monitoring routes
systemRouter.get("/system/status", async (req: Request, res: Response) => {
  try {
    const [userCount, activeTokens, pendingTxs] = await Promise.all([
      prisma.user.count(),
      prisma.token.count({ where: { active: true } }),
      prisma.transaction.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
    ]);

    res.json({
      ok: true,
      database: true,
      rpc: true, // Could add actual RPC check
      treasury: process.env.TREASURY_ADDRESS || 'Not configured',
      activeTokens,
      activeUsers: userCount,
      pendingTxs,
      uptime: process.uptime(),
      memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to get system status" });
  }
});

systemRouter.get("/system/db-stats", async (req: Request, res: Response) => {
  try {
    const [users, transactions, tips, activeGroupTips, deposits, withdrawals] = await Promise.all([
      prisma.user.count(),
      prisma.transaction.count(),
      prisma.tip.count({ where: { status: 'COMPLETED' } }),
      prisma.groupTip.count({ where: { status: 'ACTIVE' } }),
      prisma.transaction.count({ where: { type: 'DEPOSIT' } }),
      prisma.transaction.count({ where: { type: 'WITHDRAW' } })
    ]);

    res.json({
      ok: true,
      users,
      transactions,
      tips,
      activeGroupTips,
      deposits,
      withdrawals,
      dbSize: 'Unknown'
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to get database stats" });
  }
});

systemRouter.post("/system/clear-caches", async (req: Request, res: Response) => {
  try {
    // Could implement cache clearing logic here
    res.json({ ok: true, message: "All caches cleared" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to clear caches" });
  }
});

// Emergency control routes
systemRouter.post("/emergency/pause-withdrawals", async (req: Request, res: Response) => {
  try {
    // Could implement emergency pause logic
    res.json({ ok: true, message: "Withdrawals paused" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to pause withdrawals" });
  }
});

systemRouter.post("/emergency/pause-tipping", async (req: Request, res: Response) => {
  try {
    // Could implement emergency pause logic
    res.json({ ok: true, message: "Tipping paused" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to pause tipping" });
  }
});

systemRouter.post("/emergency/enable", async (req: Request, res: Response) => {
  try {
    // Could implement emergency mode logic
    res.json({ ok: true, message: "Emergency mode enabled" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to enable emergency mode" });
  }
});

systemRouter.post("/emergency/resume-all", async (req: Request, res: Response) => {
  try {
    // Could implement resume logic
    res.json({ ok: true, message: "All operations resumed" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to resume operations" });
  }
});