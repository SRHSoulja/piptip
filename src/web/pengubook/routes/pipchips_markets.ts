// src/web/pengubook/routes/pipchips_markets.ts - PIPChips prediction markets in PenguBook
import { Request, Response } from "express";
import { getCurrentUser } from "../../auth.js";
import { generateBaseHTML } from "../templates.js";
import { prisma } from "../../../services/db.js";
import { pipchipsLMSR, PIPChipsLMSR } from "../../../services/pipchips_lmsr.js";
import { pipchipsService } from "../../../services/pipchips_service.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { Decimal } from 'decimal.js';

export async function pipchipsMarketsHandler(req: Request, res: Response) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.redirect("/auth/discord");
    }

    const { status = "active", limit = "20", offset = "0" } = req.query;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const offsetNum = parseInt(offset as string) || 0;

    // Build query filters - only show PIPChips markets (all markets now use PIPChips)
    const where: any = {
      tokenSymbol: 'PIPCHIPS'
    };

    if (status === "active") {
      where.status = 'ACTIVE';
      where.resolveAt = { gt: new Date() };
    } else if (status === "resolved") {
      where.status = 'RESOLVED';
    }

    // Ensure user exists in database
    const dbUser = await findOrCreateUser(currentUser.discordId);

    const [markets, totalMarkets, userBalance] = await Promise.all([
      prisma.predictionMarket.findMany({
        where,
        orderBy: [
          { totalPipchipsVolume: 'desc' },
          { createdAt: 'desc' }
        ],
        take: limitNum,
        skip: offsetNum,
        include: {
          _count: {
            select: { participations: { where: { tokenSymbol: 'PIPCHIPS' } } }
          }
        }
      }),
      prisma.predictionMarket.count({ where }),
      pipchipsService.getUserBalance(currentUser.discordId)
    ]);

    // Calculate live LMSR prices for each market
    const marketsWithPrices = markets.map(market => {
      const lmsr = new PIPChipsLMSR(
        Number(market.liquidity) || 1000,
        market.marketOutcomes
      );

      // Parse current shares
      const currentShares: Record<string, Decimal> = {};
      if (market.lmsrShares && typeof market.lmsrShares === 'object') {
        for (const outcome of market.marketOutcomes) {
          const shares = (market.lmsrShares as any)[outcome] || '0';
          currentShares[outcome] = new Decimal(shares);
        }
      } else {
        // Default to zero shares for all outcomes
        for (const outcome of market.marketOutcomes) {
          currentShares[outcome] = new Decimal(0);
        }
      }

      // Calculate current prices
      const prices = lmsr.calculateAllPrices(currentShares);
      const pricesMap = prices.reduce((acc, p) => {
        acc[p.outcome] = {
          price: p.price.toNumber(),
          confidence: p.confidence.toNumber(),
          impliedProbability: (p.price.toNumber() * 100).toFixed(1)
        };
        return acc;
      }, {} as Record<string, any>);

      const timeLeft = market.resolveAt.getTime() - Date.now();
      const bettingClosed = timeLeft <= 0 || market.status !== 'ACTIVE';

      return {
        ...market,
        totalVolume: market.totalPipchipsVolume || 0,
        totalBets: market._count.participations,
        timeLeftMs: Math.max(0, timeLeft),
        bettingClosed,
        prices: pricesMap,
        outcomes: market.marketOutcomes,
        currency: 'PIPCHIPS'
      };
    });

    const content = generatePIPChipsMarketsPageContent(marketsWithPrices, {
      currentFilter: { status },
      pagination: {
        total: totalMarkets,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < totalMarkets
      },
      userBalance: Number(userBalance.balance),
      currentUser
    });

    const html = generateBaseHTML(content, "PIPChips Predictions - PenguBook", "pipchips-markets", { user: currentUser });
    res.send(html);

  } catch (error) {
    console.error('PIPChips markets page error:', error);
    res.status(500).send('Error loading PIPChips prediction markets');
  }
}

