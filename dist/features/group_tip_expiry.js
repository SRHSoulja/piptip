import { prisma } from "../services/db.js";
import { finalizeExpiredGroupTip } from "./finalizeExpiredGroupTip.js";
import { updateGroupTipMessage } from "./group_tip_helpers.js";
import { decToBigDirect, formatAmount } from "../services/token.js";
import { groupTipEmbed } from "../ui/embeds.js";
import { groupTipClaimRow } from "../ui/components.js";
const timers = /* @__PURE__ */ new Map();
const pendingDiscordUpdates = /* @__PURE__ */ new Set();
async function updateGroupTipMessageSimple(client, tipId, forceExpired = false) {
  console.log(`\u{1F527} updateGroupTipMessageSimple called for tip ${tipId}, forceExpired: ${forceExpired}`);
  const tip = await prisma.groupTip.findUnique({
    where: { id: tipId },
    include: {
      Creator: true,
      Token: true,
      claims: { include: { User: true } }
    }
  });
  if (!tip || !tip.channelId || !tip.messageId) {
    console.log(`\u274C updateGroupTipMessageSimple: tip data incomplete for ${tipId}`);
    return;
  }
  const now = /* @__PURE__ */ new Date();
  const expired = forceExpired || now >= tip.expiresAt;
  const claimCount = tip.claims.length;
  const claimedBy = tip.claims.filter((c) => c.User?.discordId).map((c) => `<@${c.User.discordId}>`).join(", ") || "No one";
  const creatorDisplay = tip.Creator?.discordId ? `<@${tip.Creator.discordId}>` : "Unknown";
  try {
    const channel = await client.channels.fetch(tip.channelId);
    if (channel && "messages" in channel) {
      const message = await channel.messages.fetch(tip.messageId);
      if (expired) {
        await message.edit({
          embeds: [{
            title: "\u23F0 Colony Fish Expired!",
            description: `\u{1F427} **${creatorDisplay}** shared **${tip.totalAmount} ${tip.Token.symbol}** with the colony!

\u23F0 **Timer expired!** Processing payouts...`,
            color: 16750848,
            fields: [
              { name: "\u{1F427} Colony Members", value: `${claimCount} penguins`, inline: true },
              { name: "\u23F0 Status", value: "\u23F0 Expired - Processing payouts...", inline: true },
              { name: "\u{1F3A3} Fish Claimed By", value: claimedBy, inline: false }
            ],
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          }],
          components: []
          // Remove claim button
        });
        console.log(`\u2705 updateGroupTipMessageSimple: Updated tip ${tipId} to expired state`);
      }
    }
  } catch (error) {
    console.error(`\u274C updateGroupTipMessageSimple failed for tip ${tipId}:`, error.message);
  }
}
async function updateGroupTipMessageToFinalState(client, tipId) {
  console.log(`\u{1F527} updateGroupTipMessageToFinalState called for tip ${tipId}`);
  const tip = await prisma.groupTip.findUnique({
    where: { id: tipId },
    include: {
      Creator: true,
      Token: true,
      claims: { include: { User: true } }
    }
  });
  if (!tip || !tip.channelId || !tip.messageId) {
    console.log(`\u274C updateGroupTipMessageToFinalState: tip data incomplete for ${tipId}`);
    return;
  }
  const claimCount = tip.claims.length;
  const claimedBy = tip.claims.filter((c) => c.User?.discordId).map((c) => `<@${c.User.discordId}>`).join(", ") || "No one";
  const creatorDisplay = tip.Creator?.discordId ? `<@${tip.Creator.discordId}>` : "Unknown";
  try {
    const channel = await client.channels.fetch(tip.channelId);
    if (channel && "messages" in channel) {
      const message = await channel.messages.fetch(tip.messageId);
      await message.edit({
        embeds: [{
          title: "\u{1F389}\u2705 Colony Fish Distributed!",
          description: `\u{1F427} **${creatorDisplay}** shared **${tip.totalAmount} ${tip.Token.symbol}** with the colony!

\u2705 **Fish distributed successfully!**`,
          color: 65280,
          fields: [
            { name: "\u{1F427} Colony Members", value: `${claimCount} penguins`, inline: true },
            { name: "\u23F0 Status", value: "\u2705 Fish distributed!", inline: true },
            { name: "\u{1F3A3} Fish Claimed By", value: claimedBy, inline: false }
          ],
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }],
        components: []
      });
      console.log(`\u2705 updateGroupTipMessageToFinalState: Updated tip ${tipId} to final distributed state`);
    }
  } catch (error) {
    console.error(`\u274C updateGroupTipMessageToFinalState failed for tip ${tipId}:`, error.message);
  }
}
async function updateGroupTipMessageDirect(client, groupTipId) {
  console.log(`\u{1F527} updateGroupTipMessageDirect called for tip ${groupTipId}`);
  const tip = await prisma.groupTip.findUnique({
    where: { id: groupTipId },
    include: {
      Creator: true,
      Token: true,
      claims: { include: { User: true }, orderBy: { claimedAt: "asc" } },
      contributions: { include: { contributor: true }, orderBy: { createdAt: "asc" } }
    }
  });
  if (!tip || !tip.channelId || !tip.messageId) {
    console.log(`\u274C updateGroupTipMessageDirect: tip data incomplete for ${groupTipId}`);
    return;
  }
  const now = /* @__PURE__ */ new Date();
  const expired = !!tip.expiresAt && now >= tip.expiresAt || tip.status === "FINALIZED";
  const claimCount = tip.claims.length;
  const claimedBy = tip.claims.map((c) => c.User?.discordId ? `<@${c.User.discordId}>` : null).filter(Boolean);
  const creatorDisplay = tip.Creator?.discordId ? `<@${tip.Creator.discordId}>` : "Unknown";
  const atomicTotal = decToBigDirect(tip.totalAmount, tip.Token.decimals);
  const amountStr = formatAmount(atomicTotal, {
    address: tip.Token.address,
    symbol: tip.Token.symbol,
    decimals: tip.Token.decimals
  });
  let payoutPerUser;
  if (tip.status === "FINALIZED" && claimCount > 0) {
    const totalPayout = decToBigDirect(tip.totalAmount, tip.Token.decimals);
    const perUser = totalPayout / BigInt(claimCount);
    payoutPerUser = formatAmount(perUser, {
      address: tip.Token.address,
      symbol: tip.Token.symbol,
      decimals: tip.Token.decimals
    });
  }
  const embed = groupTipEmbed({
    creator: creatorDisplay,
    amount: amountStr,
    expiresAt: tip.expiresAt,
    claimCount,
    claimedBy,
    isExpired: expired,
    isFinalized: tip.status === "FINALIZED",
    payoutPerUser
  });
  const components = [groupTipClaimRow(tip.id, expired || tip.status !== "ACTIVE")];
  console.log(`\u{1F527} Direct: Fetching channel ${tip.channelId}...`);
  const channel = await client.channels.fetch(tip.channelId);
  if (!channel || typeof channel !== "object" || !("isTextBased" in channel) || typeof channel.isTextBased !== "function" || !channel.isTextBased()) {
    console.log(`\u274C Direct: Channel ${tip.channelId} not text-based`);
    return;
  }
  console.log(`\u{1F527} Direct: Fetching message ${tip.messageId}...`);
  const msg = await channel.messages.fetch(tip.messageId);
  if (!msg) {
    console.log(`\u274C Direct: Message ${tip.messageId} not found`);
    return;
  }
  console.log(`\u{1F527} Direct: Editing message...`);
  await msg.edit({ embeds: [embed], components });
  console.log(`\u2705 Direct: Message edited successfully`);
}
async function updateDiscordMessageWithRetry(client, tipId, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`\u{1F4DD} Updating Discord message for tip ${tipId} (attempt ${attempt}/${maxAttempts})...`);
      console.log(`\u{1F50D} Client ready: ${client.isReady()}, User: ${client.user?.username || "not logged in"}`);
      if (!client.isReady()) {
        console.log(`\u23F3 Waiting for Discord client to be ready...`);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Client ready timeout")), 1e4);
          if (client.isReady()) {
            clearTimeout(timeout);
            resolve(true);
          } else {
            client.once("ready", () => {
              clearTimeout(timeout);
              resolve(true);
            });
          }
        });
      }
      console.log(`\u2705 Discord client is ready, updating message for tip ${tipId}...`);
      await updateGroupTipMessage(client, tipId);
      console.log(`\u2705 Discord message updated successfully for tip ${tipId} on attempt ${attempt}`);
      return;
    } catch (error) {
      console.error(`\u274C Discord message update attempt ${attempt}/${maxAttempts} failed for tip ${tipId}:`, error.message);
      console.error(`Error details:`, error);
      if (attempt < maxAttempts) {
        const delay = Math.min(1e3 * Math.pow(2, attempt - 1), 3e3);
        console.log(`\u23F3 Waiting ${delay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(`\u{1F480} All ${maxAttempts} attempts failed for Discord message update on tip ${tipId}`);
        console.error("Final error:", error);
      }
    }
  }
}
async function announceResult(client, tipId) {
  console.log(`\u{1F514} announceResult called for tip ${tipId}`);
  const tip = await prisma.groupTip.findUnique({
    where: { id: tipId },
    select: { channelId: true, messageId: true }
  });
  if (!tip?.channelId) {
    console.log(`\u274C No channelId found for tip ${tipId}`);
    return;
  }
  console.log(`\u26A1 Finalizing tip ${tipId}...`);
  const summary = await finalizeExpiredGroupTip(tipId);
  console.log(`\u2705 Tip ${tipId} finalized with result: ${summary.kind}`);
  console.log(`\u{1F4DD} Skipping Discord embed update - handled by dual timer system for tip ${tipId}`);
  console.log(`\u{1F4E1} Fetching channel ${tip.channelId} for announcement...`);
  const chan = await client.channels.fetch(tip.channelId).catch((error) => {
    console.error(`\u274C Failed to fetch channel ${tip.channelId}:`, error.message);
    return null;
  });
  if (!chan || !chan.isTextBased()) {
    console.log(`\u274C Channel ${tip.channelId} not found or not text-based for tip ${tipId}`);
    return;
  }
  if (!("send" in chan)) {
    console.log(`\u274C Channel ${tip.channelId} doesn't support .send() for tip ${tipId}`);
    return;
  }
  const channel = chan;
  if (summary.kind === "REFUNDED") {
    let message = `<a:PenguNo:1415469218681585674> Group tip expired. No claims \u2014 refunded **${summary.amountText}** to <@${summary.creatorId}>`;
    if (summary.contributorRefunds && summary.contributorRefunds.length > 0) {
      const contributorList = summary.contributorRefunds.slice(0, 5).map((refund) => `<@${refund.discordId}>: ${refund.amountText}`).join(", ");
      const more = summary.contributorRefunds.length > 5 ? ` and ${summary.contributorRefunds.length - 5} more contributors` : "";
      message += `
\u{1F41F} Contributors also refunded: ${contributorList}${more}`;
    }
    message += ".";
    await channel.send(message).catch(() => {
    });
  } else if (summary.kind === "FINALIZED") {
    const list = summary.payouts.slice(0, 10).map((p) => `<@${p.discordId}>: ${p.shareText}`).join(", ");
    const more = summary.payouts.length > 10 ? ` \u2026and ${summary.payouts.length - 10} more.` : "";
    const rem = summary.remainderText ? ` (remainder ${summary.remainderText} added to first share)` : "";
    await channel.send(
      `\u23F0 Group tip finalized \u2014 split **${summary.totalText}** equally.
Per person: **${summary.perShareText}**${rem}
Payouts: ${list}${more}`
    ).catch(() => {
    });
  }
}
async function scheduleGroupTipExpiry(client, tipId) {
  console.log(`\u23F0 scheduleGroupTipExpiry called for tip ${tipId}`);
  const row = await prisma.groupTip.findUnique({
    where: { id: tipId },
    select: { id: true, expiresAt: true, status: true }
  });
  if (!row || row.status !== "ACTIVE") {
    console.log(`\u274C Cannot schedule timer for tip ${tipId}: status=${row?.status || "not found"}`);
    return;
  }
  const delay = Math.max(0, row.expiresAt.getTime() - Date.now());
  const expiryTime = new Date(row.expiresAt).toISOString();
  console.log(`\u23F1\uFE0F Scheduling dual timers for tip ${tipId}: expires at ${expiryTime} (in ${Math.round(delay / 1e3)}s)`);
  clearGroupTipExpiry(tipId);
  const embedUpdateTimer = setTimeout(async () => {
    try {
      console.log(`\u26A1 EMBED UPDATE timer fired for tip ${tipId} - updating to final distributed state`);
      await updateGroupTipMessageToFinalState(client, tipId);
      console.log(`\u2705 Embed updated to final distributed state for tip ${tipId}`);
    } catch (error) {
      console.error(`\u274C Embed update failed for tip ${tipId}:`, error.message);
    }
  }, delay);
  const finalizationTimer = setTimeout(async () => {
    try {
      console.log(`\u{1F525} FINALIZATION timer fired for tip ${tipId}! Processing now...`);
      await announceResult(client, tipId);
      console.log(`\u2705 Timer processing completed for tip ${tipId}`);
    } catch (error) {
      console.error(`\u274C Timer processing failed for tip ${tipId}:`, error.message);
    } finally {
      timers.delete(tipId);
      console.log(`\u{1F5D1}\uFE0F Timer removed for tip ${tipId}`);
    }
  }, delay + 3e3);
  timers.set(tipId, finalizationTimer);
  console.log(`\u2705 Timer scheduled successfully for tip ${tipId}, will fire in ${Math.round(delay / 1e3)} seconds`);
}
function clearGroupTipExpiry(tipId) {
  const t = timers.get(tipId);
  if (t) {
    clearTimeout(t);
    timers.delete(tipId);
  }
}
async function restoreGroupTipExpiryTimers(client) {
  const overdue = await prisma.groupTip.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: /* @__PURE__ */ new Date() } },
    select: { id: true }
  });
  for (const g of overdue) {
    await announceResult(client, g.id);
  }
  const upcoming = await prisma.groupTip.findMany({
    where: { status: "ACTIVE", expiresAt: { gt: /* @__PURE__ */ new Date() } },
    select: { id: true, expiresAt: true }
  });
  for (const g of upcoming) {
    await scheduleGroupTipExpiry(client, g.id);
  }
  clearPendingDiscordUpdates();
}
function clearAllTimers() {
  console.log(`\u{1F9F9} Clearing ${timers.size} group tip timers...`);
  for (const [tipId, timer] of timers.entries()) {
    clearTimeout(timer);
  }
  timers.clear();
  console.log("\u2705 All group tip timers cleared");
}
function clearPendingDiscordUpdates() {
  const count = pendingDiscordUpdates.size;
  if (count > 0) {
    console.log(`\u{1F9F9} Clearing ${count} stale pending Discord updates: ${Array.from(pendingDiscordUpdates).join(", ")}`);
    pendingDiscordUpdates.clear();
    console.log("\u2705 Stale pending Discord updates cleared");
  }
}
function getTimerStatus() {
  const now = Date.now();
  const timerList = Array.from(timers.entries()).map(([tipId, timer]) => ({
    tipId,
    // Note: accessing private Node.js timer properties for debugging
    expiresIn: timer._idleStart + timer._idleTimeout - now
  }));
  return {
    active: timers.size,
    timers: timerList
  };
}
async function processPendingDiscordUpdates(client) {
  if (pendingDiscordUpdates.size === 0) return;
  console.log(`\u{1F504} Processing ${pendingDiscordUpdates.size} pending Discord updates...`);
  console.log(`\u{1F4CB} Pending tip IDs: ${Array.from(pendingDiscordUpdates).join(", ")}`);
  const updates = Array.from(pendingDiscordUpdates);
  pendingDiscordUpdates.clear();
  for (const tipId of updates) {
    try {
      console.log(`\u{1F4DD} Processing Discord update for tip ${tipId}...`);
      await updateDiscordMessageWithRetry(client, tipId, 2);
      console.log(`\u2705 Discord update completed for tip ${tipId}`);
    } catch (error) {
      console.error(`\u274C Failed to process Discord update for tip ${tipId}:`, error.message);
    }
  }
}
export {
  clearAllTimers,
  clearGroupTipExpiry,
  clearPendingDiscordUpdates,
  getTimerStatus,
  processPendingDiscordUpdates,
  restoreGroupTipExpiryTimers,
  scheduleGroupTipExpiry
};
//# sourceMappingURL=group_tip_expiry.js.map
