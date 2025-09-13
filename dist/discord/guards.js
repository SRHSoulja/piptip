// src/discord/guards.ts - Type guards for Discord interactions
/**
 * Type guard to narrow Interaction to ButtonInteraction
 */
export function isButtonInteraction(interaction) {
    return interaction.isButton();
}
/**
 * Type guard to narrow Interaction to ModalSubmitInteraction
 */
export function isModalSubmitInteraction(interaction) {
    return interaction.isModalSubmit();
}
/**
 * Type guard to narrow Interaction to StringSelectMenuInteraction
 */
export function isStringSelectMenuInteraction(interaction) {
    return interaction.isStringSelectMenu();
}
/**
 * Type guard helper for handling different interaction types in one function
 */
export function handleInteractionByType(interaction, handlers) {
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
