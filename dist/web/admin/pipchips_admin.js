import { Router } from "express";
import { prisma } from "../../services/db.js";
import { pipchipsService } from "../../services/pipchips_service.js";
import { pipchipsLMSR } from "../../services/pipchips_lmsr.js";
import { requireAuth } from "../auth.js";
const pipchipsAdminRouter = Router();
pipchipsAdminRouter.use(requireAuth);
pipchipsAdminRouter.get("/", async (req, res) => {
  try {
    const stats = await pipchipsService.getSystemStats();
    const recentTransactions = await prisma.pipchipsTransaction.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        user: {
          select: {
            discordId: true,
            xUsername: true
          }
        }
      }
    });
    const topUsers = await prisma.user.findMany({
      orderBy: { pipchipsBalance: "desc" },
      take: 10,
      select: {
        discordId: true,
        xUsername: true,
        pipchipsBalance: true,
        pipchipsEarnedTotal: true,
        pipchipsSpentTotal: true,
        dailyStreak: true,
        longestDailyStreak: true
      }
    });
    const activeMarkets = await prisma.predictionMarket.findMany({
      where: {
        tokenSymbol: "PIPCHIPS",
        status: "ACTIVE"
      },
      select: {
        id: true,
        title: true,
        totalPipchipsVolume: true,
        totalBetCount: true,
        createdAt: true
      },
      orderBy: { totalPipchipsVolume: "desc" },
      take: 10
    });
    const html = generatePIPChipsAdminHTML({
      stats,
      recentTransactions,
      topUsers,
      activeMarkets
    });
    res.send(html);
  } catch (error) {
    console.error("PIPChips admin error:", error);
    res.status(500).send("Error loading PIPChips admin dashboard");
  }
});
pipchipsAdminRouter.get("/users", async (req, res) => {
  try {
    const { search = "", limit = "50", offset = "0" } = req.query;
    const limitNum = Math.min(parseInt(limit) || 50, 100);
    const offsetNum = parseInt(offset) || 0;
    const where = {};
    if (search) {
      where.OR = [
        { xUsername: { contains: search, mode: "insensitive" } },
        { discordId: { contains: search } }
      ];
    }
    const [users, totalUsers] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { pipchipsBalance: "desc" },
        take: limitNum,
        skip: offsetNum,
        select: {
          discordId: true,
          xUsername: true,
          pipchipsBalance: true,
          pipchipsEarnedTotal: true,
          pipchipsSpentTotal: true,
          pipchipsBoughtTotal: true,
          dailyStreak: true,
          longestDailyStreak: true,
          lastPipchipsDaily: true,
          createdAt: true
        }
      }),
      prisma.user.count({ where })
    ]);
    const html = generateUserManagementHTML({
      users,
      search,
      pagination: {
        total: totalUsers,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < totalUsers
      }
    });
    res.send(html);
  } catch (error) {
    console.error("PIPChips user management error:", error);
    res.status(500).send("Error loading user management");
  }
});
pipchipsAdminRouter.post("/users/:discordId/adjust", async (req, res) => {
  try {
    const { discordId } = req.params;
    const { amount, reason, type } = req.body;
    if (!amount || !reason || !type) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: amount, reason, type"
      });
    }
    const adjustAmount = BigInt(parseInt(amount));
    if (type === "credit") {
      await pipchipsService.creditPIPChips(
        discordId,
        adjustAmount,
        "ADMIN_CREDIT",
        void 0,
        `Admin credit: ${reason}`,
        { adminUserId: req.user?.discordId }
      );
    } else if (type === "debit") {
      await pipchipsService.debitPIPChips(
        discordId,
        adjustAmount,
        "ADMIN_DEBIT",
        void 0,
        `Admin debit: ${reason}`,
        { adminUserId: req.user?.discordId }
      );
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid adjustment type. Must be "credit" or "debit"'
      });
    }
    res.json({
      success: true,
      message: `Successfully ${type}ed ${adjustAmount} PIPChips`
    });
  } catch (error) {
    console.error("Balance adjustment error:", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to adjust balance"
    });
  }
});
pipchipsAdminRouter.get("/packages", async (req, res) => {
  try {
    const packages = await prisma.pipchipsPackage.findMany({
      orderBy: [
        { tokenSymbol: "asc" },
        { pipchipsAmount: "asc" }
      ]
    });
    const html = generatePackageManagementHTML(packages);
    res.send(html);
  } catch (error) {
    console.error("Package management error:", error);
    res.status(500).send("Error loading package management");
  }
});
pipchipsAdminRouter.post("/packages", async (req, res) => {
  try {
    const { pipchipsAmount, tokenCost, tokenSymbol, bonusPercentage, isActive } = req.body;
    const newPackage = await prisma.pipchipsPackage.create({
      data: {
        name: `${pipchipsAmount} PIPChips`,
        pipchipsAmount: BigInt(pipchipsAmount),
        usdPrice: parseFloat(tokenCost),
        tokenCost: parseFloat(tokenCost),
        tokenSymbol: tokenSymbol.toUpperCase(),
        bonusPercentage: parseInt(bonusPercentage) || 0,
        isActive: isActive === "true"
      }
    });
    res.json({
      success: true,
      message: "Package created successfully",
      package: newPackage
    });
  } catch (error) {
    console.error("Create package error:", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to create package"
    });
  }
});
pipchipsAdminRouter.post("/markets/:marketId/resolve", async (req, res) => {
  try {
    const { marketId } = req.params;
    const { winningOutcome } = req.body;
    const adminUserId = req.user?.discordId;
    if (!winningOutcome) {
      return res.status(400).json({
        success: false,
        error: "Missing winning outcome"
      });
    }
    const result = await pipchipsLMSR.resolveMarket(marketId, winningOutcome, adminUserId);
    res.json({
      success: true,
      message: "Market resolved successfully",
      result
    });
  } catch (error) {
    console.error("Market resolution error:", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to resolve market"
    });
  }
});
pipchipsAdminRouter.get("/settings", async (req, res) => {
  try {
    const settings = await prisma.adminSetting.findMany({
      where: {
        key: {
          in: [
            "daily_bonus_amount",
            "starting_pipchips",
            "max_daily_bonus",
            "streak_multiplier_7d",
            "streak_multiplier_30d",
            "streak_multiplier_100d"
          ]
        }
      }
    });
    const settingsMap = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});
    const html = generateSettingsHTML(settingsMap);
    res.send(html);
  } catch (error) {
    console.error("Settings management error:", error);
    res.status(500).send("Error loading settings management");
  }
});
pipchipsAdminRouter.post("/settings", async (req, res) => {
  try {
    const settings = req.body;
    for (const [key, value] of Object.entries(settings)) {
      await prisma.adminSetting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) }
      });
    }
    res.json({
      success: true,
      message: "Settings updated successfully"
    });
  } catch (error) {
    console.error("Update settings error:", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to update settings"
    });
  }
});
function generatePIPChipsAdminHTML(data) {
  const { stats, recentTransactions, topUsers, activeMarkets } = data;
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>PIPChips Administration</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
            .stat-card { background: white; padding: 16px; border-radius: 8px; border-left: 4px solid #3b82f6; }
            .stat-value { font-size: 24px; font-weight: bold; color: #1f2937; }
            .stat-label { color: #6b7280; font-size: 14px; }
            .section { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            .nav-tabs { display: flex; gap: 16px; margin-bottom: 20px; }
            .nav-tab { padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; }
            .nav-tab:hover { background: #2563eb; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
            th { background: #f9fafb; font-weight: 600; }
            .pipchips-amount { font-weight: bold; color: #059669; }
            .transaction-type { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
            .type-credit { background: #d1fae5; color: #065f46; }
            .type-debit { background: #fee2e2; color: #991b1b; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>\u{1F3B0} PIPChips Administration</h1>
            <p>Manage the virtual currency system, users, and prediction markets</p>
        </div>

        <div class="nav-tabs">
            <a href="/admin/pipchips" class="nav-tab">\u{1F4CA} Overview</a>
            <a href="/admin/pipchips/users" class="nav-tab">\u{1F465} Users</a>
            <a href="/admin/pipchips/packages" class="nav-tab">\u{1F4E6} Packages</a>
            <a href="/admin/pipchips/settings" class="nav-tab">\u2699\uFE0F Settings</a>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${Number(stats.totalCirculation).toLocaleString()}</div>
                <div class="stat-label">Total PIPChips in Circulation</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.totalUsers.toLocaleString()}</div>
                <div class="stat-label">Total Users</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.activeUsers24h.toLocaleString()}</div>
                <div class="stat-label">Active Users (24h)</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.dailyClaims24h.toLocaleString()}</div>
                <div class="stat-label">Daily Claims (24h)</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${Number(stats.totalSpent).toLocaleString()}</div>
                <div class="stat-label">Total Spent on Predictions</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${Number(stats.totalBought).toLocaleString()}</div>
                <div class="stat-label">Total Purchased</div>
            </div>
        </div>

        <div class="section">
            <h2>\u{1F4C8} Top Users by Balance</h2>
            <table>
                <thead>
                    <tr>
                        <th>User</th>
                        <th>Balance</th>
                        <th>Total Earned</th>
                        <th>Total Spent</th>
                        <th>Current Streak</th>
                        <th>Best Streak</th>
                    </tr>
                </thead>
                <tbody>
                    ${topUsers.map((user) => `
                        <tr>
                            <td>${user.xUsername || user.discordId.slice(0, 8)}</td>
                            <td class="pipchips-amount">${Number(user.pipchipsBalance).toLocaleString()}</td>
                            <td>${Number(user.pipchipsEarnedTotal).toLocaleString()}</td>
                            <td>${Number(user.pipchipsSpentTotal).toLocaleString()}</td>
                            <td>${user.dailyStreak} days</td>
                            <td>${user.longestDailyStreak} days</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>\u{1F4B0} Active PIPChips Markets</h2>
            <table>
                <thead>
                    <tr>
                        <th>Market</th>
                        <th>Volume</th>
                        <th>Total Bets</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${activeMarkets.map((market) => `
                        <tr>
                            <td>${market.title}</td>
                            <td class="pipchips-amount">${market.totalPipchipsVolume?.toLocaleString() || 0}</td>
                            <td>${market.totalBetCount || 0}</td>
                            <td>${new Date(market.createdAt).toLocaleDateString()}</td>
                            <td>
                                <button onclick="resolveMarket('${market.id}')" class="btn-small">Resolve</button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>\u{1F4CB} Recent Transactions</h2>
            <table>
                <thead>
                    <tr>
                        <th>User</th>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>Description</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>
                    ${recentTransactions.map((tx) => `
                        <tr>
                            <td>${tx.user?.xUsername || tx.userId.slice(0, 8)}</td>
                            <td><span class="transaction-type ${tx.amount > 0 ? "type-credit" : "type-debit"}">${tx.transactionType}</span></td>
                            <td class="pipchips-amount">${tx.amount > 0 ? "+" : ""}${Number(tx.amount).toLocaleString()}</td>
                            <td>${tx.description || "N/A"}</td>
                            <td>${new Date(tx.createdAt).toLocaleString()}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>

        <script>
            function resolveMarket(marketId) {
                const outcome = prompt('Enter winning outcome:');
                if (!outcome) return;

                fetch(\`/admin/pipchips/markets/\${marketId}/resolve\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ winningOutcome: outcome })
                })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        alert('Market resolved successfully!');
                        location.reload();
                    } else {
                        alert('Error: ' + data.error);
                    }
                })
                .catch(err => alert('Network error'));
            }
        </script>
    </body>
    </html>
  `;
}
function generateUserManagementHTML(data) {
  const { users, search, pagination } = data;
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>PIPChips User Management</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            .section { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            .search-box { display: flex; gap: 12px; margin-bottom: 20px; }
            .search-box input { flex: 1; padding: 12px; border: 1px solid #d1d5db; border-radius: 6px; }
            .search-box button { padding: 12px 24px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
            th { background: #f9fafb; font-weight: 600; }
            .pipchips-amount { font-weight: bold; color: #059669; }
            .balance-actions { display: flex; gap: 8px; }
            .btn-small { padding: 6px 12px; background: #6b7280; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
            .btn-credit { background: #10b981; }
            .btn-debit { background: #ef4444; }
            .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); }
            .modal-content { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; min-width: 400px; }
            .form-group { margin-bottom: 16px; }
            .form-group label { display: block; margin-bottom: 4px; font-weight: 600; }
            .form-group input, .form-group select { width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>\u{1F465} PIPChips User Management</h1>
            <p>View and manage user balances, streaks, and transactions</p>
        </div>

        <div class="section">
            <div class="search-box">
                <input type="text" id="searchInput" placeholder="Search by username or Discord ID..." value="${search}">
                <button onclick="searchUsers()">\u{1F50D} Search</button>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>User</th>
                        <th>Balance</th>
                        <th>Earned</th>
                        <th>Spent</th>
                        <th>Bought</th>
                        <th>Streak</th>
                        <th>Last Daily</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map((user) => `
                        <tr>
                            <td>${user.xUsername || user.discordId.slice(0, 8)}</td>
                            <td class="pipchips-amount">${Number(user.pipchipsBalance).toLocaleString()}</td>
                            <td>${Number(user.pipchipsEarnedTotal).toLocaleString()}</td>
                            <td>${Number(user.pipchipsSpentTotal).toLocaleString()}</td>
                            <td>${Number(user.pipchipsBoughtTotal).toLocaleString()}</td>
                            <td>${user.dailyStreak}/${user.longestDailyStreak}</td>
                            <td>${user.lastPipchipsDaily ? new Date(user.lastPipchipsDaily).toLocaleDateString() : "Never"}</td>
                            <td class="balance-actions">
                                <button class="btn-small btn-credit" onclick="adjustBalance('${user.discordId}', 'credit')">+ Credit</button>
                                <button class="btn-small btn-debit" onclick="adjustBalance('${user.discordId}', 'debit')">- Debit</button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>

        <!-- Balance Adjustment Modal -->
        <div id="balanceModal" class="modal">
            <div class="modal-content">
                <h3 id="modalTitle">Adjust Balance</h3>
                <div class="form-group">
                    <label>Amount (PIPChips):</label>
                    <input type="number" id="adjustAmount" min="1" required>
                </div>
                <div class="form-group">
                    <label>Reason:</label>
                    <input type="text" id="adjustReason" placeholder="Reason for adjustment..." required>
                </div>
                <div class="balance-actions">
                    <button onclick="submitAdjustment()" class="btn-small btn-credit">Submit</button>
                    <button onclick="closeModal()" class="btn-small">Cancel</button>
                </div>
            </div>
        </div>

        <script>
            let currentUserId = '';
            let currentType = '';

            function searchUsers() {
                const search = document.getElementById('searchInput').value;
                window.location.href = \`?search=\${encodeURIComponent(search)}\`;
            }

            function adjustBalance(userId, type) {
                currentUserId = userId;
                currentType = type;
                document.getElementById('modalTitle').textContent = \`\${type === 'credit' ? 'Credit' : 'Debit'} PIPChips\`;
                document.getElementById('balanceModal').style.display = 'block';
            }

            function closeModal() {
                document.getElementById('balanceModal').style.display = 'none';
                document.getElementById('adjustAmount').value = '';
                document.getElementById('adjustReason').value = '';
            }

            function submitAdjustment() {
                const amount = document.getElementById('adjustAmount').value;
                const reason = document.getElementById('adjustReason').value;

                if (!amount || !reason) {
                    alert('Please fill in all fields');
                    return;
                }

                fetch(\`/admin/pipchips/users/\${currentUserId}/adjust\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount, reason, type: currentType })
                })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        alert(data.message);
                        location.reload();
                    } else {
                        alert('Error: ' + data.error);
                    }
                })
                .catch(err => alert('Network error'));
            }
        </script>
    </body>
    </html>
  `;
}
function generatePackageManagementHTML(packages) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>PIPChips Package Management</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            .section { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            .create-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
            .form-group label { display: block; margin-bottom: 4px; font-weight: 600; }
            .form-group input, .form-group select { width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 4px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
            th { background: #f9fafb; font-weight: 600; }
            .status-active { color: #059669; font-weight: bold; }
            .status-inactive { color: #dc2626; }
            .btn { padding: 12px 24px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>\u{1F4E6} PIPChips Package Management</h1>
            <p>Create and manage purchase packages for PIPChips</p>
        </div>

        <div class="section">
            <h2>Create New Package</h2>
            <form class="create-form" onsubmit="createPackage(event)">
                <div class="form-group">
                    <label>PIPChips Amount:</label>
                    <input type="number" name="pipchipsAmount" min="100" required>
                </div>
                <div class="form-group">
                    <label>Token Cost:</label>
                    <input type="number" name="tokenCost" step="0.001" min="0.001" required>
                </div>
                <div class="form-group">
                    <label>Token Symbol:</label>
                    <select name="tokenSymbol" required>
                        <option value="USDC">USDC</option>
                        <option value="ETH">ETH</option>
                        <option value="PEPE">PEPE</option>
                        <option value="ICE">ICE</option>
                        <option value="PEBBLE">PEBBLE</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Bonus Percentage:</label>
                    <input type="number" name="bonusPercentage" min="0" max="100" value="0">
                </div>
                <div class="form-group">
                    <label>Status:</label>
                    <select name="isActive" required>
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                    </select>
                </div>
                <div class="form-group">
                    <button type="submit" class="btn">Create Package</button>
                </div>
            </form>
        </div>

        <div class="section">
            <h2>Existing Packages</h2>
            <table>
                <thead>
                    <tr>
                        <th>PIPChips Amount</th>
                        <th>Token Cost</th>
                        <th>Token</th>
                        <th>Bonus %</th>
                        <th>Total Value</th>
                        <th>Status</th>
                        <th>Created</th>
                    </tr>
                </thead>
                <tbody>
                    ${packages.map((pkg) => {
    const totalValue = Number(pkg.pipchipsAmount) * (1 + pkg.bonusPercentage / 100);
    return `
                        <tr>
                            <td>${Number(pkg.pipchipsAmount).toLocaleString()}</td>
                            <td>${pkg.tokenCost}</td>
                            <td>${pkg.tokenSymbol}</td>
                            <td>${pkg.bonusPercentage}%</td>
                            <td>${totalValue.toLocaleString()}</td>
                            <td class="${pkg.isActive ? "status-active" : "status-inactive"}">
                                ${pkg.isActive ? "Active" : "Inactive"}
                            </td>
                            <td>${new Date(pkg.createdAt).toLocaleDateString()}</td>
                        </tr>
                      `;
  }).join("")}
                </tbody>
            </table>
        </div>

        <script>
            function createPackage(event) {
                event.preventDefault();
                const formData = new FormData(event.target);
                const data = Object.fromEntries(formData);

                fetch('/admin/pipchips/packages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                })
                .then(r => r.json())
                .then(result => {
                    if (result.success) {
                        alert('Package created successfully!');
                        location.reload();
                    } else {
                        alert('Error: ' + result.error);
                    }
                })
                .catch(err => alert('Network error'));
            }
        </script>
    </body>
    </html>
  `;
}
function generateSettingsHTML(settings) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>PIPChips System Settings</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            .section { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
            .settings-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
            .form-group { margin-bottom: 16px; }
            .form-group label { display: block; margin-bottom: 8px; font-weight: 600; color: #374151; }
            .form-group input { width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 16px; }
            .form-group small { color: #6b7280; font-size: 14px; }
            .btn { padding: 14px 28px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: 600; }
            .btn:hover { background: #059669; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>\u2699\uFE0F PIPChips System Settings</h1>
            <p>Configure global settings for the PIPChips virtual currency system</p>
        </div>

        <div class="section">
            <form class="settings-form" onsubmit="updateSettings(event)">
                <div>
                    <div class="form-group">
                        <label>Daily Bonus Amount</label>
                        <input type="number" name="daily_bonus_amount" value="${settings.daily_bonus_amount || 500}" min="1" required>
                        <small>Base amount for daily bonus claims (before streak multiplier)</small>
                    </div>

                    <div class="form-group">
                        <label>Starting PIPChips</label>
                        <input type="number" name="starting_pipchips" value="${settings.starting_pipchips || 1e4}" min="100" required>
                        <small>PIPChips given to new users when they join</small>
                    </div>
                </div>

                <div>
                    <div class="form-group">
                        <label>7-Day Streak Multiplier</label>
                        <input type="number" name="streak_multiplier_7d" value="${settings.streak_multiplier_7d || 2}" min="1" max="10" step="0.1" required>
                        <small>Multiplier for users with 7+ day streaks</small>
                    </div>

                    <div class="form-group">
                        <label>30-Day Streak Multiplier</label>
                        <input type="number" name="streak_multiplier_30d" value="${settings.streak_multiplier_30d || 5}" min="1" max="10" step="0.1" required>
                        <small>Multiplier for users with 30+ day streaks</small>
                    </div>

                    <div class="form-group">
                        <label>100-Day Streak Multiplier</label>
                        <input type="number" name="streak_multiplier_100d" value="${settings.streak_multiplier_100d || 10}" min="1" max="20" step="0.1" required>
                        <small>Maximum multiplier for legendary streaks</small>
                    </div>
                </div>

                <div style="grid-column: 1 / -1; text-align: center;">
                    <button type="submit" class="btn">\u{1F4BE} Update Settings</button>
                </div>
            </form>
        </div>

        <script>
            function updateSettings(event) {
                event.preventDefault();
                const formData = new FormData(event.target);
                const settings = {};

                for (let [key, value] of formData.entries()) {
                    settings[key] = isNaN(parseFloat(value)) ? value : parseFloat(value);
                }

                fetch('/admin/pipchips/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                })
                .then(r => r.json())
                .then(result => {
                    if (result.success) {
                        alert('Settings updated successfully!');
                    } else {
                        alert('Error: ' + result.error);
                    }
                })
                .catch(err => alert('Network error updating settings'));
            }
        </script>
    </body>
    </html>
  `;
}
var pipchips_admin_default = pipchipsAdminRouter;
export {
  pipchips_admin_default as default,
  pipchipsAdminRouter
};
//# sourceMappingURL=pipchips_admin.js.map
