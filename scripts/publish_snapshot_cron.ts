#!/usr/bin/env npx tsx
// scripts/publish_snapshot_cron.ts
// Automated snapshot publishing with safety checks

import "dotenv/config";
import { getNetworkDisplayName, isMainnet, requireMainnetConfirmation } from "../src/services/network.js";

async function publishSnapshotWithSafety(confirmMainnet: boolean = false): Promise<void> {
  const networkName = getNetworkDisplayName();
  console.log(`🚀 Starting scheduled snapshot publishing for ${networkName}`);

  try {
    // Mainnet safety check
    requireMainnetConfirmation(confirmMainnet);

    // Step 1: Gas threshold check
    console.log(`\n⛽ Step 1: Checking gas conditions...`);
    const { L1CostCalculator } = await import('./l1_cost.js');
    const costCalculator = new L1CostCalculator();

    const shouldPublish = await costCalculator.shouldPublishBasedOnL1Cost();
    if (!shouldPublish) {
      console.log(`⏳ Skipping publish due to high L1 gas costs`);
      console.log(`💡 Will retry on next cron run`);
      process.exit(0); // Exit successfully but don't publish
    }

    // Step 2: Reorg protection check
    console.log(`\n🔒 Step 2: Checking reorg protection...`);
    const { StateSyncMonitor } = await import('./state_sync.js');
    const syncMonitor = new StateSyncMonitor();

    const { consensus } = await syncMonitor.checkConsensus();
    if (!consensus) {
      console.log(`⚠️  Network not in consensus - waiting for sync`);

      // Wait for sync with 5-minute timeout
      const synced = await syncMonitor.waitForSync(300000);
      if (!synced) {
        console.error(`❌ Network sync timeout - aborting publish`);
        process.exit(1);
      }
    }

    // Step 3: Transaction log validation
    console.log(`\n🔍 Step 3: Validating transaction log integrity...`);

    // Quick validation of recent data (last 24 hours)
    const { validateTransactionLogIntegrity } = await import('./validate_transaction_log_integrity.js');
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const now = new Date();

    const validationReport = await validateTransactionLogIntegrity(oneDayAgo, now);

    if (!validationReport.summary.overallValid) {
      console.error(`❌ Transaction log validation failed:`);
      console.error(`   Critical issues: ${validationReport.summary.criticalIssues}`);
      console.error(`   Balance mismatches: ${validationReport.balanceConsistency.mismatches}`);
      console.error(`   Blockchain tx errors: ${validationReport.blockchainValidation.errors + validationReport.blockchainValidation.notFound}`);

      if (validationReport.summary.criticalIssues > 5) {
        console.error(`🚨 Too many critical issues - aborting publish`);
        process.exit(1);
      } else {
        console.warn(`⚠️  Some issues found but proceeding with publish`);
      }
    }

    // Step 4: Build merkle from transaction log
    console.log(`\n🌳 Step 4: Building merkle tree from transaction log...`);

    // Enable transaction log mode for this publish
    process.env.MERKLE_FROM_TXLOG = 'true';

    const cutoffTime = new Date();
    console.log(`📅 Using cutoff time: ${cutoffTime.toISOString()}`);

    // Step 5: Publish snapshot
    console.log(`\n📝 Step 5: Publishing snapshot...`);

    const { merklePublisher } = await import('../src/services/merkle_publisher.js');

    const privateKey = process.env.AGW_SESSION_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('AGW_SESSION_PRIVATE_KEY environment variable is required');
    }

    // Ensure private key has 0x prefix
    const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

    const result = await merklePublisher.publishSnapshot(formattedKey, cutoffTime);

    if (result.success) {
      console.log(`\n✅ Snapshot published successfully!`);
      console.log(`   Network: ${result.network}`);
      console.log(`   Chain ID: ${result.chainId}`);
      console.log(`   TX Hash: ${result.txHash}`);
      console.log(`   Registry: ${result.registryContract}`);

      if (result.snapshot) {
        console.log(`   Merkle Root: ${result.snapshot.merkleRoot}`);
        console.log(`   IPFS Hash: ${result.snapshot.ipfsHash}`);
        console.log(`   Total Users: ${result.snapshot.totalUsers}`);
        console.log(`   Total Balance: ${result.snapshot.totalBalance}`);
      }

      // Step 6: Post-publish validation
      console.log(`\n🔍 Step 6: Post-publish validation...`);

      if (result.snapshot) {
        // Wait a bit for the transaction to be indexed
        console.log(`⏳ Waiting 30 seconds for transaction indexing...`);
        await new Promise(resolve => setTimeout(resolve, 30000));

        // Verify the snapshot was stored correctly
        const { prisma } = await import('../src/services/db.js');
        const storedSnapshot = await prisma.merkleSnapshot.findUnique({
          where: { merkleRoot: result.snapshot.merkleRoot }
        });

        if (storedSnapshot) {
          console.log(`✅ Snapshot verified in database`);
        } else {
          console.error(`❌ Snapshot not found in database - possible storage issue`);
        }

        // Verify on blockchain
        const verified = await merklePublisher.verifySnapshot(result.snapshot.merkleRoot);
        if (verified) {
          console.log(`✅ Snapshot verified on blockchain`);
        } else {
          console.error(`❌ Snapshot verification failed on blockchain`);
        }
      }

      console.log(`\n🎉 Scheduled snapshot publishing completed successfully!`);

    } else {
      console.error(`❌ Snapshot publishing failed: ${result.error}`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`❌ Scheduled snapshot publishing failed:`, error);

    // Send alert notification (placeholder)
    console.error(`🚨 ALERT: Automated snapshot publishing failed on ${networkName}`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`   Time: ${new Date().toISOString()}`);

    process.exit(1);
  }
}

async function main() {
  const networkName = getNetworkDisplayName();
  console.log(`📅 Scheduled Snapshot Publisher for ${networkName}`);

  const confirmMainnet = process.argv.includes('--confirm-mainnet');
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    console.log(`🧪 DRY RUN MODE - No actual publishing will occur`);
    console.log(`✅ All safety checks would be performed`);
    console.log(`✅ Merkle tree would be built from transaction log`);
    console.log(`✅ Gas costs would be estimated`);
    console.log(`💡 Use without --dry-run to actually publish`);
    return;
  }

  if (isMainnet() && !confirmMainnet) {
    console.error(`🚨 MAINNET SAFETY CHECK`);
    console.error(`   This will publish a snapshot to Abstract Mainnet using real ETH`);
    console.error(`   Add --confirm-mainnet flag to proceed`);
    console.error(`   Example: npm run cron:publish:mainnet`);
    process.exit(1);
  }

  await publishSnapshotWithSafety(confirmMainnet);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}