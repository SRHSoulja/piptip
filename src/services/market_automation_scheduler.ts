// src/services/market_automation_scheduler.ts - Automated market creation with full configurability
import * as cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { predictionMarkets } from './prediction_markets.js';
import { marketResolver } from './market_resolver.js';
import { sportsResolver } from './sports_resolver.js';
import { prisma } from './db.js';

export interface AutomationConfig {
  enabled: boolean;
  schedule: string[];
  timezone: string;
  maxDailyMarkets: number;
  hotReloadConfig: boolean;
  defaultGuildId: string | null;
  crypto: {
    enabled: boolean;
    chainsToScan: string[]; // User configures which chains to scan
    maxPerDay: number;
    minVolumeUSD: number;
    minLiquidityUSD: number;
    excludeStablecoins: boolean;
  };
  sports: {
    enabled: boolean;
    preferredTeams: { [league: string]: string[] };
    maxPerDay: number;
    hoursBeforeGame: number;
    maxHoursBeforeGame: number;
    marketTypes: string[];
    excludeWeakTeams: boolean;
    minOddsThreshold: number;
  };
  riskLimits: {
    maxConcurrentMarkets: number;
    cooldownBetweenSimilar: number;
    maxFailuresBeforeStop: number;
    requireApiHealthCheck: boolean;
  };
  notifications: {
    adminNotifyOnFailure: boolean;
    adminNotifyOnSuccess: boolean;
    discordChannelId: string | null;
    webhookUrl: string | null;
  };
  analytics: {
    trackPerformance: boolean;
    minBetsForSuccess: number;
    trackEngagementMetrics: boolean;
  };
}

export interface AutoMarketLog {
  id: string;
  marketId?: string;
  type: 'crypto' | 'sports';
  subtype: string;
  success: boolean;
  error?: string;
  config: any;
  createdAt: Date;
  guildId?: string;
  engagementMetrics?: {
    totalBets?: number;
    uniqueBettors?: number;
    totalVolume?: number;
  };
}

export class MarketAutomationScheduler {
  private config: AutomationConfig;
  private configPath: string;
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();
  private dailyCreationCount = 0;
  private lastResetDate = new Date().toDateString();
  private consecutiveFailures = 0;
  private logs: AutoMarketLog[] = [];

  constructor() {
    this.configPath = path.join(process.cwd(), 'config', 'market_automation.json');
    this.config = this.loadConfig();
    this.setupConfigWatcher();
  }

  /**
   * Load configuration from file with fallback defaults
   */
  private loadConfig(): AutomationConfig {
    try {
      const configData = fs.readFileSync(this.configPath, 'utf8');
      const config = JSON.parse(configData);
      console.log('✅ Market automation configuration loaded');
      return config;
    } catch (error) {
      console.error('❌ Failed to load automation config, using defaults:', error);
      return this.getDefaultConfig();
    }
  }

  /**
   * Default configuration fallback
   */
  private getDefaultConfig(): AutomationConfig {
    return {
      enabled: false,
      schedule: ["12:00"],
      timezone: "UTC",
      maxDailyMarkets: 3,
      hotReloadConfig: false,
      defaultGuildId: null,
      crypto: {
        enabled: true,
        chainsToScan: ["ethereum", "arbitrum", "base", "polygon", "optimism", "avalanche", "bsc"],
        maxPerDay: 2,
        minVolumeUSD: 100000,
        minLiquidityUSD: 50000,
        excludeStablecoins: true
      },
      sports: {
        enabled: false,
        preferredTeams: {},
        maxPerDay: 1,
        hoursBeforeGame: 24,
        maxHoursBeforeGame: 168,
        marketTypes: ["winner"],
        excludeWeakTeams: true,
        minOddsThreshold: 1.3
      },
      riskLimits: {
        maxConcurrentMarkets: 10,
        cooldownBetweenSimilar: 6,
        maxFailuresBeforeStop: 3,
        requireApiHealthCheck: true
      },
      notifications: {
        adminNotifyOnFailure: true,
        adminNotifyOnSuccess: false,
        discordChannelId: null,
        webhookUrl: null
      },
      analytics: {
        trackPerformance: true,
        minBetsForSuccess: 2,
        trackEngagementMetrics: true
      }
    };
  }

  /**
   * Setup file watcher for hot-reloadable config
   */
  private setupConfigWatcher(): void {
    if (!this.config.hotReloadConfig) return;

    try {
      fs.watchFile(this.configPath, (curr, prev) => {
        if (curr.mtime !== prev.mtime) {
          console.log('🔄 Config file changed, reloading...');
          const oldConfig = this.config;
          this.config = this.loadConfig();

          // Restart scheduling if config changed
          if (JSON.stringify(oldConfig.schedule) !== JSON.stringify(this.config.schedule) ||
              oldConfig.enabled !== this.config.enabled) {
            this.stop();
            this.start();
          }
        }
      });
    } catch (error) {
      console.error('❌ Failed to setup config watcher:', error);
    }
  }

