# PIPTip React Components for Website Integration

This directory contains example React/TypeScript components that demonstrate how to integrate PIPTip's prediction markets into your website.

## 🚀 Quick Start

1. **Install dependencies** in your Next.js/React project:
```bash
npm install react @types/react
```

2. **Set up Discord OAuth** to get user authentication working. The components expect `req.user.discordId` or `req.session.discordId` to be available.

3. **Configure CORS** in your PIPTip server to allow your website domain (already configured in `/src/web/api/markets.ts`).

4. **Copy components** to your project and customize the styling.

## 📦 Components Overview

### `MarketList.tsx`
- **Purpose**: Display all active prediction markets with live odds
- **Features**:
  - Live odds visualization with progress bars
  - Filtering by guild/token
  - Pagination with "Load More"
  - Quick bet buttons on each market
  - Real-time pool updates
- **API Calls**: `GET /api/markets`

### `BetSlip.tsx`
- **Purpose**: Modal for placing bets with amount selection
- **Features**:
  - Balance validation
  - Preset amount buttons (min bet, 5x, 10x, 25x, 50%)
  - Payout calculation
  - Success/error handling
  - Discord auth validation
- **API Calls**: `POST /api/bet`, `GET /api/user/balance`

### `UserBets.tsx`
- **Purpose**: Display user's betting history and statistics
- **Features**:
  - Win/loss statistics
  - Filterable bet history (all/active/won/lost)
  - Expandable bet details
  - Profit/loss calculations
  - Net P&L tracking
- **API Calls**: `GET /api/user/bets`

## 🔑 Authentication Integration

The components expect Discord OAuth integration. Here's how to set it up:

### Option 1: Session-based (Recommended)
```typescript
// Your Discord OAuth callback should set:
req.session.discordId = user.id;

// Components will automatically include session cookies:
fetch('/api/bet', {
  credentials: 'include',  // Includes session cookies
  // ...
});
```

### Option 2: Token-based
```typescript
// Store Discord token in localStorage/context
const discordToken = getDiscordToken();

// Include in API calls:
fetch('/api/bet', {
  headers: {
    'Authorization': `Bearer ${discordToken}`,
    // ...
  }
});
```

## 🎨 Styling

The components include comprehensive CSS-in-JS styles. You can:

1. **Extract to CSS modules** for better performance
2. **Customize colors/spacing** to match your brand
3. **Add animations** for better UX (loading states, hover effects)
4. **Make responsive** for mobile devices

### Key Design Elements:
- **Dark theme** by default (matches Discord aesthetic)
- **Green/Red color coding** for YES/NO bets
- **Progress bars** for betting pool visualization
- **Modal overlays** for bet placement
- **Responsive grid layouts**

## 🔄 Real-time Updates

For live updates without page refresh:

### WebSocket Integration (Optional)
```typescript
import { io } from 'socket.io-client';

const socket = io('/markets');

socket.on('market_updated', (marketData) => {
  // Update market odds in real-time
  updateMarketInState(marketData);
});

socket.on('bet_placed', (betData) => {
  // Show bet in user's history immediately
  addBetToHistory(betData);
});
```

### Polling Updates
```typescript
// Poll for updates every 30 seconds
useEffect(() => {
  const interval = setInterval(() => {
    fetchMarkets(true); // Refresh market list
  }, 30000);

  return () => clearInterval(interval);
}, []);
```

## 📱 Mobile Optimization

The components are designed mobile-first but may need adjustments:

```css
/* Mobile-specific improvements */
@media (max-width: 768px) {
  .market-grid {
    grid-template-columns: 1fr; /* Single column on mobile */
  }

  .bet-slip {
    width: 95%; /* Full width modal on mobile */
    margin: 0 auto;
  }

  .quick-bet-buttons {
    grid-template-columns: 1fr; /* Stack bet buttons vertically */
    gap: 8px;
  }
}
```

## 🔐 Security Considerations

1. **Input Validation**: All bet amounts are validated client and server-side
2. **Rate Limiting**: Consider adding rate limits to betting endpoints
3. **Balance Checks**: Server validates sufficient balance before placing bets
4. **Auth Checks**: All protected endpoints require Discord authentication
5. **CORS**: Properly configured for your website domains only

## 🚀 Performance Tips

1. **Lazy Loading**: Load components only when needed
2. **Memoization**: Use React.memo for expensive renders
3. **Virtual Scrolling**: For large bet histories
4. **Image Optimization**: Compress any market-related images
5. **Bundle Splitting**: Separate prediction market code into its own chunk

## 🧪 Example Usage

```tsx
import { MarketList, UserBets } from './components/prediction-markets';

export default function MarketsPage() {
  return (
    <div className="markets-page">
      <h1>🎯 Prediction Markets</h1>

      {/* Show all markets */}
      <MarketList
        guildId="optional-guild-filter"
        tokenFilter="USDC"
        onMarketClick={(market) => {
          router.push(`/market/${market.id}`);
        }}
      />

      {/* User's betting history */}
      <UserBets />
    </div>
  );
}
```

## 🔗 API Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/markets` | GET | List active markets with live odds |
| `/api/market/:id` | GET | Get detailed market info + recent bets |
| `/api/bet` | POST | Place a bet (requires Discord auth) |
| `/api/user/bets` | GET | User's betting history |
| `/api/user/balance` | GET | User's token balances |
| `/api/stats` | GET | Global market statistics |

## 🤝 Integration with Discord Bot

The website and Discord bot share the same database, so:

- ✅ Bets placed on website appear in Discord
- ✅ Bets placed via Discord commands appear on website
- ✅ Same odds/pools visible everywhere
- ✅ Same user balances across platforms
- ✅ Market resolutions affect both platforms

This creates a seamless experience where users can bet anywhere and see consistent data everywhere.