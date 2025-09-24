// src/commands/pip_bet.ts - Place bets on prediction markets
import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { predictionMarkets } from "../services/prediction_markets.js";
import { marketConfig } from "../services/market_config.js";

export default async function pipBet(i: ChatInputCommandInteraction) {
  try {
    if (!i.guildId) {
      return i.reply({
        content: "❌ This command can only be used in a server!",
        ephemeral: true
      });
    }

    const marketId = i.options.getString("market_id", true);
    const side = i.options.getString("side", true) as 'YES' | 'NO';
    const amount = i.options.getInteger("amount", true);

    await i.deferReply({ ephemeral: true });

    // Validate inputs
    if (!['YES', 'NO'].includes(side.toUpperCase())) {
      return i.editReply({
        content: "❌ Side must be either `YES` or `NO`"
      });
    }

    // Get market
    const market = await predictionMarkets.getMarket(marketId);
    if (!market) {
      return i.editReply({
        content: "❌ Market not found. Use `/pip_markets` to see active markets."
      });
    }

    // Check if market is in this guild
    if (market.guildId !== i.guildId) {
      return i.editReply({
        content: "❌ That market is not in this server."
      });
    }

    // Validate bet parameters
    const validation = marketConfig.validateMarketParams({
      duration: 0, // Not relevant for betting
      betAmount: amount,
      token: market.tokenSymbol
    });

    if (!validation.valid) {
      return i.editReply({
        content: `❌ ${validation.error}`
      });
    }

    // Place the bet
    const betResult = await predictionMarkets.placeBet({
      marketId,
      userId: i.user.id,
      side: side.toUpperCase() as 'YES' | 'NO',
      amount
    });

    if (!betResult.success) {
      return i.editReply({
        content: `❌ **Bet Failed**\n${betResult.error}`
      });
    }

    const updatedMarket = betResult.market!;
    const odds = predictionMarkets.calculateOdds(updatedMarket);
    const totalPool = updatedMarket.totalYesBets + updatedMarket.totalNoBets;

    // Create success embed
    const embed = new EmbedBuilder()
      .setTitle("✅ Bet Placed Successfully!")
      .setDescription(`**${updatedMarket.title}**`)
      .setColor(0x10B981)
      .addFields(
        {
          name: "📊 Your Bet",
          value: [
            `**Side:** ${side.toUpperCase()}`,
            `**Amount:** ${amount} ${market.tokenSymbol}`,
            `**Potential Return:** ${(amount * (side.toUpperCase() === 'YES' ? odds.yesOdds : odds.noOdds)).toFixed(0)} ${market.tokenSymbol}`
          ].join('\n'),
          inline: true
        },
        {
          name: "💰 Market Pool",
          value: [
            `**Total Pool:** ${totalPool} ${market.tokenSymbol}`,
            `**Total Bets:** ${updatedMarket.totalBetCount}`,
            `**YES Pool:** ${updatedMarket.totalYesBets} ${market.tokenSymbol}`,
            `**NO Pool:** ${updatedMarket.totalNoBets} ${market.tokenSymbol}`
          ].join('\n'),
          inline: true
        },
        {
          name: "📈 Current Odds",
          value: [
            `**YES:** ${odds.yesOdds.toFixed(2)}x (${(odds.yesImpliedProb * 100).toFixed(1)}%)`,
            `**NO:** ${odds.noOdds.toFixed(2)}x (${(odds.noImpliedProb * 100).toFixed(1)}%)`,
            `**House Rake:** ${market.rakePercentage}%`
          ].join('\n'),
          inline: false
        }
      );

    // Calculate time until resolution
    const timeLeft = Math.max(0, market.resolveAt.getTime() - Date.now());
    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    if (hoursLeft > 0) {
      embed.setFooter({ text: `Market resolves in ${hoursLeft}h ${minutesLeft}m` });
    } else if (minutesLeft > 0) {
      embed.setFooter({ text: `Market resolves in ${minutesLeft} minutes` });
    } else {
      embed.setFooter({ text: "Market resolves soon" });
    }

    // Add action buttons
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`view_market:${marketId}`)
          .setLabel("View Market")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("📊"),
        new ButtonBuilder()
          .setCustomId("my_bets")
          .setLabel("My Bets")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("💰")
      );

    await i.editReply({ embeds: [embed], components: [row] });

  } catch (error: any) {
    console.error("Bet command error:", error);
    await i.editReply({
      content: `❌ **Error placing bet**\n${error?.message || String(error)}`
    });
  }
}