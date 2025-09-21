import { resilientDb } from "../services/resilient_db.js";
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "discord.js";
import { rateLimitedDiscord } from "../services/discord_rate_limiter.js";
import { prisma } from "../services/db.js";
// Concurrent protection for viral scenarios with timestamps for cleanup
const pendingClaims = new Map(); // claimKey -> timestamp
const pendingContributions = new Set();
const validationCache = new Map();
const VALIDATION_CACHE_TTL = 5000; // 5 seconds
// Clear expired cache entries and stuck pending claims every 30 seconds
setInterval(() => {
    const now = Date.now();
    // Clean validation cache
    for (const [id, entry] of validationCache.entries()) {
        if (now - entry.cached > VALIDATION_CACHE_TTL) {
            validationCache.delete(id);
        }
    }
    // Clean stuck pending claims (anything older than 60 seconds)
    let cleanedClaims = 0;
    for (const [claimKey, timestamp] of pendingClaims.entries()) {
        if (now - timestamp > 60000) { // 60 seconds
            pendingClaims.delete(claimKey);
            cleanedClaims++;
        }
    }
    if (cleanedClaims > 0) {
        console.log(`🧹 Cleaned ${cleanedClaims} stuck pending claims (${pendingClaims.size} remaining)`);
    }
}, 30000);
/**
 * Fast validation check with caching for group tip status
 */
