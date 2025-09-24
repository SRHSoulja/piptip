// examples/react-components/MarketList.tsx
// React component for displaying all prediction markets

import React, { useState, useEffect } from 'react';

interface Market {
  id: string;
  title: string;
  description: string;
  marketType: string;
  tokenSymbol: string;
  resolveAt: string;
  timeLeftMs: number;
  totalPool: number;
  totalBets: number;
  yesPool: number;
  noPool: number;
  minBet: number;
  maxBet: number;
  odds: {
    yes: number;
    no: number;
    yesImplied: number;
    noImplied: number;
  };
  marketData: any;
}

interface MarketListProps {
  guildId?: string;
  tokenFilter?: string;
  onMarketClick?: (market: Market) => void;
}

export const MarketList: React.FC<MarketListProps> = ({
  guildId,
  tokenFilter,
  onMarketClick
}) => {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchMarkets = async (reset = false) => {
    try {
      setLoading(true);
      const currentPage = reset ? 0 : page;

      const params = new URLSearchParams({
        limit: '20',
        offset: (currentPage * 20).toString(),
      });

      if (guildId) params.append('guild_id', guildId);
      if (tokenFilter) params.append('token', tokenFilter);

      // Include Discord OAuth token from your auth system
      const response = await fetch(`/api/markets?${params}`, {
        credentials: 'include', // Include session cookies
        headers: {
          'Content-Type': 'application/json',
          // If using bearer tokens instead of sessions:
          // 'Authorization': `Bearer ${getDiscordToken()}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch markets');
      }

      const data = await response.json();

      if (reset) {
        setMarkets(data.markets);
        setPage(0);
      } else {
        setMarkets(prev => [...prev, ...data.markets]);
      }

      setHasMore(data.pagination.hasMore);
      setPage(currentPage + 1);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load markets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarkets(true);
  }, [guildId, tokenFilter]);

  const formatTimeLeft = (ms: number) => {
    if (ms <= 0) return 'Expired';

    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }

    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const formatAmount = (amount: number, decimals = 18) => {
    return (amount / Math.pow(10, decimals)).toLocaleString(undefined, {
      maximumFractionDigits: 2
    });
  };

  if (error) {
    return (
      <div className="error-container">
        <p>Error: {error}</p>
        <button onClick={() => fetchMarkets(true)}>Retry</button>
      </div>
    );
  }

  return (
    <div className="market-list">
      <div className="market-list-header">
        <h2>🎯 Prediction Markets</h2>
        <div className="filters">
          {/* Add filter controls here */}
        </div>
      </div>

      <div className="market-grid">
        {markets.map(market => (
          <MarketCard
            key={market.id}
            market={market}
            onClick={() => onMarketClick?.(market)}
          />
        ))}
      </div>

      {loading && (
        <div className="loading">
          <p>Loading markets...</p>
        </div>
      )}

      {hasMore && !loading && (
        <button
          className="load-more-btn"
          onClick={() => fetchMarkets()}
        >
          Load More Markets
        </button>
      )}

      {markets.length === 0 && !loading && (
        <div className="empty-state">
          <p>No active markets found</p>
        </div>
      )}
    </div>
  );
};

interface MarketCardProps {
  market: Market;
  onClick?: () => void;
}

const MarketCard: React.FC<MarketCardProps> = ({ market, onClick }) => {
  const yesWidth = market.totalPool > 0 ?
    (market.yesPool / market.totalPool) * 100 : 50;
  const noWidth = 100 - yesWidth;

  return (
    <div className="market-card" onClick={onClick}>
      <div className="market-header">
        <h3>{market.title}</h3>
        <div className="market-meta">
          <span className="token-badge">{market.tokenSymbol}</span>
          <span className="time-left">{formatTimeLeft(market.timeLeftMs)}</span>
        </div>
      </div>

      <p className="market-description">{market.description}</p>

      {/* Betting Pool Visualization */}
      <div className="pool-container">
        <div className="pool-bar">
          <div
            className="yes-bar"
            style={{ width: `${yesWidth}%` }}
          />
          <div
            className="no-bar"
            style={{ width: `${noWidth}%` }}
          />
        </div>

        <div className="pool-labels">
          <span className="yes-label">
            YES {market.odds.yesImplied}%
          </span>
          <span className="no-label">
            NO {market.odds.noImplied}%
          </span>
        </div>
      </div>

      {/* Market Stats */}
      <div className="market-stats">
        <div className="stat">
          <span className="stat-label">Total Pool</span>
          <span className="stat-value">
            {formatAmount(market.totalPool)} {market.tokenSymbol}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Bets</span>
          <span className="stat-value">{market.totalBets}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Odds</span>
          <span className="stat-value">
            {market.odds.yes.toFixed(2)}x / {market.odds.no.toFixed(2)}x
          </span>
        </div>
      </div>

      {/* Quick Bet Buttons */}
      <div className="quick-bet-buttons">
        <BetButton
          marketId={market.id}
          side="YES"
          odds={market.odds.yes}
          color="green"
          minBet={market.minBet}
          maxBet={market.maxBet}
          tokenSymbol={market.tokenSymbol}
        />
        <BetButton
          marketId={market.id}
          side="NO"
          odds={market.odds.no}
          color="red"
          minBet={market.minBet}
          maxBet={market.maxBet}
          tokenSymbol={market.tokenSymbol}
        />
      </div>
    </div>
  );
};

interface BetButtonProps {
  marketId: string;
  side: 'YES' | 'NO';
  odds: number;
  color: 'green' | 'red';
  minBet: number;
  maxBet: number;
  tokenSymbol: string;
}

const BetButton: React.FC<BetButtonProps> = ({
  marketId,
  side,
  odds,
  color,
  minBet,
  maxBet,
  tokenSymbol
}) => {
  const [showBetSlip, setShowBetSlip] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click
    setShowBetSlip(true);
  };

  return (
    <>
      <button
        className={`bet-btn bet-btn-${color}`}
        onClick={handleClick}
      >
        <span className="bet-side">{side}</span>
        <span className="bet-odds">{odds.toFixed(2)}x</span>
      </button>

      {showBetSlip && (
        <BetSlip
          marketId={marketId}
          side={side}
          odds={odds}
          minBet={minBet}
          maxBet={maxBet}
          tokenSymbol={tokenSymbol}
          onClose={() => setShowBetSlip(false)}
        />
      )}
    </>
  );
};

// Import the BetSlip component
import { BetSlip } from './BetSlip';

// CSS styles (you'd put these in a separate CSS file)
const styles = `
.market-list {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.market-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 20px;
  margin-top: 20px;
}

.market-card {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.market-card:hover {
  border-color: #555;
  transform: translateY(-2px);
}

.market-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.market-header h3 {
  margin: 0;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
}

.market-meta {
  display: flex;
  gap: 8px;
  align-items: center;
}

.token-badge {
  background: #3b82f6;
  color: white;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.time-left {
  color: #9ca3af;
  font-size: 12px;
}

.market-description {
  color: #d1d5db;
  font-size: 14px;
  margin-bottom: 16px;
  line-height: 1.4;
}

.pool-container {
  margin-bottom: 16px;
}

.pool-bar {
  height: 8px;
  background: #374151;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
}

.yes-bar {
  background: #10b981;
  transition: width 0.3s ease;
}

.no-bar {
  background: #ef4444;
  transition: width 0.3s ease;
}

.pool-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  font-weight: 600;
}

.yes-label {
  color: #10b981;
}

.no-label {
  color: #ef4444;
}

.market-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.stat {
  text-align: center;
}

.stat-label {
  display: block;
  color: #9ca3af;
  font-size: 11px;
  margin-bottom: 4px;
}

.stat-value {
  display: block;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}

.quick-bet-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.bet-btn {
  padding: 12px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.bet-btn-green {
  background: #10b981;
  color: white;
}

.bet-btn-green:hover {
  background: #059669;
}

.bet-btn-red {
  background: #ef4444;
  color: white;
}

.bet-btn-red:hover {
  background: #dc2626;
}

.bet-side {
  font-size: 14px;
}

.bet-odds {
  font-size: 12px;
  opacity: 0.9;
}

.load-more-btn {
  display: block;
  margin: 40px auto;
  padding: 12px 24px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.load-more-btn:hover {
  background: #2563eb;
}

.loading, .empty-state, .error-container {
  text-align: center;
  padding: 40px;
  color: #9ca3af;
}

.error-container button {
  margin-top: 16px;
  padding: 8px 16px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
`;