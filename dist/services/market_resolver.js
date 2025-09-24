// src/services/market_resolver.ts - Market resolution with API data fetching
import { predictionMarkets } from "./prediction_markets.js";
import { sportsResolver } from "./sports_resolver.js";
/**
 * Handles automatic market resolution using external APIs
 */
export class MarketResolverService {
    /**
     * Fetch token price from DexScreener API
     */
    async fetchDexScreenerPrice(symbol) {
        try {
            const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`;
            console.log(`Fetching DexScreener data for ${symbol}...`);
            const response = await fetch(url);
            if (!response.ok) {
                return {
                    symbol,
                    price: 0,
                    success: false,
                    error: `DexScreener API error: ${response.status}`
                };
            }
            const data = await response.json();
            if (!data.pairs || data.pairs.length === 0) {
                return {
                    symbol,
                    price: 0,
                    success: false,
                    error: `No trading pairs found for ${symbol}`
                };
            }
            // Get the pair with highest volume (most reliable price)
            const bestPair = data.pairs.reduce((best, current) => {
                const currentVolume = parseFloat(current.volume?.h24 || '0');
                const bestVolume = parseFloat(best.volume?.h24 || '0');
                return currentVolume > bestVolume ? current : best;
            });
            const price = parseFloat(bestPair.priceUsd || '0');
            const volume24h = parseFloat(bestPair.volume?.h24 || '0');
            const priceChange24h = parseFloat(bestPair.priceChange?.h24 || '0');
            console.log(`DexScreener: ${symbol} = $${price} (24h vol: $${volume24h}, change: ${priceChange24h}%)`);
            return {
                symbol,
                price,
                volume24h,
                priceChange24h,
                chain: bestPair.chainId,
                success: true
            };
        }
        catch (error) {
            console.error(`DexScreener API error for ${symbol}:`, error);
            return {
                symbol,
                price: 0,
                success: false,
                error: `API request failed: ${error}`
            };
        }
    }
    /**
     * Fetch major token price from CoinGecko API
     */
    async fetchCoinGeckoPrice(tokenId) {
        try {
            const url = `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`;
            console.log(`Fetching CoinGecko data for ${tokenId}...`);
            const response = await fetch(url);
            if (!response.ok) {
                return {
                    symbol: tokenId,
                    price: 0,
                    success: false,
                    error: `CoinGecko API error: ${response.status}`
                };
            }
            const data = await response.json();
            if (!data[tokenId]) {
                return {
                    symbol: tokenId,
                    price: 0,
                    success: false,
                    error: `Token ${tokenId} not found on CoinGecko`
                };
            }
            const tokenData = data[tokenId];
            const price = tokenData.usd || 0;
            const volume24h = tokenData.usd_24h_vol || 0;
            const priceChange24h = tokenData.usd_24h_change || 0;
            console.log(`CoinGecko: ${tokenId} = $${price} (24h vol: $${volume24h}, change: ${priceChange24h}%)`);
            return {
                symbol: tokenId,
                price,
                volume24h,
                priceChange24h,
                success: true
            };
        }
        catch (error) {
            console.error(`CoinGecko API error for ${tokenId}:`, error);
            return {
                symbol: tokenId,
                price: 0,
                success: false,
                error: `API request failed: ${error}`
            };
        }
    }
    /**
     * Get token volume ranking on a specific chain
     */
    async getTokenRankingByVolume(symbol, chain) {
        try {
            // For now, use DexScreener's trending/top tokens
            // This is a simplified implementation - you could enhance with more sophisticated ranking
            const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`;
            const response = await fetch(url);
            if (!response.ok) {
                return { rank: 0, success: false, error: `API error: ${response.status}` };
            }
            const data = await response.json();
            if (!data.pairs || data.pairs.length === 0) {
                return { rank: 0, success: false, error: `No pairs found for ${symbol}` };
            }
            // Filter by chain if specified
            let pairs = data.pairs;
            if (chain) {
                pairs = pairs.filter((p) => p.chainId?.toLowerCase() === chain.toLowerCase());
            }
            if (pairs.length === 0) {
                return { rank: 0, success: false, error: `No pairs found for ${symbol} on ${chain}` };
            }
            // For this implementation, we'll use a simple volume-based ranking
            // In production, you'd want to fetch a proper ranking API
            const volume = parseFloat(pairs[0].volume?.h24 || '0');
            // Simplified ranking logic based on volume thresholds
            let rank = 100; // Default to low rank
            if (volume > 10000000)
                rank = 1; // $10M+ volume = top rank
            else if (volume > 5000000)
                rank = 2;
            else if (volume > 1000000)
                rank = 3;
            else if (volume > 500000)
                rank = 5;
            else if (volume > 100000)
                rank = 10;
            else if (volume > 50000)
                rank = 20;
            console.log(`Volume ranking for ${symbol}: rank ${rank} (volume: $${volume})`);
            return { rank, success: true };
        }
        catch (error) {
            console.error(`Error getting token ranking for ${symbol}:`, error);
            return { rank: 0, success: false, error: `Ranking fetch failed: ${error}` };
        }
    }
    /**
     * Resolve a price-based market
     */
    async resolvePriceMarket(market) {
        const { marketData } = market;
        const symbol = marketData.symbol || market.tokenSymbol;
        let currentPriceData;
        // Try DexScreener first, fallback to CoinGecko for major tokens
        currentPriceData = await this.fetchDexScreenerPrice(symbol);
        if (!currentPriceData.success && this.isMajorToken(symbol)) {
            const coinGeckoId = this.getCoinGeckoId(symbol);
            if (coinGeckoId) {
                currentPriceData = await this.fetchCoinGeckoPrice(coinGeckoId);
            }
        }
        if (!currentPriceData.success) {
            console.error(`Failed to fetch price for ${symbol}, cancelling market ${market.id}`);
            return {
                outcome: 'CANCEL',
                data: { error: currentPriceData.error }
            };
        }
        const resolutionData = {
            currentPrice: currentPriceData.price,
            initialPrice: marketData.initialPrice,
            targetPrice: marketData.targetPrice
        };
        let outcome;
        switch (market.marketType) {
            case 'PRICE_UP_DOWN':
                // "Will price be higher than when market created?"
                outcome = currentPriceData.price > marketData.initialPrice ? 'YES' : 'NO';
                break;
            case 'PRICE_ABOVE_BELOW':
                // "Will price be above $X?"
                outcome = currentPriceData.price > marketData.targetPrice ? 'YES' : 'NO';
                break;
            default:
                console.error(`Unknown market type: ${market.marketType}`);
                return { outcome: 'CANCEL', data: resolutionData };
        }
        console.log(`Market ${market.id} resolved: ${outcome} (current: $${currentPriceData.price}, target/initial: $${marketData.targetPrice || marketData.initialPrice})`);
        return { outcome, data: resolutionData };
    }
    /**
     * Resolve a volume ranking market
     */
    async resolveRankingMarket(market) {
        const { marketData } = market;
        const symbol = marketData.symbol || market.tokenSymbol;
        const targetRank = marketData.targetRank;
        const chain = marketData.chain;
        const rankingResult = await this.getTokenRankingByVolume(symbol, chain);
        if (!rankingResult.success) {
            console.error(`Failed to get ranking for ${symbol}, cancelling market ${market.id}`);
            return {
                outcome: 'CANCEL',
                data: { error: rankingResult.error }
            };
        }
        const resolutionData = {
            currentRank: rankingResult.rank,
            targetRank,
            chain
        };
        // "Will token be in top X by volume?"
        const outcome = rankingResult.rank <= targetRank ? 'YES' : 'NO';
        console.log(`Market ${market.id} resolved: ${outcome} (current rank: ${rankingResult.rank}, target: ≤${targetRank})`);
        return { outcome, data: resolutionData };
    }
    /**
     * Resolve any market based on its type
     */
    async resolveMarket(marketId) {
        try {
            const market = await predictionMarkets.getMarket(marketId);
            if (!market) {
                return { success: false, error: "Market not found" };
            }
            if (market.status !== 'ACTIVE') {
                return { success: false, error: "Market is not active" };
            }
            let resolutionResult;
            switch (market.marketType) {
                case 'PRICE_UP_DOWN':
                case 'PRICE_ABOVE_BELOW':
                    resolutionResult = await this.resolvePriceMarket(market);
                    break;
                case 'VOLUME_RANKING':
                    resolutionResult = await this.resolveRankingMarket(market);
                    break;
                case 'SPORTS_WINNER':
                case 'SPORTS_OVER_UNDER':
                case 'SPORTS_SPREAD':
                    resolutionResult = await sportsResolver.resolveSportsMarket(market);
                    break;
                default:
                    console.error(`Unknown market type: ${market.marketType}`);
                    return { success: false, error: `Unsupported market type: ${market.marketType}` };
            }
            // Resolve the market using the prediction market service
            const resolveResult = await predictionMarkets.resolveMarket(marketId, resolutionResult.outcome);
            if (!resolveResult.success) {
                return { success: false, error: resolveResult.error };
            }
            return { success: true, outcome: resolutionResult.outcome };
        }
        catch (error) {
            console.error(`Error resolving market ${marketId}:`, error);
            return { success: false, error: `Resolution failed: ${error}` };
        }
    }
    /**
     * Resolve all active markets that have expired
     */
    async resolveExpiredMarkets() {
        let resolved = 0;
        let errors = 0;
        try {
            // Get all active markets that should be resolved
            const expiredMarkets = await predictionMarkets.getExpiredMarkets();
            console.log(`Found ${expiredMarkets.length} expired markets to resolve`);
            for (const market of expiredMarkets) {
                try {
                    const result = await this.resolveMarket(market.id);
                    if (result.success) {
                        resolved++;
                        console.log(`✅ Resolved market ${market.id} with outcome: ${result.outcome}`);
                    }
                    else {
                        errors++;
                        console.error(`❌ Failed to resolve market ${market.id}: ${result.error}`);
                    }
                    // Add delay between resolutions to avoid API rate limits
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                catch (error) {
                    errors++;
                    console.error(`❌ Error resolving market ${market.id}:`, error);
                }
            }
        }
        catch (error) {
            console.error('Error in resolveExpiredMarkets:', error);
        }
        console.log(`Market resolution complete: ${resolved} resolved, ${errors} errors`);
        return { resolved, errors };
    }
    /**
     * Check if a token is a major token available on CoinGecko
     */
    isMajorToken(symbol) {
        const majorTokens = ['BTC', 'ETH', 'USDC', 'USDT', 'BNB', 'SOL', 'ADA', 'AVAX', 'DOT', 'MATIC'];
        return majorTokens.includes(symbol.toUpperCase());
    }
    /**
     * Get CoinGecko token ID from symbol
     */
    getCoinGeckoId(symbol) {
        const tokenMap = {
            'BTC': 'bitcoin',
            'ETH': 'ethereum',
            'USDC': 'usd-coin',
            'USDT': 'tether',
            'BNB': 'binancecoin',
            'SOL': 'solana',
            'ADA': 'cardano',
            'AVAX': 'avalanche-2',
            'DOT': 'polkadot',
            'MATIC': 'matic-network'
        };
        return tokenMap[symbol.toUpperCase()] || null;
    }
}
// Export singleton instance
export const marketResolver = new MarketResolverService();
