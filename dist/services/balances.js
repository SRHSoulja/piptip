import { prisma } from "./db.js";
import { formatUnits, parseUnits } from "ethers";
import { incrementNegativeBalanceAttempts } from "./metrics.js";
import { BalanceConservationService } from "./balance_conservation.js";
import { cache, CacheKeys, CacheTTL } from "./cache.js";
async function debit(discordId, amountAtomic, type = "MATCH_WAGER") {
  const tokens = await prisma.token.findMany({ where: { active: true }, take: 1 });
  if (!tokens.length) throw new Error("No active tokens found");
  const token = tokens[0];
  return debitToken(discordId, token.id, amountAtomic, type);
}
function toDecStr(atomic, decimals) {
  return formatUnits(atomic, decimals);
}
function toAtomic(dec, decimals) {
  return parseUnits(String(dec ?? "0"), decimals);
}
async function getTokenById(tokenId, requireActive = true) {
  const t = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!t) throw new Error("Token not found");
  if (requireActive && !t.active) throw new Error("Token is inactive");
  return t;
}
async function getTokenByAddress(addr, requireActive = true) {
  const t = await prisma.token.findUnique({ where: { address: addr.toLowerCase() } });
  if (!t) throw new Error("Token not found");
  if (requireActive && !t.active) throw new Error("Token is inactive");
  return t;
}
async function ensureUser(discordId) {
  return prisma.user.upsert({ where: { discordId }, update: {}, create: { discordId } });
}
async function ensureUserBalance(userId, tokenId) {
  return prisma.userBalance.upsert({
    where: { userId_tokenId: { userId, tokenId } },
    update: {},
    create: { userId, tokenId, amount: 0 }
  });
}
async function ensureUserTx(tx, discordId) {
  return tx.user.upsert({ where: { discordId }, update: {}, create: { discordId } });
}
async function ensureUserBalanceTx(tx, userId, tokenId) {
  return tx.userBalance.upsert({
    where: { userId_tokenId: { userId, tokenId } },
    update: {},
    create: { userId, tokenId, amount: 0 }
  });
}
async function logTxAtomicTx(db, params) {
  const { logTxAtomicTx: newLogTxAtomicTx } = await import("./tx_logger.js");
  await newLogTxAtomicTx(db, params);
}
async function debitToken(discordId, tokenId, amountAtomic, type, opts = {}) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const [user, token] = await Promise.all([
    ensureUser(discordId),
    getTokenById(tokenId)
  ]);
  const decimals = Number(token.decimals);
  const total = amountAtomic + BigInt(opts.feeAtomic ?? 0n);
  await prisma.$transaction(async (db) => {
    const ub = await db.userBalance.findFirst({
      where: { userId: user.id, tokenId }
      // Note: Prisma doesn't support SELECT FOR UPDATE, but we use atomic updateMany for same effect
    });
    if (!ub) {
      await db.userBalance.create({
        data: { userId: user.id, tokenId, amount: "0" }
      });
    }
    const currentBal = ub ? toAtomic(ub.amount, decimals) : 0n;
    if (currentBal < total) {
      throw new Error("Insufficient balance");
    }
    const newBal = currentBal - total;
    if (newBal < 0n) {
      incrementNegativeBalanceAttempts();
      throw new Error("Negative balance prevented");
    }
    const updateResult = await db.userBalance.updateMany({
      where: {
        userId: user.id,
        tokenId,
        amount: { gte: toDecStr(total, decimals) }
        // Only update if sufficient balance
      },
      data: { amount: toDecStr(newBal, decimals) }
    });
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
      amountAtomic: -amountAtomic,
      // NEGATIVE for debits (outgoing funds)
      feeAtomic: opts.feeAtomic ?? 0n,
      txHash: opts.txHash ?? null,
      note: opts.note ?? null,
      tokenSymbol: token.symbol
      // Include symbol for USD tracking
    });
  }, { timeout: 15e3, maxWait: 15e3 });
  return user.id;
}
async function creditToken(discordId, tokenId, amountAtomic, type, opts = {}) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const [user, token] = await Promise.all([
    ensureUser(discordId),
    getTokenById(tokenId)
  ]);
  const decimals = Number(token.decimals);
  const ub = await ensureUserBalance(user.id, tokenId);
  const bal = toAtomic(ub.amount, decimals);
  const newBal = bal + amountAtomic;
  await prisma.$transaction(async (db) => {
    await db.userBalance.update({
      where: { userId_tokenId: { userId: user.id, tokenId } },
      data: { amount: toDecStr(newBal, decimals) }
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
      tokenSymbol: token.symbol
      // Include symbol for USD tracking
    });
  }, { timeout: 15e3, maxWait: 15e3 });
  return user.id;
}
async function transferToken(fromDiscordId, toDiscordId, tokenId, amountAtomic, type, opts = {}) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const fee = BigInt(opts.feeAtomic ?? 0n);
  const [fromUser, toUser, token] = await Promise.all([
    ensureUser(fromDiscordId),
    ensureUser(toDiscordId),
    getTokenById(tokenId)
  ]);
  const decimals = Number(token.decimals);
  const [fromBalRow, toBalRow] = await Promise.all([
    ensureUserBalance(fromUser.id, tokenId),
    ensureUserBalance(toUser.id, tokenId)
  ]);
  const fromBal = toAtomic(fromBalRow.amount, decimals);
  const toBal = toAtomic(toBalRow.amount, decimals);
  const totalDebit = amountAtomic + fee;
  if (fromBal < totalDebit) throw new Error("Insufficient balance for transfer");
  await prisma.$transaction(async (db) => {
    await db.userBalance.update({
      where: { userId_tokenId: { userId: fromUser.id, tokenId } },
      data: { amount: toDecStr(fromBal - totalDebit, decimals) }
    });
    await db.userBalance.update({
      where: { userId_tokenId: { userId: toUser.id, tokenId } },
      data: { amount: toDecStr(toBal + amountAtomic, decimals) }
    });
    await logTxAtomicTx(db, {
      userId: fromUser.id,
      otherUserId: toUser.id,
      guildId: opts.guildId ?? null,
      type,
      tokenId,
      decimals,
      amountAtomic: -amountAtomic,
      // NEGATIVE for sender (outgoing transfer)
      feeAtomic: fee,
      txHash: opts.txHash ?? null,
      note: opts.note ?? null
    });
    await logTxAtomicTx(db, {
      userId: toUser.id,
      otherUserId: fromUser.id,
      guildId: opts.guildId ?? null,
      type,
      tokenId,
      decimals,
      amountAtomic,
      // POSITIVE for receiver (incoming transfer)
      feeAtomic: 0n,
      txHash: opts.txHash ?? null,
      note: opts.note ?? null
    });
  }, { timeout: 15e3, maxWait: 15e3 });
  return { fromUserId: fromUser.id, toUserId: toUser.id };
}
async function debitTokenAtomicTx(tx, discordId, tokenId, amountAtomic, type, opts = {}) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const [user, token] = await Promise.all([
    ensureUser(discordId),
    getTokenById(tokenId)
  ]);
  const decimals = Number(token.decimals);
  const total = amountAtomic + BigInt(opts.feeAtomic ?? 0n);
  const preValidation = await BalanceConservationService.preTransactionValidation(
    user.id,
    tokenId,
    total
  );
  if (!preValidation) {
    throw new Error("Pre-transaction validation failed - insufficient balance or system inconsistency");
  }
  const currentBalance = await tx.userBalance.findFirst({
    where: { userId: user.id, tokenId }
  });
  if (!currentBalance) {
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
  const updateResult = await tx.userBalance.updateMany({
    where: {
      userId: user.id,
      tokenId,
      amount: { gte: toDecStr(total, decimals) }
      // Only update if sufficient balance
    },
    data: { amount: toDecStr(newBal, decimals) }
  });
  if (updateResult.count === 0) {
    throw new Error("Insufficient balance due to concurrent transaction");
  }
  await logTxAtomicTx(tx, {
    userId: user.id,
    otherUserId: opts.otherUserId ?? null,
    guildId: opts.guildId ?? null,
    type,
    tokenId,
    decimals,
    amountAtomic: -amountAtomic,
    // NEGATIVE for debits (outgoing funds)
    feeAtomic: opts.feeAtomic ?? 0n,
    txHash: opts.txHash ?? null,
    note: opts.note ?? null
  });
}
async function debitTokenTx(tx, discordId, tokenId, amountAtomic, type, opts = {}) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const token = await tx.token.findUnique({ where: { id: tokenId } });
  if (!token) throw new Error("Token not found");
  if (!token.active) throw new Error("Token is inactive");
  const decimals = Number(token.decimals);
  const user = await ensureUserTx(tx, discordId);
  const ub = await ensureUserBalanceTx(tx, user.id, tokenId);
  const bal = toAtomic(ub.amount, decimals);
  const total = amountAtomic + BigInt(opts.feeAtomic ?? 0n);
  if (bal < total) throw new Error("Insufficient balance");
  const newBal = bal - total;
  if (newBal < 0n) {
    incrementNegativeBalanceAttempts();
    throw new Error("Negative balance prevented");
  }
  await tx.userBalance.update({
    where: { userId_tokenId: { userId: user.id, tokenId } },
    data: { amount: toDecStr(newBal, decimals) }
  });
  await logTxAtomicTx(tx, {
    userId: user.id,
    otherUserId: opts.otherUserId ?? null,
    guildId: opts.guildId ?? null,
    type,
    tokenId,
    decimals,
    amountAtomic: -amountAtomic,
    // NEGATIVE for debits (outgoing funds)
    feeAtomic: opts.feeAtomic ?? 0n,
    txHash: opts.txHash ?? null,
    note: opts.note ?? null
  });
  return user.id;
}
async function creditTokenTx(tx, discordId, tokenId, amountAtomic, type, opts = {}) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const token = await tx.token.findUnique({ where: { id: tokenId } });
  if (!token) throw new Error("Token not found");
  if (!token.active) throw new Error("Token is inactive");
  const decimals = Number(token.decimals);
  const user = await ensureUserTx(tx, discordId);
  const ub = await ensureUserBalanceTx(tx, user.id, tokenId);
  const bal = toAtomic(ub.amount, decimals);
  const newBal = bal + amountAtomic;
  await tx.userBalance.update({
    where: { userId_tokenId: { userId: user.id, tokenId } },
    data: { amount: toDecStr(newBal, decimals) }
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
    note: opts.note ?? null
  });
  return user.id;
}
async function transferTokenTx(tx, fromDiscordId, toDiscordId, tokenId, amountAtomic, type, opts = {}) {
  if (amountAtomic <= 0n) throw new Error("Amount must be positive");
  const fee = BigInt(opts.feeAtomic ?? 0n);
  const token = await tx.token.findUnique({ where: { id: tokenId } });
  if (!token) throw new Error("Token not found");
  if (!token.active) throw new Error("Token is inactive");
  const decimals = Number(token.decimals);
  const [fromUser, toUser] = await Promise.all([
    ensureUserTx(tx, fromDiscordId),
    ensureUserTx(tx, toDiscordId)
  ]);
  const [fromBalRow, toBalRow] = await Promise.all([
    ensureUserBalanceTx(tx, fromUser.id, tokenId),
    ensureUserBalanceTx(tx, toUser.id, tokenId)
  ]);
  const fromBal = toAtomic(fromBalRow.amount, decimals);
  const toBal = toAtomic(toBalRow.amount, decimals);
  const totalDebit = amountAtomic + fee;
  if (fromBal < totalDebit) throw new Error("Insufficient balance for transfer");
  await tx.userBalance.update({
    where: { userId_tokenId: { userId: fromUser.id, tokenId } },
    data: { amount: toDecStr(fromBal - totalDebit, decimals) }
  });
  await tx.userBalance.update({
    where: { userId_tokenId: { userId: toUser.id, tokenId } },
    data: { amount: toDecStr(toBal + amountAtomic, decimals) }
  });
  await logTxAtomicTx(tx, {
    userId: fromUser.id,
    otherUserId: toUser.id,
    guildId: opts.guildId ?? null,
    type,
    tokenId,
    decimals,
    amountAtomic: -amountAtomic,
    // NEGATIVE for sender (outgoing transfer)
    feeAtomic: fee,
    txHash: opts.txHash ?? null,
    note: opts.note ?? null
  });
  await logTxAtomicTx(tx, {
    userId: toUser.id,
    otherUserId: fromUser.id,
    guildId: opts.guildId ?? null,
    type,
    tokenId,
    decimals,
    amountAtomic,
    // POSITIVE for receiver (incoming transfer)
    feeAtomic: 0n,
    txHash: opts.txHash ?? null,
    note: opts.note ?? null
  });
  return { fromUserId: fromUser.id, toUserId: toUser.id };
}
async function getCachedUserBalance(userId, tokenId) {
  const cacheKey = CacheKeys.USER_BALANCE(userId, tokenId);
  const cached = await cache.get(cacheKey);
  if (cached !== null) return cached;
  const balance = await prisma.userBalance.findUnique({
    where: { userId_tokenId: { userId, tokenId } }
  });
  const amount = Number(balance?.amount || 0);
  await cache.set(cacheKey, amount, CacheTTL.BALANCE);
  return amount;
}
async function getCachedUserBalanceByDiscord(discordId, tokenId) {
  const user = await prisma.user.findUnique({
    where: { discordId },
    select: { id: true }
  });
  if (!user) return 0;
  return getCachedUserBalance(user.id, tokenId);
}
async function invalidateBalanceCache(userId, tokenId) {
  const cacheKey = CacheKeys.USER_BALANCE(userId, tokenId);
  await cache.del(cacheKey);
  await cache.del(CacheKeys.USER_PROFILE(userId));
}
async function updateCachedBalance(userId, tokenId, newAmount) {
  const cacheKey = CacheKeys.USER_BALANCE(userId, tokenId);
  await cache.set(cacheKey, newAmount, CacheTTL.BALANCE);
  await cache.del(CacheKeys.USER_PROFILE(userId));
  await cache.delPattern("piptip:leaderboard:*");
}
export {
  creditToken,
  creditTokenTx,
  debit,
  debitToken,
  debitTokenAtomicTx,
  debitTokenTx,
  ensureUser,
  ensureUserBalance,
  ensureUserBalanceTx,
  ensureUserTx,
  getCachedUserBalance,
  getCachedUserBalanceByDiscord,
  getTokenByAddress,
  getTokenById,
  invalidateBalanceCache,
  logTxAtomicTx,
  transferToken,
  transferTokenTx,
  updateCachedBalance
};
//# sourceMappingURL=balances.js.map
