import { Router } from "express";
import { prisma } from "../services/db.js";
import { finalizeExpiredGroupTip } from "../features/finalizeExpiredGroupTip.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
const router = Router();
router.post("/finalize-expired-tips", async (req, res) => {
  const authHeader = req.headers.authorization;
  const expectedAuth = `Bearer ${process.env.CRON_WEBHOOK_SECRET}`;
  if (!process.env.CRON_WEBHOOK_SECRET || authHeader !== expectedAuth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    console.log("\u{1F550} External cron triggered: checking for expired tips");
    const expiredTips = await prisma.groupTip.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lte: /* @__PURE__ */ new Date() }
      },
      select: {
        id: true,
        expiresAt: true,
        messageId: true,
        channelId: true
      },
      take: 10
      // Process max 10 at a time to avoid timeouts
    });
    if (expiredTips.length === 0) {
      console.log("\u2705 No expired tips found");
      return res.json({
        success: true,
        message: "No expired tips found",
        processed: 0
      });
    }
    console.log(`\u26A1 Processing ${expiredTips.length} expired tips`);
    let successCount = 0;
    let errorCount = 0;
    const results = [];
    for (const tip of expiredTips) {
      try {
        console.log(`\u{1F504} Finalizing tip ${tip.id} (expired: ${tip.expiresAt.toISOString()})`);
        const result = await Promise.race([
          finalizeExpiredGroupTip(tip.id),
          new Promise(
            (_, reject) => setTimeout(() => reject(new Error("Finalization timeout")), 1e4)
          )
        ]);
        successCount++;
        results.push({
          tipId: tip.id,
          status: "success",
          result: result.kind
        });
        console.log(`\u2705 Tip ${tip.id} finalized: ${result.kind}`);
        if (tip.messageId && tip.channelId) {
          try {
            const { getDiscordClient } = await import("../services/discord_users.js");
            const client = await getDiscordClient();
            if (client && client.isReady()) {
              await Promise.race([
                updateGroupTipMessage(client, tip.id),
                new Promise(
                  (_, reject) => setTimeout(() => reject(new Error("Discord timeout")), 8e3)
                )
              ]);
              console.log(`\u{1F4F1} Discord message updated for tip ${tip.id}`);
            } else {
              console.warn(`\u26A0\uFE0F Discord client not ready for tip ${tip.id}`);
            }
          } catch (discordError) {
            console.warn(`\u26A0\uFE0F Discord update failed for tip ${tip.id}:`, discordError.message);
          }
        }
      } catch (error) {
        errorCount++;
        results.push({
          tipId: tip.id,
          status: "error",
          error: error.message
        });
        console.error(`\u274C Failed to finalize tip ${tip.id}:`, error.message);
      }
    }
    const response = {
      success: true,
      message: `Processed ${expiredTips.length} expired tips`,
      processed: successCount,
      errors: errorCount,
      results
    };
    console.log(`\u{1F3C1} Cron job completed: ${successCount} success, ${errorCount} errors`);
    res.json(response);
  } catch (error) {
    console.error("\u274C Cron webhook error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
router.get("/cron-health", async (req, res) => {
  try {
    const tipCount = await prisma.groupTip.count({
      where: { status: "ACTIVE" }
    });
    res.json({
      status: "healthy",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      activeTips: tipCount,
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: error.message
    });
  }
});
var cron_webhook_default = router;
export {
  cron_webhook_default as default
};
//# sourceMappingURL=cron_webhook.js.map
