// Redis-based precise timer service for Replit
// Provides second-accurate timing with production reliability
import { createClient } from 'redis';
import { finalizeExpiredGroupTip } from '../features/finalizeExpiredGroupTip.js';
import { updateGroupTipMessage } from '../features/group_tip_helpers.js';
class RedisTimerService {
    client = null;
    subscriber = null;
    discordClient = null;
    isConnected = false;
    /**
     * Initialize Redis connections with fallback handling
     */
    async initialize(discordClient) {
        this.discordClient = discordClient;
        try {
            // Main Redis client for setting timers
            this.client = createClient({
                url: process.env.REDIS_URL || 'redis://localhost:6379',
                socket: {
                    connectTimeout: 5000
                }
            });
            // Subscriber client for expiration events
            this.subscriber = createClient({
                url: process.env.REDIS_URL || 'redis://localhost:6379',
                socket: {
                    connectTimeout: 5000
                }
            });
            // Connect with error handling
            await Promise.all([
                this.client.connect(),
                this.subscriber.connect()
            ]);
            // Enable keyspace notifications for expiration events
            await this.client.configSet('notify-keyspace-events', 'Ex');
            // Subscribe to expiration events
            await this.subscriber.pSubscribe('__keyevent@0__:expired', (message, channel) => {
                this.handleExpiredKey(message).catch(error => {
                    console.error('❌ Redis expiration handler error:', error.message);
                });
            });
            this.isConnected = true;
            console.log('✅ Redis timer service connected and listening for expiration events');
        }
        catch (error) {
            console.warn('⚠️ Redis connection failed, falling back to existing system:', error.message);
            this.isConnected = false;
            // Don't throw - graceful degradation to existing timer system
        }
    }
    /**
     * Schedule a group tip to expire at exact timestamp
     */
    async scheduleGroupTipExpiry(tipId, expiresAt) {
        if (!this.isConnected || !this.client) {
            console.log(`⚠️ Redis not available, skipping timer for tip ${tipId}`);
            return false;
        }
        try {
            const key = `grouptip:${tipId}`;
            const ttlSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
            // Set key with exact TTL - will trigger expiration event when timer fires
            await this.client.setEx(key, ttlSeconds, JSON.stringify({
                tipId,
                expiresAt: expiresAt.toISOString(),
                scheduledAt: new Date().toISOString()
            }));
            console.log(`⏰ Redis timer set for tip ${tipId}: expires in ${ttlSeconds} seconds (${expiresAt.toISOString()})`);
            return true;
        }
        catch (error) {
            console.error(`❌ Failed to schedule Redis timer for tip ${tipId}:`, error.message);
            return false;
        }
    }
    /**
     * Cancel a scheduled group tip timer
     */
    async cancelGroupTipTimer(tipId) {
        if (!this.isConnected || !this.client) {
            return false;
        }
        try {
            const key = `grouptip:${tipId}`;
            const deleted = await this.client.del(key);
            if (deleted > 0) {
                console.log(`✅ Redis timer cancelled for tip ${tipId}`);
                return true;
            }
            return false;
        }
        catch (error) {
            console.error(`❌ Failed to cancel Redis timer for tip ${tipId}:`, error.message);
            return false;
        }
    }
    /**
     * Handle expired key from Redis keyspace notification
     */
    async handleExpiredKey(key) {
        // Check if this is a group tip expiration
        if (!key.startsWith('grouptip:')) {
            return;
        }
        const tipId = parseInt(key.replace('grouptip:', ''));
        if (!Number.isFinite(tipId)) {
            console.error(`❌ Invalid tip ID from Redis key: ${key}`);
            return;
        }
        console.log(`🔥 Redis timer FIRED for tip ${tipId} - processing expiry NOW!`);
        try {
            // Process the expiration with timeout protection
            const result = await Promise.race([
                this.processExpiredTip(tipId),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Redis expiry processing timeout')), 15000))
            ]);
            console.log(`✅ Redis timer completion for tip ${tipId}: ${result.kind}`);
        }
        catch (error) {
            console.error(`❌ Redis timer processing failed for tip ${tipId}:`, error.message);
        }
    }
    /**
     * Process expired tip with database finalization and Discord update
     */
    async processExpiredTip(tipId) {
        // Step 1: Finalize in database
        const result = await finalizeExpiredGroupTip(tipId);
        // Step 2: Update Discord message (best effort)
        if (this.discordClient && this.discordClient.isReady()) {
            try {
                await Promise.race([
                    updateGroupTipMessage(this.discordClient, tipId),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Discord update timeout')), 8000))
                ]);
                console.log(`📱 Discord message updated for tip ${tipId}`);
            }
            catch (discordError) {
                console.warn(`⚠️ Discord update failed for tip ${tipId}:`, discordError.message);
                // Don't fail the whole process if Discord is down
            }
        }
        return result;
    }
    /**
     * Get timer status for monitoring
     */
    async getTimerStatus() {
        if (!this.isConnected || !this.client) {
            return { active: 0, connected: false };
        }
        try {
            const keys = await this.client.keys('grouptip:*');
            return {
                active: keys.length,
                connected: true,
                timers: keys
            };
        }
        catch (error) {
            console.error('❌ Redis status check failed:', error.message);
            return { active: 0, connected: false };
        }
    }
    /**
     * Cleanup and disconnect
     */
    async disconnect() {
        try {
            if (this.subscriber) {
                await this.subscriber.pUnsubscribe();
                await this.subscriber.disconnect();
            }
            if (this.client) {
                await this.client.disconnect();
            }
            this.isConnected = false;
            console.log('✅ Redis timer service disconnected');
        }
        catch (error) {
            console.warn('⚠️ Redis disconnect error:', error.message);
        }
    }
    /**
     * Restore timers for existing active group tips
     */
    async restoreActiveTimers() {
        if (!this.isConnected) {
            return 0;
        }
        try {
            const { prisma } = await import('./db.js');
            // Find all active group tips
            const activeTips = await prisma.groupTip.findMany({
                where: {
                    status: 'ACTIVE',
                    expiresAt: { gt: new Date() } // Only future tips
                },
                select: { id: true, expiresAt: true }
            });
            let restored = 0;
            for (const tip of activeTips) {
                const success = await this.scheduleGroupTipExpiry(tip.id, tip.expiresAt);
                if (success)
                    restored++;
            }
            console.log(`✅ Restored ${restored}/${activeTips.length} Redis timers`);
            return restored;
        }
        catch (error) {
            console.error('❌ Failed to restore Redis timers:', error.message);
            return 0;
        }
    }
}
// Export singleton instance
export const redisTimers = new RedisTimerService();
