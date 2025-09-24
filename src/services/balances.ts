// src/services/balances.ts
import { prisma } from "./db.js";
import { formatUnits, parseUnits } from "ethers";
import type { Prisma } from "@prisma/client";
import { incrementNegativeBalanceAttempts } from "./metrics.js";
import { BalanceConservationService } from "./balance_conservation.js";
import { cache, CacheKeys, CacheTTL } from "./cache.js";
import { priceAPI } from "./price_api.js";

// Legacy compatibility function for existing commands
export async function debit(discordId: string, amountAtomic: bigint, type = "MATCH_WAGER") {
  // For legacy compatibility, use the first active token (likely PENGU)
  const tokens = await prisma.token.findMany({ where: { active: true }, take: 1 });
  if (!tokens.length) throw new Error("No active tokens found");

  const token = tokens[0];
  return debitToken(discordId, token.id, amountAtomic, type as any);
}

// ---------- helpers ----------
function toDecStr(atomic: bigint, decimals: number): string {
  return formatUnits(atomic, decimals);
}
function toAtomic(dec: any, decimals: number): bigint {
  return parseUnits(String(dec ?? "0"), decimals);
}

// Fetch a token (throws if not found / inactive when required)
export async function getTokenById(tokenId: number, requireActive = true) {
  const t = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!t) throw new Error("Token not found");
  if (requireActive && !t.active) throw new Error("Token is inactive");
  return t;
}
export async function getTokenByAddress(addr: string, requireActive = true) {
  const t = await prisma.token.findUnique({ where: { address: addr.toLowerCase() } });
  if (!t) throw new Error("Token not found");
  if (requireActive && !t.active) throw new Error("Token is inactive");
  return t;
}

// Ensure user row
export async function ensureUser(discordId: string) {
  return prisma.user.upsert({ where: { discordId }, update: {}, create: { discordId } });
}

// Ensure (user, token) balance row
export async function ensureUserBalance(userId: number, tokenId: number) {
  return prisma.userBalance.upsert({
    where: { userId_tokenId: { userId, tokenId } },
    update: {},
    create: { userId, tokenId, amount: 0 as any },
  });
}

// === TX helpers (so callers can keep everything on one transaction client) ===
export type Tx = Prisma.TransactionClient;

export async function ensureUserTx(tx: Tx, discordId: string) {
  return tx.user.upsert({ where: { discordId }, update: {}, create: { discordId } });
}

export async function ensureUserBalanceTx(tx: Tx, userId: number, tokenId: number) {
  return tx.userBalance.upsert({
    where: { userId_tokenId: { userId, tokenId } },
    update: {},
    create: { userId, tokenId, amount: 0 as any },
  });
}

