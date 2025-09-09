// src/services/audit.ts
import type { PrismaClient } from "@prisma/client";

/**
 * Log a financial event. amountDec/feeDec must be human-unit decimal strings.
 * Works with SQLite schema where:
 *   - Transaction.type is String (not enum)
 *   - Transaction.metadata is String? (TEXT), not Json
 */
export async function logTransaction(
  prismaOrTx: PrismaClient | Parameters<PrismaClient["$transaction"]>[0],
  opts: {
    type: "DEPOSIT" | "WITHDRAW" | "TIP" | "MATCH_WAGER" | "MATCH_PAYOUT" | "MATCH_RAKE";
    userId: number | null;
    otherUserId?: number | null;
    guildId?: string | null;
    amountDec: string;
    feeDec?: string;
    txHash?: string | null;
    metadata?: Record<string, any> | string | null;
    tokenId?: number | null;
  }
) {
  // Allow passing a transaction client; cast to any to avoid picky generics
  const prisma = prismaOrTx as any;

  const meta =
    opts.metadata == null
      ? null
      : typeof opts.metadata === "string"
      ? opts.metadata
      : JSON.stringify(opts.metadata);

  await prisma.transaction.create({
    data: {
      type: opts.type as any,
      userId: opts.userId ?? undefined,
      otherUserId: opts.otherUserId ?? undefined,
      guildId: opts.guildId ?? undefined,
      amount: opts.amountDec as any, // Prisma Decimal accepts string
      fee: (opts.feeDec ?? "0") as any,
      txHash: opts.txHash ?? null,
      metadata: meta,
      tokenId: opts.tokenId ?? undefined,
    },
  });
}
