// src/services/tx_logger.ts - Transaction logging single source of truth
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { getCachedTokenPrices } from "./price_api.js";
import { formatUnits } from "ethers";
import { bigintToDecimal } from "../utils/decimal_helpers.js";

export type Tx = Prisma.TransactionClient;

export interface BalanceChange {
  tokenId: number;
  userId?: number;
  amountDelta: bigint; // signed amount (positive = credit, negative = debit)
  reason?: string;
}

export interface LogTransactionParams {
  operation: string; // TIP, DEPOSIT, WITHDRAW, MATCH_WAGER, MATCH_PAYOUT, PREDICTION_BET, PREDICTION_WIN, SNAPSHOT_PUBLISH, etc.
  userId?: number;
  otherUserId?: number;
  guildId?: string;
  balanceChanges: BalanceChange[];
  metadata?: any;
  blockchainTxHash?: string;
  idempotencyKey: string;
  source?: 'BOT' | 'WORKER' | 'ADMIN' | 'TREASURY';
  status?: 'PENDING' | 'CONFIRMED' | 'REVERTED';
  opRef?: string; // correlation id for multi-step operations
}

/**
 * Log a complete transaction with balance deltas - the single source of truth
 */
export async function logCompleteTransaction(
  tx: Tx,
  params: LogTransactionParams
): Promise<{ transactionId: number; balanceDeltaIds: number[] }> {
  const {
    operation,
    userId,
    otherUserId,
    guildId,
    balanceChanges,
    metadata,
    blockchainTxHash,
    idempotencyKey,
    source = 'BOT',
    status = 'CONFIRMED',
    opRef
  } = params;

  // Check for existing transaction with same idempotency key
  const existing = await tx.transaction.findUnique({
    where: { idempotencyKey },
    include: { balanceDeltas: true }
  });

  if (existing) {
    console.log(`Transaction already exists for idempotency key: ${idempotencyKey}`);
    return {
      transactionId: existing.id,
      balanceDeltaIds: existing.balanceDeltas.map(d => d.id)
    };
  }

  // Calculate aggregate amounts for the main Transaction record
  const totalAmount = balanceChanges.reduce((sum, change) => {
    return sum + (change.amountDelta > 0n ? change.amountDelta : 0n);
  }, 0n);

  const totalFee = balanceChanges.reduce((sum, change) => {
    // Fees are typically negative amounts in admin/treasury operations
    return sum + (change.amountDelta < 0n && change.reason?.includes('fee') ? -change.amountDelta : 0n);
  }, 0n);

  // Get primary token for USD value tracking
  const primaryTokenId = balanceChanges[0]?.tokenId;
  const primaryToken = primaryTokenId ? await tx.token.findUnique({
    where: { id: primaryTokenId },
    select: { symbol: true, decimals: true }
  }) : null;

  // Capture USD values if possible
  let usdValue: number | null = null;
  let usdFeeValue: number | null = null;
  let usdPrice: number | null = null;
  let priceSource: string | null = null;

  if (primaryToken && totalAmount > 0n) {
    try {
      const prices = await getCachedTokenPrices([primaryToken.symbol]);
      const tokenPrice = prices[primaryToken.symbol];
      if (tokenPrice && tokenPrice > 0) {
        const amountInTokens = parseFloat(formatUnits(totalAmount, primaryToken.decimals));
        const feeInTokens = parseFloat(formatUnits(totalFee, primaryToken.decimals));

        usdPrice = tokenPrice;
        usdValue = amountInTokens * tokenPrice;
        usdFeeValue = feeInTokens * tokenPrice;
        priceSource = 'cached_global';
      }
    } catch (error) {
      console.warn(`Failed to get USD values for transaction: ${error}`);
    }
  }

  // Create main Transaction record
  const transaction = await tx.transaction.create({
    data: {
      type: operation,
      userId,
      otherUserId,
      guildId,
      tokenId: primaryTokenId,
      amount: formatUnits(totalAmount, primaryToken?.decimals || 18),
      fee: formatUnits(totalFee, primaryToken?.decimals || 18),
      txHash: blockchainTxHash,
      metadata: metadata ? JSON.stringify(metadata) : null,
      idempotencyKey,
      source,
      status,
      opRef,
      usdValue,
      usdFeeValue,
      usdPrice,
      priceSource
    }
  });

  // Create BalanceDelta records
  const balanceDeltaIds: number[] = [];
  for (const change of balanceChanges) {
    const balanceDelta = await tx.balanceDelta.create({
      data: {
        transactionId: transaction.id,
        tokenId: change.tokenId,
        userId: change.userId,
        amountDelta: bigintToDecimal(change.amountDelta),
        reason: change.reason || operation
      }
    });

    balanceDeltaIds.push(balanceDelta.id);
  }

  console.log(`✅ Logged complete transaction: ${operation} (id: ${transaction.id}, deltas: ${balanceDeltaIds.length})`);

  return {
    transactionId: transaction.id,
    balanceDeltaIds
  };
}

