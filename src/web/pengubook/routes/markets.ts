// src/web/pengubook/routes/markets.ts - Prediction markets integration in PenguBook
import type { PredictionBet } from "@prisma/client";
import { Request, Response } from "express";
import { getCurrentUser } from "../../auth.js";
import { generateBaseHTML } from "../templates.js";
import { prisma } from "../../../services/db.js";
import { predictionMarkets } from "../../../services/prediction_markets.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { getActiveTokens } from "../../../services/token.js";
import { marketConfig } from "../../../services/market_config.js";
import { checkMarketCreationPermission } from "../../../services/tiers.js";

export async function marketsHandler(req: Request, res: Response) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.redirect("/auth/discord");
    }

    const { token, status = "active", limit = "20", offset = "0" } = req.query;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const offsetNum = parseInt(offset as string) || 0;

    // Build query filters
    const where: any = {};

    if (status === "active") {
      where.status = 'ACTIVE';
      where.resolveAt = { gt: new Date() };
    } else if (status === "resolved") {
      where.status = 'RESOLVED';
    } else if (status === "all") {
      // No additional filters
    }

    if (token && token !== 'all') {
      where.tokenSymbol = (token as string).toUpperCase();
    }

    const [markets, totalMarkets, activeTokens] = await Promise.all([
      prisma.predictionMarket.findMany({
        where,
        orderBy: [
          { totalBetCount: 'desc' },
          { createdAt: 'desc' }
        ],
        take: limitNum,
        skip: offsetNum,
        include: {
          _count: {
            select: { bets: true }
          }
        }
      }),
      prisma.predictionMarket.count({ where }),
      getActiveTokens()
    ]);

    // Calculate live odds for each market with betting cutoff info
    const marketsWithOdds = markets.map(market => {
      const marketObj = predictionMarkets['mapDbMarket'](market);
      const odds = predictionMarkets.calculateOdds(marketObj);
      const totalPool = market.totalYesBets + market.totalNoBets;
      const timeLeft = market.resolveAt.getTime() - Date.now();

      // Check betting cutoff (including sports-specific game start cutoffs)
      const marketData = market.marketData as any;
      let bettingCutoffTime: number | null = null;

      if (marketData?.bettingClosesAt) {
        bettingCutoffTime = new Date(marketData.bettingClosesAt).getTime();
      } else if (marketData?.bettingCutoffTime) {
        bettingCutoffTime = new Date(marketData.bettingCutoffTime).getTime();
      } else if (marketData?.gameStartTime && marketData?.bettingClosesAtGameStart) {
        bettingCutoffTime = new Date(marketData.gameStartTime).getTime();
      }

      const now = Date.now();
      const bettingClosed = bettingCutoffTime && now >= bettingCutoffTime;
      const timeUntilBettingCloses = bettingCutoffTime ? Math.max(0, bettingCutoffTime - now) : null;

      return {
        ...market,
        totalPool,
        timeLeftMs: Math.max(0, timeLeft),
        bettingClosed,
        timeUntilBettingClosesMs: timeUntilBettingCloses,
        bettingCutoffTime: bettingCutoffTime ? new Date(bettingCutoffTime).toISOString() : null,
        odds: {
          yes: Number(odds.yesOdds.toFixed(2)),
          no: Number(odds.noOdds.toFixed(2)),
          yesImplied: Number((odds.yesImpliedProb * 100).toFixed(1)),
          noImplied: Number((odds.noImpliedProb * 100).toFixed(1))
        }
      };
    });

    const content = generateMarketsPageContent(marketsWithOdds, {
      currentFilter: { token, status },
      pagination: {
        total: totalMarkets,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < totalMarkets
      },
      activeTokens,
      currentUser
    });

    const html = generateBaseHTML(content, "Prediction Markets - PenguBook", "markets", { user: currentUser });
    res.send(html);

  } catch (error) {
    console.error('Markets page error:', error);
    res.status(500).send('Error loading prediction markets');
  }
}

export async function marketDetailHandler(req: Request, res: Response) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.redirect("/auth/discord");
    }

    const { marketId } = req.params;
    const { include_bets = "true" } = req.query;

    const market = await prisma.predictionMarket.findUnique({
      where: { id: marketId },
      include: {
        _count: {
          select: { bets: true }
        }
      }
    });

    if (!market) {
      return res.status(404).send('Market not found');
    }

    // Get user's bet on this market if any
    const user = await findOrCreateUser(currentUser.discordId);
    const userBet = await prisma.predictionBet.findFirst({
      where: {
        marketId: marketId,
        userId: currentUser.discordId
      }
    });

    let bettingHistory: Array<PredictionBet & { User?: { username: string; discordId: string } | null }> = [];

    if (include_bets === "true") {
      const bets = await prisma.predictionBet.findMany({
        where: { marketId },
        orderBy: { createdAt: 'desc' },
        take: 50
      });

      if (bets.length > 0) {
        const uniqueUserIds = [...new Set(bets.map(bet => bet.userId))];

        const users = await prisma.user.findMany({
          where: { discordId: { in: uniqueUserIds } },
          select: {
            discordId: true,
            xUsername: true
          }
        });

        const userMap = new Map(users.map(user => [user.discordId, user.xUsername ?? null]));

        bettingHistory = bets.map(bet => {
          const cachedUsername = userMap.get(bet.userId) ?? undefined;
          const isCurrentUser = bet.userId === currentUser.discordId;
          const username = cachedUsername
            ? `@${cachedUsername}`
            : (isCurrentUser
              ? currentUser.username || `You (${bet.userId.slice(-4)})`
              : `User#${bet.userId.slice(-4)}`);

          return {
            ...bet,
            User: {
              username,
              discordId: bet.userId
            }
          };
        });
      }
    }

    const marketObj = predictionMarkets['mapDbMarket'](market);
    const odds = predictionMarkets.calculateOdds(marketObj);
    const totalPool = market.totalYesBets + market.totalNoBets;
    const timeLeft = market.resolveAt.getTime() - Date.now();

    // Check betting cutoff for detailed view (including sports-specific game start cutoffs)
    const marketData = market.marketData as any;
    let bettingCutoffTime: number | null = null;

    if (marketData?.bettingClosesAt) {
      bettingCutoffTime = new Date(marketData.bettingClosesAt).getTime();
    } else if (marketData?.bettingCutoffTime) {
      bettingCutoffTime = new Date(marketData.bettingCutoffTime).getTime();
    } else if (marketData?.gameStartTime && marketData?.bettingClosesAtGameStart) {
      bettingCutoffTime = new Date(marketData.gameStartTime).getTime();
    }

    const now = Date.now();
    const bettingClosed = bettingCutoffTime && now >= bettingCutoffTime;
    const timeUntilBettingCloses = bettingCutoffTime ? Math.max(0, bettingCutoffTime - now) : null;

    const marketWithOdds = {
      ...market,
      totalPool,
      timeLeftMs: Math.max(0, timeLeft),
      bettingClosed,
      timeUntilBettingClosesMs: timeUntilBettingCloses,
      bettingCutoffTime: bettingCutoffTime ? new Date(bettingCutoffTime).toISOString() : null,
      odds: {
        yes: Number(odds.yesOdds.toFixed(2)),
        no: Number(odds.noOdds.toFixed(2)),
        yesImplied: Number((odds.yesImpliedProb * 100).toFixed(1)),
        noImplied: Number((odds.noImpliedProb * 100).toFixed(1))
      }
    };

    const content = generateMarketDetailContent(marketWithOdds, {
      userBet,
      currentUser,
      bettingHistory
    });

    const html = generateBaseHTML(content, `${market.title} - Prediction Markets`, "markets", { user: currentUser });
    res.send(html);

  } catch (error) {
    console.error('Market detail error:', error);
    res.status(500).send('Error loading market details');
  }
}

