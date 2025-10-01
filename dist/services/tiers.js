import { prisma } from "./db.js";
async function userHasActiveTaxFreeTier(userId, now = /* @__PURE__ */ new Date()) {
  try {
    const hit = await Promise.race([
      prisma.tierMembership.findFirst({
        where: {
          userId,
          status: "ACTIVE",
          expiresAt: { gt: now },
          tier: { active: true, tipTaxFree: true }
        },
        select: { id: true }
      }),
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error("Tax-free tier check timeout")), 5e3)
      )
    ]);
    return Boolean(hit);
  } catch (error) {
    console.error(`Error checking tax-free tier for user ${userId}:`, error);
    return false;
  }
}
async function getUserActiveTierForMarkets(discordId) {
  try {
    const systemAccounts = ["automation", "system", "admin", "scheduler"];
    if (systemAccounts.includes(discordId.toLowerCase())) {
      return {
        tier: {
          name: "System",
          marketRakePercent: 0,
          // No rake for system
          systemLiquidityBonus: 0,
          canCreateMarkets: true,
          dailyMarketLimit: 0,
          marketCooldownMinutes: 0,
          customRakePercent: null
        },
        membership: null
      };
    }
    const user = await prisma.user.findFirst({
      where: { discordId }
    });
    if (!user) {
      return null;
    }
    const activeMembership = await prisma.tierMembership.findFirst({
      where: {
        userId: user.id,
        status: "ACTIVE",
        expiresAt: { gt: /* @__PURE__ */ new Date() },
        tier: {
          active: true
        }
      },
      include: {
        tier: {
          select: {
            id: true,
            name: true,
            marketRakePercent: true,
            systemLiquidityBonus: true,
            canCreateMarkets: true,
            dailyMarketLimit: true,
            marketCooldownMinutes: true,
            customRakePercent: true
          }
        }
      },
      orderBy: [
        // Prioritize tiers with market creation access
        { tier: { canCreateMarkets: "desc" } },
        // Then by lowest rake percentage (best deal)
        { tier: { marketRakePercent: "asc" } },
        // Finally by highest liquidity bonus
        { tier: { systemLiquidityBonus: "desc" } }
      ]
    });
    return activeMembership ? {
      tier: activeMembership.tier,
      membership: activeMembership
    } : null;
  } catch (error) {
    console.error(`Error getting active tier for user ${discordId}:`, error);
    return null;
  }
}
async function checkMarketCreationPermission(discordId) {
  try {
    const systemAccounts = ["automation", "system", "admin", "scheduler"];
    if (systemAccounts.includes(discordId.toLowerCase())) {
      return {
        allowed: true,
        permissions: {
          canCreateMarkets: true,
          dailyMarketLimit: 0,
          // Unlimited
          customRakePercent: null,
          // Use default
          marketCooldownMinutes: 0
          // No cooldown
        },
        tierName: "System"
      };
    }
    const user = await prisma.user.findFirst({
      where: { discordId }
    });
    if (!user) {
      return {
        allowed: false,
        error: "User account not found. Use `/pip_profile` to create an account."
      };
    }
    const activeMembership = await prisma.tierMembership.findFirst({
      where: {
        userId: user.id,
        status: "ACTIVE",
        expiresAt: { gt: /* @__PURE__ */ new Date() },
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
          dailyMarketLimit: "desc"
          // Get the tier with highest daily limit
        }
      }
    });
    if (!activeMembership) {
      return {
        allowed: false,
        error: "\u274C **No Market Creation Permission**\n\nYou need an active tier membership that includes prediction market creation privileges.\n\n\u{1F4A1} **Purchase a tier with market creation access to start creating prediction markets!**"
      };
    }
    const tier = activeMembership.tier;
    if (tier.dailyMarketLimit > 0) {
      const today = /* @__PURE__ */ new Date();
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
          error: `\u274C **Daily Limit Reached**

Your ${tier.name} tier allows ${tier.dailyMarketLimit} market${tier.dailyMarketLimit === 1 ? "" : "s"} per day.
You've already created ${todayMarketCount} today.

\u23F0 **Try again tomorrow or upgrade your tier for higher limits!**`
        };
      }
    }
    if (tier.marketCooldownMinutes > 0) {
      const cooldownTime = new Date(Date.now() - tier.marketCooldownMinutes * 60 * 1e3);
      const recentMarket = await prisma.predictionMarket.findFirst({
        where: {
          creatorId: discordId,
          createdAt: { gt: cooldownTime }
        },
        orderBy: { createdAt: "desc" }
      });
      if (recentMarket) {
        const timeLeft = Math.ceil((recentMarket.createdAt.getTime() + tier.marketCooldownMinutes * 60 * 1e3 - Date.now()) / (60 * 1e3));
        return {
          allowed: false,
          error: `\u274C **Cooldown Active**

Your ${tier.name} tier has a ${tier.marketCooldownMinutes}-minute cooldown between market creations.

\u23F0 **Wait ${timeLeft} more minute${timeLeft === 1 ? "" : "s"} before creating another market.**`
        };
      }
    }
    return {
      allowed: true,
      permissions: {
        canCreateMarkets: tier.canCreateMarkets,
        dailyMarketLimit: tier.dailyMarketLimit,
        customRakePercent: tier.customRakePercent ? Number(tier.customRakePercent) : null,
        marketCooldownMinutes: tier.marketCooldownMinutes
      },
      tierName: tier.name
    };
  } catch (error) {
    console.error(`Error checking market creation permission for user ${discordId}:`, error);
    return {
      allowed: false,
      error: "Failed to check tier permissions. Please try again."
    };
  }
}
export {
  checkMarketCreationPermission,
  getUserActiveTierForMarkets,
  userHasActiveTaxFreeTier
};
//# sourceMappingURL=tiers.js.map