/**
 * Adapter functions for common operations
 */

export async function logTip(
  tx: Tx,
  params: {
    fromUserId: number;
    toUserId?: number;
    tokenId: number;
    amount: bigint;
    fee: bigint;
    guildId?: string;
    note?: string;
    idempotencyKey: string;
  }
): Promise<{ transactionId: number; balanceDeltaIds: number[] }> {
  const balanceChanges: BalanceChange[] = [
    {
      tokenId: params.tokenId,
      userId: params.fromUserId,
      amountDelta: -(params.amount + params.fee), // Debit sender (amount + fee)
      reason: 'tip_sent'
    }
  ];

  if (params.toUserId) {
    balanceChanges.push({
      tokenId: params.tokenId,
      userId: params.toUserId,
      amountDelta: params.amount, // Credit recipient (amount only)
      reason: 'tip_received'
    });
  }

  if (params.fee > 0n) {
    balanceChanges.push({
      tokenId: params.tokenId,
      userId: undefined, // House fee
      amountDelta: params.fee,
      reason: 'tip_fee'
    });
  }

  return logCompleteTransaction(tx, {
    operation: 'TIP',
    userId: params.fromUserId,
    otherUserId: params.toUserId,
    guildId: params.guildId,
    balanceChanges,
    metadata: { note: params.note },
    idempotencyKey: params.idempotencyKey,
    source: 'BOT'
  });
}

export async function logDeposit(
  tx: Tx,
  params: {
    userId: number;
    tokenId: number;
    amount: bigint;
    txHash: string;
    idempotencyKey: string;
  }
): Promise<{ transactionId: number; balanceDeltaIds: number[] }> {
  return logCompleteTransaction(tx, {
    operation: 'DEPOSIT',
    userId: params.userId,
    balanceChanges: [{
      tokenId: params.tokenId,
      userId: params.userId,
      amountDelta: params.amount,
      reason: 'deposit'
    }],
    blockchainTxHash: params.txHash,
    idempotencyKey: params.idempotencyKey,
    source: 'WORKER'
  });
}

export async function logWithdraw(
  tx: Tx,
  params: {
    userId: number;
    tokenId: number;
    amount: bigint;
    fee: bigint;
    txHash?: string;
    idempotencyKey: string;
  }
): Promise<{ transactionId: number; balanceDeltaIds: number[] }> {
  const balanceChanges: BalanceChange[] = [
    {
      tokenId: params.tokenId,
      userId: params.userId,
      amountDelta: -(params.amount + params.fee),
      reason: 'withdraw'
    }
  ];

  if (params.fee > 0n) {
    balanceChanges.push({
      tokenId: params.tokenId,
      userId: undefined, // House fee
      amountDelta: params.fee,
      reason: 'withdraw_fee'
    });
  }

  return logCompleteTransaction(tx, {
    operation: 'WITHDRAW',
    userId: params.userId,
    balanceChanges,
    blockchainTxHash: params.txHash,
    idempotencyKey: params.idempotencyKey,
    source: 'BOT'
  });
}

export async function logPredictionWager(
  tx: Tx,
  params: {
    userId: number;
    marketId: string;
    tokenId: number;
    amount: bigint;
    side: string;
    idempotencyKey: string;
  }
): Promise<{ transactionId: number; balanceDeltaIds: number[] }> {
  return logCompleteTransaction(tx, {
    operation: 'PREDICTION_BET',
    userId: params.userId,
    balanceChanges: [{
      tokenId: params.tokenId,
      userId: params.userId,
      amountDelta: -params.amount,
      reason: `prediction_bet_${params.side}`
    }],
    metadata: { marketId: params.marketId, side: params.side },
    idempotencyKey: params.idempotencyKey,
    opRef: params.marketId,
    source: 'BOT'
  });
}

export async function logPredictionPayout(
  tx: Tx,
  params: {
    userId: number;
    marketId: string;
    tokenId: number;
    amount: bigint;
    idempotencyKey: string;
  }
): Promise<{ transactionId: number; balanceDeltaIds: number[] }> {
  return logCompleteTransaction(tx, {
    operation: 'PREDICTION_WIN',
    userId: params.userId,
    balanceChanges: [{
      tokenId: params.tokenId,
      userId: params.userId,
      amountDelta: params.amount,
      reason: 'prediction_payout'
    }],
    metadata: { marketId: params.marketId },
    idempotencyKey: params.idempotencyKey,
    opRef: params.marketId,
    source: 'BOT'
  });
}

