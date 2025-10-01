import { MessageFlags } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { prisma } from "../services/db.js";
import { formatDecimal } from "../services/token.js";
import { PENGUIN_ERRORS } from "../utils/penguin_messages.js";
import { getAppConfig } from "../services/app_config_cache.js";
async function pipWithdraw(i) {
  try {
    const config = await getAppConfig();
    if (config?.withdrawalsPaused || config?.emergencyMode) {
      return i.reply({
        content: [
          "\u{1F6A8} **Withdrawals Temporarily Disabled**",
          "",
          "Withdrawals are currently paused for maintenance.",
          "Please try again later or contact support if this is urgent.",
          "",
          "All other bot functions remain available."
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }
    const user = await prisma.user.findUnique({
      where: { discordId: i.user.id },
      select: { id: true, agwAddress: true }
    });
    if (!user) {
      return i.reply({
        content: [
          "\u274C **No Account Found**",
          "",
          "You need to create an account first.",
          "",
          "Use `/pip_profile` to view your account!"
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }
    if (!user.agwAddress) {
      const walletRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("\u{1F310} Get Abstract Wallet").setStyle(ButtonStyle.Link).setURL("https://abs.xyz"),
        new ButtonBuilder().setCustomId("pip:prompt_link_wallet").setLabel("\u{1F517} Link My Wallet").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("pip:show_help").setLabel("\u{1F4DA} Get Help").setStyle(ButtonStyle.Secondary)
      );
      return i.reply({
        content: PENGUIN_ERRORS.walletNotLinked(),
        components: [walletRow],
        flags: MessageFlags.Ephemeral
      });
    }
    const holdings = await prisma.userBalance.findMany({
      where: {
        userId: user.id,
        amount: { gt: 0 }
        // Only show tokens with positive balance
      },
      include: { Token: true },
      orderBy: { amount: "desc" }
    });
    if (holdings.length === 0) {
      return i.reply({
        content: [
          "\u{1F4B0} **No Holdings to Withdraw**",
          "",
          "You don't have any tokens in your account to withdraw.",
          "",
          "**To get tokens:**",
          "\u2022 Use `/pip_deposit` to add funds",
          "\u2022 Receive tips from other users",
          "\u2022 Win games with `/pip_game`",
          "",
          "\u{1F4A1} *Once you have tokens, they'll appear here for withdrawal!*"
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
    }
    const withdrawalStatus = await getWithdrawalStatusDisplay(user.id, holdings);
    const embed = new EmbedBuilder().setTitle("\u{1F4B8} Withdraw Your Tokens").setDescription([
      `**Your Linked Wallet:** \`${user.agwAddress}\``,
      "",
      "**Your Holdings:**",
      holdings.map((holding) => {
        const balance = formatDecimal(holding.amount, holding.Token.symbol);
        return `\u2022 **${balance}** ${holding.Token.symbol}`;
      }).join("\n"),
      "",
      "\u{1F4B0} **Your Withdrawal Status:**",
      withdrawalStatus,
      "",
      "\u{1FA99} **Select a token below to withdraw:**"
    ].join("\n")).setColor(65280).setFooter({ text: "All limits are to prevent abuse and protect the platform" }).setTimestamp();
    const tokenButtons = [];
    const maxButtons = Math.min(holdings.length, 15);
    for (let i2 = 0; i2 < maxButtons; i2++) {
      const holding = holdings[i2];
      const balance = formatDecimal(holding.amount, holding.Token.symbol);
      tokenButtons.push(
        new ButtonBuilder().setCustomId(`pip:withdraw_token:${holding.Token.id}`).setLabel(`${holding.Token.symbol} (${balance})`).setStyle(ButtonStyle.Primary).setEmoji("\u{1F4B0}")
      );
    }
    const actionRows = [];
    for (let i2 = 0; i2 < tokenButtons.length; i2 += 5) {
      const row = new ActionRowBuilder().addComponents(tokenButtons.slice(i2, i2 + 5));
      actionRows.push(row);
    }
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pip:view_profile").setLabel("\u{1F464} View Profile").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pip:show_help").setLabel("\u{1F4DA} Get Help").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pip:cancel_withdraw").setLabel("\u274C Cancel").setStyle(ButtonStyle.Secondary)
    );
    actionRows.push(actionRow);
    await i.reply({
      embeds: [embed],
      components: actionRows,
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    console.error("Withdraw command error:", error);
    await i.reply({
      content: `\u274C **Error loading withdraw interface**
${error?.message || String(error)}`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {
    });
  }
}
async function getWithdrawalStatusDisplay(userId, holdings) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true }
    });
    if (!user) return "\u2022 Status: Unknown user";
    const accountAgeDays = Math.floor((Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1e3));
    let maxWithdrawalsPerDay;
    let accountTier;
    if (accountAgeDays < 1) {
      maxWithdrawalsPerDay = 1;
      accountTier = "New (< 1 day)";
    } else if (accountAgeDays < 7) {
      maxWithdrawalsPerDay = 2;
      accountTier = "Recent (< 1 week)";
    } else if (accountAgeDays < 30) {
      maxWithdrawalsPerDay = 3;
      accountTier = "Established (< 1 month)";
    } else {
      maxWithdrawalsPerDay = 5;
      accountTier = "Mature (1+ month)";
    }
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1e3);
    const recentWithdrawals = await prisma.transaction.findMany({
      where: {
        userId,
        type: "WITHDRAW",
        createdAt: { gte: twentyFourHoursAgo }
      },
      include: { Token: true },
      orderBy: { createdAt: "desc" }
    });
    const withdrawalsUsed = recentWithdrawals.length;
    const timeUntilReset = 24 - Math.floor((Date.now() - twentyFourHoursAgo.getTime()) / (60 * 60 * 1e3));
    const tokenWithdrawals = /* @__PURE__ */ new Map();
    recentWithdrawals.forEach((w) => {
      if (w.tokenId) {
        tokenWithdrawals.set(w.tokenId, (tokenWithdrawals.get(w.tokenId) || 0) + 1);
      }
    });
    const tokens = await prisma.token.findMany({
      where: {
        id: { in: holdings.map((h) => h.Token.id) },
        active: true
      },
      select: { id: true, symbol: true, minWithdraw: true }
    });
    const status = [
      `\u2022 Account tier: **${accountTier}** (${accountAgeDays} days old)`,
      `\u2022 Daily limit: **${withdrawalsUsed} of ${maxWithdrawalsPerDay}** withdrawals used (resets in ${timeUntilReset}h)`
    ];
    if (withdrawalsUsed > 0) {
      const lastWithdrawal = recentWithdrawals[0];
      const timeSinceLastMs = Date.now() - lastWithdrawal.createdAt.getTime();
      const timeSinceLastHours = Math.floor(timeSinceLastMs / (60 * 60 * 1e3));
      const timeSinceLastMins = Math.floor(timeSinceLastMs % (60 * 60 * 1e3) / (60 * 1e3));
      let nextCooldownMins = 0;
      if (withdrawalsUsed >= 2) {
        nextCooldownMins = (withdrawalsUsed - 1) * 30;
      }
      if (nextCooldownMins > 0) {
        status.push(`\u2022 Cooldown: Next withdrawal available in **${nextCooldownMins} minutes** (progressive limit)`);
      } else {
        status.push(`\u2022 Cooldown: **None** (last withdrawal ${timeSinceLastHours}h ${timeSinceLastMins}m ago)`);
      }
    } else {
      status.push(`\u2022 Cooldown: **None** (no recent withdrawals)`);
    }
    status.push(`\u2022 Quick withdrawals: **< 10** (instant) | **10-100** (1hr) | **100+** (6hr)`);
    const minimums = tokens.map((t) => `${t.symbol} (${Number(t.minWithdraw)} min)`).join(", ");
    if (minimums) {
      status.push(`\u2022 Minimum amounts: ${minimums}`);
    }
    const tokenLimits = tokens.map((token) => {
      const used = tokenWithdrawals.get(token.id) || 0;
      const remaining = Math.max(0, 3 - used);
      return `${token.symbol} (${used}/3 today)`;
    }).join(", ");
    if (tokenLimits) {
      status.push(`\u2022 Per-token today: ${tokenLimits}`);
    }
    return status.join("\n");
  } catch (error) {
    console.error("Error getting withdrawal status:", error);
    return "\u2022 Status: Unable to load withdrawal information";
  }
}
export {
  pipWithdraw as default
};
//# sourceMappingURL=pip_withdraw.js.map
