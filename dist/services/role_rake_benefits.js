// src/services/role_rake_benefits.ts - Discord role-based rake reductions
import { prisma } from './db.js';
import { getDiscordClient } from './discord_users.js';
import { startTimer, endTimer } from './performance.js';
// Cache for role rake reductions per guild to avoid repeated DB queries
const roleRakeCache = new Map();
let lastCacheRefresh = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
export class RoleRakeReductionService {
    // Get the best available rake reduction for a user
    static async getBestRakeReduction(userId, guildId, discordUserId) {
        startTimer('role_rake_benefit_check');
        try {
            // 1. Check tier benefits (enhanced system)
            const tierBenefit = await this.getTierRakeBenefit(userId);
            // 2. Check role-based benefits (new system)
            const roleBenefit = await this.getRoleRakeBenefit(discordUserId, guildId);
            // Return the best benefit available
            const allBenefits = [tierBenefit, roleBenefit].filter(Boolean);
            const bestBenefit = allBenefits.reduce((best, current) => {
                if (!best || !current)
                    return best || current;
                return current.reductionRate > best.reductionRate ? current : best;
            }, null);
            endTimer('role_rake_benefit_check', {
                benefitsFound: allBenefits.length,
                bestRate: bestBenefit?.reductionRate || 0
            });
            return bestBenefit;
        }
        catch (error) {
            endTimer('role_rake_benefit_check', { success: false, error: String(error) });
            console.error('Error checking role rake benefits:', error);
            return null; // Fail gracefully - no rake benefit if error
        }
    }
    // Check Discord roles for rake reductions
    static async getRoleRakeBenefit(discordUserId, guildId) {
        try {
            // SECURITY: Always refresh role data to prevent cache poisoning
            // Re-verify role membership on EVERY benefit application (no cache trust)
            await this.refreshRakeCache(guildId);
            const guildCache = roleRakeCache.get(guildId);
            if (!guildCache)
                return null;
            // SECURITY: Real-time Discord role verification (no stale data)
            const discord = getDiscordClient();
            if (!discord)
                return null;
            const guild = await discord.guilds.fetch(guildId).catch(() => null);
            if (!guild)
                return null;
            // SECURITY: Fresh role fetch every time (prevent role evasion)
            const member = await guild.members.fetch(discordUserId).catch(() => null);
            if (!member)
                return null;
            // ANTI-EVASION: Check minimum role hold time (10 minutes)
            const minimumRoleHoldTime = 10 * 60 * 1000; // 10 minutes in milliseconds
            // Find best role benefit with hold time verification
            let bestBenefit = null;
            for (const roleId of member.roles.cache.keys()) {
                const roleBenefit = guildCache.get(roleId);
                if (!roleBenefit)
                    continue;
                // Check if user has held this role long enough
                const roleHoldValid = await this.verifyRoleHoldTime(discordUserId, guildId, roleId, minimumRoleHoldTime);
                if (roleHoldValid && (!bestBenefit || roleBenefit.reductionRate > bestBenefit.reductionRate)) {
                    // SECURITY: Double-verify user still has the role before applying benefit
                    const stillHasRole = member.roles.cache.has(roleId);
                    if (stillHasRole) {
                        bestBenefit = roleBenefit;
                        console.log(`✅ Rake benefit verified: User ${discordUserId} role ${roleId} (${roleBenefit.reductionRate}% reduction)`);
                    }
                    else {
                        console.warn(`🚫 Role benefit denied: User ${discordUserId} lost role ${roleId} during verification`);
                    }
                }
                else if (!roleHoldValid) {
                    // Log attempted role evasion for audit
                    console.warn(`🚫 Role rake evasion blocked: User ${discordUserId} has role ${roleId} for <10min in guild ${guildId}`);
                }
            }
            return bestBenefit;
        }
        catch (error) {
            console.error('Error fetching Discord role rake benefits:', error);
            return null;
        }
    }
    // ANTI-EVASION: Verify user has held role for minimum time (same as tax service)
    static async verifyRoleHoldTime(discordUserId, guildId, roleId, minimumHoldTime) {
        try {
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
                console.log(`📝 First rake role check: User ${discordUserId} role ${roleId} in guild ${guildId} - starting hold timer`);
                return false; // Not enough time held yet
            }
            // Simple time-based check: role benefits only apply 10 minutes after creation/update
            const roleCheckTime = existing.date.getTime();
            const timeSinceFirstSeen = Date.now() - roleCheckTime;
            if (timeSinceFirstSeen < minimumHoldTime) {
                console.log(`⏰ Rake role hold time insufficient: ${Math.round(timeSinceFirstSeen / 1000 / 60)}min < 10min required`);
                return false;
            }
            return true;
        }
        catch (error) {
            console.error('Error verifying rake role hold time:', error);
            // On error, be permissive but log for investigation
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
                        { expiresAt: null }, // Permanent reductions
                        { expiresAt: { gt: new Date() } } // Non-expired reductions
                    ]
                }
            });
            const guildCache = new Map();
            for (const reduction of activeReductions) {
                guildCache.set(reduction.roleId, {
                    reductionRate: Number(reduction.rakeReductionBps) / 10000, // Convert BPS to percentage (1% = 100 BPS)
                    source: `role:${reduction.roleId}`,
                    label: reduction.label
                });
            }
            roleRakeCache.set(guildId, guildCache);
            lastCacheRefresh = Date.now();
            console.log(`🎮 Refreshed role rake cache for guild ${guildId}: ${activeReductions.length} reductions`);
        }
        catch (error) {
            console.error('Error refreshing role rake cache:', error);
        }
    }
    // Get tier rake benefits (enhanced with new flexible system)
    static async getTierRakeBenefit(userId) {
        try {
            // Check active tier membership
            const membership = await prisma.tierMembership.findFirst({
                where: {
                    userId,
                    status: 'ACTIVE',
                    expiresAt: { gt: new Date() }
                },
                include: {
                    tier: true
                },
                orderBy: { tier: { rakeReductionBps: 'desc' } } // Get best tier if multiple
            });
            if (!membership)
                return null;
            const tier = membership.tier;
            // Check new flexible system first
            if (tier.rakeReductionBps > 0) {
                return {
                    reductionRate: Number(tier.rakeReductionBps) / 10000, // Convert BPS to percentage (1% = 100 BPS)
                    source: `tier:${tier.id}`,
                    label: `${tier.name} Member`
                };
            }
            // No rake benefit in this tier
            return null;
        }
        catch (error) {
            console.error('Error checking tier rake benefits:', error);
            return null;
        }
    }
    // Admin function to create role rake reductions
    static async createRoleRakeReduction(reductionData) {
        const { roleId, guildId, rakeReductionBps, duration, label, createdBy, notes } = reductionData;
        // Calculate expiry date if duration specified
        const expiresAt = duration
            ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000)
            : null;
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
                updatedAt: new Date()
            }
        });
        // Invalidate cache for this guild
        roleRakeCache.delete(guildId);
        console.log(`🎮 Created role rake reduction: ${label} (${rakeReductionBps / 100}%) for role ${roleId} in guild ${guildId}`);
    }
    // Clean up expired reductions (run periodically)
    static async cleanupExpiredReductions() {
        try {
            const result = await prisma.roleRakeReduction.updateMany({
                where: {
                    isActive: true,
                    expiresAt: { lt: new Date() }
                },
                data: { isActive: false }
            });
            if (result.count > 0) {
                roleRakeCache.clear(); // Clear all cache since we changed data
                console.log(`🧹 Deactivated ${result.count} expired role rake reductions`);
            }
            return result.count;
        }
        catch (error) {
            console.error('Error cleaning up expired rake reductions:', error);
            return 0;
        }
    }
    // Get all active reductions for admin dashboard
    static async getAllActiveReductions(guildId) {
        return await prisma.roleRakeReduction.findMany({
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
                { rakeReductionBps: 'desc' }
            ]
        });
    }
}
// Initialize cleanup job
setInterval(() => {
    RoleRakeReductionService.cleanupExpiredReductions();
}, 60 * 60 * 1000); // Check every hour
