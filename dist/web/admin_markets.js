/**
 * Admin Markets Panel - Dedicated UI for Prediction Market Management
 *
 * Provides a comprehensive interface for:
 * - Viewing all markets (active, resolved, expired)
 * - Creating new markets (regular + tournament)
 * - Resolving markets (manual resolution)
 * - Configuring market settings
 * - Viewing market analytics
 * - Managing tournament markets (TPIP)
 */
import { Router } from "express";
import { prisma } from "../services/db.js";
import { predictionMarkets } from "../services/prediction_markets.js";
export const adminMarketsRouter = Router();
// Admin authentication middleware
function requireAdminAuth(req, res, next) {
    const adminSecret = process.env.ADMIN_SECRET;
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${adminSecret}`) {
        return res.status(403).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Unauthorized</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            color: white;
          }
          .error-container {
            text-align: center;
            background: rgba(255, 255, 255, 0.1);
            padding: 3rem;
            border-radius: 20px;
            backdrop-filter: blur(10px);
          }
          h1 { font-size: 4rem; margin: 0; }
          p { font-size: 1.5rem; opacity: 0.9; }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>🔒 403</h1>
          <p>Unauthorized Access</p>
          <p style="font-size: 1rem; margin-top: 2rem;">
            Admin authentication required
          </p>
        </div>
      </body>
      </html>
    `);
    }
    next();
}
// Apply auth to all routes
adminMarketsRouter.use(requireAdminAuth);
/**
 * GET /admin/markets - Main markets admin panel
 */
adminMarketsRouter.get("/markets", async (req, res) => {
    try {
        // Get market statistics
        const [totalMarkets, activeMarkets, resolvedMarkets, expiredMarkets] = await Promise.all([
            prisma.predictionMarket.count(),
            prisma.predictionMarket.count({ where: { status: 'ACTIVE' } }),
            prisma.predictionMarket.count({ where: { status: 'RESOLVED' } }),
            prisma.predictionMarket.count({
                where: {
                    status: 'ACTIVE',
                    resolveAt: { lt: new Date() }
                }
            })
        ]);
        // Get recent markets
        const recentMarkets = await prisma.predictionMarket.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
                _count: {
                    select: { participations: true }
                }
            }
        });
        // Calculate market details
        const marketsWithDetails = recentMarkets.map(market => {
            const totalPool = market.totalYesBets + market.totalNoBets;
            const timeLeft = market.resolveAt.getTime() - Date.now();
            const isExpired = timeLeft <= 0 && market.status === 'ACTIVE';
            // Calculate odds
            const yesOdds = totalPool > 0
                ? (totalPool / Math.max(market.totalYesBets, 0.01)).toFixed(2)
                : '2.00';
            const noOdds = totalPool > 0
                ? (totalPool / Math.max(market.totalNoBets, 0.01)).toFixed(2)
                : '2.00';
            return {
                ...market,
                totalPool,
                timeLeftMs: timeLeft,
                timeLeftHuman: isExpired
                    ? 'EXPIRED'
                    : timeLeft > 0
                        ? formatTimeLeft(timeLeft)
                        : 'Resolving soon',
                isExpired,
                participationCount: market._count.participations,
                yesOdds,
                noOdds
            };
        });
        // Render admin panel HTML
        res.send(generateMarketsAdminHTML({
            stats: {
                total: totalMarkets,
                active: activeMarkets,
                resolved: resolvedMarkets,
                expired: expiredMarkets
            },
            markets: marketsWithDetails
        }));
    }
    catch (error) {
        console.error("Admin markets panel error:", error);
        res.status(500).send(`
      <html>
        <body style="font-family: sans-serif; padding: 2rem;">
          <h1>Error Loading Admin Panel</h1>
          <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
        </body>
      </html>
    `);
    }
});
/**
 * POST /admin/markets/:id/resolve - Quick resolve from admin panel
 */
