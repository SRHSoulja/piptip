// src/utils/safe_reply.ts - Safe interaction reply helper
import type { ChatInputCommandInteraction, InteractionReplyOptions, InteractionEditReplyOptions } from 'discord.js';

/**
 * Safely reply to an interaction, automatically choosing between reply() and editReply()
 * based on whether the interaction has already been acknowledged/deferred.
 *
 * This prevents "Interaction has already been acknowledged" errors when middleware
 * has already called deferReply().
 *
 * @param interaction - The Discord interaction
 * @param options - Reply options
 * @returns Promise that resolves when the reply is sent
 */
export async function safeReply(
  interaction: ChatInputCommandInteraction,
  options: InteractionReplyOptions | string
): Promise<void> {
  // Normalize options to object format
  const replyOptions: InteractionReplyOptions = typeof options === 'string'
    ? { content: options }
    : options;

  try {
    // Check if interaction has already been deferred or replied to
    if (interaction.deferred || interaction.replied) {
      // Use editReply for deferred/replied interactions
      await interaction.editReply(replyOptions as InteractionEditReplyOptions);
    } else {
      // Use reply for fresh interactions
      await interaction.reply(replyOptions);
    }
  } catch (error: any) {
    // Handle edge cases where Discord state doesn't match our expectation
    if (error.code === 40060) {
      // "Interaction has already been acknowledged" - try editReply as fallback
      console.warn(`safeReply: Interaction already acknowledged, falling back to editReply for ${interaction.commandName}`);
      try {
        await interaction.editReply(replyOptions as InteractionEditReplyOptions);
      } catch (editError) {
        console.error(`safeReply: Both reply and editReply failed for ${interaction.commandName}:`, editError);
        throw editError;
      }
    } else {
      // Re-throw other errors
      throw error;
    }
  }
}

/**
 * Safely defer an interaction reply if it hasn't been deferred/replied already
 *
 * @param interaction - The Discord interaction
 * @param options - Optional defer options (e.g., ephemeral flag)
 */
export async function safeDeferReply(
  interaction: ChatInputCommandInteraction,
  options?: { ephemeral?: boolean; fetchReply?: boolean }
): Promise<void> {
  try {
    // Only defer if not already deferred or replied
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply(options);
    }
  } catch (error: any) {
    // Silently ignore if already acknowledged
    if (error.code !== 40060) {
      throw error;
    }
  }
}
