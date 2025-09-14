#!/usr/bin/env npx tsx
// tests/viral_notification_tests.ts - Specialized tests for viral moments and notification throttling

import { performance } from 'perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { EventEmitter } from 'events';
import { writeFileSync } from 'fs';
import { join } from 'path';
import type { Client } from 'discord.js';

// Import PIPtip services
import { queueAchievementNotifications, initializeNotificationSystem } from '../src/services/notifications.js';
import { processAchievementEvent } from '../src/services/dynamic_achievements.js';
import { achievementMonitor } from '../src/services/achievement_monitoring.js';

// Viral Moment Test Configuration
interface ViralTestConfig {
  peakConcurrentUsers: number;
  burstDurationSeconds: number;
  normalOperatingUsers: number;
  achievementTypes: string[];
  notificationChannels: number;
  rateLimitThreshold: number;
  throttlingEnabled: boolean;
}

interface NotificationEvent {
  userId: string;
  achievement: string;
  timestamp: number;
  processed: boolean;
  throttled: boolean;
  batchId?: string;
  deliveryDelay?: number;
}

interface ViralTestMetrics {
  totalNotifications: number;
  throttledNotifications: number;
  batchedNotifications: number;
  peakNotificationsPerSecond: number;
  averageNotificationsPerSecond: number;
  discordRateLimitHits: number;
  userExperienceScore: number; // 0-100
  systemStabilityScore: number; // 0-100
}

// Mock Discord Bot with Rate Limiting
class MockDiscordClientWithRateLimits {
  private requestLog: Array<{ timestamp: number; endpoint: string; userId: string }> = [];
  private rateLimitWindows = new Map<string, number[]>();
  private readonly GLOBAL_RATE_LIMIT = 50; // requests per second
  private readonly USER_DM_RATE_LIMIT = 1; // DM per user per second
  private readonly CHANNEL_RATE_LIMIT = 5; // messages per channel per 5 seconds

  // Simulate Discord's rate limiting behavior
  async sendUserDM(userId: string, content: any): Promise<boolean> {
    const now = Date.now();
    const endpoint = `user_dm_${userId}`;

    // Check global rate limit
    if (this.isGlobalRateLimited()) {
      return false;
    }

    // Check user-specific DM rate limit
    if (this.isUserDMRateLimited(userId)) {
      return false;
    }

    // Log successful request
    this.requestLog.push({ timestamp: now, endpoint, userId });

    // Update rate limit windows
    this.updateRateLimitWindow(`global`, now);
    this.updateRateLimitWindow(`user_${userId}`, now);

    return true;
  }

  async sendChannelMessage(channelId: string, content: any): Promise<boolean> {
    const now = Date.now();
    const endpoint = `channel_${channelId}`;

    if (this.isGlobalRateLimited()) {
      return false;
    }

    if (this.isChannelRateLimited(channelId)) {
      return false;
    }

    this.requestLog.push({ timestamp: now, endpoint, userId: 'N/A' });
    this.updateRateLimitWindow('global', now);
    this.updateRateLimitWindow(`channel_${channelId}`, now);

    return true;
  }

  private isGlobalRateLimited(): boolean {
    const now = Date.now();
    const window = this.rateLimitWindows.get('global') || [];
    const recentRequests = window.filter(timestamp => now - timestamp < 1000);
    return recentRequests.length >= this.GLOBAL_RATE_LIMIT;
  }

  private isUserDMRateLimited(userId: string): boolean {
    const now = Date.now();
    const window = this.rateLimitWindows.get(`user_${userId}`) || [];
    const recentRequests = window.filter(timestamp => now - timestamp < 1000);
    return recentRequests.length >= this.USER_DM_RATE_LIMIT;
  }

  private isChannelRateLimited(channelId: string): boolean {
    const now = Date.now();
    const window = this.rateLimitWindows.get(`channel_${channelId}`) || [];
    const recentRequests = window.filter(timestamp => now - timestamp < 5000);
    return recentRequests.length >= this.CHANNEL_RATE_LIMIT;
  }

