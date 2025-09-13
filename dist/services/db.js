import { prismaWithLogging } from "./prisma_logger.js";
// Use the logging-enabled Prisma client for production monitoring
export const prisma = prismaWithLogging;
export async function ensurePrisma() { await prisma.$connect(); }
