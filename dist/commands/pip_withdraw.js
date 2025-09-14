// src/commands/pip_withdraw.ts - Interactive withdraw interface
import { MessageFlags } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { prisma } from "../services/db.js";
import { formatDecimal } from "../services/token.js";
export default async function pipWithdraw(i) {
    try {
        // Check for emergency mode
        const config = await prisma.appConfig.findFirst();
        if (config?.withdrawalsPaused || config?.emergencyMode) {
            return i.reply({
                content: [
                    "🚨 **Withdrawals Temporarily Disabled**",
                    "",
                    "Withdrawals are currently paused for maintenance.",
                    "Please try again later or contact support if this is urgent.",
                    "",
                    "All other bot functions remain available."
                ].join("\n"),
                flags: MessageFlags.Ephemeral
            });
        }
        // Check if user has account
        const user = await prisma.user.findUnique({
            where: { discordId: i.user.id },
            select: { id: true, agwAddress: true }
        });
        if (!user) {
            return i.reply({
                content: [
                    "❌ **No Account Found**",
                    "",
                    "You need to create an account first.",
                    "",
                    "Use `/pip_profile` to view your account!"
                ].join("\n"),
                flags: MessageFlags.Ephemeral
            });
        }
        // Check if user has linked wallet
        if (!user.agwAddress) {
            const walletRow = new ActionRowBuilder()
                .addComponents(new ButtonBuilder()
                .setLabel("🌐 Get Abstract Wallet")
                .setStyle(ButtonStyle.Link)
                .setURL("https://abs.xyz"), new ButtonBuilder()
                .setCustomId("pip:prompt_link_wallet")
                .setLabel("🔗 Link My Wallet")
                .setStyle(ButtonStyle.Primary), new ButtonBuilder()
                .setCustomId("pip:show_help")
                .setLabel("📚 Get Help")
                .setStyle(ButtonStyle.Secondary));
            return i.reply({
                content: [
                    "❌ **Wallet Not Linked**",
                    "",
                    "You need to link your wallet before withdrawing.",
                    "Your tokens are safe in your account, but you need a wallet to withdraw them.",
                    "",
                    "**Don't have an Abstract wallet?**",
                    "Click the button below to get one free!",
                    "",
                    "**Already have a wallet?**",
                    "Use the Link Wallet button for instructions.",
                    "",
                    "💡 *Once linked, you can withdraw your tokens!*"
                ].join("\n"),
                components: [walletRow],
                flags: MessageFlags.Ephemeral
            });
        }
        // Get user's token holdings
        const holdings = await prisma.userBalance.findMany({
            where: {
                userId: user.id,
                amount: { gt: 0 } // Only show tokens with positive balance
            },
            include: { Token: true },
            orderBy: { amount: 'desc' }
        });
        if (holdings.length === 0) {
            return i.reply({
                content: [
                    "💰 **No Holdings to Withdraw**",
                    "",
                    "You don't have any tokens in your account to withdraw.",
                    "",
                    "**To get tokens:**",
                    "• Use `/pip_deposit` to add funds",
                    "• Receive tips from other users",
                    "• Win games with `/pip_game`",
                    "",
                    "💡 *Once you have tokens, they'll appear here for withdrawal!*"
                ].join("\n"),
                flags: MessageFlags.Ephemeral
            });
        }
        // Get comprehensive withdrawal status for transparency
        const withdrawalStatus = await getWithdrawalStatusDisplay(user.id, holdings);
        // Create holdings display embed with withdrawal transparency
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
            "💰 **Your Withdrawal Status:**",
            withdrawalStatus,
            "",
            "🪙 **Select a token below to withdraw:**"
        ].join("\n"))
            .setColor(0x00FF00)
            .setFooter({ text: "All limits are to prevent abuse and protect the platform" })
            .setTimestamp();
        // Create token selection buttons
        const tokenButtons = [];
        const maxButtons = Math.min(holdings.length, 15); // Discord limit
        for (let i = 0; i < maxButtons; i++) {
            const holding = holdings[i];
            const balance = formatDecimal(holding.amount, holding.Token.symbol);
            tokenButtons.push(new ButtonBuilder()
                .setCustomId(`pip:withdraw_token:${holding.Token.id}`)
                .setLabel(`${holding.Token.symbol} (${balance})`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji("💰"));
        }
        // Organize buttons into rows (max 5 per row)
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
        await i.reply({
            embeds: [embed],
            components: actionRows,
            flags: MessageFlags.Ephemeral
        });
    }
    catch (error) {
        console.error("Withdraw command error:", error);
        await i.reply({
            content: `❌ **Error loading withdraw interface**\n${error?.message || String(error)}`,
            flags: MessageFlags.Ephemeral
        }).catch(() => { });
    }
}
/**
 * Get comprehensive withdrawal status display for user transparency
 */
