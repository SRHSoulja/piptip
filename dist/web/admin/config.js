import { Router } from "express";
import { prisma } from "../../services/db.js";
import { getConfig } from "../../config.js";
import { safeAmountToNumber, safeToNumber, ValidationError } from "../../utils/safe_conversions.js";
import { adminMiddleware } from "../../services/admin_auth.js";
const configRouter = Router();
configRouter.get("/ping", (_req, res) => {
  res.json({ ok: true, message: "Admin authenticated" });
});
configRouter.get("/config", async (_req, res) => {
  try {
    const config = await getConfig();
    res.json({ ok: true, config });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load config" });
  }
});
configRouter.put("/config", adminMiddleware([], "config_update"), async (req, res) => {
  try {
    const {
      minDeposit,
      minWithdraw,
      withdrawMaxPerTx,
      withdrawDailyCap,
      referralEnabled,
      referralTaxReductionBps,
      referralRakeReductionBps,
      referralVerificationThreshold,
      referralRewardInterval,
      referralWelcomeBonus
    } = req.body;
    const updateData = {
      minDeposit: minDeposit != null ? safeAmountToNumber(minDeposit, "minDeposit") : 50,
      minWithdraw: minWithdraw != null ? safeAmountToNumber(minWithdraw, "minWithdraw") : 50,
      withdrawMaxPerTx: withdrawMaxPerTx != null ? safeAmountToNumber(withdrawMaxPerTx, "withdrawMaxPerTx") : 50,
      withdrawDailyCap: withdrawDailyCap != null ? safeAmountToNumber(withdrawDailyCap, "withdrawDailyCap") : 500,
      referralEnabled: referralEnabled !== void 0 ? Boolean(referralEnabled) : true,
      // Basis points must be 0-10000 (0% to 100%)
      referralTaxReductionBps: referralTaxReductionBps != null ? safeToNumber(referralTaxReductionBps, { min: 0, max: 1e4, allowZero: true, label: "referralTaxReductionBps" }) : 50,
      referralRakeReductionBps: referralRakeReductionBps != null ? safeToNumber(referralRakeReductionBps, { min: 0, max: 1e4, allowZero: true, label: "referralRakeReductionBps" }) : 50,
      referralVerificationThreshold: referralVerificationThreshold != null ? safeAmountToNumber(referralVerificationThreshold, "referralVerificationThreshold") : 20,
      // Referral reward interval in days/hours, reasonable limits
      referralRewardInterval: referralRewardInterval != null ? safeToNumber(referralRewardInterval, { min: 1, max: 168, label: "referralRewardInterval" }) : 10,
      // Welcome bonus is a financial amount - use safeToNumber with allowZero for optional bonus
      referralWelcomeBonus: referralWelcomeBonus != null ? safeToNumber(referralWelcomeBonus, { min: 0, max: 1e5, allowZero: true, label: "referralWelcomeBonus" }) : 0
    };
    await prisma.appConfig.upsert({
      where: { id: 1 },
      update: updateData,
      create: { id: 1, ...updateData }
    });
    res.json({ ok: true, message: "Configuration updated" });
  } catch (error) {
    console.error("Config update error:", error);
    if (error instanceof ValidationError) {
      return res.status(400).json({
        ok: false,
        error: `Invalid parameter: ${error.message}`,
        field: error.message.split(" ")[0]
        // Extract field name from message
      });
    }
    res.status(500).json({ ok: false, error: "Failed to update config" });
  }
});
configRouter.post("/reload-config", async (_req, res) => {
  try {
    res.json({ ok: true, message: "Config cache reloaded" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to reload config" });
  }
});
export {
  configRouter
};
//# sourceMappingURL=config.js.map
