// src/services/resilient_discord_updates.ts - Resilient Discord message update service
import type { Client } from "discord.js";
import { prisma } from "./db.js";
import { rateLimitedDiscord } from "./discord_rate_limiter.js";

interface PendingDiscordUpdate {
  id: string;
  type: "group_tip_finalize";
  tipId: number;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: Date;
  nextRetryAt: Date;
  exponentialBackoff: boolean;
  metadata?: Record<string, any>;
}

interface UpdateResult {
  success: boolean;
  error?: string;
  shouldRetry: boolean;
}

class ResilientDiscordUpdateService {
  private retryQueue = new Map<string, PendingDiscordUpdate>();
  private processingTimer: NodeJS.Timeout | null = null;
  private client: Client | null = null;
  private isShuttingDown = false;

  // Configuration
  private readonly DEFAULT_MAX_ATTEMPTS = 8;
  private readonly INITIAL_RETRY_DELAY_MS = 1000; // 1 second
  private readonly MAX_RETRY_DELAY_MS = 300000; // 5 minutes
  private readonly PROCESS_INTERVAL_MS = 5000; // Check queue every 5 seconds
  private readonly IMMEDIATE_RETRY_WINDOW_MS = 30000; // Try immediate retries for 30 seconds

  constructor() {
    console.log("🔧 ResilientDiscordUpdateService initialized");
  }

  /**
   * Initialize with Discord client and start processing queue
   */
  async initialize(client: Client): Promise<void> {
    this.client = client;
    console.log("🚀 ResilientDiscordUpdateService started with client");

    // Start the background processing loop
    this.startProcessingLoop();

    // Load any persistent retry queue from database if needed
    await this.loadPersistentQueue();
  }

  /**
   * Queue a Discord update for reliable delivery
   */
  async queueUpdate(
    type: "group_tip_finalize",
    tipId: number,
    maxAttempts: number = this.DEFAULT_MAX_ATTEMPTS,
    exponentialBackoff: boolean = true
  ): Promise<string> {
    const updateId = `${type}_${tipId}_${Date.now()}`;

    const pendingUpdate: PendingDiscordUpdate = {
      id: updateId,
      type,
      tipId,
      attempts: 0,
      maxAttempts,
      lastAttemptAt: new Date(),
      nextRetryAt: new Date(), // Try immediately
      exponentialBackoff,
      metadata: { queuedAt: new Date().toISOString() }
    };

    this.retryQueue.set(updateId, pendingUpdate);
    console.log(`📋 Queued Discord update: ${updateId} for tip ${tipId}`);

    // Try immediate execution
    setImmediate(() => this.processUpdate(updateId));

    return updateId;
  }

  /**
   * Attempt a Discord update with comprehensive error handling
   */
  private async executeUpdate(update: PendingDiscordUpdate): Promise<UpdateResult> {
    if (!this.client || !this.client.isReady()) {
      return {
        success: false,
        error: "Discord client not ready",
        shouldRetry: true
      };
    }

    try {
      switch (update.type) {
        case "group_tip_finalize":
          return await this.executeGroupTipUpdate(update);
        default:
          return {
            success: false,
            error: `Unknown update type: ${update.type}`,
            shouldRetry: false
          };
      }
    } catch (error: any) {
      const errorMessage = error?.message || String(error);

      // Analyze error to determine if retry is worthwhile
      const shouldRetry = this.shouldRetryError(error);

      console.warn(`⚠️ Discord update ${update.id} failed:`, errorMessage);

      return {
        success: false,
        error: errorMessage,
        shouldRetry
      };
    }
  }

  /**
   * Execute group tip finalization update
   */
  private async executeGroupTipUpdate(update: PendingDiscordUpdate): Promise<UpdateResult> {
    const { tipId } = update;

    // Import the update function to avoid circular dependencies
    const { updateGroupTipMessage } = await import("../features/group_tip_helpers.js");

    // Set aggressive timeout for live bot responsiveness
    const updatePromise = updateGroupTipMessage(this.client!, tipId);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Discord update timeout")), 15000)
    );

