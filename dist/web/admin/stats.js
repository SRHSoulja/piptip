import { Router } from "express";
import { statsService } from "../../services/stats.js";
const statsRouter = Router();
statsRouter.get("/stats/dashboard", async (req, res) => {
  try {
    const stats = await statsService.getBotStats();
    res.json({ ok: true, stats });
  } catch (error) {
    console.error("Failed to get bot stats:", error);
    res.status(500).json({ ok: false, error: "Failed to load bot statistics" });
  }
});
statsRouter.get("/stats/kpis", async (req, res) => {
  try {
    const [servers, users, tips, games] = await Promise.all([
      // Total approved servers
      require("../../services/db.js").prisma.approvedServer.count({ where: { enabled: true } }),
      // Total registered users
      require("../../services/db.js").prisma.user.count(),
      // Total tips sent
      require("../../services/db.js").prisma.tip.count({ where: { status: "COMPLETED" } }),
      // Total games played
      require("../../services/db.js").prisma.match.count({ where: { status: "COMPLETED" } })
    ]);
    const kpis = {
      totalServers: servers,
      totalUsers: users,
      totalTips: tips,
      totalGames: games
    };
    res.json({ ok: true, kpis });
  } catch (error) {
    console.error("Failed to get KPIs:", error);
    res.status(500).json({ ok: false, error: "Failed to load KPIs" });
  }
});
statsRouter.get("/stats/servers", async (req, res) => {
  try {
    const { sort = "activity" } = req.query;
    const stats = await statsService.getBotStats();
    let servers = stats.serverBreakdown;
    switch (sort) {
      case "tips":
        servers = servers.sort((a, b) => b.tipCount - a.tipCount);
        break;
      case "games":
        servers = servers.sort((a, b) => b.gameCount - a.gameCount);
        break;
      case "volume":
        servers = servers.sort((a, b) => Number(b.totalTipVolume) - Number(a.totalTipVolume));
        break;
      case "users":
        servers = servers.sort((a, b) => b.activeUsers - a.activeUsers);
        break;
      case "activity":
      default:
        servers = servers.sort(
          (a, b) => b.tipCount + b.gameCount + b.groupTipCount - (a.tipCount + a.gameCount + a.groupTipCount)
        );
        break;
    }
    res.json({ ok: true, servers });
  } catch (error) {
    console.error("Failed to get server stats:", error);
    res.status(500).json({ ok: false, error: "Failed to load server statistics" });
  }
});
statsRouter.get("/stats/tokens", async (req, res) => {
  try {
    const { sort = "volume" } = req.query;
    const stats = await statsService.getBotStats();
    let tokens = stats.tokenBreakdown;
    switch (sort) {
      case "count":
        tokens = tokens.sort((a, b) => b.tipCount - a.tipCount);
        break;
      case "avg":
        tokens = tokens.sort((a, b) => Number(b.avgTipSize) - Number(a.avgTipSize));
        break;
      case "recent":
        tokens = tokens.sort((a, b) => {
          if (!a.lastTip && !b.lastTip) return 0;
          if (!a.lastTip) return 1;
          if (!b.lastTip) return -1;
          return new Date(b.lastTip).getTime() - new Date(a.lastTip).getTime();
        });
        break;
      case "volume":
      default:
        tokens = tokens.sort((a, b) => Number(b.totalTipped) - Number(a.totalTipped));
        break;
    }
    res.json({ ok: true, tokens });
  } catch (error) {
    console.error("Failed to get token stats:", error);
    res.status(500).json({ ok: false, error: "Failed to load token statistics" });
  }
});
statsRouter.get("/stats/trends", async (req, res) => {
  try {
    const { period = "daily" } = req.query;
    const stats = await statsService.getBotStats();
    const trends = period === "weekly" ? stats.timeBreakdown.weekly : stats.timeBreakdown.daily;
    res.json({ ok: true, trends, period });
  } catch (error) {
    console.error("Failed to get trends:", error);
    res.status(500).json({ ok: false, error: "Failed to load trend data" });
  }
});
statsRouter.get("/stats/highlights", async (req, res) => {
  try {
    const stats = await statsService.getBotStats();
    res.json({
      ok: true,
      highlights: stats.highlights,
      globalStats: stats.globalStats
    });
  } catch (error) {
    console.error("Failed to get highlights:", error);
    res.status(500).json({ ok: false, error: "Failed to load highlight statistics" });
  }
});
statsRouter.get("/stats/export", async (req, res) => {
  try {
    const stats = await statsService.getBotStats();
    let csv = "category,metric,value,details\n";
    csv += `"Global","Total Servers","${stats.kpis.totalServers}","Enabled servers"
`;
    csv += `"Global","Total Users","${stats.kpis.totalUsers}","Registered users"
`;
    csv += `"Global","Total Tips","${stats.kpis.totalTips}","Completed tips"
`;
    csv += `"Global","Total Games","${stats.kpis.totalGames}","Completed games"
`;
    csv += `"Global","Average Tip Size","${stats.globalStats.avgTipSize}","Atomic units"
`;
    stats.serverBreakdown.forEach((server) => {
      csv += `"Server","${server.serverName}","${server.tipCount}","Tips sent"
`;
      csv += `"Server","${server.serverName}","${server.gameCount}","Games played"
`;
      csv += `"Server","${server.serverName}","${server.activeUsers}","Active users (30d)"
`;
    });
    stats.tokenBreakdown.forEach((token) => {
      csv += `"Token","${token.symbol}","${token.totalTipped}","Total tipped"
`;
      csv += `"Token","${token.symbol}","${token.tipCount}","Tip count"
`;
      csv += `"Token","${token.symbol}","${token.avgTipSize}","Average tip size"
`;
    });
    const filename = `bot_stats_${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error("Failed to export stats:", error);
    res.status(500).json({ ok: false, error: "Failed to export statistics" });
  }
});
export {
  statsRouter
};
//# sourceMappingURL=stats.js.map
