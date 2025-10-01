import { treasurySafetyMonitor } from "./treasury_safety_monitor.js";
class TreasuryWarningSystemService {
  alertCooldowns = /* @__PURE__ */ new Map();
  // Prevent spam alerts
  COOLDOWN_MINUTES = 60;
  // Minimum time between same alerts
  /**
   * Process treasury safety report and generate alerts
   */
  async processSafetyReport(report) {
    const alerts = [];
    if (!report.monitoringEnabled) {
      return alerts;
    }
    for (const tokenStatus of report.tokenStatuses) {
      if (tokenStatus.status === "warning") {
        const alertKey = `warning_${tokenStatus.tokenId}`;
        if (this.shouldGenerateAlert(alertKey)) {
          alerts.push({
            type: "warning",
            title: `Treasury Warning: ${tokenStatus.tokenSymbol}`,
            message: `${tokenStatus.tokenSymbol} treasury balance ($${tokenStatus.estimatedUSDValue.toFixed(2)}) exceeds warning threshold ($${tokenStatus.warningThresholdUSD}). Consider transferring excess funds to cold storage.`,
            tokenId: tokenStatus.tokenId,
            estimatedUSD: tokenStatus.estimatedUSDValue,
            acknowledged: false,
            createdAt: /* @__PURE__ */ new Date(),
            metadata: {
              currentBalance: tokenStatus.currentBalanceHuman,
              thresholdUSD: tokenStatus.warningThresholdUSD,
              recommendedAction: tokenStatus.recommendedAction
            }
          });
          this.setAlertCooldown(alertKey);
        }
      }
      if (tokenStatus.status === "critical") {
        const alertKey = `critical_${tokenStatus.tokenId}`;
        if (this.shouldGenerateAlert(alertKey)) {
          alerts.push({
            type: "critical",
            title: `\u{1F6A8} CRITICAL: ${tokenStatus.tokenSymbol} Treasury Limit Exceeded`,
            message: `${tokenStatus.tokenSymbol} treasury balance ($${tokenStatus.estimatedUSDValue.toFixed(2)}) exceeds maximum holding limit ($${tokenStatus.maxHoldingUSD}). Immediate action required: Transfer $${tokenStatus.excessUSD?.toFixed(2)} to cold storage.`,
            tokenId: tokenStatus.tokenId,
            estimatedUSD: tokenStatus.estimatedUSDValue,
            acknowledged: false,
            createdAt: /* @__PURE__ */ new Date(),
            metadata: {
              currentBalance: tokenStatus.currentBalanceHuman,
              maxHoldingUSD: tokenStatus.maxHoldingUSD,
              excessUSD: tokenStatus.excessUSD,
              recommendedAction: tokenStatus.recommendedAction,
              autoTransferEnabled: report.autoTransferEnabled,
              coldWalletAddress: report.coldWalletAddress
            }
          });
          this.setAlertCooldown(alertKey);
        }
      }
    }
    if (report.overallStatus === "critical") {
      const alertKey = "overall_critical";
      if (this.shouldGenerateAlert(alertKey)) {
        alerts.push({
          type: "critical",
          title: "\u{1F6A8} CRITICAL: Treasury Safety Alert",
          message: `Multiple tokens exceed safety thresholds. Total treasury value: $${report.totalTreasuryUSD.toFixed(2)}. Immediate review required.`,
          acknowledged: false,
          createdAt: /* @__PURE__ */ new Date(),
          metadata: {
            totalTreasuryUSD: report.totalTreasuryUSD,
            criticalTokens: report.tokenStatuses.filter((t) => t.status === "critical").length,
            warningTokens: report.tokenStatuses.filter((t) => t.status === "warning").length,
            actions: report.actions
          }
        });
        this.setAlertCooldown(alertKey);
      }
    }
    for (const alert of alerts) {
      await this.storeAlert(alert);
    }
    return alerts;
  }
  /**
   * Check if we should generate an alert (respects cooldown)
   */
  shouldGenerateAlert(alertKey) {
    const lastAlert = this.alertCooldowns.get(alertKey);
    if (!lastAlert) return true;
    const cooldownMs = this.COOLDOWN_MINUTES * 60 * 1e3;
    return Date.now() - lastAlert >= cooldownMs;
  }
  /**
   * Set cooldown for an alert type
   */
  setAlertCooldown(alertKey) {
    this.alertCooldowns.set(alertKey, Date.now());
  }
  /**
   * Store alert in database for audit and admin review
   */
  async storeAlert(alert) {
    try {
      console.log(`\u{1F6A8} TREASURY ALERT [${alert.type.toUpperCase()}]: ${alert.title}`);
      console.log(`   Message: ${alert.message}`);
      if (alert.metadata) {
        console.log(`   Metadata:`, alert.metadata);
      }
    } catch (error) {
      console.error("Failed to store treasury alert:", error);
    }
  }
  /**
   * Send critical alerts to admin notification channels
   */
  async sendCriticalAlert(alert) {
    if (alert.type !== "critical") return;
    try {
      await this.sendDiscordAdminAlert(alert);
      console.log(`\u{1F4E7} Critical treasury alert sent: ${alert.title}`);
    } catch (error) {
      console.error("Failed to send critical alert:", error);
    }
  }
  /**
   * Send Discord webhook alert to admin channel
   */
  async sendDiscordAdminAlert(alert) {
    const adminWebhookUrl = process.env.TREASURY_ADMIN_WEBHOOK_URL;
    if (!adminWebhookUrl) {
      console.warn("Treasury admin webhook URL not configured");
      return;
    }
    const embed = {
      title: alert.title,
      description: alert.message,
      color: alert.type === "critical" ? 16711680 : 16753920,
      // Red for critical, orange for warning
      timestamp: alert.createdAt.toISOString(),
      fields: []
    };
    if (alert.metadata) {
      if (alert.metadata.currentBalance) {
        embed.fields.push({
          name: "Current Balance",
          value: alert.metadata.currentBalance.toString(),
          inline: true
        });
      }
      if (alert.metadata.excessUSD) {
        embed.fields.push({
          name: "Excess Amount (USD)",
          value: `$${alert.metadata.excessUSD.toFixed(2)}`,
          inline: true
        });
      }
      if (alert.metadata.coldWalletAddress) {
        embed.fields.push({
          name: "Cold Wallet",
          value: alert.metadata.coldWalletAddress,
          inline: false
        });
      }
    }
    const payload = {
      content: alert.type === "critical" ? "@here Treasury Critical Alert" : "Treasury Warning",
      embeds: [embed]
    };
    try {
      const response = await fetch(adminWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Discord webhook failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Failed to send Discord admin alert:", error);
    }
  }
  /**
   * Run automatic treasury monitoring check
   */
  async runAutomaticCheck() {
    try {
      const config = await treasurySafetyMonitor.getTreasurySafetyConfig();
      if (!config.monitoringEnabled) {
        return;
      }
      if (!treasurySafetyMonitor.shouldRunCheck(config.checkIntervalMins)) {
        return;
      }
      console.log("\u{1F50D} Running automatic treasury safety check...");
      const report = await treasurySafetyMonitor.checkTreasurySafety();
      const alerts = await this.processSafetyReport(report);
      for (const alert of alerts.filter((a) => a.type === "critical")) {
        await this.sendCriticalAlert(alert);
      }
      console.log(`\u2705 Treasury safety check complete. Status: ${report.overallStatus}, Alerts: ${alerts.length}`);
    } catch (error) {
      console.error("Failed to run automatic treasury check:", error);
    }
  }
  /**
   * Get active treasury alerts (for admin dashboard)
   */
  async getActiveAlerts() {
    return [];
  }
  /**
   * Acknowledge an alert (mark as resolved)
   */
  async acknowledgeAlert(alertId) {
    console.log(`\u2705 Treasury alert ${alertId} acknowledged`);
  }
}
const treasuryWarningSystem = new TreasuryWarningSystemService();
export {
  treasuryWarningSystem
};
//# sourceMappingURL=treasury_warning_system.js.map
