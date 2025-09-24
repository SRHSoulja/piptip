// src/services/market_config.ts - Configuration management for prediction markets
import fs from 'fs';
import path from 'path';
/**
 * Configuration service for prediction markets
 */
export class MarketConfigService {
    config = null;
    configPath;
    constructor() {
        this.configPath = path.join(process.cwd(), 'config', 'prediction_markets.json');
    }
    /**
     * Load configuration from file
     */
    loadConfig() {
        if (this.config) {
            return this.config;
        }
        try {
            const configData = fs.readFileSync(this.configPath, 'utf8');
            this.config = JSON.parse(configData);
            console.log('✅ Prediction market configuration loaded');
            return this.config;
        }
        catch (error) {
            console.error('❌ Failed to load prediction market config:', error);
            // Return default configuration
            return this.getDefaultConfig();
        }
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return this.config || this.loadConfig();
    }
    /**
     * Update a specific setting
     */
    updateSetting(key, value) {
        const config = this.getConfig();
        // Support nested keys like "settings.defaultRakePercentage"
        const keys = key.split('.');
        let current = config;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]]) {
                current[keys[i]] = {};
            }
            current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = value;
        this.saveConfig();
        console.log(`Updated config: ${key} = ${value}`);
    }
    /**
     * Save configuration to file
     */
    saveConfig() {
        if (!this.config)
            return;
        try {
            const configData = JSON.stringify(this.config, null, 2);
            fs.writeFileSync(this.configPath, configData, 'utf8');
            console.log('✅ Configuration saved');
        }
        catch (error) {
            console.error('❌ Failed to save configuration:', error);
        }
    }
    /**
     * Get default configuration
     */
    getDefaultConfig() {
        return {
            settings: {
                defaultRakePercentage: 3.0,
                minBet: 1,
                maxBet: 10000,
                minMarketDuration: 3600, // 1 hour
                maxMarketDuration: 604800, // 1 week
                autoResolveEnabled: true,
                autoResolveInterval: 300000, // 5 minutes
                maxActiveMarketsPerGuild: 10,
                maxBetsPerUser: 50,
                enabledTokens: ["PENGUIN", "ICE", "PEBBLE"],
                enabledChains: ["ethereum", "polygon", "arbitrum"]
            },
            templates: {
                SPORTS_WINNER: {
                    name: "Team Winner Prediction",
                    description: "Predict which team will win the game",
                    marketType: "SPORTS_WINNER",
                    requiredParams: ["eventId", "betTeam", "homeTeam", "awayTeam"],
                    defaultDuration: 10800, // 3 hours (game + overtime)
                    category: "Sports Predictions",
                    examples: ["Will Lakers beat Celtics?", "Will Chiefs win vs Patriots?"]
                },
                SPORTS_OVER_UNDER: {
                    name: "Over/Under Score Prediction",
                    description: "Predict whether total score will be over or under a number",
                    marketType: "SPORTS_OVER_UNDER",
                    requiredParams: ["eventId", "targetTotal", "homeTeam", "awayTeam"],
                    defaultDuration: 10800, // 3 hours
                    category: "Sports Predictions",
                    examples: ["Will total points be over 220?", "Will total score exceed 45?"]
                },
                SPORTS_SPREAD: {
                    name: "Point Spread Prediction",
                    description: "Predict whether a team will win by more than X points",
                    marketType: "SPORTS_SPREAD",
                    requiredParams: ["eventId", "spreadTeam", "spreadPoints", "homeTeam", "awayTeam"],
                    defaultDuration: 10800, // 3 hours
                    category: "Sports Predictions",
                    examples: ["Will Lakers win by more than 5 points?", "Will Chiefs cover -7 spread?"]
                }
            },
            quickMarkets: {},
            chains: {},
            riskLimits: {
                maxBetAmount: {},
                maxTotalMarketSize: {},
                maxMarketsPerUser: 5,
                cooldownBetweenMarkets: 3600
            },
            notifications: {}
        };
    }
    /**
     * Get market template by type
     */
    getTemplate(templateType) {
        const config = this.getConfig();
        return config.templates[templateType] || null;
    }
    /**
     * Get quick market configuration
     */
    getQuickMarket(marketKey) {
        const config = this.getConfig();
        return config.quickMarkets[marketKey] || null;
    }
    /**
     * Check if token is enabled for betting
     */
    isTokenEnabled(token) {
        const config = this.getConfig();
        return config.settings.enabledTokens.includes(token.toUpperCase());
    }
    /**
     * Check if chain is supported
     */
    isChainSupported(chain) {
        const config = this.getConfig();
        return config.settings.enabledChains.includes(chain.toLowerCase());
    }
    /**
     * Get maximum bet amount for a token
     */
    getMaxBetAmount(token) {
        const config = this.getConfig();
        return config.riskLimits.maxBetAmount[token.toUpperCase()] || config.settings.maxBet;
    }
    /**
     * Get maximum total market size for a token
     */
    getMaxMarketSize(token) {
        const config = this.getConfig();
        return config.riskLimits.maxTotalMarketSize[token.toUpperCase()] || 100000;
    }
    /**
     * Validate market parameters
     */
    validateMarketParams(params) {
        const config = this.getConfig();
        // Check duration
        if (params.duration < config.settings.minMarketDuration) {
            return { valid: false, error: `Market duration must be at least ${config.settings.minMarketDuration / 3600} hours` };
        }
        if (params.duration > config.settings.maxMarketDuration) {
            return { valid: false, error: `Market duration cannot exceed ${config.settings.maxMarketDuration / 86400} days` };
        }
        // Check token
        if (!this.isTokenEnabled(params.token)) {
            return { valid: false, error: `Token ${params.token} is not enabled for prediction markets` };
        }
        // Check bet amount if provided
        if (params.betAmount) {
            if (params.betAmount < config.settings.minBet) {
                return { valid: false, error: `Minimum bet is ${config.settings.minBet} ${params.token}` };
            }
            const maxBet = this.getMaxBetAmount(params.token);
            if (params.betAmount > maxBet) {
                return { valid: false, error: `Maximum bet is ${maxBet} ${params.token}` };
            }
        }
        // Check chain if provided
        if (params.chain && !this.isChainSupported(params.chain)) {
            return { valid: false, error: `Chain ${params.chain} is not supported` };
        }
        return { valid: true };
    }
    /**
     * Get available market templates for display
     */
    getAvailableTemplates() {
        const config = this.getConfig();
        return Object.entries(config.templates).map(([key, template]) => ({
            key,
            name: template.name,
            description: template.description,
            category: template.category
        }));
    }
    /**
     * Get available quick markets
     */
    getAvailableQuickMarkets() {
        const config = this.getConfig();
        return Object.entries(config.quickMarkets).map(([key, market]) => ({
            key,
            title: market.title,
            template: market.template
        }));
    }
    /**
     * Get notification settings
     */
    getNotificationSettings(event) {
        const config = this.getConfig();
        return config.notifications[event] || { enabled: false };
    }
    /**
     * Check if user can create more markets
     */
    canUserCreateMarket(userId, activeMarketCount) {
        const config = this.getConfig();
        if (activeMarketCount >= config.riskLimits.maxMarketsPerUser) {
            return {
                allowed: false,
                error: `You can only have ${config.riskLimits.maxMarketsPerUser} active markets at a time`
            };
        }
        return { allowed: true };
    }
    /**
     * Check if guild can have more markets
     */
    canGuildCreateMarket(guildId, activeMarketCount) {
        const config = this.getConfig();
        if (activeMarketCount >= config.settings.maxActiveMarketsPerGuild) {
            return {
                allowed: false,
                error: `This server can only have ${config.settings.maxActiveMarketsPerGuild} active markets at a time`
            };
        }
        return { allowed: true };
    }
    /**
     * Check if market type is sports-related
     */
    isSportsMarket(marketType) {
        return marketType.startsWith('SPORTS_');
    }
    /**
     * Get available sports market types
     */
    getSportsMarketTypes() {
        const config = this.getConfig();
        return Object.entries(config.templates)
            .filter(([key]) => key.startsWith('SPORTS_'))
            .map(([key, template]) => ({
            value: key,
            name: template.name,
            description: template.description
        }));
    }
    /**
     * Validate sports market parameters
     */
    validateSportsMarketParams(marketType, params) {
        const template = this.getTemplate(marketType);
        if (!template || !this.isSportsMarket(marketType)) {
            return { valid: false, error: `Invalid sports market type: ${marketType}` };
        }
        // Check required parameters
        for (const requiredParam of template.requiredParams) {
            if (!params[requiredParam]) {
                return { valid: false, error: `Missing required parameter: ${requiredParam}` };
            }
        }
        // Type-specific validations
        switch (marketType) {
            case 'SPORTS_OVER_UNDER':
                if (isNaN(params.targetTotal) || params.targetTotal <= 0) {
                    return { valid: false, error: 'Target total must be a positive number' };
                }
                break;
            case 'SPORTS_SPREAD':
                if (isNaN(params.spreadPoints)) {
                    return { valid: false, error: 'Spread points must be a valid number' };
                }
                break;
        }
        return { valid: true };
    }
}
// Export singleton instance
export const marketConfig = new MarketConfigService();
