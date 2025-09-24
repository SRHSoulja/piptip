// examples/react-components/UserBets.tsx
// Component for displaying user's betting history and active bets

import React, { useState, useEffect } from 'react';

interface UserBet {
  id: string;
  marketId: string;
  marketTitle: string;
  marketDescription: string;
  side: 'YES' | 'NO';
  amount: number;
  tokenSymbol: string;
  placedAt: string;
  result: 'pending' | 'won' | 'lost' | 'refunded';
  payout: number;
  market: {
    status: string;
    outcome?: string;
    resolveAt: string;
    marketType: string;
    totalPool: number;
  };
}

interface UserBetsProps {
  discordId?: string; // Optional - if not provided, shows current user's bets
}

export const UserBets: React.FC<UserBetsProps> = ({ discordId }) => {
  const [bets, setBets] = useState<UserBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'won' | 'lost'>('all');
  const [stats, setStats] = useState({
    totalBets: 0,
    activeBets: 0,
    wonBets: 0,
    lostBets: 0,
    totalWagered: 0,
    totalWon: 0,
    totalLost: 0,
    winRate: 0,
    netProfit: 0
  });

  useEffect(() => {
    fetchUserBets();
  }, [filter]);

  const fetchUserBets = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        status: filter,
        limit: '50'
      });

      const response = await fetch(`/api/user/bets?${params}`, {
        credentials: 'include'
      });

      if (!response.ok) {
        const data = await response.json();
        if (data.needsAuth) {
          setError('Please connect your Discord account to view betting history');
          return;
        }
        throw new Error('Failed to fetch betting history');
      }

      const data = await response.json();
      setBets(data.bets);
      calculateStats(data.bets);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load betting history');
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (bets: UserBet[]) => {
    const stats = {
      totalBets: bets.length,
      activeBets: bets.filter(b => b.result === 'pending').length,
      wonBets: bets.filter(b => b.result === 'won').length,
      lostBets: bets.filter(b => b.result === 'lost').length,
      totalWagered: bets.reduce((sum, b) => sum + b.amount, 0),
      totalWon: bets.filter(b => b.result === 'won').reduce((sum, b) => sum + b.payout, 0),
      totalLost: bets.filter(b => b.result === 'lost').reduce((sum, b) => sum + b.amount, 0),
      winRate: 0,
      netProfit: 0
    };

    const resolvedBets = stats.wonBets + stats.lostBets;
    if (resolvedBets > 0) {
      stats.winRate = (stats.wonBets / resolvedBets) * 100;
    }

    stats.netProfit = stats.totalWon - stats.totalLost;
    setStats(stats);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatAmount = (amount: number, decimals = 18) => {
    return (amount / Math.pow(10, decimals)).toLocaleString(undefined, {
      maximumFractionDigits: 4
    });
  };

  const getResultColor = (result: string) => {
    switch (result) {
      case 'won': return '#10b981';
      case 'lost': return '#ef4444';
      case 'pending': return '#f59e0b';
      case 'refunded': return '#6b7280';
      default: return '#9ca3af';
    }
  };

  const getResultText = (result: string) => {
    switch (result) {
      case 'won': return '✅ Won';
      case 'lost': return '❌ Lost';
      case 'pending': return '⏳ Pending';
      case 'refunded': return '↩️ Refunded';
      default: return result;
    }
  };

  if (loading) {
    return (
      <div className="user-bets-loading">
        <p>Loading betting history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="user-bets-error">
        <p>{error}</p>
        <button onClick={fetchUserBets}>Retry</button>
      </div>
    );
  }

  return (
    <div className="user-bets-container">
      <div className="user-bets-header">
        <h2>🎯 Your Betting History</h2>
      </div>

      {/* Stats Summary */}
      <div className="betting-stats">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.totalBets}</div>
            <div className="stat-label">Total Bets</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.activeBets}</div>
            <div className="stat-label">Active</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.wonBets}</div>
            <div className="stat-label">Won</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.winRate.toFixed(1)}%</div>
            <div className="stat-label">Win Rate</div>
          </div>
          <div className="stat-card">
            <div className={`stat-value ${stats.netProfit >= 0 ? 'profit' : 'loss'}`}>
              {stats.netProfit >= 0 ? '+' : ''}{stats.netProfit}
            </div>
            <div className="stat-label">Net P&L</div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="filter-tabs">
        {(['all', 'active', 'won', 'lost'] as const).map(tab => (
          <button
            key={tab}
            className={`filter-tab ${filter === tab ? 'active' : ''}`}
            onClick={() => setFilter(tab)}
          >
            {tab === 'all' ? 'All Bets' :
             tab === 'active' ? 'Active' :
             tab === 'won' ? 'Won' : 'Lost'}
          </button>
        ))}
      </div>

      {/* Bets List */}
      <div className="bets-list">
        {bets.length === 0 ? (
          <div className="empty-state">
            <p>No bets found</p>
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')}>
                Show all bets
              </button>
            )}
          </div>
        ) : (
          bets.map(bet => (
            <BetCard key={bet.id} bet={bet} />
          ))
        )}
      </div>
    </div>
  );
};

interface BetCardProps {
  bet: UserBet;
}