  private updateRateLimitWindow(key: string, timestamp: number): void {
    const window = this.rateLimitWindows.get(key) || [];
    window.push(timestamp);

    // Keep only recent timestamps (last 10 seconds)
    const recent = window.filter(ts => timestamp - ts < 10000);
    this.rateLimitWindows.set(key, recent);
  }

  getRateLimitStats(): any {
    return {
      totalRequests: this.requestLog.length,
      rateLimitWindows: Object.fromEntries(this.rateLimitWindows),
      recentActivity: this.requestLog.slice(-50) // Last 50 requests
    };
  }

  clearStats(): void {
    this.requestLog = [];
    this.rateLimitWindows.clear();
  }
}

// Smart Notification Throttling System
class SmartNotificationThrottler extends EventEmitter {
  private pendingNotifications: NotificationEvent[] = [];
  private batchedNotifications = new Map<string, NotificationEvent[]>();
  private processingInterval: NodeJS.Timeout | null = null;
  private metrics: ViralTestMetrics;

  constructor(private config: ViralTestConfig, private discordClient: MockDiscordClientWithRateLimits) {
    super();
    this.metrics = this.initializeMetrics();
    this.startProcessing();
  }

  private initializeMetrics(): ViralTestMetrics {
    return {
      totalNotifications: 0,
      throttledNotifications: 0,
      batchedNotifications: 0,
      peakNotificationsPerSecond: 0,
      averageNotificationsPerSecond: 0,
      discordRateLimitHits: 0,
      userExperienceScore: 100,
      systemStabilityScore: 100
    };
  }

  // Queue a new notification with smart throttling
  queueNotification(userId: string, achievement: string, context?: string): void {
    const notification: NotificationEvent = {
      userId,
      achievement,
      timestamp: Date.now(),
      processed: false,
      throttled: false
    };

    this.metrics.totalNotifications++;

    // Check if we should throttle this notification
    if (this.shouldThrottle(userId, achievement)) {
      notification.throttled = true;
      this.metrics.throttledNotifications++;
    }

    // Check if we should batch this notification
    if (this.shouldBatch(userId, achievement)) {
      this.addToBatch(notification);
      this.metrics.batchedNotifications++;
    } else {
      this.pendingNotifications.push(notification);
    }

    this.emit('notification_queued', notification);
  }

  private shouldThrottle(userId: string, achievement: string): boolean {
    if (!this.config.throttlingEnabled) return false;

    // Get recent notifications for this user
    const now = Date.now();
    const recentNotifications = this.pendingNotifications
      .concat(Array.from(this.batchedNotifications.values()).flat())
      .filter(n => n.userId === userId && now - n.timestamp < 60000); // Last minute

    // Throttle if user has too many recent notifications
    return recentNotifications.length >= 3;
  }

  private shouldBatch(userId: string, achievement: string): boolean {
    // Batch notifications for the same user within a short time window
    const existingBatch = this.batchedNotifications.get(userId);
    if (existingBatch && existingBatch.length > 0) {
      const latestBatch = existingBatch[existingBatch.length - 1];
      const timeDiff = Date.now() - latestBatch.timestamp;
      return timeDiff < 30000; // Batch within 30 seconds
    }
    return false;
  }

  private addToBatch(notification: NotificationEvent): void {
    const batchId = `batch_${notification.userId}_${Date.now()}`;
    notification.batchId = batchId;

    const existingBatch = this.batchedNotifications.get(notification.userId) || [];
    existingBatch.push(notification);
    this.batchedNotifications.set(notification.userId, existingBatch);
  }

  private startProcessing(): void {
    this.processingInterval = setInterval(() => {
      this.processNotifications();
    }, 1000); // Process every second
  }