// Helper function to fetch sports game data from TheSportsDB API
async function fetchSportsGameData(gameId: string): Promise<{ success: boolean; game?: any; error?: string }> {
  try {
    const response = await fetch(`https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id=${gameId}`);

    if (!response.ok) {
      return { success: false, error: `TheSportsDB API error: ${response.status}` };
    }

    const data = await response.json();

    if (!data.events || data.events.length === 0) {
      return { success: false, error: `Game with ID ${gameId} not found` };
    }

    const game = data.events[0];
    return { success: true, game };

  } catch (error) {
    console.error('TheSportsDB API error:', error);
    return { success: false, error: `API request failed: ${error}` };
  }
}

export async function createMarketHandler(req: Request, res: Response) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    if (req.method === 'GET') {
      // Show template-only market creation form
      const activeTokens = await getActiveTokens();
      const content = await generateTemplateOnlyMarketContent(activeTokens);
      const html = generateBaseHTML(content, "Create Prediction Market", "markets", { user: currentUser });
      return res.send(html);
    } else if (req.method === 'POST') {
      // Check tier permissions first
      const tierCheck = await checkMarketCreationPermission(currentUser.discordId);
      if (!tierCheck.allowed) {
        return res.status(403).json({
          success: false,
          error: tierCheck.error
        });
      }

      // Handle template-only market creation
      const { templateType, tokenSymbol: bettingToken, direction, percentage, changeThreshold, gameId, teamSelection, resolveAt } = req.body;

      // STRICT template validation - ONLY allow predefined templates
      const validTemplates = [
        'CRYPTO_PRICE_DIRECTION', 'CRYPTO_DAILY_CHANGE', 'CRYPTO_VOLUME',
        'SPORTS_WINNER', 'SPORTS_TOTAL', 'SPORTS_SPREAD'
      ];

      if (!validTemplates.includes(templateType)) {
        return res.status(400).json({
          success: false,
          error: "REJECTED: Only pre-defined templates allowed"
        });
      }

      let marketData: any = {};
      let title = "";
      let description = "";
      let targetTokenSymbol = "";

      if (templateType.startsWith('CRYPTO_')) {
        // Extract token symbol from template params (NOT betting token)
        targetTokenSymbol = req.body.tokenSymbol; // This is the crypto token being predicted

        if (!targetTokenSymbol) {
          return res.status(400).json({
            success: false,
            error: "Token symbol required for crypto markets"
          });
        }

        // CRITICAL: Validate token exists in external APIs
        const { priceAPI } = await import("../../../services/price_api.js");
        const tokenData = await priceAPI.getTokenPrices([targetTokenSymbol]);

        if (!tokenData.success || !tokenData.prices[targetTokenSymbol]) {
          return res.status(400).json({
            success: false,
            error: `REJECTED: Token ${targetTokenSymbol} not found in DexScreener/CoinGecko APIs - cannot guarantee resolution`
          });
        }

        const currentPrice = tokenData.prices[targetTokenSymbol];

        switch (templateType) {
          case 'CRYPTO_PRICE_DIRECTION':
            if (!percentage || !direction) {
              return res.status(400).json({
                success: false,
                error: "Percentage and direction required"
              });
            }

            const percentChange = parseFloat(percentage);
            const multiplier = direction === 'up' ? (1 + percentChange / 100) : (1 - Math.abs(percentChange) / 100);
            const targetPrice = currentPrice * multiplier;

            title = `${targetTokenSymbol} ${direction === 'up' ? 'above' : 'below'} $${targetPrice.toFixed(6)}`;
            description = `Will ${targetTokenSymbol} price be ${direction === 'up' ? 'above' : 'below'} $${targetPrice.toFixed(6)} by resolution time? Current: $${currentPrice.toFixed(6)} (${percentChange}% ${direction})`;

            marketData = {
              targetTokenSymbol,
              targetPrice,
              currentPrice,
              direction,
              percentage: percentChange,
              apiEndpoint: `dexscreener/token/${targetTokenSymbol}`,
              resolutionCriteria: `price ${direction === 'up' ? '>=' : '<'} ${targetPrice}`,
              autoResolve: true
            };
            break;

          case 'CRYPTO_DAILY_CHANGE':
            if (!changeThreshold) {
              return res.status(400).json({
                success: false,
                error: "Change threshold required"
              });
            }

            const threshold = parseFloat(changeThreshold);
            title = `${targetTokenSymbol} 24h change above ${threshold}%`;
            description = `Will ${targetTokenSymbol} have 24h price change above ${threshold}%? Current 24h change: ${tokenData.change24h || 'N/A'}%`;

            marketData = {
              targetTokenSymbol,
              changeThreshold: threshold,
              currentPrice,
              apiEndpoint: `dexscreener/token/${targetTokenSymbol}`,
              resolutionCriteria: `24h_change >= ${threshold}%`,
              autoResolve: true
            };
            break;

          default:
            return res.status(400).json({
              success: false,
              error: `Template ${templateType} not implemented yet`
            });
        }

      } else if (templateType.startsWith('SPORTS_')) {
        if (!gameId) {
          return res.status(400).json({
            success: false,
            error: "Game ID required for sports markets"
          });
        }

        // Fetch game details from TheSportsDB API
        const gameData = await fetchSportsGameData(gameId);
        if (!gameData.success) {
          return res.status(400).json({
            success: false,
            error: `Failed to fetch game data: ${gameData.error}`
          });
        }

        const game = gameData.game;
        const gameStartTime = new Date(game.strTimestamp || game.dateEvent + 'T' + (game.strTime || '00:00:00'));

        // Validate game timing
        if (gameStartTime <= now) {
          return res.status(400).json({
            success: false,
            error: "Cannot create markets for games that have already started"
          });
        }

        // Check if game is postponed
        if (game.strPostponed === "yes") {
          return res.status(400).json({
            success: false,
            error: "Cannot create market for postponed game"
          });
        }

        const timeDiff = gameStartTime.getTime() - now.getTime();
        const hoursUntilGame = timeDiff / (60 * 60 * 1000);

        if (hoursUntilGame < 1) {
          return res.status(400).json({
            success: false,
            error: "Cannot create markets for games starting within 1 hour"
          });
        }

        // Set betting to close at game start, resolution 3 hours after game start
        bettingCutoffTime = gameStartTime;
        const gameEndTime = new Date(gameStartTime.getTime() + (3 * 60 * 60 * 1000)); // 3 hours later
        resolveTime = gameEndTime;

        title = `${game.strHomeTeam} vs ${game.strAwayTeam} - ${templateType.replace('SPORTS_', '').toLowerCase()}`;
        description = `${templateType} market for ${game.strEvent || game.strHomeTeam + ' vs ' + game.strAwayTeam}. Betting closes at game start. Auto-resolved via TheSportsDB API.`;

        marketData = {
          gameId,
          teamSelection,
          homeTeam: game.strHomeTeam,
          awayTeam: game.strAwayTeam,
          gameStartTime: gameStartTime.toISOString(),
          sport: game.strSport,
          league: game.strLeague,
          apiEndpoint: `thesportsdb/event/${gameId}`,
          resolutionCriteria: `auto_resolve_via_thesportsdb_api`,
          autoResolve: true,
          bettingClosesAtGameStart: true
        };

        console.log(`Sports market: ${title} - Betting closes at game start: ${gameStartTime.toISOString()}`);
      }

      const user = await findOrCreateUser(currentUser.discordId);

      // Parse resolve time with timezone safety
      const resolveTime = new Date(resolveAt);
      const now = new Date();
      const minTimeAhead = 2 * 60 * 60 * 1000; // 2 hours minimum (to ensure proper betting window)
      const maxTimeAhead = 30 * 24 * 60 * 60 * 1000; // 30 days maximum

      if (resolveTime <= now) {
        return res.status(400).json({
          success: false,
          error: "Resolution time must be in the future"
        });
      }

      if (resolveTime.getTime() - now.getTime() < minTimeAhead) {
        return res.status(400).json({
          success: false,
          error: "Resolution time must be at least 2 hours in the future to allow proper betting window"
        });
      }

      if (resolveTime.getTime() - now.getTime() > maxTimeAhead) {
        return res.status(400).json({
          success: false,
          error: "Resolution time cannot be more than 30 days in the future"
        });
      }

      // Calculate betting cutoff time (20% before resolution)
      const totalDuration = resolveTime.getTime() - now.getTime();
      const bettingCutoffTime = new Date(resolveTime.getTime() - (totalDuration * 0.20));

      // Log timezone and betting window info
      console.log(`Market resolution scheduled: ${resolveTime.toISOString()} UTC`);
      console.log(`Betting closes: ${bettingCutoffTime.toISOString()} UTC (20% before resolution)`);

      // Create bulletproof market with API guarantee and tier-based rake
      const marketParams: any = {
        title,
        description,
        resolveAt: resolveTime,
        creatorId: user.id.toString(),
        guildId: "web-bulletproof",
        channelId: "pengubook-templates",
        tokenSymbol: bettingToken,
        marketType: templateType,
        marketData: {
          ...marketData,
          templateBased: true,
          apiGuaranteed: true,
          disputeProof: true,
          createdVia: "template-only-system",
          bettingCutoffTime: bettingCutoffTime.toISOString(),
          bettingWindowPercentage: 80 // 80% of time allows betting, 20% is cutoff
        }
      };

      // Apply custom rake percentage from tier if specified
      if (tierCheck.permissions?.customRakePercent !== null && tierCheck.permissions?.customRakePercent !== undefined) {
        marketParams.rakePercentage = tierCheck.permissions.customRakePercent;
        console.log(`\u{1f3af} Applying custom tier rake: ${tierCheck.permissions.customRakePercent}% for ${tierCheck.tierName} tier`);
      }

      const market = await predictionMarkets.createMarket(marketParams);

      return res.json({
        success: true,
        marketId: market.id,
        message: "✅ Bulletproof market created with API guarantee",
        redirectUrl: `/pengubook/markets/${market.id}`
      });
    }
  } catch (error) {
    console.error('Template market creation error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to create market: " + (error instanceof Error ? error.message : String(error))
    });
  }
}