// ---- tx-aware transaction logger (replaces the old global logTxAtomic) ----
export async function logTxAtomicTx(
  db: Tx,
  params: {
    userId: number | null;
    otherUserId?: number | null;
    guildId?: string | null;
    type: "DEPOSIT" | "WITHDRAW" | "TIP" | "MATCH_WAGER" | "MATCH_PAYOUT" | "MATCH_RAKE" | "GROUP_TIP_PAYOUT" | "GROUP_TIP_CONTRIBUTION" | "GROUP_TIP_REFUND";
    tokenId: number;
    decimals: number;
    amountAtomic: bigint;
    feeAtomic?: bigint;
    txHash?: string | null;
    note?: string | null; // stored as TEXT in SQLite
    tokenSymbol?: string; // Optional: if provided, will capture USD value
  }
) {
  const {
    userId,
    otherUserId = null,
    guildId = null,
    type,
    tokenId,
    decimals,
    amountAtomic,
    feeAtomic = 0n,
    txHash = null,
    note = null,
    tokenSymbol = null,
  } = params;

  // Capture USD values for tax reporting and historical context
  let usdValue: string | null = null;
  let usdFeeValue: string | null = null;
  let usdPrice: string | null = null;
  let priceSource: string | null = null;

  if (tokenSymbol) {
    try {
      const priceResult = await priceAPI.getTokenPrices([tokenSymbol]);
      if (priceResult.success && priceResult.prices[tokenSymbol]) {
        const tokenPrice = priceResult.prices[tokenSymbol];
        const amountInTokens = parseFloat(toDecStr(amountAtomic, decimals));
        const feeInTokens = parseFloat(toDecStr(feeAtomic, decimals));

        usdPrice = tokenPrice.toString();
        usdValue = (amountInTokens * tokenPrice).toString();
        usdFeeValue = (feeInTokens * tokenPrice).toString();
        priceSource = priceResult.source;
      }
    } catch (error) {
      // Silently continue without USD values if price fetch fails
      console.warn(`Failed to get USD values for transaction: ${error}`);
    }
  }

  await db.transaction.create({
    data: {
      type,
      userId,
      otherUserId,
      guildId,
      tokenId,
      amount: toDecStr(amountAtomic, decimals),
      fee: toDecStr(feeAtomic, decimals),
      txHash: txHash ?? undefined,
      metadata: note ?? null,
      // USD value tracking for tax reporting
      usdValue: usdValue ? parseFloat(usdValue) : null,
      usdFeeValue: usdFeeValue ? parseFloat(usdFeeValue) : null,
      usdPrice: usdPrice ? parseFloat(usdPrice) : null,
      priceSource: priceSource,
    },
  });
}

// ---------- public API (multi-token only, non-TX) ----------

/** Debit a user’s balance for a given token. Logs a Transaction. */
export async function debitToken(
  discordId: string,
  tokenId: number,
  amountAtomic: bigint,
  type:
    | "WITHDRAW"
    | "MATCH_WAGER"
    | "TIP"
    | "MATCH_RAKE"
    | "MATCH_PAYOUT", // use what fits the flow
  opts: {
    guildId?: string | null;
    feeAtomic?: bigint;          // optional extra fee in same token
    otherUserId?: number | null; // e.g., counterparty User.id
    txHash?: string | null;
    note?: string | null;
  } = {}
) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const [user, token] = await Promise.all([
    ensureUser(discordId),
    getTokenById(tokenId),
  ]);
  const decimals = Number(token.decimals);

  // SECURITY: Use pessimistic locking - check balance AND debit in single atomic operation
  const total = amountAtomic + BigInt(opts.feeAtomic ?? 0n);

  await prisma.$transaction(async (db) => {
    // ATOMIC: Get current balance with FOR UPDATE lock
    const ub = await db.userBalance.findFirst({
      where: { userId: user.id, tokenId },
      // Note: Prisma doesn't support SELECT FOR UPDATE, but we use atomic updateMany for same effect
    });

    if (!ub) {
      // Create balance if it doesn't exist
      await db.userBalance.create({
        data: { userId: user.id, tokenId, amount: "0" }
      });
    }

    const currentBal = ub ? toAtomic(ub.amount, decimals) : 0n;

    if (currentBal < total) {
      throw new Error("Insufficient balance");
    }

    const newBal = currentBal - total;

    // Monitor for negative balance attempts (should never happen after sufficient balance check)
    if (newBal < 0n) {
      incrementNegativeBalanceAttempts();
      throw new Error("Negative balance prevented");
    }

    // ATOMIC: Update balance with WHERE clause to prevent race condition
    const updateResult = await db.userBalance.updateMany({
      where: {
        userId: user.id,
        tokenId,
        amount: { gte: toDecStr(total, decimals) } // Only update if sufficient balance
      },
      data: { amount: toDecStr(newBal, decimals) }
    });

    // If no rows updated, another transaction consumed the balance
    if (updateResult.count === 0) {
      throw new Error("Insufficient balance due to concurrent transaction");
    }

    await logTxAtomicTx(db, {
      userId: user.id,
      otherUserId: opts.otherUserId ?? null,
      guildId: opts.guildId ?? null,
      type,
      tokenId,
      decimals,
      amountAtomic,
      feeAtomic: opts.feeAtomic ?? 0n,
      txHash: opts.txHash ?? null,
      note: opts.note ?? null,
      tokenSymbol: token.symbol, // Include symbol for USD tracking
    });
  }, { timeout: 15000, maxWait: 15000 });

  return user.id;
}

