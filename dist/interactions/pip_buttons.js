import { isButtonInteraction, isModalSubmitInteraction } from "../discord/guards.js";
import { parseCustomId } from "../discord/customId.js";
import { handleGroupTipClaim } from "./group_tip_buttons.js";
import { handleWithdrawToken, handleCancelWithdraw, handleWithdrawAmount, handleConfirmWithdraw, handleWithdrawCustom, handleBackToWithdraw } from "./buttons/withdrawals.js";
import { handleSelectToken, handleCancelTip, handleSelectDuration, handleConfirmTip } from "./buttons/tips.js";
import { handleRefreshProfile, handleDismissProfile, handleViewProfile } from "./buttons/profile.js";
import { handleBuyTier, handleConfirmPurchase, handlePurchaseMembership } from "./buttons/tiers.js";
import { handleExportCSV, handleRefreshStats, handleDismissStats } from "./buttons/stats.js";
import { handleShowHelp } from "./buttons/help.js";
import { handleLegacyPipModal } from "./buttons/legacy.js";
import { handlePick, handleJoin, handleCancel } from "./buttons/matches.js";
import { handlePromptLinkWallet, handleLinkWalletModal, handleLinkWalletSubmit } from "./buttons/wallet.js";
import { handleShowDepositInstructions, handleDepositToken, handleCancelDeposit } from "./buttons/deposits.js";
import { handlePenguBookModes, handleBioToggle, handleTipFromBook, handleViewOwnBio, handlePenguBookCTA, handlePenguBookProfile, handlePenguBookInbox } from "./buttons/pengubook.js";
import { handleRefreshAchievements, handleShowLeaderboard, handleViewOwnAchievements } from "./buttons/achievements.js";
import { handleServerApplicationModal } from "./server_application_modal.js";
import {
  handleSettingsMode,
  handleSettingsChannels,
  handleSelectMode,
  handleAddAllowed,
  handleAddBlocked,
  handleSelectAllowed,
  handleSelectBlocked,
  handleFeatureChannels,
  handleSetupEverywhere,
  handleSetupGaming,
  handleSetupStrict
} from "./buttons/settings.js";
async function handlePipButton(i) {
  if (isButtonInteraction(i)) {
    return handlePipButtonInteraction(i);
  }
  if (isModalSubmitInteraction(i)) {
    return handlePipModalInteraction(i);
  }
  console.warn("Unsupported interaction type in handlePipButton:", i.type);
}
async function handlePipButtonInteraction(i) {
  const payload = parseCustomId(i.customId);
  console.log(`\u{1F50D} Button interaction - customId: ${i.customId}, parsed:`, payload);
  switch (payload.kind) {
    case "PIP_PROFILE_REFRESH":
      return handleRefreshProfile(i);
    case "PIP_PROFILE_DISMISS":
      return handleDismissProfile(i);
    case "PIP_SHOW_HELP":
      return handleShowHelp(i);
    case "PIP_SHOW_DEPOSIT_INSTRUCTIONS":
      return handleShowDepositInstructions(i);
    case "PIP_PURCHASE_MEMBERSHIP":
      return handlePurchaseMembership(i);
    case "PIP_EXPORT_CSV":
      return handleExportCSV(i);
    case "PIP_PROMPT_LINK_WALLET":
      return handlePromptLinkWallet(i);
    case "PIP_LINK_WALLET_MODAL":
      return handleLinkWalletModal(i);
    case "GROUP_TIP_CLAIM":
      return handleGroupTipClaim(i, payload.groupTipId);
    case "PIP_PICK":
      return handlePick(i, payload.matchId, payload.move);
    case "PIP_JOIN":
      return handleJoin(i, payload.matchId, payload.move);
    case "PIP_CANCEL":
      return handleCancel(i, payload.matchId);
    // Settings interactions
    case "PIP_SETTINGS_MODE":
      return handleSettingsMode(i);
    case "PIP_SETTINGS_CHANNELS":
      return handleSettingsChannels(i);
    case "PIP_FEATURE_CHANNELS":
      return handleFeatureChannels(i);
    case "PIP_ADD_ALLOWED":
      return handleAddAllowed(i);
    case "PIP_ADD_BLOCKED":
      return handleAddBlocked(i);
    case "PIP_SETUP_EVERYWHERE":
      return handleSetupEverywhere(i);
    case "PIP_SETUP_GAMING":
      return handleSetupGaming(i);
    case "PIP_SETUP_STRICT":
      return handleSetupStrict(i);
    case "PIP_OPEN_SETTINGS":
      const pipSettings = (await import("../commands/pip_settings.js")).default;
      const fakeInteraction = Object.assign(Object.create(Object.getPrototypeOf(i)), i, {
        options: {
          getSubcommand: () => "channels"
        },
        reply: async (options) => {
          if (options.flags === 64) {
            delete options.flags;
          }
          return i.update(options);
        }
      });
      return pipSettings(fakeInteraction);
    case "UNKNOWN":
      return handleLegacyPipButton(i);
    default:
      if (payload.kind === "PIP_LINK_WALLET_SUBMIT") {
        console.error("Modal interaction received in button handler:", payload.kind);
        return i.reply({ content: "Invalid interaction type for button.", flags: 64 });
      }
      console.warn("Unknown button interaction:", payload);
      return i.reply({ content: "Unknown button action.", flags: 64 });
  }
}
async function handlePipModalInteraction(i) {
  const payload = parseCustomId(i.customId);
  switch (payload.kind) {
    case "PIP_LINK_WALLET_SUBMIT":
      return handleLinkWalletSubmit(i);
    case "PIP_SERVER_APPLICATION_SUBMIT":
      return handleServerApplicationModal(i);
    case "PIP_SELECT_MODE":
      return handleSelectMode(i);
    case "PIP_SELECT_ALLOWED":
      return handleSelectAllowed(i);
    case "PIP_SELECT_BLOCKED":
      return handleSelectBlocked(i);
    case "UNKNOWN":
      return handleLegacyPipModal(i);
    default:
      return i.reply({ content: "Unknown modal action.", flags: 64 });
  }
}
async function handleLegacyPipButton(i) {
  const parts = i.customId.split(":");
  const [ns, action] = parts;
  console.log(`\u{1F527} Legacy handler - customId: ${i.customId}, parts:`, parts, `ns: ${ns}, action: ${action}`);
  if (ns !== "pip") return;
  if (action === "purchase_membership") {
    return handlePurchaseMembership(i);
  }
  if (action === "refresh_profile") {
    return handleRefreshProfile(i);
  }
  if (action === "dismiss_profile") {
    return handleDismissProfile(i);
  }
  if (action === "show_deposit_instructions") {
    return handleShowDepositInstructions(i);
  }
  if (action === "view_profile") {
    return handleViewProfile(i);
  }
  if (action === "show_help") {
    return handleShowHelp(i);
  }
  if (action === "prompt_link_wallet") {
    return handlePromptLinkWallet(i);
  }
  if (action === "refresh_achievements") {
    return handleRefreshAchievements(i);
  }
  if (action === "show_leaderboard") {
    return handleShowLeaderboard(i);
  }
  if (action === "view_own_achievements") {
    return handleViewOwnAchievements(i);
  }
  if (action === "deposit_token") {
    return handleDepositToken(i, parts);
  }
  if (action === "cancel_deposit") {
    return handleCancelDeposit(i);
  }
  if (action === "withdraw_token") {
    return handleWithdrawToken(i, parts);
  }
  if (action === "cancel_withdraw") {
    return handleCancelWithdraw(i);
  }
  if (action === "withdraw_amount") {
    return handleWithdrawAmount(i, parts);
  }
  if (action === "withdraw_custom") {
    return handleWithdrawCustom(i, parts);
  }
  if (action === "back_to_withdraw") {
    return handleBackToWithdraw(i);
  }
  if (action === "confirm_withdraw") {
    return handleConfirmWithdraw(i, parts);
  }
  if (action === "export_csv") {
    return handleExportCSV(i);
  }
  if (action === "refresh_stats") {
    return handleRefreshStats(i);
  }
  if (action === "dismiss_stats") {
    return handleDismissStats(i);
  }
  if (action === "pengubook_browse") {
    await i.deferUpdate();
    const pipPenguBook = (await import("../commands/pip_pengubook.js")).default;
    const fakeInteraction = Object.assign(Object.create(Object.getPrototypeOf(i)), i, {
      options: {
        getString: (name) => name === "mode" ? "recent" : null,
        getInteger: (name) => name === "page" ? 1 : null
      },
      reply: async (options) => {
        if (options.flags === 64) {
          delete options.flags;
        }
        return i.editReply(options);
      },
      editReply: i.editReply.bind(i),
      deferReply: async () => {
      }
      // Already deferred with deferUpdate
    });
    return pipPenguBook(fakeInteraction);
  }
  if (action === "pengubook_nav") {
    const mode = parts[2] || "recent";
    const page = parseInt(parts[3]) || 1;
    await i.deferUpdate();
    const pipPenguBook = (await import("../commands/pip_pengubook.js")).default;
    const fakeInteraction = Object.assign(Object.create(Object.getPrototypeOf(i)), i, {
      options: {
        getString: (name) => name === "mode" ? mode : null,
        getInteger: (name) => name === "page" ? page : null
      },
      reply: async (options) => {
        if (options.flags === 64) {
          delete options.flags;
        }
        return i.editReply(options);
      },
      editReply: i.editReply.bind(i),
      deferReply: async () => {
      }
      // Already deferred with deferUpdate
    });
    return pipPenguBook(fakeInteraction);
  }
  if (action === "pengubook_modes") {
    return handlePenguBookModes(i);
  }
  if (action === "bio_view_own") {
    return handleViewOwnBio(i);
  }
  if (action === "bio_toggle") {
    const setting = parts[2];
    const value = parts[3] === "true";
    return handleBioToggle(i, setting, value);
  }
  if (action === "bio_settings") {
    return handleBioToggle(i, "showInPenguBook", true);
  }
  if (action === "tip_from_book") {
    const targetDiscordId = parts[2];
    return handleTipFromBook(i, targetDiscordId);
  }
  if (action === "tip_modal") {
    const targetDiscordId = parts[2];
    return handleTipFromBook(i, targetDiscordId);
  }
  if (action === "pengubook_cta") {
    return handlePenguBookCTA(i);
  }
  if (action === "pengubook_profile") {
    const targetDiscordId = parts[2];
    return handlePenguBookProfile(i, targetDiscordId);
  }
  if (action === "pengubook_inbox") {
    return handlePenguBookInbox(i);
  }
  if (action === "pengubook_inbox_refresh") {
    return handlePenguBookInbox(i);
  }
  if (action === "back_to_profile") {
    return handleViewProfile(i);
  }
  if (action === "select_token") {
    return handleSelectToken(i, parts);
  }
  if (action === "cancel_tip") {
    return handleCancelTip(i);
  }
  if (action === "select_duration") {
    return handleSelectDuration(i, parts);
  }
  if (action === "confirm_tip") {
    return handleConfirmTip(i, parts);
  }
  if (action === "buy_tier") {
    const tierId = Number(parts[2]);
    if (!Number.isFinite(tierId)) {
      return i.reply({ content: "Invalid tier ID.", flags: 64 });
    }
    return handleBuyTier(i, tierId);
  }
  if (action === "confirm_purchase") {
    const tierId = Number(parts[2]);
    const tokenId = Number(parts[3]);
    if (!Number.isFinite(tierId) || !Number.isFinite(tokenId)) {
      return i.reply({ content: "Invalid purchase parameters.", flags: 64 });
    }
    return handleConfirmPurchase(i, tierId, tokenId);
  }
  const [, , id, move] = parts;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) {
    return i.reply({ content: "Bad match id.", flags: 64 });
  }
  if (action === "pick") return handlePick(i, matchId, move);
  if (action === "join") return handleJoin(i, matchId, move);
  if (action === "cancel") return handleCancel(i, matchId);
  return i.reply({ content: "Unknown action.", flags: 64 });
}
export {
  handlePipButton
};
//# sourceMappingURL=pip_buttons.js.map
