import type { ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../services/db.js";
import { profileEmbed } from "../ui/embeds.js";
import { getActiveTokens, formatDecimal } from "../services/token.js";

export default async function pipProfile(i: ChatInputCommandInteraction) {
  const u = await prisma.user.upsert({
    where: { discordId: i.user.id },
    update: {},
    create: { discordId: i.user.id }
  });

  // Get user's token balances
  const balances = await prisma.userBalance.findMany({
    where: { userId: u.id },
    include: { Token: true }
  });

  // Format balance display
  let balanceText = "0 tokens";
  if (balances.length > 0) {
    balanceText = balances
      .filter(b => Number(b.amount) > 0) // Only show non-zero balances
      .map(b => formatDecimal(b.amount, b.Token.symbol))
      .join(", ") || "0 tokens";
  }

  await i.reply({
    embeds: [
      profileEmbed({
        agwAddress: u.agwAddress ?? null,
        balanceAtomic: balanceText, // Now shows all token balances
        wins: u.wins,
        losses: u.losses,
        ties: u.ties,
      })
    ],
    flags: 64
  });
}