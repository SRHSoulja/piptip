#!/usr/bin/env npx tsx
// scripts/test_merkle_publisher.ts
// CLI script to test MerklePublisher on testnet/mainnet

import "dotenv/config";
import { merklePublisher } from "../src/services/merkle_publisher.js";
import { getNetworkType, getNetworkDisplayName, isTestnet } from "../src/services/network.js";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log(`🌐 MerklePublisher Test Script`);
  console.log(`📍 Current Network: ${getNetworkDisplayName()}`);
  console.log(`🔧 Network Type: ${getNetworkType()}`);

  if (isTestnet()) {
    console.log(`🧪 TESTNET MODE: Safe for testing`);
  } else {
    console.log(`🚀 MAINNET MODE: Real funds and contracts`);
  }

  console.log(`\n📋 Available Commands:`);
  console.log(`  info        - Show network configuration`);
  console.log(`  generate    - Generate merkle tree (without publishing)`);
  console.log(`  verify      - Verify a merkle root exists on chain`);
  console.log(`  latest      - Get latest snapshot from registry`);
  console.log(`  publish     - Publish snapshot to registry (requires PRIVATE_KEY env var)`);
  console.log(`\n`);

  switch (command) {
    case 'info':
      await showNetworkInfo();
      break;

    case 'generate':
      await generateMerkleTree();
      break;

    case 'verify':
      const merkleRoot = args[1];
      if (!merkleRoot) {
        console.error('❌ Please provide merkle root to verify');
        console.log('Usage: npx tsx scripts/test_merkle_publisher.ts verify 0x...');
        process.exit(1);
      }
      await verifySnapshot(merkleRoot);
      break;

    case 'latest':
      await getLatestSnapshot();
      break;

    case 'publish':
      await publishSnapshot();
      break;

    default:
      console.log(`❌ Unknown command: ${command || 'none'}`);
      console.log(`Use one of: info, generate, verify, latest, publish`);
      process.exit(1);
  }
}

async function showNetworkInfo() {
  console.log(`📊 Network Configuration:`);

  const networkInfo = merklePublisher.getNetworkInfo();
  console.log(`   Network: ${networkInfo.network}`);
  console.log(`   Chain ID: ${networkInfo.chainId}`);
  console.log(`   RPC URL: ${networkInfo.rpcUrl.replace(/\/[^\/]+$/, '/***')}`);
  console.log(`   Registry Contract: ${networkInfo.registryContract}`);
  console.log(`   Display Name: ${networkInfo.displayName}`);

  // Check if registry contract addresses are set
  const mainnetRegistry = process.env.MAINNET_REGISTRY_CONTRACT_ADDRESS;
  const testnetRegistry = process.env.TESTNET_REGISTRY_CONTRACT_ADDRESS;

  console.log(`\n📋 Registry Contracts:`);
  console.log(`   Mainnet: ${mainnetRegistry || '❌ NOT SET'}`);
  console.log(`   Testnet: ${testnetRegistry || '❌ NOT SET'}`);

  if (!mainnetRegistry || !testnetRegistry) {
    console.log(`\n⚠️  Missing registry contract addresses!`);
    console.log(`   Set MAINNET_REGISTRY_CONTRACT_ADDRESS and TESTNET_REGISTRY_CONTRACT_ADDRESS`);
  }
}

async function generateMerkleTree() {
  try {
    console.log(`🌳 Generating merkle tree...`);

    const treeData = await merklePublisher.generateMerkleTree();

    console.log(`✅ Merkle tree generated successfully!`);
    console.log(`   Merkle Root: ${treeData.merkleRoot}`);
    console.log(`   Total Users: ${treeData.totalUsers}`);
    console.log(`   Total Balance: ${treeData.totalBalance} (atomic units)`);
    console.log(`   Leaves: ${treeData.leaves.length}`);

    if (treeData.leaves.length > 0) {
      console.log(`\n📝 Sample leaves (first 3):`);
      for (let i = 0; i < Math.min(3, treeData.leaves.length); i++) {
        const leaf = treeData.leaves[i];
        console.log(`   ${i + 1}. ${leaf.address}: ${leaf.amount}`);
      }
    }

  } catch (error) {
    console.error(`❌ Failed to generate merkle tree:`, error);
    process.exit(1);
  }
}

async function verifySnapshot(merkleRoot: string) {
  try {
    console.log(`🔍 Verifying snapshot: ${merkleRoot}`);

    const isValid = await merklePublisher.verifySnapshot(merkleRoot);

    if (isValid) {
      console.log(`✅ Snapshot is VALID on ${getNetworkDisplayName()}`);
    } else {
      console.log(`❌ Snapshot is INVALID or not found on ${getNetworkDisplayName()}`);
    }

  } catch (error) {
    console.error(`❌ Failed to verify snapshot:`, error);
    process.exit(1);
  }
}

async function getLatestSnapshot() {
  try {
    console.log(`📄 Getting latest snapshot from registry...`);

    const snapshot = await merklePublisher.getLatestSnapshot();

    if (snapshot) {
      console.log(`✅ Latest snapshot found:`);
      console.log(`   Merkle Root: ${snapshot.merkleRoot}`);
      console.log(`   IPFS Hash: ${snapshot.ipfsHash}`);
      console.log(`   Timestamp: ${new Date(snapshot.timestamp * 1000).toISOString()}`);
    } else {
      console.log(`❌ No snapshots found in registry on ${getNetworkDisplayName()}`);
    }

  } catch (error) {
    console.error(`❌ Failed to get latest snapshot:`, error);
    process.exit(1);
  }
}

async function publishSnapshot() {
  const privateKey = process.env.PRIVATE_KEY || process.env.AGW_SESSION_PRIVATE_KEY;

  if (!privateKey) {
    console.error(`❌ Missing PRIVATE_KEY environment variable`);
    console.log(`   Set PRIVATE_KEY or AGW_SESSION_PRIVATE_KEY for publishing`);
    process.exit(1);
  }

  // Normalize private key format (ethers accepts both with and without 0x)
  const normalizedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

  try {
    console.log(`🚀 Publishing snapshot to ${getNetworkDisplayName()}...`);

    if (!isTestnet()) {
      console.log(`⚠️  WARNING: Publishing to MAINNET with real funds!`);
      console.log(`   Press Ctrl+C to cancel, or wait 5 seconds to continue...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    const result = await merklePublisher.publishSnapshot(normalizedPrivateKey);

    if (result.success) {
      console.log(`✅ Snapshot published successfully!`);
      console.log(`   TX Hash: ${result.txHash}`);
      console.log(`   Network: ${result.network}`);
      console.log(`   Chain ID: ${result.chainId}`);
      console.log(`   Registry: ${result.registryContract}`);

      if (result.snapshot) {
        console.log(`   Merkle Root: ${result.snapshot.merkleRoot}`);
        console.log(`   IPFS Hash: ${result.snapshot.ipfsHash}`);
        console.log(`   Total Users: ${result.snapshot.totalUsers}`);
      }
    } else {
      console.error(`❌ Snapshot publishing failed: ${result.error}`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`❌ Failed to publish snapshot:`, error);
    process.exit(1);
  }
}

// Handle cleanup on exit
process.on('SIGINT', () => {
  console.log(`\n👋 Test script interrupted`);
  process.exit(0);
});

main().catch((error) => {
  console.error(`💥 Fatal error:`, error);
  process.exit(1);
});