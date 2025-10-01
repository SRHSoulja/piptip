import { predictionMarkets } from "./prediction_markets.js";
import { sportsResolver } from "./sports_resolver.js";
class MarketResolverService {
  /**
   * Enhanced token verification with Abstract chain priority
   */
  getVerifiedTokenConfig(symbol) {
    const verifiedTokens = {
      // Abstract ecosystem tokens get highest priority
      "ABSTER": {
        minLiquidity: 1e4,
        minVolume: 5e3,
        preferredChain: "abstract",
        expectedPriceRange: [1e-3, 0.1]
      },
      // Major tokens with Abstract support when available
      "PENGU": {
        minLiquidity: 1e6,
        minVolume: 1e5,
        expectedPriceRange: [0.02, 0.05],
        preferredChain: "abstract",
        // Abstract chain has PENGU now
        coinGeckoId: "pudgy-penguins",
        contracts: {
          "abstract": "0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62",
          "solana": "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",
          "ethereum": "0x16cb3449e99D2d40414Fd3D1a4da3b3f75C8e9c6"
          // TBD - placeholder
        }
      },
      "PEPE": {
        minLiquidity: 5e6,
        minVolume: 1e6,
        expectedPriceRange: [1e-6, 1e-5],
        preferredChain: "ethereum"
      },
      "SHIB": {
        minLiquidity: 1e7,
        minVolume: 5e6,
        expectedPriceRange: [1e-6, 5e-5],
        preferredChain: "ethereum"
      },
      "BTC": {
        minLiquidity: 5e7,
        minVolume: 1e7,
        expectedPriceRange: [3e4, 1e5],
        preferredChain: "ethereum"
      },
      "ETH": {
        minLiquidity: 2e7,
        minVolume: 5e6,
        expectedPriceRange: [1500, 5e3],
        preferredChain: "ethereum"
      }
    };
    return verifiedTokens[symbol.toUpperCase()];
  }
  /**
   * Check if input is a contract address
   */
  isContractAddress(input) {
    return input.startsWith("0x") && input.length === 42;
  }
  /**
   * Get contract address for a verified token on a specific chain
   */
  getTokenContract(symbol, chain) {
    const verifiedConfig = this.getVerifiedTokenConfig(symbol);
    if (!verifiedConfig?.contracts) return null;
    const targetChain = chain || verifiedConfig.preferredChain || "abstract";
    return verifiedConfig.contracts[targetChain] || null;
  }
  /**
   * Try to fetch token using known contract address for guaranteed accuracy
   */
  async tryFetchByKnownContract(symbol, preferredChain) {
    const contractAddress = this.getTokenContract(symbol, preferredChain);
    if (!contractAddress) return null;
    console.log(`\u{1F3AF} Using known contract for ${symbol} on ${preferredChain || "default"}: ${contractAddress}`);
    try {
      return await this.fetchTokenByAddress(contractAddress);
    } catch (error) {
      console.log(`\u26A0\uFE0F Known contract fetch failed for ${symbol}:`, error);
      return null;
    }
  }
  /**
   * Fetch token data by contract address (guaranteed accuracy)
   */
  async fetchTokenByAddress(address) {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
      console.log(`\u{1F3AF} Fetching token by exact address: ${address}...`);
      const response = await fetch(url);
      if (!response.ok) {
        return {
          symbol: address,
          price: 0,
          success: false,
          error: `DexScreener API error: ${response.status}`
        };
      }
      const data = await response.json();
      if (!data.pairs || data.pairs.length === 0) {
        return {
          symbol: address,
          price: 0,
          success: false,
          error: `No trading pairs found for contract address ${address}`
        };
      }
      const bestPair = data.pairs.sort((a, b) => {
        const aVolume = parseFloat(a.volume?.h24 || "0");
        const bVolume = parseFloat(b.volume?.h24 || "0");
        return bVolume - aVolume;
      })[0];
      const price = parseFloat(bestPair.priceUsd || "0");
      const volume24h = parseFloat(bestPair.volume?.h24 || "0");
      const priceChange24h = parseFloat(bestPair.priceChange?.h24 || "0");
      const symbol = bestPair.baseToken?.symbol || "UNKNOWN";
      console.log(`\u2705 Contract ${address}: ${symbol} = $${price} (24h vol: $${volume24h.toLocaleString()})`);
      return {
        symbol,
        address,
        price,
        volume24h,
        priceChange24h,
        chain: bestPair.chainId,
        success: true
      };
    } catch (error) {
      console.error("Error fetching token by address:", error);
      return {
        symbol: address,
        price: 0,
        success: false,
        error: error.message
      };
    }
  }
  /**
   * Fetch token price with Abstract chain priority and enhanced filtering
   */
  async fetchDexScreenerPrice(symbolOrAddress, preferredChain) {
    try {
      if (this.isContractAddress(symbolOrAddress)) {
        console.log(`\u{1F4CD} Detected contract address: ${symbolOrAddress}`);
        return await this.fetchTokenByAddress(symbolOrAddress);
      }
      const symbol = symbolOrAddress.toUpperCase();
      const verifiedConfig = this.getVerifiedTokenConfig(symbol);
      if (verifiedConfig?.contracts) {
        const contractResult = await this.tryFetchByKnownContract(symbol, preferredChain);
        if (contractResult && contractResult.success) {
          console.log(`\u2705 Successfully fetched ${symbol} via known contract (fast path)`);
          return contractResult;
        }
      }
      const chainToSearch = preferredChain || verifiedConfig?.preferredChain || "all";
      console.log(`\u{1F50D} Searching for ${symbol} on chain: ${chainToSearch} (Abstract priority: ${chainToSearch === "abstract"})`);
      let url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`;
      if (chainToSearch !== "all") {
      }
      console.log(`\u{1F4E1} API URL: ${url}`);
      console.log(`\u{1F4E1} Fetching DexScreener data for ${symbol}...`);
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "PIPTip-Market-Bot/1.0"
        }
      });
      console.log(`\u{1F4CA} Response status: ${response.status}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`\u274C DexScreener API error: ${response.status} - ${errorText}`);
        return {
          symbol,
          price: 0,
          success: false,
          error: `DexScreener API error: ${response.status} - ${errorText.slice(0, 100)}`
        };
      }
      const data = await response.json();
      console.log(`\u{1F4CA} Raw API response:`, JSON.stringify(data).slice(0, 200) + "...");
      if (!data.pairs || data.pairs.length === 0) {
        console.log(`\u274C No pairs found in response for ${symbol}`);
        const contractResult = await this.tryFetchByKnownContract(symbol, preferredChain);
        if (contractResult && contractResult.success) {
          console.log(`\u2705 Found ${symbol} via known contract address`);
          return contractResult;
        }
        if (verifiedConfig?.coinGeckoId) {
          console.log(`\u{1F504} Trying CoinGecko fallback for ${symbol}...`);
          return await this.fetchCoinGeckoPrice(verifiedConfig.coinGeckoId);
        }
        return {
          symbol,
          price: 0,
          success: false,
          error: `No trading pairs found for ${symbol}`
        };
      }
      console.log(`\u{1F4CA} Found ${data.pairs.length} total pairs for ${symbol}`);
      let chainFilteredPairs = data.pairs;
      if (chainToSearch !== "all") {
        chainFilteredPairs = data.pairs.filter((pair) => pair.chainId === chainToSearch);
        console.log(`\u26D3\uFE0F  Filtered to ${chainFilteredPairs.length} pairs on ${chainToSearch}`);
        if (chainFilteredPairs.length === 0 && chainToSearch !== "abstract") {
          const abstractPairs = data.pairs.filter((pair) => pair.chainId === "abstract");
          if (abstractPairs.length > 0) {
            console.log(`\u2B50 No pairs on ${chainToSearch}, using ${abstractPairs.length} Abstract pairs`);
            chainFilteredPairs = abstractPairs;
          }
        }
        if (chainFilteredPairs.length === 0) {
          console.log(`\u26A0\uFE0F No pairs found on ${chainToSearch}, using all chains`);
          chainFilteredPairs = data.pairs;
        }
      }
      const minVolume = verifiedConfig?.minVolume || 1e3;
      const minLiquidity = verifiedConfig?.minLiquidity || 5e3;
      let filteredPairs = chainFilteredPairs.filter((pair) => {
        const volume24h2 = parseFloat(pair.volume?.h24 || "0");
        const liquidity2 = parseFloat(pair.liquidity?.usd || "0");
        return volume24h2 >= minVolume && liquidity2 >= minLiquidity;
      });
      console.log(`\u2705 ${filteredPairs.length} pairs meet quality thresholds (vol>${minVolume}, liq>${minLiquidity})`);
      if (filteredPairs.length === 0) {
        console.log(`\u26A0\uFE0F No pairs meet strict criteria, using relaxed thresholds`);
        filteredPairs = chainFilteredPairs.filter((pair) => {
          const volume24h2 = parseFloat(pair.volume?.h24 || "0");
          return volume24h2 > 100;
        });
      }
      if (verifiedConfig || symbol === "PENGU") {
        console.log(`\u{1F3AF} Applying enhanced filtering for verified token: ${symbol}`);
        filteredPairs.slice(0, 5).forEach((pair, index) => {
          const liquidity2 = parseFloat(pair.liquidity?.usd || "0");
          const volume = parseFloat(pair.volume?.h24 || "0");
          const price2 = parseFloat(pair.priceUsd || "0");
          console.log(`  ${index + 1}. ${symbol} $${price2} | Liq: $${liquidity2.toLocaleString()} | Vol: $${volume.toLocaleString()} | Chain: ${pair.chainId}`);
        });
        filteredPairs.sort((a, b) => {
          const aLiquidity = parseFloat(a.liquidity?.usd || "0");
          const bLiquidity = parseFloat(b.liquidity?.usd || "0");
          const aVolume = parseFloat(a.volume?.h24 || "0");
          const bVolume = parseFloat(b.volume?.h24 || "0");
          const aScore = aLiquidity * 3 + aVolume;
          const bScore = bLiquidity * 3 + bVolume;
          return bScore - aScore;
        });
      } else {
        filteredPairs.sort((a, b) => {
          const aVolume = parseFloat(a.volume?.h24 || "0");
          const bVolume = parseFloat(b.volume?.h24 || "0");
          return bVolume - aVolume;
        });
      }
      const bestPair = filteredPairs[0];
      if (!bestPair) {
        return {
          symbol,
          price: 0,
          success: false,
          error: `No suitable trading pairs found for ${symbol} after filtering`
        };
      }
      const price = parseFloat(bestPair.priceUsd || "0");
      const volume24h = parseFloat(bestPair.volume?.h24 || "0");
      const priceChange24h = parseFloat(bestPair.priceChange?.h24 || "0");
      const liquidity = parseFloat(bestPair.liquidity?.usd || "0");
      let priceWarning = "";
      if (verifiedConfig && verifiedConfig.expectedPriceRange) {
        const [minPrice, maxPrice] = verifiedConfig.expectedPriceRange;
        if (price < minPrice || price > maxPrice) {
          priceWarning = `\u26A0\uFE0F Price $${price} outside expected range $${minPrice}-$${maxPrice}`;
          console.log(priceWarning);
        }
      }
      const selectedChain = bestPair.chainId;
      console.log(`\u2705 Selected ${symbol}: $${price} | Chain: ${selectedChain} ${selectedChain === "abstract" ? "\u2B50" : ""} | Vol: $${volume24h.toLocaleString()} | Liq: $${liquidity.toLocaleString()}`);
      return {
        symbol,
        price,
        volume24h,
        priceChange24h,
        liquidity,
        chain: selectedChain,
        address: bestPair.baseToken?.address,
        success: true,
        warning: priceWarning || void 0,
        isAbstractChain: selectedChain === "abstract",
        isVerifiedToken: !!verifiedConfig
      };
    } catch (error) {
      console.error(`\u274C DexScreener API error for ${symbolOrAddress}:`, error);
      const verifiedConfig = this.getVerifiedTokenConfig(symbolOrAddress.toUpperCase());
      if (verifiedConfig?.coinGeckoId) {
        console.log(`\u{1F504} Trying CoinGecko fallback due to error for ${symbolOrAddress}...`);
        try {
          return await this.fetchCoinGeckoPrice(verifiedConfig.coinGeckoId);
        } catch (fallbackError) {
          console.error(`\u274C CoinGecko fallback also failed:`, fallbackError);
        }
      }
      return {
        symbol: symbolOrAddress.toUpperCase(),
        price: 0,
        success: false,
        error: `API request failed: ${error instanceof Error ? error.message : String(error)}. Try using contract address or different chain.`,
        suggestion: "Try using the contract address instead of symbol, or select a specific chain."
      };
    }
  }
  /**
   * Fetch major token price from CoinGecko API
   */
  async fetchCoinGeckoPrice(tokenId) {
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`;
      console.log(`\u{1F98E} CoinGecko URL: ${url}`);
      console.log(`\u{1F98E} Fetching CoinGecko data for ${tokenId}...`);
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "PIPTip-Market-Bot/1.0"
        }
      });
      console.log(`\u{1F98E} CoinGecko response status: ${response.status}`);
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
    } catch (error) {
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
      const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`;
      const response = await fetch(url);
      if (!response.ok) {
        return { rank: 0, success: false, error: `API error: ${response.status}` };
      }
      const data = await response.json();
      if (!data.pairs || data.pairs.length === 0) {
        return { rank: 0, success: false, error: `No pairs found for ${symbol}` };
      }
      let pairs = data.pairs;
      if (chain) {
        pairs = pairs.filter((p) => p.chainId?.toLowerCase() === chain.toLowerCase());
      }
      if (pairs.length === 0) {
        return { rank: 0, success: false, error: `No pairs found for ${symbol} on ${chain}` };
      }
      const volume = parseFloat(pairs[0].volume?.h24 || "0");
      let rank = 100;
      if (volume > 1e7) rank = 1;
      else if (volume > 5e6) rank = 2;
      else if (volume > 1e6) rank = 3;
      else if (volume > 5e5) rank = 5;
      else if (volume > 1e5) rank = 10;
      else if (volume > 5e4) rank = 20;
      console.log(`Volume ranking for ${symbol}: rank ${rank} (volume: $${volume})`);
      return { rank, success: true };
    } catch (error) {
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
        outcome: "CANCEL",
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
      case "PRICE_UP_DOWN":
        outcome = currentPriceData.price > marketData.initialPrice ? "YES" : "NO";
        break;
      case "PRICE_ABOVE_BELOW":
        outcome = currentPriceData.price > marketData.targetPrice ? "YES" : "NO";
        break;
      default:
        console.error(`Unknown market type: ${market.marketType}`);
        return { outcome: "CANCEL", data: resolutionData };
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
        outcome: "CANCEL",
        data: { error: rankingResult.error }
      };
    }
    const resolutionData = {
      currentRank: rankingResult.rank,
      targetRank,
      chain
    };
    const outcome = rankingResult.rank <= targetRank ? "YES" : "NO";
    console.log(`Market ${market.id} resolved: ${outcome} (current rank: ${rankingResult.rank}, target: \u2264${targetRank})`);
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
      if (market.status !== "ACTIVE") {
        return { success: false, error: "Market is not active" };
      }
      const marketData = market.marketData;
      const resolutionMethod = marketData?.resolutionMethod || "API_AUTO";
      if (resolutionMethod === "MANUAL_ADMIN") {
        console.log(`MANUAL ADMIN MARKET: Market ${market.id} requires manual resolution by admin`);
        return {
          success: false,
          error: "MANUAL_ADMIN: Market requires manual resolution by admin. Use admin dashboard to resolve."
        };
      }
      if (!this.isAPIGuaranteedMarket(market)) {
        console.error(`SECURITY: Attempted to resolve non-API market ${market.id} - ${market.title}`);
        return {
          success: false,
          error: "REJECTED: Market is not API-guaranteed and cannot be resolved automatically"
        };
      }
      let resolutionResult;
      switch (market.marketType) {
        case "PRICE_UP_DOWN":
        case "PRICE_ABOVE_BELOW":
        case "CRYPTO_PRICE_TARGET":
        case "CRYPTO_PRICE_DIRECTION":
          resolutionResult = await this.resolveTemplateBasedPriceMarket(market);
          break;
        case "CRYPTO_DAILY_CHANGE":
          resolutionResult = await this.resolveDailyChangeMarket(market);
          break;
        case "CRYPTO_PRICE_RANGE":
          resolutionResult = await this.resolvePriceRangeMarket(market);
          break;
        case "VOLUME_RANKING":
        case "CRYPTO_RANK_TARGET":
        case "CRYPTO_VOLUME":
          resolutionResult = await this.resolveRankingMarket(market);
          break;
        case "SPORTS_WINNER":
        case "SPORTS_OVER_UNDER":
        case "SPORTS_SPREAD":
        case "SPORTS_TOTAL":
          resolutionResult = await sportsResolver.resolveSportsMarket(market);
          break;
        default:
          console.error(`Unknown market type: ${market.marketType}`);
          return { success: false, error: `Unsupported market type: ${market.marketType}` };
      }
      const resolveResult = await predictionMarkets.resolveMarket(marketId, resolutionResult.outcome);
      if (!resolveResult.success) {
        return { success: false, error: resolveResult.error };
      }
      return { success: true, outcome: resolutionResult.outcome };
    } catch (error) {
      console.error(`Error resolving market ${marketId}:`, error);
      if (this.isAPIDowntimeError(error)) {
        console.warn(`\u26A0\uFE0F  API DOWNTIME DETECTED for market ${marketId} - flagging for manual resolution`);
        await this.flagForManualResolution(marketId, String(error));
        return { success: false, error: `API downtime - market flagged for manual resolution: ${error}` };
      }
      return { success: false, error: `Resolution failed: ${error}` };
    }
  }
  /**
   * Resolve template-based price direction market
   */
  async resolveTemplateBasedPriceMarket(market) {
    const marketData = market.marketData;
    const targetTokenSymbol = marketData.targetTokenSymbol || marketData.tokenSymbol || market.tokenSymbol;
    if (!targetTokenSymbol) {
      return {
        outcome: "CANCEL",
        data: { error: "No token symbol specified for price market" }
      };
    }
    const { priceAPI } = await import("./price_api.js");
    const tokenData = await priceAPI.getTokenPrices([targetTokenSymbol]);
    if (!tokenData.success || !tokenData.prices[targetTokenSymbol]) {
      console.error(`Failed to fetch price for ${targetTokenSymbol}, cancelling market ${market.id}`);
      return {
        outcome: "CANCEL",
        data: { error: `Could not fetch current price for ${targetTokenSymbol}` }
      };
    }
    const currentPrice = tokenData.prices[targetTokenSymbol];
    let outcome;
    if (market.marketType === "CRYPTO_PRICE_DIRECTION") {
      const { targetPrice, direction } = marketData;
      if (direction === "up") {
        outcome = currentPrice >= targetPrice ? "YES" : "NO";
      } else {
        outcome = currentPrice < targetPrice ? "YES" : "NO";
      }
    } else {
      const targetPrice = marketData.targetPrice || marketData.initialPrice;
      outcome = currentPrice > targetPrice ? "YES" : "NO";
    }
    console.log(`Template price market ${market.id} resolved: ${outcome} (current: $${currentPrice}, target: $${marketData.targetPrice})`);
    return {
      outcome,
      data: {
        currentPrice,
        targetPrice: marketData.targetPrice,
        initialPrice: marketData.currentPrice
      }
    };
  }
  /**
   * Resolve daily change percentage market
   */
  async resolveDailyChangeMarket(market) {
    const marketData = market.marketData;
    const targetTokenSymbol = marketData.targetTokenSymbol || marketData.tokenSymbol;
    const changeThreshold = marketData.changeThreshold;
    if (!targetTokenSymbol || !changeThreshold) {
      return {
        outcome: "CANCEL",
        data: { error: "Missing token symbol or change threshold" }
      };
    }
    const { priceAPI } = await import("./price_api.js");
    const tokenData = await priceAPI.getTokenPrices([targetTokenSymbol]);
    if (!tokenData.success || !tokenData.prices[targetTokenSymbol]) {
      console.error(`Failed to fetch 24h change for ${targetTokenSymbol}, cancelling market ${market.id}`);
      return {
        outcome: "CANCEL",
        data: { error: `Could not fetch 24h change data for ${targetTokenSymbol}` }
      };
    }
    const change24h = tokenData.change24h?.[targetTokenSymbol] || 0;
    const outcome = Math.abs(change24h) >= changeThreshold ? "YES" : "NO";
    console.log(`Daily change market ${market.id} resolved: ${outcome} (24h change: ${change24h}%, threshold: ${changeThreshold}%)`);
    return {
      outcome,
      data: {
        currentPrice: tokenData.prices[targetTokenSymbol],
        priceChange24h: change24h
      }
    };
  }
  /**
   * Resolve price range market (token within min/max range)
   */
  async resolvePriceRangeMarket(market) {
    const marketData = market.marketData;
    const { tokenSymbol, minPrice, maxPrice } = marketData;
    const priceData = this.isMajorToken(tokenSymbol) ? await this.fetchCoinGeckoPrice(this.getCoinGeckoId(tokenSymbol)) : await this.fetchDexScreenerPrice(tokenSymbol);
    if (!priceData.success || priceData.price === 0) {
      console.error(`Failed to fetch price for ${tokenSymbol}`);
      return {
        outcome: "CANCEL",
        data: { error: `Could not fetch price data for ${tokenSymbol}` }
      };
    }
    const currentPrice = priceData.price;
    const outcome = currentPrice >= minPrice && currentPrice <= maxPrice ? "YES" : "NO";
    return {
      outcome,
      data: {
        currentPrice,
        targetPrice: (minPrice + maxPrice) / 2,
        // midpoint for reference
        chain: priceData.chain
      }
    };
  }
  /**
   * Check for postponed or cancelled sports games and handle market cancellations
   */
  async checkSportsGameStatus() {
    let checked = 0;
    let cancelled = 0;
    let updated = 0;
    try {
      const sportsMarkets = await predictionMarkets.getActiveMarkets("").then(
        (markets) => markets.filter((m) => m.marketType.startsWith("SPORTS_") && m.marketData?.eventId)
      );
      console.log(`\u{1F3C8} Checking ${sportsMarkets.length} sports markets for game status changes`);
      for (const market of sportsMarkets) {
        try {
          checked++;
          const marketData = market.marketData;
          const eventId = marketData.eventId || marketData.gameId;
          if (!eventId) continue;
          const response = await fetch(`https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id=${eventId}`);
          if (!response.ok) {
            console.warn(`Failed to check game status for market ${market.id}: API error ${response.status}`);
            continue;
          }
          const data = await response.json();
          if (!data.events || data.events.length === 0) {
            console.warn(`Game ${eventId} not found for market ${market.id}`);
            continue;
          }
          const game = data.events[0];
          const isPostponed = game.strPostponed === "yes";
          const isCancelled = game.strStatus === "Match Cancelled" || game.strStatus === "Cancelled";
          const originalGameTime = marketData.gameStartTime ? new Date(marketData.gameStartTime) : null;
          const currentGameTime = game.strTimestamp ? new Date(game.strTimestamp) : null;
          if (isPostponed || isCancelled) {
            console.log(`\u{1F6A8} Game ${eventId} is ${isPostponed ? "postponed" : "cancelled"} - cancelling market ${market.id}`);
            await this.cancelSportsMarket(market.id, `Game ${isPostponed ? "postponed" : "cancelled"}`, {
              originalGameTime: originalGameTime?.toISOString(),
              gameStatus: game.strStatus,
              reason: isPostponed ? "GAME_POSTPONED" : "GAME_CANCELLED"
            });
            cancelled++;
          } else if (originalGameTime && currentGameTime && Math.abs(currentGameTime.getTime() - originalGameTime.getTime()) > 15 * 60 * 1e3) {
            console.log(`\u23F0 Game ${eventId} time changed from ${originalGameTime.toISOString()} to ${currentGameTime.toISOString()}`);
            await this.updateSportsMarketTiming(market.id, currentGameTime, {
              originalGameTime: originalGameTime.toISOString(),
              newGameTime: currentGameTime.toISOString(),
              reason: "GAME_TIME_CHANGED"
            });
            updated++;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`Error checking game status for market ${market.id}:`, error);
        }
      }
    } catch (error) {
      console.error("Error in checkSportsGameStatus:", error);
    }
    console.log(`\u{1F3C8} Sports game status check complete: ${checked} checked, ${cancelled} cancelled, ${updated} updated`);
    return { checked, cancelled, updated };
  }
  /**
   * Cancel a sports market due to game postponement/cancellation with auto-refunds
   */
  async cancelSportsMarket(marketId, reason, metadata) {
    try {
      const { prisma } = await import("./db.js");
      const participations = await prisma.predictionParticipation.findMany({
        where: { marketId }
        // User relation doesn't exist in PredictionParticipation schema
      });
      await prisma.$transaction(async (tx) => {
        await tx.predictionMarket.update({
          where: { id: marketId },
          data: {
            status: "CANCELLED",
            outcome: null,
            marketData: {
              ...metadata,
              cancelledAt: (/* @__PURE__ */ new Date()).toISOString(),
              cancelReason: reason,
              refundsProcessed: participations.length
            }
          }
        });
        for (const participation of participations) {
          const user = await tx.user.findUnique({ where: { discordId: participation.userId } });
          if (user) {
            await tx.userBalance.updateMany({
              where: {
                userId: user.id,
                Token: { symbol: participation.tokenSymbol }
              },
              data: {
                amount: { increment: participation.amount }
              }
            });
          }
        }
      });
      console.log(`\u2705 Sports market ${marketId} cancelled and ${participations.length} participations refunded due to: ${reason}`);
    } catch (error) {
      console.error(`Failed to cancel sports market ${marketId}:`, error);
    }
  }
  /**
   * Update sports market timing when game time changes
   */
  async updateSportsMarketTiming(marketId, newGameTime, metadata) {
    try {
      const { prisma } = await import("./db.js");
      const newBettingCutoff = newGameTime;
      const newResolutionTime = new Date(newGameTime.getTime() + 3 * 60 * 60 * 1e3);
      await prisma.predictionMarket.update({
        where: { id: marketId },
        data: {
          resolveAt: newResolutionTime,
          marketData: {
            ...metadata,
            gameStartTime: newGameTime.toISOString(),
            bettingClosesAt: newBettingCutoff.toISOString(),
            timeUpdateAt: (/* @__PURE__ */ new Date()).toISOString(),
            timeUpdateReason: "GAME_TIME_CHANGED"
          }
        }
      });
      console.log(`\u2705 Sports market ${marketId} timing updated - new game time: ${newGameTime.toISOString()}`);
    } catch (error) {
      console.error(`Failed to update sports market timing ${marketId}:`, error);
    }
  }
  /**
   * Resolve all active markets that have expired
   */
  async resolveExpiredMarkets() {
    let resolved = 0;
    let errors = 0;
    try {
      const expiredMarkets = await predictionMarkets.getExpiredMarkets();
      console.log(`Found ${expiredMarkets.length} expired markets to resolve`);
      for (const market of expiredMarkets) {
        try {
          const result = await this.resolveMarket(market.id);
          if (result.success) {
            resolved++;
            console.log(`\u2705 Resolved market ${market.id} with outcome: ${result.outcome}`);
          } else {
            errors++;
            console.error(`\u274C Failed to resolve market ${market.id}: ${result.error}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1e3));
        } catch (error) {
          errors++;
          console.error(`\u274C Error resolving market ${market.id}:`, error);
        }
      }
    } catch (error) {
      console.error("Error in resolveExpiredMarkets:", error);
    }
    console.log(`Market resolution complete: ${resolved} resolved, ${errors} errors`);
    return { resolved, errors };
  }
  /**
   * SECURITY: Check if market is API-guaranteed and bulletproof
   */
  isAPIGuaranteedMarket(market) {
    const marketData = market.marketData;
    if (marketData?.templateBased !== true || marketData?.apiGuaranteed !== true) {
      console.warn(`Market ${market.id} lacks template/API guarantees`);
      return false;
    }
    const apiGuaranteedTypes = [
      "CRYPTO_PRICE_DIRECTION",
      "CRYPTO_DAILY_CHANGE",
      "CRYPTO_VOLUME",
      "CRYPTO_PRICE_TARGET",
      "CRYPTO_PRICE_RANGE",
      "CRYPTO_RANK_TARGET",
      "SPORTS_WINNER",
      "SPORTS_TOTAL",
      "SPORTS_SPREAD",
      "PRICE_UP_DOWN",
      "PRICE_ABOVE_BELOW",
      "VOLUME_RANKING"
      // Legacy types
    ];
    if (!apiGuaranteedTypes.includes(market.marketType)) {
      console.warn(`Market ${market.id} has unsupported type: ${market.marketType}`);
      return false;
    }
    if (!marketData?.apiEndpoint && !marketData?.resolutionCriteria) {
      console.warn(`Market ${market.id} lacks API endpoint/criteria`);
      return false;
    }
    if (market.marketType.startsWith("CRYPTO_")) {
      const targetToken = marketData?.targetTokenSymbol || marketData?.tokenSymbol;
      if (!targetToken) {
        console.warn(`Crypto market ${market.id} missing token symbol`);
        return false;
      }
    }
    if (market.marketType.startsWith("SPORTS_")) {
      const gameId = marketData?.gameId || marketData?.eventId;
      if (!gameId) {
        console.warn(`Sports market ${market.id} missing game/event ID`);
        return false;
      }
    }
    console.log(`\u2705 Market ${market.id} passed API guarantee validation`);
    return true;
  }
  /**
   * Check if a token is a major token available on CoinGecko
   */
  isMajorToken(symbol) {
    const majorTokens = ["BTC", "ETH", "USDC", "USDT", "BNB", "SOL", "ADA", "AVAX", "DOT", "MATIC"];
    return majorTokens.includes(symbol.toUpperCase());
  }
  /**
   * Check if error indicates API downtime requiring manual intervention
   */
  isAPIDowntimeError(error) {
    const errorMessage = String(error).toLowerCase();
    const downTimeIndicators = [
      "api error",
      "fetch failed",
      "network error",
      "timeout",
      "service unavailable",
      "503",
      "502",
      "504",
      "connection refused",
      "could not fetch",
      "api request failed",
      "no response"
    ];
    return downTimeIndicators.some((indicator) => errorMessage.includes(indicator));
  }
  /**
   * Flag market for manual resolution during API downtime
   */
  async flagForManualResolution(marketId, errorDetails) {
    try {
      const { prisma } = await import("./db.js");
      await prisma.predictionMarket.update({
        where: { id: marketId },
        data: {
          marketData: {
            ...await this.getMarketData(marketId),
            manualResolutionRequired: true,
            apiDowntimeError: errorDetails,
            flaggedForManualAt: (/* @__PURE__ */ new Date()).toISOString(),
            resolutionMethod: "MANUAL_OVERRIDE_DUE_TO_API_DOWNTIME"
          }
        }
      });
      console.error(`\u{1F6A8} ADMIN ALERT: Market ${marketId} requires manual resolution due to API downtime`);
      console.error(`Error details: ${errorDetails}`);
    } catch (flagError) {
      console.error(`Failed to flag market ${marketId} for manual resolution:`, flagError);
    }
  }
  /**
   * Get current market data for updating
   */
  async getMarketData(marketId) {
    try {
      const market = await predictionMarkets.getMarket(marketId);
      return market?.marketData || {};
    } catch (error) {
      console.error(`Failed to get market data for ${marketId}:`, error);
      return {};
    }
  }
  /**
   * Get CoinGecko token ID from symbol
   */
  getCoinGeckoId(symbol) {
    const tokenMap = {
      "BTC": "bitcoin",
      "ETH": "ethereum",
      "USDC": "usd-coin",
      "USDT": "tether",
      "BNB": "binancecoin",
      "SOL": "solana",
      "ADA": "cardano",
      "AVAX": "avalanche-2",
      "DOT": "polkadot",
      "MATIC": "matic-network"
    };
    return tokenMap[symbol.toUpperCase()] || null;
  }
}
const marketResolver = new MarketResolverService();
export {
  MarketResolverService,
  marketResolver
};
//# sourceMappingURL=market_resolver.js.map