    try {
      await Promise.race([updatePromise, timeoutPromise]);
      console.log(`✅ Discord message updated successfully for tip ${tipId} (attempt ${update.attempts + 1})`);
      return { success: true, shouldRetry: false };
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      const shouldRetry = this.shouldRetryError(error);

      return {
        success: false,
        error: errorMessage,
        shouldRetry
      };
    }
  }

  /**
   * Determine if an error should trigger a retry
   */
  private shouldRetryError(error: any): boolean {
    const errorMessage = error?.message?.toLowerCase() || String(error).toLowerCase();

    // Network/timeout errors - retry
    if (errorMessage.includes("timeout") ||
        errorMessage.includes("network") ||
        errorMessage.includes("connection") ||
        errorMessage.includes("rate limit") ||
        errorMessage.includes("502") ||
        errorMessage.includes("503") ||
        errorMessage.includes("504")) {
      return true;
    }

    // Discord API errors
    if (error?.status) {
      const status = error.status;
      // Retry on temporary Discord API issues
      if ([429, 500, 502, 503, 504].includes(status)) {
        return true;
      }
      // Don't retry on permission or not found errors
      if ([403, 404, 400].includes(status)) {
        return false;
      }
    }

    // Default to retry for unknown errors
    return true;
  }

  /**
   * Process a single update from the queue
   */
  private async processUpdate(updateId: string): Promise<void> {
    const update = this.retryQueue.get(updateId);
    if (!update) {
      return;
    }

    // Check if it's time to retry
    if (Date.now() < update.nextRetryAt.getTime()) {
      return;
    }

    update.attempts++;
    update.lastAttemptAt = new Date();

    console.log(`🔄 Processing Discord update ${updateId} (attempt ${update.attempts}/${update.maxAttempts})`);

    const result = await this.executeUpdate(update);

    if (result.success) {
      // Success! Remove from queue
      this.retryQueue.delete(updateId);
      console.log(`✅ Discord update ${updateId} completed successfully`);
      return;
    }

    // Handle failure
    if (update.attempts >= update.maxAttempts || !result.shouldRetry) {
      // Max attempts reached or non-retryable error
      this.retryQueue.delete(updateId);
      console.error(`❌ Discord update ${updateId} failed permanently: ${result.error}`);

      // Log to database for monitoring
      await this.logFailedUpdate(update, result.error);
      return;
    }

    // Schedule retry with backoff
    const delay = this.calculateRetryDelay(update);
    update.nextRetryAt = new Date(Date.now() + delay);

    console.log(`⏳ Discord update ${updateId} will retry in ${Math.ceil(delay/1000)}s (attempt ${update.attempts}/${update.maxAttempts})`);
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(update: PendingDiscordUpdate): number {
    if (!update.exponentialBackoff) {
      return this.INITIAL_RETRY_DELAY_MS;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s, 300s
    const baseDelay = this.INITIAL_RETRY_DELAY_MS;
    const exponentialDelay = baseDelay * Math.pow(2, update.attempts - 1);

    return Math.min(exponentialDelay, this.MAX_RETRY_DELAY_MS);
  }

  /**
   * Start the background processing loop
   */
  private startProcessingLoop(): void {
    if (this.processingTimer || this.isShuttingDown) {
      return;
    }

    this.processingTimer = setInterval(async () => {
      if (this.isShuttingDown) {
        return;
      }

      try {
        // Process all pending updates
        const updateIds = Array.from(this.retryQueue.keys());

        for (const updateId of updateIds) {
          if (this.isShuttingDown) {
            break;
          }

          await this.processUpdate(updateId);
        }

        // Clean up old completed updates
        this.cleanupOldUpdates();

      } catch (error) {
        console.error("🔥 Error in Discord update processing loop:", error);
      }
    }, this.PROCESS_INTERVAL_MS);

    console.log("⚡ Discord update processing loop started");
  }

  /**
   * Clean up old updates from memory
   */
  private cleanupOldUpdates(): void {
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const cutoff = Date.now() - maxAge;

    for (const [updateId, update] of this.retryQueue.entries()) {
      if (update.lastAttemptAt.getTime() < cutoff) {
        this.retryQueue.delete(updateId);
        console.log(`🧹 Cleaned up old Discord update: ${updateId}`);
      }
    }
  }

  /**
   * Load persistent queue from database (if needed for critical updates)
   */
  private async loadPersistentQueue(): Promise<void> {
    // For now, we'll keep the queue in memory only
    // In the future, could implement database persistence for critical updates
    console.log("📂 Persistent queue loading skipped (memory-only implementation)");
  }

  /**
   * Log failed update for monitoring and analysis
   */
  private async logFailedUpdate(update: PendingDiscordUpdate, error?: string): Promise<void> {
    try {
      // Log to database for analysis
      await prisma.transaction.create({
        data: {
          type: "discord_update_failed",
          userId: null,
          guildId: null,
          tokenId: null,
          amount: update.tipId, // Store tip ID in amount field for tracking
          fee: update.attempts, // Store attempt count in fee field
          txHash: null,
          metadata: JSON.stringify({
            updateId: update.id,
            updateType: update.type,
            tipId: update.tipId,
            attempts: update.attempts,
            error: error,
            queuedAt: update.metadata?.queuedAt,
            failedAt: new Date().toISOString()
          })
        }
      });
    } catch (dbError) {
      console.error("🔥 Failed to log Discord update failure to database:", dbError);
    }
  }

  /**
   * Get current queue status for monitoring
   */
  getQueueStatus(): {
    queueSize: number;
    updates: Array<{
      id: string;
      type: string;
      tipId: number;
      attempts: number;
      maxAttempts: number;
      nextRetryAt: string;
    }>;
  } {
    const updates = Array.from(this.retryQueue.values()).map(update => ({
      id: update.id,
      type: update.type,
      tipId: update.tipId,
      attempts: update.attempts,
      maxAttempts: update.maxAttempts,
      nextRetryAt: update.nextRetryAt.toISOString()
    }));

    return {
      queueSize: this.retryQueue.size,
      updates
    };
  }

  /**
   * Shutdown the service gracefully
   */
  async shutdown(): Promise<void> {
    console.log("🛑 Shutting down ResilientDiscordUpdateService...");
    this.isShuttingDown = true;

    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }

    // Wait a moment for any in-flight operations
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log(`📊 Discord update queue shutdown complete. ${this.retryQueue.size} updates remaining.`);
  }

  /**
   * Force retry all failed updates (admin function)
   */
  async forceRetryAll(): Promise<void> {
    console.log(`🔄 Force retrying ${this.retryQueue.size} Discord updates...`);

    for (const [updateId, update] of this.retryQueue.entries()) {
      update.nextRetryAt = new Date(); // Try immediately
      setImmediate(() => this.processUpdate(updateId));
    }
  }

  /**
   * Clear all pending updates (admin function)
   */
  clearQueue(): void {
    const queueSize = this.retryQueue.size;
    this.retryQueue.clear();
    console.log(`🧹 Cleared ${queueSize} pending Discord updates from queue`);
  }
}

// Global service instance
export const resilientDiscordUpdates = new ResilientDiscordUpdateService();

/**
 * High-level function to update a group tip message with resilient retry
 */
export async function updateGroupTipMessageResilient(
  client: Client,
  tipId: number,
  maxAttempts: number = 8
): Promise<string> {
  console.log(`🚀 Queuing resilient Discord update for tip ${tipId}`);

  return await resilientDiscordUpdates.queueUpdate(
    "group_tip_finalize",
    tipId,
    maxAttempts,
    true // Use exponential backoff
  );
}

/**
 * Initialize the resilient Discord update service
 */
export async function initializeResilientDiscordUpdates(client: Client): Promise<void> {
  await resilientDiscordUpdates.initialize(client);
}

/**
 * Shutdown the resilient Discord update service
 */
export async function shutdownResilientDiscordUpdates(): Promise<void> {
  await resilientDiscordUpdates.shutdown();
}