import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { predictionMarkets } from "../services/prediction_markets.js";
import { marketConfig } from "../services/market_config.js";
export default async function pipMarkets(i) {
    try {
        if (!i.guildId) {
            return i.reply({
                content: "❌ This command can only be used in a server!",
                ephemeral: true
            });
        }
        await i.deferReply();
        // Get active markets for this guild
        const markets = await predictionMarkets.getActiveMarkets(i.guildId);
        if (markets.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle("📊 Prediction Markets")
                .setDescription("No active prediction markets in this server.\n\nUse `/pip_create_market` to create one!")
                .setColor(0x3B82F6)
                .addFields({
                name: "🚀 Quick Start",
                value: "• `/pip_create_market` - Create a new market\n• `/pip_quick_market` - Use a template\n• `/pip_bet` - Make predictions on existing markets"
            });
            const row = new ActionRowBuilder()
                .addComponents(new ButtonBuilder()
                .setCustomId("create_market")
                .setLabel("Create Market")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("📊"));
            return i.editReply({ embeds: [embed], components: [row] });
        }
        // Create embed with active markets
        const embed = new EmbedBuilder()
            .setTitle("📊 Active Prediction Markets")
            .setDescription(`${markets.length} active market${markets.length === 1 ? '' : 's'} in this server`)
            .setColor(0x3B82F6);
        // Add market info (limit to first 5 for embed space)
        const displayMarkets = markets.slice(0, 5);
        for (const market of displayMarkets) {
            const odds = predictionMarkets.calculateOdds(market);
            const totalPool = market.totalYesBets + market.totalNoBets;
            const timeLeft = Math.max(0, market.resolveAt.getTime() - Date.now());
            const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
            let oddsText = "No bets yet";
            if (totalPool > 0) {
                oddsText = `YES: ${odds.yesOdds.toFixed(2)}x (${(odds.yesImpliedProb * 100).toFixed(1)}%) | NO: ${odds.noOdds.toFixed(2)}x (${(odds.noImpliedProb * 100).toFixed(1)}%)`;
            }
            // Different display for sports markets
            let marketInfo = [
                `**Pool:** ${totalPool} ${market.tokenSymbol} | **Bets:** ${market.totalBetCount}`,
                `**Odds:** ${oddsText}`,
                `**Expires:** ${hoursLeft > 0 ? `${hoursLeft}h` : 'Soon'} | **ID:** \`${market.id.slice(-8)}\``
            ];
            // Add sports-specific info
            if (marketConfig.isSportsMarket(market.marketType)) {
                const marketData = market.marketData;
                let gameInfo = "";
                if (marketData.homeTeam && marketData.awayTeam) {
                    gameInfo = `**Game:** ${marketData.homeTeam} vs ${marketData.awayTeam}`;
                }
                if (marketData.eventId) {
                    gameInfo += ` | **Event ID:** ${marketData.eventId}`;
                }
                if (gameInfo) {
                    marketInfo.splice(1, 0, gameInfo); // Insert after pool info
                }
            }
            embed.addFields({
                name: `${market.title}`,
                value: marketInfo.join('\n'),
                inline: false
            });
        }
        if (markets.length > 5) {
            embed.setFooter({ text: `Showing 5 of ${markets.length} markets. Use market ID to make predictions on specific markets.` });
        }
        // Add action buttons
        const row = new ActionRowBuilder()
            .addComponents(new ButtonBuilder()
            .setCustomId("refresh_markets")
            .setLabel("Refresh")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🔄"), new ButtonBuilder()
            .setCustomId("create_market")
            .setLabel("Create Market")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("📊"), new ButtonBuilder()
            .setCustomId("my_bets")
            .setLabel("My Predictions")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("💰"));
        await i.editReply({ embeds: [embed], components: [row] });
    }
    catch (error) {
        console.error("Markets command error:", error);
        await i.editReply({
            content: `❌ **Error loading markets**\n${error?.message || String(error)}`
        });
    }
}
