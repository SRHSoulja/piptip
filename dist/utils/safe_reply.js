async function safeReply(interaction, options) {
  const replyOptions = typeof options === "string" ? { content: options } : options;
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(replyOptions);
    } else {
      await interaction.reply(replyOptions);
    }
  } catch (error) {
    if (error.code === 40060) {
      console.warn(`safeReply: Interaction already acknowledged, falling back to editReply for ${interaction.commandName}`);
      try {
        await interaction.editReply(replyOptions);
      } catch (editError) {
        console.error(`safeReply: Both reply and editReply failed for ${interaction.commandName}:`, editError);
        throw editError;
      }
    } else {
      throw error;
    }
  }
}
async function safeDeferReply(interaction, options) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply(options);
    }
  } catch (error) {
    if (error.code !== 40060) {
      throw error;
    }
  }
}
export {
  safeDeferReply,
  safeReply
};
//# sourceMappingURL=safe_reply.js.map
