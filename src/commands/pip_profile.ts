import type { ChatInputCommandInteraction } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../services/db.js";
import { profileEmbed } from "../ui/embeds.js";
import { getActiveTokens, formatDecimal } from "../services/token.js";

export default async function pipProfile(i: ChatInputCommandInteraction) {
  // Reply immediately with a basic response to prevent auto-defer
  await i.reply({
    content: "Loading your profile...",
    flags: 64 // Ephemeral flag
  });

  try {
    const u = await prisma.user.upsert({
      where: { discordId: i.user.id },
      update: {},
      create: { discordId: i.user.id }
    });

    // Get comprehensive user data in parallel
    const [balances, activeMemberships, directTipsSent, directTipsReceived, groupTipsCreated, groupTipsClaimed, recentTransactions] = await Promise.all([
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

    // Direct tips sent (with token details)
    prisma.tip.findMany({
      where: { fromUserId: u.id },
      include: { Token: true }
    }),

    // Direct tips received (with token details)
    prisma.tip.findMany({
      where: { toUserId: u.id },
      include: { Token: true }
    }),

    // Group tips created (with token details)
    prisma.groupTip.findMany({
      where: { creatorId: u.id },
      include: { Token: true }
    }),

    // Group tips claimed (with token details) 
    prisma.groupTipClaim.findMany({
      where: { userId: u.id },
      include: { 
        GroupTip: {
          include: { Token: true }
        }
      }
    }),

    // Recent transaction history
    prisma.transaction.findMany({
      where: { 
        OR: [
          { userId: u.id },
          { otherUserId: u.id }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 3
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

  // Calculate comprehensive tipping statistics including group tips
  const tipsSentByToken = new Map<string, { count: number; amount: number }>();
  const tipsReceivedByToken = new Map<string, { count: number; amount: number }>();

  // Process direct tips sent
  directTipsSent.forEach(tip => {
    const symbol = tip.Token.symbol;
    const current = tipsSentByToken.get(symbol) || { count: 0, amount: 0 };
    tipsSentByToken.set(symbol, {
      count: current.count + 1,
      amount: current.amount + Number(tip.amountAtomic)
    });
  });

  // Process direct tips received
  directTipsReceived.forEach(tip => {
    const symbol = tip.Token.symbol;
    const current = tipsReceivedByToken.get(symbol) || { count: 0, amount: 0 };
    tipsReceivedByToken.set(symbol, {
      count: current.count + 1,
      amount: current.amount + Number(tip.amountAtomic)
    });
  });

  // Process group tips created (sent)
  groupTipsCreated.forEach(groupTip => {
    const symbol = groupTip.Token.symbol;
    const current = tipsSentByToken.get(symbol) || { count: 0, amount: 0 };
    tipsSentByToken.set(symbol, {
      count: current.count + 1,
      amount: current.amount + Number(groupTip.totalAmount)
    });
  });

  // Process group tips claimed (received)
  for (const claim of groupTipsClaimed) {
    const groupTip = claim.GroupTip;
    const symbol = groupTip.Token.symbol;
    
    // Get total number of claims for this group tip to calculate user's share
    const totalClaims = await prisma.groupTipClaim.count({
      where: { groupTipId: claim.groupTipId }
    });
    
    const userShare = totalClaims > 0 ? Number(groupTip.totalAmount) / totalClaims : 0;
    
    const current = tipsReceivedByToken.get(symbol) || { count: 0, amount: 0 };
    tipsReceivedByToken.set(symbol, {
      count: current.count + 1,
      amount: current.amount + userShare
    });
  }

  // Format tip statistics for display
  const tipsSentText = Array.from(tipsSentByToken.entries())
    .map(([symbol, data]) => `${data.count} tips (${formatDecimal(data.amount, symbol)})`)
    .join('\n') || 'No tips sent';

  const tipsReceivedText = Array.from(tipsReceivedByToken.entries())
    .map(([symbol, data]) => `${data.count} tips (${formatDecimal(data.amount, symbol)})`)
    .join('\n') || 'No tips received';

  const totalTipsSentCount = Array.from(tipsSentByToken.values()).reduce((sum, data) => sum + data.count, 0);
  const totalTipsReceivedCount = Array.from(tipsReceivedByToken.values()).reduce((sum, data) => sum + data.count, 0);

  // Format recent activity
  const recentActivity = recentTransactions.length > 0
    ? recentTransactions
        .map(tx => {
          const amount = formatDecimal(tx.amount, "tokens");
          const timeAgo = `<t:${Math.floor(tx.createdAt.getTime() / 1000)}:R>`;
          return `${tx.type}: ${amount} ${timeAgo}`;
        })
        .join("\n")
    : "No recent activity";

  // Create purchase/extend membership button
  const buttonLabel = activeMemberships.length > 0 ? "Extend Membership" : "Purchase Membership";
  const buttonEmoji = activeMemberships.length > 0 ? "⏰" : "⭐";
  
  const purchaseButton = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("pip:purchase_membership")
        .setLabel(buttonLabel)
        .setStyle(ButtonStyle.Primary)
        .setEmoji(buttonEmoji)
    );

    // Update the reply with the full profile
    await i.editReply({
      content: null, // Clear the loading message
      embeds: [
        profileEmbed({
          user: i.user,
          agwAddress: u.agwAddress ?? null,
          balanceText,
          wins: u.wins,
          losses: u.losses,
          ties: u.ties,
          membershipText,
          tippingStats: {
            sentText: tipsSentText,
            receivedText: tipsReceivedText,
            sentCount: totalTipsSentCount,
            receivedCount: totalTipsReceivedCount
          },
          groupTipActivity: {
            created: groupTipsCreated.length,
            claimed: groupTipsClaimed.length
          },
          recentActivity,
          createdAt: u.createdAt,
          hasActiveMembership: activeMemberships.length > 0
        })
      ],
      components: [purchaseButton]
    });

  } catch (error: any) {
    console.error("Profile command error:", error);
    const errorMessage = `Error loading profile: ${error?.message || String(error)}`;
    
    // Since we already replied, use editReply for errors
    await i.editReply({ 
      content: errorMessage,
      embeds: [],
      components: []
    }).catch(() => {});
  }
}