async function getGroupTipValidation(groupTipId) {
    const now = Date.now();
    const cached = validationCache.get(groupTipId);
    // Return cached result if still valid
    if (cached && (now - cached.cached) < VALIDATION_CACHE_TTL) {
        return cached;
    }
    // Fast basic query with minimal data
    try {
        const basicInfo = await Promise.race([
            prisma.groupTip.findUnique({
                where: { id: groupTipId },
                select: {
                    id: true,
                    status: true,
                    expiresAt: true,
                    Creator: { select: { discordId: true } }
                }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Validation query timeout")), 800))
        ]);
        if (!basicInfo)
            return null;
        const validation = {
            isActive: basicInfo.status === 'ACTIVE',
            isExpired: basicInfo.expiresAt.getTime() < Date.now(),
            creatorDiscordId: basicInfo.Creator?.discordId || null,
            expiresAt: basicInfo.expiresAt,
            status: basicInfo.status,
            cached: now
        };
        validationCache.set(groupTipId, validation);
        return validation;
    }
    catch (error) {
        console.error(`Validation query failed for tip ${groupTipId}:`, error);
        return null;
    }
}
/**
 * Background claim processor - runs after user gets immediate feedback
 */
async function processClaimInBackground(groupTipId, discordId, interaction) {
    try {
        console.log(`🔄 Background claim processing for tip ${groupTipId}, user ${discordId}`);
        // Use resilient database service for background processing
        const result = await resilientDb.processGroupTipClaim(groupTipId, discordId);
        if (result.expired) {
            // Handle expired tip in background
            try {
                await resilientDb.finalizeGroupTipFast(groupTipId);
                await resilientDb.updateGroupTipMessage(interaction.client, groupTipId);
                // Try to update user with expiry info if possible
                await rateLimitedDiscord.editReply(interaction, {
                    content: "⏰ This group tip expired while processing your claim. Rewards are being distributed to existing claimers!"
                });
            }
            catch (finalizeError) {
                console.error(`Background finalization failed for tip ${groupTipId}:`, finalizeError);
            }
            return;
        }
        // Success - update message and notify user
        await resilientDb.updateGroupTipMessage(interaction.client, groupTipId);
        // Try to update user with success message
        await rateLimitedDiscord.editReply(interaction, {
            content: `✅ You're in! You'll receive your share when the timer expires. (${'newClaimCount' in result ? result.newClaimCount : 'Some'} people claimed so far)`
        });
        console.log(`✅ Background claim successful for tip ${groupTipId}, user ${discordId}`);
    }
    catch (error) {
        console.error(`Background claim failed for tip ${groupTipId}, user ${discordId}:`, error);
        // Try to notify user of the error
        try {
            const message = error.message.includes('already claimed')
                ? "🐧 You've already claimed this tip!"
                : error.message.includes('already contributed')
                    ? "🐧 You've already contributed to this tip! Contributors can't also claim!"
                    : "🐧 Claim failed. Please try again!";
            await rateLimitedDiscord.editReply(interaction, { content: message });
        }
        catch (updateError) {
            console.error(`Failed to update user about background claim error:`, updateError);
        }
    }
}
export async function handleGroupTipClaim(i, groupTipId) {
    console.log(`🔥 CLAIM ATTEMPT: tip ${groupTipId}, user ${i.user.id}`);
    await i.deferReply({ ephemeral: true });
    // EMERGENCY: Check if tip exists and is not expired FIRST
    try {
        const basicTip = await Promise.race([
            prisma.groupTip.findUnique({
                where: { id: groupTipId },
                select: { id: true, expiresAt: true, status: true }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Initial tip check timeout")), 2000))
        ]);
        if (!basicTip) {
            console.log(`❌ EXPIRED CLAIM: tip ${groupTipId} not found`);
            return i.editReply({
                content: "🐧 This group tip no longer exists! It may have expired or been removed."
            });
        }
        if (basicTip.expiresAt.getTime() < Date.now()) {
            console.log(`❌ EXPIRED CLAIM: tip ${groupTipId} expired at ${basicTip.expiresAt.toISOString()}`);
            return i.editReply({
                content: "⏰ This group tip has expired! Rewards have been distributed to claimers."
            });
        }
        if (basicTip.status !== 'ACTIVE') {
            console.log(`❌ INACTIVE CLAIM: tip ${groupTipId} status is ${basicTip.status}`);
            return i.editReply({
                content: "🏁 This group tip has been finalized! Rewards have been distributed."
            });
        }
    }
    catch (error) {
        console.error(`❌ TIP CHECK ERROR: ${error}`);
        const isTimeout = error?.message?.includes('timeout');
        return i.editReply({
            content: isTimeout
                ? "🐧 Database is busy right now. This tip might be finalizing. Please wait a moment and try again!"
                : "🐧 Unable to check group tip status. Please try again!"
        });
    }
    // Concurrent protection - prevent double claims during viral scenarios
    const claimKey = `${groupTipId}:${i.user.id}`;
    console.log(`🔍 Checking pending claims: key=${claimKey}, pending=${pendingClaims.size}, has=${pendingClaims.has(claimKey)}`);
    if (pendingClaims.has(claimKey)) {
        const timestamp = pendingClaims.get(claimKey);
        const age = Date.now() - timestamp;
        // If claim is older than 5 seconds, allow retry (probably stuck)
        if (age > 5000) {
            console.log(`🔧 RETRY ALLOWED: claim ${claimKey} was stuck for ${age}ms, allowing retry`);
            pendingClaims.delete(claimKey);
        }
        else {
            console.log(`❌ BLOCKED: claim ${claimKey} already pending for ${age}ms`);
            return i.editReply({
                content: "🐧 Hold your penguins! Your claim is already being processed... 🐟"
            });
        }
    }
    pendingClaims.set(claimKey, Date.now());
    try {
        // OPTIMIZATION 1: Immediate positive feedback while doing fast validation
        await rateLimitedDiscord.editReply(i, {
            content: "🐧 Checking group tip... ⚡"
        });
        // OPTIMIZATION 2: Fast validation check with caching
        const validation = await getGroupTipValidation(groupTipId);
        if (!validation) {
            return i.editReply({
                content: "🐧 Group tip not found! It might have expired or been removed."
            });
        }
        // OPTIMIZATION 3: Fast checks before heavy database work
        if (validation.status === 'FINALIZED') {
            return i.editReply({
                content: "🏁 This group tip has already been finalized. Rewards have been distributed!"
            });
        }
        if (validation.isExpired) {
            // Trigger finalization in background
            setImmediate(() => {
                resilientDb.finalizeGroupTipFast(groupTipId)
                    .then(() => resilientDb.updateGroupTipMessage(i.client, groupTipId))
                    .catch(error => console.error(`Background finalization failed:`, error));
            });
            return i.editReply({
                content: "⏰ This group tip has expired and is being finalized. Rewards are being distributed to existing claimers!"
            });
        }
        if (!validation.isActive) {
            return i.editReply({
                content: "🐧 This group tip is no longer active."
            });
        }
        if (validation.creatorDiscordId === i.user.id) {
            return i.editReply({
                content: "🐧 You cannot claim your own group tip! That's like tipping yourself! 😄"
            });
        }
        // OPTIMIZATION 4: Immediate success feedback + background processing
        await rateLimitedDiscord.editReply(i, {
            content: "🐧 Processing your claim... This might take a moment! ⏳"
        });
        // Try claim with reasonable timeout
        let fastClaimSucceeded = false;
        try {
            const fastResult = await Promise.race([
                resilientDb.processGroupTipClaim(groupTipId, i.user.id),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Claim timeout")), 8000))
            ]);
            if (fastResult.expired) {
                // Handle expired case
                setImmediate(() => {
                    resilientDb.finalizeGroupTipFast(groupTipId)
                        .then(() => resilientDb.updateGroupTipMessage(i.client, groupTipId))
                        .catch(error => console.error(`Background finalization failed:`, error));
                });
                return i.editReply({
                    content: "⏰ This group tip expired while processing your claim. Rewards are being distributed to existing claimers!"
                });
            }
            // Fast success!
            fastClaimSucceeded = true;
            // Update message and give success feedback
            await resilientDb.updateGroupTipMessage(i.client, groupTipId);
            await i.editReply({
                content: `✅ You're in! You'll receive your share when the timer expires. (${'newClaimCount' in fastResult ? fastResult.newClaimCount : 'Some'} people claimed so far)`
            });
        }
        catch (fastError) {
            console.log(`Fast claim failed for ${groupTipId}:${i.user.id}, trying background processing:`, fastError.message);
            // Fast claim failed - handle common errors immediately or go to background
            if (fastError.message.includes('already claimed')) {
                return i.editReply({
                    content: "🐧 You've already claimed this group tip! You're all set! 🎯"
                });
            }
            if (fastError.message.includes('already contributed')) {
                return i.editReply({
                    content: "🐧 You've already contributed to this group tip! Contributors can't also claim! 🐟"
                });
            }
            // OPTIMIZATION 6: Background processing for complex cases
            await i.editReply({
                content: "🐧 Your claim is being processed in the background! We'll update you shortly... ⚡"
            });
            // Process in background with full resilience
            setImmediate(() => processClaimInBackground(groupTipId, i.user.id, i));
        }
    }
    catch (error) {
        console.error(`Claim error for ${groupTipId}:${i.user.id}:`, error);
        const errorMessage = error?.message || String(error);
        // Handle specific timeout errors more gracefully
        if (errorMessage.includes('timeout') || errorMessage.includes('exceeded')) {
            await i.editReply({
                content: "🐧 Database is busy right now. Please try again in a moment! 🐟"
            });
        }
        else {
            await i.editReply({ content: `🐧 Something went wrong: ${errorMessage}` });
        }
    }
    finally {
        // Clean up after a delay to allow background processing
        setTimeout(() => pendingClaims.delete(claimKey), 3000);
    }
}
/** Router for group tip button customIds: grouptip:<action>:<groupTipId> */
export async function handleGroupTipButton(i) {
    const [ns, action, id] = i.customId.split(":");
    if (ns !== "grouptip")
        return;
    const groupTipId = Number(id);
    if (!Number.isFinite(groupTipId)) {
        return i.reply({ content: "Invalid group tip ID.", ephemeral: true });
    }
    if (action === "claim")
        return handleGroupTipClaim(i, groupTipId);
    if (action === "add")
        return handleGroupTipAdd(i, groupTipId);
    return i.reply({ content: "Unknown group tip action.", ephemeral: true });
}
// NEW: Handle adding to group tip
export async function handleGroupTipAdd(i, groupTipId) {
    // Concurrent protection - prevent double contributions during viral scenarios
    const contributionKey = `${groupTipId}:${i.user.id}:add`;
    if (pendingContributions.has(contributionKey)) {
        return i.reply({
            content: "🐧 Hold your penguins! Your contribution is already being processed... 🐟",
            ephemeral: true
        });
    }
    pendingContributions.add(contributionKey);
    try {
        // Get group tip info for context
        const { prisma } = await import("../services/db.js");
        const groupTip = await Promise.race([
            prisma.groupTip.findUnique({
                where: { id: groupTipId },
                include: { Token: true, Creator: true }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Query timeout")), 1000))
        ]);
        if (!groupTip) {
            return i.reply({
                content: "🐧 Group tip not found! It might have expired or been removed.",
                ephemeral: true
            });
        }
        // Check if expired
        if (groupTip.expiresAt.getTime() < Date.now()) {
            return i.reply({
                content: "🐧 This group tip has expired! You can't contribute anymore. 🕒",
                ephemeral: true
            });
        }
        // Check if user is the creator
        if (groupTip.Creator && groupTip.Creator.discordId === i.user.id) {
            return i.reply({
                content: "🐧 You can't add to your own group tip! That's like tipping yourself! 😄",
                ephemeral: true
            });
        }
        // Check if already contributed or claimed
        const user = await prisma.user.findUnique({
            where: { discordId: i.user.id }
        });
        let hasContribution = false;
        let hasClaim = false;
        if (user) {
            const [existingContribution, existingClaim] = await Promise.all([
                prisma.groupTipContribution.findUnique({
                    where: {
                        groupTipId_contributorId: {
                            groupTipId,
                            contributorId: user.id
                        }
                    }
                }),
                prisma.groupTipClaim.findUnique({
                    where: {
                        groupTipId_userId: {
                            groupTipId,
                            userId: user.id
                        }
                    }
                })
            ]);
            hasContribution = !!existingContribution;
            hasClaim = !!existingClaim;
        }
        const userStatus = { hasContribution, hasClaim };
        if (userStatus.hasContribution) {
            return i.reply({
                content: "🐧 You've already contributed to this group tip! One contribution per penguin! 🐟",
                ephemeral: true
            });
        }
        if (userStatus.hasClaim) {
            return i.reply({
                content: "🐧 You've already claimed this group tip! You can't contribute after claiming! 🎯",
                ephemeral: true
            });
        }
        // Create modal for contribution amount
        const modal = new ModalBuilder()
            .setCustomId(`grouptip_contribute:${groupTipId}`)
            .setTitle(`🐟 Add Fish to Group Tip`);
        const amountInput = new TextInputBuilder()
            .setCustomId('contribution_amount')
            .setLabel(`Amount to contribute (${groupTip.Token.symbol})`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter amount...')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(20);
        const row = new ActionRowBuilder().addComponents(amountInput);
        modal.addComponents(row);
        await i.showModal(modal);
    }
    catch (error) {
        console.error("Error in handleGroupTipAdd:", error);
        await i.reply({
            content: `🐧 Oops! Something went wrong: ${error?.message || String(error)}`,
            ephemeral: true
        });
    }
    finally {
        pendingContributions.delete(contributionKey);
    }
}
