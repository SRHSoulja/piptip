// src/services/role_analytics.ts - Role-based engagement analytics for partnerships

import { prisma } from './db.js';
import { getDiscordClient } from './discord_users.js';

export interface RoleEngagementMetrics {
  roleId: string;
  guildId: string;
  roleName?: string;
  guildName?: string;

  // Tip metrics
  tipsFromHolders: number;
  tipsToHolders: number;
  totalTipVolume: number;
  totalTaxSaved: number;
  averageTipSize: number;

  // Gaming metrics
  gamesPlayedByHolders: number;
  totalWageredByHolders: number;
  gamesWonByHolders: number;
  totalRakeSaved: number;        // NEW: Rake savings from role benefits

  // Engagement metrics
  activeHolders: number;
  newHoldersEngaged: number;
  returningHolders: number;

  // Comparison metrics
  holderEngagementRate: number; // % of role holders who engaged
  tipVolumeVsNonHolders: number; // Ratio of holder vs non-holder tip volume
  gamingActivityVsNonHolders: number; // Ratio of holder vs non-holder gaming
}

export class RoleAnalyticsService {

  // Generate daily analytics for a specific role (run via cron)
  static async generateDailyAnalytics(
    roleId: string,
    guildId: string,
    date = new Date()
  ): Promise<void> {

    // Set to start of day for consistent daily grouping
    const analyticsDate = new Date(date);
    analyticsDate.setUTCHours(0, 0, 0, 0);

    const startOfDay = new Date(analyticsDate);
    const endOfDay = new Date(analyticsDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    try {
      // Get Discord role member list to identify role holders
      const discord = getDiscordClient();
      let roleHolderIds: Set<string> = new Set();

      if (discord) {
        try {
          const guild = await discord.guilds.fetch(guildId);
          const role = await guild?.roles.fetch(roleId);
          if (role) {
            roleHolderIds = new Set(role.members.keys());
          }
        } catch (error) {
          console.error(`Failed to fetch role members for analytics: ${roleId}`, error);
        }
      }

      // Query tips from role holders
      const tipMetrics = await prisma.tip.aggregate({
        where: {
          guildId,
          createdAt: { gte: startOfDay, lte: endOfDay },
          status: 'COMPLETED',
          From: {
            discordId: { in: Array.from(roleHolderIds) }
          }
        },
        _count: { id: true },
        _sum: {
          amountAtomic: true,
          taxSavedAtomic: true
        },
        _avg: { amountAtomic: true }
      });

      // Query tips received by role holders
      const tipsReceived = await prisma.tip.count({
        where: {
          guildId,
          createdAt: { gte: startOfDay, lte: endOfDay },
          status: 'COMPLETED',
          To: {
            discordId: { in: Array.from(roleHolderIds) }
          }
        }
      });

      // Query gaming activity by role holders
      const gameMetrics = await prisma.match.aggregate({
        where: {
          guildId,
          createdAt: { gte: startOfDay, lte: endOfDay },
          status: 'COMPLETED',
          OR: [
            { Challenger: { discordId: { in: Array.from(roleHolderIds) } } },
            { Joiner: { discordId: { in: Array.from(roleHolderIds) } } }
          ]
        },
        _count: { id: true },
        _sum: {
          wagerAtomic: true,
          rakeSavedAtomic: true  // NEW: Sum rake savings
        }
      });

      // Query wins by role holders (need to join with User table via winnerUserId)
      const winsCount = await prisma.match.count({
        where: {
          guildId,
          createdAt: { gte: startOfDay, lte: endOfDay },
          status: 'COMPLETED',
          winnerUserId: {
            in: await prisma.user.findMany({
              where: { discordId: { in: Array.from(roleHolderIds) } },
              select: { id: true }
            }).then(users => users.map(u => u.id))
          }
        }
      });

      // Count unique active role holders (tipped OR gamed today)
      const activeHolders = await prisma.user.count({
        where: {
          discordId: { in: Array.from(roleHolderIds) },
          OR: [
            {
              tipsSent: {
                some: {
                  createdAt: { gte: startOfDay, lte: endOfDay },
                  status: 'COMPLETED',
                  guildId
                }
              }
            },
            {
              challenger: {
                some: {
                  createdAt: { gte: startOfDay, lte: endOfDay },
                  status: 'COMPLETED',
                  guildId
                }
              }
            },
            {
              joiner: {
                some: {
                  createdAt: { gte: startOfDay, lte: endOfDay },
                  status: 'COMPLETED',
                  guildId
                }
              }
            }
          ]
        }
      });

      // Calculate retention (active yesterday AND today)
      const yesterdayStart = new Date(startOfDay);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const yesterdayEnd = new Date(endOfDay);
      yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);

      const returningHolders = await prisma.user.count({
        where: {
          discordId: { in: Array.from(roleHolderIds) },
          AND: [
            // Active today
            {
              OR: [
                {
                  tipsSent: {
                    some: {
                      createdAt: { gte: startOfDay, lte: endOfDay },
                      status: 'COMPLETED',
                      guildId
                    }
                  }
                },
                {
                  challenger: {
                    some: {
                      createdAt: { gte: startOfDay, lte: endOfDay },
                      status: 'COMPLETED',
                      guildId
                    }
                  }
                }
              ]
            },
            // Active yesterday
            {
              OR: [
                {
                  tipsSent: {
                    some: {
                      createdAt: { gte: yesterdayStart, lte: yesterdayEnd },
                      status: 'COMPLETED',
                      guildId
                    }
                  }
                },
                {
                  challenger: {
                    some: {
                      createdAt: { gte: yesterdayStart, lte: yesterdayEnd },
                      status: 'COMPLETED',
                      guildId
                    }
                  }
                }
              ]
            }
          ]
        }
      });

      // Detect new role holders who engaged for first time
      const newHoldersEngaged = await prisma.user.count({
        where: {
          discordId: { in: Array.from(roleHolderIds) },
          // Active today
          OR: [
            {
              tipsSent: {
                some: {
                  createdAt: { gte: startOfDay, lte: endOfDay },
                  status: 'COMPLETED',
                  guildId
                }
              }
            },
            {
              challenger: {
                some: {
                  createdAt: { gte: startOfDay, lte: endOfDay },
                  status: 'COMPLETED',
                  guildId
                }
              }
            }
          ],
          // But never active before
          NOT: {
            OR: [
              {
                tipsSent: {
                  some: {
                    createdAt: { lt: startOfDay },
                    status: 'COMPLETED'
                  }
                }
              },
              {
                challenger: {
                  some: {
                    createdAt: { lt: startOfDay },
                    status: 'COMPLETED'
                  }
                }
              }
            ]
          }
        }
      });

      // Upsert daily analytics record
      await prisma.roleBenefitAnalytics.upsert({
        where: {
          roleId_guildId_date: {
            roleId,
            guildId,
            date: analyticsDate
          }
        },
        create: {
          roleId,
          guildId,
          date: analyticsDate,
          tipsFromRoleHolders: tipMetrics._count.id || 0,
          tipsToRoleHolders: tipsReceived || 0,
          totalTipVolumeAtomic: tipMetrics._sum.amountAtomic || 0,
          totalTaxSavedAtomic: tipMetrics._sum.taxSavedAtomic || 0,
          averageTipSizeAtomic: tipMetrics._avg.amountAtomic || 0,
          gamesPlayedByRoleHolders: gameMetrics._count.id || 0,
          totalWageredAtomic: gameMetrics._sum.wagerAtomic || 0,
          gamesWonByRoleHolders: winsCount || 0,
          totalRakeSavedAtomic: gameMetrics._sum.rakeSavedAtomic || 0,  // NEW
          averageWagerSizeAtomic: gameMetrics._count.id ? Number(gameMetrics._sum.wagerAtomic || 0) / gameMetrics._count.id : 0, // NEW
          activeRoleHolders: activeHolders || 0,
          newRoleHoldersEngaged: newHoldersEngaged || 0,
          returningRoleHolders: returningHolders || 0
        },
        update: {
          tipsFromRoleHolders: tipMetrics._count.id || 0,
          tipsToRoleHolders: tipsReceived || 0,
          totalTipVolumeAtomic: tipMetrics._sum.amountAtomic || 0,
          totalTaxSavedAtomic: tipMetrics._sum.taxSavedAtomic || 0,
          averageTipSizeAtomic: tipMetrics._avg.amountAtomic || 0,
          gamesPlayedByRoleHolders: gameMetrics._count.id || 0,
          totalWageredAtomic: gameMetrics._sum.wagerAtomic || 0,
          gamesWonByRoleHolders: winsCount || 0,
          totalRakeSavedAtomic: gameMetrics._sum.rakeSavedAtomic || 0,  // NEW
          averageWagerSizeAtomic: gameMetrics._count.id ? Number(gameMetrics._sum.wagerAtomic || 0) / gameMetrics._count.id : 0, // NEW
          activeRoleHolders: activeHolders || 0,
          newRoleHoldersEngaged: newHoldersEngaged || 0,
          returningRoleHolders: returningHolders || 0
        }
      });

      console.log(`📊 Generated analytics for role ${roleId} on ${analyticsDate.toISOString().split('T')[0]}: ${activeHolders} active holders, ${tipMetrics._count.id} tips`);

    } catch (error) {
      console.error(`Failed to generate role analytics for ${roleId}:`, error);
    }
  }

