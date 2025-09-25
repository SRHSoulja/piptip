// src/services/admin_permissions.ts - Admin permission system with bypass capabilities
import { prisma } from './db.js';
import { createLogger } from '../utils/logger.js';
const logger = createLogger('admin-permissions');
// Admin privilege configuration
export const ADMIN_PRIVILEGES = {
    unlimitedMarketCreation: true,
    bypassPipchipsCost: true,
    manualResolutionOnly: true,
    customLiquidity: true,
    specialMarketTypes: true,
    resolveAnyMarket: true,
    promoteUsers: true,
    systemAdministration: true
};
// Admin levels
export var AdminLevel;
(function (AdminLevel) {
    AdminLevel[AdminLevel["USER"] = 0] = "USER";
    AdminLevel[AdminLevel["MODERATOR"] = 1] = "MODERATOR";
    AdminLevel[AdminLevel["ADMIN"] = 2] = "ADMIN";
    AdminLevel[AdminLevel["SUPER_USER"] = 3] = "SUPER_USER";
})(AdminLevel || (AdminLevel = {}));
export class AdminPermissionService {
    /**
     * Check if user has admin privileges
     */
    async isUserAdmin(discordId) {
        try {
            const user = await prisma.user.findUnique({
                where: { discordId },
                select: {
                    isAdmin: true,
                    isSuperUser: true,
                    adminLevel: true
                }
            });
            if (!user)
                return false;
            return user.isAdmin || user.isSuperUser || user.adminLevel >= AdminLevel.ADMIN;
        }
        catch (error) {
            logger.error({ discordId, error }, 'Error checking admin status');
            return false;
        }
    }
    /**
     * Check if user is super user
     */
    async isUserSuperUser(discordId) {
        try {
            const user = await prisma.user.findUnique({
                where: { discordId },
                select: { isSuperUser: true, adminLevel: true }
            });
            if (!user)
                return false;
            return user.isSuperUser || user.adminLevel >= AdminLevel.SUPER_USER;
        }
        catch (error) {
            logger.error({ discordId, error }, 'Error checking super user status');
            return false;
        }
    }
    /**
     * Check if user can create markets (admin bypass or regular permission)
     */
    async canUserCreateMarkets(discordId) {
        try {
            const user = await prisma.user.findUnique({
                where: { discordId },
                select: {
                    isAdmin: true,
                    isSuperUser: true,
                    adminLevel: true,
                    canCreateMarkets: true
                }
            });
            if (!user)
                return false;
            // Admin bypasses all restrictions
            if (user.isAdmin || user.isSuperUser || user.adminLevel >= AdminLevel.ADMIN) {
                return true;
            }
            // Regular users need explicit permission
            return user.canCreateMarkets;
        }
        catch (error) {
            logger.error({ discordId, error }, 'Error checking market creation permission');
            return false;
        }
    }
    /**
     * Check if user can resolve markets manually
     */
    async canUserResolveMarkets(discordId) {
        return await this.isUserAdmin(discordId);
    }
    /**
     * Check if user can create special admin-only markets
     */
    async canUserCreateSpecialMarkets(discordId) {
        return await this.isUserAdmin(discordId);
    }
    /**
     * Check if user can promote other users to admin
     */
    async canUserPromoteUsers(discordId) {
        return await this.isUserSuperUser(discordId);
    }
    /**
     * Get user's complete admin profile
     */
    async getUserAdminProfile(discordId) {
        try {
            const user = await prisma.user.findUnique({
                where: { discordId },
                select: {
                    discordId: true,
                    isAdmin: true,
                    isSuperUser: true,
                    adminLevel: true,
                    canCreateMarkets: true,
                    adminPromotedAt: true,
                    adminPromotedBy: true
                }
            });
            if (!user)
                return null;
            return {
                discordId: user.discordId,
                isAdmin: user.isAdmin,
                isSuperUser: user.isSuperUser,
                adminLevel: user.adminLevel,
                canCreateMarkets: user.canCreateMarkets,
                adminPromotedAt: user.adminPromotedAt || undefined,
                adminPromotedBy: user.adminPromotedBy || undefined
            };
        }
        catch (error) {
            logger.error({ discordId, error }, 'Error getting admin profile');
            return null;
        }
    }
    /**
     * Promote user to admin (requires super user)
     */
    async promoteToAdmin(targetDiscordId, promoterDiscordId, level = AdminLevel.ADMIN) {
        try {
            // Check if promoter has permission
            const canPromote = await this.canUserPromoteUsers(promoterDiscordId);
            if (!canPromote) {
                return { success: false, error: 'Insufficient privileges to promote users' };
            }
            // Find or create target user
            const user = await prisma.user.findUnique({
                where: { discordId: targetDiscordId }
            });
            if (!user) {
                return { success: false, error: 'User not found' };
            }
            // Update user permissions
            await prisma.user.update({
                where: { discordId: targetDiscordId },
                data: {
                    isAdmin: level >= AdminLevel.ADMIN,
                    isSuperUser: level >= AdminLevel.SUPER_USER,
                    adminLevel: level,
                    canCreateMarkets: true, // Admins can always create markets
                    adminPromotedAt: new Date(),
                    adminPromotedBy: promoterDiscordId
                }
            });
            logger.info(`User promoted to admin: ${targetDiscordId} by ${promoterDiscordId} to level ${level}`);
            return { success: true };
        }
        catch (error) {
            logger.error({
                targetDiscordId,
                promoterDiscordId,
                level,
                error
            }, 'Error promoting user to admin');
            return { success: false, error: 'Failed to promote user' };
        }
    }
    /**
     * Remove admin privileges from user
     */
    async demoteFromAdmin(targetDiscordId, demoterDiscordId) {
        try {
            // Check if demoter has permission
            const canPromote = await this.canUserPromoteUsers(demoterDiscordId);
            if (!canPromote) {
                return { success: false, error: 'Insufficient privileges to demote users' };
            }
            // Update user permissions
            await prisma.user.update({
                where: { discordId: targetDiscordId },
                data: {
                    isAdmin: false,
                    isSuperUser: false,
                    adminLevel: AdminLevel.USER,
                    canCreateMarkets: false, // Remove market creation privilege
                    adminPromotedAt: null,
                    adminPromotedBy: null
                }
            });
            logger.info(`User demoted from admin: ${targetDiscordId} by ${demoterDiscordId}`);
            return { success: true };
        }
        catch (error) {
            logger.error({
                targetDiscordId,
                demoterDiscordId,
                error
            }, 'Error demoting user from admin');
            return { success: false, error: 'Failed to demote user' };
        }
    }
    /**
     * Initialize admin from environment variables or database
     */
    async initializeDefaultAdmin() {
        try {
            // Check if there are any super users
            const existingSuperUsers = await prisma.user.count({
                where: { isSuperUser: true }
            });
            if (existingSuperUsers === 0) {
                logger.warn('No super users found. Admin system requires manual setup.');
                // Could auto-promote the first user or use environment variables here
            }
        }
        catch (error) {
            logger.error({ error }, 'Error initializing default admin');
        }
    }
    /**
     * Get admin statistics for dashboard
     */
    async getAdminStats() {
        try {
            const [totalAdmins, totalSuperUsers, totalWithMarketPerms] = await Promise.all([
                prisma.user.count({ where: { isAdmin: true } }),
                prisma.user.count({ where: { isSuperUser: true } }),
                prisma.user.count({ where: { canCreateMarkets: true } })
            ]);
            return {
                totalAdmins,
                totalSuperUsers,
                totalWithMarketPerms,
                timestamp: new Date()
            };
        }
        catch (error) {
            logger.error({ error }, 'Error getting admin stats');
            return null;
        }
    }
}
// Export singleton
export const adminPermissions = new AdminPermissionService();
// Initialize on startup
adminPermissions.initializeDefaultAdmin().catch(console.error);
console.log('🛡️ Admin permission system loaded');
