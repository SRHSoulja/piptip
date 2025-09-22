import type { Client, GuildTextBasedChannel } from "discord.js";
import { prisma } from "../services/db.js";
import { finalizeExpiredGroupTip } from "./finalizeExpiredGroupTip.js";
import { updateGroupTipMessage } from "./group_tip_helpers.js";

const timers = new Map<number, NodeJS.Timeout>();

async function announceResult(client: Client, tipId: number) {
  const tip = await prisma.groupTip.findUnique({
    where: { id: tipId },
    select: { channelId: true, messageId: true },
  });
  if (!tip?.channelId) return;

  const chan = await client.channels.fetch(tip.channelId).catch(() => null);
  if (!chan || !chan.isTextBased()) return;

  // 🔽 Type-narrow to a channel that actually supports `.send()`
  if (!("send" in chan)) return;
  const channel = chan as GuildTextBasedChannel;

  const summary = await finalizeExpiredGroupTip(tipId);
  await updateGroupTipMessage(client, tipId).catch(() => {});

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
}
/** Schedule a one-shot timer to finalize and announce at expiry. */
export async function scheduleGroupTipExpiry(client: Client, tipId: number) {
  const row = await prisma.groupTip.findUnique({
    where: { id: tipId },
    select: { id: true, expiresAt: true, status: true },
  });
  if (!row || row.status !== "ACTIVE") return;

  const delay = Math.max(0, row.expiresAt.getTime() - Date.now());
  clearGroupTipExpiry(tipId);
  const t = setTimeout(async () => {
    try { await announceResult(client, tipId); } finally { timers.delete(tipId); }
  }, delay);
  timers.set(tipId, t);
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