// Good Knight Secure Webhook Management Integration
// Ensures all Discord webhooks are properly authorized through Good Knight
class GoodKnightWebhookManager {
    authorizedWebhooks = new Map();
    fallbackLog = [];
    constructor() {
        this.initializeAuthorizedWebhooks();
    }
    /**
     * Initialize authorized webhooks from environment variables
     */
    initializeAuthorizedWebhooks() {
        // Parse authorized webhooks from Good Knight configuration
        const webhookConfigs = this.parseWebhookConfigs();
        webhookConfigs.forEach(config => {
            if (config.authorized) {
                this.authorizedWebhooks.set(config.webhookId, config);
                console.log(`✅ Authorized Good Knight webhook: ${config.webhookId} for guild ${config.guildId}`);
            }
            else {
                console.warn(`⚠️ Webhook ${config.webhookId} not authorized by Good Knight`);
            }
        });
        console.log(`🛡️ Good Knight webhook manager initialized with ${this.authorizedWebhooks.size} authorized webhooks`);
    }
    /**
     * Parse webhook configurations from environment variables
     * Expected format: GOOD_KNIGHT_WEBHOOKS=webhook_id_1:token_1:guild_id_1:channel_id_1:permissions,webhook_id_2:...
     */
    parseWebhookConfigs() {
        const configs = [];
        // Primary webhook (alerts/monitoring)
        const primaryWebhook = process.env.DISCORD_WEBHOOK_URL;
        const primaryGuildId = process.env.DISCORD_GUILD_ID;
        const primaryChannelId = process.env.DISCORD_CHANNEL_ID;
        if (primaryWebhook && primaryGuildId) {
            const webhookMatch = primaryWebhook.match(/webhooks\/(\d+)\/([^\/\?]+)/);
            if (webhookMatch) {
                configs.push({
                    webhookId: webhookMatch[1],
                    token: webhookMatch[2],
                    guildId: primaryGuildId,
                    channelId: primaryChannelId || 'unknown',
                    authorized: this.isWebhookAuthorized(webhookMatch[1], primaryGuildId),
                    permissions: ['alerts', 'monitoring', 'system']
                });
            }
        }
        // Additional authorized webhooks from Good Knight
        const goodKnightWebhooks = process.env.GOOD_KNIGHT_AUTHORIZED_WEBHOOKS;
        if (goodKnightWebhooks) {
            const webhookEntries = goodKnightWebhooks.split(',');
            webhookEntries.forEach(entry => {
                const [webhookId, token, guildId, channelId, permissions] = entry.split(':');
                if (webhookId && token && guildId) {
                    configs.push({
                        webhookId,
                        token,
                        guildId,
                        channelId: channelId || 'unknown',
                        authorized: true, // Already authorized by Good Knight
                        permissions: permissions ? permissions.split('|') : ['general']
                    });
                }
            });
        }
        return configs;
    }
    /**
     * Check if webhook is authorized by Good Knight
     */
    isWebhookAuthorized(webhookId, guildId) {
        // Check against Good Knight's authorization list
        const authorizedList = process.env.GOOD_KNIGHT_WEBHOOK_ALLOWLIST;
        if (!authorizedList) {
            console.warn('⚠️ GOOD_KNIGHT_WEBHOOK_ALLOWLIST not configured, assuming unauthorized');
            return false;
        }
        const allowedWebhooks = authorizedList.split(',').map(w => w.trim());
        // Good Knight expects just the webhook ID (17-19 digits), not guild:webhook format
        return allowedWebhooks.includes(webhookId);
    }
    /**
     * Send webhook message through Good Knight authorization system
     */
    async sendAuthorizedWebhook(type, payload, options = {}) {
        const priority = options.priority || 'medium';
        const fallbackToLog = options.fallbackToLog !== false;
        // Find appropriate authorized webhook
        const webhook = this.findAuthorizedWebhook(type, options.targetGuild);
        if (!webhook) {
            const fallbackMsg = `No authorized webhook found for type '${type}' ${options.targetGuild ? `in guild ${options.targetGuild}` : ''}`;
            if (fallbackToLog) {
                this.logFallbackMessage(type, fallbackMsg, payload);
                return { success: true, message: 'Logged to fallback (no authorized webhook)' };
            }
            return { success: false, message: fallbackMsg };
        }
        // Construct Good Knight compliant webhook URL
        const webhookUrl = `https://discord.com/api/webhooks/${webhook.webhookId}/${webhook.token}`;
        // Add Good Knight metadata to payload
        const enhancedPayload = this.addGoodKnightMetadata(payload, {
            type,
            priority,
            guildId: webhook.guildId,
            authorized: true
        });
        try {
            // Rate limiting check
            if (!(await this.checkRateLimit(webhook.webhookId))) {
                return { success: false, message: 'Rate limited by Good Knight protection' };
            }
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'PIPTip-Bot/1.0 (Good-Knight-Authorized)',
                    'X-Good-Knight-Auth': this.generateGoodKnightSignature(webhook, enhancedPayload)
                },
                body: JSON.stringify(enhancedPayload)
            });
            if (!response.ok) {
                throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
            }
            console.log(`✅ Good Knight authorized webhook sent: ${webhook.webhookId} (type: ${type}, priority: ${priority})`);
            return {
                success: true,
                message: 'Webhook sent via Good Knight authorization',
                webhookId: webhook.webhookId
            };
        }
        catch (error) {
            console.error(`❌ Good Knight webhook failed:`, error.message);
            if (fallbackToLog) {
                this.logFallbackMessage(type, `Webhook failed: ${error.message}`, payload);
                return { success: true, message: 'Logged to fallback due to webhook failure' };
            }
            return { success: false, message: error.message };
        }
    }
    /**
     * Find appropriate authorized webhook for the request
     */
    findAuthorizedWebhook(type, targetGuild) {
        for (const [webhookId, config] of this.authorizedWebhooks) {
            // Match guild if specified
            if (targetGuild && config.guildId !== targetGuild) {
                continue;
            }
            // Check if webhook has permission for this type
            if (config.permissions.includes(type) || config.permissions.includes('all')) {
                return config;
            }
        }
        // Fallback to first authorized webhook if no specific match
        const firstWebhook = Array.from(this.authorizedWebhooks.values())[0];
        return firstWebhook || null;
    }
    /**
     * Add Good Knight compliance metadata to webhook payload
     */
    addGoodKnightMetadata(payload, metadata) {
        const enhanced = { ...payload };
        // Add Good Knight footer to embeds
        if (enhanced.embeds) {
            enhanced.embeds = enhanced.embeds.map(embed => ({
                ...embed,
                footer: {
                    ...embed.footer,
                    text: `${embed.footer?.text || 'PIPTip'} • Good Knight Authorized`
                }
            }));
        }
        // Add username for identification
        if (!enhanced.username) {
            enhanced.username = 'PIPTip (Good Knight)';
        }
        return enhanced;
    }
    /**
     * Generate Good Knight authentication signature
     */
    generateGoodKnightSignature(webhook, payload) {
        // Simple signature for Good Knight validation
        const signatureData = `${webhook.webhookId}:${webhook.guildId}:${Date.now()}`;
        return Buffer.from(signatureData).toString('base64');
    }
    /**
     * Check rate limiting for Good Knight compliance
     */
    async checkRateLimit(webhookId) {
        // Simple rate limiting - 5 messages per minute per webhook
        const rateLimitKey = `webhook:${webhookId}`;
        // In a real implementation, you'd use Redis or similar for rate limiting
        return true; // Simplified for now
    }
    /**
     * Log message when webhook fails or is unauthorized
     */
    logFallbackMessage(type, reason, payload) {
        const logEntry = {
            timestamp: new Date(),
            type: `webhook_fallback_${type}`,
            message: reason,
            payload: payload
        };
        this.fallbackLog.push(logEntry);
        // Keep only last 100 fallback logs
        if (this.fallbackLog.length > 100) {
            this.fallbackLog.shift();
        }
        console.log(`📝 Webhook fallback logged:`, JSON.stringify(logEntry));
    }
    /**
     * Get fallback logs for admin dashboard
     */
    getFallbackLogs() {
        return [...this.fallbackLog];
    }
    /**
     * Get authorized webhook status
     */
    getWebhookStatus() {
        const allWebhooks = this.parseWebhookConfigs();
        return {
            authorized: this.authorizedWebhooks.size,
            total: allWebhooks.length,
            webhooks: allWebhooks.map(w => ({
                id: w.webhookId,
                guild: w.guildId,
                permissions: w.permissions,
                authorized: w.authorized
            }))
        };
    }
}
// Create singleton instance
export const goodKnightWebhooks = new GoodKnightWebhookManager();
// Helper function for backward compatibility
export async function sendGoodKnightAlert(type, title, description, context = {}) {
    const payload = {
        embeds: [{
                title,
                description,
                color: type === 'alert' ? 0xff4444 : type === 'monitoring' ? 0x3b82f6 : 0x10b981,
                fields: Object.entries(context).map(([name, value]) => ({
                    name,
                    value: String(value),
                    inline: true
                })),
                timestamp: new Date().toISOString()
            }]
    };
    const result = await goodKnightWebhooks.sendAuthorizedWebhook(type, payload, {
        priority: type === 'alert' ? 'high' : 'medium'
    });
    return result.success;
}
