// src/services/deposits.ts
import { prisma } from "../services/db.js";
import { getTokenByAddress, toAtomicDirect } from "../services/token.js";
import { creditToken } from "../services/balances.js";

const TREASURY = (process.env.TREASURY_AGW_ADDRESS || "").toLowerCase();

export type ApplyDepositInput = {
  from: string;              // sender wallet (user)
  to: string;                // must be treasury
  token: string;             // erc20 address (lowercase)
  valueAtomic: string | bigint; // atomic units
  tx: string;                // tx hash (idempotency key)
};

/**
 * Core deposit handler. Used by the webhook AND /internal/credit (PHP relay).
 * Enforces: treasury address, active token, minDeposit per token, idempotency, wallet link.
 */
export async function applyDeposit(input: ApplyDepositInput) {
  const from = input.from.toLowerCase();
  const to   = input.to.toLowerCase();
  const tok  = input.token.toLowerCase();
  const amt  = BigInt(input.valueAtomic);

  if (!TREASURY || to !== TREASURY) return { ok: false, reason: "wrong treasury" };

  const tokenRow = await getTokenByAddress(tok);
  if (!tokenRow || !tokenRow.active) return { ok: false, reason: "token not active/known" };

  // Idempotency
  const key = `${input.tx}:${from}:${amt}`;
  try { await prisma.processedDeposit.create({ data: { key } }); }
  catch { return { ok: true, duplicate: true }; }

  // Enforce per-token minimum from DB (Decimal -> atomic)
  const minAtomic = toAtomicDirect(String(tokenRow.minDeposit), tokenRow.decimals);
  if (amt < minAtomic) {
    return { ok: true, skipped: `below minimum ${tokenRow.minDeposit} ${tokenRow.symbol}` };
  }

  // Must be a linked wallet
  const user = await prisma.user.findFirst({ where: { agwAddress: from } });
  if (!user) return { ok: true, ignored: "wallet not linked" };

  // Credit balance & record (creditToken already writes Transaction rows if you do that there)
  await creditToken(user.discordId, tokenRow.id, amt, "DEPOSIT", { txHash: input.tx });

  return { ok: true, credited: true, userId: user.id, token: tokenRow.symbol, amount: amt.toString() };
}
