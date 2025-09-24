// src/interactions/server_application_modal.ts - Handle server application modal submissions
import type { ModalSubmitInteraction } from "discord.js";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { prisma } from "../services/db.js";

export async function handleServerApplicationModal(i: ModalSubmitInteraction) {
  try {
    // Extract form data
    const targetGuildId = i.fields.getTextInputValue('target_guild_id')?.trim() || i.guildId;
    const contactInfo = i.fields.getTextInputValue('contact_info') || null;
    const description = i.fields.getTextInputValue('description');
    const useCase = i.fields.getTextInputValue('use_case');

    // Validate guild ID format
    if (!targetGuildId || !/^\d+$/.test(targetGuildId)) {
      return i.reply({
        content: "❌ Invalid Server ID. Please provide a valid Discord server ID (numbers only).",
        flags: MessageFlags.Ephemeral
      });
    }

    // Check if target server is already approved
    const existingApproval = await prisma.approvedServer.findFirst({
      where: { guildId: targetGuildId }
    });

    if (existingApproval?.enabled) {
      return i.reply({
        content: [
          "✅ **Server Already Approved**",
          "",
          `Server ID ${targetGuildId} is already approved to use PIPTip!`,
          "",
          "No application needed - PIPTip is already active for that server."
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }

    // Check for existing application for target server
    const existingApplication = await prisma.serverApplication.findFirst({
      where: { guildId: targetGuildId }
    });

    if (existingApplication) {
      const statusEmoji = {
        'PENDING': '⏳',
        'APPROVED': '✅',
        'REJECTED': '❌'
      }[existingApplication.status] || '❓';

      return i.reply({
        content: [
          `${statusEmoji} **Application Already Exists**`,
          "",
          `An application for server ${targetGuildId} already exists.`,
          `**Status:** ${existingApplication.status}`,
          `**Submitted:** <t:${Math.floor(existingApplication.submittedAt.getTime() / 1000)}:R>`,
          "",
          existingApplication.status === 'REJECTED'
            ? `Rejection reason: ${existingApplication.rejectionReason || 'No reason provided'}`
            : "Please wait for the review process to complete."
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }

    // Try to get target server information if bot is in that server
    let targetGuildName = "Unknown Server";
    let memberCount: number | null = null;
    let isServerOwner = false;
    let applicantRoles: string[] = [];
    let applicantPermissions: string[] = [];

    // If applying for current server, we have full information
    if (targetGuildId === i.guildId && i.guild) {
      targetGuildName = i.guild.name;
      memberCount = i.guild.memberCount || null;

      // Get member details in current server
      const member = await i.guild.members.fetch(i.user.id).catch(() => null);
      if (member) {
        isServerOwner = member.id === i.guild.ownerId;

        // Get role names (excluding @everyone)
        applicantRoles = member.roles.cache
          .filter(role => role.name !== '@everyone')
          .map(role => role.name)
          .slice(0, 10); // Limit to first 10 roles

        // Get key permissions
        const perms = member.permissions;
        const keyPerms: string[] = [];
        if (perms.has("Administrator")) keyPerms.push("Administrator");
        if (perms.has("ManageGuild")) keyPerms.push("Manage Server");
        if (perms.has("ManageRoles")) keyPerms.push("Manage Roles");
        if (perms.has("ManageChannels")) keyPerms.push("Manage Channels");
        if (perms.has("ModerateMembers")) keyPerms.push("Moderate Members");
        applicantPermissions = keyPerms;
      }
    } else {
      // Try to fetch target server if bot is in it
      try {
        const client = i.client;
        const targetGuild = await client.guilds.fetch(targetGuildId).catch(() => null);
        if (targetGuild) {
          targetGuildName = targetGuild.name;
          memberCount = targetGuild.memberCount || null;

          // Try to get applicant's member info in target server
          const targetMember = await targetGuild.members.fetch(i.user.id).catch(() => null);
          if (targetMember) {
            isServerOwner = targetMember.id === targetGuild.ownerId;

            applicantRoles = targetMember.roles.cache
              .filter(role => role.name !== '@everyone')
              .map(role => role.name)
              .slice(0, 10);

            const perms = targetMember.permissions;
            const keyPerms: string[] = [];
            if (perms.has("Administrator")) keyPerms.push("Administrator");
            if (perms.has("ManageGuild")) keyPerms.push("Manage Server");
            if (perms.has("ManageRoles")) keyPerms.push("Manage Roles");
            if (perms.has("ManageChannels")) keyPerms.push("Manage Channels");
            if (perms.has("ModerateMembers")) keyPerms.push("Moderate Members");
            applicantPermissions = keyPerms;
          }
        }
      } catch (error) {
        console.log(`Could not fetch target server ${targetGuildId} - bot may not be in that server`);
      }
    }

    // Create application record with enhanced information
    const application = await prisma.serverApplication.create({
      data: {
        guildId: targetGuildId,
        guildName: targetGuildName,
        applicantId: i.user.id,
        applicantTag: `${i.user.username}${i.user.discriminator !== '0' ? `#${i.user.discriminator}` : ''}`,
        applicantRoles: applicantRoles.length > 0 ? JSON.stringify(applicantRoles) : null,
        applicantPermissions: applicantPermissions.length > 0 ? JSON.stringify(applicantPermissions) : null,
        isServerOwner: isServerOwner,
        contactInfo: contactInfo,
        serverSize: memberCount,
        description: description,
        useCase: useCase,
        status: 'PENDING'
      }
    });

    // Send confirmation to user
    const confirmationEmbed = new EmbedBuilder()
      .setTitle("📝 Application Submitted Successfully!")
      .setDescription([
        `**Server:** ${targetGuildName} (${targetGuildId})`,
        `**Application ID:** #${application.id}`,
        isServerOwner ? "🔑 **You are the server owner**" : "",
        "",
        "Your application has been submitted for review. Our team will evaluate your request and get back to you soon.",
        "",
        "**What happens next?**",
        "• Our team reviews your application",
        "• You'll be notified of the decision",
        "• If approved, PIPTip will be activated for your server",
        "",
        "Thank you for your interest in PIPTip! 🐧🧊🪨"
      ].join("\n").replace(/\n\n+/g, "\n\n")) // Clean up double empty lines
      .setColor(0x5865F2)
      .setThumbnail(i.guild?.iconURL() || null)
      .setTimestamp()
      .addFields(
        {
          name: "📋 Application Summary",
          value: [
            `**Server Size:** ${memberCount ? `${memberCount.toLocaleString()} members` : 'Unknown'}`,
            `**Contact:** ${contactInfo || 'Not provided'}`,
            `**Submitted by:** ${i.user.username}`
          ].join("\n"),
          inline: false
        }
      );

    await i.reply({
      embeds: [confirmationEmbed],
      flags: MessageFlags.Ephemeral
    });

    // Send notification to admin channel/webhook if configured
    try {
      // Get admin webhook URL from environment
      const adminWebhook = process.env.ADMIN_WEBHOOK_URL;
      if (adminWebhook) {
        const adminEmbed = new EmbedBuilder()
          .setTitle("🆕 New Server Application")
          .setDescription([
            `**Server:** ${targetGuildName} (${targetGuildId})`,
            `**Applicant:** ${i.user.username} (${i.user.id})`,
            isServerOwner ? "🔑 **Applicant is the SERVER OWNER**" : "",
            `**Application ID:** #${application.id}`,
            "",
            "**Server Description:**",
            description,
            "",
            "**Use Case:**",
            useCase
          ].join("\n"))
          .setColor(0xFFD700)
          .setThumbnail(null) // Can't get target guild icon reliably
          .setTimestamp()
          .addFields(
            {
              name: "📊 Details",
              value: [
                `**Members:** ${memberCount ? memberCount.toLocaleString() : 'Unknown'}`,
                `**Contact:** ${contactInfo || 'Not provided'}`,
                `**Status:** PENDING`,
                applicantPermissions.length > 0 ? `**Perms:** ${applicantPermissions.join(", ")}` : "",
                applicantRoles.length > 0 ? `**Roles:** ${applicantRoles.slice(0, 3).join(", ")}${applicantRoles.length > 3 ? ` +${applicantRoles.length - 3} more` : ""}` : ""
              ].filter(Boolean).join("\n"),
              inline: true
            },
            {
              name: "🔗 Actions",
              value: [
                `[Review Application](/admin/server-applications?id=${application.id})`,
                `[Server Info](https://discord.com/channels/${targetGuildId})`,
                `[Applicant Profile](https://discord.com/users/${i.user.id})`
              ].join("\n"),
              inline: true
            }
          );

        // Send to admin webhook
        const response = await fetch(adminWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'PIPTip Applications',
            avatar_url: 'https://i.imgur.com/4M34hi2.png', // PIPTip logo
            embeds: [adminEmbed.toJSON()]
          })
        });

        if (!response.ok) {
          console.warn("Failed to send admin notification:", response.status, response.statusText);
        } else {
          console.log(`✅ Admin notification sent for application #${application.id}`);
        }
      } else {
        console.log(`📝 New server application #${application.id} - no admin webhook configured`);
      }
    } catch (error) {
      console.error("Error sending admin notification:", error);
      // Don't fail the user interaction if admin notification fails
    }

    console.log(`📝 Server application submitted: ${targetGuildName} (${targetGuildId}) by ${i.user.username} (${i.user.id})`);

  } catch (error: any) {
    console.error("Server application modal error:", error);

    // Handle unique constraint violation (duplicate application)
    if ((error as any).code === 'P2002' && (error as any).meta?.target?.includes('guildId')) {
      return i.reply({
        content: [
          "❌ **Application Already Exists**",
          "",
          "An application for this server has already been submitted.",
          "",
          "Please check the status of your existing application or contact support if you need assistance."
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }

    await i.reply({
      content: `❌ **Error submitting application**\n${error?.message || String(error)}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }
}