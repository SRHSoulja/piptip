// src/queues/workers/discord_outbox_worker.ts - BullMQ worker for Discord outbox processing
import { Worker, Job } from 'bullmq';
import { redis, discordOutboxQueue } from '../config.js';
import { DiscordOutboxJobData, validateDiscordOutboxJob } from '../types.js';
import { outboxService } from '../../services/outbox/outbox_service.js';
import { Client } from 'discord.js';

export class DiscordOutboxWorker {
  private worker: Worker;
  private discordClient: Client | null = null;

  constructor() {
    this.worker = new Worker(
      'discord-outbox',
      this.processJob.bind(this),
      {
        connection: redis,
        concurrency: 5, // Process multiple Discord messages concurrently
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        stalledInterval: 30000, // 30 seconds
        maxStalledCount: 3,
      }
    );

    this.setupEventHandlers();
  }

  /**
   * Initialize with Discord client
   */
  setDiscordClient(client: Client): void {
    this.discordClient = client;
    // Inject the client into the outbox service
    (outboxService as any).discord = client;
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job: Job) => {
      console.log(`✅ Discord outbox job ${job.id} completed`);
    });

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      console.error(`❌ Discord outbox job ${job?.id} failed:`, error);

      if (job) {
        this.escalateOutboxFailure(job, error);
      }
    });

    this.worker.on('stalled', (jobId: string) => {
      console.warn(`⚠️ Discord outbox job ${jobId} stalled`);
    });

    this.worker.on('error', (error: Error) => {
      console.error('❌ Discord outbox worker error:', error);
    });
  }

  private async processJob(job: Job): Promise<void> {
    const startTime = Date.now();
    console.log(`📬 Processing Discord outbox job ${job.id}`);

    try {
      if (!this.discordClient || !this.discordClient.isReady()) {
        throw new Error('Discord client not ready');
      }

      // Validate job payload
      const jobData = validateDiscordOutboxJob(job.data);

      // Add message to outbox for reliable delivery
      await this.addToOutbox(jobData);

      const duration = Date.now() - startTime;
      console.log(`✅ Discord message queued for delivery in ${duration}ms`);

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Discord outbox job failed after ${duration}ms:`, error);

      // Log error context
      await this.logOutboxError(job, error as Error);

      throw error; // Re-throw for BullMQ retry handling
    }
  }

  /**
   * Add Discord message to outbox for guaranteed delivery
   */
  private async addToOutbox(jobData: DiscordOutboxJobData): Promise<void> {
    // Use database transaction to ensure atomicity
    await (outboxService as any).prisma.$transaction(async (tx: any) => {
      // Determine message destination
      let channelId: string | undefined;
      let userId: string | undefined;
      let guildId: string | undefined;

      for (const recipient of jobData.recipients) {
        if (recipient.type === 'channel') {
          channelId = recipient.id;
        } else if (recipient.type === 'user') {
          userId = recipient.id;
        } else if (recipient.type === 'guild') {
          guildId = recipient.id;
        }
      }

      // Determine priority based on message type and metadata
      let priority = 5; // Default priority
      if (jobData.metadata.priority === 'urgent') {
        priority = 1; // Highest priority
      } else if (jobData.metadata.priority === 'low') {
        priority = 8; // Low priority
      }

      if (jobData.type === 'alert') {
        priority = 1; // Alerts are always high priority
      }

      // Add to outbox
      await outboxService.addMessage(tx, {
        aggregateId: jobData.idempotencyKey,
        aggregateType: 'DISCORD',
        eventType: `DISCORD_${jobData.type.toUpperCase()}`,
        channelId,
        userId,
        guildId,
        payload: {
          content: jobData.content.content,
          embeds: jobData.content.embeds,
          components: jobData.content.components,
          files: jobData.content.files,
        },
        priority,
      });
    });
  }

  private async escalateOutboxFailure(job: Job, error: Error): Promise<void> {
    console.error(`🚨 CRITICAL: Discord outbox failure`);
    console.error(`Job ID: ${job.id}, Type: ${job.data.type}`);
    console.error(`Error: ${error.message}`);

    // Add to dead letter queue
    const { deadLetterQueue } = await import('../config.js');
    const { createDeadLetterJob } = await import('../types.js');

    const deadLetterData = createDeadLetterJob({
      originalQueue: 'discord-outbox',
      originalJobId: job.id || 'unknown',
      originalPayload: job.data,
      failureReason: error.message,
      attempts: job.attemptsMade || 0,
      lastError: {
        message: error.message,
        stack: error.stack || '',
        timestamp: Date.now(),
      },
      metadata: {
        canRetry: !error.message.includes('Discord client not ready'),
        requiresManualReview: error.message.includes('Discord client not ready'),
        escalationLevel: 'medium',
        estimatedResolution: 'Check Discord client connection and retry',
      }
    });

    await deadLetterQueue.add('discord-outbox-failure', deadLetterData, {
      priority: 3,
      removeOnComplete: false,
      removeOnFail: false,
    });
  }

  private async logOutboxError(job: Job, error: Error): Promise<void> {
    const errorContext = {
      jobId: job.id,
      type: job.data.type,
      recipients: job.data.recipients,
      attempt: job.attemptsMade,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.constructor.name,
      },
      timestamp: new Date().toISOString(),
      discordClientReady: this.discordClient?.isReady() || false,
    };

    await redis.setex(
      `discord:outbox:error:${job.id}`,
      86400, // 24 hours
      JSON.stringify(errorContext)
    );

    console.error('📝 Discord outbox error context stored:', errorContext);
  }

  public async close(): Promise<void> {
    await this.worker.close();
    console.log('✅ Discord outbox worker closed');
  }

  public async pause(): Promise<void> {
    await this.worker.pause();
    console.log('⏸️ Discord outbox worker paused');
  }

  public async resume(): Promise<void> {
    await this.worker.resume();
    console.log('▶️ Discord outbox worker resumed');
  }

  public getStatus() {
    return {
      isRunning: this.worker.isRunning(),
      isPaused: this.worker.isPaused(),
      concurrency: 5,
      discordReady: this.discordClient?.isReady() || false,
    };
  }
}

// Export singleton instance
export const discordOutboxWorker = new DiscordOutboxWorker();

console.log('🚀 Discord outbox worker initialized');