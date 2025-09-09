// src/services/command_registry.ts
import { REST, Routes } from "discord.js";
import { prisma } from "./db.js";

const TOKEN = process.env.DISCORD_TOKEN!;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const FALLBACK_GUILD_ID = process.env.GUILD_ID;

async function getApprovedGuildIds(): Promise<string[]> {
  const rows = await prisma.approvedServer.findMany({
    where: { enabled: true },
    select: { guildId: true },
  });
  const ids = rows.map(r => r.guildId);
  if (ids.length === 0 && FALLBACK_GUILD_ID) return [FALLBACK_GUILD_ID];
  return ids;
}

export async function registerCommandsForApprovedGuilds(commandsJson: any[]) {
  const guildIds = await getApprovedGuildIds();
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  for (const gid of guildIds) {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, gid),
      { body: commandsJson }
    );
    console.log(`✅ Commands registered for guild ${gid}`);
  }
}
