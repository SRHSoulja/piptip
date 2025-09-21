import type { Client, GuildTextBasedChannel } from "discord.js";
import { prisma } from "../services/db.js";
import { finalizeExpiredGroupTip } from "./finalizeExpiredGroupTip.js";
import { updateGroupTipMessage } from "./group_tip_helpers.js";
import { rateLimitedDiscord } from "../services/discord_rate_limiter.js";
import { updateGroupTipMessageResilient } from "../services/resilient_discord_updates.js";

const timers = new Map<number, NodeJS.Timeout>();

async function announceResult(client: Client, tipId: number) {
  console.log(`🔄 Finalizing tip ${tipId} and updating message...`);

  let dbFinalizationSuccess = false;

  // Step 1: Finalize in database with multiple retry attempts
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`📊 Database finalization attempt ${attempt}/3 for tip ${tipId}`);

      // CRITICAL FIX: Use the actual finalization function that handles payouts
      const { finalizeExpiredGroupTip } = await import("./finalizeExpiredGroupTip.js");
      await Promise.race([
        finalizeExpiredGroupTip(tipId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Finalization timeout")), 3000)
        )
      ]);

      dbFinalizationSuccess = true;
      console.log(`✅ Database finalization successful for tip ${tipId}`);
      break;

    } catch (dbError: any) {
      console.warn(`⚠️ Database finalization attempt ${attempt} failed for tip ${tipId}:`, dbError.message);

      if (attempt < 3) {
        // Wait before retry (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  if (!dbFinalizationSuccess) {
    console.error(`❌ Failed to finalize tip ${tipId} in database after 3 attempts`);
    return; // Don't proceed with Discord update if DB finalization failed
  }

  // Step 2: Update Discord message using resilient service (independent of database)
  await updateDiscordMessageResilient(client, tipId);
}

async function updateDiscordMessageResilient(client: Client, tipId: number) {
  try {
    console.log(`🚀 Starting resilient Discord update for tip ${tipId}`);

    // Use the resilient service with background retry queue
    const updateId = await updateGroupTipMessageResilient(client, tipId, 8);
    console.log(`📋 Discord update queued with ID: ${updateId} for tip ${tipId}`);

    // The resilient service will handle all retries in the background
    // Database is already finalized, so users will see correct state eventually

  } catch (error: any) {
    console.error(`❌ Failed to queue resilient Discord update for tip ${tipId}:`, error.message);

    // As a last resort, try immediate fallback update
    await fallbackImmediateUpdate(client, tipId);
  }
}

async function fallbackImmediateUpdate(client: Client, tipId: number) {
  try {
    console.log(`🚨 Attempting fallback immediate update for tip ${tipId}`);

    const { updateGroupTipMessage } = await import("./group_tip_helpers.js");

    // Single immediate attempt with shorter timeout
    await Promise.race([
      updateGroupTipMessage(client, tipId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Fallback update timeout")), 5000)
      )
    ]);

    console.log(`✅ Fallback Discord update succeeded for tip ${tipId}`);

  } catch (fallbackError: any) {
    console.error(`💀 Fallback Discord update failed for tip ${tipId}:`, fallbackError.message);
    console.error(`⚠️ Tip ${tipId} is finalized in database but Discord UI may be stale - resilient service will retry`);
  }
}

/** Schedule a one-shot timer to finalize and announce at expiry. */
export async function scheduleGroupTipExpiry(client: Client, tipId: number) {
  console.log(`🔧 scheduleGroupTipExpiry called for tip ${tipId}`);
  console.log(`   🤖 Client status: ready=${client.isReady()}, user=${client.user?.username}`);

  // CRITICAL FIX: Use direct prisma with timeout instead of resilient retry
  try {
    const row = await Promise.race([
      prisma.groupTip.findUnique({
        where: { id: tipId },
        select: { id: true, expiresAt: true, status: true },
      }),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("Schedule query timeout")), 1000)
      )
    ]);

    if (!row || row.status !== "ACTIVE") {
      console.log(`⏭️ Skipping timer for tip ${tipId} (status: ${row?.status || 'not found'})`);
      return;
    }

    const delay = Math.max(0, row.expiresAt.getTime() - Date.now());
    const expiryTime = new Date(row.expiresAt).toISOString();

    console.log(`⏱️ Scheduling timer for tip ${tipId}: expires at ${expiryTime} (in ${delay}ms)`);

    clearGroupTipExpiry(tipId);
    const t = setTimeout(async () => {
      try {
        console.log(`⏰ Group tip ${tipId} timer FIRED! Processing expiry NOW...`);
        await announceResult(client, tipId);
        console.log(`✅ Group tip ${tipId} expiry processing COMPLETED`);
      } catch (error: any) {
        console.error(`❌ Group tip ${tipId} timer execution FAILED:`, error?.message);
      } finally {
        timers.delete(tipId);
      }
    }, delay);
    timers.set(tipId, t);

    console.log(`✅ Timer scheduled for tip ${tipId}, will fire in ${Math.ceil(delay/1000)} seconds`);
  } catch (error: any) {
    console.error(`❌ Failed to schedule timer for group tip ${tipId}:`, error.message);
  }
}

export function clearGroupTipExpiry(tipId: number) {
  const t = timers.get(tipId);
  if (t) { clearTimeout(t); timers.delete(tipId); }
}

/** Call this once after login to recover timers and finalize overdue ones. */
export async function restoreGroupTipExpiryTimers(client: Client) {
  try {
    // CRITICAL FIX: Use direct prisma with timeout to prevent hanging

    // Finalize anything ACTIVE but already expired
    const overdue = await Promise.race([
      prisma.groupTip.findMany({
        where: { status: "ACTIVE", expiresAt: { lte: new Date() } },
        select: { id: true },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Overdue query timeout")), 2000)
      )
    ]);

    for (const g of overdue) {
      await announceResult(client, g.id);
    }

    // Schedule upcoming ACTIVE tips
    const upcoming = await Promise.race([
      prisma.groupTip.findMany({
        where: { status: "ACTIVE", expiresAt: { gt: new Date() } },
        select: { id: true, expiresAt: true },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Upcoming query timeout")), 2000)
      )
    ]);

    for (const g of upcoming) {
      await scheduleGroupTipExpiry(client, g.id);
    }
  } catch (error: any) {
    console.error(`❌ Failed to restore group tip timers:`, error.message);
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