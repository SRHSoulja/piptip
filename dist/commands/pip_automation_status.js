import { EmbedBuilder } from "discord.js";
import { marketAutomationScheduler } from "../services/market_automation_scheduler.js";
import { prisma } from "../services/db.js";
export default async function pipAutomationStatus(i) {
    try {
        await i.deferReply({ ephemeral: true });
        // Get automation status
        const status = marketAutomationScheduler.getStatus();
        const config = marketAutomationScheduler.getConfig();
        // Count markets created today by automation
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayEnd = new Date(today);
        todayEnd.setDate(today.getDate() + 1);
        const [totalAutoMarkets, todayAutoMarkets, activeMarkets] = await Promise.all([
            prisma.predictionMarket.count({
                where: { creatorId: 'automation' }
            }),
            prisma.predictionMarket.count({
                where: {
                    creatorId: 'automation',
                    createdAt: {
                        gte: today,
                        lt: todayEnd
                    }
                }
            }),
            prisma.predictionMarket.count({
                where: {
                    status: 'ACTIVE',
                    creatorId: 'automation'
                }
            })
        ]);
        // Calculate next scheduled run
        const now = new Date();
        const schedules = config.schedule.map(time => {
            const [hours, minutes] = time.split(':').map(Number);
            const scheduledToday = new Date();
            scheduledToday.setUTCHours(hours, minutes, 0, 0);
            if (scheduledToday <= now) {
                scheduledToday.setDate(scheduledToday.getDate() + 1);
            }
            return scheduledToday;
        });
        const nextRun = schedules.reduce((earliest, current) => current < earliest ? current : earliest);
        const embed = new EmbedBuilder()
            .setTitle("🤖 Market Automation Status")
            .setColor(config.enabled ? 0x10B981 : 0xEF4444)
            .addFields({
            name: "📊 System Status",
            value: [
                `**Enabled:** ${config.enabled ? '✅ Yes' : '❌ No'}`,
                `**Schedule:** ${config.schedule.join(', ')} UTC`,
                `**Daily Limit:** ${config.maxDailyMarkets} markets`,
                `**Next Run:** <t:${Math.floor(nextRun.getTime() / 1000)}:R>`
            ].join('\n'),
            inline: true
        }, {
            name: "📈 Market Statistics",
            value: [
                `**Total Auto-Created:** ${totalAutoMarkets}`,
                `**Created Today:** ${todayAutoMarkets}/${config.maxDailyMarkets}`,
                `**Currently Active:** ${activeMarkets}`,
                `**Consecutive Failures:** ${status.consecutiveFailures}`
            ].join('\n'),
            inline: true
        }, {
            name: "🎯 Content Types",
            value: [
                `**Crypto Markets:** ${config.crypto.enabled ? '✅' : '❌'} (${config.crypto.maxPerDay}/day)`,
                `**Sports Markets:** ${config.sports.enabled ? '✅' : '❌'} (${config.sports.maxPerDay}/day)`,
                `**API Health Check:** ${config.riskLimits.requireApiHealthCheck ? '✅' : '❌'}`,
                `**Max Concurrent:** ${config.riskLimits.maxConcurrentMarkets}`
            ].join('\n'),
            inline: false
        });
        // Add recent activity if available
        const recentLogs = status.recentLogs || [];
        if (recentLogs.length > 0) {
            const recentActivity = recentLogs
                .slice(-5)
                .map(log => `${log.success ? '✅' : '❌'} ${log.type.toUpperCase()}: ${log.subtype}`)
                .join('\n');
            embed.addFields({
                name: "📝 Recent Activity",
                value: recentActivity || "No recent activity",
                inline: false
            });
        }
        // Add warning if system is not enabled
        if (!config.enabled) {
            embed.setDescription("⚠️ **Market automation is currently disabled**\n\nContact an administrator to enable automatic market creation.");
        }
        else if (status.consecutiveFailures >= 3) {
            embed.setDescription("🚨 **Automation temporarily suspended**\n\nMultiple consecutive failures detected. System will retry automatically.");
        }
        else {
            embed.setDescription("✅ Market automation is running smoothly and creating engaging prediction markets automatically.");
        }
        embed.setFooter({
            text: `Last updated • ${config.analytics.trackPerformance ? 'Analytics enabled' : 'Analytics disabled'}`
        });
        embed.setTimestamp();
        await i.editReply({ embeds: [embed] });
    }
    catch (error) {
        console.error("Automation status command error:", error);
        await i.editReply({
            content: `❌ **Error checking automation status**\n${error?.message || String(error)}`
        });
    }
}
