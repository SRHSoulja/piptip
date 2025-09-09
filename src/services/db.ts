// src/services/db.ts
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
export async function ensurePrisma() { await prisma.$connect(); }
