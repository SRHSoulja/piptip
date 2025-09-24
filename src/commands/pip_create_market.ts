// src/commands/pip_create_market.ts - Create new prediction markets
import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { predictionMarkets } from "../services/prediction_markets.js";
import { marketConfig } from "../services/market_config.js";
import { marketResolver } from "../services/market_resolver.js";
import { sportsResolver } from "../services/sports_resolver.js";
import { checkMarketCreationPermission } from "../services/tiers.js";

export default async function pipCreateMarket(i: ChatInputCommandInteraction) {
  try {
    if (!i.guildId) {
      return i.reply({
        content: "❌ This command can only be used in a server!",
        ephemeral: true
      });
    }

    const marketType = i.options.getString("type", true);
    const symbol = i.options.getString("symbol");
    const hoursUntilResolve = i.options.getInteger("hours", true);
    const token = i.options.getString("token", true);
    const targetPrice = i.options.getNumber("target_price");
    const targetRank = i.options.getInteger("target_rank");
    const chain = i.options.getString("chain");

    // Sports-specific options
    const teams = i.options.getString("teams");
    const betOn = i.options.getString("bet_on");
    const league = i.options.getString("league");
    const totalPoints = i.options.getNumber("total_points");
    const spreadPoints = i.options.getNumber("spread_points");

    await i.deferReply({ ephemeral: true });

    // Check tier permissions first
    const tierCheck = await checkMarketCreationPermission(i.user.id);
    if (!tierCheck.allowed) {
      return i.editReply({
        content: tierCheck.error || "❌ You don't have permission to create prediction markets"
      });
    }

    // Validate market type
    const template = marketConfig.getTemplate(marketType.toUpperCase());
    if (!template) {
      const availableTemplates = marketConfig.getAvailableTemplates();
      return i.editReply({
        content: `❌ Invalid market type. Available types:\n${availableTemplates.map(t => `• \`${t.key}\` - ${t.name}`).join('\n')}`
      });
    }

    // Validate required fields based on market type
    if (!marketConfig.isSportsMarket(marketType.toUpperCase())) {
      if (!symbol) {
        return i.editReply({
          content: "❌ Symbol is required for crypto/token markets"
        });
      }
    } else {
      // Sports market validations
      if (!teams || !betOn) {
        return i.editReply({
          content: "❌ Teams and bet_on are required for sports markets"
        });
      }
    }

    // Calculate resolve time
    const resolveAt = new Date(Date.now() + (hoursUntilResolve * 60 * 60 * 1000));

    // Validate parameters
    const validation = marketConfig.validateMarketParams({
      duration: hoursUntilResolve * 3600,
      token,
      chain: chain || undefined
    });

    if (!validation.valid) {
      return i.editReply({
        content: `❌ ${validation.error}`
      });
    }

    // Check user and guild limits
    const userActiveMarkets = await predictionMarkets.getUserActiveMarketCount(i.user.id);
    const userCheck = marketConfig.canUserCreateMarket(i.user.id, userActiveMarkets);
    if (!userCheck.allowed) {
      return i.editReply({
        content: `❌ ${userCheck.error}`
      });
    }

    const guildActiveMarkets = await predictionMarkets.getActiveMarkets(i.guildId);
    const guildCheck = marketConfig.canGuildCreateMarket(i.guildId, guildActiveMarkets.length);
    if (!guildCheck.allowed) {
      return i.editReply({
        content: `❌ ${guildCheck.error}`
      });
    }

    // Prepare market data based on type
    let marketData: any = {};
    let title = "";
    let description = "";

    // For non-sports markets, use symbol
    if (!marketConfig.isSportsMarket(marketType.toUpperCase())) {
      marketData.symbol = symbol!; // Already validated above
    }

    switch (marketType.toUpperCase()) {
      case 'PRICE_UP_DOWN':
        // Get current price for reference
        const currentPriceData = await marketResolver.fetchDexScreenerPrice(symbol!);
        if (!currentPriceData.success) {
          return i.editReply({
            content: `❌ Could not fetch current price for ${symbol}. Error: ${currentPriceData.error}`
          });
        }

        marketData.initialPrice = currentPriceData.price;
        title = `📈 Will ${symbol!.toUpperCase()} price go up?`;
        description = `Will ${symbol!.toUpperCase()} be higher than $${currentPriceData.price.toFixed(6)} in ${hoursUntilResolve} hours?`;
        break;

      case 'PRICE_ABOVE_BELOW':
        if (!targetPrice) {
          return i.editReply({
            content: "❌ Target price is required for price target markets"
          });
        }

        marketData.targetPrice = targetPrice;
        title = `🎯 Will ${symbol!.toUpperCase()} hit $${targetPrice}?`;
        description = `Will ${symbol!.toUpperCase()} be above $${targetPrice} in ${hoursUntilResolve} hours?`;
        break;

      case 'VOLUME_RANKING':
        if (!targetRank) {
          return i.editReply({
            content: "❌ Target rank is required for volume ranking markets"
          });
        }

        if (!chain) {
          return i.editReply({
            content: "❌ Chain is required for volume ranking markets"
          });
        }

        marketData.targetRank = targetRank;
        marketData.chain = chain;
        title = `🏆 Will ${symbol!.toUpperCase()} be top ${targetRank}?`;
        description = `Will ${symbol!.toUpperCase()} be in top ${targetRank} by volume on ${chain} in ${hoursUntilResolve} hours?`;
        break;

      case 'SPORTS_WINNER':

        const winnerParsed = sportsResolver.parseTeamMatchup(teams!);
        if (!winnerParsed.success) {
          return i.editReply({
            content: `❌ ${winnerParsed.error}`
          });
        }

        // Try to find the game
        let gameResult = null;
        if (league) {
          const upcomingGames = await sportsResolver.fetchUpcomingGames(league);
          if (upcomingGames.success && upcomingGames.games) {
            // Find a matching game
            gameResult = upcomingGames.games.find((game: any) =>
              teams!.toLowerCase().includes(game.homeTeam.toLowerCase()) &&
              teams!.toLowerCase().includes(game.awayTeam.toLowerCase())
            );
          }
        }

        if (!gameResult) {
          // Try to search for one of the teams
          const searchTeam = winnerParsed.team1 || winnerParsed.team2;
          if (searchTeam) {
            const teamGameResult = await sportsResolver.findTeamNextGame(searchTeam, league || undefined);
            if (teamGameResult.success) {
              gameResult = teamGameResult.game;
            }
          }
        }

        if (!gameResult) {
          return i.editReply({
            content: `❌ Could not find upcoming game for "${teams}" in ${league || 'any league'}. Please check team names and try again.`
          });
        }

        marketData.eventId = gameResult.id;
        marketData.betTeam = betOn!.toLowerCase().includes(winnerParsed.team1?.toLowerCase() || '') ? winnerParsed.team1 : winnerParsed.team2;
        marketData.homeTeam = gameResult.homeTeam;
        marketData.awayTeam = gameResult.awayTeam;
        title = `🏈 ${betOn!} - ${gameResult.homeTeam} vs ${gameResult.awayTeam}`;
        description = `Predict if ${marketData.betTeam} will win against their opponent. Game on ${gameResult.date} ${gameResult.time}`;
        break;

      case 'SPORTS_OVER_UNDER':
        if (!totalPoints) {
          return i.editReply({
            content: "❌ total_points is required for over/under markets"
          });
        }

        const ouParsed = sportsResolver.parseTeamMatchup(teams!);
        if (!ouParsed.success) {
          return i.editReply({
            content: `❌ ${ouParsed.error}`
          });
        }

        // Find the game (similar logic as above)
        let ouGameResult = null;
        if (league) {
          const upcomingGames = await sportsResolver.fetchUpcomingGames(league);
          if (upcomingGames.success && upcomingGames.games) {
            ouGameResult = upcomingGames.games.find((game: any) =>
              teams!.toLowerCase().includes(game.homeTeam.toLowerCase()) &&
              teams!.toLowerCase().includes(game.awayTeam.toLowerCase())
            );
          }
        }

        if (!ouGameResult) {
          const searchTeam = ouParsed.team1 || ouParsed.team2;
          if (searchTeam) {
            const teamGameResult = await sportsResolver.findTeamNextGame(searchTeam, league || undefined);
            if (teamGameResult.success) {
              ouGameResult = teamGameResult.game;
            }
          }
        }

        if (!ouGameResult) {
          return i.editReply({
            content: `❌ Could not find upcoming game for "${teams}" in ${league || 'any league'}. Please check team names and try again.`
          });
        }

        marketData.eventId = ouGameResult.id;
        marketData.targetTotal = totalPoints;
        marketData.homeTeam = ouGameResult.homeTeam;
        marketData.awayTeam = ouGameResult.awayTeam;
        title = `🎯 Total Points Over ${totalPoints} - ${ouGameResult.homeTeam} vs ${ouGameResult.awayTeam}`;
        description = `Predict if the total score will be over ${totalPoints} points. Game on ${ouGameResult.date} ${ouGameResult.time}`;
        break;

      case 'SPORTS_SPREAD':
        if (!spreadPoints) {
          return i.editReply({
            content: "❌ spread_points is required for spread markets"
          });
        }

        const spreadParsed = sportsResolver.parseTeamMatchup(teams!);
        if (!spreadParsed.success) {
          return i.editReply({
            content: `❌ ${spreadParsed.error}`
          });
        }

        // Find the game (similar logic as above)
        let spreadGameResult = null;
        if (league) {
          const upcomingGames = await sportsResolver.fetchUpcomingGames(league);
          if (upcomingGames.success && upcomingGames.games) {
            spreadGameResult = upcomingGames.games.find((game: any) =>
              teams!.toLowerCase().includes(game.homeTeam.toLowerCase()) &&
              teams!.toLowerCase().includes(game.awayTeam.toLowerCase())
            );
          }
        }

        if (!spreadGameResult) {
          const searchTeam = spreadParsed.team1 || spreadParsed.team2;
          if (searchTeam) {
            const teamGameResult = await sportsResolver.findTeamNextGame(searchTeam, league || undefined);
            if (teamGameResult.success) {
              spreadGameResult = teamGameResult.game;
            }
          }
        }

        if (!spreadGameResult) {
          return i.editReply({
            content: `❌ Could not find upcoming game for "${teams}" in ${league || 'any league'}. Please check team names and try again.`
          });
        }

        marketData.eventId = spreadGameResult.id;
        marketData.spreadTeam = betOn!.toLowerCase().includes(spreadParsed.team1?.toLowerCase() || '') ? spreadParsed.team1 : spreadParsed.team2;
        marketData.spreadPoints = spreadPoints;
        marketData.homeTeam = spreadGameResult.homeTeam;
        marketData.awayTeam = spreadGameResult.awayTeam;
        title = `📊 ${marketData.spreadTeam} wins by ${spreadPoints}+ - ${spreadGameResult.homeTeam} vs ${spreadGameResult.awayTeam}`;
        description = `Predict if ${marketData.spreadTeam} will win by more than ${spreadPoints} points. Game on ${spreadGameResult.date} ${spreadGameResult.time}`;
        break;

      default:
        return i.editReply({
          content: `❌ Unsupported market type: ${marketType}`
        });
    }

    // Create the market with tier-based settings
    const marketParams: any = {
      title,
      description,
      resolveAt,
      creatorId: i.user.id,
      guildId: i.guildId,
      channelId: i.channelId || "",
      tokenSymbol: token.toUpperCase(),
      marketType: marketType.toUpperCase(),
      marketData
    };

    // Apply custom rake percentage from tier if specified
    if (tierCheck.permissions?.customRakePercent !== null && tierCheck.permissions?.customRakePercent !== undefined) {
      marketParams.rakePercentage = tierCheck.permissions.customRakePercent;
      console.log(`🎯 Discord: Applying custom tier rake: ${tierCheck.permissions.customRakePercent}% for ${tierCheck.tierName} tier`);
    }

    const market = await predictionMarkets.createMarket(marketParams);

    // Create success embed
    const embed = new EmbedBuilder()
      .setTitle("✅ Prediction Market Created!")
      .setDescription(description)
      .setColor(0x10B981)
      .addFields(
        {
          name: "📊 Market Details",
          value: [
            `**Type:** ${template.name}`,
            `**Token:** ${token.toUpperCase()}`,
            `**Resolves:** <t:${Math.floor(resolveAt.getTime() / 1000)}:R>`,
            `**Market ID:** \`${market.id}\``
          ].join('\n'),
          inline: true
        },
        {
          name: "💰 Betting Info",
          value: [
            `**Min Bet:** ${market.minBet} ${token.toUpperCase()}`,
            `**Max Bet:** ${market.maxBet} ${token.toUpperCase()}`,
            `**House Rake:** ${market.rakePercentage}%`,
            `**Current Pool:** 0 ${token.toUpperCase()}`
          ].join('\n'),
          inline: true
        }
      )
      .setTimestamp();

    // Add compliance footer for sports markets
    if (marketConfig.isSportsMarket(marketType.toUpperCase())) {
      embed.setFooter({
        text: "🔗 Peer-to-peer prediction market using virtual tokens. Not available where prohibited by law. Users responsible for local compliance. For entertainment purposes only."
      });
    } else {
      embed.setFooter({ text: "Share this market with others to start predictions!" });
    }

    // Add action buttons
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`share_market:${market.id}`)
          .setLabel("Share Market")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📢"),
        new ButtonBuilder()
          .setCustomId(`bet_yes:${market.id}`)
          .setLabel("Predict YES")
          .setStyle(ButtonStyle.Success)
          .setEmoji("✅"),
        new ButtonBuilder()
          .setCustomId(`bet_no:${market.id}`)
          .setLabel("Predict NO")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("❌")
      );

    await i.editReply({ embeds: [embed], components: [row] });

    // Send public announcement if enabled
    const notificationSettings = marketConfig.getNotificationSettings('marketCreated');
    if (notificationSettings.enabled) {
      try {
        const publicEmbed = new EmbedBuilder()
          .setTitle("🆕 New Prediction Market!")
          .setDescription(`${description}\n\nUse \`/pip_bet market_id:${market.id} side:YES amount:10\` to make a prediction!`)
          .setColor(0x3B82F6)
          .setAuthor({ name: i.user.displayName, iconURL: i.user.displayAvatarURL() })
          .addFields({
            name: "📊 Quick Prediction",
            value: `Market ID: \`${market.id}\`\nExpires: <t:${Math.floor(resolveAt.getTime() / 1000)}:R>`
          });

        await i.followUp({ embeds: [publicEmbed] });
      } catch (error) {
        console.error("Error sending market announcement:", error);
      }
    }

  } catch (error: any) {
    console.error("Create market command error:", error);
    await i.editReply({
      content: `❌ **Error creating market**\n${error?.message || String(error)}`
    });
  }
}

// Helper function to add to prediction markets service
declare module "../services/prediction_markets.js" {
  interface PredictionMarketService {
    getUserActiveMarketCount(userId: string): Promise<number>;
  }
}