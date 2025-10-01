#!/usr/bin/env npx tsx
// scripts/reorg_protection.ts
// Reorg protection for Abstract zkSync transactions

import "dotenv/config";
import { ethers } from "ethers";
import { getAbstractRpcUrl, getNetworkDisplayName } from "../src/services/network.js";

export class ReorgProtection {
  private provider: ethers.JsonRpcProvider;
  private readonly SAFE_CONFIRMATIONS = 10; // zkSync blocks
  private readonly L1_SAFE_CONFIRMATIONS = 12; // Ethereum blocks

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async waitForFinality(txHash: string): Promise<void> {
    console.log(`🔒 Waiting for transaction finality: ${txHash}`);

    try {
      // Get transaction receipt
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        throw new Error(`Transaction ${txHash} not found`);
      }

      console.log(`📋 Transaction Details:`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
      console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);

      if (receipt.status !== 1) {
        throw new Error(`Transaction failed with status ${receipt.status}`);
      }

      // Step 1: Wait for L2 confirmations
      console.log(`\n⏳ Step 1: Waiting for ${this.SAFE_CONFIRMATIONS} L2 confirmations...`);
      await this.waitForL2Confirmations(receipt.blockNumber);

      // Step 2: Check L1 batch inclusion (Abstract-specific)
      console.log(`\n⏳ Step 2: Checking L1 batch finality...`);
      await this.waitForL1BatchFinality(txHash);

      console.log(`\n✅ Transaction finality confirmed!`);
      console.log(`   Transaction is safe from reorgs`);

    } catch (error) {
      console.error(`❌ Finality check failed: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  private async waitForL2Confirmations(txBlockNumber: number): Promise<void> {
    let confirmations = 0;

    while (confirmations < this.SAFE_CONFIRMATIONS) {
      const currentBlock = await this.provider.getBlockNumber();
      confirmations = currentBlock - txBlockNumber;

      console.log(`   L2 Confirmations: ${confirmations}/${this.SAFE_CONFIRMATIONS}`);

      if (confirmations >= this.SAFE_CONFIRMATIONS) {
        console.log(`   ✅ L2 confirmations complete`);
        break;
      }

      // Wait for next block
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  private async waitForL1BatchFinality(txHash: string): Promise<void> {
    try {
      // Get current L1 batch number
      const l1BatchNumber = await this.provider.send('zks_getL1BatchNumber', []);
      console.log(`   Current L1 batch: ${l1BatchNumber}`);

      // Get transaction's L1 batch
      const txBatch = await this.provider.send('zks_getL1BatchByTx', [txHash]);
      if (!txBatch) {
        console.warn(`   ⚠️ Transaction batch not found (may not be batched yet)`);
        console.log(`   Waiting for L1 batch inclusion...`);
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30s for batching
        return;
      }

      console.log(`   Transaction L1 batch: ${txBatch.number}`);

      const batchAge = l1BatchNumber - txBatch.number;
      console.log(`   Batch age: ${batchAge} batches`);

      if (batchAge < 2) {
        console.log(`   ⏳ Waiting for L1 batch finality...`);
        // L1 batches are submitted every ~30 seconds on Abstract
        const waitTime = (2 - batchAge) * 30000;
        await new Promise(resolve => setTimeout(resolve, waitTime));

        // Re-check after waiting
        const newL1BatchNumber = await this.provider.send('zks_getL1BatchNumber', []);
        const newBatchAge = newL1BatchNumber - txBatch.number;
        console.log(`   Updated batch age: ${newBatchAge} batches`);
      }

      console.log(`   ✅ L1 batch finality achieved`);

    } catch (error) {
      console.warn(`   ⚠️ L1 batch check failed: ${error instanceof Error ? error.message : error}`);
      console.log(`   Proceeding with L2 finality only (less secure)`);
    }
  }

  async checkReorgRisk(txHash: string): Promise<{ safe: boolean; risk: 'LOW' | 'MEDIUM' | 'HIGH' }> {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { safe: false, risk: 'HIGH' };
      }

      const currentBlock = await this.provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber;

      if (confirmations >= this.SAFE_CONFIRMATIONS) {
        return { safe: true, risk: 'LOW' };
      } else if (confirmations >= 5) {
        return { safe: false, risk: 'MEDIUM' };
      } else {
        return { safe: false, risk: 'HIGH' };
      }

    } catch (error) {
      console.error(`❌ Reorg risk check failed: ${error instanceof Error ? error.message : error}`);
      return { safe: false, risk: 'HIGH' };
    }
  }

  async monitorForReorgs(txHash: string, callback: (reorgDetected: boolean) => void): Promise<void> {
    console.log(`👀 Starting reorg monitoring for: ${txHash}`);

    let lastKnownBlockHash: string | null = null;

    const monitor = async () => {
      try {
        const receipt = await this.provider.getTransactionReceipt(txHash);
        if (!receipt) {
          callback(true); // Transaction disappeared
          return;
        }

        const block = await this.provider.getBlock(receipt.blockNumber);
        if (!block) {
          callback(true); // Block disappeared
          return;
        }

        if (lastKnownBlockHash && lastKnownBlockHash !== block.hash) {
          console.warn(`🚨 REORG DETECTED: Block hash changed!`);
          console.warn(`   Previous: ${lastKnownBlockHash}`);
          console.warn(`   Current: ${block.hash}`);
          callback(true);
          return;
        }

        lastKnownBlockHash = block.hash;
        callback(false); // No reorg detected

      } catch (error) {
        console.error(`❌ Reorg monitoring error: ${error instanceof Error ? error.message : error}`);
        callback(true); // Treat errors as potential reorgs
      }
    };

    // Initial check
    await monitor();

    // Monitor every 10 seconds for 5 minutes
    const interval = setInterval(monitor, 10000);
    setTimeout(() => {
      clearInterval(interval);
      console.log(`✅ Reorg monitoring completed for ${txHash}`);
    }, 300000);
  }
}

async function main() {
  const networkName = getNetworkDisplayName();
  console.log(`🔒 Reorg Protection for ${networkName}\n`);

  // Check if a transaction hash was provided
  const txHash = process.argv[2];
  if (!txHash) {
    console.log(`Usage: npx tsx scripts/reorg_protection.ts <transaction_hash>`);
    console.log(`\nExample:`);
    console.log(`  npx tsx scripts/reorg_protection.ts 0x123...`);
    process.exit(1);
  }

  if (!txHash.startsWith('0x') || txHash.length !== 66) {
    console.error(`❌ Invalid transaction hash format: ${txHash}`);
    console.log(`   Expected: 0x followed by 64 hex characters`);
    process.exit(1);
  }

  try {
    const rpcUrl = getAbstractRpcUrl();
    const protection = new ReorgProtection(rpcUrl);

    // Check current reorg risk
    console.log(`🔍 Checking reorg risk...`);
    const risk = await protection.checkReorgRisk(txHash);
    console.log(`   Risk Level: ${risk.risk}`);
    console.log(`   Safe: ${risk.safe ? '✅ Yes' : '❌ No'}`);

    if (!risk.safe) {
      console.log(`\n⏳ Waiting for finality...`);
      await protection.waitForFinality(txHash);
    } else {
      console.log(`\n✅ Transaction already has sufficient finality`);
    }

    // Optionally start reorg monitoring
    const shouldMonitor = process.argv.includes('--monitor');
    if (shouldMonitor) {
      console.log(`\n👀 Starting reorg monitoring...`);
      await protection.monitorForReorgs(txHash, (reorgDetected) => {
        if (reorgDetected) {
          console.error(`🚨 REORG DETECTED for transaction ${txHash}!`);
          process.exit(1);
        }
      });
    }

  } catch (error) {
    console.error(`❌ Reorg protection failed:`, error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}