// src/interactions/pip_buttons.ts
import type { ButtonInteraction, ModalSubmitInteraction, Interaction } from "discord.js";
import { isButtonInteraction, isModalSubmitInteraction } from "../discord/guards.js";
import { parseCustomId, type CustomIdPayload } from "../discord/customId.js";
import { PipMove } from "../services/matches.js";
import { handleGroupTipClaim } from "./group_tip_buttons.js";
import { handleWithdrawToken, handleCancelWithdraw, handleWithdrawAmount, handleConfirmWithdraw, handleWithdrawCustom, handleWithdrawCustomModal, handleBackToWithdraw } from "./buttons/withdrawals.js";
import { handleSelectToken, handleCancelTip, handleSelectDuration, handleConfirmTip, showDurationSelection, showTipConfirmation } from "./buttons/tips.js";
import { handleRefreshProfile, handleDismissProfile, handleViewProfile } from "./buttons/profile.js";
import { handleBuyTier, handleConfirmPurchase, handlePurchaseMembership } from "./buttons/tiers.js";
import { handleExportCSV, handleRefreshStats, handleDismissStats } from "./buttons/stats.js";
import { handleShowHelp } from "./buttons/help.js";
import { handleLegacyPipModal } from "./buttons/legacy.js";
import { handlePick, handleJoin, handleCancel } from "./buttons/matches.js";
import { handlePromptLinkWallet, handleLinkWalletModal, handleLinkWalletSubmit } from "./buttons/wallet.js";
import { handleShowDepositInstructions, handleDepositToken, handleCancelDeposit } from "./buttons/deposits.js";
import { handlePenguBookNav, handlePenguBookModes, handleBioToggle, handleTipFromBook, handleViewOwnBio, handlePenguBookCTA, handlePenguBookBioSetup } from "./buttons/pengubook.js";

/** Router for pip button customIds: pip:<action>:<matchId>:<move?> */
// Main handler that routes by interaction type using type guards
export async function handlePipButton(i: Interaction) {
  if (isButtonInteraction(i)) {
    return handlePipButtonInteraction(i);
  }
  
  if (isModalSubmitInteraction(i)) {
    return handlePipModalInteraction(i);
  }
  
  console.warn("Unsupported interaction type in handlePipButton:", i.type);
}

// Handle button interactions with proper typing
async function handlePipButtonInteraction(i: ButtonInteraction) {
  const payload = parseCustomId(i.customId);
  
  switch (payload.kind) {
    case 'PIP_PROFILE_REFRESH':
      return handleRefreshProfile(i);
    
    case 'PIP_PROFILE_DISMISS':
      return handleDismissProfile(i);
    
    case 'PIP_SHOW_HELP':
      return handleShowHelp(i);
    
    case 'PIP_SHOW_DEPOSIT_INSTRUCTIONS':
      return handleShowDepositInstructions(i);
    
    case 'PIP_PURCHASE_MEMBERSHIP':
      return handlePurchaseMembership(i);
    
    case 'PIP_EXPORT_CSV':
      return handleExportCSV(i);
    
    case 'PIP_PROMPT_LINK_WALLET':
      return handlePromptLinkWallet(i);
    
    case 'PIP_LINK_WALLET_MODAL':
      return handleLinkWalletModal(i);
    
    case 'GROUP_TIP_CLAIM':
      return handleGroupTipClaim(i, payload.groupTipId);
    
    case 'PIP_PICK':
      return handlePick(i, payload.matchId, payload.move as PipMove);
    
    case 'PIP_JOIN':
      return handleJoin(i, payload.matchId, payload.move as PipMove);
    
    case 'PIP_CANCEL':
      return handleCancel(i, payload.matchId);
    
    case 'UNKNOWN':
      return handleLegacyPipButton(i);
    
    default:
      // Modal-only interactions should not reach here
      if (payload.kind === 'PIP_LINK_WALLET_SUBMIT') {
        console.error("Modal interaction received in button handler:", payload.kind);
        return i.reply({ content: "Invalid interaction type for button.", flags: 64 });
      }
      
      // Other unknown button actions
      console.warn("Unknown button interaction:", payload);
      return i.reply({ content: "Unknown button action.", flags: 64 });
  }
}