/** Credit a user’s balance for a given token. Logs a Transaction. */
export async function creditToken(
  discordId: string,
  tokenId: number,
  amountAtomic: bigint,
  type: "DEPOSIT" | "MATCH_PAYOUT" | "TIP",
  opts: {
    guildId?: string | null;
    feeAtomic?: bigint;          // rarely used on credit, but supported
    otherUserId?: number | null;
    txHash?: string | null;
    note?: string | null;
  } = {}
) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const [user, token] = await Promise.all([
    ensureUser(discordId),
    getTokenById(tokenId),
  ]);
  const decimals = Number(token.decimals);

  const ub = await ensureUserBalance(user.id, tokenId);
  const bal = toAtomic(ub.amount, decimals);
  const newBal = bal + amountAtomic;

  await prisma.$transaction(async (db) => {
    await db.userBalance.update({
      where: { userId_tokenId: { userId: user.id, tokenId } },
      data: { amount: toDecStr(newBal, decimals) },
    });

    await logTxAtomicTx(db, {
      userId: user.id,
      otherUserId: opts.otherUserId ?? null,
      guildId: opts.guildId ?? null,
      type,
      tokenId,
      decimals,
      amountAtomic,
      feeAtomic: opts.feeAtomic ?? 0n,
      txHash: opts.txHash ?? null,
      note: opts.note ?? null,
      tokenSymbol: token.symbol, // Include symbol for USD tracking
    });
  }, { timeout: 15000, maxWait: 15000 });

  return user.id;
}

/** Transfer a token amount between two users (optional fee charged to sender). */
export async function transferToken(
  fromDiscordId: string,
  toDiscordId: string,
  tokenId: number,
  amountAtomic: bigint,
  type: "TIP" | "MATCH_PAYOUT",
  opts: {
    guildId?: string | null;
    feeAtomic?: bigint;          // house fee in same token
    txHash?: string | null;
    note?: string | null;
  } = {}
) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const fee = BigInt(opts.feeAtomic ?? 0n);

  const [fromUser, toUser, token] = await Promise.all([
    ensureUser(fromDiscordId),
    ensureUser(toDiscordId),
    getTokenById(tokenId),
  ]);
  const decimals = Number(token.decimals);

  const [fromBalRow, toBalRow] = await Promise.all([
    ensureUserBalance(fromUser.id, tokenId),
    ensureUserBalance(toUser.id, tokenId),
  ]);

  const fromBal = toAtomic(fromBalRow.amount, decimals);
  const toBal = toAtomic(toBalRow.amount, decimals);
  const totalDebit = amountAtomic + fee;

  // DEBUG: Log the transfer values to debug balance issues
  console.log('DEBUG transferToken Balance Check:', {
    fromDiscordId,
    tokenSymbol: token.symbol,
    fromBalanceRaw: fromBalRow.amount.toString(),
    fromBalAtomic: fromBal.toString(),
    amountAtomic: amountAtomic.toString(),
    feeAtomic: fee.toString(),
    totalDebit: totalDebit.toString(),
    hasEnough: fromBal >= totalDebit,
    decimals
  });

  if (fromBal < totalDebit) throw new Error("Insufficient balance for transfer");

  await prisma.$transaction(async (db) => {
    // sender
    await db.userBalance.update({
      where: { userId_tokenId: { userId: fromUser.id, tokenId } },
      data: { amount: toDecStr(fromBal - totalDebit, decimals) },
    });

    // receiver
    await db.userBalance.update({
      where: { userId_tokenId: { userId: toUser.id, tokenId } },
      data: { amount: toDecStr(toBal + amountAtomic, decimals) },
    });

    // mirror logs (same tx client)
    await logTxAtomicTx(db, {
      userId: fromUser.id,
      otherUserId: toUser.id,
      guildId: opts.guildId ?? null,
      type,
      tokenId,
      decimals,
      amountAtomic,
      feeAtomic: fee,
      txHash: opts.txHash ?? null,
      note: opts.note ?? null,
    });

    await logTxAtomicTx(db, {
      userId: toUser.id,
      otherUserId: fromUser.id,
      guildId: opts.guildId ?? null,
      type,
      tokenId,
      decimals,
      amountAtomic,
      feeAtomic: 0n,
      txHash: opts.txHash ?? null,
      note: opts.note ?? null,
    });

    // If you want a separate explicit rake record, add another logTxAtomicTx here with type "MATCH_RAKE".
  }, { timeout: 15000, maxWait: 15000 });

  return { fromUserId: fromUser.id, toUserId: toUser.id };
}

