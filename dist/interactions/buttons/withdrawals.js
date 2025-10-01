import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } from "discord.js";
import { prisma } from "../../services/db.js";
import { formatAmount, formatDecimal, toAtomicDirect } from "../../services/token.js";
import { withdrawalLimiter } from "../../services/withdrawal_limiter.js";
import { PENGUIN_LOADING } from "../../utils/penguin_messages.js";
import { getAppConfig } from "../../services/app_config_cache.js";
export async function handleWithdrawToken(i, parts) {
    await i.deferUpdate().catch(() => { });
    try {
        const tokenId = parseInt(parts[2]);
        // Get token and user details
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
                content: "❌ **Error**\nToken or balance not found.",
                components: []
            });
        }
        if (!user.agwAddress) {
            return i.editReply({
                content: "❌ **Wallet not linked**\nPlease link your wallet first using `/pip_link`.",
                components: []
            });
        }
        const balance = formatDecimal(holding.amount, token.symbol);
        const maxAmount = Number(holding.amount);
        // Get withdrawal limits and config (cached)
        const config = await getAppConfig();
        const minWithdraw = Number(token.minWithdraw);
        const maxPerTxHuman = token.withdrawMaxPerTx != null
            ? Number(token.withdrawMaxPerTx)
            : Number(config?.withdrawMaxPerTx ?? 0);
        // Calculate effective maximum (considering limits and balance)
        const effectiveMax = maxPerTxHuman > 0
            ? Math.min(maxAmount, maxPerTxHuman)
            : maxAmount;
        // Check if withdrawal is even possible
        if (maxAmount < minWithdraw) {
            const errorButtonRow = new ActionRowBuilder()
                .addComponents(new ButtonBuilder()
                .setCustomId("pip:back_to_withdraw")
                .setLabel("⬅️ Back to Holdings")
                .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
                .setCustomId("pip:show_deposit_instructions")
                .setLabel("💰 Add Funds")
                .setStyle(ButtonStyle.Primary), new ButtonBuilder()
                .setCustomId("pip:cancel_withdraw")
                .setLabel("❌ Cancel")
                .setStyle(ButtonStyle.Secondary));
            return i.editReply({
                content: [
                    "❌ **Insufficient Balance for Withdrawal**",
                    "",
                    `**Your Balance:** ${balance} ${token.symbol}`,
                    `**Minimum Withdrawal:** ${minWithdraw} ${token.symbol}`,
                    "",
                    "You need more tokens before you can withdraw.",
                    "",
                    "**To get more tokens:**",
                    "• Use `/pip_deposit` to add funds",
                    "• Receive tips from other users",
                    "• Win games with `/pip_game`"
                ].join("\n"),
                components: [errorButtonRow]
            });
        }
        if (effectiveMax < minWithdraw) {
            const limitErrorButtonRow = new ActionRowBuilder()
                .addComponents(new ButtonBuilder()
                .setCustomId("pip:back_to_withdraw")
                .setLabel("⬅️ Back to Holdings")
                .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
                .setCustomId("pip:show_help")
                .setLabel("📚 Get Help")
                .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
                .setCustomId("pip:cancel_withdraw")
                .setLabel("❌ Cancel")
                .setStyle(ButtonStyle.Secondary));
            return i.editReply({
                content: [
                    "❌ **Cannot Withdraw Due to Limits**",
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
        // Create withdrawal limits info for embed
        const maxLine = maxPerTxHuman > 0 ? `max per tx ${maxPerTxHuman} ${token.symbol}` : "no per-tx max";
        const limitsText = `**Limits:** min ${minWithdraw} · ${maxLine}`;
        // Create withdrawal amount input embed
        const embed = new EmbedBuilder()
            .setTitle(`💸 Withdraw ${token.symbol}`)
            .setDescription([
            `**Available Balance:** ${balance} ${token.symbol}`,
            `**Destination:** \`${user.agwAddress}\``,
            "",
            limitsText,
            "",
            "**How much would you like to withdraw?**",
            "",
            "💡 *Click a button below or use the custom amount option*"
        ].join("\n"))
            .setColor(0x00FF00)
            .setFooter({ text: "Withdrawals are sent directly to your linked wallet" })
            .setTimestamp();
        // Create preset amount buttons - only valid amounts
        const presetAmounts = [];
        // Add common amounts only if they meet requirements
        const commonAmounts = [50, 100, 250, 500, 1000, 2500, 5000];
        for (const amount of commonAmounts) {
            if (amount >= minWithdraw &&
                amount <= effectiveMax &&
                amount <= maxAmount) {
                presetAmounts.push(amount);
            }
        }
        // Add percentage-based options
        const percentages = [0.25, 0.5, 1.0];
        for (const pct of percentages) {
            const amount = Math.floor(effectiveMax * pct);
            if (amount >= minWithdraw && amount > 0) {
                presetAmounts.push(amount);
            }
        }
        // Always add the minimum if not already present
        if (minWithdraw <= effectiveMax && !presetAmounts.includes(minWithdraw)) {
            presetAmounts.unshift(minWithdraw);
        }
        // Remove duplicates and sort
        const uniqueAmounts = Array.from(new Set(presetAmounts)).filter(amt => amt > 0).sort((a, b) => a - b);
        const amountButtons = [];
        for (const amount of uniqueAmounts.slice(0, 8)) { // Max 8 preset buttons
            // Calculate percentage labels based on effective max
            let percentage = "";
            if (amount === effectiveMax || amount === maxAmount) {
                percentage = " (Max)";
            }
            else if (amount === Math.floor(effectiveMax * 0.5)) {
                percentage = " (Half)";
            }
            else if (amount === Math.floor(effectiveMax * 0.25)) {
                percentage = " (25%)";
            }
            else if (amount === minWithdraw) {
                percentage = " (Min)";
            }
            amountButtons.push(new ButtonBuilder()
                .setCustomId(`pip:withdraw_amount:${tokenId}:${amount}`)
                .setLabel(`${amount}${percentage}`)
                .setStyle((amount === effectiveMax || amount === maxAmount) ? ButtonStyle.Danger : ButtonStyle.Primary)
                .setEmoji("💰"));
        }
        // Organize amount buttons into rows
        const actionRows = [];
        for (let i = 0; i < amountButtons.length; i += 4) {
            const row = new ActionRowBuilder()
                .addComponents(amountButtons.slice(i, i + 4));
            actionRows.push(row);
        }
        // Add navigation buttons
        const navRow = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId(`pip:withdraw_custom:${tokenId}`)
            .setLabel("💭 Custom Amount")
            .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
            .setCustomId("pip:back_to_withdraw")
            .setLabel("⬅️ Back to Holdings")
            .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
            .setCustomId("pip:cancel_withdraw")
            .setLabel("❌ Cancel")
            .setStyle(ButtonStyle.Secondary));
        actionRows.push(navRow);
        await i.editReply({
            embeds: [embed],
            components: actionRows
        });
    }
    catch (error) {
        console.error("Withdraw token selection error:", error);
        await i.editReply({
            content: `❌ **Error**\n${error?.message || String(error)}`,
            components: []
        });
    }
}
export async function handleCancelWithdraw(i) {
    await i.deferUpdate().catch(() => { });
    try {
        await i.editReply({
            content: "❌ **Withdrawal cancelled**\n*Use `/pip_withdraw` to try again.*",
            components: []
        });
    }
    catch (error) {
        console.error("Cancel withdraw error:", error);
    }
}
export async function handleWithdrawAmount(i, parts) {
    await i.deferUpdate().catch(() => { });
    try {
        const tokenId = parseInt(parts[2]);
        const amount = parseInt(parts[3]);
        // Get user and token details
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
                content: "❌ **Error**\nUser, token, or balance not found.",
                components: []
            });
        }
        if (!user.agwAddress) {
            return i.editReply({
                content: "❌ **Wallet not linked**\nPlease link your wallet first using `/pip_link`.",
                components: []
            });
        }
        const currentBalance = Number(holding.amount);
        // Validate amount
        if (amount <= 0 || amount > currentBalance) {
            return i.editReply({
                content: [
                    "❌ **Invalid Amount**",
                    "",
                    `You requested to withdraw **${formatDecimal(amount, token.symbol)}** ${token.symbol}`,
                    `But your balance is only **${formatDecimal(currentBalance, token.symbol)}** ${token.symbol}`,
                    "",
                    "*Please select a valid amount from the options provided.*"
                ].join("\n"),
                components: []
            });
        }
        // Create confirmation embed
        const embed = new EmbedBuilder()
            .setTitle("⚠️ Confirm Withdrawal")
            .setDescription([
            `**Token:** ${token.symbol}`,
            `**Amount:** ${formatDecimal(amount, token.symbol)} ${token.symbol}`,
            `**Destination:** \`${user.agwAddress}\``,
            "",
            `**Remaining Balance:** ${formatDecimal(currentBalance - amount, token.symbol)} ${token.symbol}`,
            "",
            "⚠️ **This action cannot be undone**",
            "",
            "Click **Confirm** to proceed with the withdrawal."
        ].join("\n"))
            .setColor(0xFF6B35)
            .setFooter({ text: "Double-check your wallet address before confirming" })
            .setTimestamp();
        const confirmRow = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId(`pip:confirm_withdraw:${tokenId}:${amount}`)
            .setLabel("✅ Send My Fish Home!")
            .setStyle(ButtonStyle.Danger), new ButtonBuilder()
            .setCustomId(`pip:withdraw_token:${tokenId}`)
            .setLabel("⬅️ Back to Amounts")
            .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
            .setCustomId("pip:cancel_withdraw")
            .setLabel("❌ Cancel")
            .setStyle(ButtonStyle.Secondary));
        await i.editReply({
            embeds: [embed],
            components: [confirmRow]
        });
    }
    catch (error) {
        console.error("Withdraw amount selection error:", error);
        await i.editReply({
            content: `❌ **Error**\n${error?.message || String(error)}`,
            components: []
        });
    }
}
export async function handleConfirmWithdraw(i, parts) {
    await i.deferUpdate().catch(() => { });
    try {
        // Check for emergency mode first
        const emergencyConfig = await getAppConfig();
        if (emergencyConfig?.withdrawalsPaused || emergencyConfig?.emergencyMode) {
            return i.editReply({
                content: [
                    "🚨 **Withdrawals Temporarily Disabled**",
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
        // Get user, token, and config
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
                content: "❌ **Error**\nUser or token not found.",
                components: []
            });
        }
        if (!user.agwAddress) {
            return i.editReply({
                content: "❌ **Wallet not linked**\nPlease link your wallet first using `/pip_link`.",
                components: []
            });
        }
        // Check token is active
        if (!token.active) {
            return i.editReply({
                content: "❌ **Token Inactive**\nThis token is currently not available for withdrawals.",
                components: []
            });
        }
        // Get withdrawal limits
        const maxPerTxHuman = token.withdrawMaxPerTx != null
            ? Number(token.withdrawMaxPerTx)
            : Number(appConfig?.withdrawMaxPerTx ?? 0);
        const dailyCapHuman = token.withdrawDailyCap != null
            ? Number(token.withdrawDailyCap)
            : Number(appConfig?.withdrawDailyCap ?? 0);
        const maxLine = maxPerTxHuman > 0 ? `max per tx ${maxPerTxHuman} ${token.symbol}` : "no per-tx max";
        const dailyLine = dailyCapHuman > 0 ? `daily cap ${dailyCapHuman} ${token.symbol}` : "no daily cap";
        const policyLine = `⚠️ **Withdraw limits:** min ${token.minWithdraw} ${token.symbol} · ${maxLine} · ${dailyLine}`;
        // Validate amount against limits
        if (amount < Number(token.minWithdraw)) {
            return i.editReply({
                content: [
                    "❌ **Amount Below Minimum**",
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
                    "❌ **Amount Exceeds Maximum**",
                    "",
                    `Amount exceeds the per-transaction max: **${maxPerTxHuman} ${token.symbol}**`,
                    "",
                    policyLine
                ].join("\n"),
                components: []
            });
        }
        // Use comprehensive atomic withdrawal check (fixes race conditions)
        const { performComprehensiveWithdrawalCheck } = await import("../../services/atomic_withdrawal.js");
        const comprehensiveCheck = await performComprehensiveWithdrawalCheck(i.user.id, tokenId, amount);
        if (!comprehensiveCheck.canProceed) {
            return i.editReply({
                content: [
                    "❌ **Withdrawal Cannot Proceed**",
                    "",
                    `**Reason:** ${comprehensiveCheck.error}`,
                    "",
                    policyLine
                ].join("\n"),
                components: []
            });
        }
        // SECURITY: Check withdrawal limits with database-backed persistent tracking
        const limitCheck = await withdrawalLimiter.checkWithdrawalAllowed(user.id, token.id, amount);
        if (!limitCheck.allowed) {
            // SECURITY: Record blocked attempt in database (prevents concurrent bypass)
            await withdrawalLimiter.recordBlockedWithdrawal(user.id, token.id, amount, limitCheck.reason || 'Unknown', undefined, // IP address - could be added from request headers
            undefined // User agent - could be added from Discord client info
            );
            const cooldownMessage = limitCheck.cooldownMinutes
                ? `\n\n⏰ **Next attempt:** ${limitCheck.nextAttemptAt?.toLocaleString() || 'Unknown'}`
                : '';
            return i.editReply({
                content: [
                    "🚫 **Withdrawal Temporarily Blocked**",
                    "",
                    `**Reason:** ${limitCheck.reason}`,
                    cooldownMessage,
                    "",
                    "**This protects against:**",
                    "• Gas fund depletion attacks",
                    "• Rapid withdrawal abuse",
                    "• New account spam",
                    "",
                    policyLine
                ].join("\n"),
                components: []
            });
        }
        // Legacy daily cap check (kept for backward compatibility)
        if (dailyCapHuman > 0) {
            const since = new Date();
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
                        "❌ **Daily Limit Exceeded**",
                        "",
                        `This would exceed your daily cap. Remaining today: **${remaining} ${token.symbol}**`,
                        "",
                        policyLine
                    ].join("\n"),
                    components: []
                });
            }
        }
        // Convert amount to atomic units for blockchain operations
        const amtAtomic = toAtomicDirect(amount, token.decimals);
        // Update to processing state with penguin loading
        await i.editReply({
            content: `${PENGUIN_LOADING.withdraw()}\n\n**Token:** ${token.symbol}\n**Amount:** ${formatAmount(amtAtomic, token)}\n**Destination:** \`${user.agwAddress}\`\n\n${policyLine}`,
            components: []
        });
        // Import required modules for transaction processing
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
        // Setup blockchain connection
        const provider = new JsonRpcProvider(getAbstractRpcUrl());
        const signer = new Wallet(getSecureTreasuryPrivateKey(), provider);
        const signerAddr = (await signer.getAddress()).toLowerCase();
        if (signerAddr !== TREASURY_AGW_ADDRESS.toLowerCase()) {
            return i.editReply({
                content: [
                    "❌ **Treasury Configuration Error**",
                    "",
                    `Signer \`${signerAddr}\` != Treasury \`${TREASURY_AGW_ADDRESS}\``,
                    "Please contact an administrator.",
                    "",
                    policyLine
                ].join("\n"),
                components: []
            });
        }
        // Check treasury balance
        const tokenContract = new Contract(token.address, ERC20_ABI, signer);
        const treasBal = await tokenContract.balanceOf(signerAddr);
        if (treasBal < amtAtomic) {
            return i.editReply({
                content: [
                    "❌ **Treasury Insufficient Funds**",
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
            // Execute atomic withdrawal (fixes race conditions)
            const { executeAtomicWithdrawal } = await import("../../services/atomic_withdrawal.js");
            const atomicResult = await executeAtomicWithdrawal({
                userId: user.id,
                tokenId,
                amountHuman: amount,
                destinationAddress: user.agwAddress,
                discordUserId: i.user.id,
                guildId: i.guildId,
                metadata: { source: 'discord_withdrawal_button' }
            }, token, tokenContract, signer);
            if (!atomicResult.success) {
                throw new Error(atomicResult.error || 'Atomic withdrawal failed');
            }
            // Record successful withdrawal for tracking
            // SECURITY: Record successful withdrawal in database (persistent tracking)
            await withdrawalLimiter.recordSuccessfulWithdrawal(user.id, token.id, amount);
            // Queue success notification
            await queueNotice(user.id, "withdraw_success", {
                token: token.symbol,
                amount: formatAmount(atomicResult.amountAtomic, token),
                tx: atomicResult.txHash
            });
            // Add cooldown info to success message if applicable
            const cooldownInfo = limitCheck.cooldownMinutes && limitCheck.cooldownMinutes > 0
                ? `\n\n⏰ **Next withdrawal available:** ${limitCheck.nextAttemptAt?.toLocaleString() || 'Unknown'}`
                : '';
            // Success message
            await i.editReply({
                content: [
                    "✅ **Withdrawal Successful**",
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
        }
        catch (error) {
            // Queue error notification
            await queueNotice(user.id, "withdraw_error", {
                reason: error?.reason || error?.message || String(error)
            });
            await i.editReply({
                content: [
                    "❌ **Withdrawal Failed**",
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
    }
    catch (error) {
        console.error("Confirm withdraw error:", error);
        await i.editReply({
            content: `❌ **Error**\n${error?.message || String(error)}`,
            components: []
        });
    }
}
export async function handleWithdrawCustom(i, parts) {
    try {
        const tokenId = parseInt(parts[2]);
        // Get token info for limits
        const [token, config] = await Promise.all([
            prisma.token.findUnique({ where: { id: tokenId } }),
            getAppConfig()
        ]);
        if (!token) {
            return i.reply({
                content: "❌ **Error**\nToken not found.",
                flags: 64
            });
        }
        const minWithdraw = Number(token.minWithdraw);
        const maxPerTxHuman = token.withdrawMaxPerTx != null
            ? Number(token.withdrawMaxPerTx)
            : Number(config?.withdrawMaxPerTx ?? 0);
        // Create modal for custom amount input
        const modal = new ModalBuilder()
            .setCustomId(`pip:withdraw_custom_modal:${tokenId}`)
            .setTitle(`💭 Withdraw ${token.symbol} - Custom Amount`);
        const amountInput = new TextInputBuilder()
            .setCustomId("amount")
            .setLabel("Enter withdrawal amount")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`Min: ${minWithdraw}${maxPerTxHuman > 0 ? `, Max: ${maxPerTxHuman}` : ''}`)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(20);
        const actionRow = new ActionRowBuilder()
            .addComponents(amountInput);
        modal.addComponents(actionRow);
        await i.showModal(modal);
    }
    catch (error) {
        console.error("Custom withdraw error:", error);
        await i.reply({
            content: `❌ **Error**\n${error?.message || String(error)}`,
            flags: 64
        }).catch(() => { });
    }
}
export async function handleWithdrawCustomModal(i, parts) {
    await i.deferReply({ flags: 64 }).catch(() => { });
    try {
        const tokenId = parseInt(parts[2]);
        const amountInput = i.fields.getTextInputValue("amount");
        const amount = parseFloat(amountInput.trim());
        // Validate amount is a number
        if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
            return i.editReply({
                content: [
                    "❌ **Invalid Amount**",
                    "",
                    `"${amountInput}" is not a valid number.`,
                    "",
                    "Please enter a positive number for the withdrawal amount."
                ].join("\n")
            });
        }
        // Get token and config for validation
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
                content: "❌ **Error**\nToken or user not found."
            });
        }
        // Validate withdrawal limits BEFORE showing confirmation
        const minWithdraw = Number(token.minWithdraw);
        const maxPerTxHuman = token.withdrawMaxPerTx != null
            ? Number(token.withdrawMaxPerTx)
            : Number(config?.withdrawMaxPerTx ?? 0);
        // Check minimum withdrawal
        if (amount < minWithdraw) {
            return i.editReply({
                content: [
                    "❌ **Amount Below Minimum**",
                    "",
                    `**Entered Amount:** ${amount} ${token.symbol}`,
                    `**Minimum Required:** ${minWithdraw} ${token.symbol}`,
                    "",
                    "Please enter an amount that meets the minimum withdrawal requirement."
                ].join("\n")
            });
        }
        // Check maximum withdrawal
        if (maxPerTxHuman > 0 && amount > maxPerTxHuman) {
            return i.editReply({
                content: [
                    "❌ **Amount Exceeds Maximum**",
                    "",
                    `**Entered Amount:** ${amount} ${token.symbol}`,
                    `**Maximum Allowed:** ${maxPerTxHuman} ${token.symbol}`,
                    "",
                    "Please enter an amount within the withdrawal limits."
                ].join("\n")
            });
        }
        // Check user balance
        const userBalance = await prisma.userBalance.findUnique({
            where: { userId_tokenId: { userId: user.id, tokenId } }
        });
        const currentBalance = Number(userBalance?.amount || 0);
        if (amount > currentBalance) {
            return i.editReply({
                content: [
                    "❌ **Insufficient Balance**",
                    "",
                    `**Requested Amount:** ${amount} ${token.symbol}`,
                    `**Available Balance:** ${currentBalance} ${token.symbol}`,
                    "",
                    "You don't have enough tokens for this withdrawal."
                ].join("\n")
            });
        }
        // Use the same confirmation flow as preset amounts
        // Just redirect to the handleWithdrawAmount function with the custom amount
        const customParts = ["pip", "withdraw_amount", tokenId.toString(), amount.toString()];
        // Create a mock button interaction to reuse the existing confirmation flow
        const mockButtonInteraction = {
            ...i,
            deferUpdate: () => Promise.resolve(),
            editReply: i.editReply.bind(i),
            user: i.user,
            guildId: i.guildId
        };
        return handleWithdrawAmount(mockButtonInteraction, customParts);
    }
    catch (error) {
        console.error("Custom withdraw modal error:", error);
        await i.editReply({
            content: `❌ **Error**\n${error?.message || String(error)}`
        }).catch(() => { });
    }
}
export async function handleBackToWithdraw(i) {
    await i.deferUpdate().catch(() => { });
    try {
        // Regenerate the main withdraw interface by calling the original command logic
        const user = await prisma.user.findUnique({
            where: { discordId: i.user.id },
            select: { id: true, agwAddress: true }
        });
        if (!user) {
            return i.editReply({
                content: "❌ **Error**\nUser account not found.",
                components: []
            });
        }
        if (!user.agwAddress) {
            return i.editReply({
                content: "❌ **Wallet not linked**\nPlease link your wallet first using `/pip_link`.",
                components: []
            });
        }
        // Get user's token holdings
        const holdings = await prisma.userBalance.findMany({
            where: {
                userId: user.id,
                amount: { gt: 0 }
            },
            include: { Token: true },
            orderBy: { amount: 'desc' }
        });
        if (holdings.length === 0) {
            return i.editReply({
                content: [
                    "💰 **No Holdings to Withdraw**",
                    "",
                    "You don't have any tokens in your account to withdraw.",
                    "",
                    "**To get tokens:**",
                    "• Use `/pip_deposit` to add funds",
                    "• Receive tips from other users",
                    "• Win games with `/pip_game`"
                ].join("\n"),
                components: []
            });
        }
        // Recreate holdings display embed (same as original withdraw command)
        const embed = new EmbedBuilder()
            .setTitle("💸 Withdraw Your Tokens")
            .setDescription([
            `**Your Linked Wallet:** \`${user.agwAddress}\``,
            "",
            "**Your Holdings:**",
            holdings.map(holding => {
                const balance = formatDecimal(holding.amount, holding.Token.symbol);
                return `• **${balance}** ${holding.Token.symbol}`;
            }).join("\n"),
            "",
            "🪙 **Select a token below to withdraw:**"
        ].join("\n"))
            .setColor(0x00FF00)
            .setFooter({ text: "Click a token to continue with withdrawal" })
            .setTimestamp();
        // Recreate token selection buttons
        const tokenButtons = [];
        const maxButtons = Math.min(holdings.length, 15);
        for (let i = 0; i < maxButtons; i++) {
            const holding = holdings[i];
            const balance = formatDecimal(holding.amount, holding.Token.symbol);
            tokenButtons.push(new ButtonBuilder()
                .setCustomId(`pip:withdraw_token:${holding.Token.id}`)
                .setLabel(`${holding.Token.symbol} (${balance})`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji("💰"));
        }
        // Organize buttons into rows
        const actionRows = [];
        for (let i = 0; i < tokenButtons.length; i += 5) {
            const row = new ActionRowBuilder()
                .addComponents(tokenButtons.slice(i, i + 5));
            actionRows.push(row);
        }
        // Add action buttons
        const actionRow = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId("pip:view_profile")
            .setLabel("👤 View Profile")
            .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
            .setCustomId("pip:show_help")
            .setLabel("📚 Get Help")
            .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
            .setCustomId("pip:cancel_withdraw")
            .setLabel("❌ Cancel")
            .setStyle(ButtonStyle.Secondary));
        actionRows.push(actionRow);
        await i.editReply({
            embeds: [embed],
            components: actionRows
        });
    }
    catch (error) {
        console.error("Back to withdraw error:", error);
        await i.editReply({
            content: `❌ **Error**\n${error?.message || String(error)}`,
            components: []
        });
    }
}
