import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { logCompleteTransaction } from "./tx_logger.js";
import { toAtomicDirect } from "./token.js";
export async function purchaseTierByBalance({ discordId, tierId }) {
    const [user, tier, price] = await Promise.all([
        prisma.user.findUnique({ where: { discordId } }),
        prisma.tier.findUnique({
            where: { id: tierId },
            select: { id: true, name: true, active: true, durationDays: true },
        }),
        prisma.tierPrice.findFirst({
            where: { tierId }, // removed active: true
            orderBy: { createdAt: "desc" }, // newest price
            select: { tokenId: true, amount: true },
        }),
    ]);
    if (!user)
        throw new Error("User not found");
    if (!tier || !tier.active)
        throw new Error("Tier not available");
    if (!price)
        throw new Error("No price configured for this tier");
    const balance = await prisma.userBalance.findUnique({
        where: { userId_tokenId: { userId: user.id, tokenId: price.tokenId } },
    });
    const priceDec = new Prisma.Decimal(price.amount);
    if (!balance || balance.amount.lt(priceDec)) {
        throw new Error("Insufficient balance");
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + tier.durationDays * 24 * 60 * 60 * 1000);
    const membership = await prisma.$transaction(async (tx) => {
        // Get token decimals for atomic conversion
        const token = await tx.token.findUnique({
            where: { id: price.tokenId },
            select: { decimals: true }
        });
        if (!token)
            throw new Error("Token not found");
        // Calculate atomic amount
        const priceAtomicBigint = toAtomicDirect(Number(price.amount), token.decimals);
        // Generate idempotency key for tier purchase
        const idempotencyKey = `tier_purchase_${user.id}_${tier.id}_${now.getTime()}`;
        // Log transaction with BalanceDelta
        await logCompleteTransaction(tx, {
            operation: 'TIER_PURCHASE',
            userId: user.id,
            balanceChanges: [{
                    tokenId: price.tokenId,
                    userId: user.id,
                    amountDelta: -priceAtomicBigint,
                    reason: 'tier_purchase'
                }],
            metadata: {
                tierId: tier.id,
                tierName: tier.name,
                durationDays: tier.durationDays,
                expiresAt: expiresAt.toISOString()
            },
            idempotencyKey,
            source: 'BOT'
        });
        // Update user balance
        await tx.userBalance.update({
            where: { userId_tokenId: { userId: user.id, tokenId: price.tokenId } },
            data: { amount: balance.amount.minus(priceDec) },
        });
        // Expire existing active memberships
        await tx.tierMembership.updateMany({
            where: { userId: user.id, tierId: tier.id, status: "ACTIVE" },
            data: { status: "EXPIRED", expiresAt: now },
        });
        // Create new membership
        return tx.tierMembership.create({
            data: { userId: user.id, tierId: tier.id, startedAt: now, expiresAt, status: "ACTIVE" },
        });
    });
    return { membership };
}
