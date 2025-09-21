// src/services/group_tip_cleanup.ts - Preventive cleanup for stuck group tips
import { prisma } from "./db.js";
import { finalizeExpiredGroupTip } from "../features/finalizeExpiredGroupTip.js";
import { getDiscordClient } from "./discord_users.js";
/**
 * Clean up expired group tips that are still marked as ACTIVE
 * This prevents the bot from getting stuck on startup
 */
export async function cleanupExpiredGroupTips() {
    try {
        console.log("🧹 Starting expired group tips cleanup...");
        // Find all expired ACTIVE group tips
        const expiredTips = await prisma.groupTip.findMany({
            where: {
                status: "ACTIVE",
                expiresAt: { lte: new Date() }
            },
            select: { id: true, expiresAt: true }
        });
        if (expiredTips.length === 0) {
            console.log("✅ No expired group tips found");
            return;
        }
        console.log(`⚠️ Found ${expiredTips.length} expired group tips to clean up`);
        let successCount = 0;
        let failCount = 0;
        for (const tip of expiredTips) {
            try {
                console.log(`🔄 Cleaning up expired group tip ${tip.id} (expired: ${tip.expiresAt})`);
                // Use direct finalization with timeout
                await Promise.race([
                    finalizeExpiredGroupTip(tip.id),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Cleanup timeout")), 10000))
                ]);
                successCount++;
                console.log(`✅ Group tip ${tip.id} cleaned up successfully`);
            }
            catch (error) {
                failCount++;
                console.error(`❌ Failed to clean up group tip ${tip.id}:`, error.message);
                // Emergency fallback: just mark it as finalized to prevent future issues
                try {
                    await prisma.groupTip.update({
                        where: { id: tip.id },
                        data: { status: "FINALIZED" }
                    });
                    console.log(`⚡ Emergency: Marked group tip ${tip.id} as FINALIZED to prevent future issues`);
                }
                catch (emergencyError) {
                    console.error(`💀 Emergency cleanup also failed for tip ${tip.id}:`, emergencyError.message);
                }
            }
        }
        console.log(`🧹 Cleanup completed: ${successCount} success, ${failCount} failed`);
        // Also check for finalized tips with potentially stale Discord messages
        await updateStaleDiscordMessages();
    }
    catch (error) {
        console.error("❌ Group tip cleanup service failed:", error.message);
    }
}
/**
 * Update Discord messages for finalized tips that might have stale UI
 * This handles cases where database finalization succeeded but Discord update failed
 */
async function updateStaleDiscordMessages() {
    try {
        console.log("🔄 Checking for finalized tips with potentially stale Discord messages...");
        // Find recently finalized tips (last 30 minutes) that might need Discord updates
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const finalizedTips = await prisma.groupTip.findMany({
            where: {
                status: "FINALIZED",
                expiresAt: { gte: thirtyMinutesAgo }, // Only recently expired tips
                messageId: { not: null }, // Has a Discord message
                channelId: { not: null } // Has a channel
            },
            select: { id: true, messageId: true, channelId: true },
            take: 10 // Limit to avoid overwhelming Discord API
        });
        if (finalizedTips.length === 0) {
            console.log("✅ No finalized tips need Discord message updates");
            return;
        }
        console.log(`🔄 Found ${finalizedTips.length} finalized tips to check for Discord updates`);
        const client = await getDiscordClient();
        if (!client) {
            console.log("⚠️ Discord client not available for message updates");
            return;
        }
        let updatedCount = 0;
        for (const tip of finalizedTips) {
            try {
                console.log(`🔄 Updating Discord message for finalized tip ${tip.id}`);
                const { updateGroupTipMessage } = await import("../features/group_tip_helpers.js");
                // Try to update with timeout
                await Promise.race([
                    updateGroupTipMessage(client, tip.id),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Discord update timeout")), 8000))
                ]);
                updatedCount++;
                console.log(`✅ Discord message updated for tip ${tip.id}`);
                // Rate limit: wait between updates
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            catch (error) {
                console.warn(`⚠️ Failed to update Discord message for tip ${tip.id}:`, error.message);
                // Continue with other tips
            }
        }
        console.log(`🔄 Discord message updates completed: ${updatedCount}/${finalizedTips.length} successful`);
    }
    catch (error) {
        console.error("❌ Discord message update check failed:", error.message);
    }
}
/**
 * Periodic cleanup service - run every 10 minutes
 */
let cleanupInterval = null;
export function startCleanupService() {
    if (cleanupInterval) {
        console.log("⚠️ Cleanup service already running");
        return;
    }
    console.log("🧹 Starting group tip cleanup service (every 10 minutes)");
    // Run immediately on startup
    cleanupExpiredGroupTips();
    // Then run every 10 minutes
    cleanupInterval = setInterval(() => {
        cleanupExpiredGroupTips();
    }, 10 * 60 * 1000); // 10 minutes
}
export function stopCleanupService() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        console.log("🛑 Group tip cleanup service stopped");
    }
}
