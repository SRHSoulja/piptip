// src/services/tier_role_manager.ts - Discord role management for tier memberships
import { prisma } from "./db.js";
import { getDiscordClient } from "./discord_users.js";
import type { Guild, GuildMember, Role } from "discord.js";

// Configuration for tier roles (should be environment variables in production)
interface TierRoleConfig {
  tierId: number;
  tierName: string;
  roleId: string;
  roleName: string;
  guildId: string;
}

// Configuration mapping tiers to Discord roles
// TODO: Move to environment variables or database configuration
const TIER_ROLE_MAPPING: TierRoleConfig[] = [
  // Example configuration - update with actual tier IDs and role IDs
  // { tierId: 1, tierName: "Bronze", roleId: "ROLE_ID_HERE", roleName: "PIP Bronze", guildId: "GUILD_ID_HERE" },
  // { tierId: 2, tierName: "Silver", roleId: "ROLE_ID_HERE", roleName: "PIP Silver", guildId: "GUILD_ID_HERE" },
  // { tierId: 3, tierName: "Gold", roleId: "ROLE_ID_HERE", roleName: "PIP Gold", guildId: "GUILD_ID_HERE" },
];

export class TierRoleManager {
  private static instance: TierRoleManager;
  private client = getDiscordClient();

  public static getInstance(): TierRoleManager {
    if (!TierRoleManager.instance) {
      TierRoleManager.instance = new TierRoleManager();
    }
    return TierRoleManager.instance;
  }

  /**
   * Assign Discord role to user based on their tier membership
   */
  async assignTierRole(discordId: string, tierId: number): Promise<boolean> {
    try {
      if (!this.client) {
        console.warn("Discord client not available for role assignment");
        return false;
      }

      const roleConfig = TIER_ROLE_MAPPING.find(config => config.tierId === tierId);
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

      // Check if user already has the role
      if (member.roles.cache.has(roleConfig.roleId)) {
        console.log(`User ${discordId} already has ${roleConfig.roleName} role`);
        return true;
      }

      // Assign the role
      await member.roles.add(role, `PIPTip tier membership: ${roleConfig.tierName}`);
      console.log(`✅ Assigned ${roleConfig.roleName} role to ${discordId}`);

      return true;
    } catch (error) {
      console.error(`Failed to assign tier role to ${discordId}:`, error);
      return false;
    }
  }

  /**
   * Remove Discord role from user when membership expires
   */
  async removeTierRole(discordId: string, tierId: number): Promise<boolean> {
    try {
      if (!this.client) {
        console.warn("Discord client not available for role removal");
        return false;
      }

      const roleConfig = TIER_ROLE_MAPPING.find(config => config.tierId === tierId);
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

      // Check if user has the role
      if (!member.roles.cache.has(roleConfig.roleId)) {
        console.log(`User ${discordId} doesn't have ${roleConfig.roleName} role`);
        return true;
      }

      // Remove the role
      await member.roles.remove(role, `PIPTip tier membership expired: ${roleConfig.tierName}`);
      console.log(`🗑️ Removed ${roleConfig.roleName} role from ${discordId}`);

      return true;
    } catch (error) {
      console.error(`Failed to remove tier role from ${discordId}:`, error);
      return false;
    }
  }

