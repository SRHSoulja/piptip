// src/web/admin/transactions.ts
import { Router } from "express";
import { prisma } from "../../services/db.js";

export const transactionsRouter = Router();

transactionsRouter.get("/transactions", async (req, res) => {
  try {
    const { type, userId, since, limit = 50 } = req.query;
    const where: any = {};
    
    if (type) where.type = type;
    if (userId) {
      const user = await prisma.user.findUnique({ where: { discordId: userId as string } });
      if (user) where.userId = user.id;
    }
    if (since) where.createdAt = { gte: new Date(since as string) };

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string)
    });

    res.json({ ok: true, transactions });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load transactions" });
  }
});

transactionsRouter.get("/transactions/export", async (req, res) => {
  try {
    const { type, userId, since } = req.query;
    const where: any = {};
    
    if (type) where.type = type;
    if (userId) {
      const user = await prisma.user.findUnique({ where: { discordId: userId as string } });
      if (user) where.userId = user.id;
    }
    if (since) where.createdAt = { gte: new Date(since as string) };

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    let csv = "id,type,userId,amount,token,fee,createdAt,guildId,metadata\\n";
    transactions.forEach(tx => {
      csv += `${tx.id},"${tx.type}","${tx.userId || ''}","${tx.amount}","${tx.tokenId || ''}","${tx.fee || ''}","${tx.createdAt.toISOString()}","${tx.guildId || ''}","${tx.metadata || ''}"\\n`;
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="transactions_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch {
    res.status(500).json({ ok: false, error: "Failed to export transactions" });
  }
});