import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } from "discord.js";
import { prisma } from "../../services/db.js";
import { formatAmount, formatDecimal, toAtomicDirect } from "../../services/token.js";
import { withdrawalLimiter } from "../../services/withdrawal_limiter.js";
import { PENGUIN_LOADING } from "../../utils/penguin_messages.js";
import { getAppConfig } from "../../services/app_config_cache.js";
async function handleWithdrawToken(i, parts) {
  await i.deferUpdate().catch(() => {
  });
  try {
    const tokenId = parseInt(parts[2]);
    const [token, user, holding] = await Promise.all([
      prisma.token.findUnique({ where: { id: tokenId } }),
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: { id: true, agwAddress: true }
      }),
      prisma.userBalance.findUnique({
        where: { userId_tokenId: { userId: (await prisma.user.findUniqueOrThrow({ where: { discordId: i.user.id } })).id, tokenId } },
        include: { Token: true }
      })
    ]);
    if (!token || !user || !holding) {
      return i.editReply({
        content: "\u274C **Error**\nToken or balance not found.",
        components: []
      });
    }
    if (!user.agwAddress) {
      return i.editReply({
        content: "\u274C **Wallet not linked**\nPlease link your wallet first using `/pip_link`.",
        components: []
      });
    }
    const balance = formatDecimal(holding.amount, token.symbol);
    const maxAmount = Number(holding.amount);
    const config = await getAppConfig();
    const minWithdraw = Number(token.minWithdraw);
    const maxPerTxHuman = token.withdrawMaxPerTx != null ? Number(token.withdrawMaxPerTx) : Number(config?.withdrawMaxPerTx ?? 0);
    const effectiveMax = maxPerTxHuman > 0 ? Math.min(maxAmount, maxPerTxHuman) : maxAmount;
    if (maxAmount < minWithdraw) {
      const errorButtonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("pip:back_to_withdraw").setLabel("\u2B05\uFE0F Back to Holdings").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("pip:show_deposit_instructions").setLabel("\u{1F4B0} Add Funds").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("pip:cancel_withdraw").setLabel("\u274C Cancel").setStyle(ButtonStyle.Secondary)
      );
      return i.editReply({
        content: [
          "\u274C **Insufficient Balance for Withdrawal**",
          "",
          `**Your Balance:** ${balance} ${token.symbol}`,
          `**Minimum Withdrawal:** ${minWithdraw} ${token.symbol}`,
          "",
          "You need more tokens before you can withdraw.",
          "",
          "**To get more tokens:**",
          "\u2022 Use `/pip_deposit` to add funds",
          "\u2022 Receive tips from other users",
          "\u2022 Win games with `/pip_game`"
        ].join("\n"),
        components: [errorButtonRow]
      });
    }
    if (effectiveMax < minWithdraw) {
      const limitErrorButtonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("pip:back_to_withdraw").setLabel("\u2B05\uFE0F Back to Holdings").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("pip:show_help").setLabel("\u{1F4DA} Get Help").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("pip:cancel_withdraw").setLabel("\u274C Cancel").setStyle(ButtonStyle.Secondary)
      );
      return i.editReply({
        content: [
          "\u274C **Cannot Withdraw Due to Limits**",
          "",
          `**Your Balance:** ${balance} ${token.symbol}`,
          `**Minimum Withdrawal:** ${minWithdraw} ${token.symbol}`,
          `**Maximum Per Transaction:** ${maxPerTxHuman} ${token.symbol}`,
          "",
          "The withdrawal limits prevent you from withdrawing this token.",
          "Please contact an administrator if you need assistance."
        ].join("\n"),
        components: [limitErrorButtonRow]
      });
    }
    const maxLine = maxPerTxHuman > 0 ? `max per tx ${maxPerTxHuman} ${token.symbol}` : "no per-tx max";
    const limitsText = `**Limits:** min ${minWithdraw} \xB7 ${maxLine}`;
    const embed = new EmbedBuilder().setTitle(`\u{1F4B8} Withdraw ${token.symbol}`).setDescription([
      `**Available Balance:** ${balance} ${token.symbol}`,
      `**Destination:** \`${user.agwAddress}\``,
      "",
      limitsText,
      "",
      "**How much would you like to withdraw?**",
      "",
      "\u{1F4A1} *Click a button below or use the custom amount option*"
    ].join("\n")).setColor(65280).setFooter({ text: "Withdrawals are sent directly to your linked wallet" }).setTimestamp();
    const presetAmounts = [];
    const commonAmounts = [50, 100, 250, 500, 1e3, 2500, 5e3];
    for (const amount of commonAmounts) {
      if (amount >= minWithdraw && amount <= effectiveMax && amount <= maxAmount) {
        presetAmounts.push(amount);
      }
    }
    const percentages = [0.25, 0.5, 1];
    for (const pct of percentages) {
      const amount = Math.floor(effectiveMax * pct);
      if (amount >= minWithdraw && amount > 0) {
        presetAmounts.push(amount);
      }
    }
    if (minWithdraw <= effectiveMax && !presetAmounts.includes(minWithdraw)) {
      presetAmounts.unshift(minWithdraw);
    }
    const uniqueAmounts = Array.from(new Set(presetAmounts)).filter((amt) => amt > 0).sort((a, b) => a - b);
    const amountButtons = [];
    for (const amount of uniqueAmounts.slice(0, 8)) {
      let percentage = "";
      if (amount === effectiveMax || amount === maxAmount) {
        percentage = " (Max)";
      } else if (amount === Math.floor(effectiveMax * 0.5)) {
        percentage = " (Half)";
      } else if (amount === Math.floor(effectiveMax * 0.25)) {
        percentage = " (25%)";
      } else if (amount === minWithdraw) {
        percentage = " (Min)";
      }
      amountButtons.push(
        new ButtonBuilder().setCustomId(`pip:withdraw_amount:${tokenId}:${amount}`).setLabel(`${amount}${percentage}`).setStyle(amount === effectiveMax || amount === maxAmount ? ButtonStyle.Danger : ButtonStyle.Primary).setEmoji("\u{1F4B0}")
      );
    }
    const actionRows = [];
    for (let i2 = 0; i2 < amountButtons.length; i2 += 4) {
      const row = new ActionRowBuilder().addComponents(amountButtons.slice(i2, i2 + 4));
      actionRows.push(row);
    }
    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pip:withdraw_custom:${tokenId}`).setLabel("\u{1F4AD} Custom Amount").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pip:back_to_withdraw").setLabel("\u2B05\uFE0F Back to Holdings").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pip:cancel_withdraw").setLabel("\u274C Cancel").setStyle(ButtonStyle.Secondary)
    );
    actionRows.push(navRow);
    await i.editReply({
      embeds: [embed],
      components: actionRows
    });
  } catch (error) {
    console.error("Withdraw token selection error:", error);
    await i.editReply({
      content: `\u274C **Error**
