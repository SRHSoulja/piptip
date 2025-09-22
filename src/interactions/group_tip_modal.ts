// src/interactions/group_tip_modal.ts - Modal handler for group tip contributions
import type { ModalSubmitInteraction } from "discord.js";
import { prisma } from "../services/db.js";
import { addGroupTipContribution } from "../services/group_tip_contributions.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
import { PENGUIN_LOADING } from "../utils/penguin_messages.js";
import { decToBigDirect } from "../services/token.js";

export async function handleGroupTipContributeModal(i: ModalSubmitInteraction, groupTipId: number) {
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

    // Convert to atomic units using the existing codebase logic
    const decimals = groupTip.Token.decimals;
    let atomicAmount: number;

    try {
      // Use the same conversion logic as the rest of the codebase
      const atomicBigInt = decToBigDirect(contributionAmount, decimals);

      // Check if the result fits in a safe JavaScript number
      if (atomicBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
        return i.editReply({
          content: `❌ Amount too large for processing. Please use a smaller amount (max ~9 quadrillion atomic units).`
        });
      }

      atomicAmount = Number(atomicBigInt);
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