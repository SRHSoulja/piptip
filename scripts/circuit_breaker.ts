#!/usr/bin/env npx tsx
// scripts/circuit_breaker.ts
// Circuit breaker pattern for Abstract zkSync operations

import "dotenv/config";
import { ethers } from "ethers";
import { getAbstractRpcUrl, getNetworkDisplayName } from "../src/services/network.js";

export class CircuitBreaker {
  private readonly MAX_FAILURES = 5;
  private readonly COOLDOWN_PERIOD = 300000; // 5 minutes
  private readonly HEALTH_CHECK_INTERVAL = 60000; // 1 minute

  private failureCount = 0;
  private lastFailureTime = 0;
  private isOpen = false;
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(private provider: ethers.JsonRpcProvider) {}

  async execute<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    if (this.isOpen) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;

      if (timeSinceLastFailure < this.COOLDOWN_PERIOD) {
        const remainingCooldown = Math.ceil((this.COOLDOWN_PERIOD - timeSinceLastFailure) / 1000);
        throw new Error(
          `🚨 Circuit breaker OPEN for ${operationName}\n` +
          `   Cooldown remaining: ${remainingCooldown}s\n` +
          `   Failure count: ${this.failureCount}/${this.MAX_FAILURES}`
        );
      } else {
        console.log(`🔄 Circuit breaker attempting to close after cooldown`);
        this.reset();
      }
    }

    try {
      console.log(`⚡ Executing ${operationName}...`);
      const result = await operation();

      if (this.failureCount > 0) {
        console.log(`✅ ${operationName} succeeded - resetting failure count`);
        this.reset();
      }

      return result;
    } catch (error) {
      this.recordFailure(operationName, error);
      throw error;
    }
  }

  private recordFailure(operationName: string, error: unknown): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    console.error(`❌ Circuit breaker failure ${this.failureCount}/${this.MAX_FAILURES} for ${operationName}`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);

    if (this.failureCount >= this.MAX_FAILURES) {
      this.isOpen = true;
      console.error(`🚨 CIRCUIT BREAKER OPENED for ${operationName}`);
      console.error(`   Cooldown period: ${this.COOLDOWN_PERIOD / 1000}s`);
      console.error(`   All operations will be blocked until cooldown expires`);

      // Start health checking during cooldown
      this.startHealthChecking();
    }
  }

  private reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.isOpen = false;
    this.stopHealthChecking();
  }

  private startHealthChecking(): void {
    if (this.healthCheckTimer) return;

    console.log(`🏥 Starting health checks during cooldown...`);

    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.provider.getBlockNumber();
        console.log(`❤️  Health check passed - RPC responsive`);
      } catch (error) {
        console.error(`💔 Health check failed: ${error instanceof Error ? error.message : error}`);
      }
    }, this.HEALTH_CHECK_INTERVAL);
  }

  private stopHealthChecking(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
      console.log(`🏥 Health checking stopped`);
    }
  }

  getStatus(): {
    isOpen: boolean;
    failureCount: number;
    maxFailures: number;
    cooldownRemaining: number;
  } {
    const cooldownRemaining = this.isOpen
      ? Math.max(0, this.COOLDOWN_PERIOD - (Date.now() - this.lastFailureTime))
      : 0;

    return {
      isOpen: this.isOpen,
      failureCount: this.failureCount,
      maxFailures: this.MAX_FAILURES,
      cooldownRemaining
    };
  }

  async testCircuitBreaker(): Promise<void> {
    console.log(`🧪 Testing circuit breaker functionality...`);

    // Test normal operation
    try {
      await this.execute(async () => {
        return await this.provider.getBlockNumber();
      }, "getBlockNumber");
      console.log(`✅ Normal operation test passed`);
    } catch (error) {
      console.error(`❌ Normal operation test failed: ${error}`);
    }

    // Test failure handling
    console.log(`\n🧪 Testing failure scenarios...`);
    for (let i = 1; i <= this.MAX_FAILURES + 1; i++) {
      try {
        await this.execute(async () => {
          throw new Error(`Simulated failure ${i}`);
        }, `testFailure${i}`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('Circuit breaker OPEN')) {
          console.log(`✅ Circuit breaker correctly opened after ${this.MAX_FAILURES} failures`);
          break;
        }
      }
    }

    const status = this.getStatus();
    console.log(`\n📊 Circuit Breaker Status:`);
    console.log(`   Open: ${status.isOpen ? '🔴 YES' : '🟢 NO'}`);
    console.log(`   Failures: ${status.failureCount}/${status.maxFailures}`);
    if (status.cooldownRemaining > 0) {
      console.log(`   Cooldown: ${Math.ceil(status.cooldownRemaining / 1000)}s remaining`);
    }
  }

  destroy(): void {
    this.stopHealthChecking();
  }
}

async function main() {
  const networkName = getNetworkDisplayName();
  console.log(`🔌 Circuit Breaker Test for ${networkName}\n`);

  try {
    const rpcUrl = getAbstractRpcUrl();
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const circuitBreaker = new CircuitBreaker(provider);

    const command = process.argv[2] || 'test';

    switch (command) {
      case 'test':
        console.log(`🧪 Running circuit breaker tests...\n`);
        await circuitBreaker.testCircuitBreaker();
        break;

      case 'status':
        const status = circuitBreaker.getStatus();
        console.log(`📊 Circuit Breaker Status:`);
        console.log(`   Open: ${status.isOpen ? '🔴 YES' : '🟢 NO'}`);
        console.log(`   Failures: ${status.failureCount}/${status.maxFailures}`);
        if (status.cooldownRemaining > 0) {
          console.log(`   Cooldown: ${Math.ceil(status.cooldownRemaining / 1000)}s remaining`);
        }
        break;

      case 'monitor':
        console.log(`👀 Starting circuit breaker monitoring...\n`);

        const monitor = async () => {
          try {
            await circuitBreaker.execute(async () => {
              const blockNumber = await provider.getBlockNumber();
              console.log(`✅ Block ${blockNumber} - ${new Date().toISOString()}`);
              return blockNumber;
            }, "healthCheck");
          } catch (error) {
            console.error(`❌ Health check failed: ${error instanceof Error ? error.message : error}`);
          }
        };

        // Initial check
        await monitor();

        // Monitor every 30 seconds
        const interval = setInterval(monitor, 30000);

        // Handle graceful shutdown
        process.on('SIGINT', () => {
          console.log(`\n👋 Stopping circuit breaker monitor...`);
          clearInterval(interval);
          circuitBreaker.destroy();
          process.exit(0);
        });

        console.log(`\n🎧 Circuit breaker monitoring running. Press Ctrl+C to stop.`);
        break;

      default:
        console.log(`Usage: npx tsx scripts/circuit_breaker.ts [command]`);
        console.log(`\nCommands:`);
        console.log(`  test    - Run circuit breaker functionality tests`);
        console.log(`  status  - Show current circuit breaker status`);
        console.log(`  monitor - Start continuous health monitoring`);
        process.exit(1);
    }

  } catch (error) {
    console.error(`❌ Circuit breaker failed:`, error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}