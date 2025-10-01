import { prismaWithLogging } from "./prisma_logger.js";
const prisma = prismaWithLogging;
async function ensurePrisma() {
  await prisma.$connect();
}
export {
  ensurePrisma,
  prisma
};
//# sourceMappingURL=db.js.map
