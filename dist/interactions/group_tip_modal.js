import { prisma } from "../services/db.js";
import { addGroupTipContribution } from "../services/group_tip_contributions.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
async function handleGroupTipContributeModal(i, groupTipId) {
  await i.deferReply({ ephemeral: true });
  console.log(`\u{1F41F} handleGroupTipContributeModal: Processing contribution for tip ${groupTipId}`);
  try {
    const groupTip = await prisma.groupTip.findUnique({
      where: { id: groupTipId },
      include: { Token: true }
    });
    if (!groupTip) {
      return i.editReply({
        content: "\u274C Group tip not found!"
      });
    }
    const amountInput = i.fields.getTextInputValue("contribution_amount");
    const sanitizedInput = amountInput.trim().replace(/[^0-9.]/g, "");
    const contributionAmount = parseFloat(sanitizedInput);
    if (isNaN(contributionAmount) || contributionAmount <= 0) {
      return i.editReply({
        content: `\u{1F427} That doesn't look like a valid amount! Please enter a positive number like '50' or '25.5'. Penguins are very particular about ${groupTip.Token.symbol} counting! \u{1F41F}`
      });
    }
    if (contributionAmount > 1e6) {
      return i.editReply({
        content: `\u274C Amount too large! Maximum contribution is 1,000,000 ${groupTip.Token.symbol}.`
      });
    }
    const { getConfig } = await import("../config.js");
    const { userHasActiveTaxFreeTier } = await import("../services/tiers.js");
    const { RoleTaxBenefitService } = await import("../services/role_tax_benefits.js");
    const { toAtomicDirect, bigToDecDirect } = await import("../services/token.js");
    const user = await prisma.user.upsert({
      where: { discordId: i.user.id },
      update: {},
      create: { discordId: i.user.id }
    });
    const cfg = await getConfig();
    const atomic = toAtomicDirect(contributionAmount, groupTip.Token.decimals);
    const bestTaxBenefit = await RoleTaxBenefitService.getBestTaxBenefit(
      user.id,
      groupTip.guildId || "",
      i.user.id
    );
    let feeBpsNum = groupTip.Token.tipFeeBps ?? cfg?.tipFeeBps ?? 100;
    if (bestTaxBenefit) {
      const taxReduction = bestTaxBenefit.exemptionRate / 100;
      feeBpsNum = Math.round(feeBpsNum * (1 - taxReduction));
    } else {
      const taxFree = await userHasActiveTaxFreeTier(user.id);
      feeBpsNum = taxFree ? 0 : feeBpsNum;
    }
    const feeBps = BigInt(feeBpsNum);
    const feeAtomic = atomic * feeBps / 10000n;
    const taxAmount = Number(bigToDecDirect(feeAtomic, groupTip.Token.decimals));
    const totalCost = contributionAmount + taxAmount;
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
    const confirmButton = new ButtonBuilder().setCustomId(`grouptip:confirm:${groupTipId}:${contributionAmount}`).setLabel("\u2705 Confirm Payment").setStyle(ButtonStyle.Success);
    const cancelButton = new ButtonBuilder().setCustomId(`grouptip:cancel:${groupTipId}`).setLabel("\u274C Cancel").setStyle(ButtonStyle.Secondary);
    const actionRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
    if (taxAmount > 0) {
      await i.editReply({
        content: `\u{1F4B0} **Tax Calculation**

\u{1F41F} Contribution: ${contributionAmount} ${groupTip.Token.symbol}
\u{1F4B8} Tax (${(feeBpsNum / 100).toFixed(1)}%): ${taxAmount.toFixed(4)} ${groupTip.Token.symbol}
\u{1F4B3} **Total Cost: ${totalCost.toFixed(4)} ${groupTip.Token.symbol}**

Do you want to proceed with this payment?`,
        components: [actionRow]
      });
    } else {
      await i.editReply({
        content: `\u{1F389} **Tax-Free Contribution!**

\u{1F41F} Contribution: ${contributionAmount} ${groupTip.Token.symbol}
\u{1F4B8} Tax: FREE! \u{1F389}
\u{1F4B3} **Total Cost: ${contributionAmount} ${groupTip.Token.symbol}**

Do you want to proceed with this payment?`,
        components: [actionRow]
      });
    }
    return;
    const contributionPromise = addGroupTipContribution(groupTipId, i.user.id, contributionAmount);
    const timeoutPromise = new Promise(
      (_, reject) => setTimeout(() => reject(new Error("Contribution timeout - database may be overloaded")), 3e4)
    );
    const result = await Promise.race([contributionPromise, timeoutPromise]);
    if (result.success) {
      try {
        console.log(`\u{1F504} Updating group tip message for tip ${groupTipId} after contribution`);
        await updateGroupTipMessage(i.client, groupTipId);
        console.log(`\u2705 Successfully updated group tip message for tip ${groupTipId}`);
      } catch (updateError) {
        console.error("Failed to update group tip message:", updateError);
      }
      await i.editReply({
        content: result.message
      });
    } else {
      await i.editReply({
        content: result.message
      });
    }
  } catch (error) {
    console.error("Group tip contribution modal error:", error);
    await i.editReply({
      content: `\u{1F427} Something went wrong while processing your contribution: ${error?.message || String(error)}

Don't worry, your fish are safe! Please try again. \u{1F41F}`
    });
  }
}
async function handleGroupTipModal(i) {
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
export {
  handleGroupTipContributeModal,
  handleGroupTipModal
};
//# sourceMappingURL=group_tip_modal.js.map
