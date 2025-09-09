// services/rake.ts
import { bigToDec } from "./token.js";
import { getConfig } from "../config.js";

/**
 * Calculates pot, rake, and payout for a 1v1 (2 * wager) match
 * using the current AppConfig.houseFeeBps.
 *
 * Returns BigInt values plus a helper to get Prisma Decimals.
 */
export async function calcRpsPayout(wagerAtomic: bigint) {
  if (wagerAtomic < 0n) throw new Error("wager must be >= 0");
  const cfg = await getConfig(); // pulls from AppConfig with caching
  const HOUSE_FEE_BPS = BigInt(cfg.houseFeeBps ?? 200);

  const pot = 2n * wagerAtomic;
  const rake = (pot * HOUSE_FEE_BPS) / 10000n;
  const payout = pot - rake;

  return { pot, rake, payout };
}

/**
 * Convenience helpers (Decimals ready for Prisma writes)
 */
export async function payoutAsDecs(wagerAtomic: bigint) {
  const { pot, rake, payout } = await calcRpsPayout(wagerAtomic);
  return {
    potDec: bigToDec(pot),
    rakeDec: bigToDec(rake),
    payoutDec: bigToDec(payout),
  };
}
