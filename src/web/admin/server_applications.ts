// src/web/admin/server_applications.ts - Admin interface for managing server applications
import { Router, Request, Response } from "express";
import { prisma } from "../../services/db.js";
import { getDiscordClient, fetchMultipleServernames, fetchMultipleUsernames } from "../../services/discord_users.js";
import { registerCommandsForApprovedGuilds } from "../../services/command_registry.js";
import { getCommandsJson } from "../../services/commands_def.js";

export const serverApplicationsRouter = Router();

// Get all server applications
serverApplicationsRouter.get("/server-applications", async (req: Request, res: Response) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;

    const where: any = {};
    if (status && typeof status === 'string') {
      where.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [applications, total] = await Promise.all([
      prisma.serverApplication.findMany({
        where,
        orderBy: { submittedAt: "desc" },
        skip,
        take: Number(limit)
      }),
      prisma.serverApplication.count({ where })
    ]);

    // Fetch Discord server and user names
    const client = getDiscordClient();
    let servernames = new Map<string, string>();
    let usernames = new Map<string, string>();

    if (client) {
      try {
        const guildIds = applications.map(app => app.guildId);
        const userIds = applications.map(app => app.applicantId);

        [servernames, usernames] = await Promise.all([
          fetchMultipleServernames(client, guildIds),
          fetchMultipleUsernames(client, userIds)
        ]);

        console.log(`Fetched ${servernames.size} server names and ${usernames.size} usernames for applications admin`);
      } catch (error) {
        console.error("Failed to fetch Discord names:", error);
      }
    }

    // Enrich applications with Discord names
    const enrichedApplications = applications.map(app => ({
      ...app,
      guildName: servernames.get(app.guildId) || app.guildName || `Server#${app.guildId.slice(-4)}`,
      applicantUsername: usernames.get(app.applicantId) || app.applicantTag || `User#${app.applicantId.slice(-4)}`
    }));

    res.json({
      ok: true,
      applications: enrichedApplications,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error("Error fetching server applications:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch server applications" });
  }
});

// Get a specific server application
serverApplicationsRouter.get("/server-applications/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ ok: false, error: "Invalid application ID" });
    }

    const application = await prisma.serverApplication.findUnique({
      where: { id }
    });

    if (!application) {
      return res.status(404).json({ ok: false, error: "Application not found" });
    }

    // Check if server is already approved
    const existingApproval = await prisma.approvedServer.findFirst({
      where: { guildId: application.guildId }
    });

    // Fetch Discord names
    const client = getDiscordClient();
    let guildName = application.guildName;
    let applicantUsername = application.applicantTag;

    if (client) {
      try {
        const [servernames, usernames] = await Promise.all([
          fetchMultipleServernames(client, [application.guildId]),
          fetchMultipleUsernames(client, [application.applicantId])
        ]);

        guildName = servernames.get(application.guildId) || guildName;
        applicantUsername = usernames.get(application.applicantId) || applicantUsername;
      } catch (error) {
        console.error("Failed to fetch Discord names:", error);
      }
    }

    res.json({
      ok: true,
      application: {
        ...application,
        guildName,
        applicantUsername,
        isAlreadyApproved: !!existingApproval?.enabled
      }
    });
  } catch (error) {
    console.error("Error fetching server application:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch server application" });
  }
});

