#!/usr/bin/env npx tsx
// scripts/l1_cost.ts
// L1 data cost calculator for Abstract zkSync

import "dotenv/config";
import { ethers } from "ethers";
import { getAbstractRpcUrl, getNetworkDisplayName, isMainnet } from "../src/services/network.js";

export class L1CostCalculator {
  private provider: ethers.JsonRpcProvider;
  private readonly MAX_L1_GWEI = 200_000_000_000n; // 200 gwei on L1

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async calculateTotalCost(txData: string): Promise<bigint> {
    try {
      // L2 execution cost
      const l2Gas = await this.provider.estimateGas({
        data: txData,
        to: null // Contract deployment
      });
      const l2Price = await this.provider.getGasPrice();
      const l2Cost = l2Gas * l2Price;

      console.log(`💰 L2 Cost Breakdown:`);
      console.log(`   Gas estimate: ${l2Gas.toString()}`);
      console.log(`   Gas price: ${ethers.formatUnits(l2Price, "gwei")} gwei`);
      console.log(`   L2 cost: ${ethers.formatEther(l2Cost)} ETH`);

      // L1 calldata cost (zkSync-specific)
      let l1Cost = 0n;
      try {
        const l1DataCost = await this.provider.send('zks_estimateL1ToL2', [txData]);
        const l1GasPrice = await this.getL1GasPrice();
        l1Cost = BigInt(l1DataCost) * l1GasPrice;

        console.log(`🌐 L1 Cost Breakdown:`);
        console.log(`   L1 data cost: ${l1DataCost}`);
        console.log(`   L1 gas price: ${ethers.formatUnits(l1GasPrice, "gwei")} gwei`);
        console.log(`   L1 cost: ${ethers.formatEther(l1Cost)} ETH`);
      } catch (error) {
        console.warn(`⚠️ L1 cost estimation failed (using L2 only): ${error instanceof Error ? error.message : error}`);
      }

      const totalCost = l2Cost + l1Cost;
      console.log(`📊 Total Cost: ${ethers.formatEther(totalCost)} ETH`);

      return totalCost;
    } catch (error) {
      console.error(`❌ Cost calculation failed: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  async getL1GasPrice(): Promise<bigint> {
    try {
      // For zkSync, we need to get L1 gas price from Ethereum mainnet
      // In a real implementation, you'd use an Ethereum RPC endpoint
      const ethProvider = new ethers.JsonRpcProvider(
        process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo'
      );

      const feeData = await ethProvider.getFeeData();
      return feeData.gasPrice || 20_000_000_000n; // Fallback to 20 gwei
    } catch (error) {
      console.warn(`⚠️ Failed to get L1 gas price, using fallback: ${error instanceof Error ? error.message : error}`);
      return 50_000_000_000n; // Conservative fallback: 50 gwei
    }
  }

  async shouldPublishBasedOnL1Cost(): Promise<boolean> {
    try {
      const l1GasPrice = await this.getL1GasPrice();

      console.log(`⛽ L1 Gas Check:`);
      console.log(`   Current L1 gas: ${ethers.formatUnits(l1GasPrice, "gwei")} gwei`);
      console.log(`   Threshold: ${ethers.formatUnits(this.MAX_L1_GWEI, "gwei")} gwei`);

      if (l1GasPrice > this.MAX_L1_GWEI) {
        console.log(`❌ L1 Ethereum congested - delaying publish`);
        console.log(`   Recommendation: Wait for L1 gas to drop below ${ethers.formatUnits(this.MAX_L1_GWEI, "gwei")} gwei`);
        return false;
      }

      console.log(`✅ L1 gas acceptable for publishing`);
      return true;
    } catch (error) {
      console.error(`❌ L1 cost check failed: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  async estimatePublishCost(): Promise<{ l2Cost: bigint; l1Cost: bigint; totalCost: bigint }> {
    // Simulate publishSnapshot transaction data
    const publishSnapshotData = "0x6809f997" + // publishSnapshot selector
      "9c7bd3813dfb4e3ff175953555fccfedd11da95ad77979224b2b35e67e63f570" + // merkleRoot
      "0000000000000000000000000000000000000000000000000000000000000060" + // ipfsHash offset
      "000000000000000000000000000000000000000000000000000001234567890a" + // timestamp
      "000000000000000000000000000000000000000000000000000000000000002e" + // ipfsHash length
      "516d546573744861736831323300000000000000000000000000000000000000"; // ipfsHash data

    const totalCost = await this.calculateTotalCost(publishSnapshotData);

    // For simplified reporting, assume 90% L2, 10% L1 (typical zkSync ratio)
    const l2Cost = (totalCost * 90n) / 100n;
    const l1Cost = totalCost - l2Cost;

    return { l2Cost, l1Cost, totalCost };
  }
}

async function main() {
  const networkName = getNetworkDisplayName();
  console.log(`💰 L1 Cost Calculator for ${networkName}\n`);

  try {
    const rpcUrl = getAbstractRpcUrl();
    const calculator = new L1CostCalculator(rpcUrl);

    // Check if we should publish based on L1 costs
    console.log(`🔍 Checking L1 gas conditions...`);
    const shouldPublish = await calculator.shouldPublishBasedOnL1Cost();

    if (shouldPublish) {
      console.log(`\n📊 Estimating publish costs...`);
      const costs = await calculator.estimatePublishCost();

      console.log(`\n💡 Cost Summary:`);
      console.log(`   L2 Cost: ${ethers.formatEther(costs.l2Cost)} ETH`);
      console.log(`   L1 Cost: ${ethers.formatEther(costs.l1Cost)} ETH`);
      console.log(`   Total: ${ethers.formatEther(costs.totalCost)} ETH`);

      // Convert to USD (mock rate)
      const ethToUsd = 2000; // Mock ETH price
      const totalUsd = parseFloat(ethers.formatEther(costs.totalCost)) * ethToUsd;
      console.log(`   Total: ~$${totalUsd.toFixed(2)} USD`);

      if (isMainnet()) {
        console.log(`\n⚠️  MAINNET COST ESTIMATE - This will use real ETH!`);
      }
    } else {
      console.log(`\n⏳ Recommendation: Wait for lower L1 gas prices before publishing`);
    }

  } catch (error) {
    console.error(`❌ L1 cost calculation failed:`, error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}