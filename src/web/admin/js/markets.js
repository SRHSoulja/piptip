// src/web/admin/js/markets.js - Prediction Markets Admin Interface

class PredictionMarketsAdmin {
  constructor() {
    this.markets = [];
    this.stats = null;
    this.currentFilters = {
      status: 'all',
      guildId: ''
    };
    this.isLoading = false;
  }

  async init() {
    this.setupEventListeners();
    await this.loadStats();
    await this.loadMarkets();
  }

  setupEventListeners() {
    // Control buttons
    document.getElementById('refreshMarkets')?.addEventListener('click', () => this.loadMarkets());
    document.getElementById('resolveExpiredMarkets')?.addEventListener('click', () => this.resolveExpiredMarkets());
    document.getElementById('restartAutomation')?.addEventListener('click', () => this.restartAutomation());
    document.getElementById('exportMarketData')?.addEventListener('click', () => this.exportMarketData());

    // Filter controls
    document.getElementById('applyMarketFilters')?.addEventListener('click', () => this.applyFilters());
    document.getElementById('clearMarketFilters')?.addEventListener('click', () => this.clearFilters());

    // Real-time updates every 30 seconds
    setInterval(() => {
      if (!this.isLoading) {
        this.loadStats();
        this.loadMarkets();
      }
    }, 30000);
  }