${error?.message || String(error)}`,
      components: []
    });
  }
}
async function handleCancelWithdraw(i) {
  await i.deferUpdate().catch(() => {
  });
  try {
    await i.editReply({
      content: "\u274C **Withdrawal cancelled**\n*Use `/pip_withdraw` to try again.*",
      components: []
    });
  } catch (error) {
    console.error("Cancel withdraw error:", error);
  }
}
async function handleWithdrawAmount(i, parts) {
  await i.deferUpdate().catch(() => {
  });
  try {
    const tokenId = parseInt(parts[2]);
    const amount = parseInt(parts[3]);
    const [user, token, holding] = await Promise.all([
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: { id: true, agwAddress: true }
      }),
      prisma.token.findUnique({ where: { id: tokenId } }),
      prisma.userBalance.findUnique({
        where: {
          userId_tokenId: {
            userId: (await prisma.user.findUniqueOrThrow({ where: { discordId: i.user.id } })).id,
            tokenId
          }
        },
        include: { Token: true }
      })
    ]);
    if (!user || !token || !holding) {
      return i.editReply({
        content: "\u274C **Error**\nUser, token, or balance not found.",
        components: []
      });
    }
    if (!user.agwAddress) {
      return i.editReply({
        content: "\u274C **Wallet not linked**\nPlease link your wallet first using `/pip_link`.",
        components: []
      });
    }
    const currentBalance = Number(holding.amount);
    if (amount <= 0 || amount > currentBalance) {
      return i.editReply({
        content: [
          "\u274C **Invalid Amount**",
          "",
          `You requested to withdraw **${formatDecimal(amount, token.symbol)}** ${token.symbol}`,
          `But your balance is only **${formatDecimal(currentBalance, token.symbol)}** ${token.symbol}`,
          "",
          "*Please select a valid amount from the options provided.*"
        ].join("\n"),
        components: []
      });
    }
    const embed = new EmbedBuilder().setTitle("\u26A0\uFE0F Confirm Withdrawal").setDescription([
      `**Token:** ${token.symbol}`,
      `**Amount:** ${formatDecimal(amount, token.symbol)} ${token.symbol}`,
      `**Destination:** \`${user.agwAddress}\``,
      "",
      `**Remaining Balance:** ${formatDecimal(currentBalance - amount, token.symbol)} ${token.symbol}`,
      "",
      "\u26A0\uFE0F **This action cannot be undone**",
      "",
      "Click **Confirm** to proceed with the withdrawal."
    ].join("\n")).setColor(16739125).setFooter({ text: "Double-check your wallet address before confirming" }).setTimestamp();
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pip:confirm_withdraw:${tokenId}:${amount}`).setLabel("\u2705 Send My Fish Home!").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`pip:withdraw_token:${tokenId}`).setLabel("\u2B05\uFE0F Back to Amounts").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pip:cancel_withdraw").setLabel("\u274C Cancel").setStyle(ButtonStyle.Secondary)
    );
    await i.editReply({
      embeds: [embed],
      components: [confirmRow]
    });
  } catch (error) {
    console.error("Withdraw amount selection error:", error);
    await i.editReply({
      content: `\u274C **Error**