// ---------- TX variants (use these from complex flows like button handlers) ----------

/** Debit inside an existing TX (no nested $transaction). */
// SECURITY: Atomic debit function that works within existing transaction (race condition safe)
export async function debitTokenAtomicTx(
  tx: any, // Prisma transaction context
  discordId: string,
  tokenId: number,
  amountAtomic: bigint,
  type:
    | "DEPOSIT"
    | "WITHDRAW"
    | "MATCH_WAGER"
    | "TIP"
    | "MATCH_RAKE"
    | "MATCH_PAYOUT",
  opts: {
    guildId?: string | null;
    feeAtomic?: bigint;
    otherUserId?: number | null;
    txHash?: string | null;
    note?: string | null;
  } = {}
): Promise<void> {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");

  const [user, token] = await Promise.all([
    ensureUser(discordId),
    getTokenById(tokenId),
  ]);
  const decimals = Number(token.decimals);
  const total = amountAtomic + BigInt(opts.feeAtomic ?? 0n);

  // SECURITY: Pre-transaction balance conservation validation
  const preValidation = await BalanceConservationService.preTransactionValidation(
    user.id,
    tokenId,
    total
  );
  if (!preValidation) {
    throw new Error("Pre-transaction validation failed - insufficient balance or system inconsistency");
  }

  // SECURITY: Atomic balance check and update in single operation
  const currentBalance = await tx.userBalance.findFirst({
    where: { userId: user.id, tokenId }
  });

  if (!currentBalance) {
    // Create zero balance if doesn't exist
    await tx.userBalance.create({
      data: { userId: user.id, tokenId, amount: "0" }
    });
  }

  const currentBal = currentBalance ? toAtomic(currentBalance.amount, decimals) : 0n;

  if (currentBal < total) {
    throw new Error("Insufficient balance");
  }

  const newBal = currentBal - total;

  if (newBal < 0n) {
    incrementNegativeBalanceAttempts();
    throw new Error("Negative balance prevented");
  }

  // ATOMIC: Update with WHERE clause to prevent race condition
  const updateResult = await tx.userBalance.updateMany({
    where: {
      userId: user.id,
      tokenId,
      amount: { gte: toDecStr(total, decimals) } // Only update if sufficient balance
    },
    data: { amount: toDecStr(newBal, decimals) }
  });

  // If no rows updated, concurrent transaction consumed the balance
  if (updateResult.count === 0) {
    throw new Error("Insufficient balance due to concurrent transaction");
  }

  // Log transaction
  await logTxAtomicTx(tx, {
    userId: user.id,
    otherUserId: opts.otherUserId ?? null,
    guildId: opts.guildId ?? null,
    type,
    tokenId,
    decimals,
    amountAtomic,
    feeAtomic: opts.feeAtomic ?? 0n,
    txHash: opts.txHash ?? null,
    note: opts.note ?? null,
  });
}

