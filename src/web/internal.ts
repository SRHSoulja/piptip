// src/web/internal.ts
import { queueNotice } from "../services/notifier.js";
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

    // Parse amount safely: force string conversion for precision safety
    let amountAtomic: bigint;
    try {
      const raw = String(valueAtomic).trim();
      if (!raw) {
        return res.status(400).json({ ok: false, error: "empty valueAtomic" });
      }
      // BigInt handles both decimal and 0x-hex formats
      amountAtomic = BigInt(raw);
      
      // Ensure positive amount
      if (amountAtomic <= 0n) {
        return res.status(400).json({ ok: false, error: "valueAtomic must be positive" });
      }
    } catch (error) {
      return res.status(400).json({ 
        ok: false, 
        error: "invalid valueAtomic format - must be decimal string or 0x-hex" 
      });
    }

    // Build idempotency key early so we can mark even skipped deposits
    const key = `${tx}:${fromAddr}:${amountAtomic.toString()}`;
    try {
      await prisma.processedDeposit.create({ data: { key } });
    } catch (error) {
      // Unique violation => already processed
      console.log(`Duplicate deposit detected: ${key}`);
      return res.status(200).json({ ok: true, duplicate: true });
    }

    // Enforce token-specific minimum (convert Decimal -> atomic correctly)
    const minAtomic = toAtomicDirect(String(tokenRow.minDeposit), tokenRow.decimals);
    if (amountAtomic < minAtomic) {
      console.log(`Deposit below minimum: ${amountAtomic} < ${minAtomic} for ${tokenRow.symbol}`);
      return res.status(200).json({
        ok: true,
        skipped: `below minimum ${tokenRow.minDeposit} ${tokenRow.symbol}`,
      });
    }

    // Credit only if wallet is linked
    const user = await prisma.user.findFirst({ where: { agwAddress: fromAddr } });
    if (!user) {
      console.log(`Deposit from unlinked wallet: ${fromAddr}`);
      return res.status(200).json({ ok: true, ignored: "wallet not linked" });
    }

    // Credit the user using the multi-token balance system
// Credit the user using the multi-token balance system
await creditToken(user.discordId, tokenRow.id, amountAtomic, "DEPOSIT", {
  txHash: tx,
});

// Queue an ephemeral deposit notice for the user (delivered on next command)
await queueNotice(user.id, "deposit", {
  token: tokenRow.symbol,
  amountAtomic: amountAtomic.toString(),
  decimals: tokenRow.decimals ?? 18,
  tx,
});


    // Log webhook events for monitoring
    try {
      await prisma.webhookEvent.create({
        data: {
          source: "alchemy",
          key: `${tx}:${fromAddr}`,
          status: "processed",
          payload: JSON.stringify(req.body),
        },
      });
    } catch (webhookLogError) {
      console.error("Failed to log webhook event:", webhookLogError);
      // Don't fail the deposit for logging issues
    }

    console.log(
      `Credited ${amountAtomic.toString()} ${tokenRow.symbol} to ${user.discordId} (tx ${tx})`
    );

    // Set CORS header for response
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json({
      ok: true,
      credited: true,
      userId: user.id,
      token: tokenRow.symbol,
      amount: amountAtomic.toString(),
    });
  } catch (err: any) {
    console.error("Internal credit error:", err);
    
    // Log failed webhook events for debugging
    try {
      await prisma.webhookEvent.create({
        data: {
          source: "alchemy",
          key: `error:${Date.now()}`,
          status: "error",
          payload: JSON.stringify({ 
            body: req.body, 
            error: err?.message || String(err) 
          }),
        },
      });
    } catch (logError) {
      console.error("Failed to log webhook error:", logError);
    }

    return res.status(500).json({ 
      ok: false, 
      error: err?.message ?? "server error" 
    });
  }
});

export { internalRouter };