  /**
   * Sync all user roles based on current active memberships
   */
  async syncAllTierRoles(): Promise<{ processed: number; assigned: number; removed: number; errors: number }> {
    const results = { processed: 0, assigned: 0, removed: 0, errors: 0 };

    try {
      // Get all users with tier memberships
      const users = await prisma.user.findMany({
        where: {
          tierMemberships: {
            some: {} // Has any tier memberships
          }
        },
        include: {
          tierMemberships: {
            where: {
              status: 'ACTIVE',
              expiresAt: { gt: new Date() }
            },
            include: { tier: true }
          }
        }
      });

      for (const user of users) {
        results.processed++;

        try {
          // Get the user's highest tier (assuming higher tier ID = higher tier)
          const activeMemberships = user.tierMemberships.filter(
            m => m.status === 'ACTIVE' && m.expiresAt > new Date()
          );

          if (activeMemberships.length === 0) {
            // Remove all tier roles
            for (const config of TIER_ROLE_MAPPING) {
              const removed = await this.removeTierRole(user.discordId, config.tierId);
              if (removed) results.removed++;
            }
            continue;
          }

          // Find highest tier membership
          const highestTier = activeMemberships.reduce((highest, current) =>
            current.tierId > highest.tierId ? current : highest
          );

          // Assign role for highest tier
          const assigned = await this.assignTierRole(user.discordId, highestTier.tierId);
          if (assigned) results.assigned++;

          // Remove roles for other tiers user doesn't have
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

      console.log(`🔄 Tier role sync complete:`, results);
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
  async onMembershipPurchased(discordId: string, tierId: number): Promise<void> {
    console.log(`📝 Processing membership purchase for ${discordId}, tier ${tierId}`);

    // Assign the new tier role
    await this.assignTierRole(discordId, tierId);

    // Remove roles for lower tiers if this is a higher tier
    for (const config of TIER_ROLE_MAPPING) {
      if (config.tierId < tierId) {
        await this.removeTierRole(discordId, config.tierId);
      }
    }
  }

  /**
   * Handle role removal when membership expires
   */
  async onMembershipExpired(discordId: string, tierId: number): Promise<void> {
    console.log(`⏰ Processing membership expiry for ${discordId}, tier ${tierId}`);

    // Check if user has any other active memberships
    const user = await prisma.user.findUnique({
      where: { discordId },
      include: {
        tierMemberships: {
          where: {
            status: 'ACTIVE',
            expiresAt: { gt: new Date() }
          }
        }
      }
    });

    if (!user) return;

    const activeMemberships = user.tierMemberships.filter(
      m => m.status === 'ACTIVE' && m.expiresAt > new Date()
    );

    if (activeMemberships.length === 0) {
      // Remove all tier roles
      await this.removeTierRole(discordId, tierId);
    } else {
      // Find highest remaining tier and ensure correct role assignment
      const highestTier = activeMemberships.reduce((highest, current) =>
        current.tierId > highest.tierId ? current : highest
      );

      // Remove the expired tier role
      await this.removeTierRole(discordId, tierId);

      // Ensure user has role for their highest remaining tier
      await this.assignTierRole(discordId, highestTier.tierId);
    }
  }

  /**
   * Get configuration for environment setup
   */
  static getConfigurationTemplate(): string {
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

// Periodic sync service to clean up expired memberships
export class TierRoleSyncService {
  private static syncInterval: NodeJS.Timeout | null = null;
  private static readonly SYNC_INTERVAL_HOURS = 6; // Sync every 6 hours

  static startPeriodicSync(): void {
    if (TierRoleSyncService.syncInterval) {
      console.log("Tier role sync service already running");
      return;
    }

    const intervalMs = TierRoleSyncService.SYNC_INTERVAL_HOURS * 60 * 60 * 1000;

    // Run initial sync after 5 minutes
    setTimeout(() => {
      TierRoleManager.getInstance().syncAllTierRoles();
    }, 5 * 60 * 1000);

    // Set up periodic sync
    TierRoleSyncService.syncInterval = setInterval(() => {
      console.log("🔄 Starting scheduled tier role sync");
      TierRoleManager.getInstance().syncAllTierRoles();
    }, intervalMs);

    console.log(`✅ Tier role sync service started (every ${TierRoleSyncService.SYNC_INTERVAL_HOURS} hours)`);
  }

  static stopPeriodicSync(): void {
    if (TierRoleSyncService.syncInterval) {
      clearInterval(TierRoleSyncService.syncInterval);
      TierRoleSyncService.syncInterval = null;
      console.log("🛑 Tier role sync service stopped");
    }
  }
}

// Export the singleton instance
export const tierRoleManager = TierRoleManager.getInstance();