import { prisma } from "../services/db.js";
import { addGroupTipContribution } from "../services/group_tip_contributions.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
export async function handleGroupTipContributeModal(i, groupTipId) {
    // Manual defer for modal interactions
    await i.deferReply({ ephemeral: true });
    console.log(`🐟 handleGroupTipContributeModal: Processing contribution for tip ${groupTipId}`);
    try {
        // Get the group tip to know the token details
        const groupTip = await prisma.groupTip.findUnique({
            where: { id: groupTipId },
            include: { Token: true }
        });
        if (!groupTip) {
            return i.editReply({
                content: "❌ Group tip not found!"
            });
        }
        // Extract contribution amount from modal
        const amountInput = i.fields.getTextInputValue('contribution_amount');
        // Input validation and sanitization
        const sanitizedInput = amountInput.trim().replace(/[^0-9.]/g, '');
        const contributionAmount = parseFloat(sanitizedInput);
        // Validate the amount
        if (isNaN(contributionAmount) || contributionAmount <= 0) {
            return i.editReply({
                content: `🐧 That doesn't look like a valid amount! Please enter a positive number like '50' or '25.5'. Penguins are very particular about ${groupTip.Token.symbol} counting! 🐟`
            });
        }
        // Simple atomic conversion - limit to reasonable amounts to avoid overflow
        if (contributionAmount > 1000000) {
            return i.editReply({
                content: `❌ Amount too large! Maximum contribution is 1,000,000 ${groupTip.Token.symbol}.`
            });
        }
        // No conversion needed - addGroupTipContribution expects human-readable amount
        // The function will handle the internal conversion to atomic units as needed
        console.log('DEBUG: Modal contribution conversion', {
            userInput: amountInput,
            sanitizedInput,
            contributionAmount,
            tokenSymbol: groupTip.Token.symbol,
            tokenDecimals: groupTip.Token.decimals
        });
        // Calculate and show exact tax before processing
        const { getConfig } = await import("../config.js");
        const { userHasActiveTaxFreeTier } = await import("../services/tiers.js");
        const { RoleTaxBenefitService } = await import("../services/role_tax_benefits.js");
        const { toAtomicDirect, bigToDecDirect } = await import("../services/token.js");
        // Ensure user exists for tax calculation
        const user = await prisma.user.upsert({
            where: { discordId: i.user.id },
            update: {},
            create: { discordId: i.user.id }
        });
        // Calculate exact tax
        const cfg = await getConfig();
        const atomic = toAtomicDirect(contributionAmount, groupTip.Token.decimals);
        const bestTaxBenefit = await RoleTaxBenefitService.getBestTaxBenefit(user.id, groupTip.guildId || '', i.user.id);
        let feeBpsNum = groupTip.Token.tipFeeBps ?? cfg?.tipFeeBps ?? 100;
        if (bestTaxBenefit) {
            const taxReduction = bestTaxBenefit.exemptionRate / 100;
            feeBpsNum = Math.round(feeBpsNum * (1 - taxReduction));
        }
        else {
            const taxFree = await userHasActiveTaxFreeTier(user.id);
            feeBpsNum = taxFree ? 0 : feeBpsNum;
        }
        const feeBps = BigInt(feeBpsNum);
        const feeAtomic = (atomic * feeBps) / 10000n;
        const taxAmount = Number(bigToDecDirect(feeAtomic, groupTip.Token.decimals));
        const totalCost = contributionAmount + taxAmount;
        // Show tax preview and ask for confirmation
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
        const confirmButton = new ButtonBuilder()
            .setCustomId(`grouptip:confirm:${groupTipId}:${contributionAmount}`)
            .setLabel('✅ Confirm Payment')
            .setStyle(ButtonStyle.Success);
        const cancelButton = new ButtonBuilder()
            .setCustomId(`grouptip:cancel:${groupTipId}`)
            .setLabel('❌ Cancel')
            .setStyle(ButtonStyle.Secondary);
        const actionRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
        if (taxAmount > 0) {
            await i.editReply({
                content: `💰 **Tax Calculation**\n\n` +
                    `🐟 Contribution: ${contributionAmount} ${groupTip.Token.symbol}\n` +
                    `💸 Tax (${(feeBpsNum / 100).toFixed(1)}%): ${taxAmount.toFixed(4)} ${groupTip.Token.symbol}\n` +
                    `💳 **Total Cost: ${totalCost.toFixed(4)} ${groupTip.Token.symbol}**\n\n` +
                    `Do you want to proceed with this payment?`,
                components: [actionRow]
            });
        }
        else {
            await i.editReply({
                content: `🎉 **Tax-Free Contribution!**\n\n` +
                    `🐟 Contribution: ${contributionAmount} ${groupTip.Token.symbol}\n` +
                    `💸 Tax: FREE! 🎉\n` +
                    `💳 **Total Cost: ${contributionAmount} ${groupTip.Token.symbol}**\n\n` +
                    `Do you want to proceed with this payment?`,
                components: [actionRow]
            });
        }
        // Don't process the contribution here - wait for button confirmation
        return;
        // Process the contribution with timeout
        const contributionPromise = addGroupTipContribution(groupTipId, i.user.id, contributionAmount);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Contribution timeout - database may be overloaded')), 30000));
        const result = await Promise.race([contributionPromise, timeoutPromise]);
        if (result.success) {
            // Update the group tip message to show new total and contributors
            try {
                console.log(`🔄 Updating group tip message for tip ${groupTipId} after contribution`);
                await updateGroupTipMessage(i.client, groupTipId);
                console.log(`✅ Successfully updated group tip message for tip ${groupTipId}`);
            }
            catch (updateError) {
                console.error("Failed to update group tip message:", updateError);
                // Don't fail the entire operation if message update fails
            }
            // Success response
            await i.editReply({
                content: result.message
            });
        }
        else {
            // Error response
            await i.editReply({
                content: result.message
            });
        }
    }
    catch (error) {
        console.error("Group tip contribution modal error:", error);
        await i.editReply({
            content: `🐧 Something went wrong while processing your contribution: ${error?.message || String(error)}\n\nDon't worry, your fish are safe! Please try again. 🐟`
        });
    }
}
/** Router for group tip modal submissions */
export async function handleGroupTipModal(i) {
    const [action, id] = i.customId.split(":");
    if (action !== "grouptip_contribute") {
        return i.reply({
            content: "Unknown group tip modal action.",
            ephemeral: true
        });
    }
    const groupTipId = Number(id);
    if (!Number.isFinite(groupTipId)) {
        return i.reply({
            content: "Invalid group tip ID.",
            ephemeral: true
        });
    }
    return handleGroupTipContributeModal(i, groupTipId);
}
