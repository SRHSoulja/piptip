import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { checkChannelPermissions, logChannelActivity } from "../services/channel_manager.js";
async function withChannelCheck(interaction, commandCategory, commandHandler) {
  const commandName = interaction.commandName;
  try {
    const permissionCheck = await checkChannelPermissions(interaction, commandCategory);
    if (!permissionCheck.allowed) {
      if (interaction.guildId && interaction.channelId) {
        await logChannelActivity(
          interaction.guildId,
          interaction.channelId,
          commandCategory,
          commandName,
          interaction.user.id,
          false
          // Command blocked
        );
      }
      let errorMessage = `\u{1F6AB} **${permissionCheck.reason}**

`;
      if (permissionCheck.suggestedChannels && permissionCheck.suggestedChannels.length > 0) {
        const channelMentions = permissionCheck.suggestedChannels.slice(0, 3).map((channelId) => `<#${channelId}>`).join(", ");
        errorMessage += `**Try using this command in:**
${channelMentions}`;
        if (permissionCheck.suggestedChannels.length > 3) {
          errorMessage += ` and ${permissionCheck.suggestedChannels.length - 3} other channel${permissionCheck.suggestedChannels.length - 3 > 1 ? "s" : ""}`;
        }
      } else {
        errorMessage += "Ask an administrator to configure channel permissions for PIPTip.";
      }
      const components = [];
      if (permissionCheck.suggestedChannels && permissionCheck.suggestedChannels.length > 0) {
        const firstChannel = permissionCheck.suggestedChannels[0];
        const actionRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`Go to suggested channel`).setURL(`https://discord.com/channels/${interaction.guildId}/${firstChannel}`).setEmoji("\u2197\uFE0F")
        );
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        if (member && (member.permissions.has("Administrator") || member.permissions.has("ManageGuild"))) {
          actionRow.addComponents(
            new ButtonBuilder().setCustomId("pip:open_settings").setLabel("Configure Settings").setStyle(ButtonStyle.Secondary).setEmoji("\u2699\uFE0F")
          );
        }
        components.push(actionRow);
      }
      await interaction.reply({
        content: errorMessage,
        components,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    await commandHandler(interaction);
    if (interaction.guildId && interaction.channelId) {
      await logChannelActivity(
        interaction.guildId,
        interaction.channelId,
        commandCategory,
        commandName,
        interaction.user.id,
        true
        // Command succeeded
      ).catch(() => {
      });
    }
  } catch (error) {
    console.error(`Channel check middleware error for ${commandName}:`, error);
    if (interaction.guildId && interaction.channelId) {
      await logChannelActivity(
        interaction.guildId,
        interaction.channelId,
        commandCategory,
        commandName,
        interaction.user.id,
        false
        // Command failed
      ).catch(() => {
      });
    }
    throw error;
  }
}
function getCommandCategory(commandName) {
  const categoryMap = {
    // Tip commands
    "pip_tip": "tip",
    // Game commands
    "pip_game": "game",
    // Profile/stats commands
    "pip_profile": "profile",
    "pip_stats": "profile",
    "pip_bio": "profile",
    "pip_leaderboard": "profile",
    "pip_achievements": "profile",
    "pip_pengubook": "profile",
    // Admin commands
    "pip_settings": "admin",
    "pip_apply": "admin",
    // General commands
    "pip_help": "general",
    "pip_withdraw": "general",
    "pip_deposit": "general",
    "pip_link": "general"
  };
  return categoryMap[commandName] || "general";
}
async function withAutoChannelCheck(interaction, commandHandler) {
  const category = getCommandCategory(interaction.commandName);
  return withChannelCheck(interaction, category, commandHandler);
}
export {
  getCommandCategory,
  withAutoChannelCheck,
  withChannelCheck
};
//# sourceMappingURL=channel_check.js.map
