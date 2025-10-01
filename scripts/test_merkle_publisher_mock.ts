#!/usr/bin/env npx tsx
// scripts/test_merkle_publisher_mock.ts
// Mock testing for MerklePublisher without requiring deployed contracts

import "dotenv/config";
import { merklePublisher } from "../src/services/merkle_publisher.js";
import { getNetworkType, getNetworkDisplayName, isTestnet } from "../src/services/network.js";
import { prisma } from "../src/services/db.js";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log(`🧪 MerklePublisher Mock Test Script`);
  console.log(`📍 Current Network: ${getNetworkDisplayName()}`);
  console.log(`🔧 Network Type: ${getNetworkType()}`);

  if (!isTestnet()) {
    console.error(`❌ This mock test can only run on testnet!`);
    process.exit(1);
  }

  console.log(`🧪 TESTNET MODE: Safe for mock testing\n`);

  switch (command) {
    case 'generate':
      await generateAndShowMerkleTree();
      break;

    case 'mock-publish':
      await mockPublishSnapshot();
      break;

    case 'verify-db':
      await verifyDatabaseStorage();
      break;

    case 'full-test':
      await runFullTest();
      break;

    default:
      console.log(`📋 Available Commands:`);
      console.log(`  generate      - Generate merkle tree`);
      console.log(`  mock-publish  - Mock publish snapshot (no blockchain)`);
      console.log(`  verify-db     - Verify database storage`);
      console.log(`  full-test     - Run complete mock workflow`);
      process.exit(1);
  }
}

async function generateAndShowMerkleTree() {
  try {
    console.log(`🌳 Generating merkle tree...`);
    const treeData = await merklePublisher.generateMerkleTree();

    console.log(`✅ Merkle tree generated successfully!`);
    console.log(`   Merkle Root: ${treeData.merkleRoot}`);
    console.log(`   Total Users: ${treeData.totalUsers}`);
    console.log(`   Total Balance: ${treeData.totalBalance} (atomic units)`);

    if (treeData.leaves.length > 0) {
      console.log(`\n📝 All balances in tree:`);
      for (let i = 0; i < treeData.leaves.length; i++) {
        const leaf = treeData.leaves[i];
        const balanceFormatted = (Number(leaf.amount) / 1e18).toFixed(2);
        console.log(`   ${i + 1}. ${leaf.address}: ${balanceFormatted} tokens (${leaf.amount} atomic)`);
      }
    }

    return treeData;
  } catch (error) {
    console.error(`❌ Failed to generate merkle tree:`, error);
    throw error;
  }
}

