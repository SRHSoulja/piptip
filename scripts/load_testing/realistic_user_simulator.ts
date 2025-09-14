#!/usr/bin/env npx tsx
// scripts/load_testing/realistic_user_simulator.ts - Realistic user behavior patterns for achievement load testing

import { prisma } from '../../src/services/db.js';
import { processAchievementEvent } from '../../src/services/dynamic_achievements.js';
import { performance } from 'perf_hooks';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

interface UserProfile {
  id: number;
  discordId: string;
  behavior: 'casual' | 'active' | 'power_user' | 'whale';
  achievementHunter: boolean;
  activityPattern: 'morning' | 'afternoon' | 'evening' | 'night_owl';
  sessionLength: 'short' | 'medium' | 'long';
}

interface SimulationConfig {
  totalUsers: number;
  simulationDurationMinutes: number;
  realTimeSpeed: number; // 1.0 = real time, 10.0 = 10x faster
  userDistribution: {
    casual: number;        // 60% - occasional users
    active: number;        // 30% - regular users
    power_user: number;    // 8% - heavy users
    whale: number;         // 2% - top spenders
  };
  achievementHunterRate: number; // 20% of users actively hunt achievements
  outputDir: string;
}

interface UserAction {
  userId: number;
  timestamp: number;
  action: 'tip' | 'match' | 'deposit' | 'referral' | 'idle';
  details: any;
  expectedAchievements?: string[];
}

interface SimulationMetrics {
  totalActions: number;
  actionsPerSecond: number;
  achievementChecks: number;
  achievementUnlocks: number;
  responseTimeStats: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  userBehaviorStats: Record<string, {
    actionCount: number;
    averageResponseTime: number;
    achievementUnlocks: number;
  }>;
  errorCount: number;
  errors: Array<{ timestamp: number; userId: number; error: string }>;
}

class RealisticUserSimulator {
  private config: SimulationConfig;
  private users: UserProfile[] = [];
  private metrics: SimulationMetrics;
  private actionLog: UserAction[] = [];
  private responseTimes: number[] = [];
  private startTime: number = 0;
  private isRunning = false;

  private readonly DEFAULT_CONFIG: SimulationConfig = {
    totalUsers: 1000,
    simulationDurationMinutes: 10,
    realTimeSpeed: 10.0, // 10x faster than real time
    userDistribution: {
      casual: 0.60,      // 60% casual users
      active: 0.30,      // 30% active users
      power_user: 0.08,  // 8% power users
      whale: 0.02        // 2% whales
    },
    achievementHunterRate: 0.20, // 20% actively hunt achievements
    outputDir: './load_test_results'
  };

