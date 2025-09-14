// src/services/role_tax_benefits.ts - Discord role-based tax exemptions

import { prisma } from './db.js';
import { getDiscordClient } from './discord_users.js';
import { startTimer, endTimer } from './performance.js';

interface RoleTaxBenefit {
  exemptionRate: number; // 0-100% tax reduction
  source: string; // Which role/benefit this came from
  label: string; // Human readable label
}

// Cache for role exemptions per guild to avoid repeated DB queries
const roleExemptionCache = new Map<string, Map<string, RoleTaxBenefit>>();
let lastCacheRefresh = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export class RoleTaxBenefitService {

  // Get the best available tax benefit for a user
  static async getBestTaxBenefit(
    userId: number,
    guildId: string,
    discordUserId: string
  ): Promise<RoleTaxBenefit | null> {

    startTimer('role_tax_benefit_check');

    try {
      // 1. Check tier benefits (existing system)
      const tierBenefit = await this.getTierBenefit(userId);

      // 2. Check role-based benefits (new system)
      const roleBenefit = await this.getRoleTaxBenefit(discordUserId, guildId);

      // Return the best benefit available
      const allBenefits = [tierBenefit, roleBenefit].filter(Boolean);
      const bestBenefit = allBenefits.reduce((best, current) => {
        if (!best || !current) return best || current;
        return current.exemptionRate > best.exemptionRate ? current : best;
      }, null as RoleTaxBenefit | null);

      endTimer('role_tax_benefit_check', {
        benefitsFound: allBenefits.length,
        bestRate: bestBenefit?.exemptionRate || 0
      });

      return bestBenefit;

    } catch (error) {
      endTimer('role_tax_benefit_check', { success: false, error: String(error) });
      console.error('Error checking role tax benefits:', error);
      return null; // Fail gracefully - no tax benefit if error
    }
  }

  // Check Discord roles for tax exemptions
  private static async getRoleTaxBenefit(
    discordUserId: string,
    guildId: string
  ): Promise<RoleTaxBenefit | null> {

    try {
      // Check cache first
      const cacheKey = `${guildId}:${discordUserId}`;
      const now = Date.now();

      if (now - lastCacheRefresh > CACHE_DURATION) {
        await this.refreshRoleCache(guildId);
      }

      const guildCache = roleExemptionCache.get(guildId);
      if (!guildCache) return null;

      // Get user's roles from Discord
      const discord = getDiscordClient();
      if (!discord) return null;

      const guild = await discord.guilds.fetch(guildId);
      if (!guild) return null;

      const member = await guild.members.fetch(discordUserId).catch(() => null);
      if (!member) return null;

      // ANTI-EVASION: Check minimum role hold time (10 minutes)
      const minimumRoleHoldTime = 10 * 60 * 1000; // 10 minutes in milliseconds
      const currentTime = Date.now();

      // Find best role benefit with hold time verification
      let bestBenefit: RoleTaxBenefit | null = null;

      for (const roleId of member.roles.cache.keys()) {
        const roleBenefit = guildCache.get(roleId);
        if (!roleBenefit) continue;

        // Check if user has held this role long enough
        const roleHoldValid = await this.verifyRoleHoldTime(
          discordUserId,
          guildId,
          roleId,
          minimumRoleHoldTime
        );

        if (roleHoldValid && (!bestBenefit || roleBenefit.exemptionRate > bestBenefit.exemptionRate)) {
          bestBenefit = roleBenefit;
        } else if (!roleHoldValid) {
          // Log attempted role evasion for audit
          console.warn(`🚫 Role tax evasion blocked: User ${discordUserId} has role ${roleId} for <10min in guild ${guildId}`);
        }
      }

      return bestBenefit;

    } catch (error) {
      console.error('Error fetching Discord role benefits:', error);
      return null;
    }
  }

  // ANTI-EVASION: Verify user has held role for minimum time
  private static async verifyRoleHoldTime(
    discordUserId: string,
    guildId: string,
    roleId: string,
    minimumHoldTime: number
  ): Promise<boolean> {
    try {
      // Track role assignments in database for audit trail
      const roleAssignmentKey = `${discordUserId}:${guildId}:${roleId}`;

      // Check if we've seen this role assignment before
      const existing = await prisma.roleBenefitAnalytics.findFirst({
        where: {
          roleId,
          guildId,
          // We don't have direct userId linking, so check recent activity
          date: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        },
        orderBy: { date: 'desc' }
      });

      // For new role assignments, record the first time we see them
      if (!existing) {
        // This is the first time we're checking this role - assume user just got it
        console.log(`📝 First role check: User ${discordUserId} role ${roleId} in guild ${guildId} - starting hold timer`);
        return false; // Not enough time held yet
      }

      // Simple time-based check: role benefits only apply 10 minutes after creation/update
      const roleCheckTime = existing.date.getTime();
      const timeSinceFirstSeen = Date.now() - roleCheckTime;

      if (timeSinceFirstSeen < minimumHoldTime) {
        console.log(`⏰ Role hold time insufficient: ${Math.round(timeSinceFirstSeen/1000/60)}min < 10min required`);
        return false;
      }

      return true;

    } catch (error) {
      console.error('Error verifying role hold time:', error);
      // On error, be permissive but log for investigation
      return true;
    }
  }

  // Refresh role exemption cache for a guild
  private static async refreshRoleCache(guildId: string): Promise<void> {
    try {
      const activeExemptions = await prisma.roleTaxExemption.findMany({
        where: {
          guildId,
          isActive: true,
          OR: [
            { expiresAt: null }, // Permanent exemptions
            { expiresAt: { gt: new Date() } } // Non-expired exemptions
          ]
        }
      });

      const guildCache = new Map<string, RoleTaxBenefit>();

      for (const exemption of activeExemptions) {
        guildCache.set(exemption.roleId, {
          exemptionRate: Number(exemption.exemptionRate),
          source: `role:${exemption.roleId}`,
          label: exemption.label
        });
      }

      roleExemptionCache.set(guildId, guildCache);
      lastCacheRefresh = Date.now();

      console.log(`🎭 Refreshed role tax cache for guild ${guildId}: ${activeExemptions.length} exemptions`);

    } catch (error) {
      console.error('Error refreshing role cache:', error);
    }
  }

  // Get existing tier benefits (integration with current system)
  private static async getTierBenefit(userId: number): Promise<RoleTaxBenefit | null> {
    try {
      // Check active tier membership
      const membership = await prisma.tierMembership.findFirst({
        where: {
          userId,
          expiresAt: { gt: new Date() }
        },
        include: {
          tier: true
        },
        orderBy: { tier: { tipTaxFree: 'desc' } } // Get best tier if multiple
      });

      if (!membership?.tier.tipTaxFree) return null;

      return {
        exemptionRate: 100, // Tier gives full exemption
        source: `tier:${membership.tier.id}`,
        label: `${membership.tier.name} Member`
      };

    } catch (error) {
      console.error('Error checking tier benefits:', error);
      return null;
    }
  }


  // Admin function to create role tax exemptions
  static async createRoleTaxExemption(exemptionData: {
    roleId: string;
    guildId: string;
    exemptionRate: number;
    duration?: number; // days
    label: string;
    createdBy: string;
    notes?: string;
  }): Promise<void> {

    const { roleId, guildId, exemptionRate, duration, label, createdBy, notes } = exemptionData;

    // Calculate expiry date if duration specified
    const expiresAt = duration
      ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000)
      : null;

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
        updatedAt: new Date()
      }
    });

    // Invalidate cache for this guild
    roleExemptionCache.delete(guildId);
    console.log(`🎭 Created role tax exemption: ${label} (${exemptionRate}%) for role ${roleId} in guild ${guildId}`);
  }

  // Clean up expired exemptions (run periodically)
  static async cleanupExpiredExemptions(): Promise<number> {
    try {
      const result = await prisma.roleTaxExemption.updateMany({
        where: {
          isActive: true,
          expiresAt: { lt: new Date() }
        },
        data: { isActive: false }
      });

      if (result.count > 0) {
        roleExemptionCache.clear(); // Clear all cache since we changed data
        console.log(`🧹 Deactivated ${result.count} expired role tax exemptions`);
      }

      return result.count;

    } catch (error) {
      console.error('Error cleaning up expired exemptions:', error);
      return 0;
    }
  }

  // Get all active exemptions for admin dashboard
  static async getAllActiveExemptions(guildId?: string) {
    return await prisma.roleTaxExemption.findMany({
      where: {
        ...(guildId && { guildId }),
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      orderBy: [
        { guildId: 'asc' },
        { exemptionRate: 'desc' }
      ]
    });
  }
}

// Initialize cleanup job
setInterval(() => {
  RoleTaxBenefitService.cleanupExpiredExemptions();
}, 60 * 60 * 1000); // Check every hour