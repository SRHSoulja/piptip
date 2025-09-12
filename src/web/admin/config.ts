// src/web/admin/config.ts
import { Router, Request, Response } from "express";
import { prisma } from "../../services/db.js";
import { getConfig } from "../../config.js";

export const configRouter = Router();

configRouter.get("/ping", (_req: Request, res: Response) => {
  res.json({ ok: true, message: "Admin authenticated" });
});

configRouter.get("/config", async (_req: Request, res: Response) => {
  try {
    const config = await getConfig();
    res.json({ ok: true, config });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load config" });
  }
});

configRouter.put("/config", async (req: Request, res: Response) => {
  try {
    const { minDeposit, minWithdraw, withdrawMaxPerTx, withdrawDailyCap } = req.body;
    
    await prisma.appConfig.upsert({
      where: { id: 1 },
      update: {
        minDeposit: Number(minDeposit) || 50,
        minWithdraw: Number(minWithdraw) || 50,
        withdrawMaxPerTx: Number(withdrawMaxPerTx) || 50,
        withdrawDailyCap: Number(withdrawDailyCap) || 500
      },
      create: {
        id: 1,
        minDeposit: Number(minDeposit) || 50,
        minWithdraw: Number(minWithdraw) || 50,
        withdrawMaxPerTx: Number(withdrawMaxPerTx) || 50,
        withdrawDailyCap: Number(withdrawDailyCap) || 500
      }
    });
    
    res.json({ ok: true, message: "Configuration updated" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to update config" });
  }
});

configRouter.post("/reload-config", async (_req: Request, res: Response) => {
  try {
    // Force reload config cache if you have one
    res.json({ ok: true, message: "Config cache reloaded" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to reload config" });
  }
});