export async function debitTokenTx(
  tx: Tx,
  discordId: string,
  tokenId: number,
  amountAtomic: bigint,
  type: "WITHDRAW" | "MATCH_WAGER" | "TIP" | "MATCH_RAKE" | "MATCH_PAYOUT",
  opts: {
    guildId?: string | null;
    feeAtomic?: bigint;
    otherUserId?: number | null;
    txHash?: string | null;
    note?: string | null;
  } = {}
) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const token = await tx.token.findUnique({ where: { id: tokenId } });
  if (!token) throw new Error("Token not found");
  if (!token.active) throw new Error("Token is inactive");
  const decimals = Number(token.decimals);

  const user = await ensureUserTx(tx, discordId);
  const ub = await ensureUserBalanceTx(tx, user.id, tokenId);

  const bal = toAtomic(ub.amount as any, decimals);
  const total = amountAtomic + BigInt(opts.feeAtomic ?? 0n);
  if (bal < total) throw new Error("Insufficient balance");

  const newBal = bal - total;
  
  // Monitor for negative balance attempts
  if (newBal < 0n) {
    incrementNegativeBalanceAttempts();
    throw new Error("Negative balance prevented");
  }

  await tx.userBalance.update({
    where: { userId_tokenId: { userId: user.id, tokenId } },
    data: { amount: toDecStr(newBal, decimals) },
  });

  await logTxAtomicTx(tx, {
    userId: user.id,
    otherUserId: opts.otherUserId ?? null,
    guildId: opts.guildId ?? null,
    type,
    tokenId,
    decimals,
    amountAtomic,
    feeAtomic: opts.feeAtomic ?? 0n,
    txHash: opts.txHash ?? null,
    note: opts.note ?? null,
  });

  return user.id;
}

/** Credit inside an existing TX (no nested $transaction). */
export async function creditTokenTx(
  tx: Tx,
  discordId: string,
  tokenId: number,
  amountAtomic: bigint,
  type: "DEPOSIT" | "MATCH_PAYOUT" | "TIP" | "GROUP_TIP_PAYOUT" | "MATCH_WAGER" | "WITHDRAW" | "MATCH_RAKE" | "GROUP_TIP_REFUND",
  opts: {
    guildId?: string | null;
    feeAtomic?: bigint;
    otherUserId?: number | null;
    txHash?: string | null;
    note?: string | null;
  } = {}
) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const token = await tx.token.findUnique({ where: { id: tokenId } });
  if (!token) throw new Error("Token not found");
  if (!token.active) throw new Error("Token is inactive");
  const decimals = Number(token.decimals);

  const user = await ensureUserTx(tx, discordId);
  const ub = await ensureUserBalanceTx(tx, user.id, tokenId);

  const bal = toAtomic(ub.amount as any, decimals);
  const newBal = bal + amountAtomic;

  await tx.userBalance.update({
    where: { userId_tokenId: { userId: user.id, tokenId } },
    data: { amount: toDecStr(newBal, decimals) },
  });

  await logTxAtomicTx(tx, {
    userId: user.id,
    otherUserId: opts.otherUserId ?? null,
    guildId: opts.guildId ?? null,
    type,
    tokenId,
    decimals,
    amountAtomic,
    feeAtomic: opts.feeAtomic ?? 0n,
    txHash: opts.txHash ?? null,
    note: opts.note ?? null,
  });

  return user.id;
}