export async function logTreasurySwap(
  tx: Tx,
  params: {
    fromTokenId: number;
    toTokenId: number;
    fromAmount: bigint;
    toAmount: bigint;
    txHash: string;
    idempotencyKey: string;
  }
): Promise<{ transactionId: number; balanceDeltaIds: number[] }> {
  return logCompleteTransaction(tx, {
    operation: 'TREASURY_SWAP',
    balanceChanges: [
      {
        tokenId: params.fromTokenId,
        amountDelta: -params.fromAmount,
        reason: 'treasury_swap_out'
      },
      {
        tokenId: params.toTokenId,
        amountDelta: params.toAmount,
        reason: 'treasury_swap_in'
      }
    ],
    blockchainTxHash: params.txHash,
    idempotencyKey: params.idempotencyKey,
    source: 'TREASURY'
  });
}

export async function logSnapshotPublish(
  tx: Tx,
  params: {
    merkleRoot: string;
    ipfsHash: string;
    gasUsed: bigint;
    l1Cost?: bigint;
    l2Cost?: bigint;
    txHash: string;
    idempotencyKey: string;
  }
): Promise<{ transactionId: number; balanceDeltaIds: number[] }> {
  return logCompleteTransaction(tx, {
    operation: 'SNAPSHOT_PUBLISH',
    balanceChanges: [{
      tokenId: 1, // Assume ETH token for gas costs
      amountDelta: 0n, // Zero delta for audit purposes
      reason: 'snapshot_publish_audit'
    }],
    metadata: {
      merkleRoot: params.merkleRoot,
      ipfsHash: params.ipfsHash,
      gasUsed: params.gasUsed.toString(),
      l1Cost: params.l1Cost?.toString(),
      l2Cost: params.l2Cost?.toString()
    },
    blockchainTxHash: params.txHash,
    idempotencyKey: params.idempotencyKey,
    source: 'TREASURY'
  });
}

/**
 * Backward compatibility: Make existing logTxAtomicTx delegate to new API
 */
export async function logTxAtomicTx(
  db: Tx,
  params: {
    userId: number | null;
    otherUserId?: number | null;
    guildId?: string | null;
    type: string;
    tokenId: number;
    decimals: number;
    amountAtomic: bigint;
    feeAtomic?: bigint;
    txHash?: string | null;
    note?: string | null;
    tokenSymbol?: string;
  }
): Promise<void> {
  const {
    userId,
    otherUserId = null,
    guildId = null,
    type,
    tokenId,
    amountAtomic,
    feeAtomic = 0n,
    txHash = null,
    note = null
  } = params;

  // Generate idempotency key from parameters
  const idempotencyKey = `legacy_${type}_${userId}_${tokenId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const balanceChanges: BalanceChange[] = [];

  // Map legacy types to balance changes
  switch (type) {
    case 'DEPOSIT':
      balanceChanges.push({
        tokenId,
        userId: userId || undefined,
        amountDelta: amountAtomic,
        reason: 'deposit'
      });
      break;

    case 'WITHDRAW':
      balanceChanges.push({
        tokenId,
        userId: userId || undefined,
        amountDelta: -(amountAtomic + feeAtomic),
        reason: 'withdraw'
      });
      if (feeAtomic > 0n) {
        balanceChanges.push({
          tokenId,
          amountDelta: feeAtomic,
          reason: 'withdraw_fee'
        });
      }
      break;

    case 'TIP':
      if (userId) {
        balanceChanges.push({
          tokenId,
          userId,
          amountDelta: -(amountAtomic + feeAtomic),
          reason: 'tip_sent'
        });
      }
      if (otherUserId) {
        balanceChanges.push({
          tokenId,
          userId: otherUserId,
          amountDelta: amountAtomic,
          reason: 'tip_received'
        });
      }
      if (feeAtomic > 0n) {
        balanceChanges.push({
          tokenId,
          amountDelta: feeAtomic,
          reason: 'tip_fee'
        });
      }
      break;

    default:
      // Generic case: treat as user operation
      if (userId) {
        balanceChanges.push({
          tokenId,
          userId,
          amountDelta: amountAtomic,
          reason: type.toLowerCase()
        });
      }
      break;
  }

  if (balanceChanges.length > 0) {
    await logCompleteTransaction(db, {
      operation: type,
      userId: userId || undefined,
      otherUserId: otherUserId || undefined,
      guildId: guildId || undefined,
      balanceChanges,
      metadata: note ? { note } : undefined,
      blockchainTxHash: txHash || undefined,
      idempotencyKey,
      source: 'BOT'
    });
  }
}