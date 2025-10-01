import { prisma } from "./db.js";
async function findOrCreateUser(discordId) {
  return prisma.user.upsert({
    where: { discordId },
    update: {},
    create: { discordId }
  });
}
async function findUser(discordId) {
  return prisma.user.findUnique({
    where: { discordId }
  });
}
export {
  findOrCreateUser,
  findUser
};
//# sourceMappingURL=user_helpers.js.map
