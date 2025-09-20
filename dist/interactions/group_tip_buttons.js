import { prisma } from "../services/db.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
import { finalizeExpiredGroupTip } from "../features/finalizeExpiredGroupTip.js";
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "discord.js";
export async function handleGroupTipClaim(i, groupTipId) {
    await i.deferReply({ ephemeral: true });
    try {
        const result = await prisma.$transaction(async (tx) => {
            const tip = await tx.groupTip.findUnique({
                where: { id: groupTipId },
                include: {
                    Creator: true,
                    Token: true,
                },
            });
            if (!tip)
                throw new Error("Group tip not found");
            const now = new Date();
            const isExpired = tip.expiresAt.getTime() < now.getTime();
            // If expired, short-circuit: do NOT finalize inside this tx
            if (isExpired) {
                return { expired: true, status: tip.status, groupTipId: tip.id };
            }
            if (tip.status !== "ACTIVE") {
                throw new Error("This group tip is no longer active");
            }
            // Don't let creator claim
            if (tip.Creator && tip.Creator.discordId === i.user.id) {
                throw new Error("You cannot claim your own group tip");
            }
            // Skip preloaded claims check - rely on DB unique constraint below
            // Ensure user exists
            // Ensure user exists
            const user = await tx.user.upsert({
                where: { discordId: i.user.id },
                update: {},
                create: { discordId: i.user.id },
            });
            // Record claim (catch duplicate if they spam-click)
            try {
                await tx.groupTipClaim.create({
                    data: { groupTipId: tip.id, userId: user.id },
                });
            }
            catch (err) {
                // Prisma unique constraint on @@unique([groupTipId, userId])
                if (err?.code === "P2002") {
                    // Track unique violation for monitoring
                    const { incrementUniqueViolationClaims } = await import("../services/metrics.js");
                    incrementUniqueViolationClaims();
                    throw new Error("You have already claimed this group tip");
                }
                throw err;
            }
            // Get current claim count after successful insert
            const claimCount = await tx.groupTipClaim.count({
                where: { groupTipId: tip.id },
            });
            return {
                expired: false,
                groupTipId: tip.id,
                newClaimCount: claimCount,
            };
        });
        // If the tip had already expired, finalize now (idempotent) and refresh
        if (result.expired) {
            if (result.status === "ACTIVE") {
                await i.editReply({ content: "⏳ Finalizing this group tip…" });
                await finalizeExpiredGroupTip(result.groupTipId);
            }
            await updateGroupTipMessage(i.client, result.groupTipId);
            return i.editReply({ content: "<a:PenguNo:1415469218681585674> This group tip has expired — claims are closed." });
        }
        // Normal path: update card and confirm claim
        await updateGroupTipMessage(i.client, result.groupTipId);
        await i.editReply({
            content: `✅ You're in! You'll receive your share when the timer expires. (${result.newClaimCount} people claimed so far)`,
        });
    }
    catch (error) {
        await i.editReply({ content: `${error?.message || String(error)}` });
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
    try {
        // Get group tip info for context
        const groupTip = await prisma.groupTip.findUnique({
            where: { id: groupTipId },
            include: { Token: true, Creator: true }
        });
        if (!groupTip) {
            return i.reply({
                content: "🐧 Group tip not found! It might have expired or been removed.",
                ephemeral: true
            });
        }
        // Check if expired
        if (groupTip.expiresAt.getTime() < Date.now()) {
            return i.reply({
                content: "🐧 This group tip has expired! You can no longer add to it.",
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
        // Check if already contributed
        const user = await prisma.user.findUnique({
            where: { discordId: i.user.id }
        });
        if (user) {
            const existingContribution = await prisma.groupTipContribution.findUnique({
                where: {
                    groupTipId_contributorId: {
                        groupTipId: groupTipId,
                        contributorId: user.id
                    }
                }
            });
            if (existingContribution) {
                return i.reply({
                    content: "🐧 You've already contributed to this group tip! One contribution per penguin! 🐟",
                    ephemeral: true
                });
            }
        }
        // Create modal for contribution amount
        const modal = new ModalBuilder()
            .setCustomId(`grouptip_contribute:${groupTipId}`)
            .setTitle(`🐟 Add Fish to Group Tip`);
        const amountInput = new TextInputBuilder()
            .setCustomId('contribution_amount')
            .setLabel(`Amount to contribute (${groupTip.Token.symbol})`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., 50')
            .setRequired(true)
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
}
