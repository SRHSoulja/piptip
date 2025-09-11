// src/web/admin/transactions.ts
import { Router } from "express";
import { prisma } from "../../services/db.js";

export const transactionsRouter = Router();

transactionsRouter.get("/transactions", async (req, res) => {
  try {
    const { type, userId, since, limit = 50 } = req.query;
    const where: any = {};
    
    // Always exclude system backup transactions unless specifically requested
    if (type === 'SYSTEM_BACKUP') {
      where.type = 'SYSTEM_BACKUP';
    } else if (type) {
      where.type = type;
    } else {
      // Exclude system backup transactions by default
      where.type = { not: 'SYSTEM_BACKUP' };
    }
    
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
    
    // Always exclude system backup transactions unless specifically requested
    if (type === 'SYSTEM_BACKUP') {
      where.type = 'SYSTEM_BACKUP';
    } else if (type) {
      where.type = type;
    } else {
      // Exclude system backup transactions by default
      where.type = { not: 'SYSTEM_BACKUP' };
    }
    
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

// Enhanced user-specific export with all activity types
transactionsRouter.get("/transactions/export/user/:discordId", async (req, res) => {
  try {
    const { discordId } = req.params;
    const { since, until } = req.query;

    const user = await prisma.user.findUnique({ 
      where: { discordId },
      select: { id: true, discordId: true, agwAddress: true, createdAt: true }
    });

    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const dateFilter: any = {};
    if (since) dateFilter.gte = new Date(since as string);
    if (until) dateFilter.lte = new Date(until as string);

    // Get all user activity in parallel
    const [transactions, tips, groupTips, matches, balances] = await Promise.all([
      // Direct transactions
      prisma.transaction.findMany({
        where: { 
          OR: [{ userId: user.id }, { otherUserId: user.id }],
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
        },
        orderBy: { createdAt: 'desc' }
      }),

      // Tips sent/received
      prisma.tip.findMany({
        where: { 
          OR: [{ fromUserId: user.id }, { toUserId: user.id }],
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
        },
        include: { Token: true },
        orderBy: { createdAt: 'desc' }
      }),

      // Group tips created/claimed
      Promise.all([
        prisma.groupTip.findMany({
          where: { 
            creatorId: user.id,
            ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
          },
          include: { Token: true },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.groupTipClaim.findMany({
          where: { 
            userId: user.id,
            ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
          },
          include: { GroupTip: { include: { Token: true } } },
          orderBy: { createdAt: 'desc' }
        })
      ]).then(([created, claimed]) => ({ created, claimed })),

      // Matches played
      prisma.match.findMany({
        where: { 
          OR: [{ challengerId: user.id }, { joinerId: user.id }],
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
        },
        include: { Token: true },
        orderBy: { createdAt: 'desc' }
      }),

      // Current balances
      prisma.userBalance.findMany({
        where: { userId: user.id },
        include: { Token: true }
      })
    ]);

    // Get token map for reference
    const tokens = await prisma.token.findMany({ select: { id: true, symbol: true } });
    const tokenMap = new Map(tokens.map(t => [t.id, t.symbol]));

    let csv = "timestamp,activity_type,direction,amount,token,fee,counterpart,guild_id,status,details\\n";

    // Add transactions
    transactions.forEach(tx => {
      const token = tx.tokenId ? tokenMap.get(tx.tokenId) || 'Unknown' : 'N/A';
      const direction = tx.userId === user.id ? 'outgoing' : 'incoming';
      const counterpart = tx.otherUserId ? `user_${tx.otherUserId}` : 'system';
      csv += `"${tx.createdAt.toISOString()}","transaction","${direction}","${tx.amount}","${token}","${tx.fee}","${counterpart}","${tx.guildId || ''}","completed","${tx.type}: ${tx.metadata || ''}"\\n`;
    });

    // Add tips
    tips.forEach(tip => {
      const direction = tip.fromUserId === user.id ? 'sent' : 'received';
      const counterpart = direction === 'sent' ? `user_${tip.toUserId}` : `user_${tip.fromUserId}`;
      csv += `"${tip.createdAt.toISOString()}","tip","${direction}","${tip.amountAtomic}","${tip.Token?.symbol || 'Unknown'}","${tip.feeAtomic}","${counterpart}","","${tip.status}","${tip.note || ''}"\\n`;
    });

    // Add group tips created
    groupTips.created.forEach(gt => {
      csv += `"${gt.createdAt.toISOString()}","group_tip","created","${gt.totalAmount}","${gt.Token?.symbol || 'Unknown'}","${gt.taxAtomic}","group","${gt.guildId || ''}","${gt.status}","Duration: ${gt.duration}h"\\n`;
    });

    // Add group tips claimed
    groupTips.claimed.forEach(claim => {
      const claimTime = claim.claimedAt?.toISOString() || claim.createdAt.toISOString();
      csv += `"${claimTime}","group_tip","claimed","estimated_share","${claim.GroupTip.Token?.symbol || 'Unknown'}","0","group_${claim.groupTipId}","${claim.GroupTip.guildId || ''}","${claim.status}","Group tip claim"\\n`;
    });

    // Add matches
    matches.forEach(match => {
      const role = match.challengerId === user.id ? 'challenger' : 'joiner';
      const result = match.winnerUserId === user.id ? 'won' : (match.winnerUserId ? 'lost' : 'pending');
      csv += `"${match.createdAt.toISOString()}","match","${role}","${match.wagerAtomic}","${match.Token?.symbol || 'Unknown'}","${match.rakeAtomic}","opponent","","${match.status}","${result}"\\n`;
    });

    const filename = `user_${discordId}_activity_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (error) {
    console.error("User export error:", error);
    res.status(500).json({ ok: false, error: "Failed to export user data" });
  }
});

// Guild-specific export for tracking server activity
transactionsRouter.get("/transactions/export/guild/:guildId", async (req, res) => {
  try {
    const { guildId } = req.params;
    const { since, until } = req.query;

    const dateFilter: any = {};
    if (since) dateFilter.gte = new Date(since as string);
    if (until) dateFilter.lte = new Date(until as string);

    // Get all guild activity
    const [transactions, tips, groupTips, matches] = await Promise.all([
      // Guild transactions
      prisma.transaction.findMany({
        where: { 
          guildId,
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
        },
        orderBy: { createdAt: 'desc' }
      }),

      // Tips in guild (check if we track guild for tips - may need to join through other tables)
      prisma.tip.findMany({
        where: {
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
          // Note: Tips don't directly track guild - would need to cross-reference with Discord data
        },
        include: { Token: true },
        orderBy: { createdAt: 'desc' },
        take: 1000 // Limit to prevent huge exports
      }),

      // Group tips in guild
      prisma.groupTip.findMany({
        where: { 
          guildId,
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
        },
        include: { Token: true, claims: true },
        orderBy: { createdAt: 'desc' }
      }),

      // Matches in guild (similar issue - may not directly track guild)
      prisma.match.findMany({
        where: {
          ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
        },
        include: { Token: true },
        orderBy: { createdAt: 'desc' },
        take: 1000
      })
    ]);

    // Get token map
    const tokens = await prisma.token.findMany({ select: { id: true, symbol: true } });
    const tokenMap = new Map(tokens.map(t => [t.id, t.symbol]));

    let csv = "timestamp,activity_type,user_id,amount,token,fee,details,status\\n";

    // Add transactions
    transactions.forEach(tx => {
      const token = tx.tokenId ? tokenMap.get(tx.tokenId) || 'Unknown' : 'N/A';
      csv += `"${tx.createdAt.toISOString()}","transaction","${tx.userId || 'system'}","${tx.amount}","${token}","${tx.fee}","${tx.type}: ${tx.metadata || ''}","completed"\\n`;
    });

    // Add group tips
    groupTips.forEach(gt => {
      csv += `"${gt.createdAt.toISOString()}","group_tip","${gt.creatorId}","${gt.totalAmount}","${gt.Token?.symbol || 'Unknown'}","${gt.taxAtomic}","Duration: ${gt.duration}h, Claims: ${gt.claims?.length || 0}","${gt.status}"\\n`;
    });

    const filename = `guild_${guildId}_activity_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (error) {
    console.error("Guild export error:", error);
    res.status(500).json({ ok: false, error: "Failed to export guild data" });
  }
});