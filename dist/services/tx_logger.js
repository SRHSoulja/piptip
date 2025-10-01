import { getCachedTokenPrices } from "./price_api.js";
import { formatUnits } from "ethers";
import { bigintToDecimal } from "../utils/decimal_helpers.js";
async function logCompleteTransaction(tx, params) {
  const {
    operation,
    userId,
    otherUserId,
    guildId,
    balanceChanges,
    metadata,
    blockchainTxHash,
    idempotencyKey,
    source = "BOT",
    status = "CONFIRMED",
    opRef
  } = params;
  const existing = await tx.transaction.findUnique({
    where: { idempotencyKey },
    include: { balanceDeltas: true }
  });
  if (existing) {
    console.log(`Transaction already exists for idempotency key: ${idempotencyKey}`);
    return {
      transactionId: existing.id,
      balanceDeltaIds: existing.balanceDeltas.map((d) => d.id)
    };
  }
  const totalAmount = balanceChanges.reduce((sum, change) => {
    return sum + (change.amountDelta > 0n ? change.amountDelta : 0n);
  }, 0n);
  const totalFee = balanceChanges.reduce((sum, change) => {
    return sum + (change.amountDelta < 0n && change.reason?.includes("fee") ? -change.amountDelta : 0n);
  }, 0n);
  const primaryTokenId = balanceChanges[0]?.tokenId;
  const primaryToken = primaryTokenId ? await tx.token.findUnique({
    where: { id: primaryTokenId },
    select: { symbol: true, decimals: true }
  }) : null;
  let usdValue = null;
  let usdFeeValue = null;
  let usdPrice = null;
  let priceSource = null;
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
        priceSource = "cached_global";
      }
    } catch (error) {
      console.warn(`Failed to get USD values for transaction: ${error}`);
    }
  }
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
  const balanceDeltaIds = [];
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
  console.log(`\u2705 Logged complete transaction: ${operation} (id: ${transaction.id}, deltas: ${balanceDeltaIds.length})`);
  return {
    transactionId: transaction.id,
    balanceDeltaIds
  };
}
async function logTip(tx, params) {
  const balanceChanges = [
    {
      tokenId: params.tokenId,
      userId: params.fromUserId,
      amountDelta: -(params.amount + params.fee),
      // Debit sender (amount + fee)
      reason: "tip_sent"
    }
  ];
  if (params.toUserId) {
    balanceChanges.push({
      tokenId: params.tokenId,
      userId: params.toUserId,
      amountDelta: params.amount,
      // Credit recipient (amount only)
      reason: "tip_received"
    });
  }
  if (params.fee > 0n) {
    balanceChanges.push({
      tokenId: params.tokenId,
      userId: void 0,
      // House fee
      amountDelta: params.fee,
      reason: "tip_fee"
    });
  }
  return logCompleteTransaction(tx, {
    operation: "TIP",
    userId: params.fromUserId,
    otherUserId: params.toUserId,
    guildId: params.guildId,
    balanceChanges,
    metadata: { note: params.note },
    idempotencyKey: params.idempotencyKey,
    source: "BOT"
  });
}
async function logDeposit(tx, params) {
  return logCompleteTransaction(tx, {
    operation: "DEPOSIT",
    userId: params.userId,
    balanceChanges: [{
      tokenId: params.tokenId,
      userId: params.userId,
      amountDelta: params.amount,
      reason: "deposit"
    }],
    blockchainTxHash: params.txHash,
    idempotencyKey: params.idempotencyKey,
    source: "WORKER"
  });
}
async function logWithdraw(tx, params) {
  const balanceChanges = [
    {
      tokenId: params.tokenId,
      userId: params.userId,
      amountDelta: -(params.amount + params.fee),
      reason: "withdraw"
    }
  ];
  if (params.fee > 0n) {
    balanceChanges.push({
      tokenId: params.tokenId,
      userId: void 0,
      // House fee
      amountDelta: params.fee,
      reason: "withdraw_fee"
    });
  }
  return logCompleteTransaction(tx, {
    operation: "WITHDRAW",
    userId: params.userId,
    balanceChanges,
    blockchainTxHash: params.txHash,
    idempotencyKey: params.idempotencyKey,
    source: "BOT"
  });
}
async function logPredictionWager(tx, params) {
  return logCompleteTransaction(tx, {
    operation: "PREDICTION_BET",
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
    source: "BOT"
  });
}
async function logPredictionPayout(tx, params) {
  return logCompleteTransaction(tx, {
    operation: "PREDICTION_WIN",
    userId: params.userId,
    balanceChanges: [{
      tokenId: params.tokenId,
      userId: params.userId,
      amountDelta: params.amount,
      reason: "prediction_payout"
    }],
    metadata: { marketId: params.marketId },
    idempotencyKey: params.idempotencyKey,
    opRef: params.marketId,
    source: "BOT"
  });
}
async function logTreasurySwap(tx, params) {
  return logCompleteTransaction(tx, {
    operation: "TREASURY_SWAP",
    balanceChanges: [
      {
        tokenId: params.fromTokenId,
        amountDelta: -params.fromAmount,
        reason: "treasury_swap_out"
      },
      {
        tokenId: params.toTokenId,
        amountDelta: params.toAmount,
        reason: "treasury_swap_in"
      }
    ],
    blockchainTxHash: params.txHash,
    idempotencyKey: params.idempotencyKey,
    source: "TREASURY"
  });
}
async function logSnapshotPublish(tx, params) {
  return logCompleteTransaction(tx, {
    operation: "SNAPSHOT_PUBLISH",
    balanceChanges: [{
      tokenId: 1,
      // Assume ETH token for gas costs
      amountDelta: 0n,
      // Zero delta for audit purposes
      reason: "snapshot_publish_audit"
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
    source: "TREASURY"
  });
}
async function logTxAtomicTx(db, params) {
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
  const idempotencyKey = `legacy_${type}_${userId}_${tokenId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const balanceChanges = [];
  switch (type) {
    case "DEPOSIT":
      balanceChanges.push({
        tokenId,
        userId: userId || void 0,
        amountDelta: amountAtomic,
        reason: "deposit"
      });
      break;
    case "WITHDRAW":
      balanceChanges.push({
        tokenId,
        userId: userId || void 0,
        amountDelta: -(amountAtomic + feeAtomic),
        reason: "withdraw"
      });
      if (feeAtomic > 0n) {
        balanceChanges.push({
          tokenId,
          amountDelta: feeAtomic,
          reason: "withdraw_fee"
        });
      }
      break;
    case "TIP":
      if (userId) {
        balanceChanges.push({
          tokenId,
          userId,
          amountDelta: -(amountAtomic + feeAtomic),
          reason: "tip_sent"
        });
      }
      if (otherUserId) {
        balanceChanges.push({
          tokenId,
          userId: otherUserId,
          amountDelta: amountAtomic,
          reason: "tip_received"
        });
      }
      if (feeAtomic > 0n) {
        balanceChanges.push({
          tokenId,
          amountDelta: feeAtomic,
          reason: "tip_fee"
        });
      }
      break;
    default:
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
      userId: userId || void 0,
      otherUserId: otherUserId || void 0,
      guildId: guildId || void 0,
      balanceChanges,
      metadata: note ? { note } : void 0,
      blockchainTxHash: txHash || void 0,
      idempotencyKey,
      source: "BOT"
    });
  }
}
export {
  logCompleteTransaction,
  logDeposit,
  logPredictionPayout,
  logPredictionWager,
  logSnapshotPublish,
  logTip,
  logTreasurySwap,
  logTxAtomicTx,
  logWithdraw
};
//# sourceMappingURL=tx_logger.js.map