adminMarketsRouter.post("/markets/:id/resolve", async (req, res) => {
    try {
        const { id } = req.params;
        const { outcome } = req.body;
        if (!outcome || !['YES', 'NO', 'CANCEL'].includes(outcome)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid outcome. Must be YES, NO, or CANCEL'
            });
        }
        // Resolve market using admin endpoint
        const result = await predictionMarkets.resolveMarket(id, outcome);
        res.json({
            success: result.success,
            message: result.success
                ? `Market resolved as ${outcome}`
                : result.error,
            payoutCount: result.payouts?.length || 0
        });
    }
    catch (error) {
        console.error("Market resolution error:", error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Resolution failed'
        });
    }
});
/**
 * POST /admin/markets/create - Create new market from admin panel
 */
adminMarketsRouter.post("/markets/create", async (req, res) => {
    try {
        const { title, description, marketType, tokenSymbol, tournamentId, resolveAt, minBet, maxBet, rakePercentage, guildId } = req.body;
        // Validation
        if (!title || !description || !resolveAt) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: title, description, resolveAt'
            });
        }
        const resolveDate = new Date(resolveAt);
        if (resolveDate <= new Date()) {
            return res.status(400).json({
                success: false,
                error: 'Resolve date must be in the future'
            });
        }
        // Create market
        const market = await prisma.predictionMarket.create({
            data: {
                title,
                description,
                marketType: marketType || 'EVENT',
                tokenSymbol: tokenSymbol || 'PIPCHIPS',
                tournamentId: tournamentId || null,
                status: 'ACTIVE',
                resolveAt: resolveDate,
                minBet: minBet || 10,
                maxBet: maxBet || 10000,
                rakePercentage: rakePercentage || 5,
                guildId: guildId || null,
                totalYesBets: 0,
                totalNoBets: 0,
                totalBetCount: 0,
                totalPipchipsVolume: 0
            }
        });
        res.json({
            success: true,
            marketId: market.id,
            message: 'Market created successfully'
        });
    }
    catch (error) {
        console.error("Market creation error:", error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Creation failed'
        });
    }
});
/**
 * DELETE /admin/markets/:id - Delete market
 */
adminMarketsRouter.delete("/markets/:id", async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.predictionMarket.delete({
            where: { id }
        });
        res.json({
            success: true,
            message: 'Market deleted successfully'
        });
    }
    catch (error) {
        console.error("Market deletion error:", error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Deletion failed'
        });
    }
});
// Helper function to format time remaining
function formatTimeLeft(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0)
        return `${days}d ${hours % 24}h`;
    if (hours > 0)
        return `${hours}h ${minutes % 60}m`;
    if (minutes > 0)
        return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}
