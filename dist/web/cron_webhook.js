// Replit-optimized cron webhook for reliable tip finalization
import { Router } from "express";
import { prisma } from "../services/db.js";
import { finalizeExpiredGroupTip } from "../features/finalizeExpiredGroupTip.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
const router = Router();
// Webhook endpoint that external cron services can call
router.post("/finalize-expired-tips", async (req, res) => {
    const authHeader = req.headers.authorization;
    const expectedAuth = `Bearer ${process.env.CRON_WEBHOOK_SECRET}`;
    // Security: only allow authorized cron services
    if (!process.env.CRON_WEBHOOK_SECRET || authHeader !== expectedAuth) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    try {
        console.log("🕐 External cron triggered: checking for expired tips");
        // Find all expired tips that are still ACTIVE
        const expiredTips = await prisma.groupTip.findMany({
            where: {
                status: "ACTIVE",
                expiresAt: { lte: new Date() }
            },
            select: {
                id: true,
                expiresAt: true,
                messageId: true,
                channelId: true
            },
            take: 10 // Process max 10 at a time to avoid timeouts
        });
        if (expiredTips.length === 0) {
            console.log("✅ No expired tips found");
            return res.json({
                success: true,
                message: "No expired tips found",
                processed: 0
            });
        }
        console.log(`⚡ Processing ${expiredTips.length} expired tips`);
        let successCount = 0;
        let errorCount = 0;
        const results = [];
        // Process each expired tip
        for (const tip of expiredTips) {
            try {
                console.log(`🔄 Finalizing tip ${tip.id} (expired: ${tip.expiresAt.toISOString()})`);
                // Use the proper finalization function with timeout
                const result = await Promise.race([
                    finalizeExpiredGroupTip(tip.id),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Finalization timeout")), 10000))
                ]);
                successCount++;
                results.push({
                    tipId: tip.id,
                    status: "success",
                    result: result.kind
                });
                console.log(`✅ Tip ${tip.id} finalized: ${result.kind}`);
                // Try to update Discord message (best effort, don't fail if Discord is down)
                if (tip.messageId && tip.channelId) {
                    try {
                        // Get Discord client - try multiple ways to access it
                        const { getDiscordClient } = await import("../services/discord_users.js");
                        const client = await getDiscordClient();
                        if (client && client.isReady()) {
                            await Promise.race([
                                updateGroupTipMessage(client, tip.id),
                                new Promise((_, reject) => setTimeout(() => reject(new Error("Discord timeout")), 8000))
                            ]);
                            console.log(`📱 Discord message updated for tip ${tip.id}`);
                        }
                        else {
                            console.warn(`⚠️ Discord client not ready for tip ${tip.id}`);
                        }
                    }
                    catch (discordError) {
                        console.warn(`⚠️ Discord update failed for tip ${tip.id}:`, discordError.message);
                        // Don't fail the whole process if Discord is down
                    }
                }
            }
            catch (error) {
                errorCount++;
                results.push({
                    tipId: tip.id,
                    status: "error",
                    error: error.message
                });
                console.error(`❌ Failed to finalize tip ${tip.id}:`, error.message);
            }
        }
        const response = {
            success: true,
            message: `Processed ${expiredTips.length} expired tips`,
            processed: successCount,
            errors: errorCount,
            results
        };
        console.log(`🏁 Cron job completed: ${successCount} success, ${errorCount} errors`);
        res.json(response);
    }
    catch (error) {
        console.error("❌ Cron webhook error:", error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Health check endpoint for cron monitoring
router.get("/cron-health", async (req, res) => {
    try {
        // Quick database health check
        const tipCount = await prisma.groupTip.count({
            where: { status: "ACTIVE" }
        });
        res.json({
            status: "healthy",
            timestamp: new Date().toISOString(),
            activeTips: tipCount,
            uptime: process.uptime()
        });
    }
    catch (error) {
        res.status(500).json({
            status: "error",
            error: error.message
        });
    }
});
export default router;
