// src/services/membership_expiry_service.ts - Handle tier membership expiry and cleanup
import { prisma } from "./db.js";
import { tierRoleManager } from "./tier_role_manager.js";

export class MembershipExpiryService {
  private static instance: MembershipExpiryService;
  private static cleanupInterval: NodeJS.Timeout | null = null;
  private static readonly CLEANUP_INTERVAL_HOURS = 1; // Check every hour

  public static getInstance(): MembershipExpiryService {
    if (!MembershipExpiryService.instance) {
      MembershipExpiryService.instance = new MembershipExpiryService();
    }
    return MembershipExpiryService.instance;
  }

  /**
   * Process all expired memberships and update their status
   */
  async processExpiredMemberships(): Promise<{ processed: number; rolesRemoved: number; errors: number }> {
    const results = { processed: 0, rolesRemoved: 0, errors: 0 };

    try {
      // Find all active memberships that have expired
      const expiredMemberships = await prisma.tierMembership.findMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { lte: new Date() }
        },
        include: {
          user: { select: { discordId: true } },
          tier: { select: { name: true } }
        }
      });

      console.log(`🕒 Processing ${expiredMemberships.length} expired memberships`);

      for (const membership of expiredMemberships) {
        results.processed++;

        try {
          // Update membership status to EXPIRED
          await prisma.tierMembership.update({
            where: { id: membership.id },
            data: { status: 'EXPIRED' }
          });

          // Remove Discord role
          try {
            await tierRoleManager.onMembershipExpired(membership.user.discordId, membership.tierId);
            results.rolesRemoved++;
            console.log(`✅ Processed expired ${membership.tier.name} membership for user ${membership.user.discordId}`);
          } catch (roleError) {
            console.warn(`Failed to remove role for expired membership ${membership.id}:`, roleError);
            // Continue processing even if role removal fails
          }

        } catch (error) {
          console.error(`Failed to process expired membership ${membership.id}:`, error);
          results.errors++;
        }
      }

      if (results.processed > 0) {
        console.log(`📊 Membership expiry processing complete:`, results);
      }

      return results;

    } catch (error) {
      console.error("Failed to process expired memberships:", error);
      results.errors++;
      return results;
    }
  }

  /**
   * Get summary of membership status for admin dashboard
   */
  async getMembershipSummary(): Promise<{
    active: number;
    expired: number;
    expiringToday: number;
    expiringSoon: number; // next 7 days
  }> {
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const weekFromNow = new Date(now);
    weekFromNow.setDate(weekFromNow.getDate() + 7);

    const [active, expired, expiringToday, expiringSoon] = await Promise.all([
      prisma.tierMembership.count({
        where: {
          status: 'ACTIVE',
          expiresAt: { gt: now }
        }
      }),
      prisma.tierMembership.count({
        where: { status: 'EXPIRED' }
      }),
      prisma.tierMembership.count({
        where: {
          status: 'ACTIVE',
          expiresAt: {
            gte: now,
            lte: endOfToday
          }
        }
      }),
      prisma.tierMembership.count({
        where: {
          status: 'ACTIVE',
          expiresAt: {
            gte: now,
            lte: weekFromNow
          }
        }
      })
    ]);

    return { active, expired, expiringToday, expiringSoon };
  }

  /**
   * Start periodic membership expiry cleanup
   */
  static startPeriodicCleanup(): void {
    if (MembershipExpiryService.cleanupInterval) {
      console.log("Membership expiry service already running");
      return;
    }

    const intervalMs = MembershipExpiryService.CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;

    // Run initial cleanup after 2 minutes
    setTimeout(() => {
      MembershipExpiryService.getInstance().processExpiredMemberships();
    }, 2 * 60 * 1000);

    // Set up periodic cleanup
    MembershipExpiryService.cleanupInterval = setInterval(() => {
      console.log("🧹 Starting scheduled membership expiry cleanup");
      MembershipExpiryService.getInstance().processExpiredMemberships();
    }, intervalMs);

    console.log(`✅ Membership expiry service started (every ${MembershipExpiryService.CLEANUP_INTERVAL_HOURS} hour)`);
  }

  /**
   * Stop periodic cleanup
   */
  static stopPeriodicCleanup(): void {
    if (MembershipExpiryService.cleanupInterval) {
      clearInterval(MembershipExpiryService.cleanupInterval);
      MembershipExpiryService.cleanupInterval = null;
      console.log("🛑 Membership expiry service stopped");
    }
  }

  /**
   * Manual trigger for immediate cleanup (for admin use)
   */
  async manualCleanup(): Promise<{ processed: number; rolesRemoved: number; errors: number }> {
    console.log("🔧 Manual membership expiry cleanup triggered");
    return await this.processExpiredMemberships();
  }
}

// Export the singleton instance
export const membershipExpiryService = MembershipExpiryService.getInstance();