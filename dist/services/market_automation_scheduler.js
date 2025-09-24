// src/services/market_automation_scheduler.ts - Automated market creation with full configurability
import * as cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { predictionMarkets } from './prediction_markets.js';
import { marketResolver } from './market_resolver.js';
import { sportsResolver } from './sports_resolver.js';
import { prisma } from './db.js';
export class MarketAutomationScheduler {
    config;
    configPath;
    scheduledJobs = new Map();
    dailyCreationCount = 0;
    lastResetDate = new Date().toDateString();
    consecutiveFailures = 0;
    logs = [];
    constructor() {
        this.configPath = path.join(process.cwd(), 'config', 'market_automation.json');
        this.config = this.loadConfig();
        this.setupConfigWatcher();
    }
    /**
     * Load configuration from file with fallback defaults
     */
    loadConfig() {
        try {
            const configData = fs.readFileSync(this.configPath, 'utf8');
            const config = JSON.parse(configData);
            console.log('✅ Market automation configuration loaded');
            return config;
        }
        catch (error) {
            console.error('❌ Failed to load automation config, using defaults:', error);
            return this.getDefaultConfig();
        }
    }
    /**
     * Default configuration fallback
     */
    getDefaultConfig() {
        return {
            enabled: false,
            schedule: ["12:00"],
            timezone: "UTC",
            maxDailyMarkets: 3,
            hotReloadConfig: false,
            defaultGuildId: null,
            crypto: {
                enabled: true,
                tokens: ["BTC", "ETH"],
                types: ["price_increase_24h"],
                maxPerDay: 2,
                priceTargetMultipliers: [1.1, 1.2],
                durationHours: [24],
                minVolumeUSD: 100000,
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
    setupConfigWatcher() {
        if (!this.config.hotReloadConfig)
            return;
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
        }
        catch (error) {
            console.error('❌ Failed to setup config watcher:', error);
        }
    }
    /**
     * Start the automation scheduler
     */
    start() {
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
        console.log(`✅ Market automation started with ${this.config.schedule.length} scheduled times`);
    }
    /**
     * Stop all scheduled jobs
     */
    stop() {
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
    resetDailyCounters() {
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
    async executeMarketCreation() {
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
                if (cryptoMarket)
                    marketsCreated.push(cryptoMarket);
            }
            // Create sports markets
            if (this.config.sports.enabled && this.canCreateMore('sports')) {
                const sportsMarket = await this.createSportsMarket();
                if (sportsMarket)
                    marketsCreated.push(sportsMarket);
            }
            if (marketsCreated.length > 0) {
                this.dailyCreationCount += marketsCreated.length;
                this.consecutiveFailures = 0;
                console.log(`✅ Created ${marketsCreated.length} automated markets`);
                if (this.config.notifications.adminNotifyOnSuccess) {
                    await this.notifyAdmin(`Created ${marketsCreated.length} markets automatically`, 'success');
                }
            }
            else {
                console.log('📭 No markets created this cycle');
            }
        }
        catch (error) {
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
    canCreateMore(type) {
        const todaysLogs = this.getTodaysLogs().filter(log => log.type === type && log.success);
        if (type === 'crypto') {
            return todaysLogs.length < this.config.crypto.maxPerDay;
        }
        else {
            return todaysLogs.length < this.config.sports.maxPerDay;
        }
    }
    /**
     * Create an automated crypto market
     */
    async createCryptoMarket() {
        try {
            // Randomly select token and market type
            const token = this.getRandomElement(this.config.crypto.tokens);
            const marketType = this.getRandomElement(this.config.crypto.types);
            const duration = this.getRandomElement(this.config.crypto.durationHours);
            console.log(`📈 Creating crypto market: ${token} ${marketType} for ${duration}h`);
            let market;
            let marketData = { symbol: token };
            switch (marketType) {
                case 'price_increase_24h':
                    // Get current price and create "will price go up" market
                    const currentPriceData = await marketResolver.fetchDexScreenerPrice(token);
                    if (!currentPriceData.success) {
                        throw new Error(`Failed to fetch price for ${token}: ${currentPriceData.error}`);
                    }
                    // Skip if volume too low
                    if (currentPriceData.volume24h && currentPriceData.volume24h < this.config.crypto.minVolumeUSD) {
                        console.log(`⏸️ Skipping ${token}: volume too low (${currentPriceData.volume24h})`);
                        return null;
                    }
                    marketData.initialPrice = currentPriceData.price;
                    market = await predictionMarkets.createMarket({
                        title: `📈 Will ${token.toUpperCase()} price increase?`,
                        description: `Predict if ${token.toUpperCase()} will be higher than $${currentPriceData.price.toFixed(6)} in ${duration} hours`,
                        resolveAt: new Date(Date.now() + duration * 60 * 60 * 1000),
                        creatorId: 'automation',
                        guildId: this.config.defaultGuildId || '',
                        channelId: '',
                        tokenSymbol: 'PENGUIN',
                        marketType: 'PRICE_UP_DOWN',
                        marketData
                    });
                    break;
                case 'price_above_target':
                    // Get current price and set target based on multiplier
                    const priceData = await marketResolver.fetchDexScreenerPrice(token);
                    if (!priceData.success) {
                        throw new Error(`Failed to fetch price for ${token}: ${priceData.error}`);
                    }
                    const multiplier = this.getRandomElement(this.config.crypto.priceTargetMultipliers);
                    const targetPrice = priceData.price * multiplier;
                    marketData.targetPrice = targetPrice;
                    market = await predictionMarkets.createMarket({
                        title: `🎯 Will ${token.toUpperCase()} hit $${targetPrice.toFixed(6)}?`,
                        description: `Predict if ${token.toUpperCase()} will reach $${targetPrice.toFixed(6)} in ${duration} hours`,
                        resolveAt: new Date(Date.now() + duration * 60 * 60 * 1000),
                        creatorId: 'automation',
                        guildId: this.config.defaultGuildId || '',
                        channelId: '',
                        tokenSymbol: 'PENGUIN',
                        marketType: 'PRICE_ABOVE_BELOW',
                        marketData
                    });
                    break;
                default:
                    throw new Error(`Unknown crypto market type: ${marketType}`);
            }
            const log = {
                id: `crypto-${Date.now()}`,
                marketId: market.id,
                type: 'crypto',
                subtype: marketType,
                success: true,
                config: { token, marketType, duration, marketData },
                createdAt: new Date(),
                guildId: this.config.defaultGuildId || undefined
            };
            await this.logMarketCreation(log);
            return log;
        }
        catch (error) {
            console.error('❌ Failed to create crypto market:', error);
            const log = {
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
     * Create an automated sports market
     */
    async createSportsMarket() {
        try {
            // Find a suitable upcoming game
            const game = await this.findUpcomingSportsGame();
            if (!game) {
                console.log('📭 No suitable sports games found for market creation');
                return null;
            }
            const marketType = this.getRandomElement(this.config.sports.marketTypes);
            console.log(`🏈 Creating sports market: ${game.homeTeam} vs ${game.awayTeam} (${marketType})`);
            let market;
            let marketData = {
                eventId: game.id,
                homeTeam: game.homeTeam,
                awayTeam: game.awayTeam
            };
            // Calculate resolution time (game time + buffer)
            const gameTime = new Date(`${game.date} ${game.time}`);
            const resolveAt = new Date(gameTime.getTime() + 4 * 60 * 60 * 1000); // Game + 4 hours
            switch (marketType) {
                case 'winner':
                    marketData.betTeam = game.homeTeam;
                    market = await predictionMarkets.createMarket({
                        title: `🏈 ${game.homeTeam} vs ${game.awayTeam} - Winner`,
                        description: `Predict if ${game.homeTeam} will win against ${game.awayTeam}. Game on ${game.date}`,
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
                    // Set a reasonable total based on sport (simplified)
                    const estimatedTotal = this.estimateGameTotal(game.league);
                    marketData.targetTotal = estimatedTotal;
                    market = await predictionMarkets.createMarket({
                        title: `🎯 ${game.homeTeam} vs ${game.awayTeam} - Over ${estimatedTotal}`,
                        description: `Predict if total score will be over ${estimatedTotal} points. Game on ${game.date}`,
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
                    // Set a reasonable spread (simplified)
                    const spread = 3.5;
                    marketData.spreadTeam = game.homeTeam;
                    marketData.spreadPoints = spread;
                    market = await predictionMarkets.createMarket({
                        title: `📊 ${game.homeTeam} -${spread} vs ${game.awayTeam}`,
                        description: `Predict if ${game.homeTeam} will win by more than ${spread} points. Game on ${game.date}`,
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
                    throw new Error(`Unknown sports market type: ${marketType}`);
            }
            const log = {
                id: `sports-${Date.now()}`,
                marketId: market.id,
                type: 'sports',
                subtype: marketType,
                success: true,
                config: { game, marketType, marketData },
                createdAt: new Date(),
                guildId: this.config.defaultGuildId || undefined
            };
            await this.logMarketCreation(log);
            return log;
        }
        catch (error) {
            console.error('❌ Failed to create sports market:', error);
            const log = {
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
     * Find an upcoming sports game suitable for market creation
     */
    async findUpcomingSportsGame() {
        for (const [league, teams] of Object.entries(this.config.sports.preferredTeams)) {
            try {
                const upcomingGames = await sportsResolver.fetchUpcomingGames(league);
                if (!upcomingGames.success || !upcomingGames.games)
                    continue;
                // Filter games by preferred teams and timing
                const suitableGames = upcomingGames.games.filter((game) => {
                    const gameTime = new Date(`${game.date} ${game.time}`);
                    const hoursUntilGame = (gameTime.getTime() - Date.now()) / (1000 * 60 * 60);
                    // Check timing constraints
                    if (hoursUntilGame < this.config.sports.hoursBeforeGame ||
                        hoursUntilGame > this.config.sports.maxHoursBeforeGame) {
                        return false;
                    }
                    // Check if involves preferred teams
                    const hasPreferredTeam = teams.some(team => game.homeTeam.toLowerCase().includes(team.toLowerCase()) ||
                        game.awayTeam.toLowerCase().includes(team.toLowerCase()));
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
            }
            catch (error) {
                console.error(`Error fetching games for ${league}:`, error);
            }
        }
        return null;
    }
    /**
     * Estimate game total based on sport/league
     */
    estimateGameTotal(league) {
        const totals = {
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
    async checkExistingSimilarMarket(type, params) {
        const hoursAgo = this.config.riskLimits.cooldownBetweenSimilar;
        const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
        const recentLogs = this.logs.filter(log => log.type === type &&
            log.success &&
            log.createdAt > cutoff);
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
    async performHealthCheck() {
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
        }
        catch (error) {
            console.error('🏥 Health check failed:', error);
            return false;
        }
    }
    /**
     * Get count of currently active markets
     */
    async getActiveMarketCount() {
        try {
            const activeMarkets = await prisma.predictionMarket.count({
                where: { status: 'ACTIVE' }
            });
            return activeMarkets;
        }
        catch (error) {
            console.error('Error getting active market count:', error);
            return 0;
        }
    }
    /**
     * Log market creation to database and memory
     */
    async logMarketCreation(log) {
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
            }
            catch (error) {
                console.error('Failed to log to database:', error);
            }
        }
    }
    /**
     * Get today's creation logs
     */
    getTodaysLogs() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return this.logs.filter(log => log.createdAt >= today);
    }
    /**
     * Notify admin of important events
     */
    async notifyAdmin(message, type) {
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
    getRandomElement(array) {
        return array[Math.floor(Math.random() * array.length)];
    }
    /**
     * Manual trigger for testing/admin control
     */
    async triggerManualCreation() {
        try {
            console.log('🎯 Manual market creation triggered');
            const originalLimit = this.config.maxDailyMarkets;
            // Temporarily increase limit for manual trigger
            this.config.maxDailyMarkets = originalLimit + 5;
            await this.executeMarketCreation();
            // Restore original limit
            this.config.maxDailyMarkets = originalLimit;
            const recentMarkets = this.logs.slice(-5).filter(log => log.createdAt.getTime() > Date.now() - 5 * 60 * 1000);
            return {
                success: true,
                markets: recentMarkets
            };
        }
        catch (error) {
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
    getStatus() {
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
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        // Write to file if hot reload is enabled
        if (this.config.hotReloadConfig) {
            try {
                fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
                console.log('✅ Configuration updated and saved');
            }
            catch (error) {
                console.error('❌ Failed to save updated config:', error);
            }
        }
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
}
// Export singleton instance
export const marketAutomationScheduler = new MarketAutomationScheduler();
