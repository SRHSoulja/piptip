import { Router } from "express";
import { tierRoleManager } from "../../services/tier_role_manager.js";
import { membershipExpiryService } from "../../services/membership_expiry_service.js";
import { prisma } from "../../services/db.js";
const router = Router();
router.get("/status", async (req, res) => {
  try {
    const [
      membershipSummary,
      activeTiers,
      recentMemberships
    ] = await Promise.all([
      membershipExpiryService.getMembershipSummary(),
      prisma.tier.findMany({
        where: { active: true },
        include: {
          _count: {
            select: {
              memberships: {
                where: {
                  status: "ACTIVE",
                  expiresAt: { gt: /* @__PURE__ */ new Date() }
                }
              }
            }
          }
        }
      }),
      prisma.tierMembership.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { discordId: true } },
          tier: { select: { name: true } }
        }
      })
    ]);
    res.json({
      success: true,
      membershipSummary,
      activeTiers: activeTiers.map((tier) => ({
        id: tier.id,
        name: tier.name,
        activeMemberships: tier._count.memberships
      })),
      recentMemberships: recentMemberships.map((m) => ({
        id: m.id,
        discordId: m.user.discordId,
        tierName: m.tier.name,
        expiresAt: m.expiresAt,
        status: m.status,
        createdAt: m.createdAt
      }))
    });
  } catch (error) {
    console.error("Error fetching tier role status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch tier role status",
      details: String(error)
    });
  }
});
router.post("/sync", async (req, res) => {
  try {
    const results = await tierRoleManager.syncAllTierRoles();
    res.json({
      success: true,
      message: "Tier role sync completed",
      results
    });
  } catch (error) {
    console.error("Error syncing tier roles:", error);
    res.status(500).json({
      success: false,
      error: "Failed to sync tier roles",
      details: String(error)
    });
  }
});
router.post("/cleanup-expired", async (req, res) => {
  try {
    const results = await membershipExpiryService.manualCleanup();
    res.json({
      success: true,
      message: "Membership expiry cleanup completed",
      results
    });
  } catch (error) {
    console.error("Error cleaning up expired memberships:", error);
    res.status(500).json({
      success: false,
      error: "Failed to cleanup expired memberships",
      details: String(error)
    });
  }
});
router.post("/assign", async (req, res) => {
  try {
    const { discordId, tierId } = req.body;
    if (!discordId || !tierId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: discordId, tierId"
      });
    }
    const success = await tierRoleManager.assignTierRole(discordId, Number(tierId));
    res.json({
      success,
      message: success ? `Role assigned to ${discordId} for tier ${tierId}` : `Failed to assign role to ${discordId}`
    });
  } catch (error) {
    console.error("Error assigning tier role:", error);
    res.status(500).json({
      success: false,
      error: "Failed to assign tier role",
      details: String(error)
    });
  }
});
router.post("/remove", async (req, res) => {
  try {
    const { discordId, tierId } = req.body;
    if (!discordId || !tierId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: discordId, tierId"
      });
    }
    const success = await tierRoleManager.removeTierRole(discordId, Number(tierId));
    res.json({
      success,
      message: success ? `Role removed from ${discordId} for tier ${tierId}` : `Failed to remove role from ${discordId}`
    });
  } catch (error) {
    console.error("Error removing tier role:", error);
    res.status(500).json({
      success: false,
      error: "Failed to remove tier role",
      details: String(error)
    });
  }
});
router.get("/configuration", async (req, res) => {
  try {
    const { TierRoleManager } = await import("../../services/tier_role_manager.js");
    const template = TierRoleManager.getConfigurationTemplate();
    res.json({
      success: true,
      configurationTemplate: template,
      instructions: [
        "1. Copy the configuration template to your .env file",
        "2. Update YOUR_GUILD_ID_HERE with your Discord server's guild ID",
        "3. Update ROLE_ID_HERE values with the actual Discord role IDs",
        "4. Create Discord roles in your server if they don't exist",
        "5. Ensure the bot has permission to manage roles",
        "6. Test with /admin/tier-roles/sync endpoint"
      ]
    });
  } catch (error) {
    console.error("Error getting configuration:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get configuration template",
      details: String(error)
    });
  }
});
var tier_roles_default = router;
export {
  tier_roles_default as default
};
//# sourceMappingURL=tier_roles.js.map