/** Transfer inside an existing TX (no nested $transaction). */
export async function transferTokenTx(
  tx: Tx,
  fromDiscordId: string,
  toDiscordId: string,
  tokenId: number,
  amountAtomic: bigint,
  type: "TIP" | "MATCH_PAYOUT",
  opts: {
    guildId?: string | null;
    feeAtomic?: bigint;
    txHash?: string | null;
    note?: string | null;
  } = {}
) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const fee = BigInt(opts.feeAtomic ?? 0n);

  const token = await tx.token.findUnique({ where: { id: tokenId } });
  if (!token) throw new Error("Token not found");
  if (!token.active) throw new Error("Token is inactive");
  const decimals = Number(token.decimals);

  const [fromUser, toUser] = await Promise.all([
    ensureUserTx(tx, fromDiscordId),
    ensureUserTx(tx, toDiscordId),
  ]);

  const [fromBalRow, toBalRow] = await Promise.all([
    ensureUserBalanceTx(tx, fromUser.id, tokenId),
    ensureUserBalanceTx(tx, toUser.id, tokenId),
  ]);

  const fromBal = toAtomic(fromBalRow.amount as any, decimals);
  const toBal   = toAtomic(toBalRow.amount   as any, decimals);
  const totalDebit = amountAtomic + fee;

  if (fromBal < totalDebit) throw new Error("Insufficient balance for transfer");

  await tx.userBalance.update({
    where: { userId_tokenId: { userId: fromUser.id, tokenId } },
    data: { amount: toDecStr(fromBal - totalDebit, decimals) },
  });

  await tx.userBalance.update({
    where: { userId_tokenId: { userId: toUser.id, tokenId } },
    data: { amount: toDecStr(toBal + amountAtomic, decimals) },
  });

  // mirror logs
  await logTxAtomicTx(tx, {
    userId: fromUser.id,
    otherUserId: toUser.id,
    guildId: opts.guildId ?? null,
    type,
    tokenId,
    decimals,
    amountAtomic,
    feeAtomic: fee,
    txHash: opts.txHash ?? null,
    note: opts.note ?? null,
  });

  await logTxAtomicTx(tx, {
    userId: toUser.id,
    otherUserId: fromUser.id,
    guildId: opts.guildId ?? null,
    type,
    tokenId,
    decimals,
    amountAtomic,
    feeAtomic: 0n,
    txHash: opts.txHash ?? null,
    note: opts.note ?? null,
  });

  return { fromUserId: fromUser.id, toUserId: toUser.id };
}

// ========== CACHED BALANCE FUNCTIONS ==========

/**
 * Get user balance with Redis caching for fast access
 */
export async function getCachedUserBalance(userId: number, tokenId: number): Promise<number> {
  const cacheKey = CacheKeys.USER_BALANCE(userId, tokenId);

  // Try cache first
  const cached = await cache.get<number>(cacheKey);
  if (cached !== null) return cached;

  // Fallback to database
  const balance = await prisma.userBalance.findUnique({
    where: { userId_tokenId: { userId, tokenId } }
  });

  const amount = Number(balance?.amount || 0);

  // Cache for 1 minute
  await cache.set(cacheKey, amount, CacheTTL.BALANCE);
  return amount;
}

/**
 * Get user balance by Discord ID with caching
 */
export async function getCachedUserBalanceByDiscord(discordId: string, tokenId: number): Promise<number> {
  // Get user first
  const user = await prisma.user.findUnique({
    where: { discordId },
    select: { id: true }
  });

  if (!user) return 0;

  return getCachedUserBalance(user.id, tokenId);
}

/**
 * Invalidate balance cache when balance changes
 */
export async function invalidateBalanceCache(userId: number, tokenId: number): Promise<void> {
  const cacheKey = CacheKeys.USER_BALANCE(userId, tokenId);
  await cache.del(cacheKey);

  // Also invalidate profile cache since it contains balance info
  await cache.del(CacheKeys.USER_PROFILE(userId));
}

/**
 * Update balance and cache simultaneously
 */
export async function updateCachedBalance(userId: number, tokenId: number, newAmount: number): Promise<void> {
  // Update cache immediately
  const cacheKey = CacheKeys.USER_BALANCE(userId, tokenId);
  await cache.set(cacheKey, newAmount, CacheTTL.BALANCE);

  // Invalidate related caches
  await cache.del(CacheKeys.USER_PROFILE(userId));
  await cache.delPattern("piptip:leaderboard:*");
}
