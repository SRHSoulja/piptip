import type { Client, GuildTextBasedChannel, TextBasedChannel } from "discord.js";
import { prisma } from "../services/db.js";
import { finalizeExpiredGroupTip } from "./finalizeExpiredGroupTip.js";
import { updateGroupTipMessage } from "./group_tip_helpers.js";
import { decToBigDirect, formatAmount } from "../services/token.js";
import { groupTipEmbed } from "../ui/embeds.js";
import { groupTipClaimRow } from "../ui/components.js";

const timers = new Map<number, NodeJS.Timeout>();
const pendingDiscordUpdates = new Set<number>();

/** Direct Discord message update bypassing rate limiter for timer context */
async function updateGroupTipMessageDirect(client: Client, groupTipId: number) {
  console.log(`🔧 updateGroupTipMessageDirect called for tip ${groupTipId}`);

  const tip = await prisma.groupTip.findUnique({
    where: { id: groupTipId },
    include: {
      Creator: true,
      Token: true,
      claims: { include: { User: true }, orderBy: { claimedAt: "asc" } },
      contributions: { include: { contributor: true }, orderBy: { createdAt: "asc" } },
    },
  });

  if (!tip || !tip.channelId || !tip.messageId) {
    console.log(`❌ updateGroupTipMessageDirect: tip data incomplete for ${groupTipId}`);
    return;
  }

  const now = new Date();
  const expired = (!!tip.expiresAt && now >= tip.expiresAt) || tip.status === 'FINALIZED';

  const claimCount = tip.claims.length;
  const claimedBy = tip.claims
    .map(c => (c.User?.discordId ? `<@${c.User.discordId}>` : null))
    .filter(Boolean) as string[];

  const creatorDisplay = tip.Creator?.discordId ? `<@${tip.Creator.discordId}>` : "Unknown";

  const atomicTotal = decToBigDirect(tip.totalAmount, tip.Token.decimals);
  const amountStr = formatAmount(atomicTotal, {
    address: tip.Token.address,
    symbol: tip.Token.symbol,
    decimals: tip.Token.decimals,
  } as any);

  // Calculate payout per user if finalized
  let payoutPerUser: string | undefined;
  if (tip.status === 'FINALIZED' && claimCount > 0) {
    const totalPayout = decToBigDirect(tip.totalAmount, tip.Token.decimals);
    const perUser = totalPayout / BigInt(claimCount);
    payoutPerUser = formatAmount(perUser, {
      address: tip.Token.address,
      symbol: tip.Token.symbol,
      decimals: tip.Token.decimals,
    } as any);
  }

  const embed = groupTipEmbed({
    creator: creatorDisplay,
    amount: amountStr,
    expiresAt: tip.expiresAt,
    claimCount,
    claimedBy,
    isExpired: expired,
    isFinalized: tip.status === 'FINALIZED',
    payoutPerUser,
  });

  const components = [groupTipClaimRow(tip.id, expired || tip.status !== "ACTIVE")];

  console.log(`🔧 Direct: Fetching channel ${tip.channelId}...`);
  const channel = await client.channels.fetch(tip.channelId);
  if (!channel || typeof channel !== 'object' || !('isTextBased' in channel) || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    console.log(`❌ Direct: Channel ${tip.channelId} not text-based`);
    return;
  }

  console.log(`🔧 Direct: Fetching message ${tip.messageId}...`);
  const msg = await (channel as TextBasedChannel).messages.fetch(tip.messageId);
  if (!msg) {
    console.log(`❌ Direct: Message ${tip.messageId} not found`);
    return;
  }

  console.log(`🔧 Direct: Editing message...`);
  await msg.edit({ embeds: [embed], components });
  console.log(`✅ Direct: Message edited successfully`);
}

