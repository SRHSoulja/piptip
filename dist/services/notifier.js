import { prisma } from "./db.js";
function toHuman(atomic, decimals = 18) {
  if (!/^\d+$/.test(atomic)) return "0";
  const s = atomic.padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}
async function queueNotice(userId, type, payload) {
  try {
    await prisma.notification.create({
      data: { userId, type, payload }
    });
    console.log(`Queued ${type} notification for user ${userId}`);
  } catch (error) {
    console.error("Failed to queue notification:", error);
  }
}
async function flushNoticesEphemeral(i) {
  const u = await prisma.user.findUnique({ where: { discordId: i.user.id } });
  if (!u) return;
  const notices = await prisma.notification.findMany({
    where: { userId: u.id, sentAt: null },
    orderBy: { createdAt: "asc" },
    take: 10
  });
  if (!notices.length) return;
  const lines = [];
  for (const n of notices) {
    try {
      if (n.type === "deposit") {
        const p = n.payload;
        const amt = toHuman(p.amountAtomic, p.decimals ?? 18);
        lines.push(`\u2705 **Deposit credited**: ${amt} ${p.token}${p.tx ? `
\u2022 Tx: \`${p.tx}\`` : ""}`);
      } else if (n.type === "withdraw_success") {
        const p = n.payload;
        lines.push(`\u{1F4E4} **Withdrawal sent**: ${p.amount} ${p.token}${p.tx ? `
\u2022 Tx: \`${p.tx}\`` : ""}`);
      } else if (n.type === "withdraw_error") {
        const p = n.payload;
        lines.push(`\u26A0\uFE0F **Withdrawal failed**
\u2022 ${p.reason}`);
      } else if (n.type === "pengubook_message") {
        const p = n.payload;
        const truncatedMessage = p.message.length > 100 ? p.message.substring(0, 100) + "..." : p.message;
        lines.push(`\u{1F4E8} **New PenguBook message** from ${p.senderName}:
"${truncatedMessage}"`);
      }
    } catch (error) {
      console.error("Error formatting notification:", error);
      lines.push(`\u{1F4E8} **Account update** (${n.type})`);
    }
  }
  if (lines.length === 0) return;
  const body = lines.length === 1 ? lines[0] : `You have **${notices.length}** account update${notices.length > 1 ? "s" : ""}:

` + lines.map((s) => `\u2022 ${s}`).join("\n\n");
  try {
    if (i.deferred || i.replied) {
      await i.followUp({ content: body, ephemeral: true });
    } else {
      await i.reply({ content: body, ephemeral: true });
    }
    await prisma.notification.updateMany({
      where: { id: { in: notices.map((n) => n.id) } },
      data: { sentAt: /* @__PURE__ */ new Date() }
    });
    console.log(`Delivered ${notices.length} notifications to ${i.user.id}`);
  } catch (error) {
    console.error("Failed to deliver notifications:", error);
  }
}
async function flushNoticesEphemeralWithRetry(i, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await flushNoticesEphemeral(i);
      return;
    } catch (error) {
      console.error(`Notification delivery attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) {
        console.error("All notification delivery attempts failed");
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      }
    }
  }
}
async function cleanupOldNotifications(daysOld = 30) {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1e3);
  const deleted = await prisma.notification.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      sentAt: { not: null }
      // Only delete sent notifications
    }
  });
  console.log(`Cleaned up ${deleted.count} old notifications`);
  return deleted.count;
}
export {
  cleanupOldNotifications,
  flushNoticesEphemeral,
  flushNoticesEphemeralWithRetry,
  queueNotice
};
//# sourceMappingURL=notifier.js.map
