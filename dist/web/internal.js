import { queueNotice } from "../services/notifier.js";
import { Router } from "express";
import { prisma } from "../services/db.js";
import { getTokenByAddress, toAtomicDirect } from "../services/token.js";
import { creditToken } from "../services/balances.js";
const internalRouter = Router();
const INTERNAL_BEARER = process.env.INTERNAL_BEARER ?? process.env.NODE_INTERNAL_BEARER ?? "";
const TREASURY = (process.env.TREASURY_AGW_ADDRESS || "").toLowerCase();
function unauthorized(res) {
  return res.status(401).json({ ok: false, error: "unauthorized" });
}
internalRouter.options("/credit", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.sendStatus(204);
});
internalRouter.post("/credit", async (req, res) => {
  try {
    const auth = req.headers.authorization ?? "";
    if (!INTERNAL_BEARER || auth !== `Bearer ${INTERNAL_BEARER}`) {
      return unauthorized(res);
    }
    const { from, to, token, valueAtomic, tx } = req.body ?? {};
    if (!from || !to || !token || valueAtomic == null || !tx) {
      return res.status(400).json({ ok: false, error: "missing fields" });
    }
    const fromAddr = String(from).trim().toLowerCase();
    const toAddr = String(to).trim().toLowerCase();
    const tokAddr = String(token).trim().toLowerCase();
    if (!TREASURY || toAddr !== TREASURY) {
      return res.status(400).json({ ok: false, error: "wrong treasury" });
    }
    const tokenRow = await getTokenByAddress(tokAddr);
    if (!tokenRow || !tokenRow.active) {
      return res.status(400).json({ ok: false, error: "unknown or inactive token" });
    }
    let amountAtomic;
    try {
      const raw = String(valueAtomic).trim();
      if (!raw) {
        return res.status(400).json({ ok: false, error: "empty valueAtomic" });
      }
      amountAtomic = BigInt(raw);
      if (amountAtomic <= 0n) {
        return res.status(400).json({ ok: false, error: "valueAtomic must be positive" });
      }
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: "invalid valueAtomic format - must be decimal string or 0x-hex"
      });
    }
    const key = `${tx}:${fromAddr}:${amountAtomic.toString()}`;
    try {
      await prisma.processedDeposit.create({ data: { key } });
    } catch (error) {
      console.log(`Duplicate deposit detected: ${key}`);
      return res.status(200).json({ ok: true, duplicate: true });
    }
    const minAtomic = toAtomicDirect(String(tokenRow.minDeposit), tokenRow.decimals);
    if (amountAtomic < minAtomic) {
      console.log(`Deposit below minimum: ${amountAtomic} < ${minAtomic} for ${tokenRow.symbol}`);
      return res.status(200).json({
        ok: true,
        skipped: `below minimum ${tokenRow.minDeposit} ${tokenRow.symbol}`
      });
    }
    const user = await prisma.user.findFirst({ where: { agwAddress: fromAddr } });
    if (!user) {
      console.log(`Deposit from unlinked wallet: ${fromAddr}`);
      return res.status(200).json({ ok: true, ignored: "wallet not linked" });
    }
    await creditToken(user.discordId, tokenRow.id, amountAtomic, "DEPOSIT", {
      txHash: tx
    });
    await queueNotice(user.id, "deposit", {
      token: tokenRow.symbol,
      amountAtomic: amountAtomic.toString(),
      decimals: tokenRow.decimals ?? 18,
      tx
    });
    try {
      await prisma.webhookEvent.create({
        data: {
          source: "alchemy",
          key: `${tx}:${fromAddr}`,
          status: "processed",
          payload: JSON.stringify(req.body)
        }
      });
    } catch (webhookLogError) {
      console.error("Failed to log webhook event:", webhookLogError);
    }
    console.log(
      `Credited ${amountAtomic.toString()} ${tokenRow.symbol} to ${user.discordId} (tx ${tx})`
    );
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json({
      ok: true,
      credited: true,
      userId: user.id,
      token: tokenRow.symbol,
      amount: amountAtomic.toString()
    });
  } catch (err) {
    console.error("Internal credit error:", err);
    try {
      await prisma.webhookEvent.create({
        data: {
          source: "alchemy",
          key: `error:${Date.now()}`,
          status: "error",
          payload: JSON.stringify({
            body: req.body,
            error: err?.message || String(err)
          })
        }
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
export {
  internalRouter
};
//# sourceMappingURL=internal.js.map