async function updateDiscordMessageWithRetry(client: Client, tipId: number, maxAttempts: number = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`📝 Updating Discord message for tip ${tipId} (attempt ${attempt}/${maxAttempts})...`);
      console.log(`🔍 Client ready: ${client.isReady()}, User: ${client.user?.username || 'not logged in'}`);

      // Wait for client to be ready if it's not
      if (!client.isReady()) {
        console.log(`⏳ Waiting for Discord client to be ready...`);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Client ready timeout')), 10000);

          if (client.isReady()) {
            clearTimeout(timeout);
            resolve(true);
          } else {
            client.once('ready', () => {
              clearTimeout(timeout);
              resolve(true);
            });
          }
        });
      }

      console.log(`✅ Discord client is ready, updating message for tip ${tipId}...`);
      await updateGroupTipMessage(client, tipId);
      console.log(`✅ Discord message updated successfully for tip ${tipId} on attempt ${attempt}`);
      return; // Success, exit retry loop

    } catch (error: any) {
      console.error(`❌ Discord message update attempt ${attempt}/${maxAttempts} failed for tip ${tipId}:`, error.message);
      console.error(`Error details:`, error);

      if (attempt < maxAttempts) {
        // Wait before retry with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 3000);
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`💀 All ${maxAttempts} attempts failed for Discord message update on tip ${tipId}`);
        console.error('Final error:', error);
      }
    }
  }
}

async function announceResult(client: Client, tipId: number) {
  console.log(`🔔 announceResult called for tip ${tipId}`);

  const tip = await prisma.groupTip.findUnique({
    where: { id: tipId },
    select: { channelId: true, messageId: true },
  });

  if (!tip?.channelId) {
    console.log(`❌ No channelId found for tip ${tipId}`);
    return;
  }

  console.log(`⚡ Finalizing tip ${tipId}...`);
  const summary = await finalizeExpiredGroupTip(tipId);
  console.log(`✅ Tip ${tipId} finalized with result: ${summary.kind}`);

  // Don't add to pending updates - handle Discord update directly in timer context
  console.log(`📝 Timer will handle Discord message update directly (not using pending queue)...`);

  // Discord message update will be attempted after announcement

  console.log(`📡 Fetching channel ${tip.channelId} for announcement...`);
  const chan = await client.channels.fetch(tip.channelId).catch((error) => {
    console.error(`❌ Failed to fetch channel ${tip.channelId}:`, error.message);
    return null;
  });

  if (!chan || !chan.isTextBased()) {
    console.log(`❌ Channel ${tip.channelId} not found or not text-based for tip ${tipId}`);
    return;
  }

  // 🔽 Type-narrow to a channel that actually supports `.send()`
  if (!("send" in chan)) {
    console.log(`❌ Channel ${tip.channelId} doesn't support .send() for tip ${tipId}`);
    return;
  }
  const channel = chan as GuildTextBasedChannel;

  if (summary.kind === "REFUNDED") {
    await channel.send(
      `<a:PenguNo:1415469218681585674> Group tip expired. No claims — refunded **${summary.amountText}** to <@${summary.creatorId}>.`
    ).catch(() => {});
  } else if (summary.kind === "FINALIZED") {
    const list = summary.payouts
      .slice(0, 10)
      .map(p => `<@${p.discordId}>: ${p.shareText}`)
      .join(", ");
    const more = summary.payouts.length > 10 ? ` …and ${summary.payouts.length - 10} more.` : "";
    const rem = summary.remainderText ? ` (remainder ${summary.remainderText} added to first share)` : "";
    await channel.send(
      `⏰ Group tip finalized — split **${summary.totalText}** equally.\n` +
      `Per person: **${summary.perShareText}**${rem}\n` +
      `Payouts: ${list}${more}`
    ).catch(() => {});
  }

  // Now try to update the Discord message in the same context where the announcement worked
  console.log(`🔄 TIMER CONTEXT: Attempting Discord message update in same context as announcement...`);
  console.log(`🔍 TIMER CONTEXT: Client state: ready=${client.isReady()}, user=${client.user?.username}, uptime=${client.uptime}ms`);
  console.log(`🚨 TIMER CONTEXT: THIS LOG PROVES THE TIMER IS CALLING DISCORD UPDATE FOR TIP ${tipId}`);
  try {
    // First try the normal way
    await updateGroupTipMessage(client, tipId);
    console.log(`✅ Discord message update succeeded for tip ${tipId}!`);
  } catch (error: any) {
    console.error(`❌ Primary Discord message update failed for tip ${tipId}:`, error.message);
    console.error(`Error details:`, {
      name: error.name,
      code: error.code,
      status: error.status,
      method: error.method,
      url: error.url,
      requestBody: error.requestBody
    });

    // Try a direct approach bypassing rate limiter
    console.log(`🔄 Attempting direct Discord message update bypassing rate limiter...`);
    try {
      await updateGroupTipMessageDirect(client, tipId);
      console.log(`✅ Direct Discord message update succeeded for tip ${tipId}!`);
    } catch (directError: any) {
      console.error(`❌ Direct Discord message update also failed for tip ${tipId}:`, directError.message);
      console.error(`Direct error stack:`, directError.stack);
      console.log(`📋 Both Discord update attempts failed for tip ${tipId}`);
    }
  }
}
/** Schedule a one-shot timer to finalize and announce at expiry. */
export async function scheduleGroupTipExpiry(client: Client, tipId: number) {
  console.log(`⏰ scheduleGroupTipExpiry called for tip ${tipId}`);

  const row = await prisma.groupTip.findUnique({
    where: { id: tipId },
    select: { id: true, expiresAt: true, status: true },
  });

  if (!row || row.status !== "ACTIVE") {
    console.log(`❌ Cannot schedule timer for tip ${tipId}: status=${row?.status || 'not found'}`);
    return;
  }

  const delay = Math.max(0, row.expiresAt.getTime() - Date.now());
  const expiryTime = new Date(row.expiresAt).toISOString();

  console.log(`⏱️ Scheduling timer for tip ${tipId}: expires at ${expiryTime} (in ${Math.round(delay/1000)}s)`);

  clearGroupTipExpiry(tipId);
  const t = setTimeout(async () => {
    try {
      console.log(`🔥 Timer FIRED for tip ${tipId}! Processing now...`);
      await announceResult(client, tipId);
      console.log(`✅ Timer processing completed for tip ${tipId}`);
    } catch (error: any) {
      console.error(`❌ Timer processing failed for tip ${tipId}:`, error.message);
    } finally {
      timers.delete(tipId);
      console.log(`🗑️ Timer removed for tip ${tipId}`);
    }
  }, delay);
  timers.set(tipId, t);

  console.log(`✅ Timer scheduled successfully for tip ${tipId}, will fire in ${Math.round(delay/1000)} seconds`);
}

