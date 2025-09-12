// src/discord/guards.ts - Type guards for Discord interactions

import type { 
  Interaction, 
  ButtonInteraction, 
  ModalSubmitInteraction, 
  StringSelectMenuInteraction,
  CacheType 
} from 'discord.js';

/**
 * Type guard to narrow Interaction to ButtonInteraction
 */
export function isButtonInteraction(interaction: Interaction): interaction is ButtonInteraction<CacheType> {
  return interaction.isButton();
}

/**
 * Type guard to narrow Interaction to ModalSubmitInteraction
 */
export function isModalSubmitInteraction(interaction: Interaction): interaction is ModalSubmitInteraction<CacheType> {
  return interaction.isModalSubmit();
}

/**
 * Type guard to narrow Interaction to StringSelectMenuInteraction
 */
export function isStringSelectMenuInteraction(interaction: Interaction): interaction is StringSelectMenuInteraction<CacheType> {
  return interaction.isStringSelectMenu();
}

/**
 * Type guard helper for handling different interaction types in one function
 */
export function handleInteractionByType<T>(
  interaction: Interaction,
  handlers: {
    button?: (interaction: ButtonInteraction<CacheType>) => T;
    modal?: (interaction: ModalSubmitInteraction<CacheType>) => T;
    selectMenu?: (interaction: StringSelectMenuInteraction<CacheType>) => T;
  }
): T | null {
  if (isButtonInteraction(interaction) && handlers.button) {
    return handlers.button(interaction);
  }
  
  if (isModalSubmitInteraction(interaction) && handlers.modal) {
    return handlers.modal(interaction);
  }
  
  if (isStringSelectMenuInteraction(interaction) && handlers.selectMenu) {
    return handlers.selectMenu(interaction);
  }
  
  return null;
}