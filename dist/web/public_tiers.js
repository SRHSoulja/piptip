// src/web/public_tiers.ts
import { Router } from "express";
import { purchaseTierByBalance } from "../services/tier_purchase.js"; // extracted core logic
export const publicTierRouter = Router();
publicTierRouter.post("/tiers/:tierId/purchase", async (req, res) => {
    const { discordId } = req.body;
    const tierId = Number(req.params.tierId);
    if (!discordId || !tierId)
        return res.status(400).json({ ok: false, error: "discordId and tierId required" });
    try {
        const result = await purchaseTierByBalance({ discordId, tierId });
        res.json({ ok: true, ...result });
    }
    catch (e) {
        res.status(400).json({ ok: false, error: e?.message || "Purchase failed" });
    }
});
