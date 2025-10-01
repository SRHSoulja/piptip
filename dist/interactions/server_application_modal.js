import { MessageFlags, EmbedBuilder } from "discord.js";
import { prisma } from "../services/db.js";
async function handleServerApplicationModal(i) {
  try {
    const targetGuildId = i.fields.getTextInputValue("target_guild_id")?.trim() || i.guildId;
    const contactInfo = i.fields.getTextInputValue("contact_info") || null;
    const description = i.fields.getTextInputValue("description");
    const useCase = i.fields.getTextInputValue("use_case");
    if (!targetGuildId || !/^\d+$/.test(targetGuildId)) {
      return i.reply({
        content: "\u274C Invalid Server ID. Please provide a valid Discord server ID (numbers only).",
        flags: MessageFlags.Ephemeral
      });
    }
    const existingApproval = await prisma.approvedServer.findFirst({
      where: { guildId: targetGuildId }
    });
    if (existingApproval?.enabled) {
      return i.reply({
        content: [
          "\u2705 **Server Already Approved**",
          "",
          `Server ID ${targetGuildId} is already approved to use PIPTip!`,
          "",
          "No application needed - PIPTip is already active for that server."
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }
    const existingApplication = await prisma.serverApplication.findFirst({
      where: { guildId: targetGuildId }
    });
    if (existingApplication) {
      const statusEmoji = {
        "PENDING": "\u23F3",
        "APPROVED": "\u2705",
        "REJECTED": "\u274C"
      }[existingApplication.status] || "\u2753";
      return i.reply({
        content: [
          `${statusEmoji} **Application Already Exists**`,
          "",
          `An application for server ${targetGuildId} already exists.`,
          `**Status:** ${existingApplication.status}`,
          `**Submitted:** <t:${Math.floor(existingApplication.submittedAt.getTime() / 1e3)}:R>`,
          "",
          existingApplication.status === "REJECTED" ? `Rejection reason: ${existingApplication.rejectionReason || "No reason provided"}` : "Please wait for the review process to complete."
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }
    let targetGuildName = "Unknown Server";
    let memberCount = null;
    let isServerOwner = false;
    let applicantRoles = [];
    let applicantPermissions = [];
    if (targetGuildId === i.guildId && i.guild) {
      targetGuildName = i.guild.name;
      memberCount = i.guild.memberCount || null;
      const member = await i.guild.members.fetch(i.user.id).catch(() => null);
      if (member) {
        isServerOwner = member.id === i.guild.ownerId;
        applicantRoles = member.roles.cache.filter((role) => role.name !== "@everyone").map((role) => role.name).slice(0, 10);
        const perms = member.permissions;
        const keyPerms = [];
        if (perms.has("Administrator")) keyPerms.push("Administrator");
        if (perms.has("ManageGuild")) keyPerms.push("Manage Server");
        if (perms.has("ManageRoles")) keyPerms.push("Manage Roles");
        if (perms.has("ManageChannels")) keyPerms.push("Manage Channels");
        if (perms.has("ModerateMembers")) keyPerms.push("Moderate Members");
        applicantPermissions = keyPerms;
      }
    } else {
      try {
        const client = i.client;
        const targetGuild = await client.guilds.fetch(targetGuildId).catch(() => null);
        if (targetGuild) {
          targetGuildName = targetGuild.name;
          memberCount = targetGuild.memberCount || null;
          const targetMember = await targetGuild.members.fetch(i.user.id).catch(() => null);
          if (targetMember) {
            isServerOwner = targetMember.id === targetGuild.ownerId;
            applicantRoles = targetMember.roles.cache.filter((role) => role.name !== "@everyone").map((role) => role.name).slice(0, 10);
            const perms = targetMember.permissions;
            const keyPerms = [];
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
    const application = await prisma.serverApplication.create({
      data: {
        guildId: targetGuildId,
        guildName: targetGuildName,
        applicantId: i.user.id,
        applicantTag: `${i.user.username}${i.user.discriminator !== "0" ? `#${i.user.discriminator}` : ""}`,
        applicantRoles: applicantRoles.length > 0 ? JSON.stringify(applicantRoles) : null,
        applicantPermissions: applicantPermissions.length > 0 ? JSON.stringify(applicantPermissions) : null,
        isServerOwner,
        contactInfo,
        serverSize: memberCount,
        description,
        useCase,
        status: "PENDING"
      }
    });
    const confirmationEmbed = new EmbedBuilder().setTitle("\u{1F4DD} Application Submitted Successfully!").setDescription([
      `**Server:** ${targetGuildName} (${targetGuildId})`,
      `**Application ID:** #${application.id}`,
      isServerOwner ? "\u{1F511} **You are the server owner**" : "",
      "",
      "Your application has been submitted for review. Our team will evaluate your request and get back to you soon.",
      "",
      "**What happens next?**",
      "\u2022 Our team reviews your application",
      "\u2022 You'll be notified of the decision",
      "\u2022 If approved, PIPTip will be activated for your server",
      "",
      "Thank you for your interest in PIPTip! \u{1F427}\u{1F9CA}\u{1FAA8}"
    ].join("\n").replace(/\n\n+/g, "\n\n")).setColor(5793266).setThumbnail(i.guild?.iconURL() || null).setTimestamp().addFields(
      {
        name: "\u{1F4CB} Application Summary",
        value: [
          `**Server Size:** ${memberCount ? `${memberCount.toLocaleString()} members` : "Unknown"}`,
          `**Contact:** ${contactInfo || "Not provided"}`,
          `**Submitted by:** ${i.user.username}`
        ].join("\n"),
        inline: false
      }
    );
    await i.reply({
      embeds: [confirmationEmbed],
      flags: MessageFlags.Ephemeral
    });
    try {
      const adminWebhook = process.env.ADMIN_WEBHOOK_URL;
      if (adminWebhook) {
        const adminEmbed = new EmbedBuilder().setTitle("\u{1F195} New Server Application").setDescription([
          `**Server:** ${targetGuildName} (${targetGuildId})`,
          `**Applicant:** ${i.user.username} (${i.user.id})`,
          isServerOwner ? "\u{1F511} **Applicant is the SERVER OWNER**" : "",
          `**Application ID:** #${application.id}`,
          "",
          "**Server Description:**",
          description,
          "",
          "**Use Case:**",
          useCase
        ].join("\n")).setColor(16766720).setThumbnail(null).setTimestamp().addFields(
          {
            name: "\u{1F4CA} Details",
            value: [
              `**Members:** ${memberCount ? memberCount.toLocaleString() : "Unknown"}`,
              `**Contact:** ${contactInfo || "Not provided"}`,
              `**Status:** PENDING`,
              applicantPermissions.length > 0 ? `**Perms:** ${applicantPermissions.join(", ")}` : "",
              applicantRoles.length > 0 ? `**Roles:** ${applicantRoles.slice(0, 3).join(", ")}${applicantRoles.length > 3 ? ` +${applicantRoles.length - 3} more` : ""}` : ""
            ].filter(Boolean).join("\n"),
            inline: true
          },
          {
            name: "\u{1F517} Actions",
            value: [
              `[Review Application](/admin/server-applications?id=${application.id})`,
              `[Server Info](https://discord.com/channels/${targetGuildId})`,
              `[Applicant Profile](https://discord.com/users/${i.user.id})`
            ].join("\n"),
            inline: true
          }
        );
        const response = await fetch(adminWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "PIPTip Applications",
            avatar_url: "https://i.imgur.com/4M34hi2.png",
            // PIPTip logo
            embeds: [adminEmbed.toJSON()]
          })
        });
        if (!response.ok) {
          console.warn("Failed to send admin notification:", response.status, response.statusText);
        } else {
          console.log(`\u2705 Admin notification sent for application #${application.id}`);
        }
      } else {
        console.log(`\u{1F4DD} New server application #${application.id} - no admin webhook configured`);
      }
    } catch (error) {
      console.error("Error sending admin notification:", error);
    }
    console.log(`\u{1F4DD} Server application submitted: ${targetGuildName} (${targetGuildId}) by ${i.user.username} (${i.user.id})`);
  } catch (error) {
    console.error("Server application modal error:", error);
    if (error.code === "P2002" && error.meta?.target?.includes("guildId")) {
      return i.reply({
        content: [
          "\u274C **Application Already Exists**",
          "",
          "An application for this server has already been submitted.",
          "",
          "Please check the status of your existing application or contact support if you need assistance."
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }
    await i.reply({
      content: `\u274C **Error submitting application**
${error?.message || String(error)}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {
    });
  }
}
export {
  handleServerApplicationModal
};
//# sourceMappingURL=server_application_modal.js.map
