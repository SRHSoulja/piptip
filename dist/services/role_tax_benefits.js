import { prisma } from "./db.js";
import { getDiscordClient } from "./discord_users.js";
import { startTimer, endTimer } from "./performance.js";
import { getConfig } from "../config.js";
const roleExemptionCache = /* @__PURE__ */ new Map();
let lastCacheRefresh = 0;
const CACHE_DURATION = 5 * 60 * 1e3;
class RoleTaxBenefitService {
  // Get the best available tax benefit for a user
  static async getBestTaxBenefit(userId, guildId, discordUserId) {
    startTimer("role_tax_benefit_check");
    try {
      const tierBenefit = await this.getTierBenefit(userId);
      const roleBenefit = await this.getRoleTaxBenefit(discordUserId, guildId);
      const referralBenefit = await this.getReferralTaxBenefit(userId);
      const allBenefits = [tierBenefit, roleBenefit, referralBenefit].filter(Boolean);
      const bestBenefit = allBenefits.reduce((best, current) => {
        if (!best || !current) return best || current;
        return current.exemptionRate > best.exemptionRate ? current : best;
      }, null);
      endTimer("role_tax_benefit_check", {
        benefitsFound: allBenefits.length,
        bestRate: bestBenefit?.exemptionRate || 0
      });
      return bestBenefit;
    } catch (error) {
      endTimer("role_tax_benefit_check", { success: false, error: String(error) });
      console.error("Error checking role tax benefits:", error);
      return null;
    }
  }
  // Check Discord roles for tax exemptions
  static async getRoleTaxBenefit(discordUserId, guildId) {
    try {
      await this.refreshRoleCache(guildId);
      const guildCache = roleExemptionCache.get(guildId);
      if (!guildCache) return null;
      const discord = getDiscordClient();
      if (!discord) return null;
      const guild = await discord.guilds.fetch(guildId).catch(() => null);
      if (!guild) return null;
      const member = await guild.members.fetch(discordUserId).catch(() => null);
      if (!member) return null;
      const minimumRoleHoldTime = 10 * 60 * 1e3;
      const currentTime = Date.now();
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
        if (roleHoldValid && (!bestBenefit || roleBenefit.exemptionRate > bestBenefit.exemptionRate)) {
          const stillHasRole = member.roles.cache.has(roleId);
          if (stillHasRole) {
            bestBenefit = roleBenefit;
            console.log(`\u2705 Tax benefit verified: User ${discordUserId} role ${roleId} (${roleBenefit.exemptionRate}% exemption)`);
          } else {
            console.warn(`\u{1F6AB} Role benefit denied: User ${discordUserId} lost role ${roleId} during verification`);
          }
        } else if (!roleHoldValid) {
          console.warn(`\u{1F6AB} Role tax evasion blocked: User ${discordUserId} has role ${roleId} for <10min in guild ${guildId}`);
        }
      }
      return bestBenefit;
    } catch (error) {
      console.error("Error fetching Discord role benefits:", error);
      return null;
    }
  }
  // ANTI-EVASION: Verify user has held role for minimum time
  static async verifyRoleHoldTime(discordUserId, guildId, roleId, minimumHoldTime) {
    try {
      const roleAssignmentKey = `${discordUserId}:${guildId}:${roleId}`;
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
        console.log(`\u{1F4DD} First role check: User ${discordUserId} role ${roleId} in guild ${guildId} - starting hold timer`);
        return false;
      }
      const roleCheckTime = existing.date.getTime();
      const timeSinceFirstSeen = Date.now() - roleCheckTime;
      if (timeSinceFirstSeen < minimumHoldTime) {
        console.log(`\u23F0 Role hold time insufficient: ${Math.round(timeSinceFirstSeen / 1e3 / 60)}min < 10min required`);
        return false;
      }
      return true;
    } catch (error) {
      console.error("Error verifying role hold time:", error);
      return true;
    }
  }
  // Refresh role exemption cache for a guild
  static async refreshRoleCache(guildId) {
    try {
      const activeExemptions = await prisma.roleTaxExemption.findMany({
        where: {
          guildId,
          isActive: true,
          OR: [
            { expiresAt: null },
            // Permanent exemptions
            { expiresAt: { gt: /* @__PURE__ */ new Date() } }
            // Non-expired exemptions
          ]
        }
      });
      const guildCache = /* @__PURE__ */ new Map();
      for (const exemption of activeExemptions) {
        guildCache.set(exemption.roleId, {
          exemptionRate: Number(exemption.exemptionRate),
          source: `role:${exemption.roleId}`,
          label: exemption.label
        });
      }
      roleExemptionCache.set(guildId, guildCache);
      lastCacheRefresh = Date.now();
      console.log(`\u{1F3AD} Refreshed role tax cache for guild ${guildId}: ${activeExemptions.length} exemptions`);
    } catch (error) {
      console.error("Error refreshing role cache:", error);
    }
  }
  // Get existing tier benefits (integration with current system)
  static async getTierBenefit(userId) {
    try {
      const membership = await prisma.tierMembership.findFirst({
        where: {
          userId,
          expiresAt: { gt: /* @__PURE__ */ new Date() }
        },
        include: {
          tier: true
        },
        orderBy: { tier: { tipTaxFree: "desc" } }
        // Get best tier if multiple
      });
      if (!membership?.tier.tipTaxFree) return null;
      return {
        exemptionRate: 100,
        // Tier gives full exemption
        source: `tier:${membership.tier.id}`,
        label: `${membership.tier.name} Member`
      };
    } catch (error) {
      console.error("Error checking tier benefits:", error);
      return null;
    }
  }
  // Get referral tax benefits (new referral system)
  static async getReferralTaxBenefit(userId) {
    try {
      const config = await getConfig();
      if (!config.referralEnabled) return null;
      const activeReferral = await prisma.referral.findFirst({
        where: {
          referredId: userId,
          isVerified: false,
          totalTipped: { lt: config.referralVerificationThreshold }
        }
      });
      if (!activeReferral) return null;
      const taxReductionBps = Number(config.referralTaxReductionBps) || 0;
      const rakeReductionBps = Number(config.referralRakeReductionBps) || 0;
      const bestRate = Math.max(taxReductionBps, rakeReductionBps) / 100;
      if (bestRate <= 0) return null;
      return {
        exemptionRate: bestRate,
        source: `referral:${activeReferral.id}`,
        label: "Referral Bonus"
      };
    } catch (error) {
      console.error("Error checking referral tax benefits:", error);
      return null;
    }
  }
  // Admin function to create role tax exemptions
  static async createRoleTaxExemption(exemptionData) {
    const { roleId, guildId, exemptionRate, duration, label, createdBy, notes } = exemptionData;
    const expiresAt = duration ? new Date(Date.now() + duration * 24 * 60 * 60 * 1e3) : null;
    await prisma.roleTaxExemption.upsert({
      where: { roleId_guildId: { roleId, guildId } },
      create: {
        roleId,
        guildId,
        exemptionRate,
        duration,
        label,
        createdBy,
        notes,
        expiresAt
      },
      update: {
        exemptionRate,
        duration,
        label,
        createdBy,
        notes,
        expiresAt,
        isActive: true,
        updatedAt: /* @__PURE__ */ new Date()
      }
    });
    roleExemptionCache.delete(guildId);
    console.log(`\u{1F3AD} Created role tax exemption: ${label} (${exemptionRate}%) for role ${roleId} in guild ${guildId}`);
  }
  // Clean up expired exemptions (run periodically)
  static async cleanupExpiredExemptions() {
    try {
      const result = await prisma.roleTaxExemption.updateMany({
        where: {
          isActive: true,
          expiresAt: { lt: /* @__PURE__ */ new Date() }
        },
        data: { isActive: false }
      });
      if (result.count > 0) {
        roleExemptionCache.clear();
        console.log(`\u{1F9F9} Deactivated ${result.count} expired role tax exemptions`);
      }
      return result.count;
    } catch (error) {
      console.error("Error cleaning up expired exemptions:", error);
      return 0;
    }
  }
  // Get all active exemptions for admin dashboard
  static async getAllActiveExemptions(guildId) {
    return await prisma.roleTaxExemption.findMany({
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
        { exemptionRate: "desc" }
      ]
    });
  }
}
setInterval(() => {
  RoleTaxBenefitService.cleanupExpiredExemptions();
}, 60 * 60 * 1e3);
export {
  RoleTaxBenefitService
};
//# sourceMappingURL=role_tax_benefits.js.map