${error?.message || String(error)}`,
      components: []
    });
  }
}
async function handleConfirmWithdraw(i, parts) {
  await i.deferUpdate().catch(() => {
  });
  try {
    const emergencyConfig = await getAppConfig();
    if (emergencyConfig?.withdrawalsPaused || emergencyConfig?.emergencyMode) {
      return i.editReply({
        content: [
          "\u{1F6A8} **Withdrawals Temporarily Disabled**",
          "",
          "Withdrawals are currently paused for maintenance.",
          "Please try again later or contact support if this is urgent."
        ].join("\n"),
        embeds: [],
        components: []
      });
    }
    const tokenId = parseInt(parts[2]);
    const amount = parseFloat(parts[3]);
    const [user, token, appConfig] = await Promise.all([
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: { id: true, agwAddress: true }
      }),
      prisma.token.findUnique({ where: { id: tokenId } }),
      getAppConfig()
    ]);
    if (!user || !token) {
      return i.editReply({
        content: "\u274C **Error**\nUser or token not found.",
        components: []
      });
    }
    if (!user.agwAddress) {
      return i.editReply({
        content: "\u274C **Wallet not linked**\nPlease link your wallet first using `/pip_link`.",
        components: []
      });
    }
    if (!token.active) {
      return i.editReply({
        content: "\u274C **Token Inactive**\nThis token is currently not available for withdrawals.",
        components: []
      });
    }
    const maxPerTxHuman = token.withdrawMaxPerTx != null ? Number(token.withdrawMaxPerTx) : Number(appConfig?.withdrawMaxPerTx ?? 0);
    const dailyCapHuman = token.withdrawDailyCap != null ? Number(token.withdrawDailyCap) : Number(appConfig?.withdrawDailyCap ?? 0);
    const maxLine = maxPerTxHuman > 0 ? `max per tx ${maxPerTxHuman} ${token.symbol}` : "no per-tx max";
    const dailyLine = dailyCapHuman > 0 ? `daily cap ${dailyCapHuman} ${token.symbol}` : "no daily cap";
    const policyLine = `\u26A0\uFE0F **Withdraw limits:** min ${token.minWithdraw} ${token.symbol} \xB7 ${maxLine} \xB7 ${dailyLine}`;
    if (amount < Number(token.minWithdraw)) {
      return i.editReply({
        content: [
          "\u274C **Amount Below Minimum**",
          "",
          `Amount is below the minimum: **${token.minWithdraw} ${token.symbol}**`,
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }
    if (maxPerTxHuman > 0 && amount > maxPerTxHuman) {
      return i.editReply({
        content: [
          "\u274C **Amount Exceeds Maximum**",
          "",
          `Amount exceeds the per-transaction max: **${maxPerTxHuman} ${token.symbol}**`,
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }
    const { performComprehensiveWithdrawalCheck } = await import("../../services/atomic_withdrawal.js");
    const comprehensiveCheck = await performComprehensiveWithdrawalCheck(
      i.user.id,
      tokenId,
      amount
    );
    if (!comprehensiveCheck.canProceed) {
      return i.editReply({
        content: [
          "\u274C **Withdrawal Cannot Proceed**",
          "",
          `**Reason:** ${comprehensiveCheck.error}`,
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }
    const limitCheck = await withdrawalLimiter.checkWithdrawalAllowed(user.id, token.id, amount);
    if (!limitCheck.allowed) {
      await withdrawalLimiter.recordBlockedWithdrawal(
        user.id,
        token.id,
        amount,
        limitCheck.reason || "Unknown",
        void 0,
        // IP address - could be added from request headers
        void 0
        // User agent - could be added from Discord client info
      );
      const cooldownMessage = limitCheck.cooldownMinutes ? `

