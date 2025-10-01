import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { checkChannelPermissions, logChannelActivity } from "../services/channel_manager.js";
export async function withChannelCheck(interaction, commandCategory, commandHandler) {
    const commandName = interaction.commandName;
    try {
        // Defer the interaction IMMEDIATELY to prevent 3-second timeout
        // This must happen before any async operations (DB queries, etc.)
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        // Check channel permissions (may involve DB queries)
        const permissionCheck = await checkChannelPermissions(interaction, commandCategory);
        if (!permissionCheck.allowed) {
            // Log failed attempt
            if (interaction.guildId && interaction.channelId) {
                await logChannelActivity(interaction.guildId, interaction.channelId, commandCategory, commandName, interaction.user.id, false // Command blocked
                );
            }
            // Create helpful error message
            let errorMessage = `🚫 **${permissionCheck.reason}**\n\n`;
            if (permissionCheck.suggestedChannels && permissionCheck.suggestedChannels.length > 0) {
                // Get channel mentions for up to 3 suggested channels
                const channelMentions = permissionCheck.suggestedChannels
                    .slice(0, 3)
                    .map(channelId => `<#${channelId}>`)
                    .join(", ");
                errorMessage += `**Try using this command in:**\n${channelMentions}`;
                if (permissionCheck.suggestedChannels.length > 3) {
                    errorMessage += ` and ${permissionCheck.suggestedChannels.length - 3} other channel${permissionCheck.suggestedChannels.length - 3 > 1 ? 's' : ''}`;
                }
            }
            else {
                errorMessage += "Ask an administrator to configure channel permissions for PIPTip.";
            }
            // Add helpful buttons if we have suggested channels
            const components = [];
            if (permissionCheck.suggestedChannels && permissionCheck.suggestedChannels.length > 0) {
                const firstChannel = permissionCheck.suggestedChannels[0];
                const actionRow = new ActionRowBuilder()
                    .addComponents(new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel(`Go to suggested channel`)
                    .setURL(`https://discord.com/channels/${interaction.guildId}/${firstChannel}`)
                    .setEmoji("↗️"));
                // Add settings button for admins
                const member = interaction.guild?.members.cache.get(interaction.user.id);
                if (member && (member.permissions.has("Administrator") || member.permissions.has("ManageGuild"))) {
                    actionRow.addComponents(new ButtonBuilder()
                        .setCustomId("pip:open_settings")
                        .setLabel("Configure Settings")
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji("⚙️"));
                }
                components.push(actionRow);
            }
            await interaction.editReply({
                content: errorMessage,
                components
            });
            return;
        }
        // Channel permissions passed, execute the command
        await commandHandler(interaction);
        // Log successful command execution
        if (interaction.guildId && interaction.channelId) {
            await logChannelActivity(interaction.guildId, interaction.channelId, commandCategory, commandName, interaction.user.id, true // Command succeeded
            ).catch(() => { }); // Don't fail command if logging fails
        }
    }
    catch (error) {
        console.error(`Channel check middleware error for ${commandName}:`, error);
        // Log failed command attempt
        if (interaction.guildId && interaction.channelId) {
            await logChannelActivity(interaction.guildId, interaction.channelId, commandCategory, commandName, interaction.user.id, false // Command failed
            ).catch(() => { });
        }
        // Re-throw the error to be handled by the command's error handler
        throw error;
    }
}
// Helper function to get command category based on command name
export function getCommandCategory(commandName) {
    // Mapping of command names to categories
    const categoryMap = {
        // Tip commands
        'pip_tip': 'tip',
        // Game commands
        'pip_game': 'game',
        // Profile/stats commands
        'pip_profile': 'profile',
        'pip_stats': 'profile',
        'pip_bio': 'profile',
        'pip_leaderboard': 'profile',
        'pip_achievements': 'profile',
        'pip_pengubook': 'profile',
        // Admin commands
        'pip_settings': 'admin',
        'pip_apply': 'admin',
        // General commands
        'pip_help': 'general',
        'pip_withdraw': 'general',
        'pip_deposit': 'general',
        'pip_link': 'general'
    };
    return categoryMap[commandName] || 'general';
}
// Simplified wrapper that auto-detects command category
export async function withAutoChannelCheck(interaction, commandHandler) {
    const category = getCommandCategory(interaction.commandName);
    return withChannelCheck(interaction, category, commandHandler);
}
