import { handleWithdrawCustomModal } from "./withdrawals.js";
import { handlePenguBookBioSetup, handleTipModal } from "./pengubook.js";
async function handleLegacyPipModal(i) {
  const parts = i.customId.split(":");
  const [ns, action] = parts;
  if (ns !== "pip") return;
  if (action === "withdraw_custom_modal") {
    return handleWithdrawCustomModal(i, parts);
  }
  if (action === "pengubook_bio_setup") {
    return handlePenguBookBioSetup(i);
  }
  if (action === "tip_modal") {
    return handleTipModal(i, parts);
  }
  console.warn("Unknown legacy modal action:", action);
  await i.reply({ content: "Unknown modal action.", flags: 64 }).catch(() => {
  });
}
export {
  handleLegacyPipModal
};
//# sourceMappingURL=legacy.js.map
