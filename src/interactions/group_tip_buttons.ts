import type { ButtonInteraction } from "discord.js";
import { prisma } from "../services/db.js";
import { updateGroupTipMessage } from "../features/group_tip_helpers.js";
import { finalizeExpiredGroupTip } from "../features/finalizeExpiredGroupTip.js";

export async function handleGroupTipClaim(i: ButtonInteraction, groupTipId: number) {
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
      if (!tip) throw new Error("Group tip not found");

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
} catch (err: any) {
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
      return i.editReply({ content: "This group tip has expired — claims are closed." });
    }

    // Normal path: update card and confirm claim
    await updateGroupTipMessage(i.client, result.groupTipId);
    await i.editReply({
      content: `✅ You're in! You'll receive your share when the timer expires. (${result.newClaimCount} people claimed so far)`,
    });
  } catch (error: any) {
    await i.editReply({ content: `${error?.message || String(error)}` });
  }
}

/** Router for group tip button customIds: grouptip:<action>:<groupTipId> */
export async function handleGroupTipButton(i: ButtonInteraction) {
  const [ns, action, id] = i.customId.split(":");
  if (ns !== "grouptip") return;

  const groupTipId = Number(id);
  if (!Number.isFinite(groupTipId)) {
    return i.reply({ content: "Invalid group tip ID.", ephemeral: true });
  }

  if (action === "claim") return handleGroupTipClaim(i, groupTipId);
  return i.reply({ content: "Unknown group tip action.", ephemeral: true });
}
