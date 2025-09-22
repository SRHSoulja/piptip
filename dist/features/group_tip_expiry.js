import { prisma } from "../services/db.js";
import { finalizeExpiredGroupTip } from "./finalizeExpiredGroupTip.js";
import { updateGroupTipMessage } from "./group_tip_helpers.js";
import { decToBigDirect, formatAmount } from "../services/token.js";
import { groupTipEmbed } from "../ui/embeds.js";
import { groupTipClaimRow } from "../ui/components.js";
const timers = new Map();
const pendingDiscordUpdates = new Set();
/** Simple Discord message update for expired state without finalization */
async function updateGroupTipMessageSimple(client, tipId, forceExpired = false) {
    console.log(`🔧 updateGroupTipMessageSimple called for tip ${tipId}, forceExpired: ${forceExpired}`);
    const tip = await prisma.groupTip.findUnique({
        where: { id: tipId },
        include: {
            Creator: true,
            Token: true,
            claims: { include: { User: true } }
        }
    });
    if (!tip || !tip.channelId || !tip.messageId) {
        console.log(`❌ updateGroupTipMessageSimple: tip data incomplete for ${tipId}`);
        return;
    }
    const now = new Date();
    const expired = forceExpired || now >= tip.expiresAt;
    const claimCount = tip.claims.length;
    const claimedBy = tip.claims
        .filter(c => c.User?.discordId)
        .map(c => `<@${c.User.discordId}>`)
        .join(', ') || 'No one';
    const creatorDisplay = tip.Creator?.discordId ? `<@${tip.Creator.discordId}>` : "Unknown";
    try {
        const channel = await client.channels.fetch(tip.channelId);
        if (channel && 'messages' in channel) {
            const message = await channel.messages.fetch(tip.messageId);
            if (expired) {
                // Show expired state
                await message.edit({
                    embeds: [{
                            title: '⏰ Colony Fish Expired!',
                            description: `🐧 **${creatorDisplay}** shared **${tip.totalAmount} ${tip.Token.symbol}** with the colony!\\n\\n⏰ **Timer expired!** Processing payouts...`,
                            color: 0xff9900,
                            fields: [
                                { name: '🐧 Colony Members', value: `${claimCount} penguins`, inline: true },
                                { name: '⏰ Status', value: '⏰ Expired - Processing payouts...', inline: true },
                                { name: '🎣 Fish Claimed By', value: claimedBy, inline: false }
                            ],
                            timestamp: new Date().toISOString()
                        }],
                    components: [] // Remove claim button
                });
                console.log(`✅ updateGroupTipMessageSimple: Updated tip ${tipId} to expired state`);
            }
        }
    }
    catch (error) {
        console.error(`❌ updateGroupTipMessageSimple failed for tip ${tipId}:`, error.message);
    }
}
/** Update Discord message to final distributed state after finalization */
async function updateGroupTipMessageToFinalState(client, tipId) {
    console.log(`🔧 updateGroupTipMessageToFinalState called for tip ${tipId}`);
    const tip = await prisma.groupTip.findUnique({
        where: { id: tipId },
        include: {
            Creator: true,
            Token: true,
            claims: { include: { User: true } }
        }
    });
    if (!tip || !tip.channelId || !tip.messageId) {
        console.log(`❌ updateGroupTipMessageToFinalState: tip data incomplete for ${tipId}`);
        return;
    }
    const claimCount = tip.claims.length;
    const claimedBy = tip.claims
        .filter(c => c.User?.discordId)
        .map(c => `<@${c.User.discordId}>`)
        .join(', ') || 'No one';
    const creatorDisplay = tip.Creator?.discordId ? `<@${tip.Creator.discordId}>` : "Unknown";
    try {
        const channel = await client.channels.fetch(tip.channelId);
        if (channel && 'messages' in channel) {
            const message = await channel.messages.fetch(tip.messageId);
            await message.edit({
                embeds: [{
                        title: '🎉✅ Colony Fish Distributed!',
                        description: `🐧 **${creatorDisplay}** shared **${tip.totalAmount} ${tip.Token.symbol}** with the colony!\\n\\n✅ **Fish distributed successfully!**`,
                        color: 0x00ff00,
                        fields: [
                            { name: '🐧 Colony Members', value: `${claimCount} penguins`, inline: true },
                            { name: '⏰ Status', value: '✅ Fish distributed!', inline: true },
                            { name: '🎣 Fish Claimed By', value: claimedBy, inline: false }
                        ],
                        timestamp: new Date().toISOString()
                    }],
                components: []
            });
            console.log(`✅ updateGroupTipMessageToFinalState: Updated tip ${tipId} to final distributed state`);
        }
    }
    catch (error) {
        console.error(`❌ updateGroupTipMessageToFinalState failed for tip ${tipId}:`, error.message);
    }
}
/** Direct Discord message update bypassing rate limiter for timer context */
async function updateGroupTipMessageDirect(client, groupTipId) {
    console.log(`🔧 updateGroupTipMessageDirect called for tip ${groupTipId}`);
    const tip = await prisma.groupTip.findUnique({
        where: { id: groupTipId },
        include: {
            Creator: true,
            Token: true,
            claims: { include: { User: true }, orderBy: { claimedAt: "asc" } },
            contributions: { include: { contributor: true }, orderBy: { createdAt: "asc" } },
        },
    });
    if (!tip || !tip.channelId || !tip.messageId) {
        console.log(`❌ updateGroupTipMessageDirect: tip data incomplete for ${groupTipId}`);
        return;
    }
    const now = new Date();
    const expired = (!!tip.expiresAt && now >= tip.expiresAt) || tip.status === 'FINALIZED';
    const claimCount = tip.claims.length;
    const claimedBy = tip.claims
        .map(c => (c.User?.discordId ? `<@${c.User.discordId}>` : null))
        .filter(Boolean);
    const creatorDisplay = tip.Creator?.discordId ? `<@${tip.Creator.discordId}>` : "Unknown";
    const atomicTotal = decToBigDirect(tip.totalAmount, tip.Token.decimals);
    const amountStr = formatAmount(atomicTotal, {
        address: tip.Token.address,
        symbol: tip.Token.symbol,
        decimals: tip.Token.decimals,
    });
    // Calculate payout per user if finalized
    let payoutPerUser;
    if (tip.status === 'FINALIZED' && claimCount > 0) {
        const totalPayout = decToBigDirect(tip.totalAmount, tip.Token.decimals);
        const perUser = totalPayout / BigInt(claimCount);
        payoutPerUser = formatAmount(perUser, {
            address: tip.Token.address,
            symbol: tip.Token.symbol,
            decimals: tip.Token.decimals,
        });
    }
    const embed = groupTipEmbed({
        creator: creatorDisplay,
        amount: amountStr,
        expiresAt: tip.expiresAt,
        claimCount,
        claimedBy,
        isExpired: expired,
        isFinalized: tip.status === 'FINALIZED',
        payoutPerUser,
    });
    const components = [groupTipClaimRow(tip.id, expired || tip.status !== "ACTIVE")];
    console.log(`🔧 Direct: Fetching channel ${tip.channelId}...`);
    const channel = await client.channels.fetch(tip.channelId);
    if (!channel || typeof channel !== 'object' || !('isTextBased' in channel) || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
        console.log(`❌ Direct: Channel ${tip.channelId} not text-based`);
        return;
    }
    console.log(`🔧 Direct: Fetching message ${tip.messageId}...`);
    const msg = await channel.messages.fetch(tip.messageId);
    if (!msg) {
        console.log(`❌ Direct: Message ${tip.messageId} not found`);
        return;
    }
    console.log(`🔧 Direct: Editing message...`);
    await msg.edit({ embeds: [embed], components });
    console.log(`✅ Direct: Message edited successfully`);
}
async function updateDiscordMessageWithRetry(client, tipId, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`📝 Updating Discord message for tip ${tipId} (attempt ${attempt}/${maxAttempts})...`);
            console.log(`🔍 Client ready: ${client.isReady()}, User: ${client.user?.username || 'not logged in'}`);
            // Wait for client to be ready if it's not
            if (!client.isReady()) {
                console.log(`⏳ Waiting for Discord client to be ready...`);
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Client ready timeout')), 10000);
                    if (client.isReady()) {
                        clearTimeout(timeout);
                        resolve(true);
                    }
                    else {
                        client.once('ready', () => {
                            clearTimeout(timeout);
                            resolve(true);
                        });
                    }
                });
            }
            console.log(`✅ Discord client is ready, updating message for tip ${tipId}...`);
            await updateGroupTipMessage(client, tipId);
            console.log(`✅ Discord message updated successfully for tip ${tipId} on attempt ${attempt}`);
            return; // Success, exit retry loop
        }
        catch (error) {
            console.error(`❌ Discord message update attempt ${attempt}/${maxAttempts} failed for tip ${tipId}:`, error.message);
            console.error(`Error details:`, error);
            if (attempt < maxAttempts) {
                // Wait before retry with exponential backoff
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 3000);
                console.log(`⏳ Waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            else {
                console.error(`💀 All ${maxAttempts} attempts failed for Discord message update on tip ${tipId}`);
                console.error('Final error:', error);
            }
        }
    }
}
async function announceResult(client, tipId) {
    console.log(`🔔 announceResult called for tip ${tipId}`);
    const tip = await prisma.groupTip.findUnique({
        where: { id: tipId },
        select: { channelId: true, messageId: true },
    });
    if (!tip?.channelId) {
        console.log(`❌ No channelId found for tip ${tipId}`);
        return;
    }
    console.log(`⚡ Finalizing tip ${tipId}...`);
    const summary = await finalizeExpiredGroupTip(tipId);
    console.log(`✅ Tip ${tipId} finalized with result: ${summary.kind}`);
    // Skip Discord embed update here - it's now handled by the dual timer system
    console.log(`📝 Skipping Discord embed update - handled by dual timer system for tip ${tipId}`);
    // The embedUpdateTimer already shows expired state, and finalizationTimer will show final state
    console.log(`📡 Fetching channel ${tip.channelId} for announcement...`);
    const chan = await client.channels.fetch(tip.channelId).catch((error) => {
        console.error(`❌ Failed to fetch channel ${tip.channelId}:`, error.message);
        return null;
    });
    if (!chan || !chan.isTextBased()) {
        console.log(`❌ Channel ${tip.channelId} not found or not text-based for tip ${tipId}`);
        return;
    }
    // 🔽 Type-narrow to a channel that actually supports `.send()`
    if (!("send" in chan)) {
        console.log(`❌ Channel ${tip.channelId} doesn't support .send() for tip ${tipId}`);
        return;
    }
    const channel = chan;
    if (summary.kind === "REFUNDED") {
        await channel.send(`<a:PenguNo:1415469218681585674> Group tip expired. No claims — refunded **${summary.amountText}** to <@${summary.creatorId}>.`).catch(() => { });
    }
    else if (summary.kind === "FINALIZED") {
        const list = summary.payouts
            .slice(0, 10)
            .map(p => `<@${p.discordId}>: ${p.shareText}`)
            .join(", ");
        const more = summary.payouts.length > 10 ? ` …and ${summary.payouts.length - 10} more.` : "";
        const rem = summary.remainderText ? ` (remainder ${summary.remainderText} added to first share)` : "";
        await channel.send(`⏰ Group tip finalized — split **${summary.totalText}** equally.\n` +
            `Per person: **${summary.perShareText}**${rem}\n` +
            `Payouts: ${list}${more}`).catch(() => { });
    }
    // Discord message already updated after finalization above
}
/** Schedule a one-shot timer to finalize and announce at expiry. */
export async function scheduleGroupTipExpiry(client, tipId) {
    console.log(`⏰ scheduleGroupTipExpiry called for tip ${tipId}`);
    const row = await prisma.groupTip.findUnique({
        where: { id: tipId },
        select: { id: true, expiresAt: true, status: true },
    });
    if (!row || row.status !== "ACTIVE") {
        console.log(`❌ Cannot schedule timer for tip ${tipId}: status=${row?.status || 'not found'}`);
        return;
    }
    const delay = Math.max(0, row.expiresAt.getTime() - Date.now());
    const expiryTime = new Date(row.expiresAt).toISOString();
    console.log(`⏱️ Scheduling dual timers for tip ${tipId}: expires at ${expiryTime} (in ${Math.round(delay / 1000)}s)`);
    clearGroupTipExpiry(tipId);
    // Schedule immediate embed update at expiry time
    const embedUpdateTimer = setTimeout(async () => {
        try {
            console.log(`⚡ EMBED UPDATE timer fired for tip ${tipId} - updating to expired state`);
            await updateGroupTipMessageSimple(client, tipId, true); // Mark as expired
            console.log(`✅ Embed updated to expired state for tip ${tipId}`);
        }
        catch (error) {
            console.error(`❌ Embed update failed for tip ${tipId}:`, error.message);
        }
    }, delay);
    // Schedule finalization processing 3 seconds after expiry
    const finalizationTimer = setTimeout(async () => {
        try {
            console.log(`🔥 FINALIZATION timer fired for tip ${tipId}! Processing now...`);
            await announceResult(client, tipId);
            // Update Discord embed to final distributed state
            console.log(`📝 Updating embed to final distributed state for tip ${tipId}...`);
            await updateGroupTipMessageToFinalState(client, tipId);
            console.log(`✅ Timer processing completed for tip ${tipId}`);
        }
        catch (error) {
            console.error(`❌ Timer processing failed for tip ${tipId}:`, error.message);
        }
        finally {
            timers.delete(tipId);
            console.log(`🗑️ Timer removed for tip ${tipId}`);
        }
    }, delay + 3000); // 3 seconds after expiry
    timers.set(tipId, finalizationTimer);
    console.log(`✅ Timer scheduled successfully for tip ${tipId}, will fire in ${Math.round(delay / 1000)} seconds`);
}
export function clearGroupTipExpiry(tipId) {
    const t = timers.get(tipId);
    if (t) {
        clearTimeout(t);
        timers.delete(tipId);
    }
}
/** Call this once after login to recover timers and finalize overdue ones. */
export async function restoreGroupTipExpiryTimers(client) {
    // Finalize anything ACTIVE but already expired
    const overdue = await prisma.groupTip.findMany({
        where: { status: "ACTIVE", expiresAt: { lte: new Date() } },
        select: { id: true },
    });
    for (const g of overdue) {
        await announceResult(client, g.id);
    }
    // Schedule upcoming ACTIVE tips
    const upcoming = await prisma.groupTip.findMany({
        where: { status: "ACTIVE", expiresAt: { gt: new Date() } },
        select: { id: true, expiresAt: true },
    });
    for (const g of upcoming) {
        await scheduleGroupTipExpiry(client, g.id);
    }
    // Clear any stale pending Discord updates from previous runs
    clearPendingDiscordUpdates();
}
/** Clear all timers - call during shutdown to prevent memory leaks */
export function clearAllTimers() {
    console.log(`🧹 Clearing ${timers.size} group tip timers...`);
    for (const [tipId, timer] of timers.entries()) {
        clearTimeout(timer);
    }
    timers.clear();
    console.log("✅ All group tip timers cleared");
}
/** Clear pending Discord updates - call during startup to prevent stale updates */
export function clearPendingDiscordUpdates() {
    const count = pendingDiscordUpdates.size;
    if (count > 0) {
        console.log(`🧹 Clearing ${count} stale pending Discord updates: ${Array.from(pendingDiscordUpdates).join(', ')}`);
        pendingDiscordUpdates.clear();
        console.log("✅ Stale pending Discord updates cleared");
    }
}
/** Get current timer status for monitoring */
export function getTimerStatus() {
    const now = Date.now();
    const timerList = Array.from(timers.entries()).map(([tipId, timer]) => ({
        tipId,
        // Note: accessing private Node.js timer properties for debugging
        expiresIn: timer._idleStart + timer._idleTimeout - now,
    }));
    return {
        active: timers.size,
        timers: timerList
    };
}
/** Process pending Discord message updates */
export async function processPendingDiscordUpdates(client) {
    if (pendingDiscordUpdates.size === 0)
        return;
    console.log(`🔄 Processing ${pendingDiscordUpdates.size} pending Discord updates...`);
    console.log(`📋 Pending tip IDs: ${Array.from(pendingDiscordUpdates).join(', ')}`);
    const updates = Array.from(pendingDiscordUpdates);
    pendingDiscordUpdates.clear();
    for (const tipId of updates) {
        try {
            console.log(`📝 Processing Discord update for tip ${tipId}...`);
            await updateDiscordMessageWithRetry(client, tipId, 2);
            console.log(`✅ Discord update completed for tip ${tipId}`);
        }
        catch (error) {
            console.error(`❌ Failed to process Discord update for tip ${tipId}:`, error.message);
            // Don't re-add to pending to avoid infinite loops
        }
    }
}
