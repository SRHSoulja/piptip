import { prisma } from "./db.js";

// Find or create user - upserts user if they don't exist
export async function findOrCreateUser(discordId: string) {
  return prisma.user.upsert({
    where: { discordId },
    update: {},
    create: { discordId }
  });
}

// Just find user without creating
export async function findUser(discordId: string) {
  return prisma.user.findUnique({
    where: { discordId }
  });
}