  private async processNotifications(): Promise<void> {
    const now = Date.now();

    // Process individual notifications
    const toProcess = this.pendingNotifications.splice(0, Math.min(10, this.pendingNotifications.length));

    for (const notification of toProcess) {
      if (notification.throttled) {
        // Delay throttled notifications
        notification.deliveryDelay = now - notification.timestamp;
        setTimeout(() => this.deliverNotification(notification), 5000);
      } else {
        await this.deliverNotification(notification);
      }
    }

    // Process batched notifications (send batches older than 30 seconds)
    for (const [userId, batch] of this.batchedNotifications.entries()) {
      const oldestNotification = batch[0];
      if (now - oldestNotification.timestamp > 30000) {
        await this.deliverBatch(userId, batch);
        this.batchedNotifications.delete(userId);
      }
    }

    this.updateMetrics();
  }

  private async deliverNotification(notification: NotificationEvent): Promise<void> {
    try {
      const success = await this.discordClient.sendUserDM(notification.userId, {
        content: `🏆 Achievement unlocked: ${notification.achievement}`
      });

      if (!success) {
        this.metrics.discordRateLimitHits++;
        // Re-queue for later delivery
        this.pendingNotifications.unshift(notification);
      } else {
        notification.processed = true;
        this.emit('notification_delivered', notification);
      }

    } catch (error) {
      this.emit('notification_error', { notification, error });
    }
  }

  private async deliverBatch(userId: string, batch: NotificationEvent[]): Promise<void> {
    try {
      const achievements = batch.map(n => n.achievement).join(', ');
      const success = await this.discordClient.sendUserDM(userId, {
        content: `🎉 Multiple achievements unlocked: ${achievements}`
      });

      if (success) {
        batch.forEach(notification => {
          notification.processed = true;
          this.emit('notification_delivered', notification);
        });
      } else {
        this.metrics.discordRateLimitHits++;
        // Re-queue individual notifications
        this.pendingNotifications.push(...batch);
      }

    } catch (error) {
      this.emit('notification_error', { batch, error });
    }
  }

  private updateMetrics(): void {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Calculate notifications per second
    const recentNotifications = this.metrics.totalNotifications; // This would be more complex in real implementation

    // Update user experience score based on throttling and delays
    const throttleRatio = this.metrics.throttledNotifications / this.metrics.totalNotifications;
    this.metrics.userExperienceScore = Math.max(0, 100 - (throttleRatio * 50));

    // Update system stability score based on rate limit hits
    const rateLimitRatio = this.metrics.discordRateLimitHits / Math.max(1, this.metrics.totalNotifications);
    this.metrics.systemStabilityScore = Math.max(0, 100 - (rateLimitRatio * 100));
  }

  getMetrics(): ViralTestMetrics {
    return { ...this.metrics };
  }

  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  getPendingCount(): number {
    return this.pendingNotifications.length +
           Array.from(this.batchedNotifications.values()).reduce((sum, batch) => sum + batch.length, 0);
  }
}

// Main Viral Notification Test Suite
class ViralNotificationTestSuite {
  private config: ViralTestConfig;
  private mockClient: MockDiscordClientWithRateLimits;
  private throttler: SmartNotificationThrottler;
  private testResults: any[] = [];

  constructor(config: Partial<ViralTestConfig> = {}) {
    this.config = {
      peakConcurrentUsers: 1000,
      burstDurationSeconds: 60,
      normalOperatingUsers: 100,
      achievementTypes: ['First Tip', 'Win Streak', 'High Roller', 'Community Hero', 'Daily Player'],
      notificationChannels: 5,
      rateLimitThreshold: 50,
      throttlingEnabled: true,
      ...config
    };

    this.mockClient = new MockDiscordClientWithRateLimits();
    this.throttler = new SmartNotificationThrottler(this.config, this.mockClient);
  }