  async makeRequest(url, options = {}) {
    const secret = window.adminSecret || sessionStorage.getItem('adminSecret') || '';

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${secret}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      this.showMessage('marketsMsg', `Error: ${error.message}`, 'err');
      throw error;
    }
  }

  async loadStats() {
    try {
      const data = await this.makeRequest('/admin/prediction_markets/stats');
      this.stats = data.stats;
      this.renderStats();
      this.updateAutomationStatus();
    } catch (error) {
      console.error('Failed to load market stats:', error);
    }
  }

  async loadMarkets() {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const params = new URLSearchParams({
        status: this.currentFilters.status,
        limit: '100'
      });

      if (this.currentFilters.guildId) {
        params.append('guild_id', this.currentFilters.guildId);
      }

      const data = await this.makeRequest(`/admin/prediction_markets?${params}`);
      this.markets = data.markets;
      this.renderMarkets();
      this.showMessage('marketsMsg', `Loaded ${this.markets.length} markets`, 'ok');
    } catch (error) {
      console.error('Failed to load markets:', error);
    } finally {
      this.isLoading = false;
    }
  }

  renderStats() {
    if (!this.stats) return;

    const container = document.getElementById('marketStats');
    if (!container) return;

    const stats = [
      { label: 'Total Markets', value: this.stats.markets.total },
      { label: 'Active', value: this.stats.markets.active },
      { label: 'Expired', value: this.stats.markets.expired, className: this.stats.markets.expired > 0 ? 'warning' : '' },
      { label: 'Total Bets', value: this.stats.betting.totalBets },
      { label: 'Total Volume', value: this.formatVolume(this.stats.betting.totalVolume) },
      { label: 'Recent Activity', value: `${this.stats.betting.recentActivity24h} bets (24h)` }
    ];

    container.innerHTML = stats.map(stat => `
      <div class="stat-item ${stat.className || ''}">
        <div class="stat-value">${stat.value}</div>
        <div class="stat-label">${stat.label}</div>
      </div>
    `).join('');
  }

  updateAutomationStatus() {
    const indicator = document.getElementById('automationIndicator');
    if (!indicator || !this.stats) return;

    const automation = this.stats.automation;
    const status = automation.running ? 'Running' : 'Stopped';
    const color = automation.running ? '#10b981' : '#ef4444';
    const interval = automation.intervalMs ? `(${automation.intervalMs / 1000}s interval)` : '';

    indicator.innerHTML = `
      <span style="color: ${color}; font-weight: 600;">${status}</span>
      <span style="color: #9ca3af; font-size: 12px;">${interval}</span>
    `;
  }

  renderMarkets() {
    const tbody = document.querySelector('#marketsTbl tbody');
    if (!tbody) return;

    if (this.markets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: #9ca3af;">No markets found</td></tr>';
      return;
    }

    tbody.innerHTML = this.markets.map(market => `
      <tr>
        <td style="font-family: monospace; font-size: 11px;">
          ${market.id.slice(0, 8)}...
        </td>
        <td style="max-width: 200px;">
          <div style="font-weight: 600; margin-bottom: 4px;">${this.escapeHtml(market.title)}</div>
          <div style="font-size: 11px; color: #9ca3af; line-height: 1.3;">
            ${this.escapeHtml(market.description.slice(0, 100))}${market.description.length > 100 ? '...' : ''}
          </div>
        </td>
        <td>
          <span style="font-size: 11px; background: #374151; padding: 2px 6px; border-radius: 4px;">
            ${market.marketType.replace('_', ' ')}
          </span>
        </td>
        <td>
          <span style="font-weight: 600; color: #3b82f6;">
            ${market.tokenSymbol}
          </span>
        </td>
        <td>
          <span class="market-status ${market.status.toLowerCase()}">
            ${market.status}${market.expired ? ' ⏰' : ''}
          </span>
        </td>
        <td style="text-align: right;">
          <div style="font-weight: 600;">${this.formatVolume(market.totalPool)}</div>
          <div style="font-size: 11px; color: #9ca3af;">
            Y: ${this.formatVolume(market.yesPool)} | N: ${this.formatVolume(market.noPool)}
          </div>
        </td>
        <td style="text-align: center;">
          <span style="font-weight: 600;">${market.totalBets}</span>
        </td>
        <td style="text-align: center;">
          <div style="font-size: 11px;">
            <span style="color: #10b981;">${market.odds.yes}x</span> /
            <span style="color: #ef4444;">${market.odds.no}x</span>
          </div>
          <div style="font-size: 10px; color: #9ca3af;">
            ${market.odds.yesImplied}% / ${market.odds.noImplied}%
          </div>
        </td>
        <td style="font-size: 11px;">
          ${this.formatTimeRemaining(market.timeLeftMs)}
        </td>
        <td>
          <div style="display: flex; gap: 4px; flex-wrap: wrap;">
            ${this.renderMarketActions(market)}
          </div>
        </td>
      </tr>
    `).join('');

    // Add CSS for market status styling
    this.addMarketStatusStyles();
  }

  renderMarketActions(market) {
    const actions = [];

    if (market.status === 'ACTIVE') {
      if (market.expired) {
        actions.push(`
          <button onclick="marketsAdmin.forceResolveMarket('${market.id}')"
                  class="action-btn resolve-btn" title="Force Auto-Resolve">
            🤖 Auto
          </button>
        `);
      }

      actions.push(`
        <button onclick="marketsAdmin.showResolveModal('${market.id}')"
                class="action-btn resolve-btn" title="Manual Resolve">
          ✅ Resolve
        </button>
      `);

      actions.push(`
        <button onclick="marketsAdmin.cancelMarket('${market.id}')"
                class="action-btn cancel-btn" title="Cancel & Refund">
          ❌ Cancel
        </button>
      `);
    }

    actions.push(`
      <button onclick="marketsAdmin.viewMarketDetails('${market.id}')"
              class="action-btn info-btn" title="View Details">
        👁️ View
      </button>
    `);

    return actions.join('');
  }

  addMarketStatusStyles() {
    if (document.getElementById('marketStatusStyles')) return;

    const style = document.createElement('style');
    style.id = 'marketStatusStyles';
    style.textContent = `
      .market-status {
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
      }
      .market-status.active { background: #065f46; color: #d1fae5; }
      .market-status.resolved { background: #1e40af; color: #dbeafe; }
      .market-status.cancelled { background: #92400e; color: #fef3c7; }

      .action-btn {
        padding: 4px 8px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 10px;
        font-weight: 600;
        transition: all 0.2s;
      }
      .resolve-btn { background: #10b981; color: white; }
      .resolve-btn:hover { background: #059669; }
      .cancel-btn { background: #ef4444; color: white; }
      .cancel-btn:hover { background: #dc2626; }
      .info-btn { background: #3b82f6; color: white; }
      .info-btn:hover { background: #2563eb; }

      .stat-item.warning .stat-value { color: #f59e0b; }
    `;
    document.head.appendChild(style);
  }

  async resolveExpiredMarkets() {
    if (!confirm('Resolve all expired markets automatically?')) return;

    try {
      this.showMessage('marketsMsg', 'Resolving expired markets...', 'info');
      const data = await this.makeRequest('/admin/prediction_markets/resolve-expired', { method: 'POST' });

      this.showMessage('marketsMsg',
        `✅ Resolved ${data.result.resolved} markets, ${data.result.errors} errors`, 'ok');

      await this.loadStats();
      await this.loadMarkets();
    } catch (error) {
      console.error('Failed to resolve expired markets:', error);
    }
  }

  async restartAutomation() {
    if (!confirm('Restart the market automation system?')) return;

    try {
      this.showMessage('marketsMsg', 'Restarting automation...', 'info');
      const data = await this.makeRequest('/admin/prediction_markets/automation/restart', { method: 'POST' });

      this.showMessage('marketsMsg', '✅ Automation restarted successfully', 'ok');
      await this.loadStats();
    } catch (error) {
      console.error('Failed to restart automation:', error);
    }
  }

  async forceResolveMarket(marketId) {
    if (!confirm('Force auto-resolve this market using external API data?')) return;

    try {
      this.showMessage('marketsMsg', 'Resolving market...', 'info');
      const data = await this.makeRequest(`/admin/prediction_markets/${marketId}/force-resolve`, { method: 'POST' });

      this.showMessage('marketsMsg', `✅ Market resolved: ${data.outcome}`, 'ok');
      await this.loadMarkets();
    } catch (error) {
      console.error('Failed to force resolve market:', error);
    }
  }

  showResolveModal(marketId) {
    const market = this.markets.find(m => m.id === marketId);
    if (!market) return;

    const outcome = prompt(`Manually resolve market: "${market.title}"\n\nEnter outcome (YES/NO/CANCEL):`);
    if (!outcome) return;

    const normalizedOutcome = outcome.toUpperCase();
    if (!['YES', 'NO', 'CANCEL'].includes(normalizedOutcome)) {
      alert('Invalid outcome. Must be YES, NO, or CANCEL');
      return;
    }

    this.resolveMarket(marketId, normalizedOutcome);
  }

  async resolveMarket(marketId, outcome) {
    try {
      this.showMessage('marketsMsg', `Resolving market with outcome: ${outcome}...`, 'info');
      const data = await this.makeRequest(`/admin/prediction_markets/${marketId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ outcome })
      });

      this.showMessage('marketsMsg', `✅ ${data.message}`, 'ok');
      await this.loadMarkets();
    } catch (error) {
      console.error('Failed to resolve market:', error);
    }
  }

  async cancelMarket(marketId) {
    const market = this.markets.find(m => m.id === marketId);
    if (!market) return;

    if (!confirm(`Cancel market and refund all bets?\n\n"${market.title}"\n\nThis action cannot be undone.`)) return;

    try {
      this.showMessage('marketsMsg', 'Cancelling market...', 'info');
      const data = await this.makeRequest(`/admin/prediction_markets/${marketId}`, { method: 'DELETE' });

      this.showMessage('marketsMsg', `✅ ${data.message} (${data.refunds} refunds)`, 'ok');
      await this.loadMarkets();
    } catch (error) {
      console.error('Failed to cancel market:', error);
    }
  }

  viewMarketDetails(marketId) {
    const market = this.markets.find(m => m.id === marketId);
    if (!market) return;

    const details = `
Market Details:
ID: ${market.id}
Title: ${market.title}
Description: ${market.description}
Type: ${market.marketType}
Status: ${market.status}
Token: ${market.tokenSymbol}
Created: ${new Date(market.createdAt).toLocaleString()}
Expires: ${new Date(market.resolveAt).toLocaleString()}
Total Pool: ${this.formatVolume(market.totalPool)} ${market.tokenSymbol}
YES Pool: ${this.formatVolume(market.yesPool)} ${market.tokenSymbol}
NO Pool: ${this.formatVolume(market.noPool)} ${market.tokenSymbol}
Total Bets: ${market.totalBets}
YES Odds: ${market.odds.yes}x (${market.odds.yesImplied}%)
NO Odds: ${market.odds.no}x (${market.odds.noImplied}%)
Rake: ${market.rakePercentage}%
Creator: ${market.creatorId}
Guild: ${market.guildId}
Channel: ${market.channelId}
Market Data: ${JSON.stringify(market.marketData, null, 2)}
    `.trim();

    alert(details);
  }

  applyFilters() {
    this.currentFilters.status = document.getElementById('marketStatusFilter')?.value || 'all';
    this.currentFilters.guildId = document.getElementById('marketGuildFilter')?.value.trim() || '';
    this.loadMarkets();
  }

  clearFilters() {
    document.getElementById('marketStatusFilter').value = 'all';
    document.getElementById('marketGuildFilter').value = '';
    this.currentFilters = { status: 'all', guildId: '' };
    this.loadMarkets();
  }

  exportMarketData() {
    if (this.markets.length === 0) {
      alert('No markets to export');
      return;
    }

    const csv = this.convertToCSV(this.markets);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prediction_markets_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  convertToCSV(markets) {
    const headers = [
      'ID', 'Title', 'Description', 'Type', 'Status', 'Token', 'Created', 'Expires',
      'Total Pool', 'YES Pool', 'NO Pool', 'Total Bets', 'YES Odds', 'NO Odds',
      'Rake %', 'Creator', 'Guild', 'Channel'
    ];

    const rows = markets.map(market => [
      market.id,
      `"${market.title.replace(/"/g, '""')}"`,
      `"${market.description.replace(/"/g, '""')}"`,
      market.marketType,
      market.status,
      market.tokenSymbol,
      market.createdAt,
      market.resolveAt,
      market.totalPool,
      market.yesPool,
      market.noPool,
      market.totalBets,
      market.odds.yes,
      market.odds.no,
      market.rakePercentage,
      market.creatorId,
      market.guildId,
      market.channelId
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  formatVolume(amount) {
    if (amount >= 1000000) {
      return (amount / 1000000).toFixed(1) + 'M';
    } else if (amount >= 1000) {
      return (amount / 1000).toFixed(1) + 'K';
    }
    return amount.toFixed(0);
  }

  formatTimeRemaining(ms) {
    if (ms <= 0) return '⏰ Expired';

    const hours = Math.floor(ms / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h`;
    } else {
      const minutes = Math.floor(ms / (1000 * 60));
      return `${minutes}m`;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showMessage(containerId, message, type = 'info') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const className = type === 'ok' ? 'ok' : type === 'err' ? 'err' : 'info';
    container.innerHTML = `<div class="${className}">${message}</div>`;

    // Clear message after 5 seconds
    setTimeout(() => {
      if (container.innerHTML.includes(message)) {
        container.innerHTML = '';
      }
    }, 5000);
  }
}

// Initialize when the admin dashboard loads
window.marketsAdmin = new PredictionMarketsAdmin();

// Auto-initialize if DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.marketsAdmin.init());
} else {
  window.marketsAdmin.init();
}