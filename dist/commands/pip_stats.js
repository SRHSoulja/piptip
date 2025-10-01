import { MessageFlags } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { prisma } from "../services/db.js";
import { formatDecimal, formatDecimalWithUSD } from "../services/token.js";
async function pipStats(i) {
  try {
    const user = await prisma.user.findUnique({
      where: { discordId: i.user.id },
      select: { id: true, agwAddress: true, createdAt: true, wins: true, losses: true, ties: true }
    });
    if (!user) {
      return i.reply({
        content: [
          "\u274C **No Account Found**",
          "",
          "You need to create an account first.",
          "",
          "Use `/pip_profile` to create your account!"
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }
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
        orderBy: { amount: "desc" }
      }),
      // Active tier memberships
      prisma.tierMembership.findMany({
        where: {
          userId: user.id,
          status: "ACTIVE",
          expiresAt: { gt: /* @__PURE__ */ new Date() }
        },
        include: { tier: true },
        orderBy: { expiresAt: "desc" }
      }),
      // Direct tips sent aggregated by token (only completed)
      prisma.tip.groupBy({
        by: ["tokenId"],
        where: { fromUserId: user.id, status: "COMPLETED" },
        _count: { id: true },
        _sum: { amountAtomic: true }
      }),
      // Direct tips received aggregated by token (only completed)
      prisma.tip.groupBy({
        by: ["tokenId"],
        where: { toUserId: user.id, status: "COMPLETED" },
        _count: { id: true },
        _sum: { amountAtomic: true }
      }),
      // Group tip statistics (revert to work with current schema)
      Promise.all([
        prisma.groupTip.groupBy({
          by: ["tokenId"],
          where: { creatorId: user.id },
          _count: { id: true },
          _sum: { totalAmount: true }
        }),
        prisma.groupTipClaim.count({
          where: { userId: user.id, status: "CLAIMED" }
        })
      ]).then(([created, claimed]) => ({ created, claimed })),
      // Deposit statistics
      prisma.transaction.groupBy({
        by: ["tokenId"],
        where: { userId: user.id, type: "DEPOSIT" },
        _count: { id: true },
        _sum: { amount: true }
      }),
      // Withdrawal statistics
      prisma.transaction.groupBy({
        by: ["tokenId"],
        where: { userId: user.id, type: "WITHDRAW" },
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
          status: "COMPLETED"
        }
      }),
      // Recent activity
      prisma.transaction.findMany({
        where: {
          OR: [
            { userId: user.id },
            { otherUserId: user.id }
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
          if (unique.length >= 5) break;
        }
        return unique;
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
    const totalDeposits = depositStats.reduce((sum, stat) => sum + stat._count.id, 0);
    const totalWithdrawals = withdrawStats.reduce((sum, stat) => sum + stat._count.id, 0);
    const totalTipsSent = tipStatsSent.reduce((sum, stat) => sum + stat._count.id, 0);
    const totalTipsReceived = tipStatsReceived.reduce((sum, stat) => sum + stat._count.id, 0);
    const totalGroupTipsCreated = groupTipStats.created.reduce((sum, stat) => sum + stat._count.id, 0);
    const totalGroupTipsClaimed = groupTipStats.claimed;
    const totalGames = gameStats;
    const totalDepositVolume = depositStats.reduce((sum, stat) => sum + Number(stat._sum.amount || 0), 0);
    const totalWithdrawVolume = withdrawStats.reduce((sum, stat) => sum + Number(stat._sum.amount || 0), 0);
    const membershipText = activeMemberships.length > 0 ? activeMemberships.map((m) => `${m.tier.name} (expires <t:${Math.floor(m.expiresAt.getTime() / 1e3)}:R>)`).join("\n") : "No active memberships";
    const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1e3 * 60 * 60 * 24));
    const embed = new EmbedBuilder().setTitle(`\u{1F4CA} ${i.user.displayName || i.user.username}'s Statistics`).setDescription([
      `**Account Age:** ${accountAge} days`,
      `**Wallet:** ${user.agwAddress ? `\`${user.agwAddress.slice(0, 10)}...\`` : "Not linked"}`,
      "",
      `**Current Balance:** ${balanceText}`,
      "",
      "**Activity Summary:**",
      `\u2022 **Deposits:** ${totalDeposits} transactions`,
      `\u2022 **Withdrawals:** ${totalWithdrawals} transactions`,
      `\u2022 **Tips Sent:** ${totalTipsSent} tips`,
      `\u2022 **Tips Received:** ${totalTipsReceived} tips`,
      `\u2022 **Group Tips Created:** ${totalGroupTipsCreated}`,
      `\u2022 **Group Tips Claimed:** ${totalGroupTipsClaimed}`,
      `\u2022 **Games Played:** ${totalGames}`,
      "",
      "**Game Record:**",
      `\u2022 **Wins:** ${user.wins} \u{1F3C6}`,
      `\u2022 **Losses:** ${user.losses} \u{1F480}`,
      `\u2022 **Ties:** ${user.ties} \u{1F91D}`,
      "",
      "**Tier Memberships:**",
      membershipText
    ].join("\n")).setColor(3447003).setThumbnail(i.user.displayAvatarURL()).setFooter({ text: "Use the button below to export your complete transaction history" }).setTimestamp();
    if (recentTransactions.length > 0) {
      const recentActivityPromises = recentTransactions.map(async (tx) => {
        let direction = "";
        if (tx.type === "TIP") {
          if (tx.userId === user.id) {
            direction = " SENT";
          } else if (tx.otherUserId === user.id) {
            direction = " RECEIVED";
          }
        }
        const timeAgo = `<t:${Math.floor(tx.createdAt.getTime() / 1e3)}:R>`;
        const tokenSymbol = tx.Token?.symbol || "tokens";
        let formattedAmount;
        if (tx.usdValue && tx.usdValue > 0) {
          const historicalUSD = parseFloat(tx.usdValue);
          const usdFormatted = historicalUSD < 1 ? `$${historicalUSD.toFixed(4).replace(/\.?0+$/, "")}` : `$${historicalUSD.toFixed(2).replace(/\.?0+$/, "")}`;
          formattedAmount = `${formatDecimal(Number(tx.amount), tokenSymbol)} (${usdFormatted} historical)`;
        } else {
          formattedAmount = await formatDecimalWithUSD(tx.amount, tokenSymbol, { compact: true });
        }
        return `${tx.type}${direction}: ${formattedAmount} ${timeAgo}`;
      });
      const recentActivityArray = await Promise.all(recentActivityPromises);
      const recentActivity = recentActivityArray.join("\n");
      embed.addFields({
        name: "\u{1F552} Recent Activity",
        value: recentActivity,
        inline: false
      });
    }
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pip:export_csv").setLabel("\u{1F4CA} Export Transaction History (CSV)").setStyle(ButtonStyle.Primary).setEmoji("\u{1F4C4}"),
      new ButtonBuilder().setCustomId("pip:view_profile").setLabel("\u{1F464} View Profile").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pip:show_help").setLabel("\u{1F4DA} Help").setStyle(ButtonStyle.Secondary)
    );
    const refreshRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pip:refresh_stats").setLabel("\u{1F504} Refresh Stats").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pip:dismiss_stats").setLabel("\u274C Dismiss").setStyle(ButtonStyle.Secondary)
    );
    await i.reply({
      embeds: [embed],
      components: [actionRow, refreshRow],
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    console.error("Stats command error:", error);
    await i.reply({
      content: `\u274C **Error loading statistics**
${error?.message || String(error)}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {
    });
  }
}
export {
  pipStats as default
};
//# sourceMappingURL=pip_stats.js.map
