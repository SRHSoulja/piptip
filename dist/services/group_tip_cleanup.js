import { prisma } from "./db.js";
import { finalizeExpiredGroupTip } from "../features/finalizeExpiredGroupTip.js";
import { getDiscordClient } from "./discord_users.js";
async function cleanupExpiredGroupTips() {
  try {
    console.log("\u{1F9F9} Starting expired group tips cleanup...");
    const expiredTips = await prisma.groupTip.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lte: /* @__PURE__ */ new Date() }
      },
      select: { id: true, expiresAt: true }
    });
    if (expiredTips.length === 0) {
      console.log("\u2705 No expired group tips found");
      return;
    }
    console.log(`\u26A0\uFE0F Found ${expiredTips.length} expired group tips to clean up`);
    let successCount = 0;
    let failCount = 0;
    for (const tip of expiredTips) {
      try {
        console.log(`\u{1F504} Cleaning up expired group tip ${tip.id} (expired: ${tip.expiresAt})`);
        await Promise.race([
          finalizeExpiredGroupTip(tip.id),
          new Promise(
            (_, reject) => setTimeout(() => reject(new Error("Cleanup timeout")), 1e4)
          )
        ]);
        successCount++;
        console.log(`\u2705 Group tip ${tip.id} cleaned up successfully`);
      } catch (error) {
        failCount++;
        console.error(`\u274C Failed to clean up group tip ${tip.id}:`, error.message);
        try {
          await prisma.groupTip.update({
            where: { id: tip.id },
            data: { status: "FINALIZED" }
          });
          console.log(`\u26A1 Emergency: Marked group tip ${tip.id} as FINALIZED to prevent future issues`);
        } catch (emergencyError) {
          console.error(`\u{1F480} Emergency cleanup also failed for tip ${tip.id}:`, emergencyError.message);
        }
      }
    }
    console.log(`\u{1F9F9} Cleanup completed: ${successCount} success, ${failCount} failed`);
    await updateStaleDiscordMessages();
  } catch (error) {
    console.error("\u274C Group tip cleanup service failed:", error.message);
  }
}
async function updateStaleDiscordMessages() {
  try {
    console.log("\u{1F504} Checking for finalized tips with potentially stale Discord messages...");
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1e3);
    const finalizedTips = await prisma.groupTip.findMany({
      where: {
        status: "FINALIZED",
        expiresAt: { gte: thirtyMinutesAgo },
        // Only recently expired tips
        messageId: { not: null },
        // Has a Discord message
        channelId: { not: null }
        // Has a channel
      },
      select: { id: true, messageId: true, channelId: true },
      take: 10
      // Limit to avoid overwhelming Discord API
    });
    if (finalizedTips.length === 0) {
      console.log("\u2705 No finalized tips need Discord message updates");
      return;
    }
    console.log(`\u{1F504} Found ${finalizedTips.length} finalized tips to check for Discord updates`);
    const client = await getDiscordClient();
    if (!client) {
      console.log("\u26A0\uFE0F Discord client not available for message updates");
      return;
    }
    let updatedCount = 0;
    for (const tip of finalizedTips) {
      try {
        console.log(`\u{1F504} Updating Discord message for finalized tip ${tip.id}`);
        const { updateGroupTipMessage } = await import("../features/group_tip_helpers.js");
        await Promise.race([
          updateGroupTipMessage(client, tip.id),
          new Promise(
            (_, reject) => setTimeout(() => reject(new Error("Discord update timeout")), 8e3)
          )
        ]);
        updatedCount++;
        console.log(`\u2705 Discord message updated for tip ${tip.id}`);
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      } catch (error) {
        console.warn(`\u26A0\uFE0F Failed to update Discord message for tip ${tip.id}:`, error.message);
      }
    }
    console.log(`\u{1F504} Discord message updates completed: ${updatedCount}/${finalizedTips.length} successful`);
  } catch (error) {
    console.error("\u274C Discord message update check failed:", error.message);
  }
}
let cleanupInterval = null;
function startCleanupService() {
  if (cleanupInterval) {
    console.log("\u26A0\uFE0F Cleanup service already running");
    return;
  }
  console.log("\u{1F9F9} Starting group tip cleanup service (every 10 minutes)");
  cleanupExpiredGroupTips();
  cleanupInterval = setInterval(() => {
    cleanupExpiredGroupTips();
  }, 10 * 60 * 1e3);
}
function stopCleanupService() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log("\u{1F6D1} Group tip cleanup service stopped");
  }
}
export {
  cleanupExpiredGroupTips,
  startCleanupService,
  stopCleanupService
};
//# sourceMappingURL=group_tip_cleanup.js.map