export async function placeBetHandler(req: Request, res: Response) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { marketId, side, amount } = req.body;

    // Validate input
    if (!marketId || !side || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: marketId, side, amount'
      });
    }

    if (!['YES', 'NO'].includes(side)) {
      return res.status(400).json({
        success: false,
        error: 'Side must be YES or NO'
      });
    }

    const betAmount = parseInt(amount);
    if (isNaN(betAmount) || betAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive integer'
      });
    }

    // Check if market is still accepting bets (betting cutoff enforcement)
    const market = await prisma.predictionMarket.findUnique({
      where: { id: marketId }
    });

    if (!market) {
      return res.status(404).json({
        success: false,
        error: 'Market not found'
      });
    }

    // Check betting cutoff time
    const now = new Date();
    const marketData = market.marketData as any;
    const bettingCutoffTime = marketData?.bettingCutoffTime ? new Date(marketData.bettingCutoffTime) : null;

    if (bettingCutoffTime && now >= bettingCutoffTime) {
      const timeUntilResolution = market.resolveAt.getTime() - now.getTime();
      const minutesUntilResolution = Math.floor(timeUntilResolution / (60 * 1000));

      return res.status(400).json({
        success: false,
        error: `⏰ Betting has closed for this market. Betting closed ${Math.floor((now.getTime() - bettingCutoffTime.getTime()) / (60 * 1000))} minutes ago to prevent outcome sniping. Resolution in ${minutesUntilResolution} minutes.`
      });
    }

    // Anti-sniping warning for bets close to cutoff
    if (bettingCutoffTime) {
      const timeUntilCutoff = bettingCutoffTime.getTime() - now.getTime();
      if (timeUntilCutoff < 30 * 60 * 1000) { // Less than 30 minutes until cutoff
        console.log(`⚠️  Late bet warning: User ${currentUser.discordId} betting with ${Math.floor(timeUntilCutoff / (60 * 1000))} minutes until cutoff on market ${marketId}`);
      }
    }

    // Place the bet
    const result = await predictionMarkets.placeBet({
      marketId,
      userId: currentUser.discordId,
      side: side as 'YES' | 'NO',
      amount: betAmount
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    // Return updated market info
    const odds = predictionMarkets.calculateOdds(result.market!);
    const totalPool = result.market!.totalYesBets + result.market!.totalNoBets;

    res.json({
      success: true,
      message: 'Bet placed successfully',
      bet: {
        marketId,
        side,
        amount: betAmount,
        timestamp: new Date().toISOString()
      },
      updatedMarket: {
        id: result.market!.id,
        totalPool,
        yesPool: result.market!.totalYesBets,
        noPool: result.market!.totalNoBets,
        totalBets: result.market!.totalBetCount,
        odds: {
          yes: Number(odds.yesOdds.toFixed(2)),
          no: Number(odds.noOdds.toFixed(2)),
          yesImplied: Number((odds.yesImpliedProb * 100).toFixed(1)),
          noImplied: Number((odds.noImpliedProb * 100).toFixed(1))
        }
      }
    });

  } catch (error) {
    console.error('Place bet error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to place bet'
    });
  }
}

function generateMarketsPageContent(markets: any[], options: any): string {
  const { currentFilter, pagination, activeTokens, currentUser } = options;
  const hasMarkets = markets.length > 0;

  return `
    <div class="pg-content">
      <div class="pg-content__header">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--pg-space-4);">
          <h1>🔮 Prediction Markets</h1>
          <a href="/pengubook/markets/create" class="pg-btn pg-btn--primary" style="text-decoration: none;">
            ➕ Create Market
          </a>
        </div>
        <p class="pg-content__subtitle">
          Trade your predictions on crypto prices, sports, and more.
          ${hasMarkets ? `Showing ${markets.length} of ${pagination.total} markets` : 'No markets found'}
        </p>
      </div>

      <!-- Market Filters -->
      <div class="pg-markets-filters">
        <div class="pg-filters-row">
          <select id="tokenFilter" onchange="filterMarkets()">
            <option value="all" ${!currentFilter.token || currentFilter.token === 'all' ? 'selected' : ''}>All Tokens</option>
            ${activeTokens.map((token: any) => `
              <option value="${token.symbol}" ${currentFilter.token === token.symbol ? 'selected' : ''}>
                ${token.symbol}
              </option>
            `).join('')}
          </select>

          <select id="statusFilter" onchange="filterMarkets()">
            <option value="active" ${currentFilter.status === 'active' ? 'selected' : ''}>🟢 Active Markets</option>
            <option value="resolved" ${currentFilter.status === 'resolved' ? 'selected' : ''}>✅ Resolved Markets</option>
            <option value="all" ${currentFilter.status === 'all' ? 'selected' : ''}>📊 All Markets</option>
          </select>

          <button onclick="window.location.reload()" class="pg-btn pg-btn--secondary">
            🔄 Refresh
          </button>
        </div>
      </div>

      ${hasMarkets ? generateMarketsGrid(markets) : generateEmptyMarketsState()}

      ${pagination.total > pagination.limit ? generatePagination(pagination) : ''}
    </div>

    <script>
      function filterMarkets() {
        const token = document.getElementById('tokenFilter').value;
        const status = document.getElementById('statusFilter').value;
        const params = new URLSearchParams();

        if (token !== 'all') params.set('token', token);
        if (status !== 'active') params.set('status', status);

        window.location.search = params.toString();
      }

      function placeBet(marketId, side) {
        const amount = prompt(\`How much do you want to bet on \${side}?\`);
        if (!amount || isNaN(amount) || amount <= 0) return;

        fetch('/pengubook/markets/bet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketId, side, amount: parseInt(amount) })
        })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            alert('Bet placed successfully!');
            window.location.reload();
          } else {
            alert('Error: ' + data.error);
          }
        })
        .catch(err => alert('Network error: ' + err.message));
      }

      // Auto-refresh active markets every 30 seconds
      if (window.location.search.includes('status=active') || !window.location.search.includes('status=')) {
        setTimeout(() => window.location.reload(), 30000);
      }
    </script>
  `;
}

