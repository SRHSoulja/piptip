// src/services/tiers.ts
import { prisma } from "./db.js";

/**
 * Returns true if the user currently has ANY active tier where tipTaxFree = true.
 * Works across all tokens.
 */
export async function userHasActiveTaxFreeTier(userId: number, now = new Date()): Promise<boolean> {
  const hit = await prisma.tierMembership.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      expiresAt: { gt: now },
      tier: { active: true, tipTaxFree: true },
    },
    select: { id: true },
  });
  return Boolean(hit);
}
