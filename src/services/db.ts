// src/services/db.ts
import { PrismaClient } from "@prisma/client";
import { prismaWithLogging } from "./prisma_logger.js";

// Use the logging-enabled Prisma client for production monitoring
export const prisma = prismaWithLogging;

export async function ensurePrisma() {
  console.log(`🔍 DATABASE_URL set: ${process.env.DATABASE_URL ? 'YES' : 'NO'}`);
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    console.log(`🔍 Connecting to: ${url.hostname}:${url.port}`);
  }
  await prisma.$connect();
}
