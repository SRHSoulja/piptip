import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

export async function purchaseTierByBalance(
  { discordId, tierId }: { discordId: string; tierId: number }
) {
  const [user, tier, price] = await Promise.all([
    prisma.user.findUnique({ where: { discordId } }),
    prisma.tier.findUnique({
      where: { id: tierId },
      select: { id: true, name: true, active: true, durationDays: true },
    }),
    prisma.tierPrice.findFirst({
      where: { tierId },                    // removed active: true
      orderBy: { createdAt: "desc" },       // newest price
      select: { tokenId: true, amount: true },
    }),
  ]);

  if (!user) throw new Error("User not found");
  if (!tier || !tier.active) throw new Error("Tier not available");
  if (!price) throw new Error("No price configured for this tier");

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
    await tx.userBalance.update({
      where: { userId_tokenId: { userId: user.id, tokenId: price.tokenId } },
      data: { amount: balance.amount.minus(priceDec) },
    });

    await tx.transaction.create({
      data: {
        type: "TIER_PURCHASE",
        userId: user.id,
        tokenId: price.tokenId,
        amount: priceDec,
        fee: new Prisma.Decimal(0),
        metadata: JSON.stringify({ tierId: tier.id, name: tier.name }),
      },
    });

    await tx.tierMembership.updateMany({
      where: { userId: user.id, tierId: tier.id, status: "ACTIVE" },
      data: { status: "EXPIRED", expiresAt: now },
    });

    return tx.tierMembership.create({
      data: { userId: user.id, tierId: tier.id, startedAt: now, expiresAt, status: "ACTIVE" },
    });
  });

  return { membership };
}
