import { prisma } from "../services/db.js";
import { creditTokenTx } from "../services/balances.js";
import { decToBigDirect, formatAmount } from "../services/token.js";
import { RefundEngine } from "../services/refund_engine.js";
/** Idempotent, race-safe finalizer that also returns a human-readable summary. */
export async function finalizeExpiredGroupTip(groupTipId) {
    // Claim the right to finalize (only if ACTIVE and expired)
    const lock = await prisma.groupTip.updateMany({
        where: { id: groupTipId, status: "ACTIVE", expiresAt: { lte: new Date() } },
        data: { status: "FINALIZING" },
    });
    if (lock.count === 0)
        return { kind: "NOOP" };
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
    if (!tip)
        return { kind: "NOOP" };
    // Calculate total including contributions
    const originalAtomic = decToBigDirect(tip.totalAmount, tip.Token.decimals);
    const contributionsAtomic = decToBigDirect(tip.contributionsTotal || 0, tip.Token.decimals);
    const totalAtomic = originalAtomic + contributionsAtomic;
    // Separate PENDING (need refunds) from CLAIMED (get payouts)
    const pendingClaims = tip.claims.filter(c => c.status === 'PENDING');
    const claimedClaims = tip.claims.filter(c => c.status === 'CLAIMED');
    if (claimedClaims.length === 0) {
        // No successful claims - refund everything to creator AND contributors
        await prisma.$transaction(async (tx) => {
            // Refund creator's original amount + tax
            const refundResult = await RefundEngine.refundContribution(tip.id);
            if (!refundResult.success) {
                throw new Error(`Failed to refund creator: ${refundResult.message}`);
            }
            // Refund all contributors their amounts + tax
            const contributions = await tx.groupTipContribution.findMany({
                where: { groupTipId: tip.id, status: 'COMPLETED' },
                include: { contributor: true }
            });
            for (const contrib of contributions) {
                const contributionAtomic = decToBigDirect(contrib.amount, tip.Token.decimals);
                const taxAtomic = decToBigDirect(contrib.taxPaid, tip.Token.decimals);
                const totalRefund = contributionAtomic + taxAtomic;
                await creditTokenTx(tx, contrib.contributor.discordId, tip.Token.id, totalRefund, "TIP", {
                    guildId: tip.guildId ?? undefined,
                    note: `Group tip contribution refund: ${contrib.amount} + ${contrib.taxPaid} tax`
                });
                // Mark contribution as refunded
                await tx.groupTipContribution.update({
                    where: { id: contrib.id },
                    data: { status: 'REFUNDED' }
                });
            }
            // Handle pending claims separately
            if (pendingClaims.length > 0) {
                await tx.groupTipClaim.updateMany({
                    where: { groupTipId: tip.id, status: 'PENDING' },
                    data: { status: 'REFUNDED', refundedAt: new Date() }
                });
            }
        });
        // Calculate total refunded for display
        const creatorRefund = decToBigDirect(tip.totalAmount, tip.Token.decimals) + BigInt(tip.taxAtomic.toString());
        const contributionsRefund = decToBigDirect(tip.contributionsTotal || 0, tip.Token.decimals);
        const totalRefunded = creatorRefund + contributionsRefund;
        return {
            kind: "REFUNDED",
            creatorId: tip.Creator.discordId,
            amountText: formatAmount(totalRefunded, tip.Token),
        };
    }
    // Split payout among CLAIMED claims and refund PENDING claims - batch all operations
    const n = BigInt(claimedClaims.length);
    const per = totalAtomic / n;
    const rem = totalAtomic % n;
    const payouts = [];
    await prisma.$transaction(async (tx) => {
        // Batch refund all PENDING claims first
        if (pendingClaims.length > 0) {
            await tx.groupTipClaim.updateMany({
                where: { groupTipId: tip.id, status: 'PENDING' },
                data: { status: 'REFUNDED', refundedAt: new Date() }
            });
        }
        // Batch payout to all CLAIMED claims
        for (let idx = 0; idx < claimedClaims.length; idx++) {
            const c = claimedClaims[idx];
            const share = idx === 0 ? per + rem : per;
            if (!c.User) {
                console.error(`GroupTipClaim ${c.id} has no associated User`);
                continue;
            }
            await creditTokenTx(tx, c.User.discordId, tip.Token.id, share, "TIP", {
                guildId: tip.guildId ?? undefined,
            });
            payouts.push({ discordId: c.User.discordId, shareText: formatAmount(share, tip.Token) });
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
