#!/usr/bin/env npx tsx
// scripts/state_sync.ts
// State synchronization monitor for Abstract gateway nodes

import "dotenv/config";
import { ethers } from "ethers";
import { getNetworkDisplayName } from "../src/services/network.js";

export class StateSyncMonitor {
  private readonly ENDPOINTS: string[];
  private readonly MAX_ACCEPTABLE_DIFF = 2; // blocks

  constructor() {
    // Abstract gateway endpoints
    this.ENDPOINTS = [
      process.env.MAINNET_RPC_URL || process.env.TESTNET_RPC_URL || 'https://api.testnet.abs.xyz',
      process.env.BACKUP_RPC_URL_1 || 'https://abstract-mainnet.g.alchemy.com/v2/' + (process.env.ALCHEMY_API_KEY || 'demo'),
      process.env.BACKUP_RPC_URL_2 || 'https://api.testnet.abs.xyz'
    ].filter(url => url && !url.includes('undefined'));

    // Remove duplicates
    this.ENDPOINTS = [...new Set(this.ENDPOINTS)];

    if (this.ENDPOINTS.length < 2) {
      console.warn(`⚠️ Only ${this.ENDPOINTS.length} RPC endpoint(s) configured`);
      console.log(`   For better sync monitoring, configure multiple endpoints:`);
      console.log(`   - BACKUP_RPC_URL_1`);
      console.log(`   - BACKUP_RPC_URL_2`);
    }
  }

  async checkConsensus(): Promise<{ consensus: boolean; details: SyncDetails[] }> {
    console.log(`🔍 Checking consensus across ${this.ENDPOINTS.length} gateway nodes...`);

    const details: SyncDetails[] = [];

    try {
      // Check all endpoints in parallel
      const results = await Promise.allSettled(
        this.ENDPOINTS.map(async (url, index) => {
          const provider = new ethers.JsonRpcProvider(url);
          const startTime = Date.now();

          try {
            const [blockNumber, chainId, latestBlock] = await Promise.all([
              provider.getBlockNumber(),
              provider.getNetwork().then(n => Number(n.chainId)),
              provider.getBlock('latest')
            ]);

            const responseTime = Date.now() - startTime;

            return {
              endpoint: index,
              url: url.replace(/\/v2\/.*/, '/v2/***'), // Hide API keys
              blockNumber,
              chainId,
              blockHash: latestBlock?.hash || 'N/A',
              timestamp: latestBlock?.timestamp || 0,
              responseTime,
              status: 'healthy' as const
            };
          } catch (error) {
            return {
              endpoint: index,
              url: url.replace(/\/v2\/.*/, '/v2/***'),
              blockNumber: 0,
              chainId: 0,
              blockHash: 'ERROR',
              timestamp: 0,
              responseTime: Date.now() - startTime,
              status: 'error' as const,
              error: error instanceof Error ? error.message : String(error)
            };
          }
        })
      );

      // Process results
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          details.push(result.value);
        } else {
          details.push({
            endpoint: i,
            url: this.ENDPOINTS[i].replace(/\/v2\/.*/, '/v2/***'),
            blockNumber: 0,
            chainId: 0,
            blockHash: 'REJECTED',
            timestamp: 0,
            responseTime: 0,
            status: 'error',
            error: result.reason?.message || 'Promise rejected'
          });
        }
      }

      // Analyze consensus
      const healthyNodes = details.filter(d => d.status === 'healthy');

      if (healthyNodes.length === 0) {
        console.error(`❌ No healthy gateway nodes found!`);
        return { consensus: false, details };
      }

      if (healthyNodes.length === 1) {
        console.warn(`⚠️ Only 1 healthy gateway node - cannot verify consensus`);
        return { consensus: true, details }; // Assume consensus with single node
      }

      // Check block number consensus
      const blockNumbers = healthyNodes.map(d => d.blockNumber);
      const minBlock = Math.min(...blockNumbers);
      const maxBlock = Math.max(...blockNumbers);
      const maxDiff = maxBlock - minBlock;

      console.log(`📊 Consensus Analysis:`);
      healthyNodes.forEach(d => {
        const status = d.blockNumber === maxBlock ? '✅' :
                      (maxBlock - d.blockNumber <= this.MAX_ACCEPTABLE_DIFF) ? '⚠️' : '❌';
        console.log(`   ${status} Node ${d.endpoint}: Block ${d.blockNumber} (${d.responseTime}ms)`);
      });

      const consensus = maxDiff <= this.MAX_ACCEPTABLE_DIFF;

