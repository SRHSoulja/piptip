import { prisma } from "../services/db.js";
import { creditToken, creditTokenTx } from "../services/balances.js";
import { decToBigDirect, bigToDecDirect, formatAmount } from "../services/token.js";
import { RefundEngine } from "../services/refund_engine.js";

export type FinalizeSummary =
  | { kind: "NOOP" } // not active/expired or someone else finalized
  | { kind: "REFUNDED"; creatorId: string; amountText: string }
  | {
      kind: "FINALIZED";
      totalText: string;
      perShareText: string;
      remainderText?: string;
      payouts: { discordId: string; shareText: string }[];
    };

/** Idempotent, race-safe finalizer that also returns a human-readable summary. */
export async function finalizeExpiredGroupTip(groupTipId: number): Promise<FinalizeSummary> {
  // Claim the right to finalize (only if ACTIVE and expired)
  const lock = await prisma.groupTip.updateMany({
    where: { id: groupTipId, status: "ACTIVE", expiresAt: { lte: new Date() } },
    data: { status: "FINALIZING" },
  });
  if (lock.count === 0) return { kind: "NOOP" };

  const tip = await prisma.groupTip.findUnique({
    where: { id: groupTipId },
    include: {
      Creator: true,
      Token: true,
      claims: { 
        include: { User: true },
        where: { status: { in: ['PENDING', 'CLAIMED'] } } 
      },
    },
  });
  if (!tip) return { kind: "NOOP" };

  const totalAtomic = decToBigDirect(tip.totalAmount, tip.Token.decimals);
  
  // All claims should get payouts - PENDING means they claimed but haven't been paid yet
  // Only exclude REFUNDED claims (which shouldn't exist at this point anyway)
  const validClaims = tip.claims.filter(c => c.status === 'PENDING' || c.status === 'CLAIMED');
  const invalidClaims = tip.claims.filter(c => c.status !== 'PENDING' && c.status !== 'CLAIMED');

  if (validClaims.length === 0) {
    // No successful claims - refund everything to creator using centralized engine
    const refundResult = await RefundEngine.refundContribution(tip.id);
    if (!refundResult.success) {
      console.error("Failed to refund expired group tip:", refundResult.message);
      return { kind: "NOOP" };
    }

    // Handle any invalid claims (shouldn't exist normally)
    if (invalidClaims.length > 0) {
      await prisma.groupTipClaim.updateMany({
        where: { groupTipId: tip.id, status: { notIn: ['PENDING', 'CLAIMED'] } },
        data: { status: 'REFUNDED', refundedAt: new Date() }
      });
    }

    const totalRefunded = refundResult.refundedAmount! + refundResult.refundedTax!;
    return {
      kind: "REFUNDED",
      creatorId: tip.Creator!.discordId,
      amountText: formatAmount(totalRefunded, tip.Token),
    };
  }

  // Split payout among all valid claims - batch all operations
  const n = BigInt(validClaims.length);
  const per = totalAtomic / n;
  const rem = totalAtomic % n;

  const payouts: { discordId: string; shareText: string }[] = [];
  
  await prisma.$transaction(async (tx) => {
    // Batch refund any invalid claims (shouldn't exist normally)
    if (invalidClaims.length > 0) {
      await tx.groupTipClaim.updateMany({
        where: { groupTipId: tip.id, status: { notIn: ['PENDING', 'CLAIMED'] } },
        data: { status: 'REFUNDED', refundedAt: new Date() }
      });
    }

    // Batch payout to all valid claims
    for (let idx = 0; idx < validClaims.length; idx++) {
      const c = validClaims[idx];
      const share = idx === 0 ? per + rem : per;
      if (!c.User) {
        console.error(`GroupTipClaim ${c.id} has no associated User`);
        continue;
      }
      await creditTokenTx(tx, c.User.discordId, tip.Token.id, share, "TIP", {
        guildId: tip.guildId ?? undefined,
      });
      payouts.push({ discordId: c.User.discordId, shareText: formatAmount(share, tip.Token) });

      // Mark claim as paid
      await tx.groupTipClaim.update({
        where: { id: c.id },
        data: { status: 'CLAIMED', claimedAt: new Date() }
      });
    }
    
    await tx.groupTip.update({ where: { id: tip.id }, data: { status: "FINALIZED" } });
  });

  return {
    kind: "FINALIZED",
    totalText: formatAmount(totalAtomic, tip.Token),
    perShareText: formatAmount(per, tip.Token),
    remainderText: rem > 0n ? formatAmount(rem, tip.Token) : undefined,
    payouts,
  };
}
