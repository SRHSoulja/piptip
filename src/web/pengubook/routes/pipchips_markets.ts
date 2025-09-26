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

    const [markets, totalMarkets, userBalance, tierPerms] = await Promise.all([
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
      pipchipsService.getUserBalance(currentUser.discordId),
      // Get user tier permissions for market creation
      import('../../../services/tiers.js').then(mod => mod.checkMarketCreationPermission(currentUser.discordId))
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
      tierPerms,
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

    // Get user balance, streak info, and tier permissions
    const [userBalance, streakInfo, tierPerms] = await Promise.all([
      pipchipsService.getUserBalance(currentUser.discordId),
      pipchipsService.getStreakInfo(currentUser.discordId),
      // Import tiers service to check market creation permissions
      import('../../../services/tiers.js').then(mod => mod.checkMarketCreationPermission(currentUser.discordId))
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
      tierPerms,
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
  const { currentFilter, pagination, userBalance, tierPerms, currentUser } = options;

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

      <!-- Create Market Section (for users with permissions) -->
      ${tierPerms.allowed && tierPerms.permissions.canCreateMarkets ? `
        <div class="create-market-section">
          <div class="create-market-header">
            <h2>🎯 Create Prediction Market</h2>
            <p>Tier: <strong>${tierPerms.tierName || 'Free'}</strong></p>
            <button onclick="toggleCreateMarketForm()" class="btn btn-primary" id="createMarketToggle">+ Create Market</button>
          </div>

          <div id="createMarketForm" class="create-market-form" style="display: none;">
            <form onsubmit="createMarket(event)">
              <div class="form-row">
                <div class="form-group">
                  <label for="marketTitle">Market Title:</label>
                  <input type="text" id="marketTitle" name="title" required maxlength="200"
                         placeholder="Will Bitcoin reach $100k by end of year?">
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label for="marketDescription">Description:</label>
                  <textarea id="marketDescription" name="description" required maxlength="500" rows="3"
                            placeholder="Provide details about the market conditions and resolution criteria..."></textarea>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label for="marketResolveAt">Resolve Date:</label>
                  <input type="datetime-local" id="marketResolveAt" name="resolveAt" required>
                </div>
                <div class="form-group">
                  <label for="marketType">Market Type:</label>
                  <select id="marketType" name="marketType" required>
                    <option value="YES_NO">Yes/No</option>
                    <option value="BINARY">Binary</option>
                  </select>
                </div>
              </div>

              <div class="market-preview">
                <h4>Market Preview:</h4>
                <p><strong>Base Liquidity:</strong> 1,000+ PIPChips (tier bonus applied)</p>
                <p><strong>Market Fee:</strong> ${tierPerms.permissions?.customRakePercent || 3}%</p>
                <p><strong>Daily Limit:</strong> ${tierPerms.permissions?.dailyMarketLimit === 0 ? 'Unlimited' : tierPerms.permissions?.dailyMarketLimit || 1} markets</p>
              </div>

              <div class="form-actions">
                <button type="submit" class="btn btn-success">Create Market</button>
                <button type="button" onclick="toggleCreateMarketForm()" class="btn btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      ` : tierPerms.allowed ? `
        <div class="create-market-disabled">
          <p>💡 <strong>Want to create prediction markets?</strong> Upgrade your tier to unlock market creation with liquidity bonuses!</p>
        </div>
      ` : ''}

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

      .market-header h3 {
        margin: 0 0 8px 0;
      }

      .market-header h3 a {
        color: #1f2937;
        text-decoration: none;
        font-weight: 600;
      }

      .market-header h3 a:hover {
        color: #3b82f6;
      }

      .market-meta {
        display: flex;
        gap: 16px;
        color: #4b5563;
        font-size: 14px;
        margin-bottom: 12px;
      }

      .market-description {
        color: #374151;
        line-height: 1.6;
        margin: 12px 0;
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

      /* Create Market Styles */
      .create-market-section {
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 24px;
      }

      .create-market-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }

      .create-market-header h2 {
        margin: 0;
        color: #1f2937;
      }

      .create-market-header p {
        margin: 4px 0 0;
        color: #4b5563;
        font-size: 14px;
      }

      .create-market-form {
        border-top: 1px solid #e5e7eb;
        padding-top: 20px;
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr;
        gap: 20px;
        margin-bottom: 20px;
      }

      .form-row.two-cols {
        grid-template-columns: 1fr 1fr;
      }

      .form-group label {
        display: block;
        margin-bottom: 8px;
        font-weight: 600;
        color: #374151;
      }

      .form-group input, .form-group textarea, .form-group select {
        width: 100%;
        padding: 12px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 16px;
        font-family: inherit;
      }

      .form-group textarea {
        resize: vertical;
        min-height: 80px;
      }

      .market-preview {
        background: #f3f4f6;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 16px;
        margin: 20px 0;
      }

      .market-preview h4 {
        margin: 0 0 12px 0;
        color: #1f2937;
      }

      .market-preview p {
        margin: 8px 0;
        color: #4b5563;
      }

      .form-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        padding-top: 20px;
        border-top: 1px solid #e5e7eb;
      }

      .btn-success {
        background: #10b981;
        color: white;
      }

      .btn-success:hover {
        background: #059669;
      }

      .create-market-disabled {
        background: #fef3cd;
        border: 1px solid #facc15;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 24px;
        text-align: center;
      }

      @media (min-width: 768px) {
        .form-row {
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }

        .form-row.single {
          grid-template-columns: 1fr;
        }
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
                  <small style="color: #4b5563;">Your balance: \${option.userBalance.toLocaleString()} \${option.tokenSymbol}</small>
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

        // TODO: The /api/buy-pipchips endpoint needs to be implemented
        // For now, show a message that this feature is coming soon
        alert('PIPChips purchase feature coming soon! For now, you can earn PIPChips through daily bonuses and gameplay.');
        document.querySelector('div[style*="position: fixed"]')?.remove();
        return;

        /* Once the endpoint is implemented, uncomment this:
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
        */
      }

      // Create Market Functions
      function toggleCreateMarketForm() {
        const form = document.getElementById('createMarketForm');
        const button = document.getElementById('createMarketToggle');

        if (form.style.display === 'none') {
          form.style.display = 'block';
          button.textContent = '- Cancel';
          button.classList.remove('btn-primary');
          button.classList.add('btn-secondary');
        } else {
          form.style.display = 'none';
          button.textContent = '+ Create Market';
          button.classList.remove('btn-secondary');
          button.classList.add('btn-primary');
        }
      }

      async function createMarket(event) {
        event.preventDefault();

        const formData = new FormData(event.target);
        const marketData = {
          title: formData.get('title'),
          description: formData.get('description'),
          resolveAt: formData.get('resolveAt'),
          marketType: formData.get('marketType')
        };

        // Basic validation
        if (!marketData.title || !marketData.description || !marketData.resolveAt) {
          alert('Please fill in all required fields');
          return;
        }

        const resolveDate = new Date(marketData.resolveAt);
        const now = new Date();
        if (resolveDate <= now) {
          alert('Resolve date must be in the future');
          return;
        }

        // Minimum time validation (1 hour)
        const minTime = new Date(now.getTime() + 60 * 60 * 1000);
        if (resolveDate < minTime) {
          alert('Market must resolve at least 1 hour from now');
          return;
        }

        try {
          const response = await fetch('/pengubook/api/create-market', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(marketData)
          });

          const result = await response.json();

          if (result.success) {
            alert(\`Market created successfully! Market ID: \${result.market.id}\`);
            // Reset form
            event.target.reset();
            toggleCreateMarketForm();
            // Optionally refresh the page to show the new market
            setTimeout(() => location.reload(), 1000);
          } else {
            alert('Error creating market: ' + result.error);
          }
        } catch (error) {
          console.error('Market creation error:', error);
          alert('Network error creating market');
        }
      }
    </script>
  `;
}

function generateMarketCard(market: any) {
  const timeLeft = market.timeLeftMs;
  const hours = Math.floor(timeLeft / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

  // Better time formatting
  let timeText = '';
  if (market.bettingClosed) {
    timeText = 'Betting Closed';
  } else if (days > 0) {
    timeText = `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    timeText = `${hours}h ${minutes}m`;
  } else {
    timeText = `${minutes}m`;
  }

  // Calculate betting cutoff time (20% before resolution or from marketData)
  const bettingCutoffTime = market.marketData?.bettingCutoffTime ||
                            market.marketData?.bettingClosesAt ||
                            new Date(market.resolveAt).getTime() - (timeLeft * 0.2);
  const bettingTimeLeft = bettingCutoffTime - Date.now();
  const bettingClosed = bettingTimeLeft <= 0;

  let bettingStatus = '';
  if (bettingClosed) {
    bettingStatus = '<span style="color: #dc2626;">🔒 Betting closed</span>';
  } else {
    const bettingHours = Math.floor(bettingTimeLeft / (1000 * 60 * 60));
    const bettingMins = Math.floor((bettingTimeLeft % (1000 * 60 * 60)) / (1000 * 60));
    if (bettingHours > 0) {
      bettingStatus = `<span style="color: #059669;">✅ Betting closes in ${bettingHours}h ${bettingMins}m</span>`;
    } else {
      bettingStatus = `<span style="color: #ea580c;">⚠️ Betting closes in ${bettingMins}m</span>`;
    }
  }

  // Calculate how long ago market was created
  const createdAt = new Date(market.createdAt);
  const marketAge = Date.now() - createdAt.getTime();
  const ageHours = Math.floor(marketAge / (1000 * 60 * 60));
  const ageDays = Math.floor(ageHours / 24);

  let ageText = '';
  if (ageDays > 0) {
    ageText = `${ageDays}d ago`;
  } else if (ageHours > 0) {
    ageText = `${ageHours}h ago`;
  } else {
    const ageMins = Math.floor(marketAge / (1000 * 60));
    ageText = `${ageMins}m ago`;
  }

  // Market type badge
  const marketTypeBadge = market.marketData?.templateBased ?
    '<span class="market-badge" style="background: #3b82f6; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">AUTO</span>' : '';

  return `
    <div class="market-card">
      <div class="market-header">
        <h3><a href="/pengubook/pipchips/market/${market.id}">${market.title}</a></h3>
        <div class="market-meta">
          <span class="created-time" style="color: #4b5563; font-size: 12px;">📅 Created ${ageText}</span>
          ${marketTypeBadge}
        </div>
      </div>

      <p class="market-description">${market.description}</p>

      <div class="market-timing" style="background: #f3f4f6; padding: 12px; border-radius: 8px; margin: 12px 0;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span>⏰ Resolution: <strong>${timeText}</strong></span>
          <span>💰 Volume: <strong>${market.totalVolume.toLocaleString()} PIPChips</strong></span>
        </div>
        <div style="font-size: 14px;">
          ${bettingStatus}
        </div>
      </div>

      <div class="market-outcomes">
        ${market.outcomes.map((outcome: string) => `
          <div class="outcome-chip" onclick="location.href='/pengubook/pipchips/market/${market.id}#bet-${outcome}'">
            <div class="outcome-name">${outcome}</div>
            <div class="outcome-probability">${market.prices[outcome]?.impliedProbability || '50.0'}%</div>
          </div>
        `).join('')}
      </div>

      <div class="market-stats" style="display: flex; justify-content: space-between; color: #4b5563; font-size: 14px;">
        <span>👥 ${market.totalBets} bet${market.totalBets !== 1 ? 's' : ''}</span>
        <span>💧 Liquidity: ${market.liquidityParameter || 1000}</span>
        <span>📊 LMSR Market</span>
      </div>
    </div>
  `;
}

function generatePIPChipsMarketDetailContent(data: any) {
  const { market, userParticipations, userBalance, streakInfo, potentialBets } = data;

  return `
    <style>
      .pipchips-market-detail {
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
      }

      .market-header {
        border-bottom: 2px solid #e5e7eb;
        padding-bottom: 20px;
        margin-bottom: 30px;
      }

      .market-header h1 {
        margin: 0 0 10px 0;
        color: #1f2937;
        font-size: 24px;
      }

      .market-status {
        display: inline-block;
        padding: 6px 12px;
        border-radius: 6px;
        font-weight: 600;
        font-size: 14px;
      }

      .market-status.active {
        background: #d1fae5;
        color: #065f46;
      }

      .market-status.closed {
        background: #fecaca;
        color: #991b1b;
      }

      .market-info .description {
        color: #374151;
        font-size: 16px;
        line-height: 1.6;
        margin-bottom: 20px;
      }

      .market-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 20px;
        background: #f3f4f6;
        padding: 20px;
        border-radius: 8px;
        margin-bottom: 30px;
      }

      .market-stats .stat {
        text-align: center;
      }

      .market-stats .label {
        display: block;
        color: #6b7280;
        font-size: 14px;
        margin-bottom: 4px;
      }

      .market-stats .value {
        display: block;
        color: #1f2937;
        font-size: 18px;
        font-weight: 600;
      }

      .user-balance {
        display: flex;
        align-items: center;
        gap: 12px;
        background: #fef3cd;
        border: 1px solid #f59e0b;
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 30px;
      }

      .pipchips-logo-small {
        width: 32px !important;
        height: 32px !important;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .betting-section {
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 30px;
      }

      .betting-section h3 {
        margin: 0 0 20px 0;
        color: #1f2937;
      }

      .outcome-betting {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 20px;
      }

      .outcome-bet-card {
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 20px;
        background: #fafafa;
      }

      .outcome-bet-card h4 {
        margin: 0 0 12px 0;
        color: #1f2937;
        font-size: 18px;
      }

      .current-price {
        text-align: center;
        margin-bottom: 20px;
      }

      .probability {
        display: block;
        font-size: 24px;
        font-weight: bold;
        color: #3b82f6;
      }

      .price-label {
        display: block;
        color: #6b7280;
        font-size: 14px;
      }

      .bet-amounts {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }

      .bet-amount-btn {
        background: #10b981;
        color: white;
        border: none;
        padding: 12px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        transition: background 0.2s;
      }

      .bet-amount-btn:hover:not(:disabled) {
        background: #059669;
      }

      .bet-amount-btn:disabled {
        background: #d1d5db;
        color: #9ca3af;
        cursor: not-allowed;
      }

      .user-participations-section {
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 24px;
      }

      .user-participations-section h3 {
        margin: 0 0 20px 0;
        color: #1f2937;
      }

      .user-participation {
        display: grid;
        grid-template-columns: auto 1fr auto auto;
        gap: 12px;
        align-items: center;
        padding: 12px 0;
        border-bottom: 1px solid #f3f4f6;
      }

      .participation-outcome {
        background: #e5e7eb;
        color: #374151;
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: 600;
        font-size: 14px;
      }

      .participation-amount,
      .potential-payout {
        font-weight: 600;
        color: #1f2937;
      }

      .participation-date {
        color: #6b7280;
        font-size: 14px;
      }
    </style>

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
          const response = await fetch('/api/pipchips/bet', {
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