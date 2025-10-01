import { prisma } from "./db.js";
import { finalizeExpiredGroupTip } from "../features/finalizeExpiredGroupTip.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
async function checkAndFinalizeExpiredTips(client) {
  try {
    const expiredTips = await prisma.groupTip.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lte: /* @__PURE__ */ new Date() }
      },
      select: { id: true, expiresAt: true },
      take: 5
      // Limit to avoid overwhelming
    });
    if (expiredTips.length === 0) return;
    console.log(`\u{1F504} Replit check: Found ${expiredTips.length} expired tips to finalize`);
    for (const tip of expiredTips) {
      try {
        console.log(`\u26A1 Finalizing expired tip ${tip.id} (expired: ${tip.expiresAt})`);
        await finalizeExpiredGroupTip(tip.id);
        try {
          await updateGroupTipMessage(client, tip.id);
          console.log(`\u2705 Updated Discord message for tip ${tip.id}`);
        } catch (discordError) {
          console.warn(`\u26A0\uFE0F Discord update failed for tip ${tip.id}:`, discordError.message);
        }
        console.log(`\u2705 Tip ${tip.id} finalized successfully`);
      } catch (error) {
        console.error(`\u274C Failed to finalize tip ${tip.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`\u274C Replit finalization check failed:`, error.message);
  }
}
async function replitUpdateMessage(client, tipId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await Promise.race([
        updateGroupTipMessage(client, tipId),
        new Promise(
          (_, reject) => setTimeout(() => reject(new Error("Replit timeout")), 8e3)
        )
      ]);
      return true;
    } catch (error) {
      console.warn(`\u26A0\uFE0F Replit Discord update attempt ${attempt}/3 failed:`, error.message);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      }
    }
  }
  return false;
}
export {
  checkAndFinalizeExpiredTips,
  replitUpdateMessage
};
//# sourceMappingURL=replit_finalization.js.map