  /**
   * Start the automation scheduler
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('📅 Market automation is disabled in config');
      return;
    }

    console.log('🚀 Starting market automation scheduler...');

    // Schedule market creation for each configured time
    this.config.schedule.forEach((time, index) => {
      const jobName = `market-creation-${index}`;

      // Convert time to cron format (e.g., "09:00" -> "0 9 * * *")
      const [hours, minutes] = time.split(':');
      const cronExpression = `${minutes} ${hours} * * *`;

      const job = cron.schedule(cronExpression, async () => {
        await this.executeMarketCreation();
      }, {
        timezone: this.config.timezone
      });

      this.scheduledJobs.set(jobName, job);
      console.log(`📅 Scheduled market creation at ${time} ${this.config.timezone}`);
    });

    // Reset daily counter at midnight
    const resetJob = cron.schedule('0 0 * * *', () => {
      this.resetDailyCounters();
    }, {
      timezone: this.config.timezone
    });

    this.scheduledJobs.set('daily-reset', resetJob);

    // Schedule sports game status monitoring (every 15 minutes)
    if (this.config.sports.enabled) {
      const sportsMonitorJob = cron.schedule('*/15 * * * *', async () => {
        await this.checkSportsGameStatuses();
      }, {
        timezone: this.config.timezone
      });

      this.scheduledJobs.set('sports-monitor', sportsMonitorJob);
      console.log('📅 Sports game status monitoring scheduled every 15 minutes');
    }

    console.log(`✅ Market automation started with ${this.config.schedule.length} scheduled times`);
  }

  /**
   * Stop all scheduled jobs
   */
  stop(): void {
    this.scheduledJobs.forEach((job, name) => {
      job.stop();
      job.destroy();
    });
    this.scheduledJobs.clear();

    fs.unwatchFile(this.configPath);

    console.log('🛑 Market automation stopped');
  }

  /**
   * Reset daily counters
   */
  private resetDailyCounters(): void {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      this.dailyCreationCount = 0;
      this.lastResetDate = today;
      this.consecutiveFailures = 0;
      console.log('🔄 Daily counters reset');
    }
  }

  /**
   * Main market creation execution
   */
  async executeMarketCreation(): Promise<void> {
    try {
      console.log('📊 Executing automated market creation...');

      // Reset daily counters if needed
      this.resetDailyCounters();

      // Check if we've hit daily limits
      if (this.dailyCreationCount >= this.config.maxDailyMarkets) {
        console.log(`⏸️ Daily market limit reached (${this.config.maxDailyMarkets})`);
        return;
      }

      // Check failure threshold
      if (this.consecutiveFailures >= this.config.riskLimits.maxFailuresBeforeStop) {
        console.log(`🚨 Too many consecutive failures (${this.consecutiveFailures}), stopping automation`);
        await this.notifyAdmin('Automation stopped due to consecutive failures', 'error');
        return;
      }

      // Health check APIs if required
      if (this.config.riskLimits.requireApiHealthCheck) {
        const healthy = await this.performHealthCheck();
        if (!healthy) {
          console.log('🏥 API health check failed, skipping creation');
          return;
        }
      }

      // Check concurrent market limits
      const activeMarkets = await this.getActiveMarketCount();
      if (activeMarkets >= this.config.riskLimits.maxConcurrentMarkets) {
        console.log(`⏸️ Max concurrent markets reached (${this.config.riskLimits.maxConcurrentMarkets})`);
        return;
      }

      const marketsCreated = [];

      // Create crypto markets
      if (this.config.crypto.enabled && this.canCreateMore('crypto')) {
        const cryptoMarket = await this.createCryptoMarket();
        if (cryptoMarket) marketsCreated.push(cryptoMarket);
      }

      // Create sports markets
      if (this.config.sports.enabled && this.canCreateMore('sports')) {
        const sportsMarket = await this.createSportsMarket();
        if (sportsMarket) marketsCreated.push(sportsMarket);
      }

      if (marketsCreated.length > 0) {
        this.dailyCreationCount += marketsCreated.length;
        this.consecutiveFailures = 0;
        console.log(`✅ Created ${marketsCreated.length} automated markets`);

        if (this.config.notifications.adminNotifyOnSuccess) {
          await this.notifyAdmin(`Created ${marketsCreated.length} markets automatically`, 'success');
        }
      } else {
        console.log('📭 No markets created this cycle');
      }

    } catch (error) {
      console.error('❌ Error in automated market creation:', error);
      this.consecutiveFailures++;
      await this.logMarketCreation({
        id: `error-${Date.now()}`,
        type: 'crypto',
        subtype: 'system_error',
        success: false,
        error: String(error),
        config: {},
        createdAt: new Date()
      });

      if (this.config.notifications.adminNotifyOnFailure) {
        await this.notifyAdmin(`Market creation error: ${error}`, 'error');
      }
    }
  }

  /**
   * Check if we can create more markets of a specific type
   */
  private canCreateMore(type: 'crypto' | 'sports'): boolean {
    const todaysLogs = this.getTodaysLogs().filter(log => log.type === type && log.success);

    if (type === 'crypto') {
      return todaysLogs.length < this.config.crypto.maxPerDay;
    } else {
      return todaysLogs.length < this.config.sports.maxPerDay;
    }
  }

  /**
   * Create automated crypto markets using intelligent token scanning
   */
  private async createCryptoMarket(): Promise<AutoMarketLog | null> {
    try {
      console.log('💰 Starting intelligent crypto market creation...');

      // STEP 1: Scan crypto opportunities across multiple chains
      const opportunities = await this.scanCryptoOpportunities();
      if (opportunities.length === 0) {
        console.log('📭 No suitable crypto opportunities found');
        return null;
      }

      console.log(`🔍 Scanned and found ${opportunities.length} crypto opportunities`);

      // STEP 2: Check existing markets to prevent duplicates
      const existingCryptoMarkets = await this.getActiveCryptoMarkets();
      const availableOpportunities = opportunities.filter(opp => {
        const marketExists = existingCryptoMarkets.some(market =>
          market.marketData?.symbol === opp.symbol
        );
        return !marketExists;
      });

      console.log(`📊 Found ${availableOpportunities.length} tokens without existing markets`);

      if (availableOpportunities.length === 0) {
        console.log('📭 All suitable tokens already have markets');
        return null;
      }

      // STEP 3: Select the best opportunity
      const selectedOpportunity = availableOpportunities[0];

      console.log(`🎯 Selected top opportunity: ${selectedOpportunity.symbol} (${selectedOpportunity.chain})`);
      console.log(`📈 Opportunity score: ${selectedOpportunity.score} | Metrics:`, {
        volume24h: `$${(selectedOpportunity.volume24h / 1000).toFixed(0)}k`,
        priceChange24h: `${selectedOpportunity.priceChange24h.toFixed(1)}%`,
        volatility: `${selectedOpportunity.volatility.toFixed(1)}%`,
        marketType: selectedOpportunity.marketType.type
      });

      // STEP 4: Create market for selected opportunity
      const market = await this.createMarketForToken(selectedOpportunity);
      if (!market) {
        console.log('❌ Failed to create market for selected token');
        return null;
      }

      const log: AutoMarketLog = {
        id: `crypto-${Date.now()}`,
        marketId: market.id,
        type: 'crypto',
        subtype: selectedOpportunity.marketType.type,
        success: true,
        config: {
          opportunity: selectedOpportunity,
          marketData: market.marketData,
          scannedOpportunities: opportunities.length,
          availableOpportunities: availableOpportunities.length
        },
        createdAt: new Date(),
        guildId: this.config.defaultGuildId || undefined
      };

      await this.logMarketCreation(log);
      console.log(`✅ Created crypto market: ${selectedOpportunity.symbol} (${selectedOpportunity.marketType.type})`);

      return log;

    } catch (error) {
      console.error('❌ Failed to create crypto market:', error);

      const log: AutoMarketLog = {
        id: `crypto-error-${Date.now()}`,
        type: 'crypto',
        subtype: 'error',
        success: false,
        error: String(error),
        config: {},
        createdAt: new Date()
      };

      await this.logMarketCreation(log);
      return null;
    }
  }

  /**
   * Scan crypto opportunities across multiple chains
   */
  private async scanCryptoOpportunities(): Promise<any[]> {
    // Get chains to scan from configuration - Abstract chain is PRIORITY!
    let chainsToScan = this.config.crypto.chainsToScan || ['abstract', 'ethereum', 'arbitrum', 'base', 'polygon', 'optimism', 'avalanche', 'bsc'];

    // Ensure Abstract is always first if prioritizeAbstract is true
    if (this.config.crypto.prioritizeAbstract !== false) {
      // Remove abstract from wherever it is and put it first
      chainsToScan = chainsToScan.filter(c => c.toLowerCase() !== 'abstract');
      chainsToScan.unshift('abstract');
    }

    const opportunities: any[] = [];

    console.log(`🔍 Scanning crypto opportunities across ${chainsToScan.length} chains (Abstract priority: ${this.config.crypto.prioritizeAbstract !== false})...`);

    for (const chain of chainsToScan) {
      try {
        console.log(`📊 Scanning ${chain} for top trading tokens...`);

        // Get top tokens by volume for this chain
        const tokens = await this.getTopTokensByChain(chain);

        for (const token of tokens) {
          try {
            // Calculate opportunity score
            const score = this.calculateOpportunityScore(token, chain);

            // Only include tokens with sufficient opportunity score
            if (score >= 20) {
              const marketType = this.determineMarketType(token);

              opportunities.push({
                symbol: token.symbol,
                chain: chain,
                volume24h: token.volume24h || 0,
                priceChange24h: token.priceChange24h || 0,
                volatility: token.volatility || 0,
                liquidity: token.liquidity || 0,
                txCount24h: token.txCount24h || 0,
                price: token.price || 0,
                score: score,
                marketType: marketType,
                isAbstract: chain === 'abstract'
              });
            }
          } catch (tokenError) {
            console.error(`❌ Error processing token data for ${chain}:`, tokenError);
          }
        }
      } catch (chainError) {
        console.error(`❌ Error scanning ${chain}:`, chainError);
      }
    }

    // Sort by opportunity score (highest first)
    let sortedOpportunities = opportunities
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // Top 20 opportunities

    // If we have Abstract chain tokens and prioritizeAbstract is true, ensure they're at the top
    if (this.config.crypto.prioritizeAbstract !== false) {
      const abstractTokens = sortedOpportunities.filter(opp => opp.chain.toLowerCase() === 'abstract');
      const otherTokens = sortedOpportunities.filter(opp => opp.chain.toLowerCase() !== 'abstract');

      // Put Abstract tokens first, then others
      sortedOpportunities = [...abstractTokens, ...otherTokens];

      if (abstractTokens.length > 0) {
        console.log(`🎯 Prioritizing ${abstractTokens.length} Abstract chain tokens!`);
      }
    }

    console.log(`✅ Found ${sortedOpportunities.length} high-quality crypto opportunities`);

    // Log chain distribution
    const chainBreakdown = sortedOpportunities.reduce((acc, opp) => {
      acc[opp.chain] = (acc[opp.chain] || 0) + 1;
      return acc;
    }, {} as { [key: string]: number });

    console.log(`📊 Chain distribution:`, chainBreakdown);

    return sortedOpportunities;
  }

  /**
   * Get top tokens by chain using ONLY DexScreener API - NO HARDCODED LISTS
   */
  private async getTopTokensByChain(chain: string): Promise<any[]> {
    try {
      console.log(`🔍 Fetching top tokens from DexScreener for ${chain}...`);

      // ONLY use DexScreener API - no fallbacks to hardcoded lists
      const topTokens = await this.fetchDexScreenerTopTokens(chain);

      if (topTokens.length === 0) {
        console.log(`⚠️ No trading tokens found on DexScreener for ${chain}`);
        return []; // Return empty array - no fallback to hardcoded lists!
      }

      console.log(`✅ Found ${topTokens.length} trading tokens on ${chain} from DexScreener`);
      return topTokens;

    } catch (error) {
      console.error(`❌ Error getting tokens for ${chain}:`, error);
      return []; // Return empty array on error - no fallback!
    }
  }

  /**
   * Fetch top tokens from DexScreener API by chain - PURE API DISCOVERY
   */
  private async fetchDexScreenerTopTokens(chain: string): Promise<any[]> {
    try {
      // First, try to get boosted/trending tokens (these are actively traded)
      const boostedUrl = 'https://api.dexscreener.com/token-boosts/top/v1';
      console.log(`📡 Fetching trending tokens from DexScreener...`);

      const response = await fetch(boostedUrl);

      if (!response.ok) {
        console.log(`⚠️ DexScreener API error: ${response.status}`);
        return [];
      }

      const boostedTokens = await response.json();
      const tokens = [];
      const seenTokens = new Set();

      // Process boosted tokens and filter by chain
      for (const token of boostedTokens) {
        // Map chain names to DexScreener chain IDs
        const chainMap: Record<string, string[]> = {
          'ethereum': ['ethereum'],
          'arbitrum': ['arbitrum'],
          'base': ['base'],
          'polygon': ['polygon'],
          'optimism': ['optimism'],
          'avalanche': ['avalanche'],
          'bsc': ['bsc'],
          'abstract': ['abstract'], // Our chain
          'solana': ['solana']
        };

        const validChains = chainMap[chain.toLowerCase()] || [chain.toLowerCase()];

        // Skip if not on requested chain
        if (!validChains.includes(token.chainId?.toLowerCase())) continue;

        // Get detailed token data if we have the address
        if (token.tokenAddress) {
          try {
            const detailUrl = `https://api.dexscreener.com/latest/dex/tokens/${token.tokenAddress}`;
            const detailResponse = await fetch(detailUrl);

            if (detailResponse.ok) {
              const detailData = await detailResponse.json();

              if (detailData.pairs && Array.isArray(detailData.pairs)) {
                // Get the best pair for this token (highest volume)
                const bestPair = detailData.pairs
                  .filter((p: any) => validChains.includes(p.chainId?.toLowerCase()))
                  .sort((a: any, b: any) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))[0];

                if (bestPair && bestPair.baseToken) {
                  const tokenSymbol = bestPair.baseToken.symbol;

                  if (!seenTokens.has(tokenSymbol) && this.isValidToken(tokenSymbol)) {
                    seenTokens.add(tokenSymbol);

                    tokens.push({
                      symbol: tokenSymbol,
                      address: bestPair.baseToken.address,
                      price: parseFloat(bestPair.priceUsd || '0'),
                      volume24h: bestPair.volume?.h24 || 0,
                      priceChange24h: bestPair.priceChange?.h24 || 0,
                      volatility: Math.abs(bestPair.priceChange?.h24 || 0),
                      liquidity: bestPair.liquidity?.usd || 0,
                      txCount24h: (bestPair.txns?.h24?.buys || 0) + (bestPair.txns?.h24?.sells || 0),
                      pairAddress: bestPair.pairAddress,
                      dexId: bestPair.dexId,
                      chainId: bestPair.chainId,
                      boosted: true
                    });
                  }
                }
              }
            }
          } catch (err) {
            console.warn(`Failed to get details for token ${token.tokenAddress}:`, err);
          }
        }
      }

      // If we don't have enough tokens, try a secondary approach
      if (tokens.length < 10) {
        console.log(`📊 Only found ${tokens.length} tokens via boosts, trying search...`);

        // Try search with popular tokens for the chain
        const popularTokens = this.getPopularTokensForChain(chain);

        for (const tokenSymbol of popularTokens) {
          if (seenTokens.has(tokenSymbol)) continue;

          try {
            const searchUrl = `https://api.dexscreener.com/latest/dex/search?q=${tokenSymbol}`;
            const searchResponse = await fetch(searchUrl);

            if (searchResponse.ok) {
              const searchData = await searchResponse.json();

              if (searchData.pairs && Array.isArray(searchData.pairs)) {
                const chainPairs = searchData.pairs.filter((p: any) =>
                  chain.toLowerCase() === 'all' || p.chainId?.toLowerCase() === chain.toLowerCase()
                );

                if (chainPairs.length > 0) {
                  const bestPair = chainPairs.sort((a: any, b: any) =>
                    (b.volume?.h24 || 0) - (a.volume?.h24 || 0)
                  )[0];

                  if (bestPair && !seenTokens.has(bestPair.baseToken?.symbol)) {
                    seenTokens.add(bestPair.baseToken?.symbol);

                    tokens.push({
                      symbol: bestPair.baseToken?.symbol,
                      address: bestPair.baseToken?.address,
                      price: parseFloat(bestPair.priceUsd || '0'),
                      volume24h: bestPair.volume?.h24 || 0,
                      priceChange24h: bestPair.priceChange?.h24 || 0,
                      volatility: Math.abs(bestPair.priceChange?.h24 || 0),
                      liquidity: bestPair.liquidity?.usd || 0,
                      txCount24h: (bestPair.txns?.h24?.buys || 0) + (bestPair.txns?.h24?.sells || 0),
                      pairAddress: bestPair.pairAddress,
                      dexId: bestPair.dexId,
                      chainId: bestPair.chainId
                    });
                  }
                }
              }
            }
          } catch (err) {
            console.warn(`Search failed for ${tokenSymbol}:`, err);
          }
        }
      }

      // Sort by volume and return top tokens
      const topTokens = tokens
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, 50); // Top 50 by volume

      console.log(`✅ Found ${topTokens.length} valid tokens from ${chain}`);

      return topTokens;

    } catch (error) {
      console.error(`❌ Error fetching from DexScreener tokens API for ${chain}:`, error);
      return [];
    }
  }

  /**
   * Validate if a token symbol is legitimate (not scam/junk)
   */
  private isValidToken(symbol: string): boolean {
    if (!symbol || typeof symbol !== 'string') return false;

    // Basic validation rules
    if (symbol.length > 15) return false; // Too long
    if (symbol.length < 2) return false;  // Too short
    if (symbol.includes('�') || symbol.includes('\x00')) return false; // Invalid chars
    const specialChars = symbol.match(/[^\w]/g);
    if (specialChars && specialChars.length > 2) return false; // Too many special chars

    // Skip obvious scam patterns
    const scamPatterns = ['TEST', 'FAKE', 'SCAM', 'RUG', 'PONZI'];
    if (scamPatterns.some(pattern => symbol.toUpperCase().includes(pattern))) return false;

    // Skip tokens that are just numbers or weird patterns
    if (/^\d+$/.test(symbol)) return false; // All numbers
    if (/^[^\w]+$/.test(symbol)) return false; // All special chars

    return true;
  }

  // NO FALLBACK FUNCTIONS - PURE API DISCOVERY ONLY!

  /**
   * Get popular tokens for a specific chain to search for
   */
  private getPopularTokensForChain(chain: string): string[] {
    const popularByChain: Record<string, string[]> = {
      'ethereum': ['PEPE', 'SHIB', 'LINK', 'UNI', 'AAVE', 'MKR', 'SNX', 'CRV', 'LDO'],
      'arbitrum': ['ARB', 'GMX', 'MAGIC', 'RDNT', 'JOE', 'DPX', 'GRAIL'],
      'base': ['BRETT', 'DEGEN', 'BALD', 'TOSHI', 'NORMIE'],
      'polygon': ['MATIC', 'QUICK', 'GHST', 'SAND', 'MANA'],
      'optimism': ['OP', 'VELO', 'SNX', 'PERP', 'KWENTA'],
      'avalanche': ['JOE', 'PNG', 'QI', 'XAVA', 'TIME'],
      'bsc': ['CAKE', 'XVS', 'ALPACA', 'BAKE', 'BABY'],
      'abstract': ['ABSTER', 'PENGU', 'ABBY', 'RETSBA', 'ETH', 'USDC'], // Real Abstract chain tokens - PRIMARY FOCUS!
      'solana': ['RAY', 'ORCA', 'BONK', 'WIF', 'JTO', 'JUP']
    };

    return popularByChain[chain.toLowerCase()] || ['ETH', 'BTC', 'USDC'];
  }

  /**
   * Calculate opportunity score for a token (higher = better)
   */
  private calculateOpportunityScore(token: any, chain: string): number {
    let score = 0;

    // Base score for all tokens
    score += 10;

    // Abstract chain gets MASSIVE priority boost - we want these markets!
    if (chain.toLowerCase() === 'abstract') score += 50;

    // Volume scoring - higher volume = more interest
    if (token.volume24h > 1000000) score += 30;      // >$1M volume
    else if (token.volume24h > 100000) score += 20;   // >$100k volume
    else if (token.volume24h > 10000) score += 10;    // >$10k volume

    // Volatility scoring - more volatile = more exciting
    if (token.volatility > 15) score += 20;
    else if (token.volatility > 10) score += 15;
    else if (token.volatility > 5) score += 10;

    // Recent price action - current interest indicator
    const absPriceChange = Math.abs(token.priceChange24h);
    if (absPriceChange > 20) score += 15;       // >20% change
    else if (absPriceChange > 10) score += 10;   // >10% change
    else if (absPriceChange > 5) score += 5;     // >5% change

    // Transaction activity - more txs = more engagement
    if (token.txCount24h > 1000) score += 10;
    else if (token.txCount24h > 500) score += 5;

    // Liquidity scoring - sufficient liquidity for fair markets
    if (token.liquidity > 500000) score += 10;
    else if (token.liquidity > 100000) score += 5;

    // Chain priority scoring - Abstract is our MAIN focus
    const chainScores: { [key: string]: number } = {
      'abstract': 50,    // Our PRIMARY ecosystem - HIGHEST priority!
      'ethereum': 10,    // Mainnet
      'arbitrum': 8,     // L2 popular
      'base': 7,         // Growing ecosystem
      'polygon': 5,      // Established L2
      'optimism': 5,     // L2
      'avalanche': 4,    // Alt L1
      'bsc': 3          // Alt L1
    };

    score += chainScores[chain.toLowerCase()] || 2;

    return score;
  }

  /**
   * Determine optimal market type based on token behavior
   */
  private determineMarketType(token: any): any {
    const volatility = token.volatility || 0;
    const volume = token.volume24h || 0;
    const priceChange = Math.abs(token.priceChange24h || 0);

    // Highly volatile token = shorter timeframe prediction
    if (volatility > 15) {
      return {
        type: 'PRICE_UP_DOWN',
        duration: 4,        // 4 hour market
        threshold: 5,       // 5% movement threshold
        description: 'Short-term volatility play'
      };
    }

    // Trending token with big move = continuation prediction
    if (priceChange > 15) {
      return {
        type: 'PRICE_UP_DOWN',
        duration: 8,        // 8 hour market
        threshold: 3,       // 3% movement threshold
        description: 'Trend continuation'
      };
    }

    // High volume but stable = breakout prediction
    if (volume > 500000 && volatility < 8) {
      return {
        type: 'PRICE_ABOVE_BELOW',
        duration: 24,       // 24 hour market
        multiplier: 1.05,   // 5% target
        description: 'Breakout prediction'
      };
    }

    // Default: moderate volatility market
    return {
      type: 'PRICE_UP_DOWN',
      duration: 12,       // 12 hour market
      threshold: 3,       // 3% movement threshold
      description: 'Medium-term prediction'
    };
  }

  /**
   * Create market for a specific token opportunity
   */
  private async createMarketForToken(opportunity: any): Promise<any | null> {
    try {
      const resolveAt = new Date(Date.now() + opportunity.marketType.duration * 60 * 60 * 1000);

      let marketData: any = {
        symbol: opportunity.symbol,
        chain: opportunity.chain,
        initialPrice: opportunity.price,
        volume24h: opportunity.volume24h,
        volatility: opportunity.volatility,
        opportunityScore: opportunity.score,
        bettingCutoffTime: new Date(resolveAt.getTime() - (resolveAt.getTime() - Date.now()) * 0.20).toISOString(),
        templateBased: true,
        dataGuaranteed: true
      };

      let market;

      switch (opportunity.marketType.type) {
        case 'PRICE_UP_DOWN':
          marketData.marketType = 'PRICE_UP_DOWN';
          marketData.thresholdPercentage = opportunity.marketType.threshold;

          market = await predictionMarkets.createMarket({
            title: `📈 Will ${opportunity.symbol} price increase by ${opportunity.marketType.threshold}%?`,
            description: `Predict if ${opportunity.symbol} will move up by ${opportunity.marketType.threshold}% or more in ${opportunity.marketType.duration} hours. Current: $${opportunity.price.toFixed(6)}`,
            resolveAt,
            creatorId: 'automation',
            guildId: this.config.defaultGuildId || '',
            channelId: '',
            tokenSymbol: 'PENGUIN',
            marketType: 'PRICE_UP_DOWN',
            marketData
          });
          break;

        case 'PRICE_ABOVE_BELOW':
          const targetPrice = opportunity.price * opportunity.marketType.multiplier;
          marketData.targetPrice = targetPrice;
          marketData.marketType = 'PRICE_ABOVE_BELOW';

          market = await predictionMarkets.createMarket({
            title: `🎯 Will ${opportunity.symbol} reach $${targetPrice.toFixed(6)}?`,
            description: `Predict if ${opportunity.symbol} will reach $${targetPrice.toFixed(6)} in ${opportunity.marketType.duration} hours. Current: $${opportunity.price.toFixed(6)}`,
            resolveAt,
            creatorId: 'automation',
            guildId: this.config.defaultGuildId || '',
            channelId: '',
            tokenSymbol: 'PENGUIN',
            marketType: 'PRICE_ABOVE_BELOW',
            marketData
          });
          break;

        default:
          throw new Error(`Unknown market type: ${opportunity.marketType.type}`);
      }

      return { ...market, marketData };

    } catch (error) {
      console.error(`❌ Error creating market for ${opportunity.symbol}:`, error);
      return null;
    }
  }

  /**
   * Get active crypto markets to prevent duplicates
   */
  private async getActiveCryptoMarkets(): Promise<any[]> {
    try {
      const markets = await prisma.predictionMarket.findMany({
        where: {
          status: 'ACTIVE',
          marketType: {
            in: ['PRICE_UP_DOWN', 'PRICE_ABOVE_BELOW', 'VOLUME_THRESHOLD']
          }
        },
        select: {
          id: true,
          marketData: true,
          title: true,
          resolveAt: true,
          createdAt: true
        }
      });

      return markets;
    } catch (error) {
      console.error('❌ Error fetching active crypto markets:', error);
      return [];
    }
  }

  /**
   * Create automated sports markets using intelligent game scanning
   */
  private async createSportsMarket(): Promise<AutoMarketLog | null> {
    try {
      console.log('🏈 Starting intelligent sports market creation...');

      // STEP 1: Scan all upcoming games across leagues
      const availableGames = await this.scanUpcomingGames();
      if (availableGames.length === 0) {
        console.log('📭 No suitable games found in 24-48 hour window');
        return null;
      }

      console.log(`🔍 Scanned and found ${availableGames.length} suitable games for next 48 hours`);

      // Log breakdown by league
      const leagueBreakdown = availableGames.reduce((acc, game) => {
        acc[game.league] = (acc[game.league] || 0) + 1;
        return acc;
      }, {} as { [key: string]: number });

      console.log(`📊 League breakdown:`, leagueBreakdown);

      // STEP 2: Check existing markets to prevent duplicates
      const existingMarkets = await this.getActiveMarkets();
      const availableGamesWithoutMarkets = availableGames.filter(game => {
        const marketExists = existingMarkets.some(market =>
          market.marketData?.eventId === game.eventId
        );
        return !marketExists;
      });

      console.log(`📊 Found ${availableGamesWithoutMarkets.length} games without existing markets`);

      if (availableGamesWithoutMarkets.length < availableGames.length) {
        const duplicateCount = availableGames.length - availableGamesWithoutMarkets.length;
        console.log(`🔄 Skipped ${duplicateCount} games that already have markets`);
      }

      if (availableGamesWithoutMarkets.length === 0) {
        console.log('📭 All suitable games already have markets');
        return null;
      }

      // STEP 3: Prioritize games and select the best one
      const prioritizedGames = this.prioritizeGames(availableGamesWithoutMarkets);
      if (prioritizedGames.length === 0) {
        console.log('📭 No games passed priority filtering');
        return null;
      }

      const selectedGame = prioritizedGames[0];

      console.log(`🎯 Selected priority game: ${selectedGame.homeTeam} vs ${selectedGame.awayTeam} (${selectedGame.league})`);
      console.log(`📈 Priority score: ${selectedGame.priorityScore} | Priority factors:`, {
        preferredTeam: selectedGame.isPreferredTeam,
        rivalry: selectedGame.isRivalry,
        primeTime: selectedGame.isPrimeTime,
        weekend: selectedGame.isWeekend,
        hoursUntilGame: Math.round(selectedGame.hoursUntilGame * 10) / 10
      });

      // Log top alternatives if available
      if (prioritizedGames.length > 1) {
        const alternatives = prioritizedGames.slice(1, 4).map(game =>
          `${game.homeTeam} vs ${game.awayTeam} (${game.priorityScore})`
        ).join(', ');
        console.log(`🔄 Alternative options: ${alternatives}`);
      }

      // STEP 4: Create market for selected game
      const market = await this.createMarketForGame(selectedGame);
      if (!market) {
        console.log('❌ Failed to create market for selected game');
        return null;
      }

      const log: AutoMarketLog = {
        id: `sports-${Date.now()}`,
        marketId: market.id,
        type: 'sports',
        subtype: selectedGame.marketType,
        success: true,
        config: {
          game: selectedGame,
          marketType: selectedGame.marketType,
          marketData: market.marketData,
          scannedGames: availableGames.length,
          availableGames: availableGamesWithoutMarkets.length
        },
        createdAt: new Date(),
        guildId: this.config.defaultGuildId || undefined
      };

      await this.logMarketCreation(log);
      console.log(`✅ Created sports market: ${selectedGame.homeTeam} vs ${selectedGame.awayTeam} (${selectedGame.marketType})`);

      return log;

    } catch (error) {
      console.error('❌ Failed to create sports market:', error);

      const log: AutoMarketLog = {
        id: `sports-error-${Date.now()}`,
        type: 'sports',
        subtype: 'error',
        success: false,
        error: String(error),
        config: {},
        createdAt: new Date()
      };

      await this.logMarketCreation(log);
      return null;
    }
  }

  /**
   * Scan all upcoming games across multiple leagues
   */
  private async scanUpcomingGames(): Promise<any[]> {
    const leagues = ['NFL', 'NBA', 'Premier League', 'MLB', 'NHL'];
    const availableGames: any[] = [];
    const now = new Date();

    console.log(`🔍 Scanning upcoming games across ${leagues.length} leagues...`);

    for (const league of leagues) {
      try {
        const upcomingGames = await sportsResolver.fetchUpcomingGames(league);
        if (!upcomingGames.success || !upcomingGames.games) {
          console.log(`⚠️  No games found for ${league}`);
          continue;
        }

        console.log(`📊 Found ${upcomingGames.games.length} upcoming games in ${league}`);

        for (const game of upcomingGames.games) {
          try {
            // Parse game time
            const gameTime = new Date(game.strTimestamp || `${game.strDate} ${game.strTime || '20:00'}`);
            const hoursUntilGame = (gameTime.getTime() - now.getTime()) / (60 * 60 * 1000);

            // Only consider games 24-48 hours out
            if (hoursUntilGame >= 24 && hoursUntilGame <= 48) {
              availableGames.push({
                eventId: game.idEvent,
                homeTeam: game.strHomeTeam,
                awayTeam: game.strAwayTeam,
                gameTime,
                hoursUntilGame,
                league,
                sport: game.strSport,
                date: game.strDate,
                time: game.strTime,
                season: game.strSeason,
                venue: game.strVenue,
                // Add priority indicators
                isWeekend: this.isWeekendGame(gameTime),
                isPrimeTime: this.isPrimeTimeGame(gameTime),
                isRivalry: this.isRivalryGame(game.strHomeTeam, game.strAwayTeam, league),
                isPreferredTeam: this.hasPreferredTeam(game.strHomeTeam, game.strAwayTeam, league)
              });
            }
          } catch (parseError) {
            console.error(`❌ Error parsing game data for ${league}:`, parseError);
          }
        }
      } catch (leagueError) {
        console.error(`❌ Error fetching games for ${league}:`, leagueError);
      }
    }

    console.log(`✅ Scanned ${leagues.length} leagues, found ${availableGames.length} games in 24-48 hour window`);
    return availableGames;
  }

  /**
   * Prioritize games based on importance, timing, and preferences
   */
  private prioritizeGames(games: any[]): any[] {
    return games
      .map(game => ({
        ...game,
        priorityScore: this.calculateGamePriority(game)
      }))
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 10); // Top 10 priority games
  }

  /**
   * Calculate priority score for a game (higher = better)
   */
  private calculateGamePriority(game: any): number {
    let score = 0;

    // Base score for all games
    score += 10;

    // Preferred teams get major boost
    if (game.isPreferredTeam) score += 50;

    // League preferences
    const leagueScores: { [key: string]: number } = {
      'NFL': 40,
      'NBA': 35,
      'Premier League': 30,
      'MLB': 25,
      'NHL': 20
    };
    score += leagueScores[game.league] || 15;

    // Rivalry games are exciting
    if (game.isRivalry) score += 30;

    // Prime time games get more attention
    if (game.isPrimeTime) score += 20;

    // Weekend games are popular
    if (game.isWeekend) score += 15;

    // Prefer games not too far out (closer to 24h is better than 48h)
    const timingBonus = Math.max(0, 25 - (game.hoursUntilGame - 24));
    score += timingBonus;

    // Avoid odd hours (very early/late games)
    const gameHour = game.gameTime.getHours();
    if (gameHour < 6 || gameHour > 23) score -= 20;

    return score;
  }

  /**
   * Create market for a specific game
   */
  private async createMarketForGame(game: any): Promise<any | null> {
    try {
      const marketType = this.selectMarketTypeForGame(game);
      const bettingClosesAt = game.gameTime; // Betting closes exactly at game start
      const resolveAt = new Date(game.gameTime.getTime() + (3 * 60 * 60 * 1000)); // Resolution 3 hours after game start

      let marketData: any = {
        eventId: game.eventId,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        gameStartTime: game.gameTime.toISOString(),
        bettingClosesAt: bettingClosesAt.toISOString(),
        bettingClosesAtGameStart: true,
        sport: game.sport,
        league: game.league,
        venue: game.venue,
        templateBased: true,
        apiGuaranteed: true,
        disputeProof: true,
        priorityScore: game.priorityScore
      };

      let market;

      switch (marketType) {
        case 'winner':
          marketData.betTeam = game.homeTeam;
          marketData.marketType = 'SPORTS_WINNER';

          market = await predictionMarkets.createMarket({
            title: `🏈 ${game.homeTeam} vs ${game.awayTeam} - Winner`,
            description: `Predict if ${game.homeTeam} will beat ${game.awayTeam}. Game on ${game.date} at ${game.time || 'TBD'}`,
            resolveAt,
            creatorId: 'automation',
            guildId: this.config.defaultGuildId || '',
            channelId: '',
            tokenSymbol: 'PENGUIN',
            marketType: 'SPORTS_WINNER',
            marketData
          });
          break;

        case 'over_under':
          const estimatedTotal = this.estimateGameTotal(game.league);
          marketData.targetTotal = estimatedTotal;
          marketData.marketType = 'SPORTS_OVER_UNDER';

          market = await predictionMarkets.createMarket({
            title: `🎯 ${game.homeTeam} vs ${game.awayTeam} - Over ${estimatedTotal}`,
            description: `Predict if total score will be over ${estimatedTotal} points. Game on ${game.date} at ${game.time || 'TBD'}`,
            resolveAt,
            creatorId: 'automation',
            guildId: this.config.defaultGuildId || '',
            channelId: '',
            tokenSymbol: 'PENGUIN',
            marketType: 'SPORTS_OVER_UNDER',
            marketData
          });
          break;

        case 'spread':
          const spread = this.estimateGameSpread(game.league);
          marketData.spreadTeam = game.homeTeam;
          marketData.spreadPoints = spread;
          marketData.marketType = 'SPORTS_SPREAD';

          market = await predictionMarkets.createMarket({
            title: `📊 ${game.homeTeam} -${spread} vs ${game.awayTeam}`,
            description: `Predict if ${game.homeTeam} will win by more than ${spread} points. Game on ${game.date} at ${game.time || 'TBD'}`,
            resolveAt,
            creatorId: 'automation',
            guildId: this.config.defaultGuildId || '',
            channelId: '',
            tokenSymbol: 'PENGUIN',
            marketType: 'SPORTS_SPREAD',
            marketData
          });
          break;

        default:
          throw new Error(`Unknown market type: ${marketType}`);
      }

      return { ...market, marketData: { ...marketData, marketType } };

    } catch (error) {
      console.error(`❌ Error creating market for ${game.homeTeam} vs ${game.awayTeam}:`, error);
      return null;
    }
  }

  /**
   * Get active markets with metadata
   */
  private async getActiveMarkets(): Promise<any[]> {
    try {
      const markets = await prisma.predictionMarket.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          marketData: true,
          title: true,
          createdAt: true
        }
      });

      return markets;
    } catch (error) {
      console.error('❌ Error fetching active markets:', error);
      return [];
    }
  }

  /**
   * Select appropriate market type for game
   */
  private selectMarketTypeForGame(game: any): string {
    const availableTypes = this.config.sports.marketTypes || ['winner', 'over_under'];

    // Prefer winner markets for high-priority games
    if (game.priorityScore > 80 && availableTypes.includes('winner')) {
      return 'winner';
    }

    // Random selection from available types
    return this.getRandomElement(availableTypes);
  }

  /**
   * Check if game is on weekend
   */
  private isWeekendGame(gameTime: Date): boolean {
    const day = gameTime.getDay();
    return day === 0 || day === 6; // Sunday or Saturday
  }

  /**
   * Check if game is in prime time (evening)
   */
  private isPrimeTimeGame(gameTime: Date): boolean {
    const hour = gameTime.getHours();
    return hour >= 19 && hour <= 22; // 7 PM - 10 PM
  }

  /**
   * Check if this is a rivalry game (simplified)
   */
  private isRivalryGame(homeTeam: string, awayTeam: string, league: string): boolean {
    const rivalries: { [key: string]: string[][] } = {
      'NFL': [
        ['Patriots', 'Jets'], ['Cowboys', 'Giants'], ['Packers', 'Bears'],
        ['Ravens', 'Steelers'], ['49ers', 'Seahawks']
      ],
      'NBA': [
        ['Lakers', 'Celtics'], ['Warriors', 'Cavaliers'], ['Heat', 'Knicks']
      ],
      'Premier League': [
        ['Manchester United', 'Manchester City'], ['Arsenal', 'Tottenham'], ['Liverpool', 'Everton']
      ]
    };

    const leagueRivalries = rivalries[league] || [];
    return leagueRivalries.some(rivalry =>
      (homeTeam.includes(rivalry[0]) && awayTeam.includes(rivalry[1])) ||
      (homeTeam.includes(rivalry[1]) && awayTeam.includes(rivalry[0]))
    );
  }

  /**
   * Check if game involves preferred teams
   */
  private hasPreferredTeam(homeTeam: string, awayTeam: string, league: string): boolean {
    const preferredTeams = this.config.sports.preferredTeams[league] || [];
    return preferredTeams.some(team =>
      homeTeam.toLowerCase().includes(team.toLowerCase()) ||
      awayTeam.toLowerCase().includes(team.toLowerCase())
    );
  }

  /**
   * Estimate game spread based on league
   */
  private estimateGameSpread(league: string): number {
    const spreads: { [key: string]: number } = {
      'NFL': 3.5,
      'NBA': 5.5,
      'Premier League': 1.5,
      'MLB': 1.5,
      'NHL': 1.5
    };

    return spreads[league] || 3.0;
  }

  /**
   * Find an upcoming sports game suitable for market creation (DEPRECATED - replaced by intelligent scanning)
   */
  private async findUpcomingSportsGame(): Promise<any | null> {
    for (const [league, teams] of Object.entries(this.config.sports.preferredTeams)) {
      try {
        const upcomingGames = await sportsResolver.fetchUpcomingGames(league);
        if (!upcomingGames.success || !upcomingGames.games) continue;

        // Filter games by preferred teams and timing
        const suitableGames = upcomingGames.games.filter((game: any) => {
          const gameTime = new Date(`${game.date} ${game.time}`);
          const hoursUntilGame = (gameTime.getTime() - Date.now()) / (1000 * 60 * 60);

          // Check timing constraints
          if (hoursUntilGame < this.config.sports.hoursBeforeGame ||
              hoursUntilGame > this.config.sports.maxHoursBeforeGame) {
            return false;
          }

          // Check if involves preferred teams
          const hasPreferredTeam = teams.some(team =>
            game.homeTeam.toLowerCase().includes(team.toLowerCase()) ||
            game.awayTeam.toLowerCase().includes(team.toLowerCase())
          );

          return hasPreferredTeam;
        });

        if (suitableGames.length > 0) {
          // Check for existing similar markets
          const game = suitableGames[0];
          const hasExisting = await this.checkExistingSimilarMarket('sports', {
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam
          });

          if (!hasExisting) {
            return { ...game, league };
          }
        }
      } catch (error) {
        console.error(`Error fetching games for ${league}:`, error);
      }
    }

    return null;
  }

  /**
   * Estimate game total based on sport/league
   */
  private estimateGameTotal(league: string): number {
    const totals: { [key: string]: number } = {
      'NFL': 47,
      'NBA': 220,
      'Premier League': 2.5,
      'MLB': 8.5
    };

    return totals[league] || 50;
  }

  /**
   * Check for existing similar markets to avoid duplicates
   */
  private async checkExistingSimilarMarket(type: string, params: any): Promise<boolean> {
    const hoursAgo = this.config.riskLimits.cooldownBetweenSimilar;
    const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

    const recentLogs = this.logs.filter(log =>
      log.type === type &&
      log.success &&
      log.createdAt > cutoff
    );

    if (type === 'sports') {
      return recentLogs.some(log => {
        const config = log.config;
        return config.game &&
               config.game.homeTeam === params.homeTeam &&
               config.game.awayTeam === params.awayTeam;
      });
    }

    return false;
  }

  /**
   * Perform health check on required APIs
   */
  private async performHealthCheck(): Promise<boolean> {
    try {
      // Test DexScreener API
      if (this.config.crypto.enabled) {
        const testPrice = await marketResolver.fetchDexScreenerPrice('BTC');
        if (!testPrice.success) {
          console.log('🏥 DexScreener API health check failed');
          return false;
        }
      }

      // Test TheSportsDB API
      if (this.config.sports.enabled) {
        const testGames = await sportsResolver.fetchUpcomingGames('NFL');
        if (!testGames.success) {
          console.log('🏥 TheSportsDB API health check failed');
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('🏥 Health check failed:', error);
      return false;
    }
  }

  /**
   * Get count of currently active markets
   */
  private async getActiveMarketCount(): Promise<number> {
    try {
      const activeMarkets = await prisma.predictionMarket.count({
        where: { status: 'ACTIVE' }
      });
      return activeMarkets;
    } catch (error) {
      console.error('Error getting active market count:', error);
      return 0;
    }
  }

  /**
   * Log market creation to database and memory
   */
  private async logMarketCreation(log: AutoMarketLog): Promise<void> {
    // Add to memory logs
    this.logs.push(log);

    // Keep only last 1000 logs in memory
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }

    // Store in database if analytics enabled
    if (this.config.analytics.trackPerformance) {
      try {
        await prisma.autoMarketLog.create({
          data: {
            id: log.id,
            marketId: log.marketId,
            type: log.type,
            subtype: log.subtype,
            success: log.success,
            error: log.error,
            config: JSON.stringify(log.config),
            guildId: log.guildId,
            createdAt: log.createdAt
          }
        });
      } catch (error) {
        console.error('Failed to log to database:', error);
      }
    }
  }

  /**
   * Get today's creation logs
   */
  private getTodaysLogs(): AutoMarketLog[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.logs.filter(log => log.createdAt >= today);
  }

  /**
   * Notify admin of important events
   */
  private async notifyAdmin(message: string, type: 'success' | 'error'): Promise<void> {
    console.log(`📢 Admin notification (${type}): ${message}`);

    // TODO: Implement Discord webhook or channel notification
    // if (this.config.notifications.discordChannelId) {
    //   // Send to Discord channel
    // }

    // if (this.config.notifications.webhookUrl) {
    //   // Send to webhook
    // }
  }

  /**
   * Get random element from array
   */
  private getRandomElement<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  /**
   * Check sports game statuses for postponements/cancellations
   */
  private async checkSportsGameStatuses(): Promise<void> {
    if (!this.config.sports.enabled) return;

    try {
      console.log('🏈 Checking sports game statuses for postponements/cancellations...');
      const result = await marketResolver.checkSportsGameStatus();

      if (result.checked > 0) {
        console.log(`✅ Checked ${result.checked} sports markets - Cancelled: ${result.cancelled}, Updated: ${result.updated}`);

        if (result.cancelled > 0 && this.config.notifications.adminNotifyOnFailure) {
          await this.notifyAdmin(`Automatically cancelled ${result.cancelled} sports markets due to game postponements`, 'error');
        }
      }
    } catch (error) {
      console.error('❌ Error checking sports game statuses:', error);
    }
  }

  /**
   * Manual trigger for testing/admin control
   */
  async triggerManualCreation(): Promise<{ success: boolean; markets: AutoMarketLog[]; error?: string }> {
    try {
      console.log('🎯 Manual market creation triggered');
      const originalLimit = this.config.maxDailyMarkets;

      // Temporarily increase limit for manual trigger
      this.config.maxDailyMarkets = originalLimit + 5;

      await this.executeMarketCreation();

      // Restore original limit
      this.config.maxDailyMarkets = originalLimit;

      const recentMarkets = this.logs.slice(-5).filter(log =>
        log.createdAt.getTime() > Date.now() - 5 * 60 * 1000
      );

      return {
        success: true,
        markets: recentMarkets
      };
    } catch (error) {
      return {
        success: false,
        markets: [],
        error: String(error)
      };
    }
  }

  /**
   * Get automation status and statistics
   */
  getStatus(): {
    enabled: boolean;
    scheduledJobs: number;
    dailyCreated: number;
    dailyLimit: number;
    consecutiveFailures: number;
    activeMarkets: Promise<number>;
    todaysLogs: AutoMarketLog[];
    nextScheduled: string[];
  } {
    return {
      enabled: this.config.enabled,
      scheduledJobs: this.scheduledJobs.size,
      dailyCreated: this.dailyCreationCount,
      dailyLimit: this.config.maxDailyMarkets,
      consecutiveFailures: this.consecutiveFailures,
      activeMarkets: this.getActiveMarketCount(),
      todaysLogs: this.getTodaysLogs(),
      nextScheduled: this.config.schedule
    };
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(newConfig: Partial<AutomationConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Write to file if hot reload is enabled
    if (this.config.hotReloadConfig) {
      try {
        fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        console.log('✅ Configuration updated and saved');
      } catch (error) {
        console.error('❌ Failed to save updated config:', error);
      }
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): AutomationConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const marketAutomationScheduler = new MarketAutomationScheduler();