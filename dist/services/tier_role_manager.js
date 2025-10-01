import { prisma } from "./db.js";
import { getDiscordClient } from "./discord_users.js";
const TIER_ROLE_MAPPING = [
  // Example configuration - update with actual tier IDs and role IDs
  // { tierId: 1, tierName: "Bronze", roleId: "ROLE_ID_HERE", roleName: "PIP Bronze", guildId: "GUILD_ID_HERE" },
  // { tierId: 2, tierName: "Silver", roleId: "ROLE_ID_HERE", roleName: "PIP Silver", guildId: "GUILD_ID_HERE" },
  // { tierId: 3, tierName: "Gold", roleId: "ROLE_ID_HERE", roleName: "PIP Gold", guildId: "GUILD_ID_HERE" },
];
class TierRoleManager {
  static instance;
  client = getDiscordClient();
  static getInstance() {
    if (!TierRoleManager.instance) {
      TierRoleManager.instance = new TierRoleManager();
    }
    return TierRoleManager.instance;
  }
  /**
   * Assign Discord role to user based on their tier membership
   */
  async assignTierRole(discordId, tierId) {
    try {
      if (!this.client) {
        console.warn("Discord client not available for role assignment");
        return false;
      }
      const roleConfig = TIER_ROLE_MAPPING.find((config) => config.tierId === tierId);
      if (!roleConfig) {
        console.warn(`No role configuration found for tier ID: ${tierId}`);
        return false;
      }
      const guild = await this.client.guilds.fetch(roleConfig.guildId);
      if (!guild) {
        console.error(`Guild not found: ${roleConfig.guildId}`);
        return false;
      }
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) {
        console.warn(`Member not found in guild: ${discordId}`);
        return false;
      }
      const role = await guild.roles.fetch(roleConfig.roleId);
      if (!role) {
        console.error(`Role not found: ${roleConfig.roleId}`);
        return false;
      }
      if (member.roles.cache.has(roleConfig.roleId)) {
        console.log(`User ${discordId} already has ${roleConfig.roleName} role`);
        return true;
      }
      await member.roles.add(role, `PIPTip tier membership: ${roleConfig.tierName}`);
      console.log(`\u2705 Assigned ${roleConfig.roleName} role to ${discordId}`);
      return true;
    } catch (error) {
      console.error(`Failed to assign tier role to ${discordId}:`, error);
      return false;
    }
  }
  /**
   * Remove Discord role from user when membership expires
   */
  async removeTierRole(discordId, tierId) {
    try {
      if (!this.client) {
        console.warn("Discord client not available for role removal");
        return false;
      }
      const roleConfig = TIER_ROLE_MAPPING.find((config) => config.tierId === tierId);
      if (!roleConfig) {
        console.warn(`No role configuration found for tier ID: ${tierId}`);
        return false;
      }
      const guild = await this.client.guilds.fetch(roleConfig.guildId);
      if (!guild) {
        console.error(`Guild not found: ${roleConfig.guildId}`);
        return false;
      }
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) {
        console.warn(`Member not found in guild: ${discordId}`);
        return false;
      }
      const role = await guild.roles.fetch(roleConfig.roleId);
      if (!role) {
        console.error(`Role not found: ${roleConfig.roleId}`);
        return false;
      }
      if (!member.roles.cache.has(roleConfig.roleId)) {
        console.log(`User ${discordId} doesn't have ${roleConfig.roleName} role`);
        return true;
      }
      await member.roles.remove(role, `PIPTip tier membership expired: ${roleConfig.tierName}`);
      console.log(`\u{1F5D1}\uFE0F Removed ${roleConfig.roleName} role from ${discordId}`);
      return true;
    } catch (error) {
      console.error(`Failed to remove tier role from ${discordId}:`, error);
      return false;
    }
  }
  /**
   * Sync all user roles based on current active memberships
   */
  async syncAllTierRoles() {
    const results = { processed: 0, assigned: 0, removed: 0, errors: 0 };
    try {
      const users = await prisma.user.findMany({
        where: {
          tierMemberships: {
            some: {}
            // Has any tier memberships
          }
        },
        include: {
          tierMemberships: {
            where: {
              status: "ACTIVE",
              expiresAt: { gt: /* @__PURE__ */ new Date() }
            },
            include: { tier: true }
          }
        }
      });
      for (const user of users) {
        results.processed++;
        try {
          const activeMemberships = user.tierMemberships.filter(
            (m) => m.status === "ACTIVE" && m.expiresAt > /* @__PURE__ */ new Date()
          );
          if (activeMemberships.length === 0) {
            for (const config of TIER_ROLE_MAPPING) {
              const removed = await this.removeTierRole(user.discordId, config.tierId);
              if (removed) results.removed++;
            }
            continue;
          }
          const highestTier = activeMemberships.reduce(
            (highest, current) => current.tierId > highest.tierId ? current : highest
          );
          const assigned = await this.assignTierRole(user.discordId, highestTier.tierId);
          if (assigned) results.assigned++;
          for (const config of TIER_ROLE_MAPPING) {
            if (config.tierId !== highestTier.tierId) {
              const removed = await this.removeTierRole(user.discordId, config.tierId);
              if (removed) results.removed++;
            }
          }
        } catch (error) {
          console.error(`Error syncing roles for user ${user.discordId}:`, error);
          results.errors++;
        }
      }
      console.log(`\u{1F504} Tier role sync complete:`, results);
      return results;
    } catch (error) {
      console.error("Failed to sync tier roles:", error);
      results.errors++;
      return results;
    }
  }
  /**
   * Handle role assignment when membership is purchased/renewed
   */
  async onMembershipPurchased(discordId, tierId) {
    console.log(`\u{1F4DD} Processing membership purchase for ${discordId}, tier ${tierId}`);
    await this.assignTierRole(discordId, tierId);
    for (const config of TIER_ROLE_MAPPING) {
      if (config.tierId < tierId) {
        await this.removeTierRole(discordId, config.tierId);
      }
    }
  }
  /**
   * Handle role removal when membership expires
   */
  async onMembershipExpired(discordId, tierId) {
    console.log(`\u23F0 Processing membership expiry for ${discordId}, tier ${tierId}`);
    const user = await prisma.user.findUnique({
      where: { discordId },
      include: {
        tierMemberships: {
          where: {
            status: "ACTIVE",
            expiresAt: { gt: /* @__PURE__ */ new Date() }
          }
        }
      }
    });
    if (!user) return;
    const activeMemberships = user.tierMemberships.filter(
      (m) => m.status === "ACTIVE" && m.expiresAt > /* @__PURE__ */ new Date()
    );
    if (activeMemberships.length === 0) {
      await this.removeTierRole(discordId, tierId);
    } else {
      const highestTier = activeMemberships.reduce(
        (highest, current) => current.tierId > highest.tierId ? current : highest
      );
      await this.removeTierRole(discordId, tierId);
      await this.assignTierRole(discordId, highestTier.tierId);
    }
  }
  /**
   * Get configuration for environment setup
   */
  static getConfigurationTemplate() {
    return `
# Discord Tier Role Configuration
# Add these to your .env file and update with actual Discord role and guild IDs

# Main server guild ID where roles will be assigned
DISCORD_MAIN_GUILD_ID=YOUR_GUILD_ID_HERE

# Tier role mappings (format: TIER_ID:ROLE_ID)
TIER_ROLE_BRONZE=1:BRONZE_ROLE_ID_HERE
TIER_ROLE_SILVER=2:SILVER_ROLE_ID_HERE
TIER_ROLE_GOLD=3:GOLD_ROLE_ID_HERE

# Enable tier role management
ENABLE_TIER_ROLES=true
    `.trim();
  }
}
class TierRoleSyncService {
  static syncInterval = null;
  static SYNC_INTERVAL_HOURS = 6;
  // Sync every 6 hours
  static startPeriodicSync() {
    if (TierRoleSyncService.syncInterval) {
      console.log("Tier role sync service already running");
      return;
    }
    const intervalMs = TierRoleSyncService.SYNC_INTERVAL_HOURS * 60 * 60 * 1e3;
    setTimeout(() => {
      TierRoleManager.getInstance().syncAllTierRoles();
    }, 5 * 60 * 1e3);
    TierRoleSyncService.syncInterval = setInterval(() => {
      console.log("\u{1F504} Starting scheduled tier role sync");
      TierRoleManager.getInstance().syncAllTierRoles();
    }, intervalMs);
    console.log(`\u2705 Tier role sync service started (every ${TierRoleSyncService.SYNC_INTERVAL_HOURS} hours)`);
  }
  static stopPeriodicSync() {
    if (TierRoleSyncService.syncInterval) {
      clearInterval(TierRoleSyncService.syncInterval);
      TierRoleSyncService.syncInterval = null;
      console.log("\u{1F6D1} Tier role sync service stopped");
    }
  }
}
const tierRoleManager = TierRoleManager.getInstance();
export {
  TierRoleManager,
  TierRoleSyncService,
  tierRoleManager
};
//# sourceMappingURL=tier_role_manager.js.map
