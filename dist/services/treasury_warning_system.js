// src/services/treasury_warning_system.ts - Treasury warning and alert system
import { treasurySafetyMonitor } from './treasury_safety_monitor.js';
class TreasuryWarningSystemService {
    alertCooldowns = new Map(); // Prevent spam alerts
    COOLDOWN_MINUTES = 60; // Minimum time between same alerts
    /**
     * Process treasury safety report and generate alerts
     */
    async processSafetyReport(report) {
        const alerts = [];
        if (!report.monitoringEnabled) {
            return alerts;
        }
        // Generate alerts for each token status
        for (const tokenStatus of report.tokenStatuses) {
            if (tokenStatus.status === 'warning') {
                const alertKey = `warning_${tokenStatus.tokenId}`;
                if (this.shouldGenerateAlert(alertKey)) {
                    alerts.push({
                        type: 'warning',
                        title: `Treasury Warning: ${tokenStatus.tokenSymbol}`,
                        message: `${tokenStatus.tokenSymbol} treasury balance ($${tokenStatus.estimatedUSDValue.toFixed(2)}) exceeds warning threshold ($${tokenStatus.warningThresholdUSD}). Consider transferring excess funds to cold storage.`,
                        tokenId: tokenStatus.tokenId,
                        estimatedUSD: tokenStatus.estimatedUSDValue,
                        acknowledged: false,
                        createdAt: new Date(),
                        metadata: {
                            currentBalance: tokenStatus.currentBalanceHuman,
                            thresholdUSD: tokenStatus.warningThresholdUSD,
                            recommendedAction: tokenStatus.recommendedAction
                        }
                    });
                    this.setAlertCooldown(alertKey);
                }
            }
            if (tokenStatus.status === 'critical') {
                const alertKey = `critical_${tokenStatus.tokenId}`;
                if (this.shouldGenerateAlert(alertKey)) {
                    alerts.push({
                        type: 'critical',
                        title: `🚨 CRITICAL: ${tokenStatus.tokenSymbol} Treasury Limit Exceeded`,
                        message: `${tokenStatus.tokenSymbol} treasury balance ($${tokenStatus.estimatedUSDValue.toFixed(2)}) exceeds maximum holding limit ($${tokenStatus.maxHoldingUSD}). Immediate action required: Transfer $${tokenStatus.excessUSD?.toFixed(2)} to cold storage.`,
                        tokenId: tokenStatus.tokenId,
                        estimatedUSD: tokenStatus.estimatedUSDValue,
                        acknowledged: false,
                        createdAt: new Date(),
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
        // Generate overall status alerts
        if (report.overallStatus === 'critical') {
            const alertKey = 'overall_critical';
            if (this.shouldGenerateAlert(alertKey)) {
                alerts.push({
                    type: 'critical',
                    title: '🚨 CRITICAL: Treasury Safety Alert',
                    message: `Multiple tokens exceed safety thresholds. Total treasury value: $${report.totalTreasuryUSD.toFixed(2)}. Immediate review required.`,
                    acknowledged: false,
                    createdAt: new Date(),
                    metadata: {
                        totalTreasuryUSD: report.totalTreasuryUSD,
                        criticalTokens: report.tokenStatuses.filter(t => t.status === 'critical').length,
                        warningTokens: report.tokenStatuses.filter(t => t.status === 'warning').length,
                        actions: report.actions
                    }
                });
                this.setAlertCooldown(alertKey);
            }
        }
        // Store alerts in database (if they don't exist)
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
        if (!lastAlert)
            return true;
        const cooldownMs = this.COOLDOWN_MINUTES * 60 * 1000;
        return (Date.now() - lastAlert) >= cooldownMs;
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
            // In production, store in a dedicated alerts table
            // For now, log to console with structured format
            console.log(`🚨 TREASURY ALERT [${alert.type.toUpperCase()}]: ${alert.title}`);
            console.log(`   Message: ${alert.message}`);
            if (alert.metadata) {
                console.log(`   Metadata:`, alert.metadata);
            }
            // TODO: Implement actual database storage
            // await prisma.treasuryAlert.create({
            //   data: {
            //     type: alert.type,
            //     title: alert.title,
            //     message: alert.message,
            //     tokenId: alert.tokenId,
            //     estimatedUSD: alert.estimatedUSD,
            //     acknowledged: false,
            //     metadata: alert.metadata ? JSON.stringify(alert.metadata) : null
            //   }
            // });
        }
        catch (error) {
            console.error('Failed to store treasury alert:', error);
        }
    }
    /**
     * Send critical alerts to admin notification channels
     */
    async sendCriticalAlert(alert) {
        if (alert.type !== 'critical')
            return;
        try {
            // Integration points for admin notifications:
            // 1. Discord webhook to admin channel
            await this.sendDiscordAdminAlert(alert);
            // 2. Email notification (if configured)
            // await this.sendEmailAlert(alert);
            // 3. SMS/Telegram for critical alerts
            // await this.sendSMSAlert(alert);
            console.log(`📧 Critical treasury alert sent: ${alert.title}`);
        }
        catch (error) {
            console.error('Failed to send critical alert:', error);
        }
    }
    /**
     * Send Discord webhook alert to admin channel
     */
    async sendDiscordAdminAlert(alert) {
        const adminWebhookUrl = process.env.TREASURY_ADMIN_WEBHOOK_URL;
        if (!adminWebhookUrl) {
            console.warn('Treasury admin webhook URL not configured');
            return;
        }
        const embed = {
            title: alert.title,
            description: alert.message,
            color: alert.type === 'critical' ? 0xFF0000 : 0xFFA500, // Red for critical, orange for warning
            timestamp: alert.createdAt.toISOString(),
            fields: []
        };
        // Add metadata fields
        if (alert.metadata) {
            if (alert.metadata.currentBalance) {
                embed.fields.push({
                    name: 'Current Balance',
                    value: alert.metadata.currentBalance.toString(),
                    inline: true
                });
            }
            if (alert.metadata.excessUSD) {
                embed.fields.push({
                    name: 'Excess Amount (USD)',
                    value: `$${alert.metadata.excessUSD.toFixed(2)}`,
                    inline: true
                });
            }
            if (alert.metadata.coldWalletAddress) {
                embed.fields.push({
                    name: 'Cold Wallet',
                    value: alert.metadata.coldWalletAddress,
                    inline: false
                });
            }
        }
        const payload = {
            content: alert.type === 'critical' ? '@here Treasury Critical Alert' : 'Treasury Warning',
            embeds: [embed]
        };
        try {
            const response = await fetch(adminWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`Discord webhook failed: ${response.statusText}`);
            }
        }
        catch (error) {
            console.error('Failed to send Discord admin alert:', error);
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
            console.log('🔍 Running automatic treasury safety check...');
            const report = await treasurySafetyMonitor.checkTreasurySafety();
            const alerts = await this.processSafetyReport(report);
            // Send critical alerts immediately
            for (const alert of alerts.filter(a => a.type === 'critical')) {
                await this.sendCriticalAlert(alert);
            }
            // Log check completion
            console.log(`✅ Treasury safety check complete. Status: ${report.overallStatus}, Alerts: ${alerts.length}`);
        }
        catch (error) {
            console.error('Failed to run automatic treasury check:', error);
        }
    }
    /**
     * Get active treasury alerts (for admin dashboard)
     */
    async getActiveAlerts() {
        // TODO: Fetch from database
        // return await prisma.treasuryAlert.findMany({
        //   where: { acknowledged: false },
        //   orderBy: { createdAt: 'desc' }
        // });
        // Placeholder: Return empty array for now
        return [];
    }
    /**
     * Acknowledge an alert (mark as resolved)
     */
    async acknowledgeAlert(alertId) {
        // TODO: Update database
        // await prisma.treasuryAlert.update({
        //   where: { id: alertId },
        //   data: { acknowledged: true }
        // });
        console.log(`✅ Treasury alert ${alertId} acknowledged`);
    }
}
export const treasuryWarningSystem = new TreasuryWarningSystemService();
