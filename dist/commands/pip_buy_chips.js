import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { ensureUser, getCachedUserBalanceByDiscord, getTokenByAddress } from "../services/balances.js";
import { prisma } from "../services/db.js";
export default async function pipBuyChips(i) {
    try {
        const amount = i.options.getInteger("amount", true);
        const token = i.options.getString("token", true);
        await i.deferReply({ ephemeral: true });
        // Ensure user exists in database
        await ensureUser(i.user.id);
        // Get available PIPChips packages from database
        const packages = await prisma.pipchipsPackage.findMany({
            where: {
                isActive: true,
                tokenSymbol: token.toUpperCase()
            },
            orderBy: { pipchipsAmount: 'asc' }
        });
        if (packages.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle("❌ No Packages Available")
                .setDescription(`No PIPChips packages are currently available for ${token.toUpperCase()}.`)
                .setColor(0xEF4444)
                .addFields({
                name: "💡 Alternative Options",
                value: [
                    "• Try a different token",
                    "• Claim your daily bonus with `/pip_daily`",
                    "• Check back later for new packages"
                ].join('\n')
            });
            return i.editReply({ embeds: [embed] });
        }
        // Check if user specified an exact amount
        const matchingPackage = packages.find(pkg => pkg.pipchipsAmount === BigInt(amount));
        if (matchingPackage) {
            // Show specific package details for purchase
            const tokenInfo = await getTokenByAddress(token.toUpperCase());
            const userBalance = await getCachedUserBalanceByDiscord(i.user.id, tokenInfo.id);
            const canPurchase = userBalance >= Number(matchingPackage.tokenCost);
            const embed = new EmbedBuilder()
                .setTitle("💰 PIPChips Package")
                .setDescription(`Ready to purchase **${amount.toLocaleString()}** PIPChips?`)
                .setColor(canPurchase ? 0x10B981 : 0xEF4444)
                .addFields({
                name: "📦 Package Details",
                value: [
                    `**PIPChips:** ${matchingPackage.pipchipsAmount.toLocaleString()}`,
                    `**Cost:** ${Number(matchingPackage.tokenCost)} ${token.toUpperCase()}`,
                    `**Bonus:** ${matchingPackage.bonusPercentage}% extra chips`,
                    `**Total Value:** ${(matchingPackage.pipchipsAmount * BigInt(100 + matchingPackage.bonusPercentage) / BigInt(100)).toLocaleString()} PIPChips`
                ].join('\n'),
                inline: true
            }, {
                name: "💳 Your Balance",
                value: [
                    `**Available:** ${userBalance} ${token.toUpperCase()}`,
                    `**After Purchase:** ${Math.max(0, userBalance - Number(matchingPackage.tokenCost))} ${token.toUpperCase()}`
                ].join('\n'),
                inline: true
            });
            if (!canPurchase) {
                embed.addFields({
                    name: "❌ Insufficient Funds",
                    value: `You need ${Number(matchingPackage.tokenCost) - userBalance} more ${token.toUpperCase()} to purchase this package.`,
                    inline: false
                });
            }
            const row = new ActionRowBuilder()
                .addComponents(new ButtonBuilder()
                .setCustomId(`purchase_chips:${matchingPackage.id}`)
                .setLabel(canPurchase ? "Confirm Purchase" : "Insufficient Funds")
                .setStyle(canPurchase ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji(canPurchase ? "✅" : "❌")
                .setDisabled(!canPurchase), new ButtonBuilder()
                .setCustomId("view_all_packages")
                .setLabel("View All Packages")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("📦"), new ButtonBuilder()
                .setCustomId("deposit_funds")
                .setLabel("Add Funds")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("💰"));
            return i.editReply({ embeds: [embed], components: [row] });
        }
        // Show all available packages if no specific amount matched
        const embed = new EmbedBuilder()
            .setTitle(`💰 PIPChips Packages - ${token.toUpperCase()}`)
            .setDescription("Choose a package to purchase PIPChips with your tokens!")
            .setColor(0x3B82F6);
        // Display packages (limit to top 5 to fit in embed)
        const displayPackages = packages.slice(0, 5);
        for (const pkg of displayPackages) {
            const totalValue = pkg.pipchipsAmount * BigInt(100 + pkg.bonusPercentage) / BigInt(100);
            const savings = pkg.bonusPercentage > 0 ? ` (+${pkg.bonusPercentage}% bonus!)` : '';
            embed.addFields({
                name: `${pkg.pipchipsAmount.toLocaleString()} PIPChips${savings}`,
                value: [
                    `**Cost:** ${Number(pkg.tokenCost)} ${token.toUpperCase()}`,
                    `**Total Value:** ${totalValue.toLocaleString()} PIPChips`,
                    `**Package ID:** \`${pkg.id}\``
                ].join('\n'),
                inline: true
            });
        }
        if (packages.length > 5) {
            embed.setFooter({ text: `Showing 5 of ${packages.length} packages. Use /buy_chips amount:X to see specific packages.` });
        }
        // Get user's current balance for the token
        const tokenInfo = await getTokenByAddress(token.toUpperCase());
        const userBalance = await getCachedUserBalanceByDiscord(i.user.id, tokenInfo.id);
        embed.addFields({
            name: "💳 Your Balance",
            value: `**${userBalance}** ${token.toUpperCase()}`,
            inline: false
        });
        // Action buttons with popular package options
        const buttons = [];
        if (displayPackages.length > 0) {
            // Add quick purchase buttons for first 3 packages
            for (let i = 0; i < Math.min(3, displayPackages.length); i++) {
                const pkg = displayPackages[i];
                const canAfford = userBalance >= Number(pkg.tokenCost);
                buttons.push(new ButtonBuilder()
                    .setCustomId(`purchase_chips:${pkg.id}`)
                    .setLabel(`${pkg.pipchipsAmount.toLocaleString()} Chips`)
                    .setStyle(canAfford ? ButtonStyle.Success : ButtonStyle.Secondary)
                    .setDisabled(!canAfford));
            }
        }
        // Add utility buttons
        buttons.push(new ButtonBuilder()
            .setCustomId("deposit_funds")
            .setLabel("Add Funds")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("💰"));
        const row = new ActionRowBuilder().addComponents(...buttons);
        await i.editReply({ embeds: [embed], components: [row] });
    }
    catch (error) {
        console.error("Buy chips command error:", error);
        if (i.deferred) {
            await i.editReply({
                content: `❌ **Error loading PIPChips packages**\n${error?.message || String(error)}`
            });
        }
        else {
            await i.reply({
                content: `❌ **Error loading PIPChips packages**\n${error?.message || String(error)}`,
                ephemeral: true
            });
        }
    }
}
