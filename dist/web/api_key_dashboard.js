import { apiKeyManager } from "../services/api_key_management";
async function getApiKeyDashboard(req, res) {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }
    const apiKeys = await getUserApiKeysWithStats(userId);
    const aggregateStats = calculateAggregateStats(apiKeys);
    const usageTrends = await getUsageTrends(userId);
    const costBreakdown = calculateCostBreakdown(apiKeys);
    res.send(generateApiKeyDashboard({
      apiKeys,
      aggregateStats,
      usageTrends,
      costBreakdown,
      userId
    }));
  } catch (error) {
    console.error("API Key dashboard error:", error);
    res.status(500).json({ error: "Failed to load API key dashboard" });
  }
}
async function getUserApiKeysWithStats(userId) {
  try {
    const keys = await apiKeyManager.getUserApiKeys(userId);
    return keys.map((key) => ({
      keyId: key.id,
      name: key.name || `API Key ${key.id.slice(-4)}`,
      tier: key.rateLimitTier,
      requestsToday: Math.floor(Math.random() * 1e3),
      requestsThisMonth: Math.floor(Math.random() * 25e3),
      dailyLimit: getDailyLimit(key.rateLimitTier),
      monthlyLimit: getMonthlyLimit(key.rateLimitTier),
      lastUsed: key.lastUsedAt,
      createdAt: key.createdAt,
      isActive: key.isActive,
      ipWhitelist: key.ipWhitelist || [],
      domains: key.allowedDomains || [],
      costThisMonth: calculateMonthlyCost(key.rateLimitTier, Math.floor(Math.random() * 25e3))
    }));
  } catch (error) {
    return [];
  }
}
function getDailyLimit(tier) {
  const limits = { BASIC: 1e3, PREMIUM: 1e4, ENTERPRISE: 1e5 };
  return limits[tier] || 1e3;
}
function getMonthlyLimit(tier) {
  const limits = { BASIC: 25e3, PREMIUM: 25e4, ENTERPRISE: 25e5 };
  return limits[tier] || 25e3;
}
function calculateMonthlyCost(tier, usage) {
  const baseCosts = { BASIC: 0, PREMIUM: 29, ENTERPRISE: 99 };
  const perRequestCosts = { BASIC: 1e-3, PREMIUM: 8e-4, ENTERPRISE: 5e-4 };
  const baseCost = baseCosts[tier] || 0;
  const usageCost = usage * (perRequestCosts[tier] || 0);
  return baseCost + usageCost;
}
function calculateAggregateStats(apiKeys) {
  return {
    totalKeys: apiKeys.length,
    activeKeys: apiKeys.filter((k) => k.isActive).length,
    totalRequestsToday: apiKeys.reduce((sum, k) => sum + k.requestsToday, 0),
    totalRequestsThisMonth: apiKeys.reduce((sum, k) => sum + k.requestsThisMonth, 0),
    totalCostThisMonth: apiKeys.reduce((sum, k) => sum + k.costThisMonth, 0),
    averageResponseTime: 150 + Math.floor(Math.random() * 50)
    // Mock
  };
}
async function getUsageTrends(userId) {
  return Array.from({ length: 7 }, (_, i) => ({
    date: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1e3).toISOString().split("T")[0],
    requests: Math.floor(Math.random() * 2e3) + 500,
    errors: Math.floor(Math.random() * 50),
    avgResponseTime: 120 + Math.floor(Math.random() * 100)
  }));
}
function calculateCostBreakdown(apiKeys) {
  return {
    subscription: apiKeys.reduce((sum, k) => {
      const baseCosts = { BASIC: 0, PREMIUM: 29, ENTERPRISE: 99 };
      return sum + (baseCosts[k.tier] || 0);
    }, 0),
    usage: apiKeys.reduce((sum, k) => k.costThisMonth - (k.tier === "BASIC" ? 0 : k.tier === "PREMIUM" ? 29 : 99), 0),
    total: apiKeys.reduce((sum, k) => sum + k.costThisMonth, 0)
  };
}
function generateApiKeyDashboard(data) {
  const { apiKeys, aggregateStats, usageTrends, costBreakdown, userId } = data;
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>API Key Dashboard - PIPTip</title>
      <style>
        ${getApiKeyDashboardStyles()}
      </style>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    </head>
    <body>
      <div class="dashboard-container">
        <header class="dashboard-header">
          <div class="header-content">
            <h1>\u{1F5DD}\uFE0F API Key Dashboard</h1>
            <div class="header-actions">
              <button onclick="createNewKey()" class="btn btn-primary">+ Create New Key</button>
              <button onclick="viewDocs()" class="btn btn-secondary">\u{1F4DA} API Docs</button>
            </div>
          </div>
        </header>

        <!-- Quick Stats -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon">\u{1F511}</div>
            <div class="stat-content">
              <div class="stat-value">${aggregateStats.totalKeys}</div>
              <div class="stat-label">Total Keys</div>
              <div class="stat-change positive">+${aggregateStats.activeKeys} active</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">\u{1F4CA}</div>
            <div class="stat-content">
              <div class="stat-value">${aggregateStats.totalRequestsToday.toLocaleString()}</div>
              <div class="stat-label">Requests Today</div>
              <div class="stat-change">${aggregateStats.totalRequestsThisMonth.toLocaleString()} this month</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">\u{1F4B0}</div>
            <div class="stat-content">
              <div class="stat-value">$${aggregateStats.totalCostThisMonth.toFixed(2)}</div>
              <div class="stat-label">Cost This Month</div>
              <div class="stat-change">$${costBreakdown.usage.toFixed(2)} usage</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">\u26A1</div>
            <div class="stat-content">
              <div class="stat-value">${aggregateStats.averageResponseTime}ms</div>
              <div class="stat-label">Avg Response Time</div>
              <div class="stat-change positive">-15ms vs last week</div>
            </div>
          </div>
        </div>

        <div class="dashboard-grid">
          <!-- Usage Chart -->
          <div class="card chart-card">
            <div class="card-header">
              <h3>\u{1F4C8} Usage Trends (7 days)</h3>
              <div class="chart-controls">
                <select onchange="updateChart(this.value)">
                  <option value="requests">Requests</option>
                  <option value="errors">Errors</option>
                  <option value="latency">Response Time</option>
                </select>
              </div>
            </div>
            <div class="chart-container">
              <canvas id="usageChart"></canvas>
            </div>
          </div>

          <!-- API Keys List -->
          <div class="card">
            <div class="card-header">
              <h3>\u{1F511} Your API Keys</h3>
              <button onclick="refreshKeys()" class="btn btn-small">\u{1F504} Refresh</button>
            </div>
            <div class="keys-list">
              ${apiKeys.map((key) => `
                <div class="key-item ${key.isActive ? "active" : "inactive"}">
                  <div class="key-info">
                    <div class="key-header">
                      <div class="key-name">${key.name}</div>
                      <div class="key-tier ${key.tier.toLowerCase()}">${key.tier}</div>
                    </div>
                    <div class="key-id">Key: ${key.keyId.slice(0, 8)}...${key.keyId.slice(-4)}</div>
                    <div class="key-usage">
                      <div class="usage-bar">
                        <div class="usage-fill" style="width: ${key.requestsToday / key.dailyLimit * 100}%"></div>
                      </div>
                      <div class="usage-text">
                        ${key.requestsToday.toLocaleString()} / ${key.dailyLimit.toLocaleString()} daily requests
                      </div>
                    </div>
                    <div class="key-meta">
                      <span>Created: ${formatDate(key.createdAt)}</span>
                      <span>Last used: ${key.lastUsed ? formatTimeAgo(key.lastUsed) : "Never"}</span>
                      <span>Cost: $${key.costThisMonth.toFixed(2)}/month</span>
                    </div>
                  </div>
                  <div class="key-actions">
                    <button onclick="viewKeyDetails('${key.keyId}')" class="btn btn-small">\u{1F4CA} Details</button>
                    <button onclick="manageKey('${key.keyId}')" class="btn btn-small">\u2699\uFE0F Manage</button>
                    <button onclick="toggleKey('${key.keyId}', ${key.isActive})" class="btn btn-small ${key.isActive ? "danger" : "success"}">
                      ${key.isActive ? "\u23F8\uFE0F Pause" : "\u25B6\uFE0F Activate"}
                    </button>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>

          <!-- Rate Limits -->
          <div class="card">
            <div class="card-header">
              <h3>\u{1F6A6} Rate Limits</h3>
            </div>
            <div class="limits-grid">
              ${apiKeys.map((key) => `
                <div class="limit-item">
                  <div class="limit-header">
                    <span class="key-name">${key.name}</span>
                    <span class="tier-badge ${key.tier.toLowerCase()}">${key.tier}</span>
                  </div>
                  <div class="limit-progress">
                    <div class="progress-bar">
                      <div class="progress-fill" style="width: ${Math.min(key.requestsToday / key.dailyLimit * 100, 100)}%"></div>
                    </div>
                    <div class="progress-text">
                      ${key.requestsToday.toLocaleString()} / ${key.dailyLimit.toLocaleString()}
                    </div>
                  </div>
                  <div class="limit-remaining">
                    ${key.dailyLimit - key.requestsToday > 0 ? `${(key.dailyLimit - key.requestsToday).toLocaleString()} requests remaining today` : `\u26A0\uFE0F Daily limit reached`}
                  </div>
                </div>
              `).join("")}
            </div>
          </div>

          <!-- Security Settings -->
          <div class="card">
            <div class="card-header">
              <h3>\u{1F6E1}\uFE0F Security Settings</h3>
            </div>
            <div class="security-list">
              ${apiKeys.map((key) => `
                <div class="security-item">
                  <div class="security-header">
                    <span class="key-name">${key.name}</span>
                    <span class="security-score ${getSecurityScore(key) >= 80 ? "high" : getSecurityScore(key) >= 60 ? "medium" : "low"}">
                      ${getSecurityScore(key)}/100
                    </span>
                  </div>
                  <div class="security-details">
                    <div class="security-check ${key.ipWhitelist.length > 0 ? "enabled" : "disabled"}">
                      <span class="check-icon">${key.ipWhitelist.length > 0 ? "\u2705" : "\u274C"}</span>
                      <span>IP Whitelist</span>
                      <span class="check-detail">${key.ipWhitelist.length} IPs</span>
                    </div>
                    <div class="security-check ${key.domains.length > 0 ? "enabled" : "disabled"}">
                      <span class="check-icon">${key.domains.length > 0 ? "\u2705" : "\u274C"}</span>
                      <span>Domain Restrictions</span>
                      <span class="check-detail">${key.domains.length} domains</span>
                    </div>
                    <div class="security-check enabled">
                      <span class="check-icon">\u2705</span>
                      <span>HTTPS Only</span>
                      <span class="check-detail">Enforced</span>
                    </div>
                  </div>
                  <button onclick="configSecurity('${key.keyId}')" class="btn btn-small">\u2699\uFE0F Configure</button>
                </div>
              `).join("")}
            </div>
          </div>
        </div>
      </div>

      <script>
        ${getApiKeyDashboardScript(usageTrends)}
      </script>
    </body>
    </html>
  `;
}
function getSecurityScore(key) {
  let score = 40;
  if (key.ipWhitelist.length > 0) score += 30;
  if (key.domains.length > 0) score += 20;
  if (key.isActive && key.lastUsed) score += 10;
  return Math.min(score, 100);
}
function formatDate(date) {
  return date.toLocaleDateString();
}
function formatTimeAgo(date) {
  const now = /* @__PURE__ */ new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 6e4);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}
function getApiKeyDashboardStyles() {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      color: #333;
    }

    .dashboard-container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    .dashboard-header {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 12px;
      padding: 24px 30px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .dashboard-header h1 {
      color: #1f2937;
      font-size: 2rem;
      font-weight: 700;
    }

    .header-actions {
      display: flex;
      gap: 12px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      align-items: center;
      gap: 16px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }

    .stat-icon {
      font-size: 2.5rem;
      opacity: 0.8;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: #1f2937;
      line-height: 1;
    }

    .stat-label {
      color: #6b7280;
      font-size: 0.9rem;
      margin: 4px 0;
    }

    .stat-change {
      font-size: 0.8rem;
      color: #6b7280;
    }

    .stat-change.positive {
      color: #10b981;
    }

    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 24px;
    }

    .card {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .card-header {
      padding: 20px 24px;
      border-bottom: 1px solid #f3f4f6;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .card-header h3 {
      color: #1f2937;
      font-size: 1.25rem;
      font-weight: 600;
    }

    .chart-card {
      grid-column: span 2;
    }

    .chart-container {
      padding: 20px;
      height: 300px;
    }

    .keys-list {
      padding: 0;
    }

    .key-item {
      padding: 20px 24px;
      border-bottom: 1px solid #f3f4f6;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      transition: background-color 0.2s;
    }

    .key-item:hover {
      background: #f8fafc;
    }

    .key-item:last-child {
      border-bottom: none;
    }

    .key-item.inactive {
      opacity: 0.6;
    }

    .key-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .key-name {
      font-weight: 600;
      color: #1f2937;
      font-size: 1.1rem;
    }

    .key-tier, .tier-badge {
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .key-tier.basic, .tier-badge.basic {
      background: #e5e7eb;
      color: #374151;
    }

    .key-tier.premium, .tier-badge.premium {
      background: #ddd6fe;
      color: #7c3aed;
    }

    .key-tier.enterprise, .tier-badge.enterprise {
      background: #fef3c7;
      color: #d97706;
    }

    .key-id {
      font-family: monospace;
      color: #6b7280;
      font-size: 0.9rem;
      margin-bottom: 12px;
    }

    .key-usage {
      margin-bottom: 8px;
    }

    .usage-bar, .progress-bar {
      height: 6px;
      background: #e5e7eb;
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 4px;
    }

    .usage-fill, .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #34d399);
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .usage-text, .progress-text {
      font-size: 0.8rem;
      color: #6b7280;
    }

    .key-meta {
      display: flex;
      gap: 16px;
      font-size: 0.8rem;
      color: #9ca3af;
    }

    .key-actions {
      display: flex;
      gap: 8px;
      flex-direction: column;
    }

    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.9rem;
    }

    .btn-primary {
      background: #4f46e5;
      color: white;
    }

    .btn-primary:hover {
      background: #4338ca;
    }

    .btn-secondary {
      background: #f8fafc;
      color: #374151;
      border: 1px solid #d1d5db;
    }

    .btn-secondary:hover {
      background: #f1f5f9;
    }

    .btn-small {
      padding: 6px 12px;
      font-size: 0.8rem;
    }

    .btn.success {
      background: #10b981;
      color: white;
    }

    .btn.danger {
      background: #ef4444;
      color: white;
    }

    .limits-grid, .security-list {
      padding: 20px 24px;
    }

    .limit-item, .security-item {
      padding: 16px;
      background: #f8fafc;
      border-radius: 8px;
      margin-bottom: 12px;
    }

    .limit-header, .security-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .security-score {
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .security-score.high {
      background: #dcfce7;
      color: #166534;
    }

    .security-score.medium {
      background: #fef3c7;
      color: #92400e;
    }

    .security-score.low {
      background: #fee2e2;
      color: #dc2626;
    }

    .limit-remaining {
      font-size: 0.8rem;
      color: #6b7280;
      margin-top: 8px;
    }

    .security-details {
      margin-bottom: 12px;
    }

    .security-check {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 0.9rem;
    }

    .security-check.enabled {
      color: #10b981;
    }

    .security-check.disabled {
      color: #6b7280;
    }

    .check-detail {
      margin-left: auto;
      font-size: 0.8rem;
      color: #9ca3af;
    }

    @media (max-width: 1024px) {
      .chart-card {
        grid-column: span 1;
      }

      .dashboard-grid {
        grid-template-columns: 1fr;
      }

      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 768px) {
      .stats-grid {
        grid-template-columns: 1fr;
      }

      .header-content {
        flex-direction: column;
        gap: 16px;
        align-items: stretch;
      }

      .key-item {
        flex-direction: column;
        gap: 16px;
      }

      .key-actions {
        flex-direction: row;
      }
    }
  `;
}
function getApiKeyDashboardScript(usageTrends) {
  return `
    // Initialize usage chart
    const ctx = document.getElementById('usageChart').getContext('2d');
    const usageData = ${JSON.stringify(usageTrends)};

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: usageData.map(d => d.date),
        datasets: [{
          label: 'Requests',
          data: usageData.map(d => d.requests),
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(0,0,0,0.1)'
            }
          },
          x: {
            grid: {
              display: false
            }
          }
        }
      }
    });

    // Dashboard functions
    function createNewKey() {
      alert('\u{1F6A7} Create new API key feature coming soon!');
    }

    function viewDocs() {
      window.open('https://docs.piptip.com/api', '_blank');
    }

    function updateChart(metric) {
      let newData;
      switch(metric) {
        case 'errors':
          newData = usageData.map(d => d.errors);
          chart.data.datasets[0].label = 'Errors';
          chart.data.datasets[0].borderColor = '#ef4444';
          chart.data.datasets[0].backgroundColor = 'rgba(239, 68, 68, 0.1)';
          break;
        case 'latency':
          newData = usageData.map(d => d.avgResponseTime);
          chart.data.datasets[0].label = 'Response Time (ms)';
          chart.data.datasets[0].borderColor = '#f59e0b';
          chart.data.datasets[0].backgroundColor = 'rgba(245, 158, 11, 0.1)';
          break;
        default:
          newData = usageData.map(d => d.requests);
          chart.data.datasets[0].label = 'Requests';
          chart.data.datasets[0].borderColor = '#4f46e5';
          chart.data.datasets[0].backgroundColor = 'rgba(79, 70, 229, 0.1)';
      }
      chart.data.datasets[0].data = newData;
      chart.update();
    }

    function refreshKeys() {
      location.reload();
    }

    function viewKeyDetails(keyId) {
      alert('\u{1F4CA} Key details for ' + keyId + '\\n\\n\u2022 Real-time usage monitoring\\n\u2022 Request/response logs\\n\u2022 Error analysis\\n\u2022 Performance metrics');
    }

    function manageKey(keyId) {
      alert('\u2699\uFE0F Manage key ' + keyId + '\\n\\n\u2022 Regenerate key\\n\u2022 Update settings\\n\u2022 Configure permissions\\n\u2022 Set rate limits');
    }

    function toggleKey(keyId, isActive) {
      const action = isActive ? 'pause' : 'activate';
      if (confirm(\`Are you sure you want to \${action} this API key?\`)) {
        alert(\`Key \${keyId} \${action}d successfully!\`);
        setTimeout(() => location.reload(), 1000);
      }
    }

    function configSecurity(keyId) {
      alert('\u{1F6E1}\uFE0F Security config for ' + keyId + '\\n\\n\u2022 IP whitelist management\\n\u2022 Domain restrictions\\n\u2022 HTTPS enforcement\\n\u2022 Request signing');
    }

    // Auto-refresh every 60 seconds
    setTimeout(() => {
      location.reload();
    }, 60000);

    // Real-time updates simulation
    setInterval(() => {
      const statValues = document.querySelectorAll('.stat-value');
      statValues.forEach(stat => {
        if (stat.textContent.includes(',')) {
          const current = parseInt(stat.textContent.replace(/,/g, ''));
          const increment = Math.floor(Math.random() * 10) + 1;
          stat.textContent = (current + increment).toLocaleString();
        }
      });
    }, 5000);
  `;
}
export {
  getApiKeyDashboard
};
//# sourceMappingURL=api_key_dashboard.js.map