  constructor(config?: Partial<SimulationConfig>) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.initializeMetrics();
    this.ensureOutputDirectory();
  }

  private initializeMetrics(): void {
    this.metrics = {
      totalActions: 0,
      actionsPerSecond: 0,
      achievementChecks: 0,
      achievementUnlocks: 0,
      responseTimeStats: {
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0
      },
      userBehaviorStats: {},
      errorCount: 0,
      errors: []
    };
  }

  private ensureOutputDirectory(): void {
    if (!existsSync(this.config.outputDir)) {
      mkdirSync(this.config.outputDir, { recursive: true });
    }
  }

  async runSimulation(): Promise<SimulationMetrics> {
    console.log('🎮 Starting realistic user behavior simulation...');
    console.log(`👥 Simulating ${this.config.totalUsers} users for ${this.config.simulationDurationMinutes} minutes`);
    console.log(`⚡ Speed: ${this.config.realTimeSpeed}x real-time`);

    this.startTime = Date.now();
    this.isRunning = true;

    try {
      // Phase 1: Generate user profiles
      await this.generateUserProfiles();

      // Phase 2: Create test users in database
      await this.createTestUsers();

      // Phase 3: Run behavior simulation
      await this.simulateUserBehavior();

      // Phase 4: Analyze results
      await this.analyzeResults();

      // Phase 5: Generate reports
      await this.generateReports();

      return this.metrics;

    } finally {
      this.isRunning = false;
      await this.cleanup();
    }
  }

  private async generateUserProfiles(): Promise<void> {
    console.log('👤 Generating user profiles...');

    const behaviorTypes = Object.keys(this.config.userDistribution) as Array<keyof typeof this.config.userDistribution>;
    let userIndex = 0;

    for (const behavior of behaviorTypes) {
      const count = Math.floor(this.config.totalUsers * this.config.userDistribution[behavior]);

      for (let i = 0; i < count; i++) {
        userIndex++;

        const profile: UserProfile = {
          id: userIndex,
          discordId: `simulation_user_${userIndex}`,
          behavior,
          achievementHunter: Math.random() < this.config.achievementHunterRate,
          activityPattern: this.getRandomActivityPattern(),
          sessionLength: this.getSessionLength(behavior)
        };

        this.users.push(profile);
      }
    }

    console.log(`✅ Generated ${this.users.length} user profiles`);
    console.log(`   - Casual: ${this.users.filter(u => u.behavior === 'casual').length}`);
    console.log(`   - Active: ${this.users.filter(u => u.behavior === 'active').length}`);
    console.log(`   - Power Users: ${this.users.filter(u => u.behavior === 'power_user').length}`);
    console.log(`   - Whales: ${this.users.filter(u => u.behavior === 'whale').length}`);
    console.log(`   - Achievement Hunters: ${this.users.filter(u => u.achievementHunter).length}`);
  }

  private getRandomActivityPattern(): UserProfile['activityPattern'] {
    const patterns: UserProfile['activityPattern'][] = ['morning', 'afternoon', 'evening', 'night_owl'];
    const weights = [0.15, 0.25, 0.45, 0.15]; // Evening most popular
    const random = Math.random();

    let cumulative = 0;
    for (let i = 0; i < patterns.length; i++) {
      cumulative += weights[i];
      if (random < cumulative) return patterns[i];
    }

    return 'evening';
  }

  private getSessionLength(behavior: UserProfile['behavior']): UserProfile['sessionLength'] {
    switch (behavior) {
      case 'casual': return Math.random() < 0.8 ? 'short' : 'medium';
      case 'active': return Math.random() < 0.4 ? 'short' : Math.random() < 0.8 ? 'medium' : 'long';
      case 'power_user': return Math.random() < 0.2 ? 'medium' : 'long';
      case 'whale': return Math.random() < 0.1 ? 'medium' : 'long';
      default: return 'medium';
    }
  }

  private async createTestUsers(): Promise<void> {
    console.log('🔧 Creating test users in database...');

    const batchSize = 100;
    let created = 0;

    for (let i = 0; i < this.users.length; i += batchSize) {
      const batch = this.users.slice(i, i + batchSize);

      const userData = batch.map(user => ({
        discordId: user.discordId,
        agwAddress: `0x${Math.random().toString(16).substr(2, 40)}`, // Fake address
        wins: 0,
        losses: 0,
        ties: 0
      }));

      try {
        const result = await prisma.user.createMany({
          data: userData,
          skipDuplicates: true
        });

        created += result.count;

        // Update user IDs with database IDs
        const dbUsers = await prisma.user.findMany({
          where: {
            discordId: { in: batch.map(u => u.discordId) }
          },
          select: { id: true, discordId: true }
        });

        for (const dbUser of dbUsers) {
          const profileUser = this.users.find(u => u.discordId === dbUser.discordId);
          if (profileUser) {
            profileUser.id = dbUser.id;
          }
        }

      } catch (error) {
        console.error('Error creating user batch:', error);
      }
    }

    console.log(`✅ Created ${created} test users in database`);
  }

  private async simulateUserBehavior(): Promise<void> {
    console.log('🎭 Simulating user behavior patterns...');

    const simulationTimeMs = this.config.simulationDurationMinutes * 60 * 1000;
    const speedAdjustedTimeMs = simulationTimeMs / this.config.realTimeSpeed;
    const endTime = Date.now() + speedAdjustedTimeMs;

    // Track concurrent user sessions
    const activeSessions = new Map<number, { startTime: number; nextActionTime: number }>();

    while (Date.now() < endTime && this.isRunning) {
      const currentTime = Date.now();

      // Start new sessions for users based on their activity patterns
      for (const user of this.users) {
        if (activeSessions.has(user.id)) continue;

        if (this.shouldStartSession(user, currentTime)) {
          activeSessions.set(user.id, {
            startTime: currentTime,
            nextActionTime: currentTime
          });
        }
      }

      // Process actions for active sessions
      const activeUsers = Array.from(activeSessions.entries());
      const userActions: Promise<void>[] = [];

      for (const [userId, session] of activeUsers) {
        if (currentTime >= session.nextActionTime) {
          const user = this.users.find(u => u.id === userId)!;

          // Execute user action asynchronously
          const actionPromise = this.executeUserAction(user, currentTime)
            .then((nextActionDelay) => {
              if (nextActionDelay > 0) {
                session.nextActionTime = currentTime + (nextActionDelay / this.config.realTimeSpeed);
              } else {
                // End session
                activeSessions.delete(userId);
              }
            })
            .catch((error) => {
              console.error(`Error executing action for user ${userId}:`, error);
              this.metrics.errorCount++;
              this.metrics.errors.push({
                timestamp: currentTime,
                userId,
                error: String(error)
              });
              // End session on error
              activeSessions.delete(userId);
            });

          userActions.push(actionPromise);
        }
      }

      // Wait for batch of user actions to complete
      if (userActions.length > 0) {
        await Promise.allSettled(userActions);
      }

      // Brief pause to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 10));

      // Progress update every 30 seconds
      if (Math.floor((currentTime - this.startTime) / 30000) > Math.floor((currentTime - this.startTime - 10) / 30000)) {
        const elapsed = (currentTime - this.startTime) / 1000;
        const progress = (elapsed / (speedAdjustedTimeMs / 1000)) * 100;
        console.log(`📊 Progress: ${progress.toFixed(1)}% | Active sessions: ${activeSessions.size} | Actions: ${this.metrics.totalActions}`);
      }
    }

    console.log(`✅ Simulation completed with ${this.metrics.totalActions} total actions`);
  }

  private shouldStartSession(user: UserProfile, currentTime: number): boolean {
    // Simulate realistic session start probability based on user behavior
    const hourOfDay = new Date(currentTime).getHours();
    let baseChance = 0;

    // Activity pattern influence
    switch (user.activityPattern) {
      case 'morning': baseChance = hourOfDay >= 6 && hourOfDay <= 11 ? 0.3 : 0.05; break;
      case 'afternoon': baseChance = hourOfDay >= 12 && hourOfDay <= 17 ? 0.4 : 0.05; break;
      case 'evening': baseChance = hourOfDay >= 18 && hourOfDay <= 23 ? 0.5 : 0.05; break;
      case 'night_owl': baseChance = (hourOfDay >= 22 || hourOfDay <= 2) ? 0.4 : 0.05; break;
    }

    // Behavior type multiplier
    switch (user.behavior) {
      case 'casual': baseChance *= 0.3; break;
      case 'active': baseChance *= 1.0; break;
      case 'power_user': baseChance *= 2.0; break;
      case 'whale': baseChance *= 3.0; break;
    }

    // Achievement hunters are more likely to start sessions
    if (user.achievementHunter) {
      baseChance *= 1.5;
    }

    // Very low base chance per check
    return Math.random() < baseChance * 0.001;
  }

  private async executeUserAction(user: UserProfile, currentTime: number): Promise<number> {
    const actionType = this.selectUserAction(user);
    const actionStartTime = performance.now();

    try {
      let actionDetails: any = {};
      let nextActionDelay = 0;

      switch (actionType) {
        case 'tip':
          actionDetails = await this.simulateTipAction(user);
          nextActionDelay = this.getNextActionDelay(user, 'tip');
          break;

        case 'match':
          actionDetails = await this.simulateMatchAction(user);
          nextActionDelay = this.getNextActionDelay(user, 'match');
          break;

        case 'deposit':
          actionDetails = await this.simulateDepositAction(user);
          nextActionDelay = this.getNextActionDelay(user, 'deposit');
          break;

        case 'referral':
          actionDetails = await this.simulateReferralAction(user);
          nextActionDelay = this.getNextActionDelay(user, 'referral');
          break;

        case 'idle':
          // User is idle, continue session
          nextActionDelay = this.getNextActionDelay(user, 'idle');
          break;

        default:
          nextActionDelay = 0; // End session
          break;
      }

      if (actionType !== 'idle') {
        // Process achievement events
        const achievementResults = await processAchievementEvent(user.id, actionType, actionDetails);
        this.metrics.achievementChecks++;

        if (achievementResults.length > 0) {
          this.metrics.achievementUnlocks += achievementResults.length;
          actionDetails.achievementsUnlocked = achievementResults;
        }
      }

      const actionDuration = performance.now() - actionStartTime;
      this.responseTimes.push(actionDuration);

      // Log action
      this.actionLog.push({
        userId: user.id,
        timestamp: currentTime,
        action: actionType,
        details: actionDetails,
        expectedAchievements: actionDetails.achievementsUnlocked
      });

      this.metrics.totalActions++;

      // Update user behavior stats
      if (!this.metrics.userBehaviorStats[user.behavior]) {
        this.metrics.userBehaviorStats[user.behavior] = {
          actionCount: 0,
          averageResponseTime: 0,
          achievementUnlocks: 0
        };
      }

      const behaviorStats = this.metrics.userBehaviorStats[user.behavior];
      behaviorStats.actionCount++;
      behaviorStats.averageResponseTime = ((behaviorStats.averageResponseTime * (behaviorStats.actionCount - 1)) + actionDuration) / behaviorStats.actionCount;
      if (actionDetails.achievementsUnlocked) {
        behaviorStats.achievementUnlocks += actionDetails.achievementsUnlocked.length;
      }

      return nextActionDelay;

    } catch (error) {
      const actionDuration = performance.now() - actionStartTime;
      this.responseTimes.push(actionDuration);

      this.metrics.errorCount++;
      this.metrics.errors.push({
        timestamp: currentTime,
        userId: user.id,
        error: String(error)
      });

      return 0; // End session on error
    }
  }

  private selectUserAction(user: UserProfile): UserAction['action'] {
    // Action probabilities based on user behavior
    const probabilities: Record<UserProfile['behavior'], Record<UserAction['action'], number>> = {
      casual: { tip: 0.4, match: 0.2, deposit: 0.1, referral: 0.05, idle: 0.25 },
      active: { tip: 0.35, match: 0.3, deposit: 0.15, referral: 0.1, idle: 0.1 },
      power_user: { tip: 0.3, match: 0.4, deposit: 0.2, referral: 0.05, idle: 0.05 },
      whale: { tip: 0.25, match: 0.35, deposit: 0.35, referral: 0.03, idle: 0.02 }
    };

    const userProbabilities = probabilities[user.behavior];
    const random = Math.random();
    let cumulative = 0;

    for (const [action, probability] of Object.entries(userProbabilities)) {
      cumulative += probability;
      if (random < cumulative) {
        return action as UserAction['action'];
      }
    }

    return 'idle';
  }

  private async simulateTipAction(user: UserProfile): Promise<any> {
    // Simulate creating a tip (don't actually create in DB for load testing)
    const amount = this.generateTipAmount(user);
    const tokenId = Math.floor(Math.random() * 3) + 1; // Random token

    return {
      action: 'tip',
      amount,
      tokenId,
      recipient: `random_user_${Math.floor(Math.random() * 1000)}`
    };
  }

  private generateTipAmount(user: UserProfile): number {
    switch (user.behavior) {
      case 'casual': return 1 + Math.random() * 9; // 1-10
      case 'active': return 5 + Math.random() * 45; // 5-50
      case 'power_user': return 10 + Math.random() * 190; // 10-200
      case 'whale': return 50 + Math.random() * 950; // 50-1000
      default: return 10;
    }
  }

  private async simulateMatchAction(user: UserProfile): Promise<any> {
    const outcomes = ['win', 'lose', 'tie'];
    const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];

    return {
      action: 'match',
      outcome,
      wager: this.generateTipAmount(user) / 2
    };
  }

  private async simulateDepositAction(user: UserProfile): Promise<any> {
    const amount = this.generateTipAmount(user) * 10; // Deposits are larger

    return {
      action: 'deposit',
      amount,
      tokenId: Math.floor(Math.random() * 3) + 1
    };
  }

  private async simulateReferralAction(user: UserProfile): Promise<any> {
    return {
      action: 'referral',
      referredUser: `referred_user_${Math.floor(Math.random() * 10000)}`
    };
  }

  private getNextActionDelay(user: UserProfile, lastAction: UserAction['action']): number {
    let baseDelay = 0;

    // Base delays by action type (in milliseconds)
    const actionDelays = {
      tip: 30000,      // 30 seconds between tips
      match: 120000,   // 2 minutes between matches
      deposit: 300000, // 5 minutes between deposits
      referral: 600000, // 10 minutes between referrals
      idle: 10000      // 10 seconds idle
    };

    baseDelay = actionDelays[lastAction];

    // Adjust by user behavior
    switch (user.behavior) {
      case 'casual': baseDelay *= 2.0; break;
      case 'active': baseDelay *= 1.0; break;
      case 'power_user': baseDelay *= 0.6; break;
      case 'whale': baseDelay *= 0.3; break;
    }

    // Achievement hunters act more frequently
    if (user.achievementHunter) {
      baseDelay *= 0.8;
    }

    // Add randomness
    const randomFactor = 0.5 + Math.random(); // 0.5x to 1.5x
    baseDelay *= randomFactor;

    // Check if session should end based on session length preference
    const sessionDuration = this.getSessionDuration(user);
    if (Math.random() < 1 / sessionDuration) {
      return 0; // End session
    }

    return baseDelay;
  }

  private getSessionDuration(user: UserProfile): number {
    // Return number of actions in a typical session
    switch (user.sessionLength) {
      case 'short': return 2 + Math.random() * 3; // 2-5 actions
      case 'medium': return 5 + Math.random() * 10; // 5-15 actions
      case 'long': return 15 + Math.random() * 25; // 15-40 actions
      default: return 5;
    }
  }

  private async analyzeResults(): Promise<void> {
    console.log('📊 Analyzing simulation results...');

    const simulationDuration = (Date.now() - this.startTime) / 1000; // seconds
    this.metrics.actionsPerSecond = this.metrics.totalActions / simulationDuration;

    // Calculate response time statistics
    if (this.responseTimes.length > 0) {
      this.responseTimes.sort((a, b) => a - b);

      this.metrics.responseTimeStats.min = this.responseTimes[0];
      this.metrics.responseTimeStats.max = this.responseTimes[this.responseTimes.length - 1];
      this.metrics.responseTimeStats.avg = this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
      this.metrics.responseTimeStats.p50 = this.responseTimes[Math.floor(this.responseTimes.length * 0.5)];
      this.metrics.responseTimeStats.p95 = this.responseTimes[Math.floor(this.responseTimes.length * 0.95)];
      this.metrics.responseTimeStats.p99 = this.responseTimes[Math.floor(this.responseTimes.length * 0.99)];
    }

    console.log(`✅ Analysis complete:`);
    console.log(`   - Total Actions: ${this.metrics.totalActions.toLocaleString()}`);
    console.log(`   - Actions/Second: ${this.metrics.actionsPerSecond.toFixed(2)}`);
    console.log(`   - Achievement Checks: ${this.metrics.achievementChecks.toLocaleString()}`);
    console.log(`   - Achievement Unlocks: ${this.metrics.achievementUnlocks.toLocaleString()}`);
    console.log(`   - Average Response Time: ${this.metrics.responseTimeStats.avg.toFixed(2)}ms`);
    console.log(`   - 95th Percentile: ${this.metrics.responseTimeStats.p95.toFixed(2)}ms`);
    console.log(`   - Error Rate: ${((this.metrics.errorCount / this.metrics.totalActions) * 100).toFixed(2)}%`);
  }

  private async generateReports(): Promise<void> {
    const timestamp = Date.now();

    // Save detailed metrics
    const metricsPath = join(this.config.outputDir, `realistic_simulation_metrics_${timestamp}.json`);
    writeFileSync(metricsPath, JSON.stringify(this.metrics, null, 2));

    // Save action log (sample only for large datasets)
    const actionSample = this.actionLog.length > 10000
      ? this.actionLog.filter((_, i) => i % Math.ceil(this.actionLog.length / 10000) === 0)
      : this.actionLog;
    const actionsPath = join(this.config.outputDir, `realistic_simulation_actions_${timestamp}.json`);
    writeFileSync(actionsPath, JSON.stringify(actionSample, null, 2));

    // Generate summary report
    const summaryPath = join(this.config.outputDir, `realistic_simulation_summary_${timestamp}.md`);
    const summary = this.generateSummaryReport();
    writeFileSync(summaryPath, summary);

    console.log(`📄 Reports generated:`);
    console.log(`   - Metrics: ${metricsPath}`);
    console.log(`   - Actions: ${actionsPath}`);
    console.log(`   - Summary: ${summaryPath}`);
  }

  private generateSummaryReport(): string {
    const errorRate = ((this.metrics.errorCount / this.metrics.totalActions) * 100);

    return `# Realistic User Behavior Simulation Report

## Simulation Configuration

- **Total Users**: ${this.config.totalUsers.toLocaleString()}
- **Duration**: ${this.config.simulationDurationMinutes} minutes
- **Speed**: ${this.config.realTimeSpeed}x real-time
- **User Distribution**:
  - Casual: ${(this.config.userDistribution.casual * 100)}%
  - Active: ${(this.config.userDistribution.active * 100)}%
  - Power Users: ${(this.config.userDistribution.power_user * 100)}%
  - Whales: ${(this.config.userDistribution.whale * 100)}%

## Performance Results

### Overall Metrics
- **Total Actions**: ${this.metrics.totalActions.toLocaleString()}
- **Actions per Second**: ${this.metrics.actionsPerSecond.toFixed(2)}
- **Achievement Checks**: ${this.metrics.achievementChecks.toLocaleString()}
- **Achievement Unlocks**: ${this.metrics.achievementUnlocks.toLocaleString()}
- **Achievement Unlock Rate**: ${((this.metrics.achievementUnlocks / this.metrics.achievementChecks) * 100).toFixed(2)}%

### Response Time Statistics
- **Minimum**: ${this.metrics.responseTimeStats.min.toFixed(2)}ms
- **Maximum**: ${this.metrics.responseTimeStats.max.toFixed(2)}ms
- **Average**: ${this.metrics.responseTimeStats.avg.toFixed(2)}ms
- **50th Percentile**: ${this.metrics.responseTimeStats.p50.toFixed(2)}ms
- **95th Percentile**: ${this.metrics.responseTimeStats.p95.toFixed(2)}ms
- **99th Percentile**: ${this.metrics.responseTimeStats.p99.toFixed(2)}ms

### Error Analysis
- **Total Errors**: ${this.metrics.errorCount.toLocaleString()}
- **Error Rate**: ${errorRate.toFixed(3)}%

## User Behavior Analysis

${Object.entries(this.metrics.userBehaviorStats)
  .map(([behavior, stats]) => `### ${behavior.charAt(0).toUpperCase() + behavior.slice(1)} Users
- **Actions**: ${stats.actionCount.toLocaleString()}
- **Avg Response Time**: ${stats.averageResponseTime.toFixed(2)}ms
- **Achievement Unlocks**: ${stats.achievementUnlocks.toLocaleString()}
- **Unlocks per Action**: ${(stats.achievementUnlocks / stats.actionCount).toFixed(3)}`)
  .join('\n\n')}

## Performance Assessment

${this.generatePerformanceAssessment()}

## Scalability Insights

${this.generateScalabilityInsights()}

---
*Report generated on ${new Date().toISOString()}*`;
  }

  private generatePerformanceAssessment(): string {
    const assessments = [];
    const avgResponseTime = this.metrics.responseTimeStats.avg;
    const errorRate = (this.metrics.errorCount / this.metrics.totalActions) * 100;
    const p95ResponseTime = this.metrics.responseTimeStats.p95;

    if (avgResponseTime < 50) {
      assessments.push('✅ **Excellent**: Average response time under 50ms');
    } else if (avgResponseTime < 100) {
      assessments.push('⚠️ **Good**: Average response time under 100ms target');
    } else if (avgResponseTime < 200) {
      assessments.push('⚠️ **Acceptable**: Response time needs optimization');
    } else {
      assessments.push('❌ **Critical**: Response time exceeds acceptable limits');
    }

    if (p95ResponseTime < 200) {
      assessments.push('✅ **Excellent**: 95th percentile under 200ms');
    } else if (p95ResponseTime < 500) {
      assessments.push('⚠️ **Good**: 95th percentile response time acceptable');
    } else {
      assessments.push('❌ **Poor**: 95th percentile response time too high');
    }

    if (errorRate < 0.1) {
      assessments.push('✅ **Excellent**: Error rate under 0.1%');
    } else if (errorRate < 1) {
      assessments.push('⚠️ **Good**: Error rate under 1%');
    } else {
      assessments.push('❌ **Critical**: Error rate too high for production');
    }

    if (this.metrics.actionsPerSecond > 50) {
      assessments.push('✅ **Excellent**: High throughput achieved');
    } else if (this.metrics.actionsPerSecond > 20) {
      assessments.push('⚠️ **Good**: Adequate throughput for current scale');
    } else {
      assessments.push('❌ **Poor**: Low throughput may not support growth');
    }

    return assessments.join('\n');
  }

  private generateScalabilityInsights(): string {
    const insights = [];

    // Calculate scaling factors
    const currentLoadPerSecond = this.metrics.actionsPerSecond;
    const targetLoad = 100; // Target 100 actions per second

    if (currentLoadPerSecond >= targetLoad) {
      insights.push(`**System can handle target load**: Current ${currentLoadPerSecond.toFixed(1)} actions/sec meets target of ${targetLoad} actions/sec`);
    } else {
      const scalingFactor = targetLoad / currentLoadPerSecond;
      insights.push(`**Scaling required**: Need ${scalingFactor.toFixed(1)}x improvement to reach ${targetLoad} actions/sec target`);
    }

    // Achievement processing efficiency
    const achievementProcessingRate = (this.metrics.achievementChecks / this.metrics.totalActions) * 100;
    insights.push(`**Achievement processing efficiency**: ${achievementProcessingRate.toFixed(1)}% of actions trigger achievement checks`);

    // User behavior insights
    const powerUserEfficiency = this.metrics.userBehaviorStats.power_user?.averageResponseTime || 0;
    const casualUserEfficiency = this.metrics.userBehaviorStats.casual?.averageResponseTime || 0;

    if (powerUserEfficiency > 0 && casualUserEfficiency > 0) {
      const efficiencyRatio = powerUserEfficiency / casualUserEfficiency;
      insights.push(`**User behavior impact**: Power users have ${efficiencyRatio.toFixed(2)}x response time vs casual users`);
    }

    return insights.join('\n');
  }

  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up test data...');

    try {
      // Remove test users
      const deleteResult = await prisma.user.deleteMany({
        where: {
          discordId: { startsWith: 'simulation_user_' }
        }
      });

      console.log(`✅ Cleaned up ${deleteResult.count} test users`);

    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }
}

// CLI interface
if (require.main === module) {
  const config: Partial<SimulationConfig> = {
    totalUsers: parseInt(process.env.SIM_USERS || '1000'),
    simulationDurationMinutes: parseInt(process.env.SIM_DURATION || '10'),
    realTimeSpeed: parseFloat(process.env.SIM_SPEED || '10.0')
  };

  const simulator = new RealisticUserSimulator(config);

  simulator.runSimulation()
    .then(metrics => {
      console.log('\n🎉 Realistic user simulation completed!');
      console.log(`📊 ${metrics.totalActions.toLocaleString()} actions processed`);
      console.log(`⚡ ${metrics.actionsPerSecond.toFixed(2)} actions/second`);
      console.log(`🏆 ${metrics.achievementUnlocks.toLocaleString()} achievements unlocked`);
      console.log(`⏱️ ${metrics.responseTimeStats.avg.toFixed(2)}ms average response time`);
      console.log(`❌ ${((metrics.errorCount / metrics.totalActions) * 100).toFixed(3)}% error rate`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Simulation failed:', error);
      process.exit(1);
    });
}

export { RealisticUserSimulator, type SimulationConfig, type SimulationMetrics };