export async function pipchipsMarketDetailHandler(req: Request, res: Response) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.redirect("/auth/discord");
    }

    // Ensure user exists in database
    const dbUser = await findOrCreateUser(currentUser.discordId);

    const { marketId } = req.params;

    const market = await prisma.predictionMarket.findUnique({
      where: {
        id: marketId,
        tokenSymbol: 'PIPCHIPS'
      },
      include: {
        _count: {
          select: {
            participations: { where: { tokenSymbol: 'PIPCHIPS' } }
          }
        }
      }
    });

    if (!market) {
      return res.status(404).send('PIPChips market not found');
    }

    // Get user's participations on this market
    const userParticipations = await prisma.predictionParticipation.findMany({
      where: {
        marketId: marketId,
        userId: currentUser.discordId,
        tokenSymbol: 'PIPCHIPS'
      },
      orderBy: { createdAt: 'desc' }
    });

    // Get recent participation history
    const recentParticipations = await prisma.predictionParticipation.findMany({
      where: {
        marketId,
        tokenSymbol: 'PIPCHIPS'
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    // Get user balance and streak info
    const [userBalance, streakInfo] = await Promise.all([
      pipchipsService.getUserBalance(currentUser.discordId),
      pipchipsService.getStreakInfo(currentUser.discordId)
    ]);

    // Initialize LMSR for pricing
    const lmsr = new PIPChipsLMSR(
      Number(market.liquidity) || 1000,
      market.marketOutcomes
    );

    // Parse current shares
    const currentShares: Record<string, Decimal> = {};
    if (market.lmsrShares && typeof market.lmsrShares === 'object') {
      for (const outcome of market.marketOutcomes) {
        const shares = (market.lmsrShares as any)[outcome] || '0';
        currentShares[outcome] = new Decimal(shares);
      }
    } else {
      // Default to zero shares for all outcomes
      for (const outcome of market.marketOutcomes) {
        currentShares[outcome] = new Decimal(0);
      }
    }

    // Calculate current prices and market depth
    const prices = lmsr.calculateAllPrices(currentShares);
    const marketDepth = lmsr.getMarketDepth(currentShares);

    const pricesMap = prices.reduce((acc, p) => {
      acc[p.outcome] = {
        price: p.price.toNumber(),
        confidence: p.confidence.toNumber(),
        impliedProbability: (p.price.toNumber() * 100).toFixed(1)
      };
      return acc;
    }, {} as Record<string, any>);

    const timeLeft = market.resolveAt.getTime() - Date.now();
    const bettingClosed = timeLeft <= 0 || market.status !== 'ACTIVE';

    // Calculate potential payouts for different bet amounts
    const potentialBets = await Promise.all([10, 50, 100, 500, 1000].map(async (amount) => {
      const results: Record<string, any> = {};
      for (const outcome of market.marketOutcomes) {
        try {
          const costCalc = await lmsr.calculateBetCost(currentShares, outcome, BigInt(amount));
          results[outcome] = {
            amount,
            cost: Number(costCalc.actualCost),
            shares: costCalc.sharesPurchased.toNumber(),
            payout: costCalc.sharesPurchased.times(1000).toNumber(),
            odds: costCalc.sharesPurchased.times(1000).div(new Decimal(Number(costCalc.actualCost))).toNumber()
          };
        } catch (error) {
          results[outcome] = { amount, error: 'Cannot calculate' };
        }
      }
      return results;
    }));

    const content = generatePIPChipsMarketDetailContent({
      market: {
        ...market,
        totalVolume: market.totalPipchipsVolume || 0,
        totalBets: market._count.participations,
        timeLeftMs: Math.max(0, timeLeft),
        bettingClosed,
        prices: pricesMap,
        outcomes: market.marketOutcomes,
        marketDepth,
        currency: 'PIPCHIPS'
      },
      userParticipations,
      recentParticipations,
      userBalance: Number(userBalance.balance),
      streakInfo,
      potentialBets,
      currentUser
    });

    const html = generateBaseHTML(content, `${market.title} - PIPChips Market`, "pipchips-market-detail", { user: currentUser });
    res.send(html);

  } catch (error) {
    console.error('PIPChips market detail error:', error);
    res.status(500).send('Error loading PIPChips market details');
  }
}

// HTML content generators
function generatePIPChipsMarketsPageContent(markets: any[], options: any) {
  const { currentFilter, pagination, userBalance, currentUser } = options;

  return `
    <div class="pipchips-markets-page">
      <!-- PIPChips Balance Header -->
      <div class="pipchips-balance-header">
        <div class="balance-display">
          <img src="https://gmgnrepeat.com/pipchips.png" alt="PIPChips" class="pipchips-logo" />
          <div class="balance-info">
            <h2>${userBalance.toLocaleString()} PIPChips</h2>
            <p>Ready for predictions!</p>
          </div>
        </div>
        <div class="balance-actions">
          <button onclick="claimDailyBonus()" class="btn btn-primary">📅 Claim Daily</button>
          <button onclick="showBuyChipsModal()" class="btn btn-secondary">💰 Buy More</button>
        </div>
      </div>

      <!-- Market Filters -->
      <div class="market-filters">
        <h1>🎯 PIPChips Prediction Markets</h1>
        <div class="filter-tabs">
          <a href="?status=active" class="tab ${currentFilter.status === 'active' ? 'active' : ''}">
            Active Markets
          </a>
          <a href="?status=resolved" class="tab ${currentFilter.status === 'resolved' ? 'active' : ''}">
            Resolved
          </a>
        </div>
      </div>

      <!-- Low Balance Warning -->
      ${userBalance < 100 ? `
        <div class="low-balance-warning">
          <p>⚠️ Running low on PIPChips! Claim your daily bonus or buy more to continue predicting.</p>
        </div>
      ` : ''}

      <!-- Markets Grid -->
      <div class="markets-grid">
        ${markets.length === 0 ? `
          <div class="no-markets">
            <h3>No ${currentFilter.status} PIPChips markets found</h3>
            <p>Check back later for new prediction opportunities!</p>
          </div>
        ` : markets.map(market => generateMarketCard(market)).join('')}
      </div>

      <!-- Pagination -->
      ${generatePagination(pagination)}

      <!-- Info Box -->
      <div class="pipchips-info-box">
        <h3>💡 How PIPChips Predictions Work</h3>
        <ul>
          <li>Use your PIPChips to predict outcomes on various markets</li>
          <li>Prices adjust based on market activity using automated market making</li>
          <li>Winners receive 1,000 PIPChips per share when markets resolve</li>
          <li>Get more PIPChips daily in Discord or purchase with tokens</li>
        </ul>
      </div>
    </div>

    <style>
      .pipchips-balance-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 20px;
        border-radius: 12px;
        margin-bottom: 24px;
      }

      .balance-display {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .pipchips-logo {
        width: 48px;
        height: 48px;
        border-radius: 50%;
      }

      .balance-info h2 {
        margin: 0;
        font-size: 28px;
        font-weight: bold;
      }

      .balance-info p {
        margin: 4px 0 0;
        opacity: 0.9;
      }

      .balance-actions {
        display: flex;
        gap: 12px;
      }

      .btn {
        padding: 12px 20px;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
        transition: transform 0.2s;
      }

      .btn:hover {
        transform: translateY(-2px);
      }

      .btn-primary {
        background: #10b981;
        color: white;
      }

      .btn-secondary {
        background: #3b82f6;
        color: white;
      }

      .low-balance-warning {
        background: #fef3cd;
        border: 1px solid #facc15;
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 20px;
        text-align: center;
      }

      .markets-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
        gap: 20px;
      }

      .market-card {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 20px;
        background: white;
        transition: all 0.2s;
      }

      .market-card:hover {
        box-shadow: 0 8px 25px rgba(0,0,0,0.1);
        border-color: #3b82f6;
      }

      .market-outcomes {
        display: flex;
        gap: 12px;
        margin: 16px 0;
      }

      .outcome-chip {
        flex: 1;
        text-align: center;
        padding: 12px;
        border-radius: 8px;
        background: #f3f4f6;
        cursor: pointer;
        transition: all 0.2s;
      }

      .outcome-chip:hover {
        background: #e5e7eb;
      }

      .outcome-probability {
        font-weight: bold;
        color: #3b82f6;
        font-size: 18px;
      }

      .pipchips-info-box {
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 12px;
        padding: 20px;
        margin-top: 40px;
        color: #f3f4f6;
      }
      .pipchips-info-box h3 {
        color: #60a5fa;
        margin-bottom: 16px;
      }
      .pipchips-info-box ul {
        color: #d1d5db;
        line-height: 1.6;
      }
      .pipchips-info-box li {
        margin-bottom: 8px;
      }
    </style>

    <script>
      // JavaScript functions for button functionality
      async function claimDailyBonus() {
        try {
          const response = await fetch('/pengubook/api/claim-daily', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });

          const result = await response.json();

          if (result.success) {
            alert(\`Daily bonus claimed! You received \${result.data.bonusAmount} PIPChips. Current streak: \${result.data.newStreak} days.\`);
            location.reload(); // Refresh to update balance display
          } else {
            if (result.data && result.data.timeUntilNext) {
              const hours = Math.floor(result.data.timeUntilNext / (1000 * 60 * 60));
              const minutes = Math.floor((result.data.timeUntilNext % (1000 * 60 * 60)) / (1000 * 60));
              alert(\`Daily bonus already claimed! Next claim available in \${hours}h \${minutes}m.\`);
            } else {
              alert('Error: ' + result.error);
            }
          }
        } catch (error) {
          console.error('Daily claim error:', error);
          alert('Network error claiming daily bonus');
        }
      }

      async function showBuyChipsModal() {
        try {
          const response = await fetch('/pengubook/api/buy-chips-options');
          const result = await response.json();

          if (result.success) {
            const options = result.data.options;
            let modalContent = '<div style="text-align: left;"><h3>Buy PIPChips</h3>';

            options.forEach(option => {
              modalContent += \`
                <div style="border: 1px solid #ccc; padding: 12px; margin: 8px 0; border-radius: 8px; cursor: pointer;" onclick="purchaseChips('\${option.tokenId}', \${option.pipchipsAmount})">
                  <strong>\${option.pipchipsAmount.toLocaleString()} PIPChips</strong><br>
                  <span style="color: #666;">Cost: \${option.cost} \${option.tokenSymbol}</span><br>
                  <small style="color: #888;">Your balance: \${option.userBalance.toLocaleString()} \${option.tokenSymbol}</small>
                </div>
              \`;
            });

            modalContent += '</div>';

            // Create modal
            const modal = document.createElement('div');
            modal.style.cssText = \`
              position: fixed; top: 0; left: 0; width: 100%; height: 100%;
              background: rgba(0,0,0,0.8); z-index: 10000; padding: 20px;
              display: flex; align-items: center; justify-content: center;
            \`;

            const modalDiv = document.createElement('div');
            modalDiv.style.cssText = \`
              background: white; border-radius: 12px; padding: 24px;
              max-width: 400px; width: 100%;
            \`;

            modalDiv.innerHTML = modalContent + \`
              <div style="text-align: center; margin-top: 16px;">
                <button onclick="this.closest('div[style*=\"position: fixed\"]').remove()" style="background: #ef4444; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Close</button>
              </div>
            \`;

            modal.appendChild(modalDiv);
            document.body.appendChild(modal);

          } else {
            alert('Error loading purchase options: ' + result.error);
          }
        } catch (error) {
          console.error('Buy chips error:', error);
          alert('Network error loading purchase options');
        }
      }

      async function purchaseChips(tokenId, pipchipsAmount) {
        if (!confirm(\`Purchase \${pipchipsAmount.toLocaleString()} PIPChips?\`)) return;

        try {
          const response = await fetch('/api/buy-pipchips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tokenId, pipchipsAmount })
          });

          const result = await response.json();

          if (result.success) {
            alert(\`Successfully purchased \${pipchipsAmount.toLocaleString()} PIPChips!\`);
            // Close modal and reload
            document.querySelector('div[style*="position: fixed"]')?.remove();
            location.reload();
          } else {
            alert('Purchase failed: ' + result.error);
          }
        } catch (error) {
          console.error('Purchase error:', error);
          alert('Network error processing purchase');
        }
      }
    </script>
  `;
}

function generateMarketCard(market: any) {
  const timeLeft = market.timeLeftMs;
  const hours = Math.floor(timeLeft / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const timeText = days > 0 ? `${days} days` : `${hours} hours`;

  return `
    <div class="market-card">
      <div class="market-header">
        <h3><a href="/pengubook/pipchips/market/${market.id}">${market.title}</a></h3>
        <div class="market-meta">
          <span class="pipchips-volume">💰 ${market.totalVolume.toLocaleString()} PIPChips</span>
          <span class="time-left">⏰ ${market.bettingClosed ? 'Ended' : timeText}</span>
        </div>
      </div>

      <p class="market-description">${market.description}</p>

      <div class="market-outcomes">
        ${market.outcomes.map((outcome: string) => `
          <div class="outcome-chip" onclick="location.href='/pengubook/pipchips/market/${market.id}#bet-${outcome}'">
            <div class="outcome-name">${outcome}</div>
            <div class="outcome-probability">${market.prices[outcome]?.impliedProbability || '50.0'}%</div>
          </div>
        `).join('')}
      </div>

      <div class="market-stats">
        <span>${market.totalBets} bets</span>
        <span>Liquidity: ${market.liquidityParameter || 1000}</span>
      </div>
    </div>
  `;
}

function generatePIPChipsMarketDetailContent(data: any) {
  const { market, userParticipations, userBalance, streakInfo, potentialBets } = data;

  return `
    <div class="pipchips-market-detail">
      <div class="market-header">
        <h1>${market.title}</h1>
        <div class="market-status ${market.bettingClosed ? 'closed' : 'active'}">
          ${market.bettingClosed ? '⏰ Betting Closed' : '🟢 Active'}
        </div>
      </div>

      <div class="market-info">
        <p class="description">${market.description}</p>
        <div class="market-stats">
          <div class="stat">
            <span class="label">Total Volume</span>
            <span class="value">${market.totalVolume.toLocaleString()} PIPChips</span>
          </div>
          <div class="stat">
            <span class="label">Total Bets</span>
            <span class="value">${market.totalBets}</span>
          </div>
        </div>
      </div>

      <!-- User Balance -->
      <div class="user-balance">
        <img src="https://gmgnrepeat.com/pipchips.png" alt="PIPChips" class="pipchips-logo-small" />
        <span>Your Balance: <strong>${userBalance.toLocaleString()} PIPChips</strong></span>
        ${userBalance < 100 ? `
          <a href="discord://pip_daily" class="btn-small">Get More</a>
        ` : ''}
      </div>

      <!-- Betting Interface -->
      ${!market.bettingClosed ? `
        <div class="betting-section">
          <h3>Place Your Prediction</h3>
          <div class="outcome-betting">
            ${market.outcomes.map((outcome: string) => `
              <div class="outcome-bet-card">
                <h4>${outcome}</h4>
                <div class="current-price">
                  <span class="probability">${market.prices[outcome]?.impliedProbability || '50.0'}%</span>
                  <span class="price-label">Current Probability</span>
                </div>

                <div class="bet-amounts">
                  ${[10, 50, 100, 500].map(amount => `
                    <button class="bet-amount-btn"
                            onclick="placeBet('${market.id}', '${outcome}', ${amount})"
                            ${userBalance < amount ? 'disabled' : ''}>
                      ${amount} PIPChips
                      ${userBalance < amount ? '(Insufficient)' : ''}
                    </button>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- User's Participations -->
      ${userParticipations.length > 0 ? `
        <div class="user-participations-section">
          <h3>Your Predictions</h3>
          <div class="user-participations">
            ${userParticipations.map((participation: any) => `
              <div class="user-participation">
                <span class="participation-outcome">${participation.side}</span>
                <span class="participation-amount">${participation.amount} PIPChips</span>
                <span class="potential-payout">→ ${participation.potentialPayout.toLocaleString()} PIPChips</span>
                <span class="participation-date">${new Date(participation.createdAt).toLocaleDateString()}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>

    <script>
      async function placeBet(marketId, outcome, amount) {
        if (${userBalance} < amount) {
          alert('Insufficient PIPChips! Claim your daily bonus or buy more.');
          return;
        }

        if (!confirm(\`Place \${amount} PIPChips on \${outcome}?\`)) return;

        try {
          const response = await fetch('/api/pipchips/participate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marketId, outcome, pipchipsAmount: amount })
          });

          const result = await response.json();

          if (result.success) {
            alert(\`Participation placed successfully! You bought \${result.participation.sharesPurchased.toFixed(2)} shares.\`);
            location.reload();
          } else {
            alert('Error: ' + result.error);
          }
        } catch (error) {
          alert('Network error placing participation');
        }
      }
    </script>
  `;
}

function generatePagination(pagination: any) {
  const { total, limit, offset, hasMore } = pagination;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  return `
    <div class="pagination">
      ${offset > 0 ? `<a href="?offset=${Math.max(0, offset - limit)}" class="btn">← Previous</a>` : ''}
      <span class="page-info">Page ${currentPage} of ${totalPages}</span>
      ${hasMore ? `<a href="?offset=${offset + limit}" class="btn">Next →</a>` : ''}
    </div>
  `;
}