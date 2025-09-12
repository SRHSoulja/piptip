// src/web/admin/stats.ts - Bot statistics admin endpoints
import { Router, Request, Response } from "express";
import { statsService } from "../../services/stats.js";

export const statsRouter = Router();

// Get comprehensive bot statistics
statsRouter.get("/stats/dashboard", async (req: Request, res: Response) => {
  try {
    const stats = await statsService.getBotStats();
    res.json({ ok: true, stats });
  } catch (error) {
    console.error("Failed to get bot stats:", error);
    res.status(500).json({ ok: false, error: "Failed to load bot statistics" });
  }
});

// Get just KPIs for quick dashboard updates
statsRouter.get("/stats/kpis", async (req: Request, res: Response) => {
  try {
    const [servers, users, tips, games] = await Promise.all([
      // Total approved servers
      require("../../services/db.js").prisma.approvedServer.count({ where: { enabled: true } }),
      
      // Total registered users
      require("../../services/db.js").prisma.user.count(),
      
      // Total tips sent
      require("../../services/db.js").prisma.tip.count({ where: { status: 'COMPLETED' } }),
      
      // Total games played
      require("../../services/db.js").prisma.match.count({ where: { status: 'COMPLETED' } })
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

// Get server breakdown with optional sorting
statsRouter.get("/stats/servers", async (req: Request, res: Response) => {
  try {
    const { sort = 'activity' } = req.query;
    const stats = await statsService.getBotStats();
    let servers = stats.serverBreakdown;

    // Apply sorting
    switch (sort) {
      case 'tips':
        servers = servers.sort((a, b) => b.tipCount - a.tipCount);
        break;
      case 'games':
        servers = servers.sort((a, b) => b.gameCount - a.gameCount);
        break;
      case 'volume':
        servers = servers.sort((a, b) => Number(b.totalTipVolume) - Number(a.totalTipVolume));
        break;
      case 'users':
        servers = servers.sort((a, b) => b.activeUsers - a.activeUsers);
        break;
      case 'activity':
      default:
        servers = servers.sort((a, b) => 
          (b.tipCount + b.gameCount + b.groupTipCount) - (a.tipCount + a.gameCount + a.groupTipCount)
        );
        break;
    }

    res.json({ ok: true, servers });
  } catch (error) {
    console.error("Failed to get server stats:", error);
    res.status(500).json({ ok: false, error: "Failed to load server statistics" });
  }
});

// Get token breakdown with optional sorting
statsRouter.get("/stats/tokens", async (req: Request, res: Response) => {
  try {
    const { sort = 'volume' } = req.query;
    const stats = await statsService.getBotStats();
    let tokens = stats.tokenBreakdown;

    // Apply sorting
    switch (sort) {
      case 'count':
        tokens = tokens.sort((a, b) => b.tipCount - a.tipCount);
        break;
      case 'avg':
        tokens = tokens.sort((a, b) => Number(b.avgTipSize) - Number(a.avgTipSize));
        break;
      case 'recent':
        tokens = tokens.sort((a, b) => {
          if (!a.lastTip && !b.lastTip) return 0;
          if (!a.lastTip) return 1;
          if (!b.lastTip) return -1;
          return new Date(b.lastTip).getTime() - new Date(a.lastTip).getTime();
        });
        break;
      case 'volume':
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

// Get time-based trends
statsRouter.get("/stats/trends", async (req: Request, res: Response) => {
  try {
    const { period = 'daily' } = req.query;
    const stats = await statsService.getBotStats();
    
    const trends = period === 'weekly' 
      ? stats.timeBreakdown.weekly 
      : stats.timeBreakdown.daily;

    res.json({ ok: true, trends, period });
  } catch (error) {
    console.error("Failed to get trends:", error);
    res.status(500).json({ ok: false, error: "Failed to load trend data" });
  }
});

// Get highlight stats (biggest tip, most active user, etc.)
statsRouter.get("/stats/highlights", async (req: Request, res: Response) => {
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

// Export stats as CSV
statsRouter.get("/stats/export", async (req: Request, res: Response) => {
  try {
    const stats = await statsService.getBotStats();
    
    let csv = "category,metric,value,details\n";
    
    // Add KPIs
    csv += `"Global","Total Servers","${stats.kpis.totalServers}","Enabled servers"\n`;
    csv += `"Global","Total Users","${stats.kpis.totalUsers}","Registered users"\n`;
    csv += `"Global","Total Tips","${stats.kpis.totalTips}","Completed tips"\n`;
    csv += `"Global","Total Games","${stats.kpis.totalGames}","Completed games"\n`;
    csv += `"Global","Average Tip Size","${stats.globalStats.avgTipSize}","Atomic units"\n`;
    
    // Add server breakdown
    stats.serverBreakdown.forEach(server => {
      csv += `"Server","${server.serverName}","${server.tipCount}","Tips sent"\n`;
      csv += `"Server","${server.serverName}","${server.gameCount}","Games played"\n`;
      csv += `"Server","${server.serverName}","${server.activeUsers}","Active users (30d)"\n`;
    });
    
    // Add token breakdown
    stats.tokenBreakdown.forEach(token => {
      csv += `"Token","${token.symbol}","${token.totalTipped}","Total tipped"\n`;
      csv += `"Token","${token.symbol}","${token.tipCount}","Tip count"\n`;
      csv += `"Token","${token.symbol}","${token.avgTipSize}","Average tip size"\n`;
    });
    
    const filename = `bot_stats_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error("Failed to export stats:", error);
    res.status(500).json({ ok: false, error: "Failed to export statistics" });
  }
});