import { prisma } from "../services/db.js";
import { creditToken } from "../services/balances.js";
import { decToBigDirect, bigToDecDirect, formatAmount } from "../services/token.js";

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
      claims: { include: { User: true } },
    },
  });
  if (!tip) return { kind: "NOOP" };

  const totalAtomic = decToBigDirect(tip.totalAmount, tip.Token.decimals);

  if (tip.claims.length === 0) {
    // Refund creator
    await creditToken(tip.Creator.discordId, tip.Token.id, totalAtomic, "TIP", {
      guildId: tip.guildId ?? undefined,
    });
    await prisma.groupTip.update({ where: { id: tip.id }, data: { status: "REFUNDED" } });

    return {
      kind: "REFUNDED",
      creatorId: tip.Creator.discordId,
      amountText: formatAmount(totalAtomic, tip.Token),
    };
  }

  // Split payout (first gets remainder)
  const n = BigInt(tip.claims.length);
  const per = totalAtomic / n;
  const rem = totalAtomic % n;

  const payouts: { discordId: string; shareText: string }[] = [];
  for (let idx = 0; idx < tip.claims.length; idx++) {
    const c = tip.claims[idx];
    const share = idx === 0 ? per + rem : per;
    await creditToken(c.User.discordId, tip.Token.id, share, "TIP", {
      guildId: tip.guildId ?? undefined,
    });
    payouts.push({ discordId: c.User.discordId, shareText: formatAmount(share, tip.Token) });
  }

  await prisma.groupTip.update({ where: { id: tip.id }, data: { status: "FINALIZED" } });

  return {
    kind: "FINALIZED",
    totalText: formatAmount(totalAtomic, tip.Token),
    perShareText: formatAmount(per, tip.Token),
    remainderText: rem > 0n ? formatAmount(rem, tip.Token) : undefined,
    payouts,
  };
}