async function getWithdrawalStatusDisplay(userId, holdings) {
    try {
        // Get user account age
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { createdAt: true }
        });
        if (!user)
            return "• Status: Unknown user";
        const accountAgeDays = Math.floor((Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000));
        // Determine daily limits based on account age
        let maxWithdrawalsPerDay;
        let accountTier;
        if (accountAgeDays < 1) {
            maxWithdrawalsPerDay = 1;
            accountTier = "New (< 1 day)";
        }
        else if (accountAgeDays < 7) {
            maxWithdrawalsPerDay = 2;
            accountTier = "Recent (< 1 week)";
        }
        else if (accountAgeDays < 30) {
            maxWithdrawalsPerDay = 3;
            accountTier = "Established (< 1 month)";
        }
        else {
            maxWithdrawalsPerDay = 5;
            accountTier = "Mature (1+ month)";
        }
        // Get recent withdrawals (last 24 hours)
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentWithdrawals = await prisma.transaction.findMany({
            where: {
                userId,
                type: 'WITHDRAW',
                createdAt: { gte: twentyFourHoursAgo }
            },
            include: { Token: true },
            orderBy: { createdAt: 'desc' }
        });
        const withdrawalsUsed = recentWithdrawals.length;
        const timeUntilReset = 24 - Math.floor((Date.now() - twentyFourHoursAgo.getTime()) / (60 * 60 * 1000));
        // Get token-specific withdrawal counts
        const tokenWithdrawals = new Map();
        recentWithdrawals.forEach(w => {
            if (w.tokenId) {
                tokenWithdrawals.set(w.tokenId, (tokenWithdrawals.get(w.tokenId) || 0) + 1);
            }
        });
        // Get minimum withdrawal amounts for each token
        const tokens = await prisma.token.findMany({
            where: {
                id: { in: holdings.map(h => h.Token.id) },
                active: true
            },
            select: { id: true, symbol: true, minWithdraw: true }
        });
        const status = [
            `• Account tier: **${accountTier}** (${accountAgeDays} days old)`,
            `• Daily limit: **${withdrawalsUsed} of ${maxWithdrawalsPerDay}** withdrawals used (resets in ${timeUntilReset}h)`,
        ];
        // Show cooldown information if user has recent withdrawals
        if (withdrawalsUsed > 0) {
            const lastWithdrawal = recentWithdrawals[0];
            const timeSinceLastMs = Date.now() - lastWithdrawal.createdAt.getTime();
            const timeSinceLastHours = Math.floor(timeSinceLastMs / (60 * 60 * 1000));
            const timeSinceLastMins = Math.floor((timeSinceLastMs % (60 * 60 * 1000)) / (60 * 1000));
            // Calculate potential cooldown for next withdrawal
            let nextCooldownMins = 0;
            if (withdrawalsUsed >= 2) {
                nextCooldownMins = (withdrawalsUsed - 1) * 30; // Progressive cooldown
            }
            if (nextCooldownMins > 0) {
                status.push(`• Cooldown: Next withdrawal available in **${nextCooldownMins} minutes** (progressive limit)`);
            }
            else {
                status.push(`• Cooldown: **None** (last withdrawal ${timeSinceLastHours}h ${timeSinceLastMins}m ago)`);
            }
        }
        else {
            status.push(`• Cooldown: **None** (no recent withdrawals)`);
        }
        // Amount-based cooldown tiers
        status.push(`• Quick withdrawals: **< 10** (instant) | **10-100** (1hr) | **100+** (6hr)`);
        // Minimum withdrawal amounts
        const minimums = tokens.map(t => `${t.symbol} (${Number(t.minWithdraw)} min)`).join(', ');
        if (minimums) {
            status.push(`• Minimum amounts: ${minimums}`);
        }
        // Per-token limits
        const tokenLimits = tokens.map(token => {
            const used = tokenWithdrawals.get(token.id) || 0;
            const remaining = Math.max(0, 3 - used);
            return `${token.symbol} (${used}/3 today)`;
        }).join(', ');
        if (tokenLimits) {
            status.push(`• Per-token today: ${tokenLimits}`);
        }
        return status.join('\n');
    }
    catch (error) {
        console.error('Error getting withdrawal status:', error);
        return "• Status: Unable to load withdrawal information";
    }
}
