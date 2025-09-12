// src/services/profile.ts - Shared profile logic
import type { User } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "./db.js";
import { profileEmbed } from "../ui/embeds.js";
import { formatDecimal, bigToDecDirect } from "./token.js";

// Track active profile requests to prevent spam
export const activeProfileRequests = new Set<string>();

// Rate limiting: track last request times
const lastProfileRequests = new Map<string, number>();
const PROFILE_RATE_LIMIT = 5000; // 5 seconds between requests

// Automatic cleanup for stuck requests (safety net)
const PROFILE_REQUEST_TIMEOUT = 30000; // 30 seconds

// Clean up old rate limit entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamp] of lastProfileRequests.entries()) {
    if (now - timestamp > 3600000) { // 1 hour
      lastProfileRequests.delete(userId);
    }
  }
}, 3600000);

export function trackProfileRequest(userId: string) {
  activeProfileRequests.add(userId);
  
  // Auto-cleanup after timeout as safety net
  setTimeout(() => {
    activeProfileRequests.delete(userId);
  }, PROFILE_REQUEST_TIMEOUT);
}

export function releaseProfileRequest(userId: string) {
  activeProfileRequests.delete(userId);
}

export interface ProfileOptions {
  user: User;
  ephemeral?: boolean;
}

export async function generateProfileData(userId: string, discordUser: User) {
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
  const [balances, activeMemberships, tipStatsSent, tipStatsReceived, groupTipStats, recentTransactions] = await Promise.all([
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
      // Group tips created by user
      prisma.groupTip.groupBy({
        by: ['tokenId'],
        where: { creatorId: u.id },
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
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 10  // Fetch more to handle filtering
    }).then(transactions => {
      // Filter out fee-only transactions and deduplicate by transaction hash/metadata
      const unique: typeof transactions = [];
      const seen = new Set<number>();
      const seenTipEvents = new Set<string>(); // Track unique tip events
      
      for (const tx of transactions) {
        // Skip if we've already seen this transaction ID
        if (seen.has(tx.id)) continue;
        
        // Parse metadata to check transaction details
        let metadata: any = {};
        try {
          if (tx.metadata) {
            metadata = JSON.parse(tx.metadata);
          }
        } catch (e) {
          // Invalid JSON, treat as regular transaction
        }
        
        // Skip fee-only group tip creation records
        if (metadata.kind === "GROUP_TIP_CREATE" && !tx.otherUserId && Number(tx.amount) === 0) {
          continue;
        }
        
        // For tip transactions, create a more robust deduplication key
        if (tx.type === 'TIP') {
          // Create unique key using core tip details and involved users
          // Sort user IDs to ensure consistent key regardless of sender/receiver perspective
          const userIds = [tx.userId, tx.otherUserId].filter(Boolean).sort();
          const tipKey = `TIP-${userIds.join('-')}-${tx.amount}-${tx.tokenId}-${Math.floor(tx.createdAt.getTime() / 1000)}`;
          
          if (seenTipEvents.has(tipKey)) {
            continue; // Skip this duplicate tip event
          }
          seenTipEvents.add(tipKey);
          
          // For the same tip event, prefer showing the transaction from the current user's perspective as sender
          // This ensures we show "sent X tokens" rather than multiple confusing entries
          const existingIndex = unique.findIndex(existing => {
            if (existing.type !== 'TIP') return false;
            const existingUserIds = [existing.userId, existing.otherUserId].filter(Boolean).sort();
            const existingKey = `TIP-${existingUserIds.join('-')}-${existing.amount}-${existing.tokenId}-${Math.floor(existing.createdAt.getTime() / 1000)}`;
            return existingKey === tipKey;
          });
          
          // If we find a duplicate, prefer the one where current user is the sender (userId matches)
          if (existingIndex >= 0) {
            const existing = unique[existingIndex];
            if (tx.userId === u.id && existing.userId !== u.id) {
              // Replace with sender's perspective
              unique[existingIndex] = tx;
            }
            continue;
          }
        }
        
        seen.add(tx.id);
        unique.push(tx);
        
        // Limit to 3 unique transactions for display
        if (unique.length >= 3) break;
      }
      
      return unique;
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
  const tipsSentByToken = new Map<string, { count: number; amount: number }>();
  const tipsReceivedByToken = new Map<string, { count: number; amount: number }>();
  
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
    if (!token) continue;
    
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
    if (!token) continue;
    
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
  for (const stat of groupTipStats as any[]) {
    const token = tokenMap.get(stat.tokenId);
    if (!token) continue;
    
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
  const groupTipsCreatedTotal = (groupTipStats as any[]).reduce((sum, stat) => sum + (stat.groupTipsCreated || 0), 0);
  const groupTipsClaimedTotal = (groupTipStats as any[]).reduce((sum, stat) => sum + (stat.groupTipsClaimed || 0), 0);

  // Calculate totals using corrected logic: only count completed transactions
  // For "sent": direct tips + group tips that were actually claimed by others
  const totalTipsSentCount = directTipsSentCount + completedGroupTipsFromSent;
  // For "received": direct tips received + group tips claimed by this user  
  const totalTipsReceivedCount = directTipsReceivedCount + groupTipsClaimedTotal;

  // Format recent activity - transactions are already deduplicated by ID above
  const recentActivity = recentTransactions.length > 0
    ? recentTransactions
        .map((tx, index) => {
          const amount = formatDecimal(Number(tx.amount), "tokens");
          const timeAgo = `<t:${Math.floor(tx.createdAt.getTime() / 1000)}:R>`;
          // Include transaction ID or index to differentiate identical-looking transactions
          return `${tx.type}: ${amount} ${timeAgo}`;
        })
        .join("\n")
    : "No recent activity";

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
    activeMemberships,
    discordUser
  };
}

export function createProfileButtons(activeMemberships: any[], hasLinkedWallet: boolean = true) {
  const actionRows = [];
  
  // First row: Wallet actions (if no wallet) or membership actions
  if (!hasLinkedWallet) {
    // User needs wallet - prioritize wallet setup
    const walletRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setLabel("🌐 Get Abstract Wallet")
          .setStyle(ButtonStyle.Link)
          .setURL("https://abs.xyz"),
        new ButtonBuilder()
          .setCustomId("pip:prompt_link_wallet")
          .setLabel("🔗 Link My Wallet")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("💳"),
        new ButtonBuilder()
          .setCustomId("pip:show_help")
          .setLabel("📚 Get Help")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("❓")
      );
    actionRows.push(walletRow);
  } else {
    // User has wallet - show membership and deposit options
    const buttonLabel = activeMemberships.length > 0 ? "Extend Membership" : "Purchase Membership";
    const buttonEmoji = activeMemberships.length > 0 ? "⏰" : "⭐";
    
    const membershipRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("pip:purchase_membership")
          .setLabel(buttonLabel)
          .setStyle(ButtonStyle.Primary)
          .setEmoji(buttonEmoji),
        new ButtonBuilder()
          .setCustomId("pip:show_deposit_instructions")
          .setLabel("💰 Add Funds")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("📥"),
        new ButtonBuilder()
          .setCustomId("pip:show_help")
          .setLabel("📚 Help")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("❓")
      );
    actionRows.push(membershipRow);
  }
  
  // Second row: Standard profile actions
  const profileRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("pip:refresh_profile")
        .setLabel("🔄 Refresh")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("pip:dismiss_profile")
        .setLabel("❌ Dismiss")
        .setStyle(ButtonStyle.Secondary)
    );
  actionRows.push(profileRow);
  
  return actionRows;
}

export function createProfileEmbed(data: any) {
  return profileEmbed({
    user: data.discordUser,
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
    createdAt: data.user.createdAt,
    hasActiveMembership: data.activeMemberships.length > 0
  });
}