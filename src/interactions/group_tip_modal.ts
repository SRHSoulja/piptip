// src/interactions/group_tip_modal.ts - Modal handler for group tip contributions
import type { ModalSubmitInteraction } from "discord.js";
import { prisma } from "../services/db.js";
import { addGroupTipContribution } from "../services/group_tip_contributions.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
import { PENGUIN_LOADING } from "../utils/penguin_messages.js";

export async function handleGroupTipContributeModal(i: ModalSubmitInteraction, groupTipId: number) {
  // No manual defer - let the auto-defer wrapper handle it
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

    // Convert to atomic units safely - use a simple approach for common decimals
    const decimals = groupTip.Token.decimals;
    let atomicAmount: number;

    try {
      if (decimals <= 6) {
        // Safe for tokens with 6 or fewer decimals
        atomicAmount = Math.floor(contributionAmount * Math.pow(10, decimals));
      } else {
        // For tokens with more decimals, use string manipulation to avoid overflow
        const parts = contributionAmount.toFixed(decimals).split('.');
        const wholePart = parts[0] || '0';
        const decimalPart = (parts[1] || '').padEnd(decimals, '0').substring(0, decimals);
        const atomicString = wholePart + decimalPart;
        const cleanedString = atomicString.replace(/^0+/, '') || '0';

        if (cleanedString.length > 15) {
          return i.editReply({
            content: `❌ Amount results in a number too large for processing. Please use a smaller amount.`
          });
        }

        atomicAmount = parseInt(cleanedString, 10);
      }
    } catch (conversionError) {
      console.error('Conversion error:', conversionError);
      return i.editReply({
        content: `❌ Failed to convert amount. Please enter a valid number like '50' or '25.5'.`
      });
    }

    console.log('DEBUG: Modal contribution conversion', {
      userInput: amountInput,
      sanitizedInput,
      contributionAmount,
      tokenSymbol: groupTip.Token.symbol,
      tokenDecimals: decimals,
      atomicAmount: atomicAmount.toString()
    });

    // Show loading message
    await i.editReply({
      content: PENGUIN_LOADING.tip() + "\n*Calculating tax and processing your contribution...*"
    });

    // Process the contribution
    const result = await addGroupTipContribution(groupTipId, i.user.id, atomicAmount);

    if (result.success) {
      // Update the group tip message to show new total and contributors
      try {
        await updateGroupTipMessage(i.client, groupTipId);
      } catch (updateError) {
        console.warn("Failed to update group tip message:", updateError);
        // Don't fail the entire operation if message update fails
      }

      // Success response
      await i.editReply({
        content: result.message
      });
    } else {
      // Error response
      await i.editReply({
        content: result.message
      });
    }

  } catch (error: any) {
    console.error("Group tip contribution modal error:", error);
    await i.editReply({
      content: `🐧 Something went wrong while processing your contribution: ${error?.message || String(error)}\n\nDon't worry, your fish are safe! Please try again. 🐟`
    });
  }
}

/** Router for group tip modal submissions */
export async function handleGroupTipModal(i: ModalSubmitInteraction) {
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