const BetCard: React.FC<BetCardProps> = ({ bet }) => {
  const [expanded, setExpanded] = useState(false);

  const getProfitLoss = () => {
    if (bet.result === 'won') {
      return bet.payout - bet.amount;
    } else if (bet.result === 'lost') {
      return -bet.amount;
    } else if (bet.result === 'refunded') {
      return 0;
    }
    return null; // pending
  };

  const profitLoss = getProfitLoss();

  return (
    <div className="bet-card">
      <div className="bet-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="bet-main-info">
          <div className="bet-title-row">
            <h4 className="bet-title">{bet.marketTitle}</h4>
            <div className={`bet-side-badge ${bet.side.toLowerCase()}`}>
              {bet.side}
            </div>
          </div>

          <div className="bet-meta-row">
            <span className="bet-amount">
              {bet.amount} {bet.tokenSymbol}
            </span>
            <span className="bet-date">
              {formatDate(bet.placedAt)}
            </span>
          </div>
        </div>

        <div className="bet-result-section">
          <div
            className="bet-result"
            style={{ color: getResultColor(bet.result) }}
          >
            {getResultText(bet.result)}
          </div>

          {profitLoss !== null && (
            <div className={`profit-loss ${profitLoss >= 0 ? 'profit' : 'loss'}`}>
              {profitLoss >= 0 ? '+' : ''}{profitLoss} {bet.tokenSymbol}
            </div>
          )}

          <div className="expand-icon">
            {expanded ? '▼' : '▶'}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="bet-card-details">
          <div className="bet-description">
            <p>{bet.marketDescription}</p>
          </div>

          <div className="bet-details-grid">
            <div className="detail-item">
              <span className="detail-label">Market Type:</span>
              <span className="detail-value">{bet.market.marketType.replace('_', ' ')}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Total Pool:</span>
              <span className="detail-value">{bet.market.totalPool} {bet.tokenSymbol}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">Resolve Time:</span>
              <span className="detail-value">{formatDate(bet.market.resolveAt)}</span>
            </div>

            {bet.result === 'won' && (
              <div className="detail-item">
                <span className="detail-label">Payout:</span>
                <span className="detail-value payout-highlight">
                  {bet.payout} {bet.tokenSymbol}
                </span>
              </div>
            )}

            {bet.market.outcome && (
              <div className="detail-item">
                <span className="detail-label">Market Outcome:</span>
                <span className={`detail-value ${bet.market.outcome.toLowerCase()}`}>
                  {bet.market.outcome}
                </span>
              </div>
            )}
          </div>

          <div className="bet-actions">
            <button
              className="view-market-btn"
              onClick={() => window.open(`/market/${bet.marketId}`, '_blank')}
            >
              View Market
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// CSS styles for UserBets component
const userBetsStyles = `
.user-bets-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.user-bets-header h2 {
  color: white;
  margin-bottom: 24px;
}

.betting-stats {
  margin-bottom: 32px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
}

.stat-card {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 20px;
  text-align: center;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: white;
  margin-bottom: 4px;
}

.stat-value.profit {
  color: #10b981;
}

.stat-value.loss {
  color: #ef4444;
}

.stat-label {
  font-size: 12px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.filter-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  background: #0f1419;
  padding: 4px;
  border-radius: 8px;
}

.filter-tab {
  flex: 1;
  padding: 8px 16px;
  background: none;
  border: none;
  border-radius: 6px;
  color: #9ca3af;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.filter-tab:hover {
  color: white;
}

.filter-tab.active {
  background: #3b82f6;
  color: white;
}

.bets-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bet-card {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s ease;
}

.bet-card:hover {
  border-color: #555;
}

.bet-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  cursor: pointer;
}

.bet-main-info {
  flex: 1;
}

.bet-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.bet-title {
  margin: 0;
  color: white;
  font-size: 16px;
  font-weight: 600;
  flex: 1;
}

.bet-side-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.bet-side-badge.yes {
  background: #10b981;
  color: white;
}

.bet-side-badge.no {
  background: #ef4444;
  color: white;
}

.bet-meta-row {
  display: flex;
  gap: 16px;
  color: #9ca3af;
  font-size: 14px;
}

.bet-amount {
  font-weight: 600;
}

.bet-result-section {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  min-width: 120px;
}

.bet-result {
  font-weight: 600;
  font-size: 14px;
}

.profit-loss {
  font-size: 13px;
  font-weight: 600;
}

.profit-loss.profit {
  color: #10b981;
}

.profit-loss.loss {
  color: #ef4444;
}

.expand-icon {
  color: #9ca3af;
  font-size: 12px;
  margin-top: 4px;
}

.bet-card-details {
  border-top: 1px solid #333;
  padding: 20px;
  background: #0f1419;
}

.bet-description {
  margin-bottom: 20px;
}

.bet-description p {
  color: #d1d5db;
  margin: 0;
  line-height: 1.5;
}

.bet-details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.detail-label {
  color: #9ca3af;
  font-size: 14px;
}

.detail-value {
  color: white;
  font-weight: 600;
  font-size: 14px;
}

.detail-value.payout-highlight {
  color: #10b981;
}

.detail-value.yes {
  color: #10b981;
}

.detail-value.no {
  color: #ef4444;
}

.bet-actions {
  display: flex;
  gap: 12px;
}

.view-market-btn {
  padding: 8px 16px;
  background: #374151;
  border: 1px solid #4b5563;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.view-market-btn:hover {
  background: #4b5563;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #9ca3af;
}

.empty-state button {
  margin-top: 16px;
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.user-bets-loading,
.user-bets-error {
  text-align: center;
  padding: 60px 20px;
  color: #9ca3af;
}

.user-bets-error button {
  margin-top: 16px;
  padding: 8px 16px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
`;