import { EmbedBuilder, ButtonBuilder, ActionRowBuilder } from 'discord.js';
import { prisma } from '../database.js';
import crypto from 'crypto';
export class OutboxService {
    discord;
    config;
    processing = false;
    intervalId = null;
    rateLimitTracker = new Map();
    constructor(discord, config = {
        batchSize: 50,
        pollInterval: 2000, // 2 seconds
        retryDelays: [1000, 2000, 5000, 10000, 30000], // exponential backoff
        rateLimit: {
            messagesPerMinute: 50, // Conservative Discord rate limit
            burstLimit: 10, // Max burst before throttling
        }
    }) {
        this.discord = discord;
        this.config = config;
    }
    /**
     * Add message to outbox within a transaction (ensures atomicity)
     */
    async addMessage(tx, message) {
        const messageHash = this.generateMessageHash(message);
        try {
            const outboxMessage = await tx.outboxMessage.create({
                data: {
                    aggregateId: message.aggregateId,
                    aggregateType: message.aggregateType,
                    eventType: message.eventType,
                    channelId: message.channelId,
                    userId: message.userId,
                    guildId: message.guildId,
                    payload: message.payload,
                    messageHash,
                    priority: message.priority || 5,
                    status: 'PENDING',
                    attempts: 0,
                    maxAttempts: this.config.retryDelays.length,
                    nextRetryAt: new Date(),
                },
            });
            console.log(`📬 Message queued: ${message.eventType} for ${message.aggregateType}:${message.aggregateId}`);
            return outboxMessage.id;
        }
        catch (error) {
            if (error.code === 'P2002' && error.meta?.target?.includes('messageHash')) {
                console.log(`📬 Duplicate message prevented: ${message.eventType}`);
                // Return the existing message ID
                const existing = await tx.outboxMessage.findUnique({
                    where: { messageHash },
                    select: { id: true }
                });
                return existing?.id || 'duplicate';
            }
            throw error;
        }
    }
    /**
     * Start the outbox processor
     */
    start() {
        if (this.intervalId) {
            console.warn('⚠️ Outbox processor already started');
            return;
        }
        console.log('🚀 Starting outbox processor');
        this.intervalId = setInterval(() => {
            this.processMessages().catch(error => {
                console.error('❌ Error in outbox processor:', error);
            });
        }, this.config.pollInterval);
        // Process immediately on start
        this.processMessages();
    }
    /**
     * Stop the outbox processor
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('🛑 Outbox processor stopped');
        }
    }
    /**
     * Process pending messages with priority ordering and rate limiting
     */
    async processMessages() {
        if (this.processing) {
            return; // Skip if already processing
        }
        this.processing = true;
        try {
            // Get pending messages ordered by priority and creation time
            const messages = await prisma.outboxMessage.findMany({
                where: {
                    status: { in: ['PENDING'] },
                    nextRetryAt: { lte: new Date() },
                },
                take: this.config.batchSize,
                orderBy: [
                    { priority: 'asc' }, // Higher priority first (lower number)
                    { createdAt: 'asc' }, // FIFO within same priority
                ],
            });
            if (messages.length === 0) {
                return;
            }
            console.log(`📬 Processing ${messages.length} outbox messages`);
            // Process messages with rate limiting
            for (const message of messages) {
                if (this.isRateLimited(message.guildId || 'global')) {
                    console.log(`⏳ Rate limited, skipping message ${message.id}`);
                    continue;
                }
                await this.processMessage(message);
                // Small delay between messages to respect Discord rate limits
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        finally {
            this.processing = false;
        }
    }
    /**
     * Process individual message with comprehensive error handling
     */
    async processMessage(message) {
        try {
            // Mark as processing to prevent duplicate processing
            await prisma.outboxMessage.update({
                where: { id: message.id },
                data: {
                    status: 'PROCESSING',
                    attempts: message.attempts + 1,
                },
            });
            // Send to Discord
            await this.sendToDiscord(message);
            // Mark as successfully sent
            await prisma.outboxMessage.update({
                where: { id: message.id },
                data: {
                    status: 'SENT',
                    processedAt: new Date(),
                },
            });
            this.trackRateLimit(message.guildId || 'global');
            console.log(`✅ Message sent: ${message.eventType} (${message.id})`);
        }
        catch (error) {
            await this.handleMessageFailure(message, error);
        }
    }
    /**
     * Send message to Discord with proper formatting and error handling
     */
    async sendToDiscord(message) {
        const { channelId, userId, guildId, payload } = message;
        // Prepare message content
        const messageOptions = {
            content: payload.content,
        };
        // Process embeds
        if (payload.embeds && payload.embeds.length > 0) {
            messageOptions.embeds = payload.embeds.map((embedData) => new EmbedBuilder(embedData));
        }
        // Process components (buttons, etc.)
        if (payload.components && payload.components.length > 0) {
            messageOptions.components = payload.components.map((componentData) => {
                if (componentData.components) {
                    return new ActionRowBuilder().addComponents(componentData.components.map((comp) => {
                        if (comp.type === 2) { // Button
                            return new ButtonBuilder(comp);
                        }
                        return comp;
                    }));
                }
                return componentData;
            });
        }
        // Process files
        if (payload.files && payload.files.length > 0) {
            messageOptions.files = payload.files;
        }
        // Send to appropriate destination
        if (channelId) {
            const channel = await this.discord.channels.fetch(channelId);
            if (!channel) {
                throw new Error(`Channel ${channelId} not found or not accessible`);
            }
            if (!channel.isTextBased()) {
                throw new Error(`Channel ${channelId} is not a text channel`);
            }
            await channel.send(messageOptions);
        }
        else if (userId) {
            const user = await this.discord.users.fetch(userId);
            if (!user) {
                throw new Error(`User ${userId} not found`);
            }
            await user.send(messageOptions);
        }
        else {
            throw new Error('No channelId or userId specified for message delivery');
        }
    }
    /**
     * Handle message delivery failures with retry logic
     */
    async handleMessageFailure(message, error) {
        const attempts = message.attempts;
        const isRateLimit = error.message.includes('429') || error.message.includes('rate limit');
        const isPermissionError = error.message.includes('50013') || error.message.includes('permission');
        const isNotFound = error.message.includes('10003') || error.message.includes('not found');
        console.error(`❌ Message delivery failed (attempt ${attempts}): ${error.message}`);
        // Determine retry strategy
        if (isNotFound || isPermissionError) {
            // Don't retry for permanent failures
            await prisma.outboxMessage.update({
                where: { id: message.id },
                data: {
                    status: 'FAILED',
                    lastError: error.message,
                },
            });
            console.warn(`⚠️ Message ${message.id} failed permanently: ${error.message}`);
            return;
        }
        if (attempts >= message.maxAttempts && !isRateLimit) {
            // Move to dead letter queue after max attempts
            await prisma.outboxMessage.update({
                where: { id: message.id },
                data: {
                    status: 'DLQ',
                    lastError: error.message,
                },
            });
            console.error(`🚨 Message ${message.id} moved to DLQ after ${attempts} attempts`);
            return;
        }
        // Calculate next retry time
        const retryDelay = isRateLimit
            ? 60000 // 1 minute for rate limits
            : this.config.retryDelays[Math.min(attempts - 1, this.config.retryDelays.length - 1)];
        await prisma.outboxMessage.update({
            where: { id: message.id },
            data: {
                status: 'PENDING',
                lastError: error.message,
                nextRetryAt: new Date(Date.now() + retryDelay),
            },
        });
        console.log(`🔄 Message ${message.id} scheduled for retry in ${retryDelay}ms`);
    }
    /**
     * Check if rate limited for a guild
     */
    isRateLimited(guildId) {
        const now = Date.now();
        const tracker = this.rateLimitTracker.get(guildId);
        if (!tracker) {
            return false;
        }
        if (now > tracker.resetAt) {
            // Reset the counter
            this.rateLimitTracker.delete(guildId);
            return false;
        }
        return tracker.count >= this.config.rateLimit.messagesPerMinute;
    }
    /**
     * Track rate limit usage
     */
    trackRateLimit(guildId) {
        const now = Date.now();
        const tracker = this.rateLimitTracker.get(guildId);
        if (!tracker || now > tracker.resetAt) {
            // Reset or initialize tracker
            this.rateLimitTracker.set(guildId, {
                count: 1,
                resetAt: now + 60000, // 1 minute window
            });
        }
        else {
            tracker.count++;
        }
    }
    /**
     * Generate unique hash for message deduplication
     */
    generateMessageHash(message) {
        const content = {
            aggregateId: message.aggregateId,
            eventType: message.eventType,
            channelId: message.channelId,
            userId: message.userId,
            payload: message.payload,
        };
        return crypto
            .createHash('sha256')
            .update(JSON.stringify(content))
            .digest('hex');
    }
    /**
     * Get outbox statistics for monitoring
     */
    async getStats() {
        const stats = await prisma.outboxMessage.groupBy({
            by: ['status'],
            _count: { id: true },
        });
        const recentFailures = await prisma.outboxMessage.count({
            where: {
                status: 'FAILED',
                createdAt: {
                    gte: new Date(Date.now() - 3600000) // Last hour
                }
            }
        });
        const rateLimitInfo = Array.from(this.rateLimitTracker.entries()).map(([guildId, tracker]) => ({
            guildId,
            messagesSent: tracker.count,
            resetAt: new Date(tracker.resetAt).toISOString(),
        }));
        return {
            messagesByStatus: stats.reduce((acc, stat) => {
                acc[stat.status] = stat._count.id;
                return acc;
            }, {}),
            recentFailures,
            rateLimitInfo,
            isProcessing: this.processing,
            lastProcessed: new Date().toISOString(),
        };
    }
    /**
     * Cleanup old messages (run periodically)
     */
    async cleanup(daysToKeep = 7) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const result = await prisma.outboxMessage.deleteMany({
            where: {
                status: 'SENT',
                processedAt: { lt: cutoffDate },
            },
        });
        if (result.count > 0) {
            console.log(`🧹 Cleaned up ${result.count} old outbox messages`);
        }
        return result.count;
    }
    /**
     * Force retry all failed messages (admin operation)
     */
    async retryFailedMessages() {
        const result = await prisma.outboxMessage.updateMany({
            where: {
                status: { in: ['FAILED', 'DLQ'] },
            },
            data: {
                status: 'PENDING',
                attempts: 0,
                nextRetryAt: new Date(),
                lastError: null,
            },
        });
        console.log(`🔄 Queued ${result.count} failed messages for retry`);
        return result.count;
    }
}
// Export singleton instance
export const outboxService = new OutboxService(
// Discord client will be injected when service starts
{});
console.log('🚀 Outbox service initialized for reliable Discord message delivery');
