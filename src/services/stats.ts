// src/services/stats.ts - Bot statistics aggregation service
import { prisma } from "./db.js";
import { getDiscordClient, fetchMultipleServernames, fetchMultipleUsernames } from "./discord_users.js";

export interface BotStats {
  kpis: {
    totalServers: number;
    totalUsers: number;
    totalTips: number;
    totalGames: number;
  };
  serverBreakdown: ServerStats[];
  tokenBreakdown: TokenStats[];
  globalStats: {
    totalTipAmount: string;
    totalTipCount: number;
    totalGameCount: number;
    totalRegisteredUsers: number;
    avgTipSize: string;
  };
  highlights: {
    biggestTip: {
      amount: string;
      token: string;
      date: Date;
    } | null;
    mostActiveUser: {
      discordId: string;
      username?: string;
      tipCount: number;
      gameCount: number;
      totalActivity: number;
    } | null;
  };
  timeBreakdown: {
    daily: DailyStats[];
    weekly: WeeklyStats[];
  };
}

export interface ServerStats {
  guildId: string;
  serverName: string;
  tipCount: number;
  gameCount: number;
  groupTipCount: number;
  totalTipVolume: string;
  activeUsers: number;
  lastActivity: Date | null;
}

export interface TokenStats {
  tokenId: number;
  symbol: string;
  address: string;
  decimals: number;
  totalTipped: string;
  tipCount: number;
  avgTipSize: string;
  lastTip: Date | null;
}

export interface DailyStats {
  date: string;
  tips: number;
  games: number;
  newUsers: number;
  volume: string;
}

export interface WeeklyStats {
  weekStart: string;
  tips: number;
  games: number;
  newUsers: number;
  volume: string;
}

export class StatsService {
  async getBotStats(): Promise<BotStats> {
    console.log("🔄 Generating bot statistics...");
    
    const [
      kpis,
      serverBreakdown,
      tokenBreakdown,
      globalStats,
      highlights,
      timeBreakdown
    ] = await Promise.all([
      this.getKPIs(),
      this.getServerBreakdown(),
      this.getTokenBreakdown(),
      this.getGlobalStats(),
      this.getHighlights(),
      this.getTimeBreakdown()
    ]);

    return {
      kpis,
      serverBreakdown,
      tokenBreakdown,
      globalStats,
      highlights,
      timeBreakdown
    };
  }

  private async getKPIs() {
    const [servers, users, tips, games] = await Promise.all([
      // Total approved servers
      prisma.approvedServer.count({ where: { enabled: true } }),
      
      // Total registered users
      prisma.user.count(),
      
      // Total tips sent
      prisma.tip.count(),
      
      // Total games played
      prisma.match.count()
    ]);

    return {
      totalServers: servers,
      totalUsers: users,
      totalTips: tips,
      totalGames: games
    };
  }

