import { MessageFlags, type ChatInputCommandInteraction, type User } from "discord.js";
import { prisma } from "../services/db.js";

export default async function pipRegister(i: ChatInputCommandInteraction) {
  await prisma.user.upsert({
    where: { discordId: i.user.id },
    update: {},
    create: { discordId: i.user.id }
  });
  await i.reply({ content: "Profile created. Use /pip_profile to check your balance.", flags: MessageFlags.Ephemeral });
}