  async runViralMomentSimulations(): Promise<any[]> {
    console.log('🔥 Starting viral moment simulations...');

    const tests = [
      () => this.testMegaViralMoment(),
      () => this.testSustainedViralActivity(),
      () => this.testChannelOverloadProtection(),
      () => this.testMilestoneAchievementCelebration(),
      () => this.testConcurrentAchievementUnlocks(),
      () => this.testRecoveryAfterViralMoment()
    ];

    for (const test of tests) {
      try {
        const result = await test();
        this.testResults.push(result);
      } catch (error) {
        this.testResults.push({
          testName: test.name,
          success: false,
          error: String(error)
        });
      }
    }

    return this.testResults;
  }

  // Test 1: Mega Viral Moment (1000+ users unlock same achievement within 30 seconds)
  async testMegaViralMoment(): Promise<any> {
    const testName = 'Mega Viral Moment';
    const startTime = performance.now();

    console.log(`📊 Testing ${testName}...`);

    this.mockClient.clearStats();
    const initialMetrics = this.throttler.getMetrics();

    // Simulate 1000 users unlocking "First Tip" achievement simultaneously
    const users = Array.from({ length: 1000 }, (_, i) => `viral-user-${i}`);
    const achievement = 'First Tip Sent! 💰';

    // Create burst of notifications over 30 seconds
    const promises = users.map((userId, index) => {
      const delay = Math.random() * 30000; // Random delay up to 30 seconds
      return new Promise(resolve => {
        setTimeout(() => {
          this.throttler.queueNotification(userId, achievement, 'tip');
          resolve(userId);
        }, delay);
      });
    });

    await Promise.all(promises);

    // Wait for processing to complete
    await this.waitForProcessingComplete(60000); // Wait up to 1 minute

    const finalMetrics = this.throttler.getMetrics();
    const rateLimitStats = this.mockClient.getRateLimitStats();
    const duration = performance.now() - startTime;

    const result = {
      testName,
      success: true,
      duration,
      metrics: {
        usersSimulated: users.length,
        totalNotifications: finalMetrics.totalNotifications - initialMetrics.totalNotifications,
        throttledNotifications: finalMetrics.throttledNotifications - initialMetrics.throttledNotifications,
        batchedNotifications: finalMetrics.batchedNotifications - initialMetrics.batchedNotifications,
        rateLimitHits: finalMetrics.discordRateLimitHits - initialMetrics.discordRateLimitHits,
        userExperienceScore: finalMetrics.userExperienceScore,
        systemStabilityScore: finalMetrics.systemStabilityScore,
        discordRequests: rateLimitStats.totalRequests
      },
      passed: finalMetrics.systemStabilityScore > 85 && finalMetrics.userExperienceScore > 70
    };

    console.log(`${result.passed ? '✅' : '❌'} ${testName}: ${result.passed ? 'PASSED' : 'FAILED'}`);
    return result;
  }