export function clearGroupTipExpiry(tipId: number) {
  const t = timers.get(tipId);
  if (t) { clearTimeout(t); timers.delete(tipId); }
}

/** Call this once after login to recover timers and finalize overdue ones. */
export async function restoreGroupTipExpiryTimers(client: Client) {
  // Finalize anything ACTIVE but already expired
  const overdue = await prisma.groupTip.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const g of overdue) {
    await announceResult(client, g.id);
  }

  // Schedule upcoming ACTIVE tips
  const upcoming = await prisma.groupTip.findMany({
    where: { status: "ACTIVE", expiresAt: { gt: new Date() } },
    select: { id: true, expiresAt: true },
  });
  for (const g of upcoming) {
    await scheduleGroupTipExpiry(client, g.id);
  }
}

/** Clear all timers - call during shutdown to prevent memory leaks */
export function clearAllTimers(): void {
  console.log(`🧹 Clearing ${timers.size} group tip timers...`);
  for (const [tipId, timer] of timers.entries()) {
    clearTimeout(timer);
  }
  timers.clear();
  console.log("✅ All group tip timers cleared");
}

/** Get current timer status for monitoring */
export function getTimerStatus() {
  const now = Date.now();
  const timerList = Array.from(timers.entries()).map(([tipId, timer]) => ({
    tipId,
    // Note: accessing private Node.js timer properties for debugging
    expiresIn: (timer as any)._idleStart + (timer as any)._idleTimeout - now,
  }));

  return {
    active: timers.size,
    timers: timerList
  };
}

/** Process pending Discord message updates */
export async function processPendingDiscordUpdates(client: Client) {
  if (pendingDiscordUpdates.size === 0) return;

  console.log(`🔄 Processing ${pendingDiscordUpdates.size} pending Discord updates...`);

  const updates = Array.from(pendingDiscordUpdates);
  pendingDiscordUpdates.clear();

  for (const tipId of updates) {
    try {
      console.log(`📝 Processing Discord update for tip ${tipId}...`);
      await updateDiscordMessageWithRetry(client, tipId, 2);
      console.log(`✅ Discord update completed for tip ${tipId}`);
    } catch (error: any) {
      console.error(`❌ Failed to process Discord update for tip ${tipId}:`, error.message);
      // Don't re-add to pending to avoid infinite loops
    }
  }
}

