#!/usr/bin/env npx tsx
// scripts/event_monitor.ts
// Real-time event monitoring for Abstract mainnet

import "dotenv/config";
import { ethers, WebSocketProvider, Contract } from "ethers";
import { getAbstractRpcUrl, getRegistryContractAddress, getNetworkDisplayName, isMainnet } from "../src/services/network.js";
import { readFileSync } from "fs";

// Load contract ABI
function loadRegistryABI() {
  try {
    const artifactPath = "/home/arson/builds/piptip/artifacts/contracts/MerkleRegistry.sol/MerkleRegistry.json";
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    return artifact.abi;
  } catch (error) {
    throw new Error(`Failed to load contract ABI: ${error}`);
  }
}

// Convert RPC URL to WebSocket URL
function getWebSocketUrl(rpcUrl: string): string {
  if (rpcUrl.includes('alchemy.com')) {
    return rpcUrl.replace('https://', 'wss://').replace('/v2/', '/v2/');
  } else if (rpcUrl.includes('api.mainnet.abs.xyz')) {
    return 'wss://api.mainnet.abs.xyz/ws';
  } else if (rpcUrl.includes('api.testnet.abs.xyz')) {
    return 'wss://api.testnet.abs.xyz/ws';
  } else {
    // Fallback: try to convert HTTP to WS
    return rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://');
  }
}

async function main() {
  const networkName = getNetworkDisplayName();
  console.log(`🎧 Starting Event Monitor for ${networkName}\n`);

  // Get network configuration
  const rpcUrl = getAbstractRpcUrl();
  const contractAddress = getRegistryContractAddress();
  const abi = loadRegistryABI();

  console.log(`📡 RPC URL: ${rpcUrl.replace(/\/v2\/.*/, '/v2/***')}`);
  console.log(`📋 Contract: ${contractAddress}`);

  // Setup WebSocket provider
  const wsUrl = getWebSocketUrl(rpcUrl);
  console.log(`🔌 WebSocket: ${wsUrl.replace(/\/v2\/.*/, '/v2/***')}`);

  try {
    const wsProvider = new WebSocketProvider(wsUrl);
    const contract = new Contract(contractAddress, abi, wsProvider);

    console.log(`\n✅ Connected to ${networkName}`);
    console.log(`🎯 Monitoring SnapshotPublished events...\n`);

    // Monitor SnapshotPublished events
    contract.on("SnapshotPublished", async (merkleRoot, ipfsHash, timestamp, publisher, event) => {
      const blockNumber = event.log.blockNumber;
      const txHash = event.log.transactionHash;

      console.log(`📤 NEW SNAPSHOT PUBLISHED:`);
      console.log(`   📅 Time: ${new Date().toISOString()}`);
      console.log(`   🧊 Block: ${blockNumber}`);
      console.log(`   📄 TX: ${txHash}`);
      console.log(`   🌳 Merkle Root: ${merkleRoot}`);
      console.log(`   📂 IPFS Hash: ${ipfsHash}`);
      console.log(`   ⏰ Timestamp: ${timestamp} (${new Date(Number(timestamp) * 1000).toISOString()})`);
      console.log(`   👤 Publisher: ${publisher}`);

      if (isMainnet()) {
        console.log(`   🔍 Explorer: https://explorer.abs.xyz/tx/${txHash}`);
      } else {
        console.log(`   🔍 Explorer: https://explorer.testnet.abs.xyz/tx/${txHash}`);
      }
      console.log();

      // Validate publisher is expected (security check)
      const expectedPublisher = process.env.EXPECTED_PUBLISHER_ADDRESS;
      if (expectedPublisher && publisher.toLowerCase() !== expectedPublisher.toLowerCase()) {
        console.warn(`⚠️  WARNING: Unexpected publisher detected!`);
        console.warn(`     Expected: ${expectedPublisher}`);
        console.warn(`     Actual: ${publisher}`);
        // Could send alert here
      }
    });

    // Monitor AuthorizedPublisherAdded events
    contract.on("AuthorizedPublisherAdded", (publisher, event) => {
      console.log(`➕ PUBLISHER AUTHORIZED:`);
      console.log(`   👤 Publisher: ${publisher}`);
      console.log(`   🧊 Block: ${event.log.blockNumber}`);
      console.log(`   📄 TX: ${event.log.transactionHash}`);
      console.log();
    });

    // Monitor AuthorizedPublisherRemoved events
    contract.on("AuthorizedPublisherRemoved", (publisher, event) => {
      console.log(`➖ PUBLISHER REMOVED:`);
      console.log(`   👤 Publisher: ${publisher}`);
      console.log(`   🧊 Block: ${event.log.blockNumber}`);
      console.log(`   📄 TX: ${event.log.transactionHash}`);
      console.log();
    });

    // Handle connection events
    wsProvider.on("error", (error) => {
      console.error(`❌ WebSocket error: ${error.message}`);
    });

    wsProvider.on("close", (code) => {
      console.warn(`⚠️  WebSocket closed with code: ${code}`);
      console.log(`🔄 Attempting to reconnect...`);
      // In production, you'd implement reconnection logic here
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(`\n👋 Shutting down event monitor...`);
      wsProvider.destroy();
      process.exit(0);
    });

    // Keep the process alive
    console.log(`🎧 Event monitor is running. Press Ctrl+C to stop.\n`);

    // Optional: Periodic health check
    setInterval(async () => {
      try {
        const blockNumber = await wsProvider.getBlockNumber();
        const timestamp = new Date().toISOString();
        console.log(`❤️  Health check: Block ${blockNumber} at ${timestamp}`);
      } catch (error) {
        console.error(`💔 Health check failed: ${error instanceof Error ? error.message : error}`);
      }
    }, 300000); // Every 5 minutes

  } catch (error) {
    console.error(`❌ Failed to connect to WebSocket:`, error);

    if (error instanceof Error) {
      if (error.message.includes('403') || error.message.includes('401')) {
        console.error(`\n💡 Authentication error. Check your RPC URL and API key.`);
      } else if (error.message.includes('ECONNREFUSED')) {
        console.error(`\n💡 Connection refused. Check your network connection and WebSocket URL.`);
      } else {
        console.error(`\n💡 Try checking if the WebSocket endpoint supports the protocol.`);
      }
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Event monitor failed:`, error);
  process.exit(1);
});