// src/services/market_templates.ts - Market template system with API and manual types
import { createLogger } from '../utils/logger.js';
const logger = createLogger('market-templates');
// API-Compatible Templates (Auto-Resolution)
export const API_COMPATIBLE_TEMPLATES = [
    {
        templateType: 'CRYPTO_PRICE_BINARY',
        name: 'Crypto Price Up/Down',
        description: 'Will crypto price go up or down by resolve time?',
        marketOutcomes: ['Up', 'Down'],
        defaultLiquidity: 1000,
        resolutionMethod: 'API_AUTO',
        requiresDataSource: true,
        adminOnly: false,
        category: 'crypto',
        examples: ['Will BTC price increase in next 24h?', 'Will ETH be higher tomorrow?']
    },
    {
        templateType: 'CRYPTO_PRICE_THRESHOLD',
        name: 'Crypto Price Above/Below',
        description: 'Will crypto price be above or below a specific threshold?',
        marketOutcomes: ['Above', 'Below'],
        defaultLiquidity: 1000,
        resolutionMethod: 'API_AUTO',
        requiresDataSource: true,
        requiresThreshold: true,
        adminOnly: false,
        category: 'crypto',
        examples: ['Will BTC be above $70K by Friday?', 'Will ETH reach $3000?']
    },
    {
        templateType: 'SPORTS_BINARY',
        name: 'Sports Win/Loss',
        description: 'Binary sports outcome (Win/Loss)',
        marketOutcomes: ['Win', 'Loss'],
        defaultLiquidity: 1200,
        resolutionMethod: 'API_SPORTS',
        requiresDataSource: true,
        adminOnly: false,
        category: 'sports',
        examples: ['Will Lakers beat Warriors?', 'Will Manchester United win?']
    },
    {
        templateType: 'THREE_WAY_SPORTS',
        name: 'Match Result (Win/Draw/Loss)',
        description: 'Three-way sports match outcome',
        marketOutcomes: ['Home Win', 'Draw', 'Away Win'],
        defaultLiquidity: 1500,
        resolutionMethod: 'API_SPORTS',
        requiresDataSource: true,
        adminOnly: false,
        category: 'sports',
        examples: ['Manchester United vs Arsenal result', 'Lakers vs Warriors outcome']
    },
    {
        templateType: 'PLAYER_PERFORMANCE',
        name: 'Player Over/Under',
        description: 'Player performance over/under threshold',
        marketOutcomes: ['Over', 'Under'],
        defaultLiquidity: 1000,
        resolutionMethod: 'API_SPORTS',
        requiresDataSource: true,
        requiresThreshold: true,
        adminOnly: false,
        category: 'sports',
        examples: ['LeBron James over 25 points', 'Messi over 1.5 goals']
    }
];
// Manual Resolution Templates (Admin Special Markets)
export const ADMIN_SPECIAL_TEMPLATES = [
    {
        templateType: 'MULTI_CHOICE_3',
        name: 'Multiple Choice (3 options)',
        description: 'Choose from 3 predefined outcomes',
        marketOutcomes: ['Option A', 'Option B', 'Option C'],
        defaultLiquidity: 1600,
        resolutionMethod: 'MANUAL_ADMIN',
        adminOnly: true,
        category: 'special',
        examples: ['Award winners', 'Event outcomes', 'Special predictions'],
        allowCustomOutcomes: true
    },
    {
        templateType: 'MULTI_CHOICE_4',
        name: 'Multiple Choice (4 options)',
        description: 'Choose from 4 predefined outcomes',
        marketOutcomes: ['Option A', 'Option B', 'Option C', 'Option D'],
        defaultLiquidity: 2000,
        resolutionMethod: 'MANUAL_ADMIN',
        adminOnly: true,
        category: 'special',
        examples: ['Presidential candidates', 'Company earnings', 'Tech announcements'],
        allowCustomOutcomes: true
    },
    {
        templateType: 'MULTI_CHOICE_5',
        name: 'Multiple Choice (5 options)',
        description: 'Choose from 5 predefined outcomes',
        marketOutcomes: ['Option A', 'Option B', 'Option C', 'Option D', 'Option E'],
        defaultLiquidity: 2500,
        resolutionMethod: 'MANUAL_ADMIN',
        adminOnly: true,
        category: 'special',
        examples: ['Top 5 performers', 'Rankings', 'Competition results'],
        allowCustomOutcomes: true
    },
    {
        templateType: 'TIME_RANGE',
        name: 'When Will It Happen',
        description: 'Predict timing of future events',
        marketOutcomes: ['This Week', 'This Month', 'This Quarter', 'This Year', 'Never'],
        defaultLiquidity: 1600,
        resolutionMethod: 'MANUAL_ADMIN',
        adminOnly: true,
        category: 'special',
        examples: ['When will X announcement happen?', 'When will Y be released?']
    },
    {
        templateType: 'YES_NO_CUSTOM',
        name: 'Custom Yes/No Event',
        description: 'Custom binary prediction requiring manual resolution',
        marketOutcomes: ['Yes', 'No'],
        defaultLiquidity: 1000,
        resolutionMethod: 'MANUAL_ADMIN',
        adminOnly: true,
        category: 'custom',
        examples: ['Will company announce X?', 'Will event Y happen?', 'Will person Z do something?']
    },
    {
        templateType: 'CUSTOM_EVENT',
        name: 'Fully Custom Market',
        description: 'Admin defines all outcomes and parameters',
        marketOutcomes: [], // Admin defines all outcomes
        defaultLiquidity: 0, // Admin sets custom
        resolutionMethod: 'MANUAL_ADMIN',
        adminOnly: true,
        category: 'custom',
        allowCustomOutcomes: true,
        minOutcomes: 2,
        maxOutcomes: 10,
        examples: ['Complex multi-outcome events', 'Special occasions', 'Community predictions']
    }
];
export class MarketTemplateService {
    /**
     * Get all available templates for a user
     */
    getAllTemplates(isAdmin = false) {
        const publicTemplates = API_COMPATIBLE_TEMPLATES.filter(t => !t.adminOnly);
        if (isAdmin) {
            return [...publicTemplates, ...ADMIN_SPECIAL_TEMPLATES];
        }
        return publicTemplates;
    }
    /**
     * Get templates by category
     */
    getTemplatesByCategory(category, isAdmin = false) {
        const allTemplates = this.getAllTemplates(isAdmin);
        return allTemplates.filter(t => t.category === category);
    }
    /**
     * Get specific template by type
     */
    getTemplate(templateType) {
        const allTemplates = [...API_COMPATIBLE_TEMPLATES, ...ADMIN_SPECIAL_TEMPLATES];
        return allTemplates.find(t => t.templateType === templateType) || null;
    }
    /**
     * Check if template is available to user
     */
    canUserUseTemplate(templateType, isAdmin = false) {
        const template = this.getTemplate(templateType);
        if (!template)
            return false;
        return !template.adminOnly || isAdmin;
    }
    /**
     * Get templates suitable for API auto-resolution
     */
    getApiCompatibleTemplates() {
        return API_COMPATIBLE_TEMPLATES;
    }
    /**
     * Get templates requiring manual admin resolution
     */
    getManualResolutionTemplates() {
        return ADMIN_SPECIAL_TEMPLATES;
    }
    /**
     * Validate template configuration
     */
    validateTemplateConfig(templateType, outcomes, customData = {}) {
        const template = this.getTemplate(templateType);
        if (!template) {
            return { valid: false, errors: ['Template not found'] };
        }
        const errors = [];
        // Check outcomes
        if (template.allowCustomOutcomes) {
            if (template.minOutcomes && outcomes.length < template.minOutcomes) {
                errors.push(`Minimum ${template.minOutcomes} outcomes required`);
            }
            if (template.maxOutcomes && outcomes.length > template.maxOutcomes) {
                errors.push(`Maximum ${template.maxOutcomes} outcomes allowed`);
            }
        }
        else {
            // Must use predefined outcomes
            if (outcomes.length !== template.marketOutcomes.length) {
                errors.push('Must use predefined outcomes for this template');
            }
        }
        // Check required fields
        if (template.requiresDataSource && !customData.dataSource) {
            errors.push('Data source required for this template');
        }
        if (template.requiresThreshold && !customData.threshold) {
            errors.push('Threshold value required for this template');
        }
        return {
            valid: errors.length === 0,
            errors
        };
    }
    /**
     * Generate market data based on template
     */
    generateMarketData(templateType, customData = {}) {
        const template = this.getTemplate(templateType);
        if (!template)
            return {};
        const marketData = {
            templateType: template.templateType,
            resolutionMethod: template.resolutionMethod,
            category: template.category,
            requiresDataSource: template.requiresDataSource || false,
            requiresThreshold: template.requiresThreshold || false
        };
        // Add template-specific data
        if (template.requiresDataSource && customData.dataSource) {
            marketData.dataSource = customData.dataSource;
        }
        if (template.requiresThreshold && customData.threshold) {
            marketData.threshold = customData.threshold;
        }
        // Add any custom metadata
        if (customData.metadata) {
            marketData.metadata = customData.metadata;
        }
        return marketData;
    }
    /**
     * Get template statistics for admin dashboard
     */
    async getTemplateStats() {
        try {
            // This could be expanded to get usage statistics from database
            const publicTemplates = API_COMPATIBLE_TEMPLATES.length;
            const adminTemplates = ADMIN_SPECIAL_TEMPLATES.length;
            const categoryCounts = {
                sports: 0,
                crypto: 0,
                custom: 0,
                special: 0
            };
            [...API_COMPATIBLE_TEMPLATES, ...ADMIN_SPECIAL_TEMPLATES].forEach(t => {
                if (categoryCounts.hasOwnProperty(t.category)) {
                    categoryCounts[t.category]++;
                }
            });
            return {
                totalTemplates: publicTemplates + adminTemplates,
                publicTemplates,
                adminTemplates,
                categoryCounts,
                resolutionMethods: {
                    apiAuto: API_COMPATIBLE_TEMPLATES.filter(t => t.resolutionMethod === 'API_AUTO').length,
                    apiSports: API_COMPATIBLE_TEMPLATES.filter(t => t.resolutionMethod === 'API_SPORTS').length,
                    manualAdmin: ADMIN_SPECIAL_TEMPLATES.length
                }
            };
        }
        catch (error) {
            logger.error({ error }, 'Error getting template stats');
            return null;
        }
    }
}
// Export singleton
export const marketTemplates = new MarketTemplateService();
console.log('📋 Market template system loaded with API and manual types');
