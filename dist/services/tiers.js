// src/services/tiers.ts
import { prisma } from "./db.js";
/**
 * Returns true if the user currently has ANY active tier where tipTaxFree = true.
 * Works across all tokens.
 */
export async function userHasActiveTaxFreeTier(userId, now = new Date()) {
    try {
        // Add timeout to prevent hanging queries
        const hit = await Promise.race([
            prisma.tierMembership.findFirst({
                where: {
                    userId,
                    status: "ACTIVE",
                    expiresAt: { gt: now },
                    tier: { active: true, tipTaxFree: true },
                },
                select: { id: true },
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Tax-free tier check timeout")), 5000))
        ]);
        return Boolean(hit);
    }
    catch (error) {
        console.error(`Error checking tax-free tier for user ${userId}:`, error);
        return false; // Default to taxed on error
    }
}
