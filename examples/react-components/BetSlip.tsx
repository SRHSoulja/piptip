// examples/react-components/BetSlip.tsx
// Modal component for confirming and placing bets

import React, { useState, useEffect } from 'react';

interface BetSlipProps {
  marketId: string;
  side: 'YES' | 'NO';
  odds: number;
  minBet: number;
  maxBet: number;
  tokenSymbol: string;
  onClose: () => void;
  onBetPlaced?: (bet: any) => void;
}

interface UserBalance {
  tokenId: number;
  symbol: string;
  amount: number;
  displayAmount: number;
}

export const BetSlip: React.FC<BetSlipProps> = ({
  marketId,
  side,
  odds,
  minBet,
  maxBet,
  tokenSymbol,
  onClose,
  onBetPlaced
}) => {
  const [amount, setAmount] = useState(minBet.toString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<UserBalance | null>(null);
  const [success, setSuccess] = useState(false);

  // Fetch user balance on mount
  useEffect(() => {
    fetchUserBalance();
  }, []);

  const fetchUserBalance = async () => {
    try {
      const response = await fetch('/api/user/balance', {
        credentials: 'include'
      });

      if (!response.ok) {
        const data = await response.json();
        if (data.needsAuth) {
          setError('Please connect your Discord account to place bets');
          return;
        }
        throw new Error('Failed to fetch balance');
      }

      const data = await response.json();
      const tokenBalance = data.balances.find(
        (b: UserBalance) => b.symbol === tokenSymbol
      );

      setBalance(tokenBalance || {
        tokenId: 0,
        symbol: tokenSymbol,
        amount: 0,
        displayAmount: 0
      });

    } catch (err) {
      setError('Failed to load balance');
    }
  };

  const placeBet = async () => {
    if (!amount || !balance) return;

    setLoading(true);
    setError(null);

    try {
      const betAmount = parseInt(amount);

      // Validate bet amount
      if (betAmount < minBet) {
        throw new Error(`Minimum bet is ${minBet} ${tokenSymbol}`);
      }

      if (betAmount > maxBet) {
        throw new Error(`Maximum bet is ${maxBet} ${tokenSymbol}`);
      }

      if (betAmount > balance.amount) {
        throw new Error(`Insufficient balance. You have ${balance.displayAmount} ${tokenSymbol}`);
      }

      const response = await fetch('/api/bet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          marketId,
          side,
          amount: betAmount
        })
      });

      const data = await response.json();

      if (!data.success) {
        if (data.needsAuth) {
          throw new Error('Please connect your Discord account to place bets');
        }
        throw new Error(data.error || 'Failed to place bet');
      }

      // Success!
      setSuccess(true);
      onBetPlaced?.(data.bet);

      // Update balance
      setBalance(prev => prev ? {
        ...prev,
        amount: prev.amount - betAmount,
        displayAmount: prev.displayAmount - (betAmount / Math.pow(10, prev.tokenId))
      } : null);

      // Auto-close after 2 seconds
      setTimeout(() => {
        onClose();
      }, 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place bet');
    } finally {
      setLoading(false);
    }
  };

  const calculatePayout = () => {
    const betAmount = parseInt(amount) || 0;
    return (betAmount * odds).toFixed(2);
  };

  const handleAmountChange = (newAmount: string) => {
    // Only allow positive integers
    if (/^\d*$/.test(newAmount)) {
      setAmount(newAmount);
    }
  };

  const setPresetAmount = (preset: number) => {
    setAmount(preset.toString());
  };

  if (success) {
    return (
      <div className="bet-slip-overlay" onClick={onClose}>
        <div className="bet-slip success-slip" onClick={e => e.stopPropagation()}>
          <div className="success-content">
            <div className="success-icon">✅</div>
            <h3>Bet Placed Successfully!</h3>
            <div className="bet-summary">
              <p><strong>{side}</strong> for <strong>{amount} {tokenSymbol}</strong></p>
              <p>Potential payout: <strong>{calculatePayout()} {tokenSymbol}</strong></p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bet-slip-overlay" onClick={onClose}>
      <div className="bet-slip" onClick={e => e.stopPropagation()}>
        <div className="bet-slip-header">
          <h3>Place Bet</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="bet-details">
          <div className="side-indicator">
            <span className={`side-badge ${side.toLowerCase()}`}>
              {side}
            </span>
            <span className="odds-display">{odds.toFixed(2)}x odds</span>
          </div>
        </div>

        {balance && (
          <div className="balance-display">
            <span>Balance: <strong>{balance.displayAmount.toFixed(4)} {tokenSymbol}</strong></span>
          </div>
        )}

        <div className="amount-input-section">
          <label htmlFor="bet-amount">Bet Amount</label>
          <div className="amount-input-container">
            <input
              id="bet-amount"
              type="text"
              value={amount}
              onChange={e => handleAmountChange(e.target.value)}
              placeholder={`Min: ${minBet}`}
              className="amount-input"
            />
            <span className="token-suffix">{tokenSymbol}</span>
          </div>

          {/* Preset amount buttons */}
          <div className="preset-buttons">
            {[minBet, minBet * 5, minBet * 10, minBet * 25].map(preset => (
              <button
                key={preset}
                className="preset-btn"
                onClick={() => setPresetAmount(preset)}
                disabled={!balance || preset > balance.amount}
              >
                {preset}
              </button>
            ))}
            {balance && balance.amount > minBet * 25 && (
              <button
                className="preset-btn"
                onClick={() => setPresetAmount(Math.floor(balance.amount * 0.5))}
              >
                50%
              </button>
            )}
          </div>
        </div>

        {/* Payout calculation */}
        <div className="payout-display">
          <div className="payout-row">
            <span>Potential Payout:</span>
            <span className="payout-amount">
              {calculatePayout()} {tokenSymbol}
            </span>
          </div>
          <div className="profit-row">
            <span>Potential Profit:</span>
            <span className="profit-amount">
              {(parseFloat(calculatePayout()) - (parseInt(amount) || 0)).toFixed(2)} {tokenSymbol}
            </span>
          </div>
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        <div className="bet-slip-actions">
          <button className="cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="place-bet-btn"
            onClick={placeBet}
            disabled={loading || !amount || parseInt(amount) < minBet || !balance}
          >
            {loading ? 'Placing Bet...' : `Place ${side} Bet`}
          </button>
        </div>

        {/* Fine print */}
        <div className="bet-slip-footer">
          <p>By placing this bet, you agree to the market terms. Bets cannot be canceled once placed.</p>
        </div>
      </div>
    </div>
  );
};

