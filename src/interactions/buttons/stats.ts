// src/interactions/buttons/stats.ts
import type { ButtonInteraction } from "discord.js";
import { prisma } from "../../services/db.js";
import { formatDecimal } from "../../services/token.js";

/** Handle CSV export of user transaction history */
export async function handleExportCSV(i: ButtonInteraction) {
  await i.deferReply({ flags: 64 }).catch(() => {});
  
  try {
    // Get user
    const user = await prisma.user.findUnique({
      where: { discordId: i.user.id },
      select: { id: true }
    });

    if (!user) {
      return i.editReply({
        content: "❌ **Error**\nUser account not found."
      });
    }

    // Get all transactions for the user
    const transactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { userId: user.id },
          { otherUserId: user.id }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    // Get all tips (sent and received) including status info
    const [tipsSent, tipsReceived] = await Promise.all([
      prisma.tip.findMany({
        where: { fromUserId: user.id },
        include: {
          Token: true,
          From: { select: { discordId: true } },
          To: { select: { discordId: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.tip.findMany({
        where: { toUserId: user.id },
        include: {
          Token: true,
          From: { select: { discordId: true } },
          To: { select: { discordId: true } }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    // Get group tip activity
    const [groupTipsCreated, groupTipsClaimed] = await Promise.all([
      prisma.groupTip.findMany({
        where: { creatorId: user.id },
        include: { Token: true },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.groupTipClaim.findMany({
        where: { userId: user.id },
        include: {
          GroupTip: {
            include: { Token: true, Creator: { select: { discordId: true } } }
          }
        },
        orderBy: { claimedAt: 'desc' }
      })
    ]);

    // Create simplified CSV content focused on user activity
    const csvRows = [];
    
    // CSV Header - simplified and user-friendly
    csvRows.push([
      "Date",
      "Activity", 
      "Amount",
      "Token",
      "Counterparty",
      "Direction",
      "Fee",
      "Note",
      "Transaction_Hash"
    ]);

    // Get token symbols for transactions
    const allTokens = await prisma.token.findMany({
      select: { id: true, symbol: true }
    });
    const tokenMap = new Map(allTokens.map(t => [t.id, t.symbol]));

    // Consolidate activities to avoid duplicates
    const activities = new Map();

    // Process direct tips sent
    for (const tip of tipsSent) {
      const key = `tip_sent_${tip.createdAt.getTime()}`;
      let activityName = "Direct Tip Sent";
      let statusNote = tip.note || "";
      
      if (tip.status === "REFUNDED") {
        activityName = "Direct Tip Sent (refunded — failed)";
        statusNote = `${statusNote} [REFUNDED: principal + tax returned]`.trim();
      }
      
      activities.set(key, {
        date: tip.createdAt,
        activity: activityName,
        amount: formatDecimal(tip.amountAtomic, tip.Token.symbol),
        token: tip.Token.symbol,
        counterparty: tip.To?.discordId || 'Unknown',
        direction: "OUT",
        fee: formatDecimal(tip.feeAtomic, tip.Token.symbol),
        note: statusNote,
        txHash: ""
      });
    }

    // Process direct tips received
    for (const tip of tipsReceived) {
      const key = `tip_received_${tip.createdAt.getTime()}`;
      let activityName = "Direct Tip Received";
      let statusNote = tip.note || "";
      
      if (tip.status === "REFUNDED") {
        activityName = "Direct Tip Received (refunded — failed)";
        statusNote = `${statusNote} [REFUNDED: tip was returned to sender]`.trim();
      }
      
      activities.set(key, {
        date: tip.createdAt,
        activity: activityName,
        amount: formatDecimal(tip.amountAtomic, tip.Token.symbol),
        token: tip.Token.symbol,
        counterparty: tip.From?.discordId || 'Unknown',
        direction: "IN",
        fee: "0",
        note: statusNote,
        txHash: ""
      });
    }

    // Process group tips created
    for (const groupTip of groupTipsCreated) {
      const key = `group_tip_${groupTip.createdAt.getTime()}`;
      let activityName = "Group Tip Created";
      let statusNote = `${groupTip.duration / 60}min duration`;
      
      if (groupTip.status === "REFUNDED") {
        activityName = "Group Tip Created (refunded — not collected)";
        statusNote = `${statusNote} [REFUNDED: principal + tax returned]`;
      } else if (groupTip.status === "FAILED") {
        activityName = "Group Tip Created (refunded — failed)";
        statusNote = `${statusNote} [REFUNDED: posting failed, principal + tax returned]`;
      }
      
      activities.set(key, {
        date: groupTip.createdAt,
        activity: activityName,
        amount: formatDecimal(groupTip.totalAmount, groupTip.Token.symbol),
        token: groupTip.Token.symbol,
        counterparty: "Public",
        direction: "OUT",
        fee: formatDecimal(groupTip.taxAtomic, groupTip.Token.symbol),
        note: statusNote,
        txHash: ""
      });
    }

    // Process deposits, withdrawals, and other important transactions
    for (const tx of transactions) {
      if (tx.type === "DEPOSIT" && tx.userId === user.id) {
        const key = `deposit_${tx.createdAt.getTime()}`;
        const tokenSymbol = tx.tokenId ? tokenMap.get(tx.tokenId) || "Unknown" : "Unknown";
        activities.set(key, {
          date: tx.createdAt,
          activity: "Deposit",
          amount: formatDecimal(tx.amount, tokenSymbol),
          token: tokenSymbol,
          counterparty: "Treasury",
          direction: "IN",
          fee: formatDecimal(tx.fee, tokenSymbol),
          note: "Blockchain deposit",
          txHash: tx.txHash || ""
        });
      } else if (tx.type === "WITHDRAW" && tx.userId === user.id) {
        const key = `withdraw_${tx.createdAt.getTime()}`;
        const tokenSymbol = tx.tokenId ? tokenMap.get(tx.tokenId) || "Unknown" : "Unknown";
        activities.set(key, {
          date: tx.createdAt,
          activity: "Withdrawal",
          amount: formatDecimal(tx.amount, tokenSymbol),
          token: tokenSymbol,
          counterparty: "Your Wallet",
          direction: "OUT",
          fee: formatDecimal(tx.fee, tokenSymbol),
          note: "Blockchain withdrawal",
          txHash: tx.txHash || ""
        });
      } else if (tx.type === "MATCH_WAGER" && tx.userId === user.id) {
        const key = `match_wager_${tx.createdAt.getTime()}`;
        const tokenSymbol = tx.tokenId ? tokenMap.get(tx.tokenId) || "Unknown" : "Unknown";
        activities.set(key, {
          date: tx.createdAt,
          activity: "Game Wager",
          amount: formatDecimal(tx.amount, tokenSymbol),
          token: tokenSymbol,
          counterparty: "Match System",
          direction: "OUT",
          fee: "0",
          note: "Rock-paper-scissors wager",
          txHash: ""
        });
      } else if (tx.type === "MATCH_PAYOUT" && tx.userId === user.id) {
        const key = `match_payout_${tx.createdAt.getTime()}`;
        const tokenSymbol = tx.tokenId ? tokenMap.get(tx.tokenId) || "Unknown" : "Unknown";
        activities.set(key, {
          date: tx.createdAt,
          activity: "Game Payout",
          amount: formatDecimal(tx.amount, tokenSymbol),
          token: tokenSymbol,
          counterparty: "Match System",
          direction: "IN",
          fee: "0",
          note: "Rock-paper-scissors winnings",
          txHash: ""
        });
      }
    }

    // Add group tips claimed
    for (const claim of groupTipsClaimed) {
      const key = `group_tip_claimed_${claim.claimedAt?.getTime() || Date.now()}`;
      activities.set(key, {
        date: claim.claimedAt || new Date(),
        activity: "Group Tip Claimed",
        amount: formatDecimal(claim.GroupTip.totalAmount, claim.GroupTip.Token.symbol),
        token: claim.GroupTip.Token.symbol,
        counterparty: claim.GroupTip.Creator?.discordId || 'Unknown',
        direction: "IN",
        fee: "0",
        note: "Claimed from group tip",
        txHash: ""
      });
    }

    // Convert activities to CSV rows
    const sortedActivities = Array.from(activities.values())
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    for (const activity of sortedActivities) {
      csvRows.push([
        activity.date.toISOString(),
        activity.activity,
        activity.amount,
        activity.token,
        activity.counterparty,
        activity.direction,
        activity.fee,
        activity.note,
        activity.txHash
      ]);
    }

    // Convert to CSV string
    const csvContent = csvRows
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    // Create file buffer
    const buffer = Buffer.from(csvContent, 'utf8');
    const fileName = `piptip_transactions_${i.user.username}_${new Date().toISOString().split('T')[0]}.csv`;

    // Send as file attachment
    await i.editReply({
      content: [
        "📊 **Transaction History Export Complete**",
        "",
        `**Total Records:** ${csvRows.length - 1}`,
        `**File Name:** ${fileName}`,
        "",
        "Your complete transaction history has been exported to CSV format.",
        "This includes all deposits, withdrawals, tips, and group tip activity."
      ].join("\n"),
      files: [{
        attachment: buffer,
        name: fileName
      }]
    });

  } catch (error: any) {
    console.error("CSV export error:", error);
    await i.editReply({
      content: `❌ **Export Failed**\n${error?.message || String(error)}`
    }).catch(() => {});
  }
}

/** Handle refresh stats */
export async function handleRefreshStats(i: ButtonInteraction) {
  await i.reply({
    content: "🔄 **Refreshing Stats**\nPlease use `/pip_stats` again to see updated statistics.",
    flags: 64
  });
}

/** Handle dismiss stats */
export async function handleDismissStats(i: ButtonInteraction) {
  await i.deferUpdate().catch(() => {});
  
  try {
    await i.editReply({
      content: "📊 **Statistics dismissed**\n*Use `/pip_stats` to view your statistics again.*",
      embeds: [],
      components: []
    });
  } catch (error: any) {
    console.error("Dismiss stats error:", error);
  }
}