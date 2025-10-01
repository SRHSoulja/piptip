import {
  MessageFlags,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { prisma } from "../services/db.js";
async function pipApply(i) {
  try {
    if (!i.guildId) {
      return i.reply({
        content: [
          "\u274C **Server Required**",
          "",
          "This command can only be used in a Discord server, not in DMs."
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }
    const currentServerApproval = await prisma.approvedServer.findFirst({
      where: { guildId: i.guildId }
    });
    const applyingForCurrentServer = !currentServerApproval?.enabled;
    const modal = new ModalBuilder().setCustomId(`pip:server_application:${i.guildId}`).setTitle("PIPTip Server Application");
    const serverIdInput = new TextInputBuilder().setCustomId("target_guild_id").setLabel("Server ID (Leave empty for current server)").setStyle(TextInputStyle.Short).setPlaceholder(applyingForCurrentServer ? i.guildId : "Enter Discord Server ID").setValue(applyingForCurrentServer ? i.guildId : "").setRequired(false).setMaxLength(25);
    const contactInput = new TextInputBuilder().setCustomId("contact_info").setLabel("Contact Email (Optional)").setStyle(TextInputStyle.Short).setPlaceholder("admin@yourserver.com").setRequired(false).setMaxLength(100);
    const descriptionInput = new TextInputBuilder().setCustomId("description").setLabel("Server Description").setStyle(TextInputStyle.Paragraph).setPlaceholder("Tell us about your server community, what it's focused on, etc.").setRequired(true).setMinLength(50).setMaxLength(500);
    const useCaseInput = new TextInputBuilder().setCustomId("use_case").setLabel("How will you use PIPTip?").setStyle(TextInputStyle.Paragraph).setPlaceholder("Describe how your community plans to use PIPTip (tipping, gaming, rewards, etc.)").setRequired(true).setMinLength(30).setMaxLength(400);
    modal.addComponents(
      new ActionRowBuilder().addComponents(serverIdInput),
      new ActionRowBuilder().addComponents(contactInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(useCaseInput)
    );
    await i.showModal(modal);
  } catch (error) {
    console.error("Server application error:", error);
    await i.reply({
      content: `\u274C **Error submitting application**
${error?.message || String(error)}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {
    });
  }
}
export {
  pipApply as default
};
//# sourceMappingURL=pip_apply.js.map
