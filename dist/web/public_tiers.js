import { Router } from "express";
import { purchaseTierByBalance } from "../services/tier_purchase.js";
const publicTierRouter = Router();
publicTierRouter.post("/tiers/:tierId/purchase", async (req, res) => {
  const { discordId } = req.body;
  const tierId = Number(req.params.tierId);
  if (!discordId || !tierId) return res.status(400).json({ ok: false, error: "discordId and tierId required" });
  try {
    const result = await purchaseTierByBalance({ discordId, tierId });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e?.message || "Purchase failed" });
  }
});
export {
  publicTierRouter
};
//# sourceMappingURL=public_tiers.js.map
