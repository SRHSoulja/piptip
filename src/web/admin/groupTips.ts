// src/web/admin/groupTips.ts
import { Router, Request, Response } from "express";
import { prisma } from "../../services/db.js";

export const groupTipsRouter = Router();

groupTipsRouter.get("/group-tips", async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const where: any = {};
    if (status) where.status = status;

    const groupTips = await prisma.groupTip.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        Token: true,
        Creator: true,
        _count: { select: { claims: true } }
      }
    });

    const formattedTips = groupTips.map(gt => ({
      ...gt,
      claimCount: gt._count.claims
    }));

    res.json({ ok: true, groupTips: formattedTips });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load group tips" });
  }
});

groupTipsRouter.post("/group-tips/expire-stuck", async (req: Request, res: Response) => {
  try {
    const result = await prisma.groupTip.updateMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: new Date() }
      },
      data: { status: 'EXPIRED' }
    });

    res.json({ ok: true, count: result.count });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to expire stuck tips" });
  }
});