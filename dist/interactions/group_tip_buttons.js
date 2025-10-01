import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "discord.js";
import { prisma } from "../services/db.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
async function handleGroupTipClaim(i, groupTipId) {
  console.log(`\u{1F3AF} handleGroupTipClaim: Starting claim for tip ${groupTipId} by user ${i.user.id}`);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const tip = await tx.groupTip.findUnique({
        where: { id: groupTipId },
        include: {
          Creator: true,
          Token: true
        }
      });
      if (!tip) throw new Error("Group tip not found");
      const now = /* @__PURE__ */ new Date();
      const isExpired = tip.expiresAt.getTime() < now.getTime();
      if (isExpired) {
        return { expired: true, status: tip.status, groupTipId: tip.id };
      }
      if (tip.status !== "ACTIVE") {
        throw new Error("This group tip is no longer active");
      }
      if (tip.Creator && tip.Creator.discordId === i.user.id) {
        throw new Error("You cannot claim your own group tip");
      }
      const user = await tx.user.upsert({
        where: { discordId: i.user.id },
        update: {},
        create: { discordId: i.user.id }
      });
      const existingContribution = await tx.groupTipContribution.findUnique({
        where: {
          groupTipId_contributorId: {
            groupTipId: tip.id,
            contributorId: user.id
          }
        }
      });
      if (existingContribution) {
        throw new Error("You cannot claim from this group tip because you've already contributed to it! Choose one: give or receive, but not both! \u{1F427}");
      }
      try {
        await tx.groupTipClaim.create({
          data: {
            groupTipId: tip.id,
            userId: user.id,
            status: "CLAIMED",
            // Mark as CLAIMED immediately when user claims
            claimedAt: /* @__PURE__ */ new Date()
          }
        });
      } catch (err) {
        if (err?.code === "P2002") {
          const { incrementUniqueViolationClaims } = await import("../services/metrics.js");
          incrementUniqueViolationClaims();
          throw new Error("You have already claimed this group tip");
        }
        throw err;
      }
      const claimCount = await tx.groupTipClaim.count({
        where: { groupTipId: tip.id }
      });
      return {
        expired: false,
        groupTipId: tip.id,
        newClaimCount: claimCount
      };
    });
    if (result.expired) {
      console.log(`\u{1F3AF} handleGroupTipClaim: Tip ${result.groupTipId} expired, updating message and rejecting claim`);
      await updateGroupTipMessage(i.client, result.groupTipId);
      return i.editReply({ content: "<a:PenguNo:1415469218681585674> This group tip has expired \u2014 claims are closed." });
    }
    console.log(`\u{1F3AF} handleGroupTipClaim: Tip ${result.groupTipId} claim successful, updating message to show ${result.newClaimCount} claims`);
    await updateGroupTipMessage(i.client, result.groupTipId);
    console.log(`\u{1F3AF} handleGroupTipClaim: Message updated, sending confirmation to user`);
    await i.editReply({
      content: `\u2705 You're in! You'll receive your share when the timer expires. (${result.newClaimCount} people claimed so far)`
    });
  } catch (error) {
    console.error(`\u{1F3AF} handleGroupTipClaim: Error in tip ${groupTipId}:`, error.message);
    try {
      await i.editReply({ content: `${error?.message || String(error)}` });
    } catch (replyError) {
      console.error(`\u{1F3AF} handleGroupTipClaim: Failed to send error reply:`, replyError.message);
    }
  }
}
async function handleGroupTipAdd(i, groupTipId) {
  console.log(`\u{1F41F} handleGroupTipAdd: Starting add more fish for tip ${groupTipId} by user ${i.user.id}`);
  try {
    const tip = await prisma.groupTip.findUnique({
      where: { id: groupTipId },
      include: {
        Creator: true,
        Token: true
      }
    });
    if (!tip) {
      return i.reply({ content: "\u274C Group tip not found!", ephemeral: true });
    }
    const now = /* @__PURE__ */ new Date();
    const isExpired = tip.expiresAt.getTime() < now.getTime();
    if (isExpired) {
      return i.reply({ content: "\u274C This group tip has expired - no more fish can be added!", ephemeral: true });
    }
    if (tip.status !== "ACTIVE") {
      return i.reply({ content: "\u274C This group tip is no longer active!", ephemeral: true });
    }
    if (tip.Creator && tip.Creator.discordId === i.user.id) {
      return i.reply({ content: "\u274C You cannot add more fish to your own group tip!", ephemeral: true });
    }
    const user = await prisma.user.upsert({
      where: { discordId: i.user.id },
      update: {},
      create: { discordId: i.user.id }
    });
    const existingClaim = await prisma.groupTipClaim.findUnique({
      where: {
        groupTipId_userId: {
          groupTipId,
          userId: user.id
        }
      }
    });
    if (existingClaim) {
      return i.reply({
        content: "\u274C You cannot add fish to this group tip because you've already claimed from it! Choose one: give or receive, but not both! \u{1F427}",
        ephemeral: true
      });
    }
    const existingContribution = await prisma.groupTipContribution.findUnique({
      where: {
        groupTipId_contributorId: {
          groupTipId,
          contributorId: user.id
        }
      }
    });
    if (existingContribution) {
      return i.reply({
        content: "\u274C You have already added fish to this group tip! Only one contribution per penguin is allowed. \u{1F427}",
        ephemeral: true
      });
    }
    const modal = new ModalBuilder().setCustomId(`grouptip_contribute:${groupTipId}`).setTitle(`\u{1F41F} Add ${tip.Token.symbol} to Colony`);
    const amountInput = new TextInputBuilder().setCustomId("contribution_amount").setLabel(`How many ${tip.Token.symbol} to add?`).setPlaceholder("Enter amount (e.g., 50, 25.5) - tax calculated before payment").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20);
    const actionRow = new ActionRowBuilder().addComponents(amountInput);
    modal.addComponents(actionRow);
    console.log(`\u{1F41F} handleGroupTipAdd: Showing modal for tip ${groupTipId}`);
    await i.showModal(modal);
  } catch (error) {
    console.error(`\u{1F41F} handleGroupTipAdd: Error in tip ${groupTipId}:`, error.message);
    try {
      await i.reply({ content: `\u274C Error: ${error?.message || String(error)}`, ephemeral: true });
    } catch (replyError) {
      console.error(`\u{1F41F} handleGroupTipAdd: Failed to send error reply:`, replyError.message);
    }
  }
}
async function handleGroupTipConfirm(i, groupTipId, contributionAmount) {
  await i.deferUpdate();
  console.log(`\u2705 handleGroupTipConfirm: Processing confirmed contribution for tip ${groupTipId}`);
  try {
    const { addGroupTipContribution } = await import("../services/group_tip_contributions.js");
    const { updateGroupTipMessage: updateGroupTipMessage2 } = await import("../features/group_tip_helpers.js");
    const { PENGUIN_LOADING } = await import("../utils/penguin_messages.js");
    await i.editReply({
      content: `${PENGUIN_LOADING.tip()} *Processing your contribution...*`,
      components: []
      // Remove the buttons during processing
    });
    const contributionPromise = addGroupTipContribution(groupTipId, i.user.id, contributionAmount);
    const timeoutPromise = new Promise(
      (_, reject) => setTimeout(() => reject(new Error("Contribution timeout - database may be overloaded")), 3e4)
    );
    const result = await Promise.race([contributionPromise, timeoutPromise]);
    if (result.success) {
      try {
        console.log(`\u{1F504} Updating group tip message for tip ${groupTipId} after contribution`);
        await updateGroupTipMessage2(i.client, groupTipId);
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
    console.error("Group tip confirmation error:", error);
    await i.editReply({
      content: `\u{1F427} Something went wrong while processing your contribution: ${error?.message || String(error)}

Don't worry, your fish are safe! Please try again. \u{1F41F}`
    });
  }
}
async function handleGroupTipCancel(i, groupTipId) {
  console.log(`\u274C handleGroupTipCancel: User cancelled contribution for tip ${groupTipId}`);
  await i.update({
    content: "\u274C Contribution cancelled. No payment was processed.",
    components: []
    // Remove the buttons
  });
}
async function handleGroupTipButton(i) {
  const [ns, action, id, ...params] = i.customId.split(":");
  if (ns !== "grouptip") return;
  const groupTipId = Number(id);
  if (!Number.isFinite(groupTipId)) {
    return i.reply({ content: "Invalid group tip ID.", ephemeral: true });
  }
  if (action === "claim") return handleGroupTipClaim(i, groupTipId);
  if (action === "add") return handleGroupTipAdd(i, groupTipId);
  if (action === "confirm") {
    const contributionAmount = Number(params[0]);
    if (!Number.isFinite(contributionAmount) || contributionAmount <= 0) {
      return i.reply({ content: "Invalid contribution amount.", ephemeral: true });
    }
    return handleGroupTipConfirm(i, groupTipId, contributionAmount);
  }
  if (action === "cancel") return handleGroupTipCancel(i, groupTipId);
  return i.reply({ content: "Unknown group tip action.", ephemeral: true });
}
export {
  handleGroupTipAdd,
  handleGroupTipButton,
  handleGroupTipClaim
};
//# sourceMappingURL=group_tip_buttons.js.map