  private async getServerBreakdown(): Promise<ServerStats[]> {
    // Get all approved servers
    const approvedServers = await prisma.approvedServer.findMany({
      where: { enabled: true },
      select: { guildId: true }
    });

    const guildIds = approvedServers.map(s => s.guildId);

    if (guildIds.length === 0) {
      return [];
    }

    // Get stats for each server
    const serverStatsPromises = guildIds.map(async (guildId) => {
      const [tipStats, gameStats, groupTipStats, lastActivity, activeUsers] = await Promise.all([
        // Tip stats - for now just get count from transactions, we'll fix amounts separately
        prisma.transaction.aggregate({
          where: { guildId, type: 'TIP' },
          _count: { id: true },
          _sum: { amount: true }
        }),

        // Game stats
        prisma.transaction.count({
          where: { guildId, type: { in: ['MATCH_RAKE', 'MATCH_WIN'] } }
        }),

        // Group tip stats
        prisma.groupTip.aggregate({
          where: { guildId },
          _count: { id: true }
        }),

        // Last activity
        prisma.transaction.findFirst({
          where: { guildId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        }),

        // Active users (users with activity in last 30 days)
        prisma.transaction.findMany({
          where: { 
            guildId,
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
          },
          select: { userId: true },
          distinct: ['userId']
        })
      ]);

      return {
        guildId,
        serverName: `Server ${guildId}`, // Will be updated with real names
        tipCount: tipStats._count.id || 0,
        gameCount: gameStats || 0,
        groupTipCount: groupTipStats._count.id || 0,
        totalTipVolume: (tipStats._sum.amount || 0).toString(),
        activeUsers: activeUsers.length,
        lastActivity: lastActivity?.createdAt || null
      };
    });

    let serverStats = await Promise.all(serverStatsPromises);

    // Fetch real server names
    try {
      if (guildIds.length > 0) {
        const client = getDiscordClient();
        if (client) {
          const serverNames = await fetchMultipleServernames(client, guildIds);
          serverStats = serverStats.map(stat => ({
            ...stat,
            serverName: serverNames.get(stat.guildId) || `Unknown Server (${stat.guildId})`
          }));
        }
      }
    } catch (error) {
      console.warn("Failed to fetch server names:", error);
    }

    // Sort by total activity (tips + games + group tips)
    return serverStats.sort((a, b) => 
      (b.tipCount + b.gameCount + b.groupTipCount) - (a.tipCount + a.gameCount + a.groupTipCount)
    );
  }

  private async getTokenBreakdown(): Promise<TokenStats[]> {
    const tokens = await prisma.token.findMany({
      where: { active: true },
      select: { id: true, symbol: true, address: true, decimals: true }
    });

    const tokenStatsPromises = tokens.map(async (token) => {
      const [tipStats, lastTip] = await Promise.all([
        prisma.tip.aggregate({
          where: { tokenId: token.id, status: 'COMPLETED' },
          _count: { id: true },
          _sum: { amountAtomic: true }
        }),

        prisma.tip.findFirst({
          where: { tokenId: token.id, status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        })
      ]);

      // Handle Prisma Decimal type properly
      const totalTippedDecimal = tipStats._sum.amountAtomic;
      const totalTipped = totalTippedDecimal ? totalTippedDecimal.toString() : '0';
      const tipCount = tipStats._count.id || 0;
      
      // Calculate average tip size in atomic units
      const avgTipSize = tipCount > 0 && totalTippedDecimal
        ? totalTippedDecimal.dividedBy(tipCount).toString()
        : '0';

      return {
        tokenId: token.id,
        symbol: token.symbol,
        address: token.address,
        decimals: token.decimals,
        totalTipped,
        tipCount,
        avgTipSize,
        lastTip: lastTip?.createdAt || null
      };
    });

    const tokenStats = await Promise.all(tokenStatsPromises);
    
    // Sort by total tipped amount (descending)
    return tokenStats.sort((a, b) => Number(b.totalTipped) - Number(a.totalTipped));
  }

  private async getGlobalStats() {
    const [tipStats, gameCount, userCount] = await Promise.all([
      prisma.tip.aggregate({
        where: { status: 'COMPLETED' },
        _count: { id: true },
        _sum: { amountAtomic: true }
      }),

      prisma.match.count({ where: { status: 'COMPLETED' } }),

      prisma.user.count()
    ]);

    // Handle Prisma Decimal type properly for global stats
    const totalTipAmountDecimal = tipStats._sum.amountAtomic;
    const totalTipAmount = totalTipAmountDecimal ? totalTipAmountDecimal.toString() : '0';
    const totalTipCount = tipStats._count.id || 0;
    const avgTipSize = totalTipCount > 0 && totalTipAmountDecimal
      ? totalTipAmountDecimal.dividedBy(totalTipCount).toString()
      : '0';

    return {
      totalTipAmount,
      totalTipCount,
      totalGameCount: gameCount,
      totalRegisteredUsers: userCount,
      avgTipSize
    };
  }

  private async getHighlights() {
    const [biggestTip, mostActiveUser] = await Promise.all([
      // Biggest single tip
      prisma.tip.findFirst({
        where: { status: 'COMPLETED' },
        orderBy: { amountAtomic: 'desc' },
        include: { Token: { select: { symbol: true } } }
      }),

      // Most active user (by total activity)
      this.getMostActiveUser()
    ]);

    return {
      biggestTip: biggestTip ? {
        amount: biggestTip.amountAtomic.toString(), // This is already correct, single tip amount
        token: biggestTip.Token?.symbol || 'Unknown',
        date: biggestTip.createdAt
      } : null,
      mostActiveUser
    };
  }

  private async getMostActiveUser() {
    // Get user activity counts
    const [tipCounts, gameCounts] = await Promise.all([
      prisma.tip.groupBy({
        by: ['fromUserId'],
        where: { 
          status: 'COMPLETED',
          fromUserId: { not: null }
        },
        _count: { id: true }
      }),

      prisma.match.groupBy({
        by: ['challengerId'],
        where: { 
          status: 'COMPLETED',
          challengerId: { not: null }
        },
        _count: { id: true }
      })
    ]);

    // Combine activity counts
    const userActivity = new Map<number, { tips: number; games: number }>();
    
    tipCounts.forEach(tip => {
      if (tip.fromUserId) {
        userActivity.set(tip.fromUserId, {
          tips: tip._count.id,
          games: userActivity.get(tip.fromUserId)?.games || 0
        });
      }
    });

    gameCounts.forEach(game => {
      if (game.challengerId) {
        const existing = userActivity.get(game.challengerId);
        userActivity.set(game.challengerId, {
          tips: existing?.tips || 0,
          games: game._count.id
        });
      }
    });

    // Find most active user
    let mostActive: { userId: number; tipCount: number; gameCount: number; total: number } | null = null;
    
    for (const [userId, activity] of userActivity) {
      const total = activity.tips + activity.games;
      if (!mostActive || total > mostActive.total) {
        mostActive = {
          userId,
          tipCount: activity.tips,
          gameCount: activity.games,
          total
        };
      }
    }

    if (!mostActive) return null;

    // Get user details
    const user = await prisma.user.findUnique({
      where: { id: mostActive.userId },
      select: { discordId: true }
    });

    if (!user) return null;

    // Fetch Discord username
    let username = `User ${user.discordId.slice(0, 8)}...`;
    try {
      const client = getDiscordClient();
      if (client) {
        const usernames = await fetchMultipleUsernames(client, [user.discordId]);
        username = usernames.get(user.discordId) || username;
      }
    } catch (error) {
      console.warn("Failed to fetch username for most active user:", error);
    }

    return {
      discordId: user.discordId,
      username,
      tipCount: mostActive.tipCount,
      gameCount: mostActive.gameCount,
      totalActivity: mostActive.total
    };
  }

  private async getTimeBreakdown() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fourWeeksAgo = new Date(now.getTime() - 4 * 7 * 24 * 60 * 60 * 1000);

    // Daily stats for last 30 days
    const dailyStatsPromises = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      const dayStart = new Date(date.setHours(0, 0, 0, 0));
      const dayEnd = new Date(date.setHours(23, 59, 59, 999));

      return this.getDayStats(dateStr, dayStart, dayEnd);
    });

