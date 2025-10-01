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

  // Retry connection with exponential backoff
  let retries = 3;
  let delay = 1000;

  for (let i = 0; i < retries; i++) {
    try {
      await prisma.$connect();
      // Keep connection alive with a test query
      await prisma.$queryRaw`SELECT 1 as keepalive`;
      console.log(`✅ Database connection established`);
      return;
    } catch (error: any) {
      console.warn(`⚠️ Connection attempt ${i + 1}/${retries} failed: ${error.message}`);
      if (i < retries - 1) {
        console.log(`   Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw error;
      }
    }
  }
}