function generateMarketsGrid(markets: any[]): string {
  return `
    <div class="pg-markets-grid">
      ${markets.map(market => `
        <div class="pg-market-card ${market.status === 'ACTIVE' ? 'pg-market-card--active' : 'pg-market-card--resolved'}">
          <div class="pg-market-header">
            <h3 class="pg-market-title">
              <a href="/pengubook/markets/${market.id}">${market.title}</a>
            </h3>
            <div class="pg-market-meta">
              <span class="pg-market-token">${market.tokenSymbol}</span>
              <span class="pg-market-status ${market.status.toLowerCase()}">${market.status}</span>
            </div>
          </div>

          <p class="pg-market-description">${market.description}</p>

          <div class="pg-market-stats">
            <div class="pg-stat">
              <span class="pg-stat-label">Total Pool</span>
              <span class="pg-stat-value">${market.totalPool.toLocaleString()} ${market.tokenSymbol}</span>
            </div>
            <div class="pg-stat">
              <span class="pg-stat-label">Total Bets</span>
              <span class="pg-stat-value">${market._count.bets}</span>
            </div>
          </div>

          <div class="pg-odds-display">
            <div class="pg-odds-side pg-odds-side--yes">
              <div class="pg-odds-label">YES</div>
              <div class="pg-odds-value">${market.odds.yes}x</div>
              <div class="pg-odds-implied">${market.odds.yesImplied}%</div>
              <div class="pg-odds-pool">${market.yesPool} ${market.tokenSymbol}</div>
            </div>
            <div class="pg-odds-side pg-odds-side--no">
              <div class="pg-odds-label">NO</div>
              <div class="pg-odds-value">${market.odds.no}x</div>
              <div class="pg-odds-implied">${market.odds.noImplied}%</div>
              <div class="pg-odds-pool">${market.noPool} ${market.tokenSymbol}</div>
            </div>
          </div>

          ${market.status === 'ACTIVE' && market.timeLeftMs > 0 ? `
            <div class="pg-market-actions">
              ${market.bettingClosed ? `
                <div class="pg-betting-closed-notice">
                  🔒 <strong>Betting Closed</strong><br>
                  <small>${(market.marketData as any)?.bettingClosesAtGameStart
                    ? `Closed at game start to prevent late-information advantage`
                    : `Closed ${formatTimeLeft(Date.now() - new Date(market.bettingCutoffTime).getTime())} ago to prevent sniping`
                  }</small>
                </div>
              ` : `
                <button onclick="placeBet('${market.id}', 'YES')" class="pg-btn pg-btn--yes">
                  Predict YES
                </button>
                <button onclick="placeBet('${market.id}', 'NO')" class="pg-btn pg-btn--no">
                  Predict NO
                </button>
                ${market.timeUntilBettingClosesMs && market.timeUntilBettingClosesMs < 60 * 60 * 1000 ? `
                  <div class="pg-betting-warning">
                    ⚠️ Betting closes in ${formatTimeLeft(market.timeUntilBettingClosesMs)}
                  </div>
                ` : ''}
              `}
              <a href="/pengubook/markets/${market.id}" class="pg-btn pg-btn--secondary">
                View Details
              </a>
            </div>
          ` : `
            <div class="pg-market-actions">
              <a href="/pengubook/markets/${market.id}" class="pg-btn pg-btn--primary">
                View Results
              </a>
            </div>
          `}

          <div class="pg-market-footer">
            ${market.status === 'ACTIVE' ? `
              <span class="pg-market-time">⏰ ${formatTimeLeft(market.timeLeftMs)}</span>
            ` : market.outcome ? `
              <span class="pg-market-outcome">🎯 Resolved: <strong>${market.outcome}</strong></span>
            ` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function generateEmptyMarketsState(): string {
  return `
    <div class="pg-empty-state">
      <div class="pg-empty-state__icon">🔮</div>
      <h2>No Prediction Markets Found</h2>
      <p>There are no markets matching your current filters.</p>
      <button onclick="document.getElementById('statusFilter').value = 'active'; filterMarkets()" class="pg-btn pg-btn--primary">
        View Active Markets
      </button>
    </div>
  `;
}

function generatePagination(pagination: any): string {
  const { total, limit, offset } = pagination;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);
  const hasNext = offset + limit < total;
  const hasPrev = offset > 0;

  return `
    <div class="pg-pagination">
      ${hasPrev ? `
        <a href="?offset=${Math.max(0, offset - limit)}&limit=${limit}" class="pg-btn pg-btn--secondary">
          ← Previous
        </a>
      ` : ''}

      <span class="pg-pagination-info">
        Page ${currentPage} of ${totalPages}
      </span>

      ${hasNext ? `
        <a href="?offset=${offset + limit}&limit=${limit}" class="pg-btn pg-btn--secondary">
          Next →
        </a>
      ` : ''}
    </div>
  `;
}

function generateMarketDetailContent(market: any, options: any): string {
  const { userBet, currentUser, bettingHistory } = options;
  const isActive = market.status === 'ACTIVE' && market.timeLeftMs > 0;
  const timeLeft = formatTimeLeft(market.timeLeftMs);

  return `
    <div class="pg-content">
      <div class="pg-market-detail">
        <!-- Breadcrumb -->
        <div class="pg-breadcrumb">
          <a href="/pengubook/markets">🔮 Markets</a>
          <span>›</span>
          <span>${market.title}</span>
        </div>

        <!-- Market Header -->
        <div class="pg-market-detail__header">
          <h1>${market.title}</h1>
          <div class="pg-market-badges">
            <span class="pg-badge pg-badge--${market.status.toLowerCase()}">${market.status}</span>
            <span class="pg-badge">${market.tokenSymbol}</span>
            <span class="pg-badge">${market.marketType.toUpperCase()}</span>
          </div>
        </div>

        <p class="pg-market-detail__description">${market.description}</p>

        <!-- Market Stats -->
        <div class="pg-market-detail__stats">
          <div class="pg-stat-grid">
            <div class="pg-stat-card">
              <div class="pg-stat-label">Total Pool</div>
              <div class="pg-stat-value">${market.totalPool.toLocaleString()} ${market.tokenSymbol}</div>
            </div>
            <div class="pg-stat-card">
              <div class="pg-stat-label">Total Bets</div>
              <div class="pg-stat-value">${market._count.bets}</div>
            </div>
            <div class="pg-stat-card">
              <div class="pg-stat-label">Min Bet</div>
              <div class="pg-stat-value">${market.minBet} ${market.tokenSymbol}</div>
            </div>
            <div class="pg-stat-card">
              <div class="pg-stat-label">Max Bet</div>
              <div class="pg-stat-value">${market.maxBet} ${market.tokenSymbol}</div>
            </div>
          </div>
        </div>

        ${isActive ? `
          <div class="pg-market-timer">
            <div class="pg-timer-icon">⏰</div>
            <div class="pg-timer-text">
              ${market.bettingClosed ? `
                <strong>Betting Closed</strong> - Resolution in ${timeLeft}<br>
                <small>${(market.marketData as any)?.bettingClosesAtGameStart
                  ? `Betting closed at game start to prevent late-information advantage`
                  : `Betting was closed early to prevent outcome sniping`
                }</small>
              ` : market.timeUntilBettingClosesMs ? `
                <strong>⏰ Betting closes in ${formatTimeLeft(market.timeUntilBettingClosesMs)}</strong><br>
                <small>${(market.marketData as any)?.bettingClosesAtGameStart
                  ? `Betting closes at game start - Market resolves in ${timeLeft}`
                  : `Market resolves in ${timeLeft} (20% buffer to prevent sniping)`
                }</small>
              ` : `
                <strong>${timeLeft}</strong> remaining to place bets
              `}
            </div>
          </div>
        ` : market.outcome ? `
          <div class="pg-market-result">
            <div class="pg-result-icon">🎯</div>
            <div class="pg-result-text">
              <strong>Market Resolved:</strong> ${market.outcome}
            </div>
          </div>
        ` : ''}

        <!-- Live Odds Display -->
        <div class="pg-odds-display-large">
          <div class="pg-odds-side-large pg-odds-side--yes ${market.outcome === 'YES' ? 'pg-odds-winner' : ''}">
            <div class="pg-odds-header">
              <div class="pg-odds-label-large">YES</div>
              ${market.outcome === 'YES' ? '<div class="pg-winner-badge">🏆 WINNER</div>' : ''}
            </div>
            <div class="pg-odds-value-large">${market.odds.yes}x</div>
            <div class="pg-odds-implied-large">${market.odds.yesImplied}% implied</div>
            <div class="pg-odds-pool-large">${market.yesPool.toLocaleString()} ${market.tokenSymbol}</div>
            ${isActive && !userBet && !market.bettingClosed ? `
              <button onclick="placeBet('${market.id}', 'YES')" class="pg-btn pg-btn--yes pg-btn--large">
                Predict YES
              </button>
            ` : isActive && market.bettingClosed && !userBet ? `
              <div class="pg-betting-closed-large">
                🔒 Betting Closed
              </div>
            ` : ''}
          </div>

          <div class="pg-odds-side-large pg-odds-side--no ${market.outcome === 'NO' ? 'pg-odds-winner' : ''}">
            <div class="pg-odds-header">
              <div class="pg-odds-label-large">NO</div>
              ${market.outcome === 'NO' ? '<div class="pg-winner-badge">🏆 WINNER</div>' : ''}
            </div>
            <div class="pg-odds-value-large">${market.odds.no}x</div>
            <div class="pg-odds-implied-large">${market.odds.noImplied}% implied</div>
            <div class="pg-odds-pool-large">${market.noPool.toLocaleString()} ${market.tokenSymbol}</div>
            ${isActive && !userBet && !market.bettingClosed ? `
              <button onclick="placeBet('${market.id}', 'NO')" class="pg-btn pg-btn--no pg-btn--large">
                Predict NO
              </button>
            ` : isActive && market.bettingClosed && !userBet ? `
              <div class="pg-betting-closed-large">
                🔒 Betting Closed
              </div>
            ` : ''}
          </div>
        </div>

        ${userBet ? `
          <div class="pg-user-bet">
            <h3>Your Prediction</h3>
            <div class="pg-user-bet-card">
              <div class="pg-bet-side pg-bet-side--${userBet.side.toLowerCase()}">
                ${userBet.side}
              </div>
              <div class="pg-bet-amount">
                ${userBet.amount} ${userBet.tokenSymbol}
              </div>
              <div class="pg-bet-date">
                ${new Date(userBet.createdAt).toLocaleDateString()}
              </div>
              ${market.status === 'RESOLVED' ? `
                <div class="pg-bet-result ${userBet.side === market.outcome ? 'pg-bet-won' : 'pg-bet-lost'}">
                  ${userBet.side === market.outcome ? '🎉 WON' : '❌ LOST'}
                </div>
              ` : ''}
            </div>
          </div>
        ` : isActive ? `
          <div class="pg-betting-cta">
            <h3>Make Your Prediction</h3>
            <p>Choose your side and amount to participate in this prediction market.</p>
          </div>
        ` : ''}

        <!-- Recent Betting Activity -->
        ${bettingHistory.length > 0 ? `
          <div class="pg-betting-history">
            <h3>Recent Activity</h3>
            <div class="pg-bet-list">
              ${bettingHistory.slice(0, 10).map((bet: any) => `
                <div class="pg-bet-item">
                  <div class="pg-bet-user">${bet.User?.username || 'Anonymous'}</div>
                  <div class="pg-bet-side pg-bet-side--${bet.side.toLowerCase()}">${bet.side}</div>
                  <div class="pg-bet-amount">${bet.amount} ${market.tokenSymbol}</div>
                  <div class="pg-bet-time">${formatRelativeTime(bet.createdAt)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>

    <script>
      function placeBet(marketId, side) {
        const amount = prompt(\`How much \${side === 'YES' ? '${market.tokenSymbol}' : '${market.tokenSymbol}'} do you want to bet on \${side}?\nMin: ${market.minBet}, Max: ${market.maxBet}\`);

        if (!amount) return;

        const betAmount = parseInt(amount);
        if (isNaN(betAmount) || betAmount < ${market.minBet} || betAmount > ${market.maxBet}) {
          alert(\`Amount must be between ${market.minBet} and ${market.maxBet}\`);
          return;
        }

        if (!confirm(\`Confirm bet: \${betAmount} ${market.tokenSymbol} on \${side}?\`)) return;

        fetch('/pengubook/markets/bet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketId, side, amount: betAmount })
        })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            alert('✅ Bet placed successfully!');
            window.location.reload();
          } else {
            alert('❌ Error: ' + data.error);
          }
        })
        .catch(err => alert('Network error: ' + err.message));
      }
    </script>
  `;
}

// Helper functions
function formatTimeLeft(timeLeftMs: number): string {
  if (timeLeftMs <= 0) return 'Expired';

  const days = Math.floor(timeLeftMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((timeLeftMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatRelativeTime(date: string): string {
  const now = new Date().getTime();
  const then = new Date(date).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

async function generateTemplateOnlyMarketContent(activeTokens: any[]): Promise<string> {
  return `
    <div class="pg-content">
      <div class="pg-content__header">
        <h1>🔮 Create Prediction Market</h1>
        <p class="pg-content__subtitle">
          Create bulletproof markets that resolve automatically via external APIs
        </p>
      </div>

      <!-- BULLETPROOF API GUARANTEE -->
      <div style="margin-bottom: var(--pg-space-6); padding: var(--pg-space-5); background: linear-gradient(135deg, #10b981, #059669); border-radius: 12px; color: white; box-shadow: 0 8px 25px rgba(16, 185, 129, 0.2);">
        <div style="display: flex; align-items: center; margin-bottom: var(--pg-space-3);">
          <span style="font-size: 2rem; margin-right: var(--pg-space-3);">🛡️</span>
          <div>
            <h2 style="margin: 0; font-size: 1.4rem; font-weight: 700;">100% DISPUTE-FREE MARKETS</h2>
            <p style="margin: 0; opacity: 0.9; font-size: 1rem;">
              Every market automatically resolves via external APIs - zero human judgment, zero disputes
            </p>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--pg-space-4); margin-top: var(--pg-space-4);">
          <div style="display: flex; align-items: center; background: rgba(255,255,255,0.1); padding: var(--pg-space-3); border-radius: 8px;">
            <span style="margin-right: var(--pg-space-2); font-size: 1.5rem;">🪙</span>
            <div>
              <strong>Crypto Markets</strong><br>
              <small>DexScreener & CoinGecko APIs</small>
            </div>
          </div>
          <div style="display: flex; align-items: center; background: rgba(255,255,255,0.1); padding: var(--pg-space-3); border-radius: 8px;">
            <span style="margin-right: var(--pg-space-2); font-size: 1.5rem;">🏈</span>
            <div>
              <strong>Sports Markets</strong><br>
              <small>ESPN Sports API</small>
            </div>
          </div>
        </div>
      </div>

      <div class="pg-card">
        <form id="templateMarketForm" style="display: grid; gap: var(--pg-space-5);">

          <!-- Template Selection -->
          <div>
            <label style="display: block; margin-bottom: var(--pg-space-3); font-weight: 700; font-size: 1.1rem; color: var(--pg-dark-700);">
              📋 Market Template
            </label>
            <select id="templateType" name="templateType" required style="width: 100%; padding: var(--pg-space-4); border: 2px solid var(--pg-dark-300); border-radius: 8px; font-size: 1rem; background: white; color: #333;">
              <option value="">🎯 Choose a verified template...</option>
              <option value="CRYPTO_PRICE_DIRECTION">🪙 Token Price Direction (up/down by %)</option>
              <option value="CRYPTO_DAILY_CHANGE">📈 Token Daily Change (24h % move)</option>
              <option value="CRYPTO_VOLUME">📊 Token Volume Threshold</option>
              <option value="SPORTS_WINNER">🏈 Sports Game Winner</option>
              <option value="SPORTS_TOTAL">🎯 Sports Total Points (Over/Under)</option>
              <option value="SPORTS_SPREAD">📊 Sports Point Spread</option>
            </select>
            <div id="templateDescription" style="margin-top: var(--pg-space-2); padding: var(--pg-space-3); background: var(--pg-blue-50); border-radius: 6px; color: var(--pg-blue-800); display: none;">
            </div>
          </div>

          <!-- Betting Token -->
          <div>
            <label style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600;">
              💰 Betting Token
            </label>
            <select name="tokenSymbol" required style="width: 100%; padding: var(--pg-space-3); border: 1px solid var(--pg-dark-300); border-radius: 8px;">
              <option value="">Select token...</option>
              ${activeTokens.map(token => `
                <option value="${token.symbol}">${token.symbol}</option>
              `).join('')}
            </select>
          </div>

          <!-- Dynamic Template Parameters -->
          <div id="templateParams" style="display: none; border: 2px solid var(--pg-green-200); border-radius: 10px; padding: var(--pg-space-4); background: var(--pg-green-50);">
            <!-- Will be populated by JavaScript -->
          </div>

          <!-- Timeframe -->
          <div>
            <label style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600;">
              ⏰ Resolution Timeframe
            </label>
            <select id="timeframe" name="timeframe" required style="width: 100%; padding: var(--pg-space-3); border: 1px solid var(--pg-dark-300); border-radius: 8px;">
              <option value="">Select timeframe...</option>
              <option value="1h">1 Hour</option>
              <option value="24h">24 Hours</option>
              <option value="7d">7 Days</option>
              <option value="custom">Custom Date/Time</option>
            </select>
            <input type="datetime-local" id="customTime" name="customTime" style="width: 100%; padding: var(--pg-space-3); border: 1px solid var(--pg-dark-300); border-radius: 8px; margin-top: var(--pg-space-2); display: none;">
          </div>

          <!-- API Data Preview -->
          <div id="apiPreview" style="display: none; border: 2px solid var(--pg-blue-200); border-radius: 10px; padding: var(--pg-space-4); background: var(--pg-blue-50);">
            <h3 style="margin: 0 0 var(--pg-space-2) 0; color: var(--pg-blue-800);">📡 Live API Data</h3>
            <div id="apiData" style="font-family: monospace; font-size: 0.9rem; color: var(--pg-blue-700);">
              <!-- Real-time data will be displayed here -->
            </div>
          </div>

          <!-- Submit Button -->
          <div style="text-align: center; margin-top: var(--pg-space-4);">
            <button type="submit" class="pg-btn pg-btn--primary" style="padding: var(--pg-space-4) var(--pg-space-8); font-size: 1.1rem; font-weight: 600;">
              🚀 Create Bulletproof Market
            </button>
            <a href="/pengubook/markets" class="pg-btn pg-btn--secondary" style="margin-left: var(--pg-space-3); padding: var(--pg-space-4) var(--pg-space-6);">
              Cancel
            </a>
          </div>

        </form>
      </div>
    </div>

    <script>
      const templateDefinitions = {
        'CRYPTO_PRICE_DIRECTION': {
          name: 'Token Price Direction',
          description: '📈 Predict if a token will go up/down by a specific percentage within timeframe. Uses real-time DexScreener/CoinGecko price data.',
          params: ['tokenSymbol', 'percentage', 'direction'],
          sampleData: 'Current BTC price: $43,250. Target: +15% = $49,737.50'
        },
        'CRYPTO_DAILY_CHANGE': {
          name: 'Token Daily Change',
          description: '📊 Predict if a token will have 24h price change above/below threshold. Uses 24h change data from APIs.',
          params: ['tokenSymbol', 'changeThreshold', 'direction'],
          sampleData: 'ETH 24h change: +3.2%. Threshold: ±5%'
        },
        'CRYPTO_VOLUME': {
          name: 'Token Volume Threshold',
          description: '📈 Predict if a token will exceed volume threshold in timeframe. Uses real-time volume data.',
          params: ['tokenSymbol', 'volumeThreshold', 'timeframe'],
          sampleData: 'SOL 24h volume: $1.2B. Threshold: $2B'
        },
        'SPORTS_WINNER': {
          name: 'Sports Game Winner',
          description: '🏈 Predict which team will win. Auto-resolved via ESPN Sports API using official game results.',
          params: ['gameId', 'teamSelection'],
          sampleData: 'Lakers vs Celtics - Game ID: 401547504'
        },
        'SPORTS_TOTAL': {
          name: 'Sports Total Points',
          description: '🎯 Over/Under total points in game. Uses official ESPN API final scores for resolution.',
          params: ['gameId', 'totalLine', 'overUnder'],
          sampleData: 'Game total: 218.5 points. Final: Lakers 110, Celtics 108 (218 total)'
        },
        'SPORTS_SPREAD': {
          name: 'Sports Point Spread',
          description: '📊 Point spread betting. Team must win by margin or lose by less than spread. ESPN API resolution.',
          params: ['gameId', 'spreadTeam', 'spreadPoints'],
          sampleData: 'Lakers -7.5 vs Celtics. Lakers win 115-105 (covers spread)'
        }
      };

      // Template selection handler
      document.getElementById('templateType').addEventListener('change', function(e) {
        const templateKey = e.target.value;
        const template = templateDefinitions[templateKey];

        const descElement = document.getElementById('templateDescription');
        const paramsElement = document.getElementById('templateParams');

        if (template) {
          descElement.innerHTML = \`
            <div style="margin-bottom: var(--pg-space-2);">
              <strong>\${template.name}</strong>
            </div>
            <div style="margin-bottom: var(--pg-space-2); font-size: 0.9rem;">
              \${template.description}
            </div>
            <div style="font-size: 0.85rem; font-style: italic; color: var(--pg-blue-600);">
              Example: \${template.sampleData}
            </div>
          \`;
          descElement.style.display = 'block';

          paramsElement.innerHTML = generateTemplateParams(templateKey, template);
          paramsElement.style.display = 'block';
        } else {
          descElement.style.display = 'none';
          paramsElement.style.display = 'none';
        }
      });

      // Timeframe handler
      document.getElementById('timeframe').addEventListener('change', function(e) {
        const customTime = document.getElementById('customTime');
        if (e.target.value === 'custom') {
          customTime.style.display = 'block';
          customTime.required = true;
        } else {
          customTime.style.display = 'none';
          customTime.required = false;
        }
      });

      function generateTemplateParams(templateKey, template) {
        let html = \`<h3 style="margin: 0 0 var(--pg-space-3) 0; color: var(--pg-green-800);">🎯 Template Parameters</h3>\`;

        if (templateKey === 'CRYPTO_PRICE_DIRECTION') {
          html += \`
            <!-- Abstract Chain Priority Notice -->
            <div style="background: linear-gradient(135deg, #8B5CF6, #06B6D4); padding: var(--pg-space-3); border-radius: 8px; margin-bottom: var(--pg-space-4);">
              <div style="color: white; font-weight: 600; margin-bottom: var(--pg-space-1);">⭐ Abstract Chain Priority</div>
              <div style="color: white; opacity: 0.9; font-size: 0.9rem;">Abstract ecosystem tokens are prioritized. Use contract addresses for guaranteed accuracy.</div>
            </div>

            <!-- Quick Select Abstract Tokens -->
            <div style="margin-bottom: var(--pg-space-4);">
              <label style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600; color: var(--pg-dark-700);">⭐ Abstract Tokens</label>
              <div style="display: flex; gap: var(--pg-space-2); flex-wrap: wrap;">
                <button type="button" onclick="selectToken('ABSTER')" style="background: linear-gradient(135deg, #8B5CF6, #06B6D4); color: white; border: none; padding: var(--pg-space-2) var(--pg-space-3); border-radius: 6px; cursor: pointer; font-size: 0.9rem;">ABSTER</button>
                <!-- Add more Abstract tokens when available -->
              </div>
            </div>

            <!-- Quick Select Popular Tokens -->
            <div style="margin-bottom: var(--pg-space-4);">
              <label style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600; color: var(--pg-dark-700);">🔥 Popular Tokens</label>
              <div style="display: flex; gap: var(--pg-space-2); flex-wrap: wrap;">
                <button type="button" onclick="selectToken('BTC')" style="background: #F97316; color: white; border: none; padding: var(--pg-space-2) var(--pg-space-3); border-radius: 6px; cursor: pointer; font-size: 0.9rem;">BTC</button>
                <button type="button" onclick="selectToken('ETH')" style="background: #3B82F6; color: white; border: none; padding: var(--pg-space-2) var(--pg-space-3); border-radius: 6px; cursor: pointer; font-size: 0.9rem;">ETH</button>
                <button type="button" onclick="selectToken('PENGU')" style="background: #EC4899; color: white; border: none; padding: var(--pg-space-2) var(--pg-space-3); border-radius: 6px; cursor: pointer; font-size: 0.9rem;">PENGU</button>
                <button type="button" onclick="selectToken('PEPE')" style="background: #10B981; color: white; border: none; padding: var(--pg-space-2) var(--pg-space-3); border-radius: 6px; cursor: pointer; font-size: 0.9rem;">PEPE</button>
                <button type="button" onclick="selectToken('SHIB')" style="background: #F59E0B; color: white; border: none; padding: var(--pg-space-2) var(--pg-space-3); border-radius: 6px; cursor: pointer; font-size: 0.9rem;">SHIB</button>
                <button type="button" onclick="selectToken('ARB')" style="background: #6366F1; color: white; border: none; padding: var(--pg-space-2) var(--pg-space-3); border-radius: 6px; cursor: pointer; font-size: 0.9rem;">ARB</button>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: var(--pg-space-3);">
              <div>
                <label style="display: block; margin-bottom: var(--pg-space-1); font-weight: 600;">Token Symbol or Contract Address</label>
                <input type="text" id="tokenSymbolInput" name="tokenSymbol" required placeholder="BTC, ETH, PENGU or 0x123..."
                       onchange="fetchTokenPrice(this.value)"
                       style="width: 100%; padding: var(--pg-space-2); border: 1px solid var(--pg-dark-300); border-radius: 6px;">
                <div style="font-size: 0.8rem; color: var(--pg-dark-500); margin-top: var(--pg-space-1);">💡 Use contract address for exact match</div>
              </div>
              <div>
                <label style="display: block; margin-bottom: var(--pg-space-1); font-weight: 600;">Chain</label>
                <select id="chainSelect" name="preferredChain" onchange="updateChainSelection()" style="width: 100%; padding: var(--pg-space-2); border: 1px solid var(--pg-dark-300); border-radius: 6px; background: white; color: #333;">
                  <option value="abstract">⭐ Abstract (Priority)</option>
                  <option value="all" selected>All Chains</option>
                  <option value="ethereum">Ethereum</option>
                  <option value="arbitrum">Arbitrum</option>
                  <option value="base">Base</option>
                  <option value="polygon">Polygon</option>
                  <option value="optimism">Optimism</option>
                  <option value="bsc">BSC</option>
                </select>
              </div>
              <div>
                <label style="display: block; margin-bottom: var(--pg-space-1); font-weight: 600;">Percentage Change</label>
                <input type="number" name="percentage" required step="0.1" placeholder="15" min="-90" max="1000"
                       style="width: 100%; padding: var(--pg-space-2); border: 1px solid var(--pg-dark-300); border-radius: 6px;">
              </div>
              <div>
                <label style="display: block; margin-bottom: var(--pg-space-1); font-weight: 600;">Direction</label>
                <select name="direction" required style="width: 100%; padding: var(--pg-space-2); border: 1px solid var(--pg-dark-300); border-radius: 6px;">
                  <option value="up">📈 Up (Higher)</option>
                  <option value="down">📉 Down (Lower)</option>
                </select>
              </div>
            </div>
          \`;
        } else if (templateKey === 'CRYPTO_DAILY_CHANGE') {
          html += \`
            <!-- Abstract Chain Priority Notice -->
            <div style="background: linear-gradient(135deg, #8B5CF6, #06B6D4); padding: var(--pg-space-3); border-radius: 8px; margin-bottom: var(--pg-space-4);">
              <div style="color: white; font-weight: 600; margin-bottom: var(--pg-space-1);">⭐ Abstract Chain Priority</div>
              <div style="color: white; opacity: 0.9; font-size: 0.9rem;">Abstract ecosystem tokens are prioritized. Use contract addresses for guaranteed accuracy.</div>
            </div>

            <!-- Quick Select Popular Tokens -->
            <div style="margin-bottom: var(--pg-space-4);">
              <label style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600; color: var(--pg-dark-700);">🔥 Popular Tokens</label>
              <div style="display: flex; gap: var(--pg-space-2); flex-wrap: wrap;">
                <button type="button" onclick="selectToken('BTC')" style="background: #F97316; color: white; border: none; padding: var(--pg-space-2) var(--pg-space-3); border-radius: 6px; cursor: pointer; font-size: 0.9rem;">BTC</button>
                <button type="button" onclick="selectToken('ETH')" style="background: #3B82F6; color: white; border: none; padding: var(--pg-space-2) var(--pg-space-3); border-radius: 6px; cursor: pointer; font-size: 0.9rem;">ETH</button>
                <button type="button" onclick="selectToken('PENGU')" style="background: #EC4899; color: white; border: none; padding: var(--pg-space-2) var(--pg-space-3); border-radius: 6px; cursor: pointer; font-size: 0.9rem;">PENGU</button>
                <button type="button" onclick="selectToken('PEPE')" style="background: #10B981; color: white; border: none; padding: var(--pg-space-2) var(--pg-space-3); border-radius: 6px; cursor: pointer; font-size: 0.9rem;">PEPE</button>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: var(--pg-space-3);">
              <div>
                <label style="display: block; margin-bottom: var(--pg-space-1); font-weight: 600;">Token Symbol or Contract Address</label>
                <input type="text" id="tokenSymbolInput" name="tokenSymbol" required placeholder="BTC, ETH, PENGU or 0x123..."
                       onchange="fetchTokenPrice(this.value)"
                       style="width: 100%; padding: var(--pg-space-2); border: 1px solid var(--pg-dark-300); border-radius: 6px;">
                <div style="font-size: 0.8rem; color: var(--pg-dark-500); margin-top: var(--pg-space-1);">💡 Use contract address for exact match</div>
              </div>
              <div>
                <label style="display: block; margin-bottom: var(--pg-space-1); font-weight: 600;">Chain</label>
                <select id="chainSelect" name="preferredChain" onchange="updateChainSelection()" style="width: 100%; padding: var(--pg-space-2); border: 1px solid var(--pg-dark-300); border-radius: 6px; background: white; color: #333;">
                  <option value="abstract">⭐ Abstract (Priority)</option>
                  <option value="all" selected>All Chains</option>
                  <option value="ethereum">Ethereum</option>
                  <option value="arbitrum">Arbitrum</option>
                  <option value="base">Base</option>
                  <option value="polygon">Polygon</option>
                  <option value="optimism">Optimism</option>
                  <option value="bsc">BSC</option>
                </select>
              </div>
              <div>
                <label style="display: block; margin-bottom: var(--pg-space-1); font-weight: 600;">Change Threshold (%)</label>
                <input type="number" name="changeThreshold" required step="0.1" placeholder="5" min="0.1" max="50"
                       style="width: 100%; padding: var(--pg-space-2); border: 1px solid var(--pg-dark-300); border-radius: 6px;">
              </div>
            </div>
          \`;
        } else if (templateKey === 'SPORTS_WINNER') {
          html += \`
            <div style="margin-bottom: var(--pg-space-3); padding: var(--pg-space-3); background: var(--pg-yellow-50); border: 1px solid var(--pg-yellow-200); border-radius: 6px;">
              <div style="color: var(--pg-yellow-800); font-weight: 600;">⚠️ Sports API Required</div>
              <div style="color: var(--pg-yellow-700); font-size: 0.9rem;">Enter valid ESPN API game ID for automatic resolution</div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--pg-space-3);">
              <div>
                <label style="display: block; margin-bottom: var(--pg-space-1); font-weight: 600;">ESPN Game ID</label>
                <input type="text" name="gameId" required placeholder="401547504"
                       onchange="fetchGameInfo(this.value)"
                       style="width: 100%; padding: var(--pg-space-2); border: 1px solid var(--pg-dark-300); border-radius: 6px;">
              </div>
              <div>
                <label style="display: block; margin-bottom: var(--pg-space-1); font-weight: 600;">Team to Win</label>
                <select name="teamSelection" required style="width: 100%; padding: var(--pg-space-2); border: 1px solid var(--pg-dark-300); border-radius: 6px;">
                  <option value="">Select after entering Game ID...</option>
                </select>
              </div>
            </div>
          \`;
        }

        html += \`
          <div style="margin-top: var(--pg-space-3); padding: var(--pg-space-2); background: var(--pg-green-100); border-radius: 6px; font-size: 0.9rem; color: var(--pg-green-800);">
            ✅ This template guarantees 100% API-based resolution - no disputes possible
          </div>
        \`;

        return html;
      }

      // Quick select token function
      function selectToken(tokenSymbol) {
        const tokenInput = document.getElementById('tokenSymbolInput');
        if (tokenInput) {
          tokenInput.value = tokenSymbol;
          fetchTokenPrice(tokenSymbol);
        }
      }

      // Chain selection handler
      function updateChainSelection() {
        const chainSelect = document.getElementById('chainSelect');
        const selectedChain = chainSelect.value;

        // Re-fetch token price with new chain preference if token is already entered
        const tokenInput = document.getElementById('tokenSymbolInput');
        if (tokenInput && tokenInput.value) {
          fetchTokenPrice(tokenInput.value, selectedChain);
        }
      }

      // Enhanced token price fetching with Abstract priority and chain support
      async function fetchTokenPrice(tokenSymbol, preferredChain = null) {
        if (!tokenSymbol || tokenSymbol.length < 2) return;

        const apiPreview = document.getElementById('apiPreview');
        const apiData = document.getElementById('apiData');

        apiPreview.style.display = 'block';
        apiData.innerHTML = '🔍 Searching with Abstract priority...';

        try {
          // Get selected chain if not provided
          if (!preferredChain) {
            const chainSelect = document.getElementById('chainSelect');
            preferredChain = chainSelect ? chainSelect.value : 'all';
          }

          // Check if it's a contract address
          const isContractAddress = tokenSymbol.startsWith('0x') && tokenSymbol.length === 42;

          const response = await fetch(\`/pengubook/api/token-price/\${tokenSymbol}?chain=\${preferredChain}\`);
          const data = await response.json();

          if (data.success && data.price) {
            const chainIndicator = data.chain === 'abstract' ? '⭐ Abstract' : data.chain;
            const contractAddressInfo = isContractAddress ? \`<div>📍 Contract Address Verified</div>\` : '';
            const warningInfo = data.warning ? \`<div style="color: #F59E0B;">⚠️ \${data.warning}</div>\` : '';

            // Enhanced token preview with chain emphasis
            apiData.innerHTML = \`
              <div style="border: 2px solid \${data.chain === 'abstract' ? '#8B5CF6' : '#10B981'}; border-radius: 8px; padding: var(--pg-space-3); background: \${data.chain === 'abstract' ? 'linear-gradient(135deg, #8B5CF6, #06B6D4)' : '#F0FDF4'}; color: \${data.chain === 'abstract' ? 'white' : 'inherit'};">
                <h4 style="margin: 0 0 var(--pg-space-2) 0; color: \${data.chain === 'abstract' ? 'white' : 'var(--pg-green-800)'};">
                  \${data.chain === 'abstract' ? '⭐' : '✅'} Token Details
                </h4>
                <div><strong>Symbol:</strong> \${tokenSymbol.toUpperCase()}</div>
                <div><strong>Price:</strong> $\${data.price.toFixed(6)}</div>
                <div><strong>Chain:</strong> \${chainIndicator} \${data.chain === 'abstract' ? '(PRIORITY)' : ''}</div>
                <div><strong>24h Volume:</strong> $\${data.volume24h ? data.volume24h.toLocaleString() : 'N/A'}</div>
                <div><strong>Liquidity:</strong> $\${data.liquidity ? data.liquidity.toLocaleString() : 'N/A'}</div>
                <div><strong>24h Change:</strong> \${data.change24h ? data.change24h.toFixed(2) + '%' : 'N/A'}</div>
                \${contractAddressInfo}
                \${warningInfo}
                <div style="margin-top: var(--pg-space-2); \${data.chain === 'abstract' ? 'color: white; opacity: 0.9;' : 'color: var(--pg-green-700);'}">
                  \${data.chain === 'abstract' ? '⭐ Abstract ecosystem token - highest priority!' : '✅ Token verified - market will resolve automatically'}
                </div>
                \${data.isVerifiedToken ? '<div style="margin-top: var(--pg-space-1); font-size: 0.9rem; color: inherit;">🎯 Verified token with enhanced filtering</div>' : ''}
              </div>
            \`;
          } else {
            apiData.innerHTML = \`
              <div style="border: 2px solid #EF4444; border-radius: 8px; padding: var(--pg-space-3); background: #FEF2F2;">
                <div style="color: var(--pg-red-600);">❌ Token not found</div>
                <div style="font-size: 0.9rem; margin-top: var(--pg-space-1);">
                  <strong>Suggestions:</strong><br>
                  • Try a different chain from the dropdown<br>
                  • Use the contract address (0x123...) for exact match<br>
                  • Check if the token symbol is correct<br>
                  • Use quick-select buttons for verified tokens
                </div>
                \${data.error ? \`<div style="margin-top: var(--pg-space-2); font-size: 0.8rem; color: var(--pg-red-500);">Error: \${data.error}</div>\` : ''}
              </div>
            \`;
          }
        } catch (error) {
          apiData.innerHTML = \`
            <div style="border: 2px solid #EF4444; border-radius: 8px; padding: var(--pg-space-3); background: #FEF2F2;">
              <div style="color: var(--pg-red-600);">❌ API Error: \${error.message}</div>
            </div>
          \`;
        }
      }

      async function fetchGameInfo(gameId) {
        if (!gameId) return;

        // Mock implementation - would fetch from sports API
        const teamSelect = document.querySelector('select[name="teamSelection"]');
        teamSelect.innerHTML = \`
          <option value="">Loading game info...</option>
        \`;

        // Simulate API call
        setTimeout(() => {
          teamSelect.innerHTML = \`
            <option value="">Select team to win...</option>
            <option value="home">Home Team (from API)</option>
            <option value="away">Away Team (from API)</option>
          \`;
        }, 1000);
      }

      // Form submission
      document.getElementById('templateMarketForm').addEventListener('submit', async function(e) {
        e.preventDefault();

        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        // Add timeframe logic
        if (data.timeframe && data.timeframe !== 'custom') {
          const now = new Date();
          const timeframes = {
            '1h': 3600000,
            '24h': 86400000,
            '7d': 604800000
          };
          const resolveTime = new Date(now.getTime() + timeframes[data.timeframe]);
          data.resolveAt = resolveTime.toISOString();
        } else if (data.customTime) {
          data.resolveAt = new Date(data.customTime).toISOString();
        }

        try {
          const response = await fetch('/pengubook/markets/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });

          const result = await response.json();

          if (result.success) {
            window.location.href = result.redirectUrl;
          } else {
            alert('❌ Failed to create market: ' + result.error);
          }
        } catch (error) {
          alert('❌ Network error: ' + error.message);
        }
      });
    </script>
  `;
}