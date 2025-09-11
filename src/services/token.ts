// src/services/token.ts
import "dotenv/config";
import { formatUnits, parseUnits } from "ethers";
import { prisma } from "./db.js";
import { userHasActiveTaxFreeTier } from "./tiers.js";


/** For legacy callers that still read a single TOKEN_ADDRESS */
export const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS!;

export type TokenRow = {
  id: number;
  address: string;  // lowercased 0x...
  symbol: string;
  decimals: number;
  minDeposit: any;       // Prisma.Decimal (human)
  minWithdraw: any;      // Prisma.Decimal (human)
  active: boolean;

  // withdraw overrides (null = use AppConfig)
  withdrawMaxPerTx: any | null;
  withdrawDailyCap: any | null;

  // NEW fee overrides (null = use AppConfig)
  tipFeeBps: number | null;
  houseFeeBps: number | null;
};

export function tipBps(token: TokenRow, cfg?: { tipFeeBps: number }): number {
  return (token.tipFeeBps ?? cfg?.tipFeeBps ?? 0) | 0;
}
export function houseBps(token: TokenRow, cfg?: { houseFeeBps: number }): number {
  return (token.houseFeeBps ?? cfg?.houseFeeBps ?? 0) | 0;
}



let _tokens: TokenRow[] = [];
let _tokensTs = 0;
const TOKENS_TTL_MS = 10_000;

/** Load active tokens (cached). */
export async function getActiveTokens(force = false): Promise<TokenRow[]> {
  const now = Date.now();
  if (!force && now - _tokensTs < TOKENS_TTL_MS && _tokens.length) return _tokens;

  // We fetch all fields; mapping below normalizes address/decimals
  const rows = await prisma.token.findMany({
    where: { active: true },
    orderBy: { symbol: "asc" },
  });

  _tokens = rows.map((r) => ({
    ...r,
    address: r.address.toLowerCase(),
    decimals: Number(r.decimals),
  })) as unknown as TokenRow[];

  _tokensTs = now;
  return _tokens;
}

/** Find token by address (lowercased). */
export async function getTokenByAddress(address: string): Promise<TokenRow | null> {
  const tokens = await getActiveTokens();
  return tokens.find((t) => t.address === address.toLowerCase()) ?? null;
}

/** Find token by symbol (case-insensitive). */
export async function getTokenBySymbol(symbol: string): Promise<TokenRow | null> {
  const tokens = await getActiveTokens();
  return tokens.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
}

/** Get token by ID. */
export async function getTokenById(tokenId: number): Promise<TokenRow | null> {
  const tokens = await getActiveTokens();
  return tokens.find((t) => t.id === tokenId) ?? null;
}

/** Convert human amount to atomic units (bigint) - direct version */
export function toAtomicDirect(amount: number | string, decimals: number): bigint {
  return parseUnits(String(amount), decimals);
}

/** Convert atomic units to human-readable string - direct version */
export function fromAtomicDirect(atomic: bigint, decimals: number): string {
  return formatUnits(atomic, decimals);
}

/** Convert DB Decimal to atomic bigint - direct version */
export function decToBigDirect(dec: any, decimals: number): bigint {
  return parseUnits(String(dec), decimals);
}

/** Convert atomic bigint to DB Decimal string - direct version */
export function bigToDecDirect(atomic: bigint, decimals: number): string {
  return formatUnits(atomic, decimals);
}

/** Format atomic amount with symbol (limited to 2 decimal places for user display) */
export function formatAmount(atomic: bigint, token: TokenRow): string {
  const human = fromAtomicDirect(atomic, token.decimals);
  const num = Number(human);
  
  // Format to 2 decimal places and remove trailing zeros
  let formatted = num.toFixed(2).replace(/\.?0+$/, "");
  
  return `${formatted} ${token.symbol}`;
}

/** Format decimal amount with symbol (limited to 2 decimal places for user display) */
export function formatDecimal(dec: any, symbol: string): string {
  const num = Number(dec ?? 0);
  
  // Format to 2 decimal places and remove trailing zeros
  let formatted = num.toFixed(2).replace(/\.?0+$/, "");
  
  return `${formatted} ${symbol}`;
}

/** Get default token (for legacy compatibility) */
async function getDefaultToken(): Promise<TokenRow> {
  const tokens = await getActiveTokens();
  // Try to find PENGU first (your main token), then fallback to first active
  const pengu = tokens.find((t) => t.symbol.toLowerCase() === "pengu");
  const defaultToken = pengu || tokens[0];
  if (!defaultToken) throw new Error("No active tokens configured");
  return defaultToken;
}

/* ------- Legacy async helpers for backward compatibility ------- */

export async function toAtomic(amount: number | string): Promise<bigint> {
  const token = await getDefaultToken();
  return parseUnits(String(amount), token.decimals);
}

export async function fromAtomic(atomic: bigint): Promise<string> {
  const token = await getDefaultToken();
  return formatUnits(atomic, token.decimals);
}

export async function decToBig(dec: any): Promise<bigint> {
  const token = await getDefaultToken();
  return parseUnits(String(dec), token.decimals);
}

export async function bigToDec(atomic: bigint): Promise<string> {
  const token = await getDefaultToken();
  return formatUnits(atomic, token.decimals);
}

export async function fmt(atomic: bigint): Promise<string> {
  const token = await getDefaultToken();
  return formatAmount(atomic, token);
}

export const fmtBig = fmt; // alias

/** Format decimal (human units) with symbol - for UI display */
export function fmtDec(dec: any, symbol = "PENGU"): string {
  return formatDecimal(dec, symbol);
}

/**
 * Effective tip fee BPS for a given sender & token.
 * - 0 if the user has any ACTIVE tier with tipTaxFree = true
 * - otherwise token.tipFeeBps if set
 * - otherwise the latest AppConfig.tipFeeBps
 * - finally falls back to 100 if nothing set
 */
export async function getEffectiveTipFeeBps(
  fromUserId: number,
  tokenId: number
): Promise<number> {
  // 1) Tax-free membership?
  if (await userHasActiveTaxFreeTier(fromUserId)) return 0;

  // 2) Token-level override?
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    select: { tipFeeBps: true },
  });
  if (token?.tipFeeBps != null) return token.tipFeeBps;

  // 3) App default
  const cfg = await prisma.appConfig.findFirst({
    orderBy: { id: "desc" },
    select: { tipFeeBps: true },
  });
  return cfg?.tipFeeBps ?? 100;
}
