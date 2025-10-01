import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "./db.js";
import { profileEmbed } from "../ui/embeds.js";
import { formatDecimal, bigToDecDirect, formatDecimalWithUSD } from "./token.js";
import { getStreakStats, formatStreakText, getUserAchievements } from "./streaks.js";
import { calculateSocialScore, getUserRank } from "./social_leaderboards.js";
import { getDailyProgress } from "./daily_engagement.js";
import { getUserLevel } from "./penguin_levels.js";
const activeProfileRequestsWithTime = /* @__PURE__ */ new Map();
const activeProfileRequests = /* @__PURE__ */ new Set();
const lastProfileRequests = /* @__PURE__ */ new Map();
const PROFILE_RATE_LIMIT = 5e3;
const PROFILE_REQUEST_TIMEOUT = 2e4;
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamp] of activeProfileRequestsWithTime.entries()) {
    if (now - timestamp > PROFILE_REQUEST_TIMEOUT) {
      console.log(`\u{1F9F9} Auto-cleaning stuck profile request for user ${userId} (${Math.round((now - timestamp) / 1e3)}s old)`);
      activeProfileRequests.delete(userId);
      activeProfileRequestsWithTime.delete(userId);
    }
  }
  for (const [userId, timestamp] of lastProfileRequests.entries()) {
    if (now - timestamp > 36e5) {
      lastProfileRequests.delete(userId);
    }
  }
}, 1e4);
function trackProfileRequest(userId) {
  const now = Date.now();
  activeProfileRequests.add(userId);
  activeProfileRequestsWithTime.set(userId, now);
  setTimeout(() => {
    if (activeProfileRequestsWithTime.has(userId)) {
      console.log(`\u23F0 Timeout cleanup for profile request: ${userId}`);
      activeProfileRequests.delete(userId);
      activeProfileRequestsWithTime.delete(userId);
    }
  }, PROFILE_REQUEST_TIMEOUT);
}
function releaseProfileRequest(userId) {
  activeProfileRequests.delete(userId);
  activeProfileRequestsWithTime.delete(userId);
}
function clearAllProfileRequests() {
  const count = activeProfileRequests.size;
  activeProfileRequests.clear();
  activeProfileRequestsWithTime.clear();
  console.log(`\u{1F9F9} Force-cleared ${count} active profile requests`);
  return count;
}
function getProfileRequestStatus() {
  return {
    active: activeProfileRequests.size,
    withTimestamps: Array.from(activeProfileRequestsWithTime.entries())
  };
}
async function generateProfileData(userId, discordUser) {
  const now = Date.now();
  const lastRequest = lastProfileRequests.get(userId);
  if (lastRequest && now - lastRequest < PROFILE_RATE_LIMIT) {
    throw new Error(`Profile requests are rate limited. Please wait ${Math.ceil((PROFILE_RATE_LIMIT - (now - lastRequest)) / 1e3)} seconds.`);
  }
  lastProfileRequests.set(userId, now);
  const u = await prisma.user.upsert({
    where: { discordId: userId },
    update: {},
    create: { discordId: userId }
  });
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
        status: "ACTIVE",
        expiresAt: { gt: /* @__PURE__ */ new Date() }
      },
      include: { tier: true },
      orderBy: { expiresAt: "desc" }
    }),
    // OPTIMIZED: Aggregate direct tips sent by token (only completed)
    prisma.tip.groupBy({
      by: ["tokenId"],
      where: { fromUserId: u.id, status: "COMPLETED" },
      _count: { id: true },
      _sum: { amountAtomic: true }
    }),
    // OPTIMIZED: Aggregate direct tips received by token (only completed)
    prisma.tip.groupBy({
      by: ["tokenId"],
      where: { toUserId: u.id, status: "COMPLETED" },
      _count: { id: true },
      _sum: { amountAtomic: true }
    }),
    // OPTIMIZED: Get group tip stats with proper Prisma queries (revert to work with current schema)
    Promise.all([
      // Group tips created by user (only successfully funded ones)
      prisma.groupTip.groupBy({
        by: ["tokenId"],
        where: {
          creatorId: u.id,
          status: { in: ["ACTIVE", "EXPIRED"] }
          // Only count successfully funded group tips
        },
        _count: { id: true },
        _sum: { totalAmount: true }
      }),
      // Group tips claimed by user (only successfully claimed)
      prisma.groupTipClaim.groupBy({
        by: ["groupTipId"],
        where: { userId: u.id, status: "CLAIMED" },
        _count: { id: true }
      })
    ]).then(async ([groupTipsCreated, groupTipClaims]) => {
      const groupTipIds = groupTipClaims.map((claim) => claim.groupTipId);
      const groupTipDetails = groupTipIds.length > 0 ? await prisma.groupTip.findMany({
        where: { id: { in: groupTipIds } },
        select: { id: true, tokenId: true }
      }) : [];
      const statsMap = /* @__PURE__ */ new Map();
      for (const stat of groupTipsCreated) {
        const tokenId = stat.tokenId;
        statsMap.set(tokenId, {
          tokenId,
          groupTipsCreated: stat._count.id,
          groupTipAmountSent: stat._sum.totalAmount || 0,
          groupTipsClaimed: 0
        });
      }
      const claimsByToken = /* @__PURE__ */ new Map();
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
        tokenId: { not: null }
        // Ensure we only get transactions with valid token references
      },
      include: {
        Token: { select: { symbol: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 10
      // Fetch more to handle filtering
    }).then((transactions) => {
      const unique = [];
      const seen = /* @__PURE__ */ new Set();
      const seenTipEvents = /* @__PURE__ */ new Set();
      for (const tx of transactions) {
        if (seen.has(tx.id)) continue;
        let metadata = {};
        try {
          if (tx.metadata) {
            metadata = JSON.parse(tx.metadata);
          }
        } catch (e) {
        }
        if (metadata.kind === "GROUP_TIP_CREATE" && !tx.otherUserId && Number(tx.amount) === 0) {
          continue;
        }
        if (tx.type === "TIP") {
          const tipKey = `TIP-${tx.amount}-${tx.tokenId}-${Math.floor(tx.createdAt.getTime() / 1e3)}`;
          if (seenTipEvents.has(tipKey)) {
            continue;
          }
          seenTipEvents.add(tipKey);
        }
        seen.add(tx.id);
        unique.push(tx);
        if (unique.length >= 3) break;
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
  let balanceText = "0 tokens";
  if (balances.length > 0) {
    const nonZeroBalances = balances.filter((b) => Number(b.amount) > 0);
    if (nonZeroBalances.length > 0) {
      const formattedBalances = await Promise.all(
        nonZeroBalances.map(async (b) => {
          return await formatDecimalWithUSD(b.amount, b.Token.symbol, { compact: true });
        })
      );
      balanceText = formattedBalances.join(", ");
    } else {
      balanceText = "0 tokens";
    }
  }
  const membershipText = activeMemberships.length > 0 ? activeMemberships.map((m) => `${m.tier.name} (expires <t:${Math.floor(m.expiresAt.getTime() / 1e3)}:R>)`).join("\n") : "No active memberships";
  const tipsSentByToken = /* @__PURE__ */ new Map();
  const tipsReceivedByToken = /* @__PURE__ */ new Map();
  let directTipsSentCount = 0;
  let directTipsReceivedCount = 0;
  let completedGroupTipsFromSent = 0;
  const allTokens = await prisma.token.findMany({
    select: { id: true, symbol: true, decimals: true }
  });
  const tokenMap = new Map(allTokens.map((t) => [t.id, { symbol: t.symbol, decimals: t.decimals }]));
  for (const stat of tipStatsSent) {
    const token = tokenMap.get(stat.tokenId);
    if (!token) continue;
    const atomicAmount = BigInt(Number(stat._sum.amountAtomic || 0));
    const decimalAmount = parseFloat(Number(bigToDecDirect(atomicAmount, token.decimals)).toFixed(2));
    tipsSentByToken.set(token.symbol, {
      count: stat._count.id,
      amount: decimalAmount
    });
    directTipsSentCount += stat._count.id;
  }
  for (const stat of tipStatsReceived) {
    const token = tokenMap.get(stat.tokenId);
    if (!token) continue;
    const atomicAmount = BigInt(Number(stat._sum.amountAtomic || 0));
    const decimalAmount = parseFloat(Number(bigToDecDirect(atomicAmount, token.decimals)).toFixed(2));
    tipsReceivedByToken.set(token.symbol, {
      count: stat._count.id,
      amount: decimalAmount
    });
    directTipsReceivedCount += stat._count.id;
  }
  for (const stat of groupTipStats) {
    const token = tokenMap.get(stat.tokenId);
    if (!token) continue;
    if (stat.groupTipsCreated > 0) {
      const current = tipsSentByToken.get(token.symbol) || { count: 0, amount: 0 };
      const atomicAmount = BigInt(stat.groupTipAmountSent || 0);
      const decimalAmount = Number(bigToDecDirect(atomicAmount, token.decimals));
      tipsSentByToken.set(token.symbol, {
        count: current.count + stat.groupTipsCreated,
        amount: current.amount + decimalAmount
      });
    }
    if (stat.groupTipsClaimed > 0) {
      completedGroupTipsFromSent += stat.groupTipsClaimed;
      const current = tipsReceivedByToken.get(token.symbol) || { count: 0, amount: 0 };
      tipsReceivedByToken.set(token.symbol, {
        count: current.count + stat.groupTipsClaimed,
        amount: current.amount
        // Amount calculation would require expensive per-tip queries
      });
    }
  }
  const tipsSentTextPromises = Array.from(tipsSentByToken.entries()).map(async ([symbol, data]) => {
    const formattedAmount = await formatDecimalWithUSD(Number(data.amount), symbol, { compact: true });
    return `${data.count} tips (${formattedAmount})`;
  });
  const tipsReceivedTextPromises = Array.from(tipsReceivedByToken.entries()).map(async ([symbol, data]) => {
    const formattedAmount = await formatDecimalWithUSD(Number(data.amount), symbol, { compact: true });
    return `${data.count} tips (${formattedAmount})`;
  });
  const [tipsSentTextArray, tipsReceivedTextArray] = await Promise.all([
    Promise.all(tipsSentTextPromises),
    Promise.all(tipsReceivedTextPromises)
  ]);
  const tipsSentText = tipsSentTextArray.join("\n") || "No tips sent";
  const tipsReceivedText = tipsReceivedTextArray.join("\n") || "No tips received";
  const groupTipsCreatedTotal = groupTipStats.reduce((sum, stat) => sum + (stat.groupTipsCreated || 0), 0);
  const groupTipsClaimedTotal = groupTipStats.reduce((sum, stat) => sum + (stat.groupTipsClaimed || 0), 0);
  const totalTipsSentCount = directTipsSentCount + completedGroupTipsFromSent;
  const totalTipsReceivedCount = directTipsReceivedCount + groupTipsClaimedTotal;
  const recentActivity = recentTransactions.length > 0 ? recentTransactions.map((tx) => {
    let direction = "";
    if (tx.type === "TIP") {
      if (tx.userId === u.id) {
        direction = " SENT";
      } else if (tx.otherUserId === u.id) {
        direction = " RECEIVED";
      }
    } else if (tx.type === "GROUP_TIP_CONTRIBUTION") {
      direction = " CONTRIBUTED";
    } else if (tx.type === "GROUP_TIP_PAYOUT") {
      direction = " CLAIMED";
    } else if (tx.type === "GROUP_TIP_REFUND") {
      direction = " REFUNDED";
    }
    const tokenSymbol = tx.Token?.symbol || "tokens";
    let amountDisplay = formatDecimal(Number(tx.amount), tokenSymbol);
    if (tx.usdValue && tx.usdValue > 0) {
      const historicalUSD = parseFloat(tx.usdValue);
      const usdFormatted = historicalUSD < 1 ? `$${historicalUSD.toFixed(4).replace(/\.?0+$/, "")}` : `$${historicalUSD.toFixed(2).replace(/\.?0+$/, "")}`;
      amountDisplay += ` (${usdFormatted} historical)`;
    }
    const timeAgo = `<t:${Math.floor(tx.createdAt.getTime() / 1e3)}:R>`;
    return `${tx.type}${direction}: ${amountDisplay} ${timeAgo}`;
  }).join("\n") : "No recent activity";
  const groupTipContributions = await prisma.groupTipContribution.groupBy({
    by: ["contributorId"],
    where: { contributorId: u.id },
    _count: { id: true },
    _sum: { amount: true }
  }).catch(() => []);
  const contributionStats = groupTipContributions.length > 0 ? {
    count: groupTipContributions[0]._count.id,
    totalAmount: Number(groupTipContributions[0]._sum.amount || 0)
  } : { count: 0, totalAmount: 0 };
  const [streakStats, achievementsRaw, socialScoreData, dailyStats, socialRank, levelDetails] = await Promise.all([
    getStreakStats(userId),
    getUserAchievements(userId),
    calculateSocialScore(userId),
    getDailyProgress(u.id).catch(() => ({ goals: [], streakFreezes: 0 })),
    getUserRank(userId, "social").catch(() => 0),
    getUserLevel(userId)
  ]);
  const streakText = formatStreakText(streakStats.currentWins, streakStats.longestWins);
  const { formatAchievementBadge } = await import("./streaks.js");
  const achievements = achievementsRaw.length > 0 ? achievementsRaw.slice(0, 3).map((achievement) => formatAchievementBadge(achievement)).join("\n") : null;
  const socialScoreText = `${socialScoreData.totalScore.toLocaleString()} points` + (socialRank > 0 ? ` (#${socialRank} in colony)` : "");
  const completedGoals = dailyStats.goals?.filter((g) => g.completed).length || 0;
  const totalGoals = dailyStats.goals?.length || 3;
  const dailyStreakText = completedGoals > 0 ? `${completedGoals}/${totalGoals} daily goals completed today` : "No goals completed today";
  const xpProgressText = levelDetails.xpToNextLevel > 0 ? `${levelDetails.currentXP.toLocaleString()} XP (${levelDetails.xpToNextLevel.toLocaleString()} to next level)` : `${levelDetails.currentXP.toLocaleString()} XP (Max Level!)`;
  const levelBenefitsText = levelDetails.currentLevel.benefits.join(", ");
  const contributionText = contributionStats.count > 0 ? `${contributionStats.count} contributions (${formatDecimal(contributionStats.totalAmount, "total")} fish added)` : "No contributions yet";
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
    hasBio: !!u.bio,
    // Add bio status for PenguBook CTA
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
function createProfileButtons(activeMemberships, hasLinkedWallet = true, hasBio = false, hasInboxMessages = false) {
  const actionRows = [];
  if (!hasLinkedWallet) {
    const walletRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("\u{1F310} Get Abstract Wallet").setStyle(ButtonStyle.Link).setURL("https://abs.xyz"),
      new ButtonBuilder().setCustomId("pip:prompt_link_wallet").setLabel("\u{1F517} Link My Wallet").setStyle(ButtonStyle.Primary).setEmoji("\u{1F4B3}"),
      new ButtonBuilder().setCustomId("pip:show_help").setLabel("\u{1F4DA} Get Help").setStyle(ButtonStyle.Secondary).setEmoji("\u2753")
    );
    actionRows.push(walletRow);
  } else {
    const buttonLabel = activeMemberships.length > 0 ? "Extend Membership" : "Purchase Membership";
    const buttonEmoji = activeMemberships.length > 0 ? "\u23F0" : "\u2B50";
    const membershipRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pip:purchase_membership").setLabel(buttonLabel).setStyle(ButtonStyle.Primary).setEmoji(buttonEmoji),
      new ButtonBuilder().setCustomId("pip:show_deposit_instructions").setLabel("\u{1F4B0} Add Funds").setStyle(ButtonStyle.Secondary).setEmoji("\u{1F4E5}"),
      new ButtonBuilder().setCustomId("pip:show_help").setLabel("\u{1F4DA} Help").setStyle(ButtonStyle.Secondary).setEmoji("\u2753")
    );
    actionRows.push(membershipRow);
  }
  const profileRowComponents = [
    new ButtonBuilder().setCustomId("pip:refresh_profile").setLabel("\u{1F504} Refresh Penguin Stats").setStyle(ButtonStyle.Secondary)
  ];
  if (!hasBio) {
    profileRowComponents.push(
      new ButtonBuilder().setCustomId("pip:pengubook_cta").setLabel("Join PenguBook").setStyle(ButtonStyle.Success).setEmoji("<a:PenguEnter:1415471346439421972>")
    );
  } else {
    profileRowComponents.push(
      new ButtonBuilder().setCustomId("pip:pengubook_browse").setLabel("Browse PenguBook").setStyle(ButtonStyle.Primary).setEmoji("<a:NerdPengu:1415469352660107324>")
    );
  }
  if (hasInboxMessages || hasBio) {
    const mailboxLabel = hasInboxMessages ? "\u{1F4E8} Inbox" : "\u{1F4EC} Inbox";
    const mailboxStyle = hasInboxMessages ? ButtonStyle.Success : ButtonStyle.Secondary;
    profileRowComponents.push(
      new ButtonBuilder().setCustomId("pip:pengubook_inbox").setLabel(mailboxLabel).setStyle(mailboxStyle).setEmoji("\u{1F4E8}")
    );
  }
  profileRowComponents.push(
    new ButtonBuilder().setCustomId("pip:dismiss_profile").setLabel("\u274C Dismiss").setStyle(ButtonStyle.Secondary)
  );
  const profileRow = new ActionRowBuilder().addComponents(...profileRowComponents);
  actionRows.push(profileRow);
  return actionRows;
}
async function createProfileEmbed(data) {
  return await profileEmbed({
    user: data.discordUser,
    discordId: data.user.discordId,
    // Add discordId for level lookup
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
export {
  activeProfileRequests,
  clearAllProfileRequests,
  createProfileButtons,
  createProfileEmbed,
  generateProfileData,
  getProfileRequestStatus,
  releaseProfileRequest,
  trackProfileRequest
};
//# sourceMappingURL=profile.js.map
