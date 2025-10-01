import "dotenv/config";
import { formatUnits, parseUnits } from "ethers";
import { prisma } from "./db.js";
import { userHasActiveTaxFreeTier } from "./tiers.js";
import { cache, CacheKeys, CacheTTL } from "./cache.js";
import { getCachedTokenPrice } from "./price_api.js";
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
function tipBps(token, cfg) {
  return (token.tipFeeBps ?? cfg?.tipFeeBps ?? 0) | 0;
}
function houseBps(token, cfg) {
  return (token.houseFeeBps ?? cfg?.houseFeeBps ?? 0) | 0;
}
let _tokens = [];
let _tokensTs = 0;
const TOKENS_TTL_MS = 1e4;
async function getActiveTokens(force = false) {
  if (!force) {
    const cachedTokens = await cache.get(CacheKeys.ACTIVE_TOKENS);
    if (cachedTokens && cachedTokens.length > 0) {
      _tokens = cachedTokens;
      _tokensTs = Date.now();
      return _tokens;
    }
  }
  const now = Date.now();
  if (!force && now - _tokensTs < TOKENS_TTL_MS && _tokens.length) return _tokens;
  const rows = await prisma.token.findMany({
    where: { active: true },
    orderBy: { symbol: "asc" }
  });
  _tokens = rows.map((r) => ({
    ...r,
    address: r.address.toLowerCase(),
    decimals: Number(r.decimals)
  }));
  await cache.set(CacheKeys.ACTIVE_TOKENS, _tokens, CacheTTL.TOKENS);
  _tokensTs = now;
  return _tokens;
}
async function getTokenByAddress(address) {
  const tokens = await getActiveTokens();
  return tokens.find((t) => t.address === address.toLowerCase()) ?? null;
}
async function getTokenBySymbol(symbol) {
  const tokens = await getActiveTokens();
  return tokens.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
}
async function getTokenById(tokenId) {
  const tokens = await getActiveTokens();
  return tokens.find((t) => t.id === tokenId) ?? null;
}
function toAtomicDirect(amount, decimals) {
  return parseUnits(String(amount), decimals);
}
function fromAtomicDirect(atomic, decimals) {
  return formatUnits(atomic, decimals);
}
function decToBigDirect(dec, decimals) {
  return parseUnits(String(dec), decimals);
}
function bigToDecDirect(atomic, decimals) {
  return formatUnits(atomic, decimals);
}
function formatAmount(atomic, token) {
  const human = fromAtomicDirect(atomic, token.decimals);
  const num = Number(human);
  let formatted = num.toFixed(2).replace(/\.?0+$/, "");
  return `${formatted} ${token.symbol}`;
}
function formatDecimal(dec, symbol) {
  const num = Number(dec ?? 0);
  let formatted = num.toFixed(2).replace(/\.?0+$/, "");
  return `${formatted} ${symbol}`;
}
async function formatDecimalWithUSD(dec, symbol, options) {
  const num = Number(dec ?? 0);
  const { showSymbol = true, compact = false, skipUSDBelow = 0.01 } = options || {};
  let formatted = num.toFixed(2).replace(/\.?0+$/, "");
  let result = showSymbol ? `${formatted} ${symbol}` : formatted;
  try {
    const usdPrice = await getCachedTokenPrice(symbol);
    const usdValue = num * usdPrice;
    if (usdValue >= skipUSDBelow && usdPrice > 0) {
      const usdFormatted = usdValue < 1 ? `$${usdValue.toFixed(4).replace(/\.?0+$/, "")}` : `$${usdValue.toFixed(2).replace(/\.?0+$/, "")}`;
      if (compact) {
        result += ` (${usdFormatted})`;
      } else {
        result += ` \u2022 ${usdFormatted} USD`;
      }
    }
  } catch (error) {
    console.warn(`Failed to get USD price for ${symbol}:`, error);
  }
  return result;
}
async function formatAmountWithUSD(atomic, token, options) {
  const human = fromAtomicDirect(atomic, token.decimals);
  return await formatDecimalWithUSD(human, token.symbol, options);
}
async function getDefaultToken() {
  const tokens = await getActiveTokens();
  const pengu = tokens.find((t) => t.symbol.toLowerCase() === "pengu");
  const defaultToken = pengu || tokens[0];
  if (!defaultToken) throw new Error("No active tokens configured");
  return defaultToken;
}
async function toAtomic(amount) {
  const token = await getDefaultToken();
  return parseUnits(String(amount), token.decimals);
}
async function fromAtomic(atomic) {
  const token = await getDefaultToken();
  return formatUnits(atomic, token.decimals);
}
async function decToBig(dec) {
  const token = await getDefaultToken();
  return parseUnits(String(dec), token.decimals);
}
async function bigToDec(atomic) {
  const token = await getDefaultToken();
  return formatUnits(atomic, token.decimals);
}
async function fmt(atomic) {
  const token = await getDefaultToken();
  return formatAmount(atomic, token);
}
const fmtBig = fmt;
function fmtDec(dec, symbol = "PENGU") {
  return formatDecimal(dec, symbol);
}
async function getEffectiveTipFeeBps(fromUserId, tokenId) {
  if (await userHasActiveTaxFreeTier(fromUserId)) return 0;
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    select: { tipFeeBps: true }
  });
  if (token?.tipFeeBps != null) return token.tipFeeBps;
  const cfg = await prisma.appConfig.findFirst({
    orderBy: { id: "desc" },
    select: { tipFeeBps: true }
  });
  return cfg?.tipFeeBps ?? 100;
}
export {
  TOKEN_ADDRESS,
  bigToDec,
  bigToDecDirect,
  decToBig,
  decToBigDirect,
  fmt,
  fmtBig,
  fmtDec,
  formatAmount,
  formatAmountWithUSD,
  formatDecimal,
  formatDecimalWithUSD,
  fromAtomic,
  fromAtomicDirect,
  getActiveTokens,
  getEffectiveTipFeeBps,
  getTokenByAddress,
  getTokenById,
  getTokenBySymbol,
  houseBps,
  tipBps,
  toAtomic,
  toAtomicDirect
};
//# sourceMappingURL=token.js.map
