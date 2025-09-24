// src/web/admin/treasury_safety.ts - Treasury safety management admin interface

import { Router } from "express";
import { prisma } from "../../services/db.js";
import { treasurySafetyMonitor } from "../../services/treasury_safety_monitor.js";
import { treasuryWarningSystem } from "../../services/treasury_warning_system.js";
import { treasuryColdTransfer } from "../../services/treasury_cold_transfer.js";
import { getActiveTokens, formatAmount } from "../../services/token.js";
import type { TreasurySafetyReport } from "../../services/treasury_safety_monitor.js";

export const treasurySafetyRouter = Router();

// Get treasury safety status and configuration
treasurySafetyRouter.get("/", async (req, res) => {
  try {
    // Get current configuration
    const config = await treasurySafetyMonitor.getTreasurySafetyConfig();

    // Get current safety report
    let safetyReport: TreasurySafetyReport | null = null;
    if (config.monitoringEnabled) {
      try {
        safetyReport = await treasurySafetyMonitor.checkTreasurySafety();
      } catch (error) {
        console.error("Failed to get safety report:", error);
      }
    }

    // Get recent cold transfer history
    const transferHistory = await treasuryColdTransfer.getColdTransferHistory(20);

    // Get pending transfers
    const pendingTransfers = treasuryColdTransfer.getPendingTransfers();

    // Get active alerts
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
      error: (error as Error).message
    });
  }
});

// Update treasury safety configuration
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

    // Validate inputs
    if (treasuryMaxHoldingUSD !== undefined && treasuryMaxHoldingUSD < 0) {
      return res.status(400).json({ ok: false, error: "Max holding USD must be positive" });
    }

    if (treasuryWarningThresholdUSD !== undefined && treasuryWarningThresholdUSD < 0) {
      return res.status(400).json({ ok: false, error: "Warning threshold USD must be positive" });
    }

    if (coldWalletAddress && !/^0x[a-fA-F0-9]{40}$/.test(coldWalletAddress)) {
      return res.status(400).json({ ok: false, error: "Invalid cold wallet address format" });
    }

    if (treasuryCheckIntervalMins !== undefined && (treasuryCheckIntervalMins < 1 || treasuryCheckIntervalMins > 1440)) {
      return res.status(400).json({ ok: false, error: "Check interval must be between 1 and 1440 minutes" });
    }

    // Update configuration
    await prisma.appConfig.updateMany({
      data: {
        treasuryMaxHoldingUSD: treasuryMaxHoldingUSD !== undefined ? treasuryMaxHoldingUSD : undefined,
        treasuryWarningThresholdUSD: treasuryWarningThresholdUSD !== undefined ? treasuryWarningThresholdUSD : undefined,
        coldWalletAddress: coldWalletAddress !== undefined ? coldWalletAddress : undefined,
        treasuryMonitoringEnabled: treasuryMonitoringEnabled !== undefined ? treasuryMonitoringEnabled : undefined,
        autoTransferEnabled: autoTransferEnabled !== undefined ? autoTransferEnabled : undefined,
        treasuryCheckIntervalMins: treasuryCheckIntervalMins !== undefined ? treasuryCheckIntervalMins : undefined
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
      error: (error as Error).message
    });
  }
});

// Run manual treasury safety check
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
      error: (error as Error).message
    });
  }
});

// Execute manual cold wallet transfer
treasurySafetyRouter.post("/transfer", async (req, res) => {
  try {
    const { tokenId, amount, destinationAddress, reason } = req.body;

    // Validate inputs
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

    // Get token information
    const tokens = await getActiveTokens();
    const token = tokens.find(t => t.id === tokenId);
    if (!token) {
      return res.status(400).json({
        ok: false,
        error: "Invalid token ID"
      });
    }

    // Convert amount to atomic units
    const amountAtomic = BigInt(Math.floor(Number(amount) * Math.pow(10, token.decimals)));

    // Execute the transfer
    const result = await treasuryColdTransfer.executeColdTransfer({
      tokenId,
      amountAtomic,
      destinationAddress,
      reason,
      initiatedBy: 'manual',
      adminUserId: undefined // TODO: Get from session
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
      error: (error as Error).message
    });
  }
});

// Emergency pause cold transfers
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
      error: (error as Error).message
    });
  }
});

// Acknowledge treasury alert
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
      error: (error as Error).message
    });
  }
});

// Get treasury safety metrics for dashboard
treasurySafetyRouter.get("/metrics", async (req, res) => {
  try {
    const config = await treasurySafetyMonitor.getTreasurySafetyConfig();

    let metrics = {
      monitoringEnabled: config.monitoringEnabled,
      autoTransferEnabled: config.autoTransferEnabled,
      lastCheckTime: treasurySafetyMonitor.getLastCheckTime(),
      overallStatus: 'unknown' as 'safe' | 'warning' | 'critical' | 'unknown',
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
        metrics.tokensAtRisk = report.tokenStatuses.filter(t => t.status !== 'safe').length;
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
      error: (error as Error).message
    });
  }
});