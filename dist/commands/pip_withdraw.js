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
        // Create holdings display embed
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
