import { prismaWithLogging } from "./prisma_logger.js";
const prisma = prismaWithLogging;
async function ensurePrisma() {
  console.log(`\u{1F50D} DATABASE_URL set: ${process.env.DATABASE_URL ? "YES" : "NO"}`);
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    console.log(`\u{1F50D} Connecting to: ${url.hostname}:${url.port}`);
  }
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1 as keepalive`;
}
export {
  ensurePrisma,
  prisma
};
//# sourceMappingURL=db.js.map
