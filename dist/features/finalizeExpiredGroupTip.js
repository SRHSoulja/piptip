import { prisma } from "../services/db.js";
import { creditTokenTx } from "../services/balances.js";
import { decToBigDirect, formatAmount } from "../services/token.js";
import { RefundEngine } from "../services/refund_engine.js";
async function finalizeExpiredGroupTip(groupTipId) {
  const lock = await prisma.groupTip.updateMany({
    where: { id: groupTipId, status: "ACTIVE", expiresAt: { lte: /* @__PURE__ */ new Date() } },
    data: { status: "FINALIZING" }
  });
  if (lock.count === 0) return { kind: "NOOP" };
  const tip = await prisma.groupTip.findUnique({
    where: { id: groupTipId },
    include: {
      Creator: true,
      Token: true,
      claims: {
        include: { User: true },
        where: { status: { in: ["PENDING", "CLAIMED"] } }
      }
    }
  });
  if (!tip) return { kind: "NOOP" };
  const originalAtomic = decToBigDirect(tip.totalAmount, tip.Token.decimals);
  const contributionsAtomic = decToBigDirect(tip.contributionsTotal || 0, tip.Token.decimals);
  const totalAtomic = originalAtomic + contributionsAtomic;
  const pendingClaims = tip.claims.filter((c) => c.status === "PENDING");
  const claimedClaims = tip.claims.filter((c) => c.status === "CLAIMED");
  if (claimedClaims.length === 0) {
    const contributorRefunds = [];
    await prisma.$transaction(async (tx) => {
      const refundResult = await RefundEngine.refundContribution(tip.id);
      if (!refundResult.success) {
        throw new Error(`Failed to refund creator: ${refundResult.message}`);
      }
      const contributions = await tx.groupTipContribution.findMany({
        where: { groupTipId: tip.id, status: "COMPLETED" },
        include: { contributor: true }
      });
      for (const contrib of contributions) {
        const contributionAtomic = decToBigDirect(contrib.amount, tip.Token.decimals);
        const taxAtomic = decToBigDirect(contrib.taxPaid, tip.Token.decimals);
        const totalRefund = contributionAtomic + taxAtomic;
        await creditTokenTx(tx, contrib.contributor.discordId, tip.Token.id, totalRefund, "GROUP_TIP_REFUND", {
          guildId: tip.guildId ?? void 0,
          note: `Group tip contribution refund: ${contrib.amount} + ${contrib.taxPaid} tax`
        });
        await tx.groupTipContribution.update({
          where: { id: contrib.id },
          data: { status: "REFUNDED" }
        });
        contributorRefunds.push({
          discordId: contrib.contributor.discordId,
          amountText: formatAmount(totalRefund, tip.Token)
        });
      }
      if (pendingClaims.length > 0) {
        await tx.groupTipClaim.updateMany({
          where: { groupTipId: tip.id, status: "PENDING" },
          data: { status: "REFUNDED", refundedAt: /* @__PURE__ */ new Date() }
        });
      }
    });
    const creatorRefund = decToBigDirect(tip.totalAmount, tip.Token.decimals) + BigInt(tip.taxAtomic.toString());
    return {
      kind: "REFUNDED",
      creatorId: tip.Creator.discordId,
      amountText: formatAmount(creatorRefund, tip.Token),
      contributorRefunds: contributorRefunds.length > 0 ? contributorRefunds : void 0
    };
  }
  const n = BigInt(claimedClaims.length);
  const per = totalAtomic / n;
  const rem = totalAtomic % n;
  const payouts = [];
  await prisma.$transaction(async (tx) => {
    if (pendingClaims.length > 0) {
      await tx.groupTipClaim.updateMany({
        where: { groupTipId: tip.id, status: "PENDING" },
        data: { status: "REFUNDED", refundedAt: /* @__PURE__ */ new Date() }
      });
    }
    for (let idx = 0; idx < claimedClaims.length; idx++) {
      const c = claimedClaims[idx];
      const share = idx === 0 ? per + rem : per;
      if (!c.User) {
        console.error(`GroupTipClaim ${c.id} has no associated User`);
        continue;
      }
      await creditTokenTx(tx, c.User.discordId, tip.Token.id, share, "GROUP_TIP_PAYOUT", {
        guildId: tip.guildId ?? void 0
      });
      payouts.push({ discordId: c.User.discordId, shareText: formatAmount(share, tip.Token) });
    }
    await tx.groupTip.update({ where: { id: tip.id }, data: { status: "FINALIZED" } });
  });
  try {
    const { awardXPForGroupTipClaim, awardXPForGroupTipContribution } = await import("../services/xp_integration.js");
    for (const claim of claimedClaims) {
      if (claim.User?.discordId) {
        try {
          await awardXPForGroupTipClaim(claim.User.discordId);
        } catch (xpError) {
          console.error(`Failed to award claim XP to ${claim.User.discordId}:`, xpError);
        }
      }
    }
    const contributors = await prisma.groupTipContribution.findMany({
      where: { groupTipId: tip.id, status: "COMPLETED" },
      include: { contributor: true }
    });
    for (const contrib of contributors) {
      try {
        await awardXPForGroupTipContribution(contrib.contributor.discordId);
      } catch (xpError) {
        console.error(`Failed to award contribution XP to ${contrib.contributor.discordId}:`, xpError);
      }
    }
  } catch (importError) {
    console.error("Failed to import XP functions:", importError);
  }
  return {
    kind: "FINALIZED",
    totalText: formatAmount(totalAtomic, tip.Token),
    perShareText: formatAmount(per, tip.Token),
    remainderText: rem > 0n ? formatAmount(rem, tip.Token) : void 0,
    payouts
  };
}
export {
  finalizeExpiredGroupTip
};
//# sourceMappingURL=finalizeExpiredGroupTip.js.map
