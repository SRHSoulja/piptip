// src/interactions/buttons/legacy.ts
import type { ModalSubmitInteraction } from "discord.js";
import { handleWithdrawCustomModal } from "./withdrawals.js";
import { handlePenguBookBioSetup, handleTipModal } from "./pengubook.js";

// Handle legacy modal submissions that don't match the new parsing system
export async function handleLegacyPipModal(i: ModalSubmitInteraction) {
  const parts = i.customId.split(":");
  const [ns, action] = parts;
  if (ns !== "pip") return;

  // Handle modal submissions with legacy customId format
  if (action === "withdraw_custom_modal") {
    return handleWithdrawCustomModal(i, parts);
  }

  if (action === "pengubook_bio_setup") {
    return handlePenguBookBioSetup(i);
  }

  if (action === "tip_modal") {
    return handleTipModal(i, parts);
  }

  // Add other legacy modal handlers here as needed
  console.warn("Unknown legacy modal action:", action);
  await i.reply({ content: "Unknown modal action.", flags: 64 }).catch(() => {});
}