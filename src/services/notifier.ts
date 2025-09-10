import type { ChatInputCommandInteraction } from "discord.js";
import { prisma } from "./db.js";

function toHuman(atomic: string, decimals = 18) {
  if (!/^\d+$/.test(atomic)) return "0";
  const s = atomic.padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

export async function queueNotice(userId: number, type: "deposit"|"withdraw_success"|"withdraw_error", payload: any) {
  await prisma.notification.create({ data: { userId, type, payload } });
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
    if (n.type === "deposit") {
      const p = n.payload as { token:string; amountAtomic:string; decimals?:number; tx?:string };
      const amt = toHuman(p.amountAtomic, p.decimals ?? 18);
      lines.push(`✅ **Deposit credited**: ${amt} ${p.token}${p.tx ? `\n• Tx: \`${p.tx}\`` : ""}`);
    } else if (n.type === "withdraw_success") {
      const p = n.payload as { token:string; amount:string; tx?:string };
      lines.push(`📤 **Withdrawal sent**: ${p.amount} ${p.token}${p.tx ? `\n• Tx: \`${p.tx}\`` : ""}`);
    } else if (n.type === "withdraw_error") {
      const p = n.payload as { reason:string };
      lines.push(`⚠️ **Withdrawal failed**\n• ${p.reason}`);
    }
  }

  const body =
    lines.length === 1
      ? lines[0]
      : `You have **${notices.length}** account update${notices.length > 1 ? "s" : ""}:\n\n` +
        lines.map(s => `• ${s}`).join("\n\n");

  if (i.deferred || i.replied) await i.followUp({ content: body, ephemeral: true }).catch(()=>{});
  else await i.reply({ content: body, ephemeral: true }).catch(()=>{});

  await prisma.notification.updateMany({
    where: { id: { in: notices.map(n => n.id) } },
    data: { sentAt: new Date() },
  });
}
