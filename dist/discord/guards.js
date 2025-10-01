function isButtonInteraction(interaction) {
  return interaction.isButton();
}
function isModalSubmitInteraction(interaction) {
  return interaction.isModalSubmit();
}
function isStringSelectMenuInteraction(interaction) {
  return interaction.isStringSelectMenu();
}
function handleInteractionByType(interaction, handlers) {
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
export {
  handleInteractionByType,
  isButtonInteraction,
  isModalSubmitInteraction,
  isStringSelectMenuInteraction
};
//# sourceMappingURL=guards.js.map
