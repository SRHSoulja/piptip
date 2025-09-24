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

    // Calculate live odds for each market
    const marketsWithOdds = markets.map(market => {
      const marketObj = predictionMarkets['mapDbMarket'](market);
      const odds = predictionMarkets.calculateOdds(marketObj);
      const totalPool = market.totalYesBets + market.totalNoBets;
      const timeLeft = market.resolveAt.getTime() - Date.now();

      return {
        ...market,
        totalPool,
        timeLeftMs: Math.max(0, timeLeft),
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

    const marketWithOdds = {
      ...market,
      totalPool,
      timeLeftMs: Math.max(0, timeLeft),
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

export async function createMarketHandler(req: Request, res: Response) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    if (req.method === 'GET') {
      // Show create market form
      const activeTokens = await getActiveTokens();
      const templates = marketConfig.getConfig().templates;

      const content = generateCreateMarketContent({
        templates,
        tokens: activeTokens
      });

      const html = generateBaseHTML(content, "Create Prediction Market", "markets", { user: currentUser });
      return res.send(html);
    } else if (req.method === 'POST') {
      // Create the market
      const { title, description, marketType, resolveAt, tokenSymbol, marketData } = req.body;

      // Validate inputs
      if (!title || !description || !marketType || !resolveAt || !tokenSymbol) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields"
        });
      }

      const user = await findOrCreateUser(currentUser.discordId);

      // Create market via prediction markets service
      const market = await predictionMarkets.createMarket({
        title,
        description,
        resolveAt: new Date(resolveAt),
        creatorId: user.id.toString(),
        guildId: "web", // Mark as web-created
        channelId: "pengubook",
        tokenSymbol,
        marketType,
        marketData: JSON.parse(marketData || "{}")
      });

      return res.json({
        success: true,
        marketId: market.id,
        redirectUrl: `/pengubook/markets/${market.id}`
      });
    }
  } catch (error) {
    console.error('Create market error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to create market"
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
              <button onclick="placeBet('${market.id}', 'YES')" class="pg-btn pg-btn--yes">
                Predict YES
              </button>
              <button onclick="placeBet('${market.id}', 'NO')" class="pg-btn pg-btn--no">
                Predict NO
              </button>
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
              <strong>${timeLeft}</strong> remaining to place bets
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
            ${isActive && !userBet ? `
              <button onclick="placeBet('${market.id}', 'YES')" class="pg-btn pg-btn--yes pg-btn--large">
                Predict YES
              </button>
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
            ${isActive && !userBet ? `
              <button onclick="placeBet('${market.id}', 'NO')" class="pg-btn pg-btn--no pg-btn--large">
                Predict NO
              </button>
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

function generateCreateMarketContent(data: { templates: any; tokens: any[] }): string {
  const { templates, tokens } = data;

  return `
    <div class="pg-container">
      <h1 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">🔮 Create Prediction Market</h1>

      <div class="pg-card">
        <form id="createMarketForm" style="display: grid; gap: var(--pg-space-4);">

          <!-- Market Type Selection -->
          <div>
            <label style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600;">Market Type</label>
            <select id="marketType" name="marketType" required style="width: 100%; padding: var(--pg-space-3); border: 1px solid var(--pg-dark-300); border-radius: var(--pg-border-radius);">
              <option value="">Select a market type...</option>
              ${Object.entries(templates).map(([key, template]: [string, any]) => `
                <option value="${key}">${template.name}</option>
              `).join('')}
            </select>
            <small id="marketTypeDescription" style="color: var(--pg-dark-600);"></small>
          </div>

          <!-- Basic Market Info -->
          <div>
            <label style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600;">Market Title</label>
            <input type="text" name="title" required maxlength="200" placeholder="e.g., Will BTC reach $100,000 by Dec 31?"
                   style="width: 100%; padding: var(--pg-space-3); border: 1px solid var(--pg-dark-300); border-radius: var(--pg-border-radius);">
          </div>

          <div>
            <label style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600;">Description</label>
            <textarea name="description" required maxlength="500" rows="3" placeholder="Provide more details about the market..."
                      style="width: 100%; padding: var(--pg-space-3); border: 1px solid var(--pg-dark-300); border-radius: var(--pg-border-radius);"></textarea>
          </div>

          <!-- Token Selection -->
          <div>
            <label style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600;">Betting Token</label>
            <select name="tokenSymbol" required style="width: 100%; padding: var(--pg-space-3); border: 1px solid var(--pg-dark-300); border-radius: var(--pg-border-radius);">
              <option value="">Select token...</option>
              ${tokens.map(token => `
                <option value="${token.symbol}">${token.symbol}</option>
              `).join('')}
            </select>
          </div>

          <!-- Market-specific parameters -->
          <div id="marketParams" style="display: none;">
            <!-- Dynamic params will be inserted here -->
          </div>

          <!-- Resolution Time -->
          <div>
            <label style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600;">Resolution Time</label>
            <input type="datetime-local" name="resolveAt" required
                   style="width: 100%; padding: var(--pg-space-3); border: 1px solid var(--pg-dark-300); border-radius: var(--pg-border-radius);">
            <small style="color: var(--pg-dark-600);">When should this market be resolved?</small>
          </div>

          <!-- Submit Button -->
          <div style="text-align: center; margin-top: var(--pg-space-4);">
            <button type="submit" class="pg-btn pg-btn--primary" style="padding: var(--pg-space-3) var(--pg-space-6);">
              🔮 Create Market
            </button>
            <a href="/pengubook/markets" class="pg-btn pg-btn--secondary" style="margin-left: var(--pg-space-3);">
              Cancel
            </a>
          </div>

        </form>
      </div>
    </div>

    <script>
      const templates = ${JSON.stringify(templates)};

      function generateMarketParams(template) {
        let html = '<h3 style="color: var(--pg-dark-700); margin-bottom: var(--pg-space-3);">Market Parameters</h3>';

        if (template.marketType === 'CRYPTO_PRICE_TARGET') {
          html += \`
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--pg-space-3); margin-bottom: var(--pg-space-3);">
              <div>
                <label style="display: block; margin-bottom: var(--pg-space-1); font-weight: 600;">Token Symbol</label>
                <input type="text" name="cryptoToken" required placeholder="BTC, ETH, SOL..."
                       style="width: 100%; padding: var(--pg-space-2); border: 1px solid var(--pg-dark-300); border-radius: var(--pg-border-radius);">
              </div>
              <div>
                <label style="display: block; margin-bottom: var(--pg-space-1); font-weight: 600;">Target Price ($)</label>
                <input type="number" name="targetPrice" required step="0.01" placeholder="100000"
                       style="width: 100%; padding: var(--pg-space-2); border: 1px solid var(--pg-dark-300); border-radius: var(--pg-border-radius);">
              </div>
            </div>
          \`;
        }

        return html;
      }

      document.getElementById('marketType').addEventListener('change', function(e) {
        const templateKey = e.target.value;
        const template = templates[templateKey];
        const descElement = document.getElementById('marketTypeDescription');
        const paramsElement = document.getElementById('marketParams');

        if (template) {
          descElement.textContent = template.description;
          paramsElement.innerHTML = generateMarketParams(template);
          paramsElement.style.display = 'block';
        } else {
          descElement.textContent = '';
          paramsElement.style.display = 'none';
        }
      });

      document.getElementById('createMarketForm').addEventListener('submit', async function(e) {
        e.preventDefault();

        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        // Build market-specific data
        const marketData = {};
        if (data.cryptoToken) marketData.tokenSymbol = data.cryptoToken;
        if (data.targetPrice) marketData.targetPrice = parseFloat(data.targetPrice);

        data.marketData = JSON.stringify(marketData);

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
            alert('Failed to create market: ' + result.error);
          }
        } catch (error) {
          alert('Failed to create market: ' + error.message);
        }
      });
    </script>
  `;
}