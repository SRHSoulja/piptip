// src/services/treasury.ts
import { JsonRpcProvider, Contract } from "ethers";
import { TREASURY_AGW_ADDRESS } from "../config.js";
import { getAbstractRpcUrl } from "./network.js";
import { getActiveTokens, fromAtomicDirect, TokenRow } from "./token.js";
import { logCompleteTransaction } from "./tx_logger.js";
import { prisma } from "./db.js";

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

export type TreasuryTokenBalance = {
  id: number;
  symbol: string;
  address: string;
  decimals: number;
  atomic: string; // bigint string
  human: string;  // formatted decimal string
};

export type TreasurySnapshot = {
  ts: number;
  ethAtomic: string;  // bigint string
  ethHuman: string;   // decimal string (wei -> ether)
  tokens: TreasuryTokenBalance[];
};

let _cache: TreasurySnapshot | null = null;
let _ts = 0;
const TTL_MS = 15_000;

export async function getTreasurySnapshot(force = false): Promise<TreasurySnapshot> {
  const now = Date.now();
  if (!force && _cache && now - _ts < TTL_MS) return _cache;

  const provider = new JsonRpcProvider(getAbstractRpcUrl());
  const addr = TREASURY_AGW_ADDRESS.toLowerCase();

  const [tokens, eth] = await Promise.all([
    getActiveTokens(),
    provider.getBalance(addr), // bigint
  ]);

  const tokenBalances = await Promise.all(
    tokens.map(async (t: TokenRow) => {
      const c = new Contract(t.address, ERC20_ABI, provider);
      const bal: bigint = await c.balanceOf(addr);
      return {
        id: t.id,
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals,
        atomic: bal.toString(),
        human: fromAtomicDirect(bal, t.decimals),
      };
    })
  );

  const snap: TreasurySnapshot = {
    ts: now,
    ethAtomic: eth.toString(),
    ethHuman: (Number(eth) / 1e18).toString(), // simple wei->ETH; use formatUnits if you prefer
    tokens: tokenBalances,
  };

  _cache = snap;
  _ts = now;
  return snap;
}

export function invalidateTreasuryCache() {
  _cache = null;
  _ts = 0;
}

/**
 * Log treasury swap operation with Transaction + BalanceDelta
 *
 * Example usage for DEX swaps or treasury rebalancing:
 *
 * ```typescript
 * await logTreasurySwap({
 *   fromTokenId: 1,
 *   toTokenId: 2,
 *   fromAmount: 1000000000000000000n, // 1 token A
 *   toAmount: 2000000000000000000n,   // 2 token B
 *   txHash: '0x...',
 *   reason: 'Treasury rebalancing via DEX',
 *   adminUserId: 123
 * });
 * ```
 */
export async function logTreasurySwap(params: {
  fromTokenId: number;
  toTokenId: number;
  fromAmount: bigint;
  toAmount: bigint;
  txHash: string;
  reason?: string;
  adminUserId?: number;
}): Promise<{ transactionId: number; balanceDeltaIds: number[] }> {
  return prisma.$transaction(async (tx) => {
    const idempotencyKey = `treasury_swap_${params.txHash}`;

    return logCompleteTransaction(tx, {
      operation: 'TREASURY_SWAP',
      userId: params.adminUserId,
      balanceChanges: [
        {
          tokenId: params.fromTokenId,
          userId: undefined, // Treasury operation
          amountDelta: -params.fromAmount,
          reason: 'treasury_swap_out'
        },
        {
          tokenId: params.toTokenId,
          userId: undefined, // Treasury operation
          amountDelta: params.toAmount,
          reason: 'treasury_swap_in'
        }
      ],
      metadata: {
        reason: params.reason || 'Treasury swap',
        fromTokenId: params.fromTokenId,
        toTokenId: params.toTokenId,
        fromAmount: params.fromAmount.toString(),
        toAmount: params.toAmount.toString(),
        adminUserId: params.adminUserId
      },
      blockchainTxHash: params.txHash,
      idempotencyKey,
      source: 'TREASURY'
    });
  });
}

/**
 * Log generic treasury operation (admin actions, fee collection, etc.)
 *
 * Example usage:
 *
 * ```typescript
 * await logTreasuryOperation({
 *   operation: 'TREASURY_FEE_COLLECTION',
 *   tokenId: 1,
 *   amount: 5000000000000000000n, // 5 tokens
 *   txHash: '0x...',
 *   reason: 'Weekly fee collection',
 *   adminUserId: 123
 * });
 * ```
 */
export async function logTreasuryOperation(params: {
  operation: string;
  tokenId: number;
  amount: bigint;
  txHash?: string;
  reason: string;
  adminUserId?: number;
  direction?: 'in' | 'out'; // 'out' for outgoing (negative), 'in' for incoming (positive)
}): Promise<{ transactionId: number; balanceDeltaIds: number[] }> {
  return prisma.$transaction(async (tx) => {
    const timestamp = Date.now();
    const idempotencyKey = `treasury_op_${params.operation}_${params.tokenId}_${timestamp}`;

    const amountDelta = params.direction === 'out' ? -params.amount : params.amount;

    return logCompleteTransaction(tx, {
      operation: params.operation,
      userId: params.adminUserId,
      balanceChanges: [{
        tokenId: params.tokenId,
        userId: undefined, // Treasury operation
        amountDelta,
        reason: params.reason
      }],
      metadata: {
        reason: params.reason,
        direction: params.direction || 'in',
        adminUserId: params.adminUserId,
        amount: params.amount.toString()
      },
      blockchainTxHash: params.txHash,
      idempotencyKey,
      source: 'TREASURY'
    });
  });
}
