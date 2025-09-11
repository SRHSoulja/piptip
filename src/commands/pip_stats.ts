// src/commands/pip_stats.ts - Comprehensive user statistics and transaction history
import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { prisma } from "../services/db.js";
import { formatDecimal } from "../services/token.js";

export default async function pipStats(i: ChatInputCommandInteraction) {
  try {
    // Check if user has account
    const user = await prisma.user.findUnique({
      where: { discordId: i.user.id },
      select: { id: true, agwAddress: true, createdAt: true, wins: true, losses: true, ties: true }
    });

    if (!user) {
      return i.reply({
        content: [
          "❌ **No Account Found**",
          "",
          "You need to create an account first.",
          "",
          "Use `/pip_profile` to create your account!"
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }

    // Get comprehensive statistics in parallel
    const [
      balances,
      activeMemberships,
      tipStatsSent,
      tipStatsReceived,
      groupTipStats,
      depositStats,
      withdrawStats,
      gameStats,
      recentTransactions
    ] = await Promise.all([
      // Current token balances
      prisma.userBalance.findMany({
        where: { userId: user.id },
        include: { Token: true },
        orderBy: { amount: 'desc' }
      }),

      // Active tier memberships
      prisma.tierMembership.findMany({
        where: { 
          userId: user.id, 
          status: 'ACTIVE',
          expiresAt: { gt: new Date() }
        },
        include: { tier: true },
        orderBy: { expiresAt: 'desc' }
      }),

      // Direct tips sent aggregated by token (revert to work with current schema)
      prisma.tip.groupBy({
        by: ['tokenId'],
        where: { fromUserId: user.id },
        _count: { id: true },
        _sum: { amountAtomic: true }
      }),

      // Direct tips received aggregated by token (revert to work with current schema)
      prisma.tip.groupBy({
        by: ['tokenId'],
        where: { toUserId: user.id },
        _count: { id: true },
        _sum: { amountAtomic: true }
      }),

      // Group tip statistics (revert to work with current schema)
      Promise.all([
        prisma.groupTip.groupBy({
          by: ['tokenId'],
          where: { creatorId: user.id },
          _count: { id: true },
          _sum: { totalAmount: true }
        }),
        prisma.groupTipClaim.count({
          where: { userId: user.id }
        })
      ]).then(([created, claimed]) => ({ created, claimed })),

      // Deposit statistics
      prisma.transaction.groupBy({
        by: ['tokenId'],
        where: { userId: user.id, type: 'DEPOSIT' },
        _count: { id: true },
        _sum: { amount: true }
      }),

      // Withdrawal statistics
      prisma.transaction.groupBy({
        by: ['tokenId'],
        where: { userId: user.id, type: 'WITHDRAW' },
        _count: { id: true },
        _sum: { amount: true }
      }),

      // Game statistics
      prisma.match.count({
        where: {
          OR: [
            { challengerId: user.id },
            { joinerId: user.id }
          ],
          status: 'COMPLETED'
        }
      }),

      // Recent activity
      prisma.transaction.findMany({
        where: { 
          OR: [
            { userId: user.id },
            { otherUserId: user.id }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      })
    ]);

    // Get all tokens for mapping
    const allTokens = await prisma.token.findMany({
      select: { id: true, symbol: true }
    });
    const tokenMap = new Map(allTokens.map(t => [t.id, t.symbol]));

    // Format balance display
    const balanceText = balances.length > 0 
      ? balances
          .filter(b => Number(b.amount) > 0)
          .map(b => `${formatDecimal(b.amount, b.Token.symbol)} ${b.Token.symbol}`)
          .join(", ") || "0 tokens"
      : "0 tokens";

    // Calculate total transaction counts
    const totalDeposits = depositStats.reduce((sum, stat) => sum + stat._count.id, 0);
    const totalWithdrawals = withdrawStats.reduce((sum, stat) => sum + stat._count.id, 0);
    const totalTipsSent = tipStatsSent.reduce((sum, stat) => sum + stat._count.id, 0);
    const totalTipsReceived = tipStatsReceived.reduce((sum, stat) => sum + stat._count.id, 0);
    const totalGroupTipsCreated = groupTipStats.created.reduce((sum, stat) => sum + stat._count.id, 0);
    const totalGroupTipsClaimed = groupTipStats.claimed;
    const totalGames = gameStats;

    // Calculate total transaction volume (attempts to sum across different tokens)
    const totalDepositVolume = depositStats.reduce((sum, stat) => sum + Number(stat._sum.amount || 0), 0);
    const totalWithdrawVolume = withdrawStats.reduce((sum, stat) => sum + Number(stat._sum.amount || 0), 0);

    // Format membership status
    const membershipText = activeMemberships.length > 0 
      ? activeMemberships
          .map(m => `${m.tier.name} (expires <t:${Math.floor(m.expiresAt.getTime() / 1000)}:R>)`)
          .join("\n")
      : "No active memberships";

    // Account age
    const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));

    // Create comprehensive stats embed
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${i.user.displayName || i.user.username}'s Statistics`)
      .setDescription([
        `**Account Age:** ${accountAge} days`,
        `**Wallet:** ${user.agwAddress ? `\`${user.agwAddress.slice(0, 10)}...\`` : "Not linked"}`,
        "",
        `**Current Balance:** ${balanceText}`,
        "",
        "**Activity Summary:**",
        `• **Deposits:** ${totalDeposits} transactions`,
        `• **Withdrawals:** ${totalWithdrawals} transactions`, 
        `• **Tips Sent:** ${totalTipsSent} tips`,
        `• **Tips Received:** ${totalTipsReceived} tips`,
        `• **Group Tips Created:** ${totalGroupTipsCreated}`,
        `• **Group Tips Claimed:** ${totalGroupTipsClaimed}`,
        `• **Games Played:** ${totalGames}`,
        "",
        "**Game Record:**",
        `• **Wins:** ${user.wins} 🏆`,
        `• **Losses:** ${user.losses} 💀`, 
        `• **Ties:** ${user.ties} 🤝`,
        "",
        "**Tier Memberships:**",
        membershipText
      ].join("\n"))
      .setColor(0x3498DB)
      .setThumbnail(i.user.displayAvatarURL())
      .setFooter({ text: "Use the button below to export your complete transaction history" })
      .setTimestamp();

    // Add recent activity field if there are recent transactions
    if (recentTransactions.length > 0) {
      const recentActivity = recentTransactions
        .map(tx => {
          const timeAgo = `<t:${Math.floor(tx.createdAt.getTime() / 1000)}:R>`;
          const tokenSymbol = tx.tokenId ? tokenMap.get(tx.tokenId) || "tokens" : "tokens";
          const amount = formatDecimal(tx.amount, tokenSymbol);
          return `${tx.type}: ${amount} ${timeAgo}`;
        })
        .join("\n");
      
      embed.addFields({
        name: "🕒 Recent Activity",
        value: recentActivity,
        inline: false
      });
    }

    // Create action buttons
    const actionRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("pip:export_csv")
          .setLabel("📊 Export Transaction History (CSV)")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📄"),
        new ButtonBuilder()
          .setCustomId("pip:view_profile")
          .setLabel("👤 View Profile")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("pip:show_help")
          .setLabel("📚 Help")
          .setStyle(ButtonStyle.Secondary)
      );

    const refreshRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("pip:refresh_stats")
          .setLabel("🔄 Refresh Stats")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("pip:dismiss_stats")
          .setLabel("❌ Dismiss")
          .setStyle(ButtonStyle.Secondary)
      );

    await i.reply({
      embeds: [embed],
      components: [actionRow, refreshRow],
      flags: MessageFlags.Ephemeral
    });

  } catch (error: any) {
    console.error("Stats command error:", error);
    await i.reply({
      content: `❌ **Error loading statistics**\n${error?.message || String(error)}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }
}