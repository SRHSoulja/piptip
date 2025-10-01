import { Router } from "express";
import { prisma } from "../../services/db.js";
import { treasurySafetyMonitor } from "../../services/treasury_safety_monitor.js";
import { treasuryWarningSystem } from "../../services/treasury_warning_system.js";
import { treasuryColdTransfer } from "../../services/treasury_cold_transfer.js";
import { getActiveTokens, formatAmount } from "../../services/token.js";
const treasurySafetyRouter = Router();
treasurySafetyRouter.get("/", async (req, res) => {
  try {
    const config = await treasurySafetyMonitor.getTreasurySafetyConfig();
    let safetyReport = null;
    if (config.monitoringEnabled) {
      try {
        safetyReport = await treasurySafetyMonitor.checkTreasurySafety();
      } catch (error) {
        console.error("Failed to get safety report:", error);
      }
    }
    const transferHistory = await treasuryColdTransfer.getColdTransferHistory(20);
    const pendingTransfers = treasuryColdTransfer.getPendingTransfers();
    const activeAlerts = await treasuryWarningSystem.getActiveAlerts();
    const data = {
      ok: true,
      config,
      safetyReport,
      transferHistory,
      pendingTransfers,
      activeAlerts,
      lastCheck: treasurySafetyMonitor.getLastCheckTime()
    };
    res.json(data);
  } catch (error) {
    console.error("Failed to load treasury safety data:", error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
treasurySafetyRouter.post("/config", async (req, res) => {
  try {
    const {
      treasuryMaxHoldingUSD,
      treasuryWarningThresholdUSD,
      coldWalletAddress,
      treasuryMonitoringEnabled,
      autoTransferEnabled,
      treasuryCheckIntervalMins
    } = req.body;
    if (treasuryMaxHoldingUSD !== void 0 && treasuryMaxHoldingUSD < 0) {
      return res.status(400).json({ ok: false, error: "Max holding USD must be positive" });
    }
    if (treasuryWarningThresholdUSD !== void 0 && treasuryWarningThresholdUSD < 0) {
      return res.status(400).json({ ok: false, error: "Warning threshold USD must be positive" });
    }
    if (coldWalletAddress && !/^0x[a-fA-F0-9]{40}$/.test(coldWalletAddress)) {
      return res.status(400).json({ ok: false, error: "Invalid cold wallet address format" });
    }
    if (treasuryCheckIntervalMins !== void 0 && (treasuryCheckIntervalMins < 1 || treasuryCheckIntervalMins > 1440)) {
      return res.status(400).json({ ok: false, error: "Check interval must be between 1 and 1440 minutes" });
    }
    await prisma.appConfig.updateMany({
      data: {
        treasuryMaxHoldingUSD: treasuryMaxHoldingUSD !== void 0 ? treasuryMaxHoldingUSD : void 0,
        treasuryWarningThresholdUSD: treasuryWarningThresholdUSD !== void 0 ? treasuryWarningThresholdUSD : void 0,
        coldWalletAddress: coldWalletAddress !== void 0 ? coldWalletAddress : void 0,
        treasuryMonitoringEnabled: treasuryMonitoringEnabled !== void 0 ? treasuryMonitoringEnabled : void 0,
        autoTransferEnabled: autoTransferEnabled !== void 0 ? autoTransferEnabled : void 0,
        treasuryCheckIntervalMins: treasuryCheckIntervalMins !== void 0 ? treasuryCheckIntervalMins : void 0
      }
    });
    res.json({
      ok: true,
      message: "Treasury safety configuration updated successfully"
    });
  } catch (error) {
    console.error("Failed to update treasury safety config:", error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
treasurySafetyRouter.post("/check", async (req, res) => {
  try {
    const report = await treasurySafetyMonitor.checkTreasurySafety();
    const alerts = await treasuryWarningSystem.processSafetyReport(report);
    res.json({
      ok: true,
      report,
      alerts,
      message: `Treasury safety check completed. Status: ${report.overallStatus}, Alerts: ${alerts.length}`
    });
  } catch (error) {
    console.error("Failed to run treasury safety check:", error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
treasurySafetyRouter.post("/transfer", async (req, res) => {
  try {
    const { tokenId, amount, destinationAddress, reason } = req.body;
    if (!tokenId || !amount || !destinationAddress || !reason) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: tokenId, amount, destinationAddress, reason"
      });
    }
    if (Number(amount) <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Amount must be greater than zero"
      });
    }
    const tokens = await getActiveTokens();
    const token = tokens.find((t) => t.id === tokenId);
    if (!token) {
      return res.status(400).json({
        ok: false,
        error: "Invalid token ID"
      });
    }
    const amountAtomic = BigInt(Math.floor(Number(amount) * Math.pow(10, token.decimals)));
    const result = await treasuryColdTransfer.executeColdTransfer({
      tokenId,
      amountAtomic,
      destinationAddress,
      reason,
      initiatedBy: "manual",
      adminUserId: void 0
      // TODO: Get from session
    }, token);
    if (result.success) {
      res.json({
        ok: true,
        txHash: result.txHash,
        gasUsed: result.gasUsed?.toString(),
        message: `Successfully transferred ${formatAmount(amountAtomic, token)} ${token.symbol} to cold wallet`
      });
    } else {
      res.status(400).json({
        ok: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error("Failed to execute cold transfer:", error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
treasurySafetyRouter.post("/emergency-pause", async (req, res) => {
  try {
    await treasuryColdTransfer.pauseColdTransfers();
    res.json({
      ok: true,
      message: "Emergency pause activated - all cold transfers have been disabled"
    });
  } catch (error) {
    console.error("Failed to emergency pause cold transfers:", error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
treasurySafetyRouter.post("/acknowledge-alert/:alertId", async (req, res) => {
  try {
    const alertId = parseInt(req.params.alertId);
    if (isNaN(alertId)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid alert ID"
      });
    }
    await treasuryWarningSystem.acknowledgeAlert(alertId);
    res.json({
      ok: true,
      message: "Alert acknowledged successfully"
    });
  } catch (error) {
    console.error("Failed to acknowledge alert:", error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
treasurySafetyRouter.get("/metrics", async (req, res) => {
  try {
    const config = await treasurySafetyMonitor.getTreasurySafetyConfig();
    let metrics = {
      monitoringEnabled: config.monitoringEnabled,
      autoTransferEnabled: config.autoTransferEnabled,
      lastCheckTime: treasurySafetyMonitor.getLastCheckTime(),
      overallStatus: "unknown",
      totalTreasuryUSD: 0,
      tokensAtRisk: 0,
      pendingTransfers: 0,
      activeAlerts: 0
    };
    if (config.monitoringEnabled) {
      try {
        const report = await treasurySafetyMonitor.checkTreasurySafety();
        metrics.overallStatus = report.overallStatus;
        metrics.totalTreasuryUSD = report.totalTreasuryUSD;
        metrics.tokensAtRisk = report.tokenStatuses.filter((t) => t.status !== "safe").length;
      } catch (error) {
        console.error("Failed to get treasury metrics:", error);
      }
    }
    metrics.pendingTransfers = treasuryColdTransfer.getPendingTransfers().length;
    metrics.activeAlerts = (await treasuryWarningSystem.getActiveAlerts()).length;
    res.json({
      ok: true,
      metrics
    });
  } catch (error) {
    console.error("Failed to get treasury safety metrics:", error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});
export {
  treasurySafetyRouter
};
//# sourceMappingURL=treasury_safety.js.map