      if (!consensus) {
        console.warn(`⚠️ Gateway desync detected: ${maxDiff} blocks difference`);
        console.warn(`   Min block: ${minBlock}`);
        console.warn(`   Max block: ${maxBlock}`);
        console.warn(`   Threshold: ${this.MAX_ACCEPTABLE_DIFF} blocks`);
      } else {
        console.log(`✅ Gateway nodes in consensus (max diff: ${maxDiff} blocks)`);
      }

      return { consensus, details };

    } catch (error) {
      console.error(`❌ Consensus check failed: ${error instanceof Error ? error.message : error}`);
      return { consensus: false, details };
    }
  }

  async findBestEndpoint(): Promise<{ url: string; details: SyncDetails } | null> {
    const { details } = await this.checkConsensus();
    const healthyNodes = details.filter(d => d.status === 'healthy');

    if (healthyNodes.length === 0) {
      return null;
    }

    // Find the node with highest block number and fastest response
    const best = healthyNodes.reduce((best, current) => {
      if (current.blockNumber > best.blockNumber) {
        return current;
      } else if (current.blockNumber === best.blockNumber && current.responseTime < best.responseTime) {
        return current;
      }
      return best;
    });

    const originalUrl = this.ENDPOINTS[best.endpoint];

    console.log(`🎯 Best endpoint: Node ${best.endpoint}`);
    console.log(`   Block: ${best.blockNumber}`);
    console.log(`   Response time: ${best.responseTime}ms`);

    return { url: originalUrl, details: best };
  }

  async monitorSync(intervalMs: number = 30000): Promise<void> {
    console.log(`👀 Starting continuous sync monitoring (every ${intervalMs/1000}s)...`);

    const monitor = async () => {
      console.log(`\n📅 ${new Date().toISOString()}`);
      const { consensus } = await this.checkConsensus();

      if (!consensus) {
        console.warn(`🚨 SYNC ISSUE DETECTED`);
        // In production, this would trigger alerts
      }
    };

    // Initial check
    await monitor();

    // Start monitoring
    const interval = setInterval(monitor, intervalMs);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(`\n👋 Stopping sync monitor...`);
      clearInterval(interval);
      process.exit(0);
    });

    console.log(`\n🎧 Sync monitor running. Press Ctrl+C to stop.`);
  }

  async waitForSync(timeoutMs: number = 60000): Promise<boolean> {
    console.log(`⏳ Waiting for gateway sync (timeout: ${timeoutMs/1000}s)...`);

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const { consensus } = await this.checkConsensus();

      if (consensus) {
        console.log(`✅ Gateway nodes synchronized`);
        return true;
      }

      console.log(`   Still syncing... (${Math.floor((Date.now() - startTime)/1000)}s elapsed)`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5s
    }

    console.warn(`⚠️ Timeout: Gateway nodes still not synchronized after ${timeoutMs/1000}s`);
    return false;
  }
}

interface SyncDetails {
  endpoint: number;
  url: string;
  blockNumber: number;
  chainId: number;
  blockHash: string;
  timestamp: number;
  responseTime: number;
  status: 'healthy' | 'error';
  error?: string;
}

async function main() {
  const networkName = getNetworkDisplayName();
  console.log(`🔄 State Sync Monitor for ${networkName}\n`);

  const action = process.argv[2] || 'check';

  try {
    const monitor = new StateSyncMonitor();

    switch (action) {
      case 'check':
        console.log(`📋 Running one-time consensus check...\n`);
        const result = await monitor.checkConsensus();

        if (result.consensus) {
          console.log(`\n✅ All gateway nodes are synchronized`);
          process.exit(0);
        } else {
          console.log(`\n❌ Gateway nodes are not synchronized`);
          process.exit(1);
        }
        break;

      case 'best':
        console.log(`🎯 Finding best endpoint...\n`);
        const best = await monitor.findBestEndpoint();

        if (best) {
          console.log(`\n✅ Best endpoint found:`);
          console.log(`   URL: ${best.url}`);
          console.log(`   Block: ${best.details.blockNumber}`);
          console.log(`   Response: ${best.details.responseTime}ms`);
        } else {
          console.log(`\n❌ No healthy endpoints found`);
          process.exit(1);
        }
        break;

      case 'monitor':
        await monitor.monitorSync();
        break;

      case 'wait':
        const synced = await monitor.waitForSync();
        process.exit(synced ? 0 : 1);
        break;

      default:
        console.log(`Usage: npx tsx scripts/state_sync.ts [command]`);
        console.log(`\nCommands:`);
        console.log(`  check   - One-time consensus check (default)`);
        console.log(`  best    - Find best performing endpoint`);
        console.log(`  monitor - Continuous monitoring`);
        console.log(`  wait    - Wait for sync with timeout`);
        process.exit(1);
    }

  } catch (error) {
    console.error(`❌ State sync monitoring failed:`, error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}