// src/interactions/buttons/help.ts
import type { ButtonInteraction } from "discord.js";

/** Handle show help button */
export async function handleShowHelp(i: ButtonInteraction) {
  await i.deferReply({ ephemeral: true }).catch(() => {});
  
  try {
    // Import and use the help command
    const pipHelp = (await import("../../commands/pip_help.js")).default;
    await pipHelp(i as any);

  } catch (error: any) {
    console.error("Show help error:", error);
    await i.editReply({
      content: `❌ **Error showing help**\n${error?.message || String(error)}`
    });
  }
}