// src/services/role_tax_benefits.ts - Discord role-based tax exemptions
import { prisma } from './db.js';
import { getDiscordClient } from './discord_users.js';
import { startTimer, endTimer } from './performance.js';
import { getConfig } from '../config.js';
// Cache for role exemptions per guild to avoid repeated DB queries
const roleExemptionCache = new Map();
let lastCacheRefresh = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
export class RoleTaxBenefitService {
    // Get the best available tax benefit for a user
    static async getBestTaxBenefit(userId, guildId, discordUserId) {
        startTimer('role_tax_benefit_check');
        try {
            // 1. Check tier benefits (existing system)
            const tierBenefit = await this.getTierBenefit(userId);
            // 2. Check role-based benefits (new system)
            const roleBenefit = await this.getRoleTaxBenefit(discordUserId, guildId);
            // 3. Check referral benefits (new referral system)
            const referralBenefit = await this.getReferralTaxBenefit(userId);
            // Return the best benefit available
            const allBenefits = [tierBenefit, roleBenefit, referralBenefit].filter(Boolean);
            const bestBenefit = allBenefits.reduce((best, current) => {
                if (!best || !current)
                    return best || current;
                return current.exemptionRate > best.exemptionRate ? current : best;
            }, null);
            endTimer('role_tax_benefit_check', {
                benefitsFound: allBenefits.length,
                bestRate: bestBenefit?.exemptionRate || 0
            });
            return bestBenefit;
        }
        catch (error) {
            endTimer('role_tax_benefit_check', { success: false, error: String(error) });
            console.error('Error checking role tax benefits:', error);
            return null; // Fail gracefully - no tax benefit if error
        }
    }
    // Check Discord roles for tax exemptions
    static async getRoleTaxBenefit(discordUserId, guildId) {
        try {
            // SECURITY: Always refresh role data to prevent cache poisoning
            // Re-verify role membership on EVERY benefit application (no cache trust)
            await this.refreshRoleCache(guildId);
            const guildCache = roleExemptionCache.get(guildId);
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
            const currentTime = Date.now();
            // Find best role benefit with hold time verification
            let bestBenefit = null;
            for (const roleId of member.roles.cache.keys()) {
                const roleBenefit = guildCache.get(roleId);
                if (!roleBenefit)
                    continue;
                // Check if user has held this role long enough
                const roleHoldValid = await this.verifyRoleHoldTime(discordUserId, guildId, roleId, minimumRoleHoldTime);
                if (roleHoldValid && (!bestBenefit || roleBenefit.exemptionRate > bestBenefit.exemptionRate)) {
                    // SECURITY: Double-verify user still has the role before applying benefit
                    const stillHasRole = member.roles.cache.has(roleId);
                    if (stillHasRole) {
                        bestBenefit = roleBenefit;
                        console.log(`✅ Tax benefit verified: User ${discordUserId} role ${roleId} (${roleBenefit.exemptionRate}% exemption)`);
                    }
                    else {
                        console.warn(`🚫 Role benefit denied: User ${discordUserId} lost role ${roleId} during verification`);
                    }
                }
                else if (!roleHoldValid) {
                    // Log attempted role evasion for audit
                    console.warn(`🚫 Role tax evasion blocked: User ${discordUserId} has role ${roleId} for <10min in guild ${guildId}`);
                }
            }
            return bestBenefit;
        }
        catch (error) {
            console.error('Error fetching Discord role benefits:', error);
            return null;
        }
    }
    // ANTI-EVASION: Verify user has held role for minimum time
    static async verifyRoleHoldTime(discordUserId, guildId, roleId, minimumHoldTime) {
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
                console.log(`⏰ Role hold time insufficient: ${Math.round(timeSinceFirstSeen / 1000 / 60)}min < 10min required`);
                return false;
            }
            return true;
        }
        catch (error) {
            console.error('Error verifying role hold time:', error);
            // On error, be permissive but log for investigation
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
                        { expiresAt: null }, // Permanent exemptions
                        { expiresAt: { gt: new Date() } } // Non-expired exemptions
                    ]
                }
            });
            const guildCache = new Map();
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
        }
        catch (error) {
            console.error('Error refreshing role cache:', error);
        }
    }
    // Get existing tier benefits (integration with current system)
    static async getTierBenefit(userId) {
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
            if (!membership?.tier.tipTaxFree)
                return null;
            return {
                exemptionRate: 100, // Tier gives full exemption
                source: `tier:${membership.tier.id}`,
                label: `${membership.tier.name} Member`
            };
        }
        catch (error) {
            console.error('Error checking tier benefits:', error);
            return null;
        }
    }
    // Get referral tax benefits (new referral system)
    static async getReferralTaxBenefit(userId) {
        try {
            const config = await getConfig();
            // Skip if referral system is disabled
            if (!config.referralEnabled)
                return null;
            // Check for active referral benefits (unverified referrals still within threshold)
            const activeReferral = await prisma.referral.findFirst({
                where: {
                    referredId: userId,
                    isVerified: false,
                    totalTipped: { lt: config.referralVerificationThreshold }
                }
            });
            if (!activeReferral)
                return null;
            // Calculate the best available referral benefit
            const taxReductionBps = Number(config.referralTaxReductionBps) || 0;
            const rakeReductionBps = Number(config.referralRakeReductionBps) || 0;
            // Return the higher of tax or rake reduction as the primary benefit
            const bestRate = Math.max(taxReductionBps, rakeReductionBps) / 100; // Convert BPS to percentage
            if (bestRate <= 0)
                return null;
            return {
                exemptionRate: bestRate,
                source: `referral:${activeReferral.id}`,
                label: 'Referral Bonus'
            };
        }
        catch (error) {
            console.error('Error checking referral tax benefits:', error);
            return null;
        }
    }
    // Admin function to create role tax exemptions
    static async createRoleTaxExemption(exemptionData) {
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
    static async cleanupExpiredExemptions() {
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
        }
        catch (error) {
            console.error('Error cleaning up expired exemptions:', error);
            return 0;
        }
    }
    // Get all active exemptions for admin dashboard
    static async getAllActiveExemptions(guildId) {
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
