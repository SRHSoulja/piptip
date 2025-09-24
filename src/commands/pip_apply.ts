// src/commands/pip_apply.ts - Server application system for new communities
import {
  MessageFlags,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { prisma } from "../services/db.js";

export default async function pipApply(i: ChatInputCommandInteraction) {
  try {
    // Must be used in a guild (server)
    if (!i.guildId) {
      return i.reply({
        content: [
          "❌ **Server Required**",
          "",
          "This command can only be used in a Discord server, not in DMs."
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }

    // Check if THIS server is already approved
    const currentServerApproval = await prisma.approvedServer.findFirst({
      where: { guildId: i.guildId }
    });

    // Note if current server is already approved (but still allow application for other servers)
    const applyingForCurrentServer = !currentServerApproval?.enabled;


    // Create application modal
    const modal = new ModalBuilder()
      .setCustomId(`pip:server_application:${i.guildId}`)
      .setTitle("PIPTip Server Application");

    // Server ID input (optional - defaults to current server)
    const serverIdInput = new TextInputBuilder()
      .setCustomId("target_guild_id")
      .setLabel("Server ID (Leave empty for current server)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(applyingForCurrentServer ? i.guildId! : "Enter Discord Server ID")
      .setValue(applyingForCurrentServer ? i.guildId! : "")
      .setRequired(false)
      .setMaxLength(25);

    // Contact information
    const contactInput = new TextInputBuilder()
      .setCustomId("contact_info")
      .setLabel("Contact Email (Optional)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("admin@yourserver.com")
      .setRequired(false)
      .setMaxLength(100);

    // Server description
    const descriptionInput = new TextInputBuilder()
      .setCustomId("description")
      .setLabel("Server Description")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Tell us about your server community, what it's focused on, etc.")
      .setRequired(true)
      .setMinLength(50)
      .setMaxLength(500);

    // Use case
    const useCaseInput = new TextInputBuilder()
      .setCustomId("use_case")
      .setLabel("How will you use PIPTip?")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Describe how your community plans to use PIPTip (tipping, gaming, rewards, etc.)")
      .setRequired(true)
      .setMinLength(30)
      .setMaxLength(400);

    // Add components to modal
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(serverIdInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(contactInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(useCaseInput)
    );

    // Show modal
    await i.showModal(modal);

  } catch (error: any) {
    console.error("Server application error:", error);
    await i.reply({
      content: `❌ **Error submitting application**\n${error?.message || String(error)}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }
}