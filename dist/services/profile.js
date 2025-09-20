import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "./db.js";
import { profileEmbed } from "../ui/embeds.js";
import { formatDecimal, bigToDecDirect } from "./token.js";
import { getStreakStats, formatStreakText, getUserAchievements } from "./streaks.js";
import { calculateSocialScore, getUserRank } from "./social_leaderboards.js";
import { getDailyProgress } from "./daily_engagement.js";
import { getUserLevel } from "./penguin_levels.js";
// Track active profile requests to prevent spam (with timestamps for better cleanup)
const activeProfileRequestsWithTime = new Map();
export const activeProfileRequests = new Set();
// Rate limiting: track last request times
const lastProfileRequests = new Map();
const PROFILE_RATE_LIMIT = 5000; // 5 seconds between requests
// Automatic cleanup for stuck requests (safety net)
const PROFILE_REQUEST_TIMEOUT = 20000; // 20 seconds (reduced from 30)
// Aggressive cleanup every 10 seconds to prevent stuck states
setInterval(() => {
    const now = Date.now();
    // Clean up stuck profile requests
    for (const [userId, timestamp] of activeProfileRequestsWithTime.entries()) {
        if (now - timestamp > PROFILE_REQUEST_TIMEOUT) {
            console.log(`🧹 Auto-cleaning stuck profile request for user ${userId} (${Math.round((now - timestamp) / 1000)}s old)`);
            activeProfileRequests.delete(userId);
            activeProfileRequestsWithTime.delete(userId);
        }
    }
    // Clean up old rate limit entries
    for (const [userId, timestamp] of lastProfileRequests.entries()) {
        if (now - timestamp > 3600000) { // 1 hour
            lastProfileRequests.delete(userId);
        }
    }
}, 10000); // Every 10 seconds
export function trackProfileRequest(userId) {
    const now = Date.now();
    activeProfileRequests.add(userId);
    activeProfileRequestsWithTime.set(userId, now);
    // Auto-cleanup after timeout as additional safety net
    setTimeout(() => {
        if (activeProfileRequestsWithTime.has(userId)) {
            console.log(`⏰ Timeout cleanup for profile request: ${userId}`);
            activeProfileRequests.delete(userId);
            activeProfileRequestsWithTime.delete(userId);
        }
    }, PROFILE_REQUEST_TIMEOUT);
}
export function releaseProfileRequest(userId) {
    activeProfileRequests.delete(userId);
    activeProfileRequestsWithTime.delete(userId);
}
// Admin function to force-clear all stuck profile requests
export function clearAllProfileRequests() {
    const count = activeProfileRequests.size;
    activeProfileRequests.clear();
    activeProfileRequestsWithTime.clear();
    console.log(`🧹 Force-cleared ${count} active profile requests`);
    return count;
}
// Get status of active profile requests for debugging
export function getProfileRequestStatus() {
    return {
        active: activeProfileRequests.size,
        withTimestamps: Array.from(activeProfileRequestsWithTime.entries())
    };
}
export async function generateProfileData(userId, discordUser) {
    // Rate limiting check
    const now = Date.now();
    const lastRequest = lastProfileRequests.get(userId);
    if (lastRequest && (now - lastRequest) < PROFILE_RATE_LIMIT) {
        throw new Error(`Profile requests are rate limited. Please wait ${Math.ceil((PROFILE_RATE_LIMIT - (now - lastRequest)) / 1000)} seconds.`);
    }
    lastProfileRequests.set(userId, now);
    const u = await prisma.user.upsert({
        where: { discordId: userId },
        update: {},
        create: { discordId: userId }
    });
    // Get comprehensive user data in parallel - OPTIMIZED with aggregation
    const [balances, activeMemberships, tipStatsSent, tipStatsReceived, groupTipStats, recentTransactions, unreadMessageCount] = await Promise.all([
        // Token balances
        prisma.userBalance.findMany({
            where: { userId: u.id },
            include: { Token: true }
        }),
        // Active tier memberships
        prisma.tierMembership.findMany({
            where: {
                userId: u.id,
                status: 'ACTIVE',
                expiresAt: { gt: new Date() }
            },
            include: { tier: true },
            orderBy: { expiresAt: 'desc' }
        }),
        // OPTIMIZED: Aggregate direct tips sent by token (only completed)
        prisma.tip.groupBy({
            by: ['tokenId'],
            where: { fromUserId: u.id, status: 'COMPLETED' },
            _count: { id: true },
            _sum: { amountAtomic: true }
        }),
        // OPTIMIZED: Aggregate direct tips received by token (only completed)
        prisma.tip.groupBy({
            by: ['tokenId'],
            where: { toUserId: u.id, status: 'COMPLETED' },
            _count: { id: true },
            _sum: { amountAtomic: true }
        }),
        // OPTIMIZED: Get group tip stats with proper Prisma queries (revert to work with current schema)
        Promise.all([
            // Group tips created by user (only successfully funded ones)
            prisma.groupTip.groupBy({
                by: ['tokenId'],
                where: {
                    creatorId: u.id,
                    status: { in: ['ACTIVE', 'EXPIRED'] } // Only count successfully funded group tips
                },
                _count: { id: true },
                _sum: { totalAmount: true }
            }),
            // Group tips claimed by user (only successfully claimed)
            prisma.groupTipClaim.groupBy({
                by: ['groupTipId'],
                where: { userId: u.id, status: 'CLAIMED' },
                _count: { id: true }
            })
        ]).then(async ([groupTipsCreated, groupTipClaims]) => {
            // Get group tip details for claims to map to tokens
            const groupTipIds = groupTipClaims.map(claim => claim.groupTipId);
            const groupTipDetails = groupTipIds.length > 0 ? await prisma.groupTip.findMany({
                where: { id: { in: groupTipIds } },
                select: { id: true, tokenId: true }
            }) : [];
            // Build final stats combining both
            const statsMap = new Map();
            // Add created group tips
            for (const stat of groupTipsCreated) {
                const tokenId = stat.tokenId;
                statsMap.set(tokenId, {
                    tokenId,
                    groupTipsCreated: stat._count.id,
                    groupTipAmountSent: stat._sum.totalAmount || 0,
                    groupTipsClaimed: 0
                });
            }
            // Add claimed group tips
            const claimsByToken = new Map();
            for (const detail of groupTipDetails) {
                const count = claimsByToken.get(detail.tokenId) || 0;
                claimsByToken.set(detail.tokenId, count + 1);
            }
            for (const [tokenId, count] of claimsByToken) {
                const existing = statsMap.get(tokenId) || { tokenId, groupTipsCreated: 0, groupTipAmountSent: 0, groupTipsClaimed: 0 };
                existing.groupTipsClaimed = count;
                statsMap.set(tokenId, existing);
            }
            return Array.from(statsMap.values());
        }),
        // Recent transaction history (keep limited, avoid duplicates and fee-only records)
        prisma.transaction.findMany({
            where: {
                OR: [
                    { userId: u.id },
                    { otherUserId: u.id }
                ],
                tokenId: { not: null } // Ensure we only get transactions with valid token references
            },
            include: {
                Token: { select: { symbol: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 10 // Fetch more to handle filtering
        }).then(transactions => {
            // Filter out fee-only transactions and deduplicate by transaction hash/metadata
            const unique = [];
            const seen = new Set();
            const seenTipEvents = new Set(); // Track unique tip events
            for (const tx of transactions) {
                // Skip if we've already seen this transaction ID
                if (seen.has(tx.id))
                    continue;
                // Parse metadata to check transaction details
                let metadata = {};
                try {
                    if (tx.metadata) {
                        metadata = JSON.parse(tx.metadata);
                    }
                }
                catch (e) {
                    // Invalid JSON, treat as regular transaction
                }
                // Skip fee-only group tip creation records
                if (metadata.kind === "GROUP_TIP_CREATE" && !tx.otherUserId && Number(tx.amount) === 0) {
                    continue;
                }
                // For tip transactions, ensure we only show one entry per unique tip
                if (tx.type === 'TIP') {
                    // Create unique key using core tip details and time
                    const tipKey = `TIP-${tx.amount}-${tx.tokenId}-${Math.floor(tx.createdAt.getTime() / 1000)}`;
                    if (seenTipEvents.has(tipKey)) {
                        continue; // Skip this duplicate tip event
                    }
                    seenTipEvents.add(tipKey);
                }
                seen.add(tx.id);
                unique.push(tx);
                // Limit to 3 unique transactions for display
                if (unique.length >= 3)
                    break;
            }
            return unique;
        }),
        // Get unread PenguBook message count
        prisma.penguBookMessage.count({
            where: {
                toUserId: u.id,
                read: false
            }
        })
    ]);
    // Format balance display
    let balanceText = "0 tokens";
    if (balances.length > 0) {
        balanceText = balances
            .filter(b => Number(b.amount) > 0)
            .map(b => formatDecimal(b.amount, b.Token.symbol))
            .join(", ") || "0 tokens";
    }
    // Format tier membership display
    const membershipText = activeMemberships.length > 0
        ? activeMemberships
            .map(m => `${m.tier.name} (expires <t:${Math.floor(m.expiresAt.getTime() / 1000)}:R>)`)
            .join("\n")
        : "No active memberships";
    // OPTIMIZED: Build tipping statistics from aggregated data
    const tipsSentByToken = new Map();
    const tipsReceivedByToken = new Map();
    // Track direct vs group tip counts separately for total calculation
    let directTipsSentCount = 0;
    let directTipsReceivedCount = 0;
    let completedGroupTipsFromSent = 0;
    // Get all token details for mapping (including decimals for conversion)
    const allTokens = await prisma.token.findMany({
        select: { id: true, symbol: true, decimals: true }
    });
    const tokenMap = new Map(allTokens.map(t => [t.id, { symbol: t.symbol, decimals: t.decimals }]));
    // Process aggregated direct tips sent
    for (const stat of tipStatsSent) {
        const token = tokenMap.get(stat.tokenId);
        if (!token)
            continue;
        const atomicAmount = BigInt(Number(stat._sum.amountAtomic || 0));
        const decimalAmount = parseFloat(Number(bigToDecDirect(atomicAmount, token.decimals)).toFixed(2));
        tipsSentByToken.set(token.symbol, {
            count: stat._count.id,
            amount: decimalAmount
        });
        // Track direct tips for total calculation
        directTipsSentCount += stat._count.id;
    }
    // Process aggregated direct tips received
    for (const stat of tipStatsReceived) {
        const token = tokenMap.get(stat.tokenId);
        if (!token)
            continue;
        const atomicAmount = BigInt(Number(stat._sum.amountAtomic || 0));
        const decimalAmount = parseFloat(Number(bigToDecDirect(atomicAmount, token.decimals)).toFixed(2));
        tipsReceivedByToken.set(token.symbol, {
            count: stat._count.id,
            amount: decimalAmount
        });
        // Track direct tips for total calculation
        directTipsReceivedCount += stat._count.id;
    }
    // Process group tip stats from aggregated data
    for (const stat of groupTipStats) {
        const token = tokenMap.get(stat.tokenId);
        if (!token)
            continue;
        // For display: Add ALL group tips created to sent stats (user wants to see what they created)
        if (stat.groupTipsCreated > 0) {
            const current = tipsSentByToken.get(token.symbol) || { count: 0, amount: 0 };
            const atomicAmount = BigInt(stat.groupTipAmountSent || 0);
            const decimalAmount = Number(bigToDecDirect(atomicAmount, token.decimals));
            tipsSentByToken.set(token.symbol, {
                count: current.count + stat.groupTipsCreated,
                amount: current.amount + decimalAmount
            });
        }
        // For total calculation: Only count group tips that were actually claimed (completed)
        if (stat.groupTipsClaimed > 0) {
            completedGroupTipsFromSent += stat.groupTipsClaimed;
            const current = tipsReceivedByToken.get(token.symbol) || { count: 0, amount: 0 };
            tipsReceivedByToken.set(token.symbol, {
                count: current.count + stat.groupTipsClaimed,
                amount: current.amount // Amount calculation would require expensive per-tip queries
            });
        }
    }
    // Format tip statistics for display
    const tipsSentText = Array.from(tipsSentByToken.entries())
        .map(([symbol, data]) => `${data.count} tips (${formatDecimal(Number(data.amount), symbol)})`)
        .join('\n') || 'No tips sent';
    const tipsReceivedText = Array.from(tipsReceivedByToken.entries())
        .map(([symbol, data]) => `${data.count} tips (${formatDecimal(Number(data.amount), symbol)})`)
        .join('\n') || 'No tips received';
    // Calculate group tip totals from aggregated stats first
    const groupTipsCreatedTotal = groupTipStats.reduce((sum, stat) => sum + (stat.groupTipsCreated || 0), 0);
    const groupTipsClaimedTotal = groupTipStats.reduce((sum, stat) => sum + (stat.groupTipsClaimed || 0), 0);
    // Calculate totals using corrected logic: only count completed transactions
    // For "sent": direct tips + group tips that were actually claimed by others
    const totalTipsSentCount = directTipsSentCount + completedGroupTipsFromSent;
    // For "received": direct tips received + group tips claimed by this user  
    const totalTipsReceivedCount = directTipsReceivedCount + groupTipsClaimedTotal;
    // Format recent activity with proper direction and token symbols
    const recentActivity = recentTransactions.length > 0
        ? recentTransactions
            .map((tx) => {
            // Determine direction based on user's role in the transaction
            let direction = "";
            if (tx.type === "TIP") {
                if (tx.userId === u.id) {
                    direction = " SENT";
                }
                else if (tx.otherUserId === u.id) {
                    direction = " RECEIVED";
                }
            }
            // Get token symbol from transaction data
            const tokenSymbol = tx.Token?.symbol || "tokens";
            const amount = formatDecimal(Number(tx.amount), tokenSymbol);
            const timeAgo = `<t:${Math.floor(tx.createdAt.getTime() / 1000)}:R>`;
            return `${tx.type}${direction}: ${amount} ${timeAgo}`;
        })
            .join("\n")
        : "No recent activity";
    // Get group tip contribution stats
    const groupTipContributions = await prisma.groupTipContribution.groupBy({
        by: ['contributorId'],
        where: { contributorId: u.id },
        _count: { id: true },
        _sum: { amount: true }
    }).catch(() => []);
    const contributionStats = groupTipContributions.length > 0
        ? {
            count: groupTipContributions[0]._count.id,
            totalAmount: Number(groupTipContributions[0]._sum.amount || 0)
        }
        : { count: 0, totalAmount: 0 };
    // Get enhanced profile data (streak, achievements, social score, daily activity, level details)
    const [streakStats, achievementsRaw, socialScoreData, dailyStats, socialRank, levelDetails] = await Promise.all([
        getStreakStats(userId),
        getUserAchievements(userId),
        calculateSocialScore(userId),
        getDailyProgress(u.id).catch(() => ({ goals: [], streakFreezes: 0 })),
        getUserRank(userId, 'social').catch(() => 0),
        getUserLevel(userId)
    ]);
    const streakText = formatStreakText(streakStats.currentWins, streakStats.longestWins);
    // Format achievements for display
    const { formatAchievementBadge } = await import("./streaks.js");
    const achievements = achievementsRaw.length > 0
        ? achievementsRaw.slice(0, 3)
            .map((achievement) => formatAchievementBadge(achievement))
            .join("\n")
        : null;
    // Format social score for display
    const socialScoreText = `${socialScoreData.totalScore.toLocaleString()} points` +
        (socialRank > 0 ? ` (#${socialRank} in colony)` : "");
    // Format daily activity streak
    const completedGoals = dailyStats.goals?.filter(g => g.completed).length || 0;
    const totalGoals = dailyStats.goals?.length || 3;
    const dailyStreakText = completedGoals > 0
        ? `${completedGoals}/${totalGoals} daily goals completed today`
        : "No goals completed today";
    // Format XP progress
    const xpProgressText = levelDetails.xpToNextLevel > 0
        ? `${levelDetails.currentXP.toLocaleString()} XP (${levelDetails.xpToNextLevel.toLocaleString()} to next level)`
        : `${levelDetails.currentXP.toLocaleString()} XP (Max Level!)`;
    // Format level benefits
    const levelBenefitsText = levelDetails.currentLevel.benefits.join(", ");
    // Format group tip contributions
    const contributionText = contributionStats.count > 0
        ? `${contributionStats.count} contributions (${formatDecimal(contributionStats.totalAmount, 'total')} fish added)`
        : "No contributions yet";
    return {
        user: u,
        balanceText,
        membershipText,
        tipsSentText,
        tipsReceivedText,
        totalTipsSentCount,
        totalTipsReceivedCount,
        groupTipsCreated: groupTipsCreatedTotal,
        groupTipsClaimed: groupTipsClaimedTotal,
        recentActivity,
        unreadMessageCount,
        activeMemberships,
        discordUser,
        hasBio: !!u.bio, // Add bio status for PenguBook CTA
        streakStats,
        streakText,
        achievements,
        // Enhanced profile data
        socialScore: socialScoreData,
        socialScoreText,
        socialRank,
        dailyStats,
        dailyStreakText,
        levelDetails,
        xpProgressText,
        levelBenefitsText,
        contributionStats,
        contributionText
    };
}
export function createProfileButtons(activeMemberships, hasLinkedWallet = true, hasBio = false, hasInboxMessages = false) {
    const actionRows = [];
    // First row: Wallet actions (if no wallet) or membership actions
    if (!hasLinkedWallet) {
        // User needs wallet - prioritize wallet setup
        const walletRow = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setLabel("🌐 Get Abstract Wallet")
            .setStyle(ButtonStyle.Link)
            .setURL("https://abs.xyz"), new ButtonBuilder()
            .setCustomId("pip:prompt_link_wallet")
            .setLabel("🔗 Link My Wallet")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("💳"), new ButtonBuilder()
            .setCustomId("pip:show_help")
            .setLabel("📚 Get Help")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("❓"));
        actionRows.push(walletRow);
    }
    else {
        // User has wallet - show membership and deposit options
        const buttonLabel = activeMemberships.length > 0 ? "Extend Membership" : "Purchase Membership";
        const buttonEmoji = activeMemberships.length > 0 ? "⏰" : "⭐";
        const membershipRow = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId("pip:purchase_membership")
            .setLabel(buttonLabel)
            .setStyle(ButtonStyle.Primary)
            .setEmoji(buttonEmoji), new ButtonBuilder()
            .setCustomId("pip:show_deposit_instructions")
            .setLabel("💰 Add Funds")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("📥"), new ButtonBuilder()
            .setCustomId("pip:show_help")
            .setLabel("📚 Help")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("❓"));
        actionRows.push(membershipRow);
    }
    // Second row: Profile actions + PenguBook CTA
    const profileRowComponents = [
        new ButtonBuilder()
            .setCustomId("pip:refresh_profile")
            .setLabel("🔄 Refresh Penguin Stats")
            .setStyle(ButtonStyle.Secondary),
    ];
    // Add PenguBook CTA if user doesn't have a bio (conversion funnel!)
    if (!hasBio) {
        profileRowComponents.push(new ButtonBuilder()
            .setCustomId("pip:pengubook_cta")
            .setLabel("Join PenguBook")
            .setStyle(ButtonStyle.Success)
            .setEmoji("<a:PenguEnter:1415471346439421972>"));
    }
    else {
        // User has bio - show browse PenguBook option
        profileRowComponents.push(new ButtonBuilder()
            .setCustomId("pip:pengubook_browse")
            .setLabel("Browse PenguBook")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("<a:NerdPengu:1415469352660107324>"));
    }
    // Add mailbox button if user has messages or is already using PenguBook
    if (hasInboxMessages || hasBio) {
        const mailboxLabel = hasInboxMessages ? "📨 Inbox" : "📬 Inbox";
        const mailboxStyle = hasInboxMessages ? ButtonStyle.Success : ButtonStyle.Secondary;
        profileRowComponents.push(new ButtonBuilder()
            .setCustomId("pip:pengubook_inbox")
            .setLabel(mailboxLabel)
            .setStyle(mailboxStyle)
            .setEmoji("📨"));
    }
    // Web View button removed - it belongs in Pengubook command, not profile
    profileRowComponents.push(new ButtonBuilder()
        .setCustomId("pip:dismiss_profile")
        .setLabel("❌ Dismiss")
        .setStyle(ButtonStyle.Secondary));
    const profileRow = new ActionRowBuilder().addComponents(...profileRowComponents);
    actionRows.push(profileRow);
    return actionRows;
}
export async function createProfileEmbed(data) {
    return await profileEmbed({
        user: data.discordUser,
        discordId: data.user.discordId, // Add discordId for level lookup
        agwAddress: data.user.agwAddress ?? null,
        balanceText: data.balanceText,
        wins: data.user.wins,
        losses: data.user.losses,
        ties: data.user.ties,
        membershipText: data.membershipText,
        tippingStats: {
            sentText: data.tipsSentText,
            receivedText: data.tipsReceivedText,
            sentCount: data.totalTipsSentCount,
            receivedCount: data.totalTipsReceivedCount
        },
        groupTipActivity: {
            created: data.groupTipsCreated,
            claimed: data.groupTipsClaimed
        },
        recentActivity: data.recentActivity,
        unreadMessageCount: data.unreadMessageCount,
        streakText: data.streakText,
        achievements: data.achievements,
        createdAt: data.user.createdAt,
        hasActiveMembership: data.activeMemberships.length > 0,
        // Enhanced profile features
        socialScore: data.socialScore,
        socialScoreText: data.socialScoreText,
        socialRank: data.socialRank,
        dailyStreakText: data.dailyStreakText,
        levelDetails: data.levelDetails,
        xpProgressText: data.xpProgressText,
        levelBenefitsText: data.levelBenefitsText,
        contributionStats: data.contributionStats,
        contributionText: data.contributionText
    });
}
