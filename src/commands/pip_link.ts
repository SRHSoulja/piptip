import type { ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../services/db.js";

const isAddress = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

export default async function pipLink(i: ChatInputCommandInteraction) {
  const rawAddr = i.options.getString("address", true);
  if (!rawAddr || typeof rawAddr !== "string") {
    return i.reply({ content: "Invalid address format.", flags: 64 });
  }
  
  const addr = rawAddr.trim().toLowerCase();
  if (!isAddress(addr)) return i.reply({ content: "Invalid address.", flags: 64 });

  // prevent sharing the same wallet
  const taken = await prisma.user.findFirst({
    where: { agwAddress: addr, discordId: { not: i.user.id } }
  });
  if (taken) return i.reply({ content: "That wallet is already linked to another user.", flags: 64 });

  await prisma.user.upsert({
    where: { discordId: i.user.id },
    update: { agwAddress: addr },
    create: { discordId: i.user.id, agwAddress: addr }
  });

  await i.reply({ content: `Linked wallet \`${addr}\`. Send PENGU to the treasury to deposit.`, flags: 64 });
}
