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
/**
 * Check if user can create prediction markets based on their tier membership
 * System accounts (automation, admin) bypass tier restrictions
 */
export async function checkMarketCreationPermission(discordId) {
    try {
        // System accounts bypass tier restrictions
        const systemAccounts = ['automation', 'system', 'admin', 'scheduler'];
        if (systemAccounts.includes(discordId.toLowerCase())) {
            return {
                allowed: true,
                permissions: {
                    canCreateMarkets: true,
                    dailyMarketLimit: 0, // Unlimited
                    customRakePercent: null, // Use default
                    marketCooldownMinutes: 0 // No cooldown
                },
                tierName: 'System'
            };
        }
        // Find the user first
        const user = await prisma.user.findFirst({
            where: { discordId }
        });
        if (!user) {
            return {
                allowed: false,
                error: "User account not found. Use `/pip_profile` to create an account."
            };
        }
        // Find user's active tier membership with highest market permissions
        const activeMembership = await prisma.tierMembership.findFirst({
            where: {
                userId: user.id,
                status: "ACTIVE",
                expiresAt: { gt: new Date() },
                tier: {
                    active: true,
                    canCreateMarkets: true
                }
            },
            include: {
                tier: true
            },
            orderBy: {
                tier: {
                    dailyMarketLimit: 'desc' // Get the tier with highest daily limit
                }
            }
        });
        if (!activeMembership) {
            return {
                allowed: false,
                error: "❌ **No Market Creation Permission**\n\nYou need an active tier membership that includes prediction market creation privileges.\n\n💡 **Purchase a tier with market creation access to start creating prediction markets!**"
            };
        }
        const tier = activeMembership.tier;
        // Check daily limit if applicable
        if (tier.dailyMarketLimit > 0) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayEnd = new Date(today);
            todayEnd.setDate(today.getDate() + 1);
            const todayMarketCount = await prisma.predictionMarket.count({
                where: {
                    creatorId: discordId,
                    createdAt: {
                        gte: today,
                        lt: todayEnd
                    }
                }
            });
            if (todayMarketCount >= tier.dailyMarketLimit) {
                return {
                    allowed: false,
                    error: `❌ **Daily Limit Reached**\n\nYour ${tier.name} tier allows ${tier.dailyMarketLimit} market${tier.dailyMarketLimit === 1 ? '' : 's'} per day.\nYou've already created ${todayMarketCount} today.\n\n⏰ **Try again tomorrow or upgrade your tier for higher limits!**`
                };
            }
        }
        // Check cooldown if applicable
        if (tier.marketCooldownMinutes > 0) {
            const cooldownTime = new Date(Date.now() - (tier.marketCooldownMinutes * 60 * 1000));
            const recentMarket = await prisma.predictionMarket.findFirst({
                where: {
                    creatorId: discordId,
                    createdAt: { gt: cooldownTime }
                },
                orderBy: { createdAt: 'desc' }
            });
            if (recentMarket) {
                const timeLeft = Math.ceil((recentMarket.createdAt.getTime() + (tier.marketCooldownMinutes * 60 * 1000) - Date.now()) / (60 * 1000));
                return {
                    allowed: false,
                    error: `❌ **Cooldown Active**\n\nYour ${tier.name} tier has a ${tier.marketCooldownMinutes}-minute cooldown between market creations.\n\n⏰ **Wait ${timeLeft} more minute${timeLeft === 1 ? '' : 's'} before creating another market.**`
                };
            }
        }
        return {
            allowed: true,
            permissions: {
                canCreateMarkets: tier.canCreateMarkets,
                dailyMarketLimit: tier.dailyMarketLimit,
                customRakePercent: tier.customRakePercent,
                marketCooldownMinutes: tier.marketCooldownMinutes
            },
            tierName: tier.name
        };
    }
    catch (error) {
        console.error(`Error checking market creation permission for user ${discordId}:`, error);
        return {
            allowed: false,
            error: "Failed to check tier permissions. Please try again."
        };
    }
}