// Approve a server application
serverApplicationsRouter.post("/server-applications/:id/approve", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ ok: false, error: "Invalid application ID" });
    }

    const { reviewNote, adminId } = req.body;

    // Get the application
    const application = await prisma.serverApplication.findUnique({
      where: { id }
    });

    if (!application) {
      return res.status(404).json({ ok: false, error: "Application not found" });
    }

    if (application.status !== 'PENDING') {
      return res.status(400).json({ ok: false, error: "Application has already been reviewed" });
    }

    // Check if server is already approved
    const existingApproval = await prisma.approvedServer.findFirst({
      where: { guildId: application.guildId }
    });

    // Use transaction to ensure consistency
    const result = await prisma.$transaction(async (tx) => {
      // Update application status
      const updatedApplication = await tx.serverApplication.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedBy: adminId || 'admin',
          reviewNote: reviewNote?.trim() || null,
          reviewedAt: new Date()
        }
      });

      // Create or update approved server entry
      if (!existingApproval) {
        await tx.approvedServer.create({
          data: {
            guildId: application.guildId,
            note: `Approved via application #${id}`,
            enabled: true
          }
        });
      } else if (!existingApproval.enabled) {
        await tx.approvedServer.update({
          where: { id: existingApproval.id },
          data: {
            enabled: true,
            note: `Re-enabled via application #${id}`
          }
        });
      }

      return updatedApplication;
    });

    // Register commands for the approved guild
    try {
      const cmds = getCommandsJson();
      await registerCommandsForApprovedGuilds(cmds);
      console.log(`Registered commands for newly approved guild: ${application.guildId}`);
    } catch (error) {
      console.error("Failed to register commands for approved guild:", error);
      // Don't fail the approval process if command registration fails
    }

    // Send notification webhook if configured
    try {
      const adminWebhook = process.env.ADMIN_WEBHOOK_URL;
      if (adminWebhook) {
        await fetch(adminWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'PIPTip Applications',
            content: `✅ **Application #${id} APPROVED**\n\n**Server:** ${application.guildName} (${application.guildId})\n**Reviewed by:** ${adminId || 'admin'}\n**Note:** ${reviewNote || 'No review note'}`
          })
        });
      }
    } catch (error) {
      console.error("Failed to send approval notification:", error);
    }

    res.json({ ok: true, application: result });
  } catch (error) {
    console.error("Error approving server application:", error);
    res.status(500).json({ ok: false, error: "Failed to approve application" });
  }
});

// Reject a server application
serverApplicationsRouter.post("/server-applications/:id/reject", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ ok: false, error: "Invalid application ID" });
    }

    const { rejectionReason, reviewNote, adminId } = req.body;

    if (!rejectionReason?.trim()) {
      return res.status(400).json({ ok: false, error: "Rejection reason is required" });
    }

    // Get the application
    const application = await prisma.serverApplication.findUnique({
      where: { id }
    });

    if (!application) {
      return res.status(404).json({ ok: false, error: "Application not found" });
    }

    if (application.status !== 'PENDING') {
      return res.status(400).json({ ok: false, error: "Application has already been reviewed" });
    }

    // Update application status
    const updatedApplication = await prisma.serverApplication.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedBy: adminId || 'admin',
        reviewNote: reviewNote?.trim() || null,
        rejectionReason: rejectionReason.trim(),
        reviewedAt: new Date()
      }
    });

    // Send notification webhook if configured
    try {
      const adminWebhook = process.env.ADMIN_WEBHOOK_URL;
      if (adminWebhook) {
        await fetch(adminWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'PIPTip Applications',
            content: `❌ **Application #${id} REJECTED**\n\n**Server:** ${application.guildName} (${application.guildId})\n**Reason:** ${rejectionReason}\n**Reviewed by:** ${adminId || 'admin'}`
          })
        });
      }
    } catch (error) {
      console.error("Failed to send rejection notification:", error);
    }

    res.json({ ok: true, application: updatedApplication });
  } catch (error) {
    console.error("Error rejecting server application:", error);
    res.status(500).json({ ok: false, error: "Failed to reject application" });
  }
});

// Delete a server application (admin cleanup)
serverApplicationsRouter.delete("/server-applications/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ ok: false, error: "Invalid application ID" });
    }

    await prisma.serverApplication.delete({
      where: { id }
    });

    res.json({ ok: true, message: "Application deleted successfully" });
  } catch (error: any) {
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, error: "Application not found" });
    }
    console.error("Error deleting server application:", error);
    res.status(500).json({ ok: false, error: "Failed to delete application" });
  }
});

// Get application statistics
serverApplicationsRouter.get("/server-applications-stats", async (_req: Request, res: Response) => {
  try {
    const stats = await prisma.serverApplication.groupBy({
      by: ['status'],
      _count: {
        id: true
      }
    });

    const total = await prisma.serverApplication.count();

    const recentApplications = await prisma.serverApplication.count({
      where: {
        submittedAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      }
    });

    const statusCounts = stats.reduce((acc, stat) => {
      acc[stat.status] = stat._count.id;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      ok: true,
      stats: {
        total,
        recent: recentApplications,
        pending: statusCounts.PENDING || 0,
        approved: statusCounts.APPROVED || 0,
        rejected: statusCounts.REJECTED || 0
      }
    });
  } catch (error) {
    console.error("Error fetching application stats:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch statistics" });
  }
});