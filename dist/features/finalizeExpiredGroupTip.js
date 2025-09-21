import { prisma } from "../services/db.js";
import { creditTokenTx } from "../services/balances.js";
import { decToBigDirect, formatAmount } from "../services/token.js";
import { RefundEngine } from "../services/refund_engine.js";
/** Idempotent, race-safe finalizer that also returns a human-readable summary. */
export async function finalizeExpiredGroupTip(groupTipId) {
    // Use a single transaction to prevent race conditions
    return await prisma.$transaction(async (tx) => {
        // Claim the right to finalize (only if ACTIVE and expired)
        const lock = await tx.groupTip.updateMany({
            where: { id: groupTipId, status: "ACTIVE", expiresAt: { lte: new Date() } },
            data: { status: "FINALIZING" },
        });
        if (lock.count === 0)
            return { kind: "NOOP" };
        // CRITICAL FIX: Query claims within same transaction to prevent race conditions
        const tip = await tx.groupTip.findUnique({
            where: { id: groupTipId },
            include: {
                Creator: true,
                Token: true,
                claims: {
                    include: { User: true }
                    // SECURITY FIX: Remove status filter - count ALL claims, then filter in memory
                    // This prevents race conditions where PENDING claims are missed
                },
            },
        });
        if (!tip)
            return { kind: "NOOP" };
        const totalAtomic = decToBigDirect(tip.totalAmount, tip.Token.decimals);
        // CRITICAL SECURITY FIX: Only consider claims that were created BEFORE expiration
        // This prevents claims made after expiry from being considered valid
        const validClaims = tip.claims.filter(c => (c.status === 'PENDING' || c.status === 'CLAIMED') &&
            c.createdAt <= tip.expiresAt);
        const invalidClaims = tip.claims.filter(c => c.status !== 'PENDING' && c.status !== 'CLAIMED' ||
            c.createdAt > tip.expiresAt);
        console.log(`🔍 GROUP TIP ${groupTipId} FINALIZATION:`, {
            totalClaims: tip.claims.length,
            validClaims: validClaims.length,
            invalidClaims: invalidClaims.length,
            claimDetails: tip.claims.map(c => ({
                userId: c.User?.discordId,
                status: c.status,
                createdAt: c.createdAt,
                expiresAt: tip.expiresAt,
                isValid: (c.status === 'PENDING' || c.status === 'CLAIMED') && c.createdAt <= tip.expiresAt
            }))
        });
        if (validClaims.length === 0) {
            // No successful claims - refund everything to creator using centralized engine
            const refundResult = await RefundEngine.refundContribution(tip.id);
            if (!refundResult.success) {
                console.error("Failed to refund expired group tip:", refundResult.message);
                return { kind: "NOOP" };
            }
            // Handle any invalid claims (shouldn't exist normally)
            if (invalidClaims.length > 0) {
                await tx.groupTipClaim.updateMany({
                    where: {
                        groupTipId: tip.id,
                        OR: [
                            { status: { notIn: ['PENDING', 'CLAIMED'] } },
                            { createdAt: { gt: tip.expiresAt } }
                        ]
                    },
                    data: { status: 'REFUNDED', refundedAt: new Date() }
                });
            }
            const totalRefunded = refundResult.refundedAmount + refundResult.refundedTax;
            return {
                kind: "REFUNDED",
                creatorId: tip.Creator.discordId,
                amountText: formatAmount(totalRefunded, tip.Token),
            };
        }
        // Split payout among all valid claims - batch all operations
        const n = BigInt(validClaims.length);
        const per = totalAtomic / n;
        const rem = totalAtomic % n;
        const payouts = [];
        // Batch refund any invalid claims (shouldn't exist normally)
        if (invalidClaims.length > 0) {
            await tx.groupTipClaim.updateMany({
                where: {
                    groupTipId: tip.id,
                    OR: [
                        { status: { notIn: ['PENDING', 'CLAIMED'] } },
                        { createdAt: { gt: tip.expiresAt } }
                    ]
                },
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
            await creditTokenTx(tx, c.User.discordId, tip.Token.id, share, "GROUP_TIP_PAYOUT", {
                guildId: tip.guildId ?? undefined,
            });
            // Also create a Tip record so it shows up in "tipsReceived" relation
            await tx.tip.create({
                data: {
                    fromUserId: tip.Creator ? tip.Creator.id : null, // Group tip creator as sender
                    toUserId: c.User.id,
                    tokenId: tip.Token.id,
                    amountAtomic: share.toString(),
                    feeAtomic: "0", // No fee for receiving group tip payout
                    taxAtomic: "0", // No tax for receiving group tip payout
                    note: `Group tip payout - claimed ${formatAmount(share, tip.Token)}`,
                    status: 'COMPLETED'
                }
            });
            payouts.push({ discordId: c.User.discordId, shareText: formatAmount(share, tip.Token) });
            // Mark claim as paid
            await tx.groupTipClaim.update({
                where: { id: c.id },
                data: { status: 'CLAIMED', claimedAt: new Date() }
            });
        }
        await tx.groupTip.update({ where: { id: tip.id }, data: { status: "FINALIZED" } });
        return {
            kind: "FINALIZED",
            totalText: formatAmount(totalAtomic, tip.Token),
            perShareText: formatAmount(per, tip.Token),
            remainderText: rem > 0n ? formatAmount(rem, tip.Token) : undefined,
            payouts,
        };
    });
}
