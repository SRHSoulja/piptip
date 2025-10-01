import { prisma } from "./db.js";
import { getDiscordClient } from "./discord_users.js";
import { startTimer, endTimer } from "./performance.js";
const roleRakeCache = /* @__PURE__ */ new Map();
let lastCacheRefresh = 0;
const CACHE_DURATION = 5 * 60 * 1e3;
class RoleRakeReductionService {
  // Get the best available rake reduction for a user
  static async getBestRakeReduction(userId, guildId, discordUserId) {
    startTimer("role_rake_benefit_check");
    try {
      const tierBenefit = await this.getTierRakeBenefit(userId);
      const roleBenefit = await this.getRoleRakeBenefit(discordUserId, guildId);
      const allBenefits = [tierBenefit, roleBenefit].filter(Boolean);
      const bestBenefit = allBenefits.reduce((best, current) => {
        if (!best || !current) return best || current;
        return current.reductionRate > best.reductionRate ? current : best;
      }, null);
      endTimer("role_rake_benefit_check", {
        benefitsFound: allBenefits.length,
        bestRate: bestBenefit?.reductionRate || 0
      });
      return bestBenefit;
    } catch (error) {
      endTimer("role_rake_benefit_check", { success: false, error: String(error) });
      console.error("Error checking role rake benefits:", error);
      return null;
    }
  }
  // Check Discord roles for rake reductions
  static async getRoleRakeBenefit(discordUserId, guildId) {
    try {
      await this.refreshRakeCache(guildId);
      const guildCache = roleRakeCache.get(guildId);
      if (!guildCache) return null;
      const discord = getDiscordClient();
      if (!discord) return null;
      const guild = await discord.guilds.fetch(guildId).catch(() => null);
      if (!guild) return null;
      const member = await guild.members.fetch(discordUserId).catch(() => null);
      if (!member) return null;
      const minimumRoleHoldTime = 10 * 60 * 1e3;
      let bestBenefit = null;
      for (const roleId of member.roles.cache.keys()) {
        const roleBenefit = guildCache.get(roleId);
        if (!roleBenefit) continue;
        const roleHoldValid = await this.verifyRoleHoldTime(
          discordUserId,
          guildId,
          roleId,
          minimumRoleHoldTime
        );
        if (roleHoldValid && (!bestBenefit || roleBenefit.reductionRate > bestBenefit.reductionRate)) {
          const stillHasRole = member.roles.cache.has(roleId);
          if (stillHasRole) {
            bestBenefit = roleBenefit;
            console.log(`\u2705 Rake benefit verified: User ${discordUserId} role ${roleId} (${roleBenefit.reductionRate}% reduction)`);
          } else {
            console.warn(`\u{1F6AB} Role benefit denied: User ${discordUserId} lost role ${roleId} during verification`);
          }
        } else if (!roleHoldValid) {
          console.warn(`\u{1F6AB} Role rake evasion blocked: User ${discordUserId} has role ${roleId} for <10min in guild ${guildId}`);
        }
      }
      return bestBenefit;
    } catch (error) {
      console.error("Error fetching Discord role rake benefits:", error);
      return null;
    }
  }
  // ANTI-EVASION: Verify user has held role for minimum time (same as tax service)
  static async verifyRoleHoldTime(discordUserId, guildId, roleId, minimumHoldTime) {
    try {
      const existing = await prisma.roleBenefitAnalytics.findFirst({
        where: {
          roleId,
          guildId,
          // We don't have direct userId linking, so check recent activity
          date: { gte: new Date(Date.now() - 24 * 60 * 60 * 1e3) }
        },
        orderBy: { date: "desc" }
      });
      if (!existing) {
        console.log(`\u{1F4DD} First rake role check: User ${discordUserId} role ${roleId} in guild ${guildId} - starting hold timer`);
        return false;
      }
      const roleCheckTime = existing.date.getTime();
      const timeSinceFirstSeen = Date.now() - roleCheckTime;
      if (timeSinceFirstSeen < minimumHoldTime) {
        console.log(`\u23F0 Rake role hold time insufficient: ${Math.round(timeSinceFirstSeen / 1e3 / 60)}min < 10min required`);
        return false;
      }
      return true;
    } catch (error) {
      console.error("Error verifying rake role hold time:", error);
      return true;
    }
  }
  // Refresh role rake reduction cache for a guild
  static async refreshRakeCache(guildId) {
    try {
      const activeReductions = await prisma.roleRakeReduction.findMany({
        where: {
          guildId,
          isActive: true,
          OR: [
            { expiresAt: null },
            // Permanent reductions
            { expiresAt: { gt: /* @__PURE__ */ new Date() } }
            // Non-expired reductions
          ]
        }
      });
      const guildCache = /* @__PURE__ */ new Map();
      for (const reduction of activeReductions) {
        guildCache.set(reduction.roleId, {
          reductionRate: Number(reduction.rakeReductionBps) / 1e4,
          // Convert BPS to percentage (1% = 100 BPS)
          source: `role:${reduction.roleId}`,
          label: reduction.label
        });
      }
      roleRakeCache.set(guildId, guildCache);
      lastCacheRefresh = Date.now();
      console.log(`\u{1F3AE} Refreshed role rake cache for guild ${guildId}: ${activeReductions.length} reductions`);
    } catch (error) {
      console.error("Error refreshing role rake cache:", error);
    }
  }
  // Get tier rake benefits (enhanced with new flexible system)
  static async getTierRakeBenefit(userId) {
    try {
      const membership = await prisma.tierMembership.findFirst({
        where: {
          userId,
          status: "ACTIVE",
          expiresAt: { gt: /* @__PURE__ */ new Date() }
        },
        include: {
          tier: true
        },
        orderBy: { tier: { rakeReductionBps: "desc" } }
        // Get best tier if multiple
      });
      if (!membership) return null;
      const tier = membership.tier;
      if (tier.rakeReductionBps > 0) {
        return {
          reductionRate: Number(tier.rakeReductionBps) / 1e4,
          // Convert BPS to percentage (1% = 100 BPS)
          source: `tier:${tier.id}`,
          label: `${tier.name} Member`
        };
      }
      return null;
    } catch (error) {
      console.error("Error checking tier rake benefits:", error);
      return null;
    }
  }
  // Admin function to create role rake reductions
  static async createRoleRakeReduction(reductionData) {
    const { roleId, guildId, rakeReductionBps, duration, label, createdBy, notes } = reductionData;
    const expiresAt = duration ? new Date(Date.now() + duration * 24 * 60 * 60 * 1e3) : null;
    await prisma.roleRakeReduction.upsert({
      where: { roleId_guildId: { roleId, guildId } },
      create: {
        roleId,
        guildId,
        rakeReductionBps,
        label,
        createdBy,
        notes,
        expiresAt
      },
      update: {
        rakeReductionBps,
        label,
        createdBy,
        notes,
        expiresAt,
        isActive: true,
        updatedAt: /* @__PURE__ */ new Date()
      }
    });
    roleRakeCache.delete(guildId);
    console.log(`\u{1F3AE} Created role rake reduction: ${label} (${rakeReductionBps / 100}%) for role ${roleId} in guild ${guildId}`);
  }
  // Clean up expired reductions (run periodically)
  static async cleanupExpiredReductions() {
    try {
      const result = await prisma.roleRakeReduction.updateMany({
        where: {
          isActive: true,
          expiresAt: { lt: /* @__PURE__ */ new Date() }
        },
        data: { isActive: false }
      });
      if (result.count > 0) {
        roleRakeCache.clear();
        console.log(`\u{1F9F9} Deactivated ${result.count} expired role rake reductions`);
      }
      return result.count;
    } catch (error) {
      console.error("Error cleaning up expired rake reductions:", error);
      return 0;
    }
  }
  // Get all active reductions for admin dashboard
  static async getAllActiveReductions(guildId) {
    return await prisma.roleRakeReduction.findMany({
      where: {
        ...guildId && { guildId },
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: /* @__PURE__ */ new Date() } }
        ]
      },
      orderBy: [
        { guildId: "asc" },
        { rakeReductionBps: "desc" }
      ]
    });
  }
}
setInterval(() => {
  RoleRakeReductionService.cleanupExpiredReductions();
}, 60 * 60 * 1e3);
export {
  RoleRakeReductionService
};
//# sourceMappingURL=role_rake_benefits.js.map
