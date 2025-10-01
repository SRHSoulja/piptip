import { prisma } from "./db.js";
import { createLogger } from "../utils/logger.js";
const logger = createLogger("admin-permissions");
const ADMIN_PRIVILEGES = {
  unlimitedMarketCreation: true,
  bypassPipchipsCost: true,
  manualResolutionOnly: true,
  customLiquidity: true,
  specialMarketTypes: true,
  resolveAnyMarket: true,
  promoteUsers: true,
  systemAdministration: true
};
var AdminLevel = /* @__PURE__ */ ((AdminLevel2) => {
  AdminLevel2[AdminLevel2["USER"] = 0] = "USER";
  AdminLevel2[AdminLevel2["MODERATOR"] = 1] = "MODERATOR";
  AdminLevel2[AdminLevel2["ADMIN"] = 2] = "ADMIN";
  AdminLevel2[AdminLevel2["SUPER_USER"] = 3] = "SUPER_USER";
  return AdminLevel2;
})(AdminLevel || {});
class AdminPermissionService {
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
      if (!user) return false;
      return user.isAdmin || user.isSuperUser || user.adminLevel >= 2 /* ADMIN */;
    } catch (error) {
      logger.error({ discordId, error }, "Error checking admin status");
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
      if (!user) return false;
      return user.isSuperUser || user.adminLevel >= 3 /* SUPER_USER */;
    } catch (error) {
      logger.error({ discordId, error }, "Error checking super user status");
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
      if (!user) return false;
      if (user.isAdmin || user.isSuperUser || user.adminLevel >= 2 /* ADMIN */) {
        return true;
      }
      return user.canCreateMarkets;
    } catch (error) {
      logger.error({ discordId, error }, "Error checking market creation permission");
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
      if (!user) return null;
      return {
        discordId: user.discordId,
        isAdmin: user.isAdmin,
        isSuperUser: user.isSuperUser,
        adminLevel: user.adminLevel,
        canCreateMarkets: user.canCreateMarkets,
        adminPromotedAt: user.adminPromotedAt || void 0,
        adminPromotedBy: user.adminPromotedBy || void 0
      };
    } catch (error) {
      logger.error({ discordId, error }, "Error getting admin profile");
      return null;
    }
  }
  /**
   * Promote user to admin (requires super user)
   */
  async promoteToAdmin(targetDiscordId, promoterDiscordId, level = 2 /* ADMIN */) {
    try {
      const canPromote = await this.canUserPromoteUsers(promoterDiscordId);
      if (!canPromote) {
        return { success: false, error: "Insufficient privileges to promote users" };
      }
      const user = await prisma.user.findUnique({
        where: { discordId: targetDiscordId }
      });
      if (!user) {
        return { success: false, error: "User not found" };
      }
      await prisma.user.update({
        where: { discordId: targetDiscordId },
        data: {
          isAdmin: level >= 2 /* ADMIN */,
          isSuperUser: level >= 3 /* SUPER_USER */,
          adminLevel: level,
          canCreateMarkets: true,
          // Admins can always create markets
          adminPromotedAt: /* @__PURE__ */ new Date(),
          adminPromotedBy: promoterDiscordId
        }
      });
      logger.info(`User promoted to admin: ${targetDiscordId} by ${promoterDiscordId} to level ${level}`);
      return { success: true };
    } catch (error) {
      logger.error({
        targetDiscordId,
        promoterDiscordId,
        level,
        error
      }, "Error promoting user to admin");
      return { success: false, error: "Failed to promote user" };
    }
  }
  /**
   * Remove admin privileges from user
   */
  async demoteFromAdmin(targetDiscordId, demoterDiscordId) {
    try {
      const canPromote = await this.canUserPromoteUsers(demoterDiscordId);
      if (!canPromote) {
        return { success: false, error: "Insufficient privileges to demote users" };
      }
      await prisma.user.update({
        where: { discordId: targetDiscordId },
        data: {
          isAdmin: false,
          isSuperUser: false,
          adminLevel: 0 /* USER */,
          canCreateMarkets: false,
          // Remove market creation privilege
          adminPromotedAt: null,
          adminPromotedBy: null
        }
      });
      logger.info(`User demoted from admin: ${targetDiscordId} by ${demoterDiscordId}`);
      return { success: true };
    } catch (error) {
      logger.error({
        targetDiscordId,
        demoterDiscordId,
        error
      }, "Error demoting user from admin");
      return { success: false, error: "Failed to demote user" };
    }
  }
  /**
   * Initialize admin from environment variables or database
   */
  async initializeDefaultAdmin() {
    try {
      const existingSuperUsers = await prisma.user.count({
        where: { isSuperUser: true }
      });
      if (existingSuperUsers === 0) {
        logger.warn("No super users found. Admin system requires manual setup.");
      }
    } catch (error) {
      logger.error({ error }, "Error initializing default admin");
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
        timestamp: /* @__PURE__ */ new Date()
      };
    } catch (error) {
      logger.error({ error }, "Error getting admin stats");
      return null;
    }
  }
}
const adminPermissions = new AdminPermissionService();
adminPermissions.initializeDefaultAdmin().catch(console.error);
console.log("\u{1F6E1}\uFE0F Admin permission system loaded");
export {
  ADMIN_PRIVILEGES,
  AdminLevel,
  AdminPermissionService,
  adminPermissions
};
//# sourceMappingURL=admin_permissions.js.map