// Handle modal interactions with proper typing
async function handlePipModalInteraction(i: ModalSubmitInteraction) {
  const payload = parseCustomId(i.customId);
  
  switch (payload.kind) {
    case 'PIP_LINK_WALLET_SUBMIT':
      return handleLinkWalletSubmit(i);
    
    case 'UNKNOWN':
      return handleLegacyPipModal(i);
    
    default:
      return i.reply({ content: "Unknown modal action.", flags: 64 });
  }
}



// Legacy handler for old customId format (fallback)
async function handleLegacyPipButton(i: ButtonInteraction) {
  const parts = i.customId.split(":");
  const [ns, action] = parts;
  if (ns !== "pip") return;

  // Handle membership purchase (no match ID needed)
  if (action === "purchase_membership") {
    return handlePurchaseMembership(i);
  }

  // Handle profile refresh
  if (action === "refresh_profile") {
    return handleRefreshProfile(i);
  }

  // Handle profile dismiss
  if (action === "dismiss_profile") {
    return handleDismissProfile(i);
  }

  // Handle new guided action buttons
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

  // Handle deposit token selection
  if (action === "deposit_token") {
    return handleDepositToken(i, parts);
  }

  if (action === "cancel_deposit") {
    return handleCancelDeposit(i);
  }

  // Handle withdraw token selection
  if (action === "withdraw_token") {
    return handleWithdrawToken(i, parts);
  }

  if (action === "cancel_withdraw") {
    return handleCancelWithdraw(i);
  }

  // Handle withdraw amount selection
  if (action === "withdraw_amount") {
    return handleWithdrawAmount(i, parts);
  }

  if (action === "withdraw_custom") {
    return handleWithdrawCustom(i, parts);
  }

  if (action === "back_to_withdraw") {
    return handleBackToWithdraw(i);
  }

  // Handle withdraw confirmation
  if (action === "confirm_withdraw") {
    return handleConfirmWithdraw(i, parts);
  }

  // Modal submissions are now handled by handleLegacyPipModal
  // This function only handles ButtonInteractions

  // Handle stats actions
  if (action === "export_csv") {
    return handleExportCSV(i);
  }

  if (action === "refresh_stats") {
    return handleRefreshStats(i);
  }

  if (action === "dismiss_stats") {
    return handleDismissStats(i);
  }

  // Handle PenguBook actions
  if (action === "pengubook_browse") {
    return handlePenguBookNav(i, "recent", 1);
  }

  if (action === "pengubook_nav") {
    const mode = parts[2] || "recent";
    const page = parseInt(parts[3]) || 1;
    return handlePenguBookNav(i, mode, page);
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

  if (action === "tip_from_book") {
    const targetDiscordId = parts[2];
    return handleTipFromBook(i, targetDiscordId);
  }

  if (action === "pengubook_cta") {
    return handlePenguBookCTA(i);
  }

  // Handle tip token selection
  if (action === "select_token") {
    return handleSelectToken(i, parts);
  }

  // Handle tip cancellation
  if (action === "cancel_tip") {
    return handleCancelTip(i);
  }

  // Handle group tip duration selection
  if (action === "select_duration") {
    return handleSelectDuration(i, parts);
  }

  // Handle tip confirmation
  if (action === "confirm_tip") {
    return handleConfirmTip(i, parts);
  }

  // Handle tier purchase selection
  if (action === "buy_tier") {
    const tierId = Number(parts[2]);
    if (!Number.isFinite(tierId)) {
      return i.reply({ content: "Invalid tier ID.", flags: 64 });
    }
    return handleBuyTier(i, tierId);
  }

  // Handle purchase confirmation
  if (action === "confirm_purchase") {
    const tierId = Number(parts[2]);
    const tokenId = Number(parts[3]);
    if (!Number.isFinite(tierId) || !Number.isFinite(tokenId)) {
      return i.reply({ content: "Invalid purchase parameters.", flags: 64 });
    }
    return handleConfirmPurchase(i, tierId, tokenId);
  }

  // Handle match-related actions (require match ID)
  const [, , id, move] = parts;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) {
    return i.reply({ content: "Bad match id.", flags: 64 });
  }

  if (action === "pick") return handlePick(i, matchId, move as PipMove);
  if (action === "join") return handleJoin(i, matchId, move as PipMove);
  if (action === "cancel") return handleCancel(i, matchId);

  return i.reply({ content: "Unknown action.", flags: 64 });
}
