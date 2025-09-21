// src/web/admin/transactions.ts
import { Router } from "express";
import { prisma } from "../../services/db.js";
import { fetchMultipleUsernames, fetchMultipleServernames, getDiscordClient } from "../../services/discord_users.js";
export const transactionsRouter = Router();
transactionsRouter.get("/transactions", async (req, res) => {
    try {
        const { type, userId, since, limit = 50 } = req.query;
        const where = {};
        // Always exclude system backup transactions unless specifically requested
        if (type === 'SYSTEM_BACKUP') {
            where.type = 'SYSTEM_BACKUP';
        }
        else if (type) {
            where.type = type;
        }
        else {
            // Exclude system backup transactions by default
            where.type = { not: 'SYSTEM_BACKUP' };
        }
        if (userId) {
            const user = await prisma.user.findUnique({ where: { discordId: userId } });
            if (user)
                where.userId = user.id;
        }
        if (since)
            where.createdAt = { gte: new Date(since) };
        const transactions = await prisma.transaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit)
        });
        res.json({ ok: true, transactions });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to load transactions" });
    }
});
transactionsRouter.get("/transactions/export", async (req, res) => {
    try {
        const { type, userId, since } = req.query;
        const where = {};
        // Always exclude system backup transactions unless specifically requested
        if (type === 'SYSTEM_BACKUP') {
            where.type = 'SYSTEM_BACKUP';
        }
        else if (type) {
            where.type = type;
        }
        else {
            // Exclude system backup transactions by default
            where.type = { not: 'SYSTEM_BACKUP' };
        }
        if (userId) {
            const user = await prisma.user.findUnique({ where: { discordId: userId } });
            if (user)
                where.userId = user.id;
        }
        if (since)
            where.createdAt = { gte: new Date(since) };
        const transactions = await prisma.transaction.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });
        // Fetch server names for guild IDs
        const client = getDiscordClient();
        const guildIds = [...new Set(transactions.map(tx => tx.guildId).filter(Boolean))];
        let servernames = new Map();
        if (client && guildIds.length > 0) {
            try {
                servernames = await fetchMultipleServernames(client, guildIds);
                console.log(`Fetched ${servernames.size} server names for transaction export`);
            }
            catch (error) {
                console.error("Failed to fetch server names for export:", error);
            }
        }
        let csv = "id,type,userId,amount,token,fee,createdAt,serverName,guildId,metadata\\n";
        transactions.forEach(tx => {
            const serverName = tx.guildId ? (servernames.get(tx.guildId) || `Server#${tx.guildId.slice(-4)}`) : '';
            csv += `${tx.id},"${tx.type}","${tx.userId || ''}","${tx.amount}","${tx.tokenId || ''}","${tx.fee || ''}","${tx.createdAt.toISOString()}","${serverName}","${tx.guildId || ''}","${tx.metadata || ''}"\\n`;
        });
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="transactions_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csv);
    }
    catch {
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
        const dateFilter = {};
        if (since)
            dateFilter.gte = new Date(since);
        if (until)
            dateFilter.lte = new Date(until);
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
        // Get Discord client once for both username and server name fetching
        const client = getDiscordClient();
        // Fetch Discord username for the user
        let username = `User ${user.discordId.slice(0, 8)}...`;
        try {
            if (client) {
                const usernames = await fetchMultipleUsernames(client, [user.discordId]);
                username = usernames.get(user.discordId) || username;
            }
        }
        catch (error) {
            console.warn("Failed to fetch username for export:", error);
        }
        // Fetch server names for guild IDs
        const allGuildIds = [
            ...transactions.map(tx => tx.guildId),
            ...tips.map(tip => tip.guildId),
            ...groupTips.created.map(gt => gt.guildId),
            ...groupTips.claimed.map(claim => claim.GroupTip.guildId)
        ].filter(Boolean);
        const uniqueGuildIds = [...new Set(allGuildIds)];
        let servernames = new Map();
        if (client && uniqueGuildIds.length > 0) {
            try {
                servernames = await fetchMultipleServernames(client, uniqueGuildIds);
                console.log(`Fetched ${servernames.size} server names for user activity export`);
            }
            catch (error) {
                console.error("Failed to fetch server names for user export:", error);
            }
        }
        let csv = "username,user_discord_id,timestamp,activity_type,direction,tip_amount,token,tax_paid,total_deducted,tax_rate_bps,exemption_applied,exemption_rate,tax_saved,counterpart,server_name,guild_id,status,details\n";
        // Add transactions
        transactions.forEach(tx => {
            const token = tx.tokenId ? tokenMap.get(tx.tokenId) || 'Unknown' : 'N/A';
            const direction = tx.userId === user.id ? 'outgoing' : 'incoming';
            const counterpart = tx.otherUserId ? `user_${tx.otherUserId}` : 'system';
            // Check if this is a group tip related transaction by looking for group tip records around the same time
            let activityType = 'transaction';
            let status = 'completed';
            let details = `${tx.type}: ${tx.metadata || ''}`;
            // If it's a TIP transaction to/from the user around the same time as group tips, it might be a group tip refund/payout
            if (tx.type === 'TIP' && direction === 'incoming' && counterpart === 'system') {
                // Check if there's a matching refunded group tip
                const matchingGroupTip = groupTips.created.find(gt => gt.status === 'REFUNDED' &&
                    Math.abs(new Date(gt.createdAt).getTime() - new Date(tx.createdAt).getTime()) < 60000 // Within 1 minute
                );
                if (matchingGroupTip) {
                    activityType = 'group_tip_refund';
                    status = 'refunded';
                    details = `Group tip refunded - no claims received`;
                }
                else {
                    // Check for finalized group tips (payouts)
                    const finalizedGroupTip = groupTips.created.find(gt => gt.status === 'FINALIZED' &&
                        Math.abs(new Date(gt.createdAt).getTime() - new Date(tx.createdAt).getTime()) < 300000 // Within 5 minutes
                    );
                    if (finalizedGroupTip) {
                        activityType = 'group_tip_payout';
                        status = 'completed';
                        details = `Group tip payout share`;
                    }
                }
            }
            // Non-tip transactions - use basic format without tax breakdown
            const serverName = tx.guildId ? (servernames.get(tx.guildId) || `Server#${tx.guildId.slice(-4)}`) : '';
            csv += `"${username}","${user.discordId}","${tx.createdAt.toISOString()}","${activityType}","${direction}","${tx.amount}","${token}","${tx.fee}","${tx.amount}","0","","0","0","${counterpart}","${serverName}","${tx.guildId || ''}","${status}","${details}"\n`;
        });
        // Add tips with comprehensive tax transparency
        tips.forEach(tip => {
            const direction = tip.fromUserId === user.id ? 'sent' : 'received';
            const counterpart = direction === 'sent' ? `user_${tip.toUserId}` : `user_${tip.fromUserId}`;
            const serverName = tip.guildId ? (servernames.get(tip.guildId) || `Server#${tip.guildId.slice(-4)}`) : '';
            // For sent tips, show full tax breakdown; for received tips, show recipient perspective
            if (direction === 'sent') {
                csv += `"${username}","${user.discordId}","${tip.createdAt.toISOString()}","tip","${direction}","${tip.amountAtomic}","${tip.Token?.symbol || 'Unknown'}","${tip.feeAtomic || 0}","${tip.totalDeductedAtomic || Number(tip.amountAtomic) + Number(tip.feeAtomic || 0)}","${tip.taxRateAppliedBps || 0}","${tip.roleBenefitUsed || ''}","${tip.exemptionRateBps || 0}","${tip.taxSavedAtomic || 0}","${counterpart}","${serverName}","${tip.guildId || ''}","${tip.status}","${tip.note || ''}"\n`;
            }
            else {
                // Received tips don't show tax details (recipient gets full amount)
                csv += `"${username}","${user.discordId}","${tip.createdAt.toISOString()}","tip","${direction}","${tip.amountAtomic}","${tip.Token?.symbol || 'Unknown'}","0","${tip.amountAtomic}","0","","0","0","${counterpart}","${serverName}","${tip.guildId || ''}","${tip.status}","${tip.note || ''}"\n`;
            }
        });
        // Add group tips created
        groupTips.created.forEach(gt => {
            const totalWithTax = Number(gt.totalAmount) + Number(gt.taxAtomic || 0);
            const serverName = gt.guildId ? (servernames.get(gt.guildId) || `Server#${gt.guildId.slice(-4)}`) : '';
            csv += `"${username}","${user.discordId}","${gt.createdAt.toISOString()}","group_tip","created","${gt.totalAmount}","${gt.Token?.symbol || 'Unknown'}","${gt.taxAtomic || 0}","${totalWithTax}","0","","0","0","group","${serverName}","${gt.guildId || ''}","${gt.status}","Duration: ${gt.duration}h"\n`;
        });
        // Add group tips claimed
        groupTips.claimed.forEach(claim => {
            const claimTime = claim.claimedAt?.toISOString() || claim.createdAt.toISOString();
            const serverName = claim.GroupTip.guildId ? (servernames.get(claim.GroupTip.guildId) || `Server#${claim.GroupTip.guildId.slice(-4)}`) : '';
            csv += `"${username}","${user.discordId}","${claimTime}","group_tip","claimed","estimated_share","${claim.GroupTip.Token?.symbol || 'Unknown'}","0","estimated_share","0","","0","0","group_${claim.groupTipId}","${serverName}","${claim.GroupTip.guildId || ''}","${claim.status}","Group tip claim"\n`;
        });
        // Add matches
        matches.forEach(match => {
            const role = match.challengerId === user.id ? 'challenger' : 'joiner';
            const result = match.winnerUserId === user.id ? 'won' : (match.winnerUserId ? 'lost' : 'pending');
            csv += `"${username}","${user.discordId}","${match.createdAt.toISOString()}","match","${role}","${match.wagerAtomic}","${match.Token?.symbol || 'Unknown'}","${match.rakeAtomic || 0}","${match.wagerAtomic}","0","","0","0","opponent","","","${match.status}","${result}"\n`;
        });
        const filename = `user_${discordId}_activity_${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(csv);
    }
    catch (error) {
        console.error("User export error:", error);
        res.status(500).json({ ok: false, error: "Failed to export user data" });
    }
});
// Guild-specific export for tracking server activity
transactionsRouter.get("/transactions/export/guild/:guildId", async (req, res) => {
    try {
        const { guildId } = req.params;
        const { since, until } = req.query;
        const dateFilter = {};
        if (since)
            dateFilter.gte = new Date(since);
        if (until)
            dateFilter.lte = new Date(until);
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
    }
    catch (error) {
        console.error("Guild export error:", error);
        res.status(500).json({ ok: false, error: "Failed to export guild data" });
    }
});
// Delete transaction endpoint
transactionsRouter.delete("/transactions/:id", async (req, res) => {
    try {
        const transactionId = parseInt(req.params.id);
        if (!Number.isFinite(transactionId)) {
            return res.status(400).json({ ok: false, error: "Invalid transaction ID" });
        }
        // Get the transaction first for logging
        const transaction = await prisma.transaction.findUnique({
            where: { id: transactionId }
        });
        if (!transaction) {
            return res.status(404).json({ ok: false, error: "Transaction not found" });
        }
        // Delete the transaction
        await prisma.transaction.delete({
            where: { id: transactionId }
        });
        console.log(`🗑️ Admin deleted transaction: ID ${transactionId}, Type: ${transaction.type}, Amount: ${transaction.amount}`);
        res.json({
            ok: true,
            message: "Transaction deleted successfully",
            deletedTransaction: {
                id: transaction.id,
                type: transaction.type,
                amount: transaction.amount,
                createdAt: transaction.createdAt
            }
        });
    }
    catch (error) {
        console.error("Delete transaction error:", error);
        res.status(500).json({ ok: false, error: `Failed to delete transaction: ${error.message}` });
    }
});