\u23F0 **Next attempt:** ${limitCheck.nextAttemptAt?.toLocaleString() || "Unknown"}` : "";
      return i.editReply({
        content: [
          "\u{1F6AB} **Withdrawal Temporarily Blocked**",
          "",
          `**Reason:** ${limitCheck.reason}`,
          cooldownMessage,
          "",
          "**This protects against:**",
          "\u2022 Gas fund depletion attacks",
          "\u2022 Rapid withdrawal abuse",
          "\u2022 New account spam",
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }
    if (dailyCapHuman > 0) {
      const since = /* @__PURE__ */ new Date();
      since.setUTCHours(0, 0, 0, 0);
      const agg = await prisma.transaction.aggregate({
        where: {
          type: "WITHDRAW",
          userId: user.id,
          tokenId: token.id,
          createdAt: { gte: since }
        },
        _sum: { amount: true }
      });
      const alreadyToday = parseFloat(String(agg._sum.amount ?? "0"));
      if (alreadyToday + amount > dailyCapHuman) {
        const remaining = Math.max(0, dailyCapHuman - alreadyToday);
        return i.editReply({
          content: [
            "\u274C **Daily Limit Exceeded**",
            "",
            `This would exceed your daily cap. Remaining today: **${remaining} ${token.symbol}**`,
            "",
            policyLine
          ].join("\n"),
          components: []
        });
      }
    }
    const amtAtomic = toAtomicDirect(amount, token.decimals);
    await i.editReply({
      content: `${PENGUIN_LOADING.withdraw()}

