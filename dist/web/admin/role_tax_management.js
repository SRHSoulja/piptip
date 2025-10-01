import { Router } from "express";
import { prisma } from "../../services/db.js";
import { RoleTaxBenefitService } from "../../services/role_tax_benefits.js";
import { RoleAnalyticsService } from "../../services/role_analytics.js";
import { getDiscordClient } from "../../services/discord_users.js";
const router = Router();
router.get("/", async (req, res) => {
  try {
    const { guildId } = req.query;
    const exemptions = await RoleTaxBenefitService.getAllActiveExemptions(
      guildId
    );
    const enrichedExemptions = await Promise.all(
      exemptions.map(async (exemption) => {
        try {
          const discord = getDiscordClient();
          const guild = await discord?.guilds.fetch(exemption.guildId);
          const role = await guild?.roles.fetch(exemption.roleId);
          return {
            ...exemption,
            roleName: role?.name || "Unknown Role",
            guildName: guild?.name || "Unknown Server",
            memberCount: role?.members.size || 0
          };
        } catch {
          return {
            ...exemption,
            roleName: "Role Not Found",
            guildName: "Server Not Found",
            memberCount: 0
          };
        }
      })
    );
    res.json({
      success: true,
      exemptions: enrichedExemptions,
      total: exemptions.length
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch role tax exemptions",
      details: String(error)
    });
  }
});
router.post("/", async (req, res) => {
  try {
    const {
      roleId,
      guildId,
      exemptionRate,
      duration,
      label,
      notes
    } = req.body;
    const errors = [];
    if (!roleId || !/^\d{17,20}$/.test(roleId)) {
      errors.push("Valid Discord role ID required");
    }
    if (!guildId || !/^\d{17,20}$/.test(guildId)) {
      errors.push("Valid Discord guild ID required");
    }
    if (!exemptionRate || exemptionRate < 0 || exemptionRate > 100) {
      errors.push("Exemption rate must be 0-100%");
    }
    if (!label || label.length < 3 || label.length > 50) {
      errors.push("Label must be 3-50 characters");
    }
    if (duration && (duration < 1 || duration > 365)) {
      errors.push("Duration must be 1-365 days");
    }
    if (errors.length > 0) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors
      });
    }
    try {
      const discord = getDiscordClient();
      const guild = await discord?.guilds.fetch(guildId);
      if (!guild) {
        return res.status(400).json({
          error: "Discord server not found or bot not in server"
        });
      }
      const role = await guild.roles.fetch(roleId);
      if (!role) {
        return res.status(400).json({
          error: "Discord role not found in server"
        });
      }
      await RoleTaxBenefitService.createRoleTaxExemption({
        roleId,
        guildId,
        exemptionRate: Number(exemptionRate),
        duration: duration ? Number(duration) : void 0,
        label,
        createdBy: "admin",
        // TODO: Get from JWT or session
        notes
      });
      res.json({
        success: true,
        message: `Tax exemption created for role "${role.name}" in server "${guild.name}"`,
        exemption: {
          roleId,
          guildId,
          roleName: role.name,
          guildName: guild.name,
          exemptionRate,
          duration,
          label,
          memberCount: role.members.size
        }
      });
    } catch (discordError) {
      return res.status(400).json({
        error: "Discord verification failed",
        details: String(discordError)
      });
    }
  } catch (error) {
    res.status(500).json({
      error: "Failed to create role tax exemption",
      details: String(error)
    });
  }
});
router.delete("/:id", async (req, res) => {
  try {
    const exemptionId = parseInt(req.params.id);
    if (isNaN(exemptionId)) {
      return res.status(400).json({ error: "Invalid exemption ID" });
    }
    const exemption = await prisma.roleTaxExemption.findUnique({
      where: { id: exemptionId }
    });
    if (!exemption) {
      return res.status(404).json({ error: "Role tax exemption not found" });
    }
    await prisma.roleTaxExemption.update({
      where: { id: exemptionId },
      data: { isActive: false }
    });
    res.json({
      success: true,
      message: `Role tax exemption for "${exemption.label}" has been deactivated`
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to remove role tax exemption",
      details: String(error)
    });
  }
});
router.put("/:id", async (req, res) => {
  try {
    const exemptionId = parseInt(req.params.id);
    const { exemptionRate, duration, label, notes, isActive } = req.body;
    if (isNaN(exemptionId)) {
      return res.status(400).json({ error: "Invalid exemption ID" });
    }
    const exemption = await prisma.roleTaxExemption.findUnique({
      where: { id: exemptionId }
    });
    if (!exemption) {
      return res.status(404).json({ error: "Role tax exemption not found" });
    }
    const expiresAt = duration ? new Date(Date.now() + duration * 24 * 60 * 60 * 1e3) : null;
    const updated = await prisma.roleTaxExemption.update({
      where: { id: exemptionId },
      data: {
        ...exemptionRate !== void 0 && { exemptionRate: Number(exemptionRate) },
        ...duration !== void 0 && { duration: Number(duration), expiresAt },
        ...label !== void 0 && { label },
        ...notes !== void 0 && { notes },
        ...isActive !== void 0 && { isActive: Boolean(isActive) }
      }
    });
    res.json({
      success: true,
      message: "Role tax exemption updated successfully",
      exemption: updated
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to update role tax exemption",
      details: String(error)
    });
  }
});
router.get("/preview/:guildId/:roleId", async (req, res) => {
  try {
    const { guildId, roleId } = req.params;
    const discord = getDiscordClient();
    if (!discord) {
      return res.status(500).json({ error: "Discord client not available" });
    }
    const guild = await discord.guilds.fetch(guildId);
    if (!guild) {
      return res.status(404).json({ error: "Discord server not found" });
    }
    const role = await guild.roles.fetch(roleId);
    if (!role) {
      return res.status(404).json({ error: "Discord role not found" });
    }
    const existingExemption = await prisma.roleTaxExemption.findUnique({
      where: { roleId_guildId: { roleId, guildId } }
    });
    res.json({
      success: true,
      preview: {
        roleName: role.name,
        roleColor: role.hexColor,
        guildName: guild.name,
        memberCount: role.members.size,
        position: role.position,
        isManaged: role.managed,
        existingExemption: existingExemption ? {
          exemptionRate: existingExemption.exemptionRate,
          label: existingExemption.label,
          isActive: existingExemption.isActive
        } : null
      }
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to preview role",
      details: String(error)
    });
  }
});
router.get("/stats", async (req, res) => {
  try {
    const stats = await prisma.roleTaxExemption.groupBy({
      by: ["guildId"],
      where: { isActive: true },
      _count: { id: true },
      _avg: { exemptionRate: true }
    });
    const totalActive = await prisma.roleTaxExemption.count({
      where: { isActive: true }
    });
    const recentlyCreated = await prisma.roleTaxExemption.count({
      where: {
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3) }
      }
    });
    res.json({
      success: true,
      stats: {
        totalActive,
        recentlyCreated,
        guildBreakdown: stats,
        uniqueGuilds: stats.length
      }
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to get role tax statistics",
      details: String(error)
    });
  }
});
router.get("/analytics/:guildId/:roleId", async (req, res) => {
  try {
    const { guildId, roleId } = req.params;
    const { days = "30" } = req.query;
    const report = await RoleAnalyticsService.getPartnershipReport(
      roleId,
      guildId,
      parseInt(days)
    );
    res.json({
      success: true,
      report,
      period: `${days} days`
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to generate partnership analytics",
      details: String(error)
    });
  }
});
router.post("/analytics/generate", async (req, res) => {
  try {
    const { date, roleId, guildId } = req.body;
    let processed = 0;
    if (roleId && guildId) {
      await RoleAnalyticsService.generateDailyAnalytics(
        roleId,
        guildId,
        date ? new Date(date) : /* @__PURE__ */ new Date()
      );
      processed = 1;
    } else {
      processed = await RoleAnalyticsService.generateAllRoleAnalytics(
        date ? new Date(date) : /* @__PURE__ */ new Date()
      );
    }
    res.json({
      success: true,
      message: `Generated analytics for ${processed} role exemption${processed !== 1 ? "s" : ""}`,
      processed
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to generate role analytics",
      details: String(error)
    });
  }
});
var role_tax_management_default = router;
export {
  role_tax_management_default as default
};
//# sourceMappingURL=role_tax_management.js.map
