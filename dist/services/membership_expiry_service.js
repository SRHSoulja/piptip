import { prisma } from "./db.js";
import { tierRoleManager } from "./tier_role_manager.js";
class MembershipExpiryService {
  static instance;
  static cleanupInterval = null;
  static CLEANUP_INTERVAL_HOURS = 1;
  // Check every hour
  static getInstance() {
    if (!MembershipExpiryService.instance) {
      MembershipExpiryService.instance = new MembershipExpiryService();
    }
    return MembershipExpiryService.instance;
  }
  /**
   * Process all expired memberships and update their status
   */
  async processExpiredMemberships() {
    const results = { processed: 0, rolesRemoved: 0, errors: 0 };
    try {
      const expiredMemberships = await prisma.tierMembership.findMany({
        where: {
          status: "ACTIVE",
          expiresAt: { lte: /* @__PURE__ */ new Date() }
        },
        include: {
          user: { select: { discordId: true } },
          tier: { select: { name: true } }
        }
      });
      console.log(`\u{1F552} Processing ${expiredMemberships.length} expired memberships`);
      for (const membership of expiredMemberships) {
        results.processed++;
        try {
          await prisma.tierMembership.update({
            where: { id: membership.id },
            data: { status: "EXPIRED" }
          });
          try {
            await tierRoleManager.onMembershipExpired(membership.user.discordId, membership.tierId);
            results.rolesRemoved++;
            console.log(`\u2705 Processed expired ${membership.tier.name} membership for user ${membership.user.discordId}`);
          } catch (roleError) {
            console.warn(`Failed to remove role for expired membership ${membership.id}:`, roleError);
          }
        } catch (error) {
          console.error(`Failed to process expired membership ${membership.id}:`, error);
          results.errors++;
        }
      }
      if (results.processed > 0) {
        console.log(`\u{1F4CA} Membership expiry processing complete:`, results);
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
  async getMembershipSummary() {
    const now = /* @__PURE__ */ new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const weekFromNow = new Date(now);
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    const [active, expired, expiringToday, expiringSoon] = await Promise.all([
      prisma.tierMembership.count({
        where: {
          status: "ACTIVE",
          expiresAt: { gt: now }
        }
      }),
      prisma.tierMembership.count({
        where: { status: "EXPIRED" }
      }),
      prisma.tierMembership.count({
        where: {
          status: "ACTIVE",
          expiresAt: {
            gte: now,
            lte: endOfToday
          }
        }
      }),
      prisma.tierMembership.count({
        where: {
          status: "ACTIVE",
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
  static startPeriodicCleanup() {
    if (MembershipExpiryService.cleanupInterval) {
      console.log("Membership expiry service already running");
      return;
    }
    const intervalMs = MembershipExpiryService.CLEANUP_INTERVAL_HOURS * 60 * 60 * 1e3;
    setTimeout(() => {
      MembershipExpiryService.getInstance().processExpiredMemberships();
    }, 2 * 60 * 1e3);
    MembershipExpiryService.cleanupInterval = setInterval(() => {
      console.log("\u{1F9F9} Starting scheduled membership expiry cleanup");
      MembershipExpiryService.getInstance().processExpiredMemberships();
    }, intervalMs);
    console.log(`\u2705 Membership expiry service started (every ${MembershipExpiryService.CLEANUP_INTERVAL_HOURS} hour)`);
  }
  /**
   * Stop periodic cleanup
   */
  static stopPeriodicCleanup() {
    if (MembershipExpiryService.cleanupInterval) {
      clearInterval(MembershipExpiryService.cleanupInterval);
      MembershipExpiryService.cleanupInterval = null;
      console.log("\u{1F6D1} Membership expiry service stopped");
    }
  }
  /**
   * Manual trigger for immediate cleanup (for admin use)
   */
  async manualCleanup() {
    console.log("\u{1F527} Manual membership expiry cleanup triggered");
    return await this.processExpiredMemberships();
  }
}
const membershipExpiryService = MembershipExpiryService.getInstance();
export {
  MembershipExpiryService,
  membershipExpiryService
};
//# sourceMappingURL=membership_expiry_service.js.map
