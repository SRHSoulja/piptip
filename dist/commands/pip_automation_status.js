import { EmbedBuilder } from "discord.js";
import { marketAutomationScheduler } from "../services/market_automation_scheduler.js";
import { prisma } from "../services/db.js";
async function pipAutomationStatus(i) {
  try {
    await i.deferReply({ ephemeral: true });
    const status = marketAutomationScheduler.getStatus();
    const config = marketAutomationScheduler.getConfig();
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setDate(today.getDate() + 1);
    const [totalAutoMarkets, todayAutoMarkets, activeMarkets] = await Promise.all([
      prisma.predictionMarket.count({
        where: { creatorId: "automation" }
      }),
      prisma.predictionMarket.count({
        where: {
          creatorId: "automation",
          createdAt: {
            gte: today,
            lt: todayEnd
          }
        }
      }),
      prisma.predictionMarket.count({
        where: {
          status: "ACTIVE",
          creatorId: "automation"
        }
      })
    ]);
    const now = /* @__PURE__ */ new Date();
    const schedules = config.schedule.map((time) => {
      const [hours, minutes] = time.split(":").map(Number);
      const scheduledToday = /* @__PURE__ */ new Date();
      scheduledToday.setUTCHours(hours, minutes, 0, 0);
      if (scheduledToday <= now) {
        scheduledToday.setDate(scheduledToday.getDate() + 1);
      }
      return scheduledToday;
    });
    const nextRun = schedules.reduce(
      (earliest, current) => current < earliest ? current : earliest
    );
    const embed = new EmbedBuilder().setTitle("\u{1F916} Market Automation Status").setColor(config.enabled ? 1096065 : 15680580).addFields(
      {
        name: "\u{1F4CA} System Status",
        value: [
          `**Enabled:** ${config.enabled ? "\u2705 Yes" : "\u274C No"}`,
          `**Schedule:** ${config.schedule.join(", ")} UTC`,
          `**Daily Limit:** ${config.maxDailyMarkets} markets`,
          `**Next Run:** <t:${Math.floor(nextRun.getTime() / 1e3)}:R>`
        ].join("\n"),
        inline: true
      },
      {
        name: "\u{1F4C8} Market Statistics",
        value: [
          `**Total Auto-Created:** ${totalAutoMarkets}`,
          `**Created Today:** ${todayAutoMarkets}/${config.maxDailyMarkets}`,
          `**Currently Active:** ${activeMarkets}`,
          `**Consecutive Failures:** ${status.consecutiveFailures}`
        ].join("\n"),
        inline: true
      },
      {
        name: "\u{1F3AF} Content Types",
        value: [
          `**Crypto Markets:** ${config.crypto.enabled ? "\u2705" : "\u274C"} (${config.crypto.maxPerDay}/day)`,
          `**Sports Markets:** ${config.sports.enabled ? "\u2705" : "\u274C"} (${config.sports.maxPerDay}/day)`,
          `**API Health Check:** ${config.riskLimits.requireApiHealthCheck ? "\u2705" : "\u274C"}`,
          `**Max Concurrent:** ${config.riskLimits.maxConcurrentMarkets}`
        ].join("\n"),
        inline: false
      }
    );
    const recentLogs = status.todaysLogs || [];
    if (recentLogs.length > 0) {
      const recentActivity = recentLogs.slice(-5).map((log) => `${log.success ? "\u2705" : "\u274C"} ${log.type.toUpperCase()}: ${log.subtype}`).join("\n");
      embed.addFields({
        name: "\u{1F4DD} Recent Activity",
        value: recentActivity || "No recent activity",
        inline: false
      });
    }
    if (!config.enabled) {
      embed.setDescription("\u26A0\uFE0F **Market automation is currently disabled**\n\nContact an administrator to enable automatic market creation.");
    } else if (status.consecutiveFailures >= 3) {
      embed.setDescription("\u{1F6A8} **Automation temporarily suspended**\n\nMultiple consecutive failures detected. System will retry automatically.");
    } else {
      embed.setDescription("\u2705 Market automation is running smoothly and creating engaging prediction markets automatically.");
    }
    embed.setFooter({
      text: `Last updated \u2022 ${config.analytics.trackPerformance ? "Analytics enabled" : "Analytics disabled"}`
    });
    embed.setTimestamp();
    await i.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Automation status command error:", error);
    await i.editReply({
      content: `\u274C **Error checking automation status**
${error?.message || String(error)}`
    });
  }
}
export {
  pipAutomationStatus as default
};
//# sourceMappingURL=pip_automation_status.js.map
