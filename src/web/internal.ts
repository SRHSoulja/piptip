// src/web/internal.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "../services/db.js";
import { getTokenByAddress, toAtomicDirect } from "../services/token.js";
import { creditToken } from "../services/balances.js";

const internalRouter = Router();

const INTERNAL_BEARER =
  process.env.INTERNAL_BEARER ?? process.env.NODE_INTERNAL_BEARER ?? "";

const TREASURY = (process.env.TREASURY_AGW_ADDRESS || "").toLowerCase();

function unauthorized(res: Response) {
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

// Optional preflight (handy if you ever call from a browser)
internalRouter.options("/credit", (_req: Request, res: Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.sendStatus(204);
});

/**
 * POST /internal/credit
 * Body JSON (forwarded by your PHP webhook or another relay):
 * {
 *   "from": "0xsender",                     // must match /pip_link agwAddress
 *   "to": "0xTreasury",                     // must equal TREASURY
 *   "token": "0x...",                       // token address in Token table
 *   "valueAtomic": "50000000000000000000",  // atomic units (string or 0x-hex string)
 *   "tx": "0x..."                           // tx hash, for idempotency key
 * }
 */
internalRouter.post("/credit", async (req: Request, res: Response) => {
  try {
    // Bearer auth
    const auth = req.headers.authorization ?? "";
    if (!INTERNAL_BEARER || auth !== `Bearer ${INTERNAL_BEARER}`) {
      return unauthorized(res);
    }

    // Basic shape
    const { from, to, token, valueAtomic, tx } = (req.body ?? {}) as {
      from?: string;
      to?: string;
      token?: string;
      valueAtomic?: string | number;
      tx?: string;
    };

    if (!from || !to || !token || valueAtomic == null || !tx) {
      return res.status(400).json({ ok: false, error: "missing fields" });
    }

    const fromAddr = String(from).trim().toLowerCase();
    const toAddr   = String(to).trim().toLowerCase();
    const tokAddr  = String(token).trim().toLowerCase();

    if (!TREASURY || toAddr !== TREASURY) {
      return res.status(400).json({ ok: false, error: "wrong treasury" });
    }

    // Find token in database & ensure it's active/allowlisted
    const tokenRow = await getTokenByAddress(tokAddr);
    if (!tokenRow || !tokenRow.active) {
      return res.status(400).json({ ok: false, error: "unknown or inactive token" });
    }

    // Parse amount safely: require string or hex-string; reject unsafe JS numbers
    let amountAtomic: bigint;
    try {
      if (typeof valueAtomic === "number") {
        // Numbers can be >2^53 and lose precision; require string/hex from relay.
        if (!Number.isSafeInteger(valueAtomic)) {
          return res.status(400).json({ ok: false, error: "valueAtomic must be string (decimal or 0x-hex)" });
        }
        // If you really want to allow small integer numbers, you could:
        // amountAtomic = BigInt(valueAtomic);
        // but it's safer to enforce string inputs everywhere.
        return res.status(400).json({ ok: false, error: "valueAtomic must be string (decimal or 0x-hex)" });
      }

      const raw = String(valueAtomic).trim();
      // BigInt handles both decimal and 0x-hex formats
      amountAtomic = BigInt(raw);
    } catch {
      return res.status(400).json({ ok: false, error: "bad valueAtomic" });
    }

    // Build idempotency key early so we can mark even skipped deposits
    const key = `${tx}:${fromAddr}:${amountAtomic.toString()}`;
    try {
      await prisma.processedDeposit.create({ data: { key } });
    } catch {
      // Unique violation => already processed
      return res.status(200).json({ ok: true, duplicate: true });
    }

    // Enforce token-specific minimum (convert Decimal -> atomic correctly)
    const minAtomic = toAtomicDirect(String(tokenRow.minDeposit), tokenRow.decimals);
    if (amountAtomic < minAtomic) {
      return res.status(200).json({
        ok: true,
        skipped: `below minimum ${tokenRow.minDeposit} ${tokenRow.symbol}`,
      });
    }

    // Credit only if wallet is linked
    const user = await prisma.user.findFirst({ where: { agwAddress: fromAddr } });
    if (!user) {
      return res.status(200).json({ ok: true, ignored: "wallet not linked" });
    }

    // Credit the user using the multi-token balance system
    await creditToken(user.discordId, tokenRow.id, amountAtomic, "DEPOSIT", {
      txHash: tx,
    });

    console.log(
      `💰 credited ${amountAtomic.toString()} ${tokenRow.symbol} to ${user.discordId} (tx ${tx})`
    );
    // (optional CORS header on response)
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json({
      ok: true,
      credited: true,
      userId: user.id,
      token: tokenRow.symbol,
      amount: amountAtomic.toString(),
    });
  } catch (err: any) {
    console.error("internal credit error:", err);
    return res.status(500).json({ ok: false, error: err?.message ?? "server error" });
  }
});

export { internalRouter };
