// src/services/stats_aggregator.ts - Maintains aggregate statistics for performance
import { prisma } from './db.js';
import { Decimal } from '@prisma/client/runtime/library';
// Update user statistics after a tip
export async function updateUserStatsForTip(fromUserId, toUserId, amountAtomic, status) {
    try {
        if (status === 'COMPLETED') {
            // Update sender stats
            await prisma.userStats.upsert({
                where: { userId: fromUserId },
                create: {
                    userId: fromUserId,
                    totalTipsSent: 1,
                    totalTipAmountSent: amountAtomic,
                    lastTipAt: new Date(),
                },
                update: {
                    totalTipsSent: { increment: 1 },
                    totalTipAmountSent: { increment: amountAtomic },
                    lastTipAt: new Date(),
                    updatedAt: new Date(),
                },
            });
            // Update receiver stats
            await prisma.userStats.upsert({
                where: { userId: toUserId },
                create: {
                    userId: toUserId,
                    totalTipsReceived: 1,
                    totalTipAmountReceived: amountAtomic,
                },
                update: {
                    totalTipsReceived: { increment: 1 },
                    totalTipAmountReceived: { increment: amountAtomic },
                    updatedAt: new Date(),
                },
            });
            // Update unique recipient count for sender (expensive, run less frequently)
            await updateUniqueRecipientCount(fromUserId);
            await updateUniqueSenderCount(toUserId);
        }
    }
    catch (error) {
        console.error('Error updating user stats for tip:', error);
    }
}
// Update user statistics after a match
export async function updateUserStatsForMatch(userId, result) {
    try {
        const updateData = {
            lastMatchAt: new Date(),
            updatedAt: new Date(),
        };
        switch (result) {
            case 'WIN':
                updateData.matchesWon = { increment: 1 };
                break;
            case 'LOSS':
                updateData.matchesLost = { increment: 1 };
                break;
            case 'TIE':
                updateData.matchesTied = { increment: 1 };
                break;
        }
        await prisma.userStats.upsert({
            where: { userId },
            create: {
                userId,
                ...updateData,
                matchesWon: result === 'WIN' ? 1 : 0,
                matchesLost: result === 'LOSS' ? 1 : 0,
                matchesTied: result === 'TIE' ? 1 : 0,
            },
            update: updateData,
        });
    }
    catch (error) {
        console.error('Error updating user stats for match:', error);
    }
}
// Update user statistics after a deposit
export async function updateUserStatsForDeposit(userId, amountAtomic) {
    try {
        await prisma.userStats.upsert({
            where: { userId },
            create: {
                userId,
                totalDeposited: amountAtomic,
                lastDepositAt: new Date(),
            },
            update: {
                totalDeposited: { increment: amountAtomic },
                lastDepositAt: new Date(),
                updatedAt: new Date(),
            },
        });
    }
    catch (error) {
        console.error('Error updating user stats for deposit:', error);
    }
}
// Update user statistics after achievement unlock
export async function updateUserStatsForAchievement(userId) {
    try {
        await prisma.userStats.upsert({
            where: { userId },
            create: {
                userId,
                achievementCount: 1,
            },
            update: {
                achievementCount: { increment: 1 },
                updatedAt: new Date(),
            },
        });
    }
    catch (error) {
        console.error('Error updating user stats for achievement:', error);
    }
}
// Expensive operation: Update unique recipient count (run periodically)
async function updateUniqueRecipientCount(userId) {
    try {
        // Use raw query for better performance
        const result = await prisma.$queryRaw `
      SELECT COUNT(DISTINCT "toUserId") as count
      FROM "Tip"
      WHERE "fromUserId" = ${userId} AND "status" = 'COMPLETED'
    `;
        const uniqueCount = Number(result[0]?.count || 0);
        await prisma.userStats.upsert({
            where: { userId },
            create: {
                userId,
                uniqueRecipients: uniqueCount,
            },
            update: {
                uniqueRecipients: uniqueCount,
                updatedAt: new Date(),
            },
        });
    }
    catch (error) {
        console.error('Error updating unique recipient count:', error);
    }
}
// Expensive operation: Update unique sender count (run periodically)
async function updateUniqueSenderCount(userId) {
    try {
        const result = await prisma.$queryRaw `
      SELECT COUNT(DISTINCT "fromUserId") as count
      FROM "Tip"
      WHERE "toUserId" = ${userId} AND "status" = 'COMPLETED'
    `;
        const uniqueCount = Number(result[0]?.count || 0);
        await prisma.userStats.upsert({
            where: { userId },
            create: {
                userId,
                uniqueSenders: uniqueCount,
            },
            update: {
                uniqueSenders: uniqueCount,
                updatedAt: new Date(),
            },
        });
    }
    catch (error) {
        console.error('Error updating unique sender count:', error);
    }
}
// Optimized leaderboard queries using aggregate tables
export async function getOptimizedTipLeaderboard(limit = 10) {
    try {
        const topTippers = await prisma.userStats.findMany({
            where: {
                totalTipsSent: { gt: 0 }
            },
            orderBy: [
                { totalTipsSent: 'desc' },
                { updatedAt: 'desc' }
            ],
            take: limit,
            include: {
                user: {
                    select: { discordId: true }
                }
            }
        });
        return topTippers.map((stats, index) => ({
            rank: index + 1,
            discordId: stats.user.discordId,
            tipCount: stats.totalTipsSent,
            tipAmount: Number(stats.totalTipAmountSent),
            uniqueRecipients: stats.uniqueRecipients,
            lastTipAt: stats.lastTipAt,
        }));
    }
    catch (error) {
        console.error('Error getting optimized tip leaderboard:', error);
        return [];
    }
}
// Optimized match leaderboard using aggregate tables
export async function getOptimizedMatchLeaderboard(limit = 10) {
    try {
        const topPlayers = await prisma.userStats.findMany({
            where: {
                matchesWon: { gt: 0 }
            },
            orderBy: [
                { matchesWon: 'desc' },
                { updatedAt: 'desc' }
            ],
            take: limit,
            include: {
                user: {
                    select: { discordId: true }
                }
            }
        });
        return topPlayers.map((stats, index) => ({
            rank: index + 1,
            discordId: stats.user.discordId,
            wins: stats.matchesWon,
            losses: stats.matchesLost,
            ties: stats.matchesTied,
            winRate: stats.matchesWon / (stats.matchesWon + stats.matchesLost + stats.matchesTied),
            lastMatchAt: stats.lastMatchAt,
        }));
    }
    catch (error) {
        console.error('Error getting optimized match leaderboard:', error);
        return [];
    }
}
// Update daily statistics (run via cron job)
export async function updateDailyStats() {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // Get today's aggregated data
        const [tipStats, depositStats, matchStats, userStats, achievementStats] = await Promise.all([
            // Tips completed today
            prisma.tip.aggregate({
                where: {
                    status: 'COMPLETED',
                    createdAt: { gte: today }
                },
                _count: { id: true },
                _sum: { amountAtomic: true }
            }),
            // Deposits today
            prisma.transaction.aggregate({
                where: {
                    type: 'DEPOSIT',
                    createdAt: { gte: today }
                },
                _count: { id: true },
                _sum: { amount: true }
            }),
            // Matches today
            prisma.match.count({
                where: {
                    status: 'COMPLETED',
                    createdAt: { gte: today }
                }
            }),
            // User statistics
            Promise.all([
                prisma.user.count({
                    where: { createdAt: { gte: today } }
                }),
                prisma.$queryRaw `
          SELECT COUNT(DISTINCT u.id) as count
          FROM "User" u
          INNER JOIN "Tip" t ON (u.id = t."fromUserId" OR u.id = t."toUserId")
          WHERE t."createdAt" >= ${today} AND t."status" = 'COMPLETED'
        `
            ]).then(([newUsers, activeUsersResult]) => ({
                newUsers,
                activeUsers: Number(activeUsersResult[0]?.count || 0)
            })),
            // Achievements unlocked today
            prisma.achievement.count({
                where: { unlockedAt: { gte: today } }
            })
        ]);
        // Upsert daily stats
        await prisma.dailyStats.upsert({
            where: { date: today },
            create: {
                date: today,
                totalTips: tipStats._count.id,
                totalTipVolume: tipStats._sum.amountAtomic || new Decimal(0),
                totalDeposits: depositStats._count.id,
                totalDepositVolume: depositStats._sum.amount || new Decimal(0),
                totalMatches: matchStats,
                newUsers: userStats.newUsers,
                activeUsers: userStats.activeUsers,
                achievementsUnlocked: achievementStats,
            },
            update: {
                totalTips: tipStats._count.id,
                totalTipVolume: tipStats._sum.amountAtomic || new Decimal(0),
                totalDeposits: depositStats._count.id,
                totalDepositVolume: depositStats._sum.amount || new Decimal(0),
                totalMatches: matchStats,
                newUsers: userStats.newUsers,
                activeUsers: userStats.activeUsers,
                achievementsUnlocked: achievementStats,
                updatedAt: new Date(),
            },
        });
        console.log(`Daily stats updated for ${today.toISOString().split('T')[0]}`);
    }
    catch (error) {
        console.error('Error updating daily stats:', error);
    }
}
// Rebuild user stats from scratch (for data integrity)
export async function rebuildUserStats(userId) {
    try {
        const whereClause = userId ? { id: userId } : {};
        const users = await prisma.user.findMany({
            where: whereClause,
            select: { id: true }
        });
        console.log(`Rebuilding stats for ${users.length} users...`);
        for (const user of users) {
            // Get aggregated data for this user
            const [tipsSent, tipsReceived, deposits, matches, achievements] = await Promise.all([
                prisma.tip.aggregate({
                    where: { fromUserId: user.id, status: 'COMPLETED' },
                    _count: { id: true },
                    _sum: { amountAtomic: true },
                    _max: { createdAt: true }
                }),
                prisma.tip.aggregate({
                    where: { toUserId: user.id, status: 'COMPLETED' },
                    _count: { id: true },
                    _sum: { amountAtomic: true }
                }),
                prisma.transaction.aggregate({
                    where: { userId: user.id, type: 'DEPOSIT' },
                    _sum: { amount: true },
                    _max: { createdAt: true }
                }),
                prisma.match.aggregate({
                    where: {
                        OR: [
                            { challengerId: user.id },
                            { joinerId: user.id }
                        ],
                        status: 'COMPLETED'
                    },
                    _max: { createdAt: true }
                }),
                prisma.achievement.count({
                    where: { userId: user.id }
                })
            ]);
            // Get match results breakdown
            const matchResults = await prisma.$queryRaw `
        SELECT
          SUM(CASE WHEN "winnerUserId" = ${user.id} THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN "winnerUserId" IS NOT NULL AND "winnerUserId" != ${user.id} THEN 1 ELSE 0 END) as losses,
          SUM(CASE WHEN "result" = 'TIE' THEN 1 ELSE 0 END) as ties
        FROM "Match"
        WHERE ("challengerId" = ${user.id} OR "joinerId" = ${user.id}) AND "status" = 'COMPLETED'
      `;
            const wins = Number(matchResults[0]?.wins || 0);
            const losses = Number(matchResults[0]?.losses || 0);
            const ties = Number(matchResults[0]?.ties || 0);
            // Upsert the complete stats
            await prisma.userStats.upsert({
                where: { userId: user.id },
                create: {
                    userId: user.id,
                    totalTipsSent: tipsSent._count.id,
                    totalTipsReceived: tipsReceived._count.id,
                    totalTipAmountSent: tipsSent._sum.amountAtomic || new Decimal(0),
                    totalTipAmountReceived: tipsReceived._sum.amountAtomic || new Decimal(0),
                    totalDeposited: deposits._sum.amount || new Decimal(0),
                    matchesWon: wins,
                    matchesLost: losses,
                    matchesTied: ties,
                    achievementCount: achievements,
                    lastTipAt: tipsSent._max.createdAt,
                    lastMatchAt: matches._max.createdAt,
                    lastDepositAt: deposits._max.createdAt,
                },
                update: {
                    totalTipsSent: tipsSent._count.id,
                    totalTipsReceived: tipsReceived._count.id,
                    totalTipAmountSent: tipsSent._sum.amountAtomic || new Decimal(0),
                    totalTipAmountReceived: tipsReceived._sum.amountAtomic || new Decimal(0),
                    totalDeposited: deposits._sum.amount || new Decimal(0),
                    matchesWon: wins,
                    matchesLost: losses,
                    matchesTied: ties,
                    achievementCount: achievements,
                    lastTipAt: tipsSent._max.createdAt,
                    lastMatchAt: matches._max.createdAt,
                    lastDepositAt: deposits._max.createdAt,
                    updatedAt: new Date(),
                },
            });
            // Update unique counts (expensive)
            await updateUniqueRecipientCount(user.id);
            await updateUniqueSenderCount(user.id);
        }
        console.log(`User stats rebuild completed for ${users.length} users`);
    }
    catch (error) {
        console.error('Error rebuilding user stats:', error);
        throw error;
    }
}
// Get statistics dashboard data
export async function getStatsDashboard() {
    try {
        const [userCount, tipCount, matchCount, achievementCount, recentDaily] = await Promise.all([
            prisma.user.count(),
            prisma.tip.count({ where: { status: 'COMPLETED' } }),
            prisma.match.count({ where: { status: 'COMPLETED' } }),
            prisma.achievement.count(),
            prisma.dailyStats.findMany({
                orderBy: { date: 'desc' },
                take: 7
            })
        ]);
        return {
            totals: {
                users: userCount,
                completedTips: tipCount,
                completedMatches: matchCount,
                achievements: achievementCount,
            },
            recentDaily: recentDaily.reverse(), // Show chronologically
            lastUpdated: new Date().toISOString(),
        };
    }
    catch (error) {
        console.error('Error getting stats dashboard:', error);
        return null;
    }
}
