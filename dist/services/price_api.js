// src/services/price_api.ts - Real-time crypto price fetching service
class PriceAPIService {
    cache = new Map();
    CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    /**
     * Get USD prices for multiple tokens
     */
    async getTokenPrices(symbols) {
        try {
            // First try DexScreener (best for Abstract Chain DEX tokens)
            const dexscreenerResult = await this.fetchFromDexScreener(symbols);
            if (dexscreenerResult.success) {
                return dexscreenerResult;
            }
            console.warn('DexScreener failed, trying CoinGecko...');
            // Fallback to CoinGecko (free tier, no API key required)
            const coingeckoResult = await this.fetchFromCoinGecko(symbols);
            if (coingeckoResult.success) {
                return coingeckoResult;
            }
            console.warn('CoinGecko failed, trying CoinMarketCap...');
            // Fallback to CoinMarketCap (requires API key)
            const cmcResult = await this.fetchFromCoinMarketCap(symbols);
            if (cmcResult.success) {
                return cmcResult;
            }
            console.warn('All APIs failed, using fallback prices...');
            // Final fallback to static estimates
            return this.getFallbackPrices(symbols);
        }
        catch (error) {
            console.error('Price API error:', error);
            return this.getFallbackPrices(symbols);
        }
    }
    /**
     * Fetch prices from DexScreener API (best for Abstract Chain tokens)
     */
    async fetchFromDexScreener(symbols) {
        try {
            // Get token addresses from our database/config
            const tokenAddresses = await this.getTokenAddresses(symbols);
            const prices = {};
            if (Object.keys(tokenAddresses).length === 0) {
                console.warn('No token addresses found for symbols:', symbols);
                throw new Error('No token addresses available');
            }
            // DexScreener supports up to 30 token addresses in one call
            const abstractChainId = 'abstract'; // Abstract Chain identifier
            const addresses = Object.values(tokenAddresses);
            // Split into chunks of 30 addresses if needed
            const chunks = [];
            for (let i = 0; i < addresses.length; i += 30) {
                chunks.push(addresses.slice(i, i + 30));
            }
            for (const chunk of chunks) {
                try {
                    const url = `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`;
                    const response = await fetch(url, {
                        headers: {
                            'Accept': 'application/json'
                        }
                    });
                    if (!response.ok) {
                        console.warn(`DexScreener API error: ${response.status}`);
                        continue;
                    }
                    const data = await response.json();
                    if (data.pairs && Array.isArray(data.pairs)) {
                        // Process pairs and extract prices
                        data.pairs.forEach((pair) => {
                            if (pair.baseToken && pair.priceUsd) {
                                const address = pair.baseToken.address?.toLowerCase();
                                const priceUsd = parseFloat(pair.priceUsd);
                                if (address && priceUsd > 0) {
                                    // Find symbol for this address
                                    const symbol = Object.keys(tokenAddresses).find(sym => tokenAddresses[sym].toLowerCase() === address);
                                    if (symbol) {
                                        prices[symbol] = priceUsd;
                                        this.updateCache(symbol, priceUsd);
                                        console.log(`✅ DexScreener price for ${symbol}: $${priceUsd}`);
                                    }
                                }
                            }
                        });
                    }
                    // Rate limiting - be nice to DexScreener
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                catch (error) {
                    console.warn(`Failed to fetch DexScreener prices:`, error);
                }
            }
            return {
                success: Object.keys(prices).length > 0,
                prices,
                source: 'dexscreener'
            };
        }
        catch (error) {
            console.error('DexScreener API error:', error);
            return {
                success: false,
                prices: {},
                error: error.message,
                source: 'dexscreener'
            };
        }
    }
    /**
     * Get token contract addresses from our database
     */
    async getTokenAddresses(symbols) {
        try {
            // Import here to avoid circular dependencies
            const { getActiveTokens } = await import('./token.js');
            const tokens = await getActiveTokens();
            const addressMap = {};
            tokens.forEach(token => {
                if (symbols.includes(token.symbol)) {
                    addressMap[token.symbol] = token.address;
                }
            });
            return addressMap;
        }
        catch (error) {
            console.error('Failed to get token addresses:', error);
            return {};
        }
    }
    /**
     * Fetch prices from CoinGecko API (free tier)
     */
    async fetchFromCoinGecko(symbols) {
        try {
            // Map Abstract Chain tokens to CoinGecko IDs
            const tokenMap = {
                'PGU': 'penguin-finance', // Example mapping - needs real CoinGecko IDs
                'ICE': 'ice-token', // These may not exist yet
                'PEB': 'pebble-token' // Abstract Chain tokens might not be listed
            };
            const mappedIds = symbols
                .map(symbol => tokenMap[symbol])
                .filter(Boolean);
            if (mappedIds.length === 0) {
                throw new Error('No CoinGecko mappings found for these tokens');
            }
            const url = `https://api.coingecko.com/api/v3/simple/price?ids=${mappedIds.join(',')}&vs_currencies=usd`;
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'PIPTip-Treasury-Monitor/1.0'
                }
            });
            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.status}`);
            }
            const data = await response.json();
            const prices = {};
            // Map back from CoinGecko IDs to symbols
            Object.entries(tokenMap).forEach(([symbol, geckoId]) => {
                if (data[geckoId]?.usd) {
                    prices[symbol] = data[geckoId].usd;
                    this.updateCache(symbol, data[geckoId].usd);
                }
            });
            return {
                success: Object.keys(prices).length > 0,
                prices,
                source: 'coingecko'
            };
        }
        catch (error) {
            console.error('CoinGecko API error:', error);
            return {
                success: false,
                prices: {},
                error: error.message,
                source: 'coingecko'
            };
        }
    }
    /**
     * Fetch prices from CoinMarketCap API (requires API key)
     */
    async fetchFromCoinMarketCap(symbols) {
        try {
            const apiKey = process.env.COINMARKETCAP_API_KEY;
            if (!apiKey) {
                throw new Error('CoinMarketCap API key not configured');
            }
            const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${symbols.join(',')}`;
            const response = await fetch(url, {
                headers: {
                    'X-CMC_PRO_API_KEY': apiKey,
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`CoinMarketCap API error: ${response.status}`);
            }
            const data = await response.json();
            const prices = {};
            if (data.status.error_code === 0 && data.data) {
                symbols.forEach(symbol => {
                    if (data.data[symbol]?.quote?.USD?.price) {
                        prices[symbol] = data.data[symbol].quote.USD.price;
                        this.updateCache(symbol, prices[symbol]);
                    }
                });
            }
            return {
                success: Object.keys(prices).length > 0,
                prices,
                source: 'coinmarketcap'
            };
        }
        catch (error) {
            console.error('CoinMarketCap API error:', error);
            return {
                success: false,
                prices: {},
                error: error.message,
                source: 'coinmarketcap'
            };
        }
    }
    /**
     * Get cached price or return undefined if expired
     */
    getCachedPrice(symbol) {
        const cached = this.cache.get(symbol);
        if (!cached)
            return undefined;
        const isExpired = (Date.now() - cached.timestamp) > this.CACHE_TTL;
        if (isExpired) {
            this.cache.delete(symbol);
            return undefined;
        }
        return cached.price;
    }
    /**
     * Update price cache
     */
    updateCache(symbol, price) {
        this.cache.set(symbol, {
            price,
            timestamp: Date.now()
        });
    }
    /**
     * Fallback prices for Abstract Chain tokens
     */
    getFallbackPrices(symbols) {
        const fallbackPrices = {
            'PGU': 0.001, // Penguin token estimate
            'ICE': 0.0005, // Ice token estimate
            'PEB': 0.0002 // Pebble token estimate
        };
        const prices = {};
        symbols.forEach(symbol => {
            const cachedPrice = this.getCachedPrice(symbol);
            if (cachedPrice !== undefined) {
                prices[symbol] = cachedPrice;
            }
            else if (fallbackPrices[symbol]) {
                prices[symbol] = fallbackPrices[symbol];
            }
            else {
                prices[symbol] = 0.001; // Default fallback
            }
        });
        return {
            success: true,
            prices,
            source: 'fallback'
        };
    }
    /**
     * Get price for a single token
     */
    async getTokenPrice(symbol) {
        const result = await this.getTokenPrices([symbol]);
        return result.prices[symbol] || 0.001;
    }
    /**
     * Check if we should use real API or fallback
     */
    async shouldUseLiveAPI() {
        // DexScreener doesn't require API key - always available
        const hasDexScreener = true;
        const hasCoingecko = true; // CoinGecko free tier doesn't need API key
        const hasCMC = !!process.env.COINMARKETCAP_API_KEY;
        return hasDexScreener || hasCoingecko || hasCMC;
    }
    /**
     * Get detailed price info including source and freshness
     */
    async getDetailedPrices(symbols) {
        const result = await this.getTokenPrices(symbols);
        const cached = [];
        const fresh = [];
        const unavailable = [];
        symbols.forEach(symbol => {
            if (result.prices[symbol]) {
                const cachedPrice = this.getCachedPrice(symbol);
                if (cachedPrice !== undefined) {
                    cached.push(symbol);
                }
                else {
                    fresh.push(symbol);
                }
            }
            else {
                unavailable.push(symbol);
            }
        });
        return {
            prices: result.prices,
            source: result.source,
            cached,
            fresh,
            unavailable
        };
    }
}
export const priceAPI = new PriceAPIService();