    // Weekly stats for last 4 weeks
    const weeklyStatsPromises = Array.from({ length: 4 }, (_, i) => {
      const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
      
      return this.getWeekStats(weekStart.toISOString().split('T')[0], weekStart, weekEnd);
    });

    const [daily, weekly] = await Promise.all([
      Promise.all(dailyStatsPromises),
      Promise.all(weeklyStatsPromises)
    ]);

    return {
      daily: daily.reverse(), // Most recent first
      weekly: weekly.reverse()
    };
  }

  private async getDayStats(dateStr: string, dayStart: Date, dayEnd: Date): Promise<DailyStats> {
    const [tips, games, newUsers, volume] = await Promise.all([
      prisma.tip.count({
        where: { 
          status: 'COMPLETED',
          createdAt: { gte: dayStart, lte: dayEnd }
        }
      }),

      prisma.match.count({
        where: { 
          status: 'COMPLETED',
          createdAt: { gte: dayStart, lte: dayEnd }
        }
      }),

      prisma.user.count({
        where: { createdAt: { gte: dayStart, lte: dayEnd } }
      }),

      prisma.tip.aggregate({
        where: { 
          status: 'COMPLETED',
          createdAt: { gte: dayStart, lte: dayEnd }
        },
        _sum: { amountAtomic: true }
      })
    ]);

    return {
      date: dateStr,
      tips,
      games,
      newUsers,
      volume: volume._sum.amountAtomic ? volume._sum.amountAtomic.toString() : '0'
    };
  }

  private async getWeekStats(weekStart: string, start: Date, end: Date): Promise<WeeklyStats> {
    const [tips, games, newUsers, volume] = await Promise.all([
      prisma.tip.count({
        where: { 
          status: 'COMPLETED',
          createdAt: { gte: start, lte: end }
        }
      }),

      prisma.match.count({
        where: { 
          status: 'COMPLETED',
          createdAt: { gte: start, lte: end }
        }
      }),

      prisma.user.count({
        where: { createdAt: { gte: start, lte: end } }
      }),

      prisma.tip.aggregate({
        where: { 
          status: 'COMPLETED',
          createdAt: { gte: start, lte: end }
        },
        _sum: { amountAtomic: true }
      })
    ]);

    return {
      weekStart,
      tips,
      games,
      newUsers,
      volume: volume._sum.amountAtomic ? volume._sum.amountAtomic.toString() : '0'
    };
  }
}

// Export singleton instance
export const statsService = new StatsService();