// CSS styles for BetSlip
const betSlipStyles = `
.bet-slip-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.bet-slip {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 16px;
  width: 90%;
  max-width: 400px;
  max-height: 90vh;
  overflow-y: auto;
  animation: slideUp 0.3s ease;
}

.success-slip {
  text-align: center;
  padding: 40px 20px;
}

.success-content {
  color: white;
}

.success-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.bet-summary {
  margin-top: 20px;
  padding: 16px;
  background: #0f1419;
  border-radius: 8px;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.bet-slip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 20px 0;
  border-bottom: 1px solid #333;
  padding-bottom: 16px;
  margin-bottom: 20px;
}

.bet-slip-header h3 {
  margin: 0;
  color: white;
  font-size: 18px;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: #9ca3af;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  color: white;
}

.bet-details {
  padding: 0 20px;
  margin-bottom: 20px;
}

.side-indicator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: #0f1419;
  border-radius: 8px;
}

.side-badge {
  padding: 8px 16px;
  border-radius: 20px;
  font-weight: 600;
  font-size: 14px;
}

.side-badge.yes {
  background: #10b981;
  color: white;
}

.side-badge.no {
  background: #ef4444;
  color: white;
}

.odds-display {
  color: #9ca3af;
  font-size: 14px;
}

.balance-display {
  padding: 0 20px;
  margin-bottom: 20px;
  color: #9ca3af;
  font-size: 14px;
  text-align: center;
}

.amount-input-section {
  padding: 0 20px;
  margin-bottom: 20px;
}

.amount-input-section label {
  display: block;
  color: white;
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 14px;
}

.amount-input-container {
  position: relative;
  display: flex;
  align-items: center;
}

.amount-input {
  width: 100%;
  padding: 12px 16px;
  padding-right: 60px;
  background: #0f1419;
  border: 1px solid #374151;
  border-radius: 8px;
  color: white;
  font-size: 16px;
  font-weight: 600;
}

.amount-input:focus {
  outline: none;
  border-color: #3b82f6;
}

.token-suffix {
  position: absolute;
  right: 16px;
  color: #9ca3af;
  font-size: 14px;
  font-weight: 600;
}

.preset-buttons {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(60px, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.preset-btn {
  padding: 8px 12px;
  background: #374151;
  border: 1px solid #4b5563;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.2s;
}

.preset-btn:hover:not(:disabled) {
  background: #4b5563;
}

.preset-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.payout-display {
  padding: 0 20px;
  margin-bottom: 20px;
}

.payout-row, .profit-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #0f1419;
  margin-bottom: 8px;
  border-radius: 8px;
  color: #d1d5db;
}

.payout-amount {
  color: #10b981;
  font-weight: 600;
}

.profit-amount {
  color: #3b82f6;
  font-weight: 600;
}

.error-message {
  margin: 0 20px 20px;
  padding: 12px 16px;
  background: #7f1d1d;
  border: 1px solid #dc2626;
  border-radius: 8px;
  color: #fecaca;
  font-size: 14px;
}

.bet-slip-actions {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 12px;
  padding: 0 20px;
  margin-bottom: 20px;
}

.cancel-btn, .place-bet-btn {
  padding: 12px 16px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.cancel-btn {
  background: #374151;
  color: white;
}

.cancel-btn:hover {
  background: #4b5563;
}

.place-bet-btn {
  background: #3b82f6;
  color: white;
}

.place-bet-btn:hover:not(:disabled) {
  background: #2563eb;
}

.place-bet-btn:disabled {
  background: #6b7280;
  cursor: not-allowed;
}

.bet-slip-footer {
  padding: 16px 20px;
  border-top: 1px solid #333;
  color: #9ca3af;
  font-size: 12px;
  text-align: center;
  line-height: 1.4;
}
`;