import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "discord.js";
import { prisma } from "../services/db.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
export async function handleGroupTipClaim(i, groupTipId) {
    // No manual defer - let the auto-defer wrapper handle it to avoid double acknowledgment
    console.log(`🎯 handleGroupTipClaim: Starting claim for tip ${groupTipId} by user ${i.user.id}`);
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
            // Ensure user exists
            const user = await tx.user.upsert({
                where: { discordId: i.user.id },
                update: {},
                create: { discordId: i.user.id },
            });
            // Check if user has already contributed - can't claim after contributing
            const existingContribution = await tx.groupTipContribution.findUnique({
                where: {
                    groupTipId_contributorId: {
                        groupTipId: tip.id,
                        contributorId: user.id
                    }
                }
            });
            if (existingContribution) {
                throw new Error("You cannot claim from this group tip because you've already contributed to it! Choose one: give or receive, but not both! 🐧");
            }
            // Record claim (catch duplicate if they spam-click)
            try {
                await tx.groupTipClaim.create({
                    data: {
                        groupTipId: tip.id,
                        userId: user.id,
                        status: 'CLAIMED', // Mark as CLAIMED immediately when user claims
                        claimedAt: new Date()
                    },
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
        // If the tip had already expired, just update message (let native timer handle finalization)
        if (result.expired) {
            // Don't call finalizeExpiredGroupTip here - let the native timer handle it to avoid race conditions
            console.log(`🎯 handleGroupTipClaim: Tip ${result.groupTipId} expired, updating message and rejecting claim`);
            await updateGroupTipMessage(i.client, result.groupTipId);
            return i.editReply({ content: "<a:PenguNo:1415469218681585674> This group tip has expired — claims are closed." });
        }
        // Normal path: update card and confirm claim
        console.log(`🎯 handleGroupTipClaim: Tip ${result.groupTipId} claim successful, updating message to show ${result.newClaimCount} claims`);
        await updateGroupTipMessage(i.client, result.groupTipId);
        console.log(`🎯 handleGroupTipClaim: Message updated, sending confirmation to user`);
        await i.editReply({
            content: `✅ You're in! You'll receive your share when the timer expires. (${result.newClaimCount} people claimed so far)`,
        });
    }
    catch (error) {
        console.error(`🎯 handleGroupTipClaim: Error in tip ${groupTipId}:`, error.message);
        try {
            await i.editReply({ content: `${error?.message || String(error)}` });
        }
        catch (replyError) {
            console.error(`🎯 handleGroupTipClaim: Failed to send error reply:`, replyError.message);
        }
    }
}
export async function handleGroupTipAdd(i, groupTipId) {
    console.log(`🐟 handleGroupTipAdd: Starting add more fish for tip ${groupTipId} by user ${i.user.id}`);
    try {
        // Get tip info to validate and show in modal
        const tip = await prisma.groupTip.findUnique({
            where: { id: groupTipId },
            include: {
                Creator: true,
                Token: true,
            },
        });
        if (!tip) {
            return i.reply({ content: "❌ Group tip not found!", ephemeral: true });
        }
        const now = new Date();
        const isExpired = tip.expiresAt.getTime() < now.getTime();
        if (isExpired) {
            return i.reply({ content: "❌ This group tip has expired - no more fish can be added!", ephemeral: true });
        }
        if (tip.status !== "ACTIVE") {
            return i.reply({ content: "❌ This group tip is no longer active!", ephemeral: true });
        }
        // Check if user is the creator
        if (tip.Creator && tip.Creator.discordId === i.user.id) {
            return i.reply({ content: "❌ You cannot add more fish to your own group tip!", ephemeral: true });
        }
        // Ensure user exists for claim check
        const user = await prisma.user.upsert({
            where: { discordId: i.user.id },
            update: {},
            create: { discordId: i.user.id }
        });
        // Check if user has already claimed - can't contribute after claiming
        const existingClaim = await prisma.groupTipClaim.findUnique({
            where: {
                groupTipId_userId: {
                    groupTipId: groupTipId,
                    userId: user.id
                }
            }
        });
        if (existingClaim) {
            return i.reply({
                content: "❌ You cannot add fish to this group tip because you've already claimed from it! Choose one: give or receive, but not both! 🐧",
                ephemeral: true
            });
        }
        // Get user's tax rate for display in modal
        const { getConfig } = await import("../config.js");
        const { userHasActiveTaxFreeTier } = await import("../services/tiers.js");
        const { RoleTaxBenefitService } = await import("../services/role_tax_benefits.js");
        // Calculate user's tax rate
        const cfg = await getConfig();
        const bestTaxBenefit = await RoleTaxBenefitService.getBestTaxBenefit(user.id, tip.guildId || '', i.user.id);
        let feeBpsNum = tip.Token.tipFeeBps ?? cfg?.tipFeeBps ?? 100;
        if (bestTaxBenefit) {
            const taxReduction = bestTaxBenefit.exemptionRate / 100;
            feeBpsNum = Math.round(feeBpsNum * (1 - taxReduction));
        }
        else {
            const taxFree = await userHasActiveTaxFreeTier(user.id);
            feeBpsNum = taxFree ? 0 : feeBpsNum;
        }
        const taxPercentage = (feeBpsNum / 100).toFixed(1);
        // Calculate example tax for preview
        const exampleAmount = 100;
        const exampleTaxAmount = (exampleAmount * feeBpsNum) / 10000;
        const exampleTotal = exampleAmount + exampleTaxAmount;
        const taxDisplay = feeBpsNum === 0
            ? "Tax-free! You pay exactly what you contribute."
            : `${taxPercentage}% tax applies (e.g., ${exampleAmount} ${tip.Token.symbol} + ${exampleTaxAmount.toFixed(2)} tax = ${exampleTotal.toFixed(2)} total)`;
        // Show modal for contribution amount
        const modal = new ModalBuilder()
            .setCustomId(`grouptip_contribute:${groupTipId}`)
            .setTitle(`🐟 Add ${tip.Token.symbol} to Colony`);
        const amountInput = new TextInputBuilder()
            .setCustomId("contribution_amount")
            .setLabel(`How many ${tip.Token.symbol} to add?`)
            .setPlaceholder(`Enter amount - ${taxDisplay}`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(20);
        const actionRow = new ActionRowBuilder().addComponents(amountInput);
        modal.addComponents(actionRow);
        console.log(`🐟 handleGroupTipAdd: Showing modal for tip ${groupTipId}`);
        await i.showModal(modal);
    }
    catch (error) {
        console.error(`🐟 handleGroupTipAdd: Error in tip ${groupTipId}:`, error.message);
        try {
            await i.reply({ content: `❌ Error: ${error?.message || String(error)}`, ephemeral: true });
        }
        catch (replyError) {
            console.error(`🐟 handleGroupTipAdd: Failed to send error reply:`, replyError.message);
        }
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
