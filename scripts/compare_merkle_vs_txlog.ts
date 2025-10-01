#!/usr/bin/env npx tsx
// scripts/compare_merkle_vs_txlog.ts
// Compare published merkle snapshot with transaction log derivation

import "dotenv/config";
import { prisma } from "../src/services/db.js";

interface ComparisonResult {
  snapshotId: number;
  publishedRoot: string;
  derivedRoot: string;
  matches: boolean;
  publishedMetadata: {
    timestamp: Date;
    totalUsers: number;
    totalBalance: string;
    network: string;
    txHash: string;
  };
  derivedMetadata: {
    totalUsers: number;
    totalBalance: string;
    source: string;
  };
  differences?: {
    userCountDiff: number;
    balanceDiff: string;
    missingUsers: string[];
    extraUsers: string[];
    balanceDifferences: Array<{
      address: string;
      publishedAmount: string;
      derivedAmount: string;
      difference: string;
    }>;
  };
}

async function compareMerkleVsTxLog(snapshotId: number): Promise<ComparisonResult> {
  console.log(`🔍 Comparing snapshot ${snapshotId} with transaction log derivation...`);

  // Get the published snapshot
  const snapshot = await prisma.merkleSnapshot.findUnique({
    where: { id: snapshotId }
  });

  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} not found`);
  }

  console.log(`📋 Published Snapshot:`);
  console.log(`   Merkle Root: ${snapshot.merkleRoot}`);
  console.log(`   Timestamp: ${snapshot.timestamp.toISOString()}`);
  console.log(`   Total Users: ${snapshot.totalUsers}`);
  console.log(`   Total Balance: ${snapshot.totalBalance}`);
  console.log(`   Network: ${snapshot.network}`);
  console.log(`   TX Hash: ${snapshot.txHash}`);

  // Generate merkle tree from transaction log at the snapshot timestamp
  console.log(`\n🔄 Deriving merkle tree from transaction log...`);

  const { merklePublisher } = await import('../src/services/merkle_publisher.js');

  // Temporarily enable transaction log mode
  const originalEnv = process.env.MERKLE_FROM_TXLOG;
  process.env.MERKLE_FROM_TXLOG = 'true';

  let derivedData: any;
  try {
    derivedData = await merklePublisher.generateMerkleTree(snapshot.timestamp);
  } finally {
    // Restore original environment
    if (originalEnv !== undefined) {
      process.env.MERKLE_FROM_TXLOG = originalEnv;
    } else {
      delete process.env.MERKLE_FROM_TXLOG;
    }
  }

  console.log(`\n📊 Derived from Transaction Log:`);
  console.log(`   Merkle Root: ${derivedData.merkleRoot}`);
  console.log(`   Total Users: ${derivedData.totalUsers}`);
  console.log(`   Total Balance: ${derivedData.totalBalance}`);

  const matches = snapshot.merkleRoot === derivedData.merkleRoot;

  const result: ComparisonResult = {
    snapshotId,
    publishedRoot: snapshot.merkleRoot,
    derivedRoot: derivedData.merkleRoot,
    matches,
    publishedMetadata: {
      timestamp: snapshot.timestamp,
      totalUsers: snapshot.totalUsers,
      totalBalance: snapshot.totalBalance,
      network: snapshot.network,
      txHash: snapshot.txHash
    },
    derivedMetadata: {
      totalUsers: derivedData.totalUsers,
      totalBalance: derivedData.totalBalance,
      source: 'transaction log'
    }
  };

  if (matches) {
    console.log(`\n✅ MATCH: Merkle roots are identical!`);
  } else {
    console.log(`\n❌ MISMATCH: Merkle roots differ!`);

    // Perform detailed comparison
    result.differences = await performDetailedComparison(snapshot, derivedData);
  }

  return result;
}

async function performDetailedComparison(
  snapshot: any,
  derivedData: any
): Promise<any> {
  console.log(`\n🔍 Performing detailed comparison...`);

  // For detailed comparison, we need to rebuild both trees with leaves
  // This is a simplified comparison - in production you'd compare the actual leaf data

  const userCountDiff = derivedData.totalUsers - snapshot.totalUsers;
  const publishedBalance = BigInt(snapshot.totalBalance);
  const derivedBalance = BigInt(derivedData.totalBalance);
  const balanceDiff = derivedBalance - publishedBalance;

  console.log(`📊 Differences:`);
  console.log(`   User Count: ${userCountDiff > 0 ? '+' : ''}${userCountDiff}`);
  console.log(`   Balance: ${balanceDiff > 0n ? '+' : ''}${balanceDiff.toString()}`);

  // Get user addresses from derived data
  const derivedAddresses = new Set(derivedData.leaves.map((leaf: any) => leaf.address));

  // For published snapshot, we'd need to reconstruct the leaves or store them
  // For now, we'll simulate this with a simple comparison

  const differences = {
    userCountDiff,
    balanceDiff: balanceDiff.toString(),
    missingUsers: [], // Users in published but not in derived
    extraUsers: [], // Users in derived but not in published
    balanceDifferences: [] // Address-level balance differences
  };

  // This would require storing the original leaf data or rebuilding from UserBalance
  // For now, we'll note that detailed comparison would require additional data

  console.log(`ℹ️  Detailed leaf-by-leaf comparison would require storing snapshot leaf data`);
  console.log(`   Consider implementing leaf storage for future snapshots`);

  return differences;
}

function printHumanReadableDiff(result: ComparisonResult): void {
  console.log(`\n📋 COMPARISON REPORT`);
  console.log(`==================`);
  console.log(`Snapshot ID: ${result.snapshotId}`);
  console.log(`Network: ${result.publishedMetadata.network}`);
  console.log(`Timestamp: ${result.publishedMetadata.timestamp.toISOString()}`);
  console.log(`Published TX: ${result.publishedMetadata.txHash}`);

  console.log(`\n🌳 Merkle Roots:`);
  console.log(`Published: ${result.publishedRoot}`);
  console.log(`Derived:   ${result.derivedRoot}`);
  console.log(`Match:     ${result.matches ? '✅ YES' : '❌ NO'}`);

  console.log(`\n📊 Metadata Comparison:`);
  console.log(`Users:    Published=${result.publishedMetadata.totalUsers}, Derived=${result.derivedMetadata.totalUsers}`);
  console.log(`Balance:  Published=${result.publishedMetadata.totalBalance}, Derived=${result.derivedMetadata.totalBalance}`);

  if (result.differences) {
    console.log(`\n⚠️  Differences Found:`);
    console.log(`User Count Diff: ${result.differences.userCountDiff}`);
    console.log(`Balance Diff: ${result.differences.balanceDiff}`);

    if (result.differences.missingUsers.length > 0) {
      console.log(`Missing Users (${result.differences.missingUsers.length}): ${result.differences.missingUsers.slice(0, 5).join(', ')}${result.differences.missingUsers.length > 5 ? '...' : ''}`);
    }

    if (result.differences.extraUsers.length > 0) {
      console.log(`Extra Users (${result.differences.extraUsers.length}): ${result.differences.extraUsers.slice(0, 5).join(', ')}${result.differences.extraUsers.length > 5 ? '...' : ''}`);
    }

    if (result.differences.balanceDifferences.length > 0) {
      console.log(`Balance Differences (${result.differences.balanceDifferences.length}):`);
      result.differences.balanceDifferences.slice(0, 5).forEach((diff, i) => {
        console.log(`  ${i + 1}. ${diff.address}: ${diff.publishedAmount} → ${diff.derivedAmount} (${diff.difference})`);
      });
      if (result.differences.balanceDifferences.length > 5) {
        console.log(`  ... and ${result.differences.balanceDifferences.length - 5} more`);
      }
    }
  }

  console.log(`\n💡 Recommendations:`);
  if (result.matches) {
    console.log(`✅ Snapshot is consistent with transaction log`);
    console.log(`✅ No action required`);
  } else {
    console.log(`❌ Snapshot inconsistency detected`);
    console.log(`🔍 Investigate transaction log integrity`);
    console.log(`🔍 Check for missing or corrupted transactions`);
    console.log(`🔍 Verify UserBalance synchronization`);
    console.log(`⚠️  Consider republishing snapshot after fixing issues`);
  }
}

async function main() {
  const snapshotIdArg = process.argv[2];

  if (!snapshotIdArg) {
    console.log(`Usage: npx tsx scripts/compare_merkle_vs_txlog.ts <snapshotId>`);
    console.log(`\nExample:`);
    console.log(`  npx tsx scripts/compare_merkle_vs_txlog.ts 123`);

    // Show available snapshots
    const recentSnapshots = await prisma.merkleSnapshot.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        merkleRoot: true,
        timestamp: true,
        network: true,
        totalUsers: true
      }
    });

    if (recentSnapshots.length > 0) {
      console.log(`\n📋 Recent Snapshots:`);
      recentSnapshots.forEach(snapshot => {
        console.log(`  ${snapshot.id}: ${snapshot.merkleRoot.slice(0, 10)}... (${snapshot.network}, ${snapshot.totalUsers} users, ${snapshot.timestamp.toISOString()})`);
      });
    }

    process.exit(1);
  }

  const snapshotId = parseInt(snapshotIdArg);
  if (isNaN(snapshotId)) {
    console.error(`❌ Invalid snapshot ID: ${snapshotIdArg}`);
    process.exit(1);
  }

  try {
    const result = await compareMerkleVsTxLog(snapshotId);

    // Print human-readable diff
    printHumanReadableDiff(result);

    // Save detailed result
    const timestamp = Date.now();
    const reportPath = `/tmp/claude/merkle_comparison_${snapshotId}_${timestamp}.json`;

    try {
      const fs = require('fs');
      fs.mkdirSync('/tmp/claude', { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
      console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    } catch (error) {
      console.warn(`⚠️  Could not save report to file: ${error}`);
    }

    // Exit with appropriate code
    if (result.matches) {
      console.log(`\n✅ Comparison PASSED - Snapshot is consistent`);
      process.exit(0);
    } else {
      console.log(`\n❌ Comparison FAILED - Snapshot inconsistency detected`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`❌ Comparison failed:`, error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}