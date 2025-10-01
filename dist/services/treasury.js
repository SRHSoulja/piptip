import { JsonRpcProvider, Contract } from "ethers";
import { TREASURY_AGW_ADDRESS } from "../config.js";
import { getAbstractRpcUrl } from "./network.js";
import { getActiveTokens, fromAtomicDirect } from "./token.js";
import { logCompleteTransaction } from "./tx_logger.js";
import { prisma } from "./db.js";
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
let _cache = null;
let _ts = 0;
const TTL_MS = 15e3;
async function getTreasurySnapshot(force = false) {
  const now = Date.now();
  if (!force && _cache && now - _ts < TTL_MS) return _cache;
  const provider = new JsonRpcProvider(getAbstractRpcUrl());
  const addr = TREASURY_AGW_ADDRESS.toLowerCase();
  const [tokens, eth] = await Promise.all([
    getActiveTokens(),
    provider.getBalance(addr)
    // bigint
  ]);
  const tokenBalances = await Promise.all(
    tokens.map(async (t) => {
      const c = new Contract(t.address, ERC20_ABI, provider);
      const bal = await c.balanceOf(addr);
      return {
        id: t.id,
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals,
        atomic: bal.toString(),
        human: fromAtomicDirect(bal, t.decimals)
      };
    })
  );
  const snap = {
    ts: now,
    ethAtomic: eth.toString(),
    ethHuman: (Number(eth) / 1e18).toString(),
    // simple wei->ETH; use formatUnits if you prefer
    tokens: tokenBalances
  };
  _cache = snap;
  _ts = now;
  return snap;
}
function invalidateTreasuryCache() {
  _cache = null;
  _ts = 0;
}
async function logTreasurySwap(params) {
  return prisma.$transaction(async (tx) => {
    const idempotencyKey = `treasury_swap_${params.txHash}`;
    return logCompleteTransaction(tx, {
      operation: "TREASURY_SWAP",
      userId: params.adminUserId,
      balanceChanges: [
        {
          tokenId: params.fromTokenId,
          userId: void 0,
          // Treasury operation
          amountDelta: -params.fromAmount,
          reason: "treasury_swap_out"
        },
        {
          tokenId: params.toTokenId,
          userId: void 0,
          // Treasury operation
          amountDelta: params.toAmount,
          reason: "treasury_swap_in"
        }
      ],
      metadata: {
        reason: params.reason || "Treasury swap",
        fromTokenId: params.fromTokenId,
        toTokenId: params.toTokenId,
        fromAmount: params.fromAmount.toString(),
        toAmount: params.toAmount.toString(),
        adminUserId: params.adminUserId
      },
      blockchainTxHash: params.txHash,
      idempotencyKey,
      source: "TREASURY"
    });
  });
}
async function logTreasuryOperation(params) {
  return prisma.$transaction(async (tx) => {
    const timestamp = Date.now();
    const idempotencyKey = `treasury_op_${params.operation}_${params.tokenId}_${timestamp}`;
    const amountDelta = params.direction === "out" ? -params.amount : params.amount;
    return logCompleteTransaction(tx, {
      operation: params.operation,
      userId: params.adminUserId,
      balanceChanges: [{
        tokenId: params.tokenId,
        userId: void 0,
        // Treasury operation
        amountDelta,
        reason: params.reason
      }],
      metadata: {
        reason: params.reason,
        direction: params.direction || "in",
        adminUserId: params.adminUserId,
        amount: params.amount.toString()
      },
      blockchainTxHash: params.txHash,
      idempotencyKey,
      source: "TREASURY"
    });
  });
}
export {
  getTreasurySnapshot,
  invalidateTreasuryCache,
  logTreasuryOperation,
  logTreasurySwap
};
//# sourceMappingURL=treasury.js.map