async function mockPublishSnapshot() {
  try {
    console.log(`🚀 Mock publishing snapshot to testnet...`);

    // Generate merkle tree
    const treeData = await generateAndShowMerkleTree();

    console.log(`\n📦 Preparing snapshot for publishing...`);

    // Create mock snapshot data
    const mockSnapshot = {
      merkleRoot: treeData.merkleRoot,
      ipfsHash: `QmMock${Math.random().toString(36).substring(2).padEnd(44, '0')}`,
      timestamp: Math.floor(Date.now() / 1000),
      totalUsers: treeData.totalUsers,
      totalBalance: treeData.totalBalance,
      network: 'testnet' as const
    };

    console.log(`📤 Mock IPFS upload: ${mockSnapshot.ipfsHash}`);

    // Simulate contract interaction
    const mockTxHash = `0xmock${Math.random().toString(16).substring(2).padEnd(62, '0')}`;
    const mockBlockNumber = Math.floor(Math.random() * 1000000) + 5000000;

    console.log(`\n📝 Mock contract call parameters:`);
    console.log(`   Function: publishSnapshot(bytes32,string,uint256)`);
    console.log(`   Merkle Root: ${mockSnapshot.merkleRoot}`);
    console.log(`   IPFS Hash: ${mockSnapshot.ipfsHash}`);
    console.log(`   Timestamp: ${mockSnapshot.timestamp}`);

    console.log(`\n⏳ Simulating transaction...`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log(`✅ Mock transaction confirmed!`);
    console.log(`   TX Hash: ${mockTxHash}`);
    console.log(`   Block: ${mockBlockNumber}`);
    console.log(`   Gas Used: 89,234 (simulated)`);

    // Store in database
    const networkInfo = merklePublisher.getNetworkInfo();

    const storedSnapshot = await prisma.merkleSnapshot.create({
      data: {
        merkleRoot: mockSnapshot.merkleRoot,
        ipfsHash: mockSnapshot.ipfsHash,
        timestamp: new Date(mockSnapshot.timestamp * 1000),
        totalUsers: mockSnapshot.totalUsers,
        totalBalance: mockSnapshot.totalBalance,
        network: mockSnapshot.network,
        txHash: mockTxHash,
        chainId: networkInfo.chainId,
        registryContract: networkInfo.registryContract
      }
    });

    console.log(`💾 Snapshot stored in database (ID: ${storedSnapshot.id})`);

    return {
      success: true,
      mockTxHash,
      snapshot: mockSnapshot,
      dbId: storedSnapshot.id
    };

  } catch (error) {
    console.error(`❌ Mock publishing failed:`, error);
    throw error;
  }
}

async function verifyDatabaseStorage() {
  try {
    console.log(`🔍 Verifying database storage...`);

    const snapshots = await prisma.merkleSnapshot.findMany({
      where: { network: 'testnet' },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    if (snapshots.length === 0) {
      console.log(`❌ No testnet snapshots found in database`);
      return;
    }

    console.log(`✅ Found ${snapshots.length} testnet snapshot(s) in database:`);

    for (const snapshot of snapshots) {
      console.log(`\n📄 Snapshot ID: ${snapshot.id}`);
      console.log(`   Merkle Root: ${snapshot.merkleRoot}`);
      console.log(`   Network: ${snapshot.network}`);
      console.log(`   Chain ID: ${snapshot.chainId}`);
      console.log(`   Users: ${snapshot.totalUsers}`);
      console.log(`   Total Balance: ${snapshot.totalBalance}`);
      console.log(`   TX Hash: ${snapshot.txHash}`);
      console.log(`   Registry: ${snapshot.registryContract}`);
      console.log(`   Created: ${snapshot.createdAt.toISOString()}`);
    }

  } catch (error) {
    console.error(`❌ Database verification failed:`, error);
    throw error;
  }
}

async function runFullTest() {
  try {
    console.log(`🎯 Running complete mock workflow...\n`);

    // Step 1: Generate merkle tree
    console.log(`=== STEP 1: Generate Merkle Tree ===`);
    const treeData = await generateAndShowMerkleTree();

    // Step 2: Mock publish
    console.log(`\n=== STEP 2: Mock Publish to Testnet ===`);
    const publishResult = await mockPublishSnapshot();

    // Step 3: Verify database
    console.log(`\n=== STEP 3: Verify Database Storage ===`);
    await verifyDatabaseStorage();

    // Step 4: Summary
    console.log(`\n=== SUMMARY ===`);
    console.log(`✅ Complete mock workflow successful!`);
    console.log(`📊 Results:`);
    console.log(`   - Generated merkle tree with ${treeData.totalUsers} users`);
    console.log(`   - Mock published to testnet registry`);
    console.log(`   - Stored snapshot in database (ID: ${publishResult.dbId})`);
    console.log(`   - Merkle root: ${treeData.merkleRoot.slice(0, 20)}...`);
    console.log(`   - Mock TX: ${publishResult.mockTxHash.slice(0, 20)}...`);

    console.log(`\n🚀 Ready for real testnet deployment!`);
    console.log(`   Next: Deploy registry contract to Abstract testnet`);
    console.log(`   Then: Use real TESTNET_REGISTRY_CONTRACT_ADDRESS`);

  } catch (error) {
    console.error(`❌ Full test failed:`, error);
    throw error;
  }
}

// Safety check
if (process.env.NETWORK !== 'testnet') {
  console.error(`❌ This script requires NETWORK=testnet`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`💥 Fatal error:`, error);
  process.exit(1);
}).finally(() => {
  process.exit(0);
});