  // Test 2: Sustained Viral Activity (High volume over extended period)
  async testSustainedViralActivity(): Promise<any> {
    const testName = 'Sustained Viral Activity';
    const startTime = performance.now();

    console.log(`📊 Testing ${testName}...`);

    this.mockClient.clearStats();
    const initialMetrics = this.throttler.getMetrics();

    // Simulate sustained high activity for 5 minutes
    const duration = 5 * 60 * 1000; // 5 minutes
    const endTime = Date.now() + duration;
    let userCounter = 0;

    const simulateActivity = async () => {
      while (Date.now() < endTime) {
        // Generate 10-20 notifications per second
        const batchSize = 10 + Math.floor(Math.random() * 10);

        for (let i = 0; i < batchSize; i++) {
          const userId = `sustained-user-${userCounter++}`;
          const achievement = this.config.achievementTypes[Math.floor(Math.random() * this.config.achievementTypes.length)];
          this.throttler.queueNotification(userId, achievement, 'sustained');
        }

        // Wait 1 second before next batch
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    };

    await simulateActivity();
    await this.waitForProcessingComplete(30000); // Wait for processing

    const finalMetrics = this.throttler.getMetrics();
    const rateLimitStats = this.mockClient.getRateLimitStats();
    const testDuration = performance.now() - startTime;

    const result = {
      testName,
      success: true,
      duration: testDuration,
      metrics: {
        simulatedUsers: userCounter,
        totalNotifications: finalMetrics.totalNotifications - initialMetrics.totalNotifications,
        throttledNotifications: finalMetrics.throttledNotifications - initialMetrics.throttledNotifications,
        averageNotificationsPerSecond: (finalMetrics.totalNotifications - initialMetrics.totalNotifications) / (duration / 1000),
        rateLimitHits: finalMetrics.discordRateLimitHits - initialMetrics.discordRateLimitHits,
        systemStabilityScore: finalMetrics.systemStabilityScore
      },
      passed: finalMetrics.systemStabilityScore > 80
    };

    console.log(`${result.passed ? '✅' : '❌'} ${testName}: ${result.passed ? 'PASSED' : 'FAILED'}`);
    return result;
  }

  // Test 3: Channel Overload Protection
  async testChannelOverloadProtection(): Promise<any> {
    const testName = 'Channel Overload Protection';
    const startTime = performance.now();

    console.log(`📊 Testing ${testName}...`);

    this.mockClient.clearStats();

    // Simulate rapid channel messages (announcements, milestones)
    const channels = ['general', 'achievements', 'announcements', 'events', 'milestones'];
    const messages = 100;

    const sendPromises = [];
    for (let i = 0; i < messages; i++) {
      const channel = channels[i % channels.length];
      const promise = this.mockClient.sendChannelMessage(channel, {
        content: `🎉 Achievement milestone reached! #${i + 1}`
      });
      sendPromises.push(promise);

      // Small delay to simulate real timing
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const results = await Promise.all(sendPromises);
    const successfulMessages = results.filter(r => r).length;
    const rateLimitStats = this.mockClient.getRateLimitStats();
    const duration = performance.now() - startTime;

    const result = {
      testName,
      success: true,
      duration,
      metrics: {
        attemptedMessages: messages,
        successfulMessages,
        rateLimitedMessages: messages - successfulMessages,
        successRate: (successfulMessages / messages) * 100,
        totalRequests: rateLimitStats.totalRequests
      },
      passed: successfulMessages >= messages * 0.8 // At least 80% success rate
    };

    console.log(`${result.passed ? '✅' : '❌'} ${testName}: ${result.passed ? 'PASSED' : 'FAILED'}`);
    return result;
  }

  // Test 4: Milestone Achievement Celebration
  async testMilestoneAchievementCelebration(): Promise<any> {
    const testName = 'Milestone Achievement Celebration';
    const startTime = performance.now();

    console.log(`📊 Testing ${testName}...`);

    this.mockClient.clearStats();
    const initialMetrics = this.throttler.getMetrics();

    // Simulate milestone events (server-wide celebrations)
    const milestones = [
      { type: 'community', users: 50, achievement: '🎊 Server reached 10,000 tips!' },
      { type: 'individual', users: 100, achievement: '🏆 100 Win Streak Achievement!' },
      { type: 'rare', users: 25, achievement: '💎 Legendary Achievement Unlocked!' }
    ];

    for (const milestone of milestones) {
      const users = Array.from({ length: milestone.users }, (_, i) => `milestone-${milestone.type}-${i}`);

      // All users unlock the milestone achievement within 10 seconds
      const promises = users.map((userId, index) => {
        const delay = Math.random() * 10000; // Up to 10 seconds
        return new Promise(resolve => {
          setTimeout(() => {
            this.throttler.queueNotification(userId, milestone.achievement, milestone.type);
            resolve(userId);
          }, delay);
        });
      });

      await Promise.all(promises);

      // Small pause between different milestone types
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    await this.waitForProcessingComplete(60000);

    const finalMetrics = this.throttler.getMetrics();
    const duration = performance.now() - startTime;

    const totalExpectedNotifications = milestones.reduce((sum, m) => sum + m.users, 0);
    const actualNotifications = finalMetrics.totalNotifications - initialMetrics.totalNotifications;

    const result = {
      testName,
      success: true,
      duration,
      metrics: {
        milestonesToested: milestones.length,
        expectedNotifications: totalExpectedNotifications,
        actualNotifications,
        throttledNotifications: finalMetrics.throttledNotifications - initialMetrics.throttledNotifications,
        batchedNotifications: finalMetrics.batchedNotifications - initialMetrics.batchedNotifications,
        userExperienceScore: finalMetrics.userExperienceScore,
        systemStabilityScore: finalMetrics.systemStabilityScore
      },
      passed: finalMetrics.systemStabilityScore > 85 &&
              finalMetrics.userExperienceScore > 75 &&
              actualNotifications >= totalExpectedNotifications * 0.95
    };

    console.log(`${result.passed ? '✅' : '❌'} ${testName}: ${result.passed ? 'PASSED' : 'FAILED'}`);
    return result;
  }

  // Test 5: Concurrent Achievement Unlocks (Different achievements simultaneously)
  async testConcurrentAchievementUnlocks(): Promise<any> {
    const testName = 'Concurrent Achievement Unlocks';
    const startTime = performance.now();

    console.log(`📊 Testing ${testName}...`);

    this.mockClient.clearStats();
    const initialMetrics = this.throttler.getMetrics();

    // Simulate different achievement types unlocking concurrently
    const concurrentScenarios = [
      { users: 200, achievement: 'Daily Login Streak!', context: 'daily' },
      { users: 150, achievement: 'Big Tipper Achievement!', context: 'tip' },
      { users: 100, achievement: 'Match Winner!', context: 'match' },
      { users: 75, achievement: 'Community Builder!', context: 'referral' },
      { users: 50, achievement: 'High Roller!', context: 'deposit' }
    ];

    // Start all scenarios simultaneously
    const scenarioPromises = concurrentScenarios.map(async (scenario, scenarioIndex) => {
      const users = Array.from({ length: scenario.users }, (_, i) => `concurrent-${scenarioIndex}-${i}`);

      const userPromises = users.map((userId, userIndex) => {
        const delay = Math.random() * 45000; // Up to 45 seconds
        return new Promise(resolve => {
          setTimeout(() => {
            this.throttler.queueNotification(userId, scenario.achievement, scenario.context);
            resolve(userId);
          }, delay);
        });
      });

      return Promise.all(userPromises);
    });

    await Promise.all(scenarioPromises);
    await this.waitForProcessingComplete(90000); // Wait up to 90 seconds

    const finalMetrics = this.throttler.getMetrics();
    const duration = performance.now() - startTime;

    const totalExpectedNotifications = concurrentScenarios.reduce((sum, s) => sum + s.users, 0);
    const actualNotifications = finalMetrics.totalNotifications - initialMetrics.totalNotifications;

    const result = {
      testName,
      success: true,
      duration,
      metrics: {
        scenariosTested: concurrentScenarios.length,
        expectedNotifications: totalExpectedNotifications,
        actualNotifications,
        throttledNotifications: finalMetrics.throttledNotifications - initialMetrics.throttledNotifications,
        batchedNotifications: finalMetrics.batchedNotifications - initialMetrics.batchedNotifications,
        rateLimitHits: finalMetrics.discordRateLimitHits - initialMetrics.discordRateLimitHits,
        systemStabilityScore: finalMetrics.systemStabilityScore,
        userExperienceScore: finalMetrics.userExperienceScore
      },
      passed: finalMetrics.systemStabilityScore > 80 &&
              actualNotifications >= totalExpectedNotifications * 0.9
    };

    console.log(`${result.passed ? '✅' : '❌'} ${testName}: ${result.passed ? 'PASSED' : 'FAILED'}`);
    return result;
  }

  // Test 6: Recovery After Viral Moment
  async testRecoveryAfterViralMoment(): Promise<any> {
    const testName = 'Recovery After Viral Moment';
    const startTime = performance.now();

    console.log(`📊 Testing ${testName}...`);

    // Phase 1: Create a viral moment
    const viralUsers = 500;
    const viralAchievement = 'Viral Moment Achievement! 🚀';

    console.log('  Creating viral moment...');
    for (let i = 0; i < viralUsers; i++) {
      this.throttler.queueNotification(`recovery-viral-${i}`, viralAchievement, 'viral');
    }

    // Wait a bit for the system to be overwhelmed
    await new Promise(resolve => setTimeout(resolve, 10000));

    const viralMetrics = this.throttler.getMetrics();
    const pendingAfterViral = this.throttler.getPendingCount();

    // Phase 2: Return to normal operation
    console.log('  Testing recovery to normal operation...');
    const normalUsers = 20;
    const normalAchievement = 'Normal Achievement';

    const recoveryStart = performance.now();

    for (let i = 0; i < normalUsers; i++) {
      this.throttler.queueNotification(`recovery-normal-${i}`, normalAchievement, 'normal');
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second between normal notifications
    }

    // Wait for system to recover
    await this.waitForProcessingComplete(120000); // Up to 2 minutes

    const recoveryEnd = performance.now();
    const finalMetrics = this.throttler.getMetrics();
    const pendingAfterRecovery = this.throttler.getPendingCount();

    const recoveryTime = recoveryEnd - recoveryStart;
    const systemRecovered = pendingAfterRecovery < pendingAfterViral * 0.1; // 90% reduction in pending
    const normalOperationMaintained = finalMetrics.systemStabilityScore > 85;

    const result = {
      testName,
      success: true,
      duration: performance.now() - startTime,
      metrics: {
        viralUsers,
        normalUsers,
        pendingAfterViral,
        pendingAfterRecovery,
        recoveryTime,
        systemStabilityBeforeRecovery: viralMetrics.systemStabilityScore,
        systemStabilityAfterRecovery: finalMetrics.systemStabilityScore,
        recoveryEfficiency: ((pendingAfterViral - pendingAfterRecovery) / pendingAfterViral) * 100
      },
      passed: systemRecovered && normalOperationMaintained && recoveryTime < 60000
    };

    console.log(`${result.passed ? '✅' : '❌'} ${testName}: ${result.passed ? 'PASSED' : 'FAILED'}`);
    return result;
  }

  // Helper method to wait for processing to complete
  private async waitForProcessingComplete(maxWaitMs: number): Promise<void> {
    const startWait = Date.now();
    let lastPendingCount = this.throttler.getPendingCount();
    let stableCount = 0;

    while (Date.now() - startWait < maxWaitMs) {
      const currentPendingCount = this.throttler.getPendingCount();

      if (currentPendingCount === lastPendingCount) {
        stableCount++;
        // If count has been stable for 5 seconds, consider processing complete
        if (stableCount >= 5) {
          break;
        }
      } else {
        stableCount = 0;
        lastPendingCount = currentPendingCount;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Generate comprehensive report
  async generateViralTestReport(): Promise<void> {
    const reportData = {
      testSuite: 'Viral Notification Test Results',
      timestamp: new Date().toISOString(),
      configuration: this.config,
      testResults: this.testResults,
      summary: {
        totalTests: this.testResults.length,
        passedTests: this.testResults.filter(r => r.passed).length,
        failedTests: this.testResults.filter(r => !r.passed).length,
        overallSuccess: this.testResults.every(r => r.passed)
      },
      finalMetrics: this.throttler.getMetrics(),
      discordStats: this.mockClient.getRateLimitStats()
    };

    // Save JSON report
    const jsonPath = join('./tests/results', `viral_notification_test_${Date.now()}.json`);
    writeFileSync(jsonPath, JSON.stringify(reportData, null, 2));

    // Generate markdown summary
    const markdownReport = this.generateMarkdownSummary(reportData);
    const mdPath = join('./tests/results', `viral_notification_summary_${Date.now()}.md`);
    writeFileSync(mdPath, markdownReport);

    console.log(`📊 Viral notification test reports saved:`);
    console.log(`   - JSON: ${jsonPath}`);
    console.log(`   - Summary: ${mdPath}`);
  }

  private generateMarkdownSummary(reportData: any): string {
    return `# Viral Notification Test Results

## Test Configuration
- **Peak Concurrent Users**: ${this.config.peakConcurrentUsers}
- **Burst Duration**: ${this.config.burstDurationSeconds} seconds
- **Throttling Enabled**: ${this.config.throttlingEnabled}
- **Rate Limit Threshold**: ${this.config.rateLimitThreshold}/second

## Summary
- **Total Tests**: ${reportData.summary.totalTests}
- **Passed**: ${reportData.summary.passedTests}
- **Failed**: ${reportData.summary.failedTests}
- **Overall Success**: ${reportData.summary.overallSuccess ? '✅' : '❌'}

## Final System Metrics
- **Total Notifications**: ${reportData.finalMetrics.totalNotifications}
- **Throttled Notifications**: ${reportData.finalMetrics.throttledNotifications}
- **Batched Notifications**: ${reportData.finalMetrics.batchedNotifications}
- **Discord Rate Limit Hits**: ${reportData.finalMetrics.discordRateLimitHits}
- **User Experience Score**: ${reportData.finalMetrics.userExperienceScore}/100
- **System Stability Score**: ${reportData.finalMetrics.systemStabilityScore}/100

## Test Results
${reportData.testResults.map((result: any) => `
### ${result.testName}
- **Status**: ${result.passed ? '✅ PASSED' : '❌ FAILED'}
- **Duration**: ${(result.duration / 1000).toFixed(2)}s
- **Key Metrics**: ${JSON.stringify(result.metrics, null, 2)}
`).join('\n')}

## Recommendations
${this.generateRecommendations(reportData)}
`;
  }

  private generateRecommendations(reportData: any): string {
    const recommendations = [];
    const metrics = reportData.finalMetrics;

    if (metrics.userExperienceScore < 80) {
      recommendations.push('- **User Experience**: Consider reducing throttling aggressiveness');
    }

    if (metrics.systemStabilityScore < 85) {
      recommendations.push('- **System Stability**: Improve rate limit handling and backoff strategies');
    }

    if (metrics.discordRateLimitHits > 50) {
      recommendations.push('- **Rate Limiting**: Implement more conservative request pacing');
    }

    const throttleRatio = metrics.throttledNotifications / metrics.totalNotifications;
    if (throttleRatio > 0.3) {
      recommendations.push('- **Throttling**: High throttle rate may impact user satisfaction');
    }

    const batchRatio = metrics.batchedNotifications / metrics.totalNotifications;
    if (batchRatio < 0.2) {
      recommendations.push('- **Batching**: Consider more aggressive batching for viral moments');
    }

    return recommendations.length > 0 ? recommendations.join('\n') : '- All metrics are within acceptable ranges ✅';
  }

  cleanup(): void {
    this.throttler.stop();
  }
}

// Main execution
if (isMainThread) {
  const config: Partial<ViralTestConfig> = {
    peakConcurrentUsers: parseInt(process.env.VIRAL_TEST_USERS || '1000'),
    burstDurationSeconds: parseInt(process.env.VIRAL_TEST_DURATION || '60'),
    throttlingEnabled: process.env.VIRAL_TEST_THROTTLING !== 'false'
  };

  const testSuite = new ViralNotificationTestSuite(config);

  console.log('🚀 Starting Viral Notification Test Suite');

  testSuite.runViralMomentSimulations()
    .then(async (results) => {
      await testSuite.generateViralTestReport();

      const passedTests = results.filter(r => r.passed).length;
      const totalTests = results.length;

      console.log(`\n🎉 Viral notification tests completed!`);
      console.log(`📊 Results: ${passedTests}/${totalTests} tests passed`);

      testSuite.cleanup();
      process.exit(passedTests === totalTests ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Viral notification test suite failed:', error);
      testSuite.cleanup();
      process.exit(1);
    });
}

export { ViralNotificationTestSuite, ViralTestConfig };