// Generate HTML for markets admin panel
function generateMarketsAdminHTML(data) {
    const { stats, markets } = data;
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prediction Markets Admin</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 2rem;
      color: #333;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    .header {
      background: white;
      padding: 2rem;
      border-radius: 16px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      margin-bottom: 2rem;
    }

    .header h1 {
      font-size: 2rem;
      color: #667eea;
      margin-bottom: 0.5rem;
    }

    .header p {
      color: #666;
      font-size: 1rem;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: white;
      padding: 1.5rem;
      border-radius: 12px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      transition: transform 0.2s;
    }

    .stat-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 16px rgba(0,0,0,0.15);
    }

    .stat-card h3 {
      font-size: 0.875rem;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0.5rem;
    }

    .stat-card .value {
      font-size: 2.5rem;
      font-weight: 700;
      color: #667eea;
    }

    .actions {
      background: white;
      padding: 1.5rem;
      border-radius: 12px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 2rem;
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .btn {
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
      display: inline-block;
    }

    .btn-primary {
      background: #667eea;
      color: white;
    }

    .btn-primary:hover {
      background: #5568d3;
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(102, 126, 234, 0.3);
    }

    .btn-secondary {
      background: #f3f4f6;
      color: #666;
    }

    .btn-secondary:hover {
      background: #e5e7eb;
    }

    .markets-container {
      background: white;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .markets-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid #f3f4f6;
    }

    .markets-header h2 {
      font-size: 1.5rem;
      color: #333;
    }

    .filter-tabs {
      display: flex;
      gap: 0.5rem;
    }

    .filter-tab {
      padding: 0.5rem 1rem;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: white;
      cursor: pointer;
      font-size: 0.875rem;
      transition: all 0.2s;
    }

    .filter-tab:hover {
      background: #f3f4f6;
    }

    .filter-tab.active {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }

    .market-card {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      transition: all 0.2s;
    }

    .market-card:hover {
      border-color: #667eea;
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }

    .market-card.expired {
      background: #fff7ed;
      border-color: #fb923c;
    }

    .market-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 1rem;
    }

    .market-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: #333;
      margin-bottom: 0.5rem;
    }

    .market-meta {
      display: flex;
      gap: 1rem;
      font-size: 0.875rem;
      color: #666;
      margin-bottom: 1rem;
    }

    .market-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-active {
      background: #d1fae5;
      color: #065f46;
    }

    .badge-resolved {
      background: #dbeafe;
      color: #1e40af;
    }

    .badge-expired {
      background: #fee2e2;
      color: #991b1b;
    }

    .badge-pipchips {
      background: #fef3c7;
      color: #92400e;
    }

    .badge-tpip {
      background: #e0e7ff;
      color: #3730a3;
    }

    .market-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
      padding: 1rem;
      background: #f9fafb;
      border-radius: 6px;
    }

    .stat-item {
      text-align: center;
    }

    .stat-label {
      font-size: 0.75rem;
      color: #666;
      text-transform: uppercase;
      margin-bottom: 0.25rem;
    }

    .stat-value {
      font-size: 1.25rem;
      font-weight: 700;
      color: #667eea;
    }

    .market-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .btn-small {
      padding: 0.5rem 1rem;
      font-size: 0.875rem;
    }

    .btn-success {
      background: #10b981;
      color: white;
    }

    .btn-success:hover {
      background: #059669;
    }

    .btn-danger {
      background: #ef4444;
      color: white;
    }

    .btn-danger:hover {
      background: #dc2626;
    }

    .btn-warning {
      background: #f59e0b;
      color: white;
    }

    .btn-warning:hover {
      background: #d97706;
    }

    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }

    .modal.active {
      display: flex;
    }

    .modal-content {
      background: white;
      padding: 2rem;
      border-radius: 12px;
      max-width: 600px;
      width: 90%;
      max-height: 90vh;
      overflow-y: auto;
    }

    .modal-header {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 1rem;
      color: #667eea;
    }

    .form-group {
      margin-bottom: 1.5rem;
    }

    .form-label {
      display: block;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: #333;
    }

    .form-input,
    .form-select,
    .form-textarea {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      font-size: 1rem;
      font-family: inherit;
    }

    .form-textarea {
      min-height: 100px;
      resize: vertical;
    }

    .form-input:focus,
    .form-select:focus,
    .form-textarea:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .form-actions {
      display: flex;
      gap: 1rem;
      justify-content: flex-end;
    }

    @media (max-width: 768px) {
      body {
        padding: 1rem;
      }

      .header h1 {
        font-size: 1.5rem;
      }

      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .market-stats {
        grid-template-columns: repeat(2, 1fr);
      }

      .actions {
        flex-direction: column;
      }

      .btn {
        width: 100%;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔮 Prediction Markets Admin</h1>
      <p>Manage all prediction markets, tournaments, and configurations</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <h3>Total Markets</h3>
        <div class="value">${stats.total}</div>
      </div>
      <div class="stat-card">
        <h3>Active Markets</h3>
        <div class="value">${stats.active}</div>
      </div>
      <div class="stat-card">
        <h3>Resolved Markets</h3>
        <div class="value">${stats.resolved}</div>
      </div>
      <div class="stat-card">
        <h3>Expired (Needs Resolution)</h3>
        <div class="value" style="color: ${stats.expired > 0 ? '#ef4444' : '#10b981'}">${stats.expired}</div>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" onclick="openCreateModal()">
        ➕ Create New Market
      </button>
      <button class="btn btn-warning" onclick="resolveAllExpired()">
        ⚡ Resolve All Expired
      </button>
      <a href="/admin" class="btn btn-secondary">
        ← Back to Admin
      </a>
    </div>

    <div class="markets-container">
      <div class="markets-header">
        <h2>All Markets</h2>
        <div class="filter-tabs">
          <button class="filter-tab active" onclick="filterMarkets('all')">All</button>
          <button class="filter-tab" onclick="filterMarkets('active')">Active</button>
          <button class="filter-tab" onclick="filterMarkets('expired')">Expired</button>
          <button class="filter-tab" onclick="filterMarkets('resolved')">Resolved</button>
        </div>
      </div>

      <div id="markets-list">
        ${markets.map(market => `
          <div class="market-card ${market.isExpired ? 'expired' : ''}" data-status="${market.status.toLowerCase()}" data-expired="${market.isExpired}">
            <div class="market-header">
              <div>
                <div class="market-title">${escapeHtml(market.title)}</div>
                <div class="market-meta">
                  <span class="market-badge badge-${market.status.toLowerCase()}">${market.status}</span>
                  <span class="market-badge badge-${market.tokenSymbol.toLowerCase()}">${market.tokenSymbol}</span>
                  <span>${market.marketType}</span>
                  <span>${market.timeLeftHuman}</span>
                </div>
              </div>
            </div>

            <div class="market-stats">
              <div class="stat-item">
                <div class="stat-label">Total Pool</div>
                <div class="stat-value">${market.totalPool}</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">YES Bets</div>
                <div class="stat-value">${market.totalYesBets}</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">NO Bets</div>
                <div class="stat-value">${market.totalNoBets}</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">Participants</div>
                <div class="stat-value">${market.participationCount}</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">YES Odds</div>
                <div class="stat-value">${market.yesOdds}x</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">NO Odds</div>
                <div class="stat-value">${market.noOdds}x</div>
              </div>
            </div>

            ${market.status === 'ACTIVE' ? `
              <div class="market-actions">
                <button class="btn btn-small btn-success" onclick="resolveMarket('${market.id}', 'YES')">
                  ✓ Resolve YES
                </button>
                <button class="btn btn-small btn-danger" onclick="resolveMarket('${market.id}', 'NO')">
                  ✗ Resolve NO
                </button>
                <button class="btn btn-small btn-warning" onclick="resolveMarket('${market.id}', 'CANCEL')">
                  ⊘ Cancel
                </button>
                <button class="btn btn-small btn-secondary" onclick="deleteMarket('${market.id}')">
                  🗑️ Delete
                </button>
              </div>
            ` : market.status === 'RESOLVED' ? `
              <div class="market-actions">
                <span style="color: #10b981; font-weight: 600;">
                  ${market.outcome === 'YES' ? '✓ Resolved YES' : market.outcome === 'NO' ? '✗ Resolved NO' : '⊘ Cancelled'}
                </span>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  </div>

  <!-- Create Market Modal -->
  <div id="createModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">Create New Market</div>
      <form id="createForm">
        <div class="form-group">
          <label class="form-label">Title *</label>
          <input type="text" class="form-input" name="title" required>
        </div>

        <div class="form-group">
          <label class="form-label">Description *</label>
          <textarea class="form-textarea" name="description" required></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Market Type *</label>
          <select class="form-select" name="marketType" required>
            <option value="CRYPTO">Crypto Price</option>
            <option value="SPORTS">Sports Outcome</option>
            <option value="EVENT">General Event</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Token *</label>
          <select class="form-select" name="tokenSymbol" required>
            <option value="PIPCHIPS">PIPChips (Regular)</option>
            <option value="TPIP">TPIP (Tournament)</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Resolve Date *</label>
          <input type="datetime-local" class="form-input" name="resolveAt" required>
        </div>

        <div class="form-group">
          <label class="form-label">Min Bet</label>
          <input type="number" class="form-input" name="minBet" value="10">
        </div>

        <div class="form-group">
          <label class="form-label">Max Bet</label>
          <input type="number" class="form-input" name="maxBet" value="10000">
        </div>

        <div class="form-group">
          <label class="form-label">Rake % (0-20)</label>
          <input type="number" class="form-input" name="rakePercentage" value="5" min="0" max="20">
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="closeCreateModal()">
            Cancel
          </button>
          <button type="submit" class="btn btn-primary">
            Create Market
          </button>
        </div>
      </form>
    </div>
  </div>

  <script>
    const ADMIN_SECRET = "${process.env.ADMIN_SECRET}";

    function openCreateModal() {
      document.getElementById('createModal').classList.add('active');
    }

    function closeCreateModal() {
      document.getElementById('createModal').classList.remove('active');
    }

    function filterMarkets(filter) {
      const cards = document.querySelectorAll('.market-card');
      const tabs = document.querySelectorAll('.filter-tab');

      tabs.forEach(tab => tab.classList.remove('active'));
      event.target.classList.add('active');

      cards.forEach(card => {
        const status = card.dataset.status;
        const expired = card.dataset.expired === 'true';

        if (filter === 'all') {
          card.style.display = 'block';
        } else if (filter === 'expired') {
          card.style.display = expired ? 'block' : 'none';
        } else {
          card.style.display = status === filter ? 'block' : 'none';
        }
      });
    }

    async function resolveMarket(marketId, outcome) {
      if (!confirm(\`Resolve this market as \${outcome}? This cannot be undone.\`)) {
        return;
      }

      try {
        const response = await fetch(\`/admin/markets/\${marketId}/resolve\`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${ADMIN_SECRET}\`
          },
          body: JSON.stringify({ outcome })
        });

        const result = await response.json();

        if (result.success) {
          alert(\`Market resolved successfully! \${result.payoutCount} payouts processed.\`);
          location.reload();
        } else {
          alert(\`Error: \${result.message || 'Resolution failed'}\`);
        }
      } catch (error) {
        alert(\`Error: \${error.message}\`);
      }
    }

    async function deleteMarket(marketId) {
      if (!confirm('Delete this market? This cannot be undone.')) {
        return;
      }

      try {
        const response = await fetch(\`/admin/markets/\${marketId}\`, {
          method: 'DELETE',
          headers: {
            'Authorization': \`Bearer \${ADMIN_SECRET}\`
          }
        });

        const result = await response.json();

        if (result.success) {
          alert('Market deleted successfully');
          location.reload();
        } else {
          alert(\`Error: \${result.error}\`);
        }
      } catch (error) {
        alert(\`Error: \${error.message}\`);
      }
    }

    async function resolveAllExpired() {
      if (!confirm('Resolve all expired markets? This will process all markets past their resolve date.')) {
        return;
      }

      try {
        const response = await fetch('/admin/prediction_markets/resolve-expired', {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${ADMIN_SECRET}\`
          }
        });

        const result = await response.json();
        alert(\`Resolved \${result.resolved} markets\`);
        location.reload();
      } catch (error) {
        alert(\`Error: \${error.message}\`);
      }
    }

    document.getElementById('createForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);

      try {
        const response = await fetch('/admin/markets/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${ADMIN_SECRET}\`
          },
          body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
          alert('Market created successfully!');
          location.reload();
        } else {
          alert(\`Error: \${result.error}\`);
        }
      } catch (error) {
        alert(\`Error: \${error.message}\`);
      }
    });

    // Close modal on background click
    document.getElementById('createModal').addEventListener('click', (e) => {
      if (e.target.id === 'createModal') {
        closeCreateModal();
      }
    });
  </script>
</body>
</html>
  `;
}
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}
