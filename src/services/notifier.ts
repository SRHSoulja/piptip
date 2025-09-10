// src/services/notifier.ts - Enhanced version with better error handling

import type { ChatInputCommandInteraction } from "discord.js";
import { prisma } from "./db.js";

function toHuman(atomic: string, decimals = 18) {
  if (!/^\d+$/.test(atomic)) return "0";
  const s = atomic.padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

export async function queueNotice(
  userId: number, 
  type: "deposit" | "withdraw_success" | "withdraw_error", 
  payload: any
) {
  try {
    await prisma.notification.create({ 
      data: { userId, type, payload } 
    });
    console.log(`Queued ${type} notification for user ${userId}`);
  } catch (error) {
    console.error("Failed to queue notification:", error);
    // Don't throw - notification failure shouldn't break the main operation
  }
}

export async function flushNoticesEphemeral(i: ChatInputCommandInteraction) {
  const u = await prisma.user.findUnique({ where: { discordId: i.user.id } });
  if (!u) return;

  const notices = await prisma.notification.findMany({
    where: { userId: u.id, sentAt: null },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  if (!notices.length) return;

  const lines: string[] = [];
  for (const n of notices) {
    try {
      if (n.type === "deposit") {
        const p = n.payload as { token: string; amountAtomic: string; decimals?: number; tx?: string };
        const amt = toHuman(p.amountAtomic, p.decimals ?? 18);
        lines.push(`✅ **Deposit credited**: ${amt} ${p.token}${p.tx ? `\n• Tx: \`${p.tx}\`` : ""}`);
      } else if (n.type === "withdraw_success") {
        const p = n.payload as { token: string; amount: string; tx?: string };
        lines.push(`📤 **Withdrawal sent**: ${p.amount} ${p.token}${p.tx ? `\n• Tx: \`${p.tx}\`` : ""}`);
      } else if (n.type === "withdraw_error") {
        const p = n.payload as { reason: string };
        lines.push(`⚠️ **Withdrawal failed**\n• ${p.reason}`);
      }
    } catch (error) {
      console.error("Error formatting notification:", error);
      lines.push(`📨 **Account update** (${n.type})`);
    }
  }

  if (lines.length === 0) return;

  const body =
    lines.length === 1
      ? lines[0]
      : `You have **${notices.length}** account update${notices.length > 1 ? "s" : ""}:\n\n` +
        lines.map(s => `• ${s}`).join("\n\n");

  try {
    if (i.deferred || i.replied) {
      await i.followUp({ content: body, ephemeral: true });
    } else {
      await i.reply({ content: body, ephemeral: true });
    }

    // Mark as sent only if delivery succeeded
    await prisma.notification.updateMany({
      where: { id: { in: notices.map(n => n.id) } },
      data: { sentAt: new Date() },
    });

    console.log(`Delivered ${notices.length} notifications to ${i.user.id}`);
  } catch (error) {
    console.error("Failed to deliver notifications:", error);
    // Don't mark as sent if delivery failed
  }
}

// Enhanced version with retry mechanism
export async function flushNoticesEphemeralWithRetry(
  i: ChatInputCommandInteraction, 
  maxRetries = 2
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await flushNoticesEphemeral(i);
      return; // Success
    } catch (error) {
      console.error(`Notification delivery attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) {
        console.error("All notification delivery attempts failed");
      } else {
        // Brief delay before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}

// Utility to clean up old notifications
export async function cleanupOldNotifications(daysOld = 30) {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  const deleted = await prisma.notification.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      sentAt: { not: null }, // Only delete sent notifications
    },
  });
  
  console.log(`Cleaned up ${deleted.count} old notifications`);
  return deleted.count;
}