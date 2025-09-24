import { EmbedBuilder, MessageFlags } from "discord.js";
import { prisma } from "../services/db.js";
import { getStreakLeaderboard } from "../services/streaks.js";
import { formatDecimalWithUSD } from "../services/token.js";
import { priceAPI } from "../services/price_api.js";
import { cacheWithMetrics, CacheKeys, CacheTTL } from "../services/cache.js";
import { withTiming } from "../services/performance.js";
export default async function pipLeaderboard(i) {
    try {
        const category = i.options.getString("category") || "streaks";
        // Validate category input
        const validCategories = ["streaks", "wins", "winrate", "tips_sent", "tips_received", "referrals", "wealth"];
        if (!validCategories.includes(category)) {
            return i.reply({
                content: "❌ Invalid leaderboard category",
                flags: MessageFlags.Ephemeral
            });
        }
        const limit = 10;
        // Wrap leaderboard generation with performance monitoring
        const embed = await withTiming('leaderboard_query', async () => {
            let embedResult;
            switch (category) {
                case "streaks":
                    embedResult = await buildStreakLeaderboard(limit);
                    break;
                case "wins":
                    embedResult = await buildWinsLeaderboard(limit);
                    break;
                case "winrate":
                    embedResult = await buildWinRateLeaderboard(limit);
                    break;
                case "tips_sent":
                    embedResult = await buildTipsSentLeaderboard(limit);
                    break;
                case "tips_received":
                    embedResult = await buildTipsReceivedLeaderboard(limit);
                    break;
                case "referrals":
                    embedResult = await buildReferralLeaderboard(limit);
                    break;
                case "wealth":
                    embedResult = await buildWealthLeaderboard(limit);
                    break;
                default:
                    embedResult = await buildStreakLeaderboard(limit);
            }
            return embedResult;
        }, { category });
        await i.reply({
            embeds: [embed]
        });
    }
    catch (error) {
        console.error("Error in pip_leaderboard:", error);
        await i.reply({
            content: `❌ Error loading leaderboard: ${error?.message || "Unknown error"}`,
            flags: MessageFlags.Ephemeral
        }).catch(() => { });
    }
}
async function buildStreakLeaderboard(limit) {
    const leaderboard = await getStreakLeaderboard(limit);
    const embed = new EmbedBuilder()
        .setTitle("🔥 Win Streak Leaderboard")
        .setColor(0xFF6B6B)
        .setDescription("Top players by current win streak")
        .setTimestamp();
    if (leaderboard.length === 0) {
        embed.addFields({
            name: "No Active Streaks",
            value: "Be the first to start a win streak!",
            inline: false
        });
    }
    else {
        const entries = await Promise.all(leaderboard.map(async (entry) => {
            const user = await prisma.user.findUnique({
                where: { discordId: entry.discordId },
                select: { discordId: true }
            });
            const medal = getMedal(entry.rank);
            const lastGameText = entry.lastGameAt
                ? `<t:${Math.floor(entry.lastGameAt.getTime() / 1000)}:R>`
                : "Never";
            return `${medal} **#${entry.rank}** <@${entry.discordId}>\n` +
                `🔥 Current: **${entry.currentWins}** | Best: **${entry.longestWins}**\n` +
                `Last game: ${lastGameText}\n`;
        }));
        embed.addFields({
            name: "Top Players",
            value: entries.join("\n").substring(0, 1024),
            inline: false
        });
    }
    return embed;
}
async function buildWinsLeaderboard(limit) {
    // Use caching for leaderboard data
    const topWinners = await cacheWithMetrics(CacheKeys.leaderboard('wins'), async () => {
        // Use UserStats table for optimized query (already indexed!)
        return prisma.userStats.findMany({
            where: { matchesWon: { gt: 0 } },
            orderBy: [
                { matchesWon: 'desc' },
                { updatedAt: 'desc' }
            ],
            take: limit,
            include: {
                user: {
                    select: {
                        discordId: true,
                        wins: true,
                        losses: true,
                        ties: true
                    }
                }
            }
        });
    }, CacheTTL.leaderboard);
    const embed = new EmbedBuilder()
        .setTitle("🏆 Total Wins Leaderboard")
        .setColor(0xFFD700)
        .setDescription("Top players by total match wins")
        .setTimestamp();
    if (topWinners.length === 0) {
        embed.addFields({
            name: "No Winners Yet",
            value: "Play matches to get on the leaderboard!",
            inline: false
        });
    }
    else {
        const entries = topWinners.map((stats, index) => {
            const rank = index + 1;
            const medal = getMedal(rank);
            const user = stats.user;
            const total = user.wins + user.losses + user.ties;
            const winRate = total > 0 ? ((user.wins / total) * 100).toFixed(1) : "0.0";
            return `${medal} **#${rank}** <@${user.discordId}>\n` +
                `🏆 **${user.wins}** wins | ${winRate}% WR\n` +
                `Record: ${user.wins}W-${user.losses}L-${user.ties}T\n`;
        });
        embed.addFields({
            name: "Top Winners",
            value: entries.join("\n").substring(0, 1024),
            inline: false
        });
    }
    return embed;
}
async function buildWinRateLeaderboard(limit) {
    const players = await prisma.user.findMany({
        where: {
            wins: { gt: 0 }
        },
        select: {
            discordId: true,
            wins: true,
            losses: true,
            ties: true
        }
    });
    // Calculate win rates and filter minimum games
    const withWinRate = players
        .map(p => {
        const total = p.wins + p.losses + p.ties;
        const winRate = total > 0 ? (p.wins / total) * 100 : 0;
        return { ...p, total, winRate };
    })
        .filter(p => p.total >= 10) // Minimum 10 games
        .sort((a, b) => b.winRate - a.winRate)
        .slice(0, limit);
    const embed = new EmbedBuilder()
        .setTitle("📊 Win Rate Leaderboard")
        .setColor(0x00FF00)
        .setDescription("Top players by win percentage (min. 10 games)")
        .setTimestamp();
    if (withWinRate.length === 0) {
        embed.addFields({
            name: "No Qualified Players",
            value: "Play at least 10 matches to qualify!",
            inline: false
        });
    }
    else {
        const entries = withWinRate.map((user, index) => {
            const rank = index + 1;
            const medal = getMedal(rank);
            return `${medal} **#${rank}** <@${user.discordId}>\n` +
                `📊 **${user.winRate.toFixed(1)}%** win rate\n` +
                `Record: ${user.wins}W-${user.losses}L-${user.ties}T (${user.total} games)\n`;
        });
        embed.addFields({
            name: "Top Win Rates",
            value: entries.join("\n").substring(0, 1024),
            inline: false
        });
    }
    return embed;
}
async function buildTipsSentLeaderboard(limit) {
    // Use caching for leaderboard data
    const topTippers = await cacheWithMetrics(CacheKeys.leaderboard('tips_sent'), async () => {
        // Use UserStats table for optimized query - no complex groupBy needed!
        return prisma.userStats.findMany({
            where: { totalTipsSent: { gt: 0 } },
            orderBy: { totalTipsSent: 'desc' },
            take: limit,
            include: {
                user: {
                    select: { discordId: true }
                }
            }
        });
    }, CacheTTL.leaderboard);
    const embed = new EmbedBuilder()
        .setTitle("💸 Most Generous Tippers")
        .setColor(0x9B59B6)
        .setDescription("Top players by tips sent")
        .setTimestamp();
    if (topTippers.length === 0) {
        embed.addFields({
            name: "No Tips Yet",
            value: "Be the first to tip!",
            inline: false
        });
    }
    else {
        const entries = topTippers.map((stats, index) => {
            const rank = index + 1;
            const medal = getMedal(rank);
            return `${medal} **#${rank}** <@${stats.user.discordId}>\n` +
                `💸 **${stats.totalTipsSent}** tips sent\n`;
        });
        embed.addFields({
            name: "Most Generous",
            value: entries.filter((e) => e).join("\n").substring(0, 1024),
            inline: false
        });
    }
    return embed;
}
async function buildTipsReceivedLeaderboard(limit) {
    // Use UserStats table for optimized query
    const topReceivers = await prisma.userStats.findMany({
        where: { totalTipsReceived: { gt: 0 } },
        orderBy: { totalTipsReceived: 'desc' },
        take: limit,
        include: {
            user: {
                select: { discordId: true }
            }
        }
    });
    const embed = new EmbedBuilder()
        .setTitle("💝 Most Popular Recipients")
        .setColor(0xE91E63)
        .setDescription("Top players by tips received")
        .setTimestamp();
    if (topReceivers.length === 0) {
        embed.addFields({
            name: "No Tips Yet",
            value: "Start tipping to see the leaderboard!",
            inline: false
        });
    }
    else {
        const entries = topReceivers.map((stats, index) => {
            const rank = index + 1;
            const medal = getMedal(rank);
            return `${medal} **#${rank}** <@${stats.user.discordId}>\n` +
                `💝 **${stats.totalTipsReceived}** tips received\n`;
        });
        embed.addFields({
            name: "Most Popular",
            value: entries.filter((e) => e).join("\n").substring(0, 1024),
            inline: false
        });
    }
    return embed;
}
async function buildReferralLeaderboard(limit) {
    const topReferrers = await prisma.referral.groupBy({
        by: ['referrerId'],
        where: {
            verifiedAt: { not: null }
        },
        _count: { id: true },
        orderBy: {
            _count: { id: 'desc' }
        },
        take: limit
    });
    const embed = new EmbedBuilder()
        .setTitle("👥 Referral Champions")
        .setColor(0x3498DB)
        .setDescription("Top players by verified referrals")
        .setTimestamp();
    if (topReferrers.length === 0) {
        embed.addFields({
            name: "No Referrals Yet",
            value: "Invite friends to join PIPtip!",
            inline: false
        });
    }
    else {
        const entries = await Promise.all(topReferrers.map(async (referrer, index) => {
            const user = await prisma.user.findUnique({
                where: { id: referrer.referrerId },
                select: { discordId: true }
            });
            if (!user)
                return "";
            const rank = index + 1;
            const medal = getMedal(rank);
            return `${medal} **#${rank}** <@${user.discordId}>\n` +
                `👥 **${referrer._count?.id || 0}** verified referrals\n`;
        }));
        embed.addFields({
            name: "Top Referrers",
            value: entries.filter((e) => e).join("\n").substring(0, 1024),
            inline: false
        });
    }
    return embed;
}
async function buildWealthLeaderboard(limit) {
    // Get all users with their balances
    const usersWithBalances = await prisma.userBalance.findMany({
        where: {
            amount: { gt: 0 }
        },
        include: {
            User: true,
            Token: true
        }
    });
    // Group by user and calculate real USD value
    const userWealth = new Map();
    // Get all unique token symbols for price lookup
    const tokenSymbols = [...new Set(usersWithBalances.map(b => b.Token.symbol))];
    const priceResult = await priceAPI.getTokenPrices(tokenSymbols);
    for (const balance of usersWithBalances) {
        const userId = balance.User.discordId;
        const current = userWealth.get(userId) || {
            discordId: userId,
            totalUSDValue: 0,
            breakdown: []
        };
        const tokenAmount = Number(balance.amount);
        const tokenPrice = priceResult.prices[balance.Token.symbol] || 0;
        const usdValue = tokenAmount * tokenPrice;
        current.totalUSDValue += usdValue;
        // Format with USD value
        const formattedAmount = await formatDecimalWithUSD(balance.amount, balance.Token.symbol, { compact: true });
        current.breakdown.push(formattedAmount);
        userWealth.set(userId, current);
    }
    // Sort by total USD value
    const sorted = Array.from(userWealth.values())
        .sort((a, b) => b.totalUSDValue - a.totalUSDValue)
        .slice(0, limit);
    const embed = new EmbedBuilder()
        .setTitle("💰 Wealth Leaderboard")
        .setColor(0xF1C40F)
        .setDescription(`Top players by total USD value • Powered by ${priceResult.source}`)
        .setTimestamp();
    if (sorted.length === 0) {
        embed.addFields({
            name: "No Balances Yet",
            value: "Deposit tokens to get on the leaderboard!",
            inline: false
        });
    }
    else {
        const entries = sorted.map((user, index) => {
            const rank = index + 1;
            const medal = getMedal(rank);
            // Format total USD value
            const totalUSDFormatted = user.totalUSDValue < 1
                ? `$${user.totalUSDValue.toFixed(4).replace(/\.?0+$/, "")}`
                : `$${user.totalUSDValue.toFixed(2).replace(/\.?0+$/, "")}`;
            return `${medal} **#${rank}** <@${user.discordId}> • **${totalUSDFormatted}**\n` +
                `💰 ${user.breakdown.join(" + ")}\n`;
        });
        embed.addFields({
            name: "Wealthiest Players",
            value: entries.join("\n").substring(0, 1024),
            inline: false
        });
    }
    return embed;
}
function getMedal(rank) {
    switch (rank) {
        case 1: return "🥇";
        case 2: return "🥈";
        case 3: return "🥉";
        default: return `**${rank}.**`;
    }
}
