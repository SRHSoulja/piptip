// src/services/treasury.ts
import { JsonRpcProvider, Contract } from "ethers";
import { ABSTRACT_RPC_URL, TREASURY_AGW_ADDRESS } from "../config.js";
import { getActiveTokens, fromAtomicDirect, TokenRow } from "./token.js";

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

  const provider = new JsonRpcProvider(ABSTRACT_RPC_URL);
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
