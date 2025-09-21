// Replit-optimized finalization strategy
// No timers, no background processes - just check on every interaction
import { prisma } from "./db.js";
import { finalizeExpiredGroupTip } from "../features/finalizeExpiredGroupTip.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
/**
 * Check and finalize any expired tips immediately
 * Call this on EVERY Discord interaction to ensure tips are processed
 */
export async function checkAndFinalizeExpiredTips(client) {
    try {
        // Find all expired tips that are still ACTIVE
        const expiredTips = await prisma.groupTip.findMany({
            where: {
                status: "ACTIVE",
                expiresAt: { lte: new Date() }
            },
            select: { id: true, expiresAt: true },
            take: 5 // Limit to avoid overwhelming
        });
        if (expiredTips.length === 0)
            return;
        console.log(`🔄 Replit check: Found ${expiredTips.length} expired tips to finalize`);
        // Process each expired tip
        for (const tip of expiredTips) {
            try {
                console.log(`⚡ Finalizing expired tip ${tip.id} (expired: ${tip.expiresAt})`);
                // Use the proper finalization function
                await finalizeExpiredGroupTip(tip.id);
                // Try to update Discord message (best effort)
                try {
                    await updateGroupTipMessage(client, tip.id);
                    console.log(`✅ Updated Discord message for tip ${tip.id}`);
                }
                catch (discordError) {
                    console.warn(`⚠️ Discord update failed for tip ${tip.id}:`, discordError.message);
                    // Don't fail the whole process if Discord is down
                }
                console.log(`✅ Tip ${tip.id} finalized successfully`);
            }
            catch (error) {
                console.error(`❌ Failed to finalize tip ${tip.id}:`, error.message);
            }
        }
    }
    catch (error) {
        console.error(`❌ Replit finalization check failed:`, error.message);
    }
}
/**
 * Enhanced message update with Replit-specific retry
 */
export async function replitUpdateMessage(client, tipId) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await Promise.race([
                updateGroupTipMessage(client, tipId),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Replit timeout")), 8000))
            ]);
            return true;
        }
        catch (error) {
            console.warn(`⚠️ Replit Discord update attempt ${attempt}/3 failed:`, error.message);
            if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
    return false;
}
