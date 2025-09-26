// src/services/price_api.ts - Real-time crypto price fetching service

interface TokenPrice {
  symbol: string;
  address: string;
  priceUSD: number;
  lastUpdated: Date;
}

interface PriceAPIResponse {
  success: boolean;
  prices: Record<string, number>; // symbol -> USD price
  change24h?: Record<string, number>; // symbol -> 24h change %
  error?: string;
  source: 'dexscreener' | 'coingecko' | 'coinmarketcap' | 'fallback';
}

class PriceAPIService {
  private cache = new Map<string, { price: number; change24h?: number; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private lastAPICall = new Map<string, number>(); // Track API call times
  private readonly MIN_CALL_INTERVAL = 1000; // 1 second between calls per API
  private apiCallCount = new Map<string, number>(); // Track call counts per hour
  private globalRateLimit = new Map<string, number>(); // Global deduplication
  private readonly GLOBAL_RATE_LIMIT = 3000; // 3 seconds between identical requests

  /**
   * Check if we can make an API call (rate limiting)
   */
  private canMakeAPICall(apiName: string): boolean {
    const now = Date.now();
    const lastCall = this.lastAPICall.get(apiName) || 0;

    if (now - lastCall < this.MIN_CALL_INTERVAL) {
      console.warn(`🚫 Rate limit: ${apiName} called too recently, using cache`);
      return false;
    }

    return true;
  }

  /**
   * Record API call for rate limiting
   */
  private recordAPICall(apiName: string): void {
    const now = Date.now();
    this.lastAPICall.set(apiName, now);

    const hourKey = Math.floor(now / (60 * 60 * 1000));
    const callKey = `${apiName}-${hourKey}`;
    this.apiCallCount.set(callKey, (this.apiCallCount.get(callKey) || 0) + 1);
  }

  /**
   * Get USD prices for multiple tokens with enhanced caching and rate limiting
   */
  async getTokenPrices(symbols: string[]): Promise<PriceAPIResponse> {
    try {
      // Log call source for debugging multiple calls
      const stack = new Error().stack;
      const caller = stack?.split('\n')[2]?.trim() || 'Unknown';
      console.log(`🔍 Price API called for ${symbols.join(',')} from: ${caller}`);

      // Global rate limiting - prevent rapid successive calls
      const now = Date.now();
      const cacheKey = symbols.sort().join(','); // Create consistent key

      // ULTRA-AGGRESSIVE: Check if we've fetched these symbols very recently (within 5 seconds)
      const globalKey = symbols.sort().join(',');
      const lastGlobalCall = this.globalRateLimit.get(globalKey) || 0;

      if (now - lastGlobalCall < this.GLOBAL_RATE_LIMIT) { // 3 second HARD limit
        console.log(`🚫 GLOBAL Price API rate limited (${symbols.join(',')}) - ${now - lastGlobalCall}ms ago`);
        // Return cached prices immediately - no API call
        const prices: Record<string, number> = {};
        symbols.forEach(symbol => {
          const cached = this.cache.get(symbol);
          if (cached) {
            prices[symbol] = cached.price;
          } else {
            // Use fallback price if no cache
            const fallbackPrices: Record<string, number> = {
              'PGU': 0.001, 'ICE': 0.0005, 'PEB': 0.0002, 'ABSTER': 0.019
            };
            prices[symbol] = fallbackPrices[symbol] || 0.001;
          }
        });
        return { success: true, prices, source: 'fallback' };
      }

      // Record this global call to prevent immediate duplicates
      this.globalRateLimit.set(globalKey, now);

      // Check individual symbol cache (legacy check)
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey)!;
        if (now - cached.timestamp < 1000) { // 1 second legacy rate limit
          console.log(`🚫 Price API rate limited (${symbols.join(',')}) - using recent cache`);
          // Return cached prices in the correct format
          const prices: Record<string, number> = {};
          symbols.forEach(symbol => {
            if (this.cache.has(symbol)) {
              prices[symbol] = this.cache.get(symbol)!.price;
            }
          });
          return { success: true, prices, source: 'fallback' };
        }
      }

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

    } catch (error) {
      console.error('Price API error:', error);
      return this.getFallbackPrices(symbols);
    }
  }

  /**
   * Fetch prices from DexScreener API (best for Abstract Chain tokens)
   */
  private async fetchFromDexScreener(symbols: string[]): Promise<PriceAPIResponse> {
    try {
      // Get token addresses from our database/config
      const tokenAddresses = await this.getTokenAddresses(symbols);
      const prices: Record<string, number> = {};
      const change24h: Record<string, number> = {};

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
            // Process pairs and extract prices + 24h change
            data.pairs.forEach((pair: any) => {
              if (pair.baseToken && pair.priceUsd) {
                const address = pair.baseToken.address?.toLowerCase();
                const priceUsd = parseFloat(pair.priceUsd);
                const priceChange24h = parseFloat(pair.priceChange?.h24 || '0');

                if (address && priceUsd > 0) {
                  // Find symbol for this address
                  const symbol = Object.keys(tokenAddresses).find(
                    sym => tokenAddresses[sym].toLowerCase() === address
                  );

                  if (symbol) {
                    prices[symbol] = priceUsd;
                    change24h[symbol] = priceChange24h;
                    this.updateCache(symbol, priceUsd, priceChange24h);
                    console.log(`✅ DexScreener price for ${symbol}: $${priceUsd} (24h: ${priceChange24h}%)`);
                  }
                }
              }
            });
          }

          // Rate limiting - be nice to DexScreener
          await new Promise(resolve => setTimeout(resolve, 200));

        } catch (error) {
          console.warn(`Failed to fetch DexScreener prices:`, error);
        }
      }

      return {
        success: Object.keys(prices).length > 0,
        prices,
        change24h,
        source: 'dexscreener' as const
      };

    } catch (error) {
      console.error('DexScreener API error:', error);
      return {
        success: false,
        prices: {},
        error: (error as Error).message,
        source: 'dexscreener' as const
      };
    }
  }

  /**
   * Get token contract addresses from our database
   */
  private async getTokenAddresses(symbols: string[]): Promise<Record<string, string>> {
    try {
      // Import here to avoid circular dependencies
      const { getActiveTokens } = await import('./token.js');
      const tokens = await getActiveTokens();

      const addressMap: Record<string, string> = {};
      tokens.forEach(token => {
        if (symbols.includes(token.symbol)) {
          addressMap[token.symbol] = token.address;
        }
      });

      return addressMap;
    } catch (error) {
      console.error('Failed to get token addresses:', error);
      return {};
    }
  }

  /**
   * Fetch prices from CoinGecko API (free tier)
   */
  private async fetchFromCoinGecko(symbols: string[]): Promise<PriceAPIResponse> {
    try {
      // Map Abstract Chain tokens to CoinGecko IDs
      const tokenMap: Record<string, string> = {
        'PGU': 'penguin-finance', // Example mapping - needs real CoinGecko IDs
        'ICE': 'ice-token',       // These may not exist yet
        'PEB': 'pebble-token'     // Abstract Chain tokens might not be listed
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
      const prices: Record<string, number> = {};

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

    } catch (error) {
      console.error('CoinGecko API error:', error);
      return {
        success: false,
        prices: {},
        error: (error as Error).message,
        source: 'coingecko'
      };
    }
  }

  /**
   * Fetch prices from CoinMarketCap API (requires API key)
   */
  private async fetchFromCoinMarketCap(symbols: string[]): Promise<PriceAPIResponse> {
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
      const prices: Record<string, number> = {};

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

    } catch (error) {
      console.error('CoinMarketCap API error:', error);
      return {
        success: false,
        prices: {},
        error: (error as Error).message,
        source: 'coinmarketcap'
      };
    }
  }

  /**
   * Get cached price or return undefined if expired
   */
  private getCachedPrice(symbol: string): number | undefined {
    const cached = this.cache.get(symbol);
    if (!cached) return undefined;

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
  private updateCache(symbol: string, price: number, change24h?: number): void {
    this.cache.set(symbol, {
      price,
      change24h,
      timestamp: Date.now()
    });
  }

  /**
   * Fallback prices for Abstract Chain tokens
   */
  private getFallbackPrices(symbols: string[]): PriceAPIResponse {
    const fallbackPrices: Record<string, number> = {
      'PGU': 0.001,  // Penguin token estimate
      'ICE': 0.0005, // Ice token estimate
      'PEB': 0.0002  // Pebble token estimate
    };

    const prices: Record<string, number> = {};
    symbols.forEach(symbol => {
      const cachedPrice = this.getCachedPrice(symbol);
      if (cachedPrice !== undefined) {
        prices[symbol] = cachedPrice;
      } else if (fallbackPrices[symbol]) {
        prices[symbol] = fallbackPrices[symbol];
      } else {
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
  async getTokenPrice(symbol: string): Promise<number> {
    const result = await this.getTokenPrices([symbol]);
    return result.prices[symbol] || 0.001;
  }

  /**
   * Check if we should use real API or fallback
   */
  async shouldUseLiveAPI(): Promise<boolean> {
    // DexScreener doesn't require API key - always available
    const hasDexScreener = true;
    const hasCoingecko = true; // CoinGecko free tier doesn't need API key
    const hasCMC = !!process.env.COINMARKETCAP_API_KEY;

    return hasDexScreener || hasCoingecko || hasCMC;
  }

  /**
   * Get detailed price info including source and freshness
   */
  async getDetailedPrices(symbols: string[]): Promise<{
    prices: Record<string, number>;
    source: string;
    cached: string[];
    fresh: string[];
    unavailable: string[];
  }> {
    const result = await this.getTokenPrices(symbols);

    const cached: string[] = [];
    const fresh: string[] = [];
    const unavailable: string[] = [];

    symbols.forEach(symbol => {
      if (result.prices[symbol]) {
        const cachedPrice = this.getCachedPrice(symbol);
        if (cachedPrice !== undefined) {
          cached.push(symbol);
        } else {
          fresh.push(symbol);
        }
      } else {
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
export type { TokenPrice, PriceAPIResponse };