  // Get partnership report for admin dashboard
  static async getPartnershipReport(
    roleId: string,
    guildId: string,
    days = 30
  ): Promise<RoleEngagementMetrics> {

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Aggregate metrics from daily analytics
    const analytics = await prisma.roleBenefitAnalytics.aggregate({
      where: {
        roleId,
        guildId,
        date: { gte: startDate, lte: endDate }
      },
      _sum: {
        tipsFromRoleHolders: true,
        tipsToRoleHolders: true,
        totalTipVolumeAtomic: true,
        totalTaxSavedAtomic: true,
        gamesPlayedByRoleHolders: true,
        totalWageredAtomic: true,
        gamesWonByRoleHolders: true,
        totalRakeSavedAtomic: true,       // NEW
        newRoleHoldersEngaged: true
      },
      _avg: {
        activeRoleHolders: true,
        returningRoleHolders: true,
        averageTipSizeAtomic: true
      }
    });

    // Get Discord info for enrichment
    let roleName = 'Unknown Role';
    let guildName = 'Unknown Server';
    let totalRoleMembers = 0;

    try {
      const discord = getDiscordClient();
      const guild = await discord?.guilds.fetch(guildId);
      const role = await guild?.roles.fetch(roleId);

      if (guild) guildName = guild.name;
      if (role) {
        roleName = role.name;
        totalRoleMembers = role.members.size;
      }
    } catch (error) {
      console.error('Failed to enrich role analytics with Discord data:', error);
    }

    // Calculate comparative metrics (role holders vs general population)
    const holderEngagementRate = totalRoleMembers > 0
      ? (analytics._avg.activeRoleHolders || 0) / totalRoleMembers
      : 0;

    return {
      roleId,
      guildId,
      roleName,
      guildName,
      tipsFromHolders: analytics._sum.tipsFromRoleHolders || 0,
      tipsToHolders: analytics._sum.tipsToRoleHolders || 0,
      totalTipVolume: Number(analytics._sum.totalTipVolumeAtomic || 0),
      totalTaxSaved: Number(analytics._sum.totalTaxSavedAtomic || 0),
      averageTipSize: Number(analytics._avg.averageTipSizeAtomic || 0),
      gamesPlayedByHolders: analytics._sum.gamesPlayedByRoleHolders || 0,
      totalWageredByHolders: Number(analytics._sum.totalWageredAtomic || 0),
      gamesWonByHolders: analytics._sum.gamesWonByRoleHolders || 0,
      totalRakeSaved: Number(analytics._sum.totalRakeSavedAtomic || 0),  // NEW
      activeHolders: Math.round(analytics._avg.activeRoleHolders || 0),
      newHoldersEngaged: analytics._sum.newRoleHoldersEngaged || 0,
      returningHolders: Math.round(analytics._avg.returningRoleHolders || 0),
      holderEngagementRate,
      tipVolumeVsNonHolders: 1, // TODO: Calculate comparison
      gamingActivityVsNonHolders: 1 // TODO: Calculate comparison
    };
  }

  // Generate analytics for all active role exemptions (daily cron job)
  static async generateAllRoleAnalytics(date = new Date()): Promise<number> {

    const activeExemptions = await prisma.roleTaxExemption.findMany({
      where: {
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      select: {
        roleId: true,
        guildId: true
      }
    });

    let processed = 0;
    for (const exemption of activeExemptions) {
      try {
        await this.generateDailyAnalytics(exemption.roleId, exemption.guildId, date);
        processed++;
      } catch (error) {
        console.error(`Failed to process analytics for ${exemption.roleId}:`, error);
      }
    }

    console.log(`📊 Processed daily analytics for ${processed}/${activeExemptions.length} role exemptions`);
    return processed;
  }
}

// Schedule daily analytics generation (run at 1 AM UTC)
setInterval(() => {
  const now = new Date();
  if (now.getUTCHours() === 1 && now.getUTCMinutes() === 0) {
    RoleAnalyticsService.generateAllRoleAnalytics(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  }
}, 60 * 1000); // Check every minute