**Token:** ${token.symbol}
**Amount:** ${formatAmount(amtAtomic, token)}
**Destination:** \`${user.agwAddress}\`

${policyLine}`,
      components: []
    });
    const { JsonRpcProvider, Wallet, Contract } = await import("ethers");
    const { TREASURY_AGW_ADDRESS } = await import("../../config.js");
    const { getAbstractRpcUrl } = await import("../../services/network.js");
    const { getSecureTreasuryPrivateKey } = await import("../../services/secure_key.js");
    const { debitToken } = await import("../../services/balances.js");
    const { queueNotice } = await import("../../services/notifier.js");
    const ERC20_ABI = [
      "function balanceOf(address) view returns (uint256)",
      "function transfer(address to, uint256 value) returns (bool)"
    ];
    const provider = new JsonRpcProvider(getAbstractRpcUrl());
    const signer = new Wallet(getSecureTreasuryPrivateKey(), provider);
    const signerAddr = (await signer.getAddress()).toLowerCase();
    if (signerAddr !== TREASURY_AGW_ADDRESS.toLowerCase()) {
      return i.editReply({
        content: [
          "\u274C **Treasury Configuration Error**",
          "",
          `Signer \`${signerAddr}\` != Treasury \`${TREASURY_AGW_ADDRESS}\``,
          "Please contact an administrator.",
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }
    const tokenContract = new Contract(token.address, ERC20_ABI, signer);
    const treasBal = await tokenContract.balanceOf(signerAddr);
    if (treasBal < amtAtomic) {
      return i.editReply({
        content: [
          "\u274C **Treasury Insufficient Funds**",
          "",
          `Treasury has insufficient ${token.symbol} for this withdrawal.`,
          `Treasury balance: ${formatAmount(treasBal, token)}`,
          "",
          "Please try again later or contact an administrator.",
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }
    try {
      const { executeAtomicWithdrawal } = await import("../../services/atomic_withdrawal.js");
      const atomicResult = await executeAtomicWithdrawal(
        {
          userId: user.id,
          tokenId,
          amountHuman: amount,
          destinationAddress: user.agwAddress,
          discordUserId: i.user.id,
          guildId: i.guildId,
          metadata: { source: "discord_withdrawal_button" }
        },
        token,
        tokenContract,
        signer
      );
      if (!atomicResult.success) {
        throw new Error(atomicResult.error || "Atomic withdrawal failed");
      }
      await withdrawalLimiter.recordSuccessfulWithdrawal(user.id, token.id, amount);
      await queueNotice(user.id, "withdraw_success", {
        token: token.symbol,
        amount: formatAmount(atomicResult.amountAtomic, token),
        tx: atomicResult.txHash
      });
      const cooldownInfo = limitCheck.cooldownMinutes && limitCheck.cooldownMinutes > 0 ? `

\u23F0 **Next withdrawal available:** ${limitCheck.nextAttemptAt?.toLocaleString() || "Unknown"}` : "";
      await i.editReply({
        content: [
          "\u2705 **Withdrawal Successful**",
          "",
          `**Amount:** ${formatAmount(atomicResult.amountAtomic, token)}`,
          `**Destination:** \`${user.agwAddress}\``,
          `**Transaction:** \`${atomicResult.txHash}\``,
          "",
          "Your tokens have been sent to your linked wallet!",
          cooldownInfo,
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    } catch (error) {
      await queueNotice(user.id, "withdraw_error", {
        reason: error?.reason || error?.message || String(error)
      });
      await i.editReply({
        content: [
          "\u274C **Withdrawal Failed**",
          "",
          `**Error:** ${error?.reason || error?.message || String(error)}`,
          "",
          "Your balance was protected by atomic operations. Please try again later.",
          "",
          policyLine
        ].join("\n"),
        components: []
      });
    }
  } catch (error) {
    console.error("Confirm withdraw error:", error);
    await i.editReply({
      content: `\u274C **Error**
${error?.message || String(error)}`,
      components: []
    });
  }
}
async function handleWithdrawCustom(i, parts) {
  try {
    const tokenId = parseInt(parts[2]);
    const [token, config] = await Promise.all([
      prisma.token.findUnique({ where: { id: tokenId } }),
      getAppConfig()
    ]);
    if (!token) {
      return i.reply({
        content: "\u274C **Error**\nToken not found.",
        flags: 64
      });
    }
    const minWithdraw = Number(token.minWithdraw);
    const maxPerTxHuman = token.withdrawMaxPerTx != null ? Number(token.withdrawMaxPerTx) : Number(config?.withdrawMaxPerTx ?? 0);
    const modal = new ModalBuilder().setCustomId(`pip:withdraw_custom_modal:${tokenId}`).setTitle(`\u{1F4AD} Withdraw ${token.symbol} - Custom Amount`);
    const amountInput = new TextInputBuilder().setCustomId("amount").setLabel("Enter withdrawal amount").setStyle(TextInputStyle.Short).setPlaceholder(`Min: ${minWithdraw}${maxPerTxHuman > 0 ? `, Max: ${maxPerTxHuman}` : ""}`).setRequired(true).setMinLength(1).setMaxLength(20);
    const actionRow = new ActionRowBuilder().addComponents(amountInput);
    modal.addComponents(actionRow);
    await i.showModal(modal);
  } catch (error) {
    console.error("Custom withdraw error:", error);
    await i.reply({
      content: `\u274C **Error**
${error?.message || String(error)}`,
      flags: 64
    }).catch(() => {
    });
  }
}
async function handleWithdrawCustomModal(i, parts) {
  await i.deferReply({ flags: 64 }).catch(() => {
  });
  try {
    const tokenId = parseInt(parts[2]);
    const amountInput = i.fields.getTextInputValue("amount");
    const amount = parseFloat(amountInput.trim());
    if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
      return i.editReply({
        content: [
          "\u274C **Invalid Amount**",
          "",
          `"${amountInput}" is not a valid number.`,
          "",
          "Please enter a positive number for the withdrawal amount."
        ].join("\n")
      });
    }
    const [token, config, user] = await Promise.all([
      prisma.token.findUnique({ where: { id: tokenId } }),
      getAppConfig(),
      prisma.user.findUnique({
        where: { discordId: i.user.id },
        select: { id: true, agwAddress: true }
      })
    ]);
    if (!token || !user) {
      return i.editReply({
        content: "\u274C **Error**\nToken or user not found."
      });
    }
    const minWithdraw = Number(token.minWithdraw);
    const maxPerTxHuman = token.withdrawMaxPerTx != null ? Number(token.withdrawMaxPerTx) : Number(config?.withdrawMaxPerTx ?? 0);
    if (amount < minWithdraw) {
      return i.editReply({
        content: [
          "\u274C **Amount Below Minimum**",
          "",
          `**Entered Amount:** ${amount} ${token.symbol}`,
          `**Minimum Required:** ${minWithdraw} ${token.symbol}`,
          "",
          "Please enter an amount that meets the minimum withdrawal requirement."
        ].join("\n")
      });
    }
    if (maxPerTxHuman > 0 && amount > maxPerTxHuman) {
      return i.editReply({
        content: [
          "\u274C **Amount Exceeds Maximum**",
          "",
          `**Entered Amount:** ${amount} ${token.symbol}`,
          `**Maximum Allowed:** ${maxPerTxHuman} ${token.symbol}`,
          "",
          "Please enter an amount within the withdrawal limits."
        ].join("\n")
      });
    }
    const userBalance = await prisma.userBalance.findUnique({
      where: { userId_tokenId: { userId: user.id, tokenId } }
    });
    const currentBalance = Number(userBalance?.amount || 0);
    if (amount > currentBalance) {
      return i.editReply({
        content: [
          "\u274C **Insufficient Balance**",
          "",
          `**Requested Amount:** ${amount} ${token.symbol}`,
          `**Available Balance:** ${currentBalance} ${token.symbol}`,
          "",
          "You don't have enough tokens for this withdrawal."
        ].join("\n")
      });
    }
    const customParts = ["pip", "withdraw_amount", tokenId.toString(), amount.toString()];
    const mockButtonInteraction = {
      ...i,
      deferUpdate: () => Promise.resolve(),
      editReply: i.editReply.bind(i),
      user: i.user,
      guildId: i.guildId
    };
    return handleWithdrawAmount(mockButtonInteraction, customParts);
  } catch (error) {
    console.error("Custom withdraw modal error:", error);
    await i.editReply({
      content: `\u274C **Error**
${error?.message || String(error)}`
    }).catch(() => {
    });
  }
}
async function handleBackToWithdraw(i) {
  await i.deferUpdate().catch(() => {
  });
  try {
    const user = await prisma.user.findUnique({
      where: { discordId: i.user.id },
      select: { id: true, agwAddress: true }
    });
    if (!user) {
      return i.editReply({
        content: "\u274C **Error**\nUser account not found.",
        components: []
      });
    }
    if (!user.agwAddress) {
      return i.editReply({
        content: "\u274C **Wallet not linked**\nPlease link your wallet first using `/pip_link`.",
        components: []
      });
    }
    const holdings = await prisma.userBalance.findMany({
      where: {
        userId: user.id,
        amount: { gt: 0 }
      },
      include: { Token: true },
      orderBy: { amount: "desc" }
    });
    if (holdings.length === 0) {
      return i.editReply({
        content: [
          "\u{1F4B0} **No Holdings to Withdraw**",
          "",
          "You don't have any tokens in your account to withdraw.",
          "",
          "**To get tokens:**",
          "\u2022 Use `/pip_deposit` to add funds",
          "\u2022 Receive tips from other users",
          "\u2022 Win games with `/pip_game`"
        ].join("\n"),
        components: []
      });
    }
    const embed = new EmbedBuilder().setTitle("\u{1F4B8} Withdraw Your Tokens").setDescription([
      `**Your Linked Wallet:** \`${user.agwAddress}\``,
      "",
      "**Your Holdings:**",
      holdings.map((holding) => {
        const balance = formatDecimal(holding.amount, holding.Token.symbol);
        return `\u2022 **${balance}** ${holding.Token.symbol}`;
      }).join("\n"),
      "",
      "\u{1FA99} **Select a token below to withdraw:**"
    ].join("\n")).setColor(65280).setFooter({ text: "Click a token to continue with withdrawal" }).setTimestamp();
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
    await i.editReply({
      embeds: [embed],
      components: actionRows
    });
  } catch (error) {
    console.error("Back to withdraw error:", error);
    await i.editReply({
      content: `\u274C **Error**
${error?.message || String(error)}`,
      components: []
    });
  }
}
export {
  handleBackToWithdraw,
  handleCancelWithdraw,
  handleConfirmWithdraw,
  handleWithdrawAmount,
  handleWithdrawCustom,
  handleWithdrawCustomModal,
  handleWithdrawToken
};
//# sourceMappingURL=withdrawals.js.map
