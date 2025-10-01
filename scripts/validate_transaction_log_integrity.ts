#!/usr/bin/env npx tsx
// scripts/validate_transaction_log_integrity.ts
// Validate transaction log integrity and consistency

import "dotenv/config";
import { prisma } from "../src/services/db.js";
import { JsonRpcProvider } from "ethers";
import { getAbstractRpcUrl } from "../src/services/network.js";
import { parseUnits, formatUnits } from "ethers";

interface ValidationReport {
  timestamp: string;
  timeWindow: {
    start: Date;
    end: Date;
  };
  balanceConsistency: {
    checked: number;
    mismatches: number;
    details: Array<{
      userId: number;
      tokenId: number;
      userBalance: string;
      derivedBalance: string;
      difference: string;
    }>;
  };
  blockchainValidation: {
    checked: number;
    notFound: number;
    errors: number;
    details: Array<{
      transactionId: number;
      txHash: string;
      status: 'EXISTS' | 'NOT_FOUND' | 'ERROR';
      error?: string;
    }>;
  };
  merkleConsistency: {
    latestSnapshot?: {
      merkleRoot: string;
      timestamp: Date;
      derivedRoot: string;
      matches: boolean;
    };
  };
  summary: {
    overallValid: boolean;
    criticalIssues: number;
    warnings: number;
  };
}

async function validateTransactionLogIntegrity(
  startDate?: Date,
  endDate?: Date
): Promise<ValidationReport> {
  console.log(`🔍 Starting transaction log integrity validation...`);

  const start = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
  const end = endDate || new Date();

  console.log(`📅 Time window: ${start.toISOString()} to ${end.toISOString()}`);

  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    timeWindow: { start, end },
    balanceConsistency: {
      checked: 0,
      mismatches: 0,
      details: []
    },
    blockchainValidation: {
      checked: 0,
      notFound: 0,
      errors: 0,
      details: []
    },
    merkleConsistency: {},
    summary: {
      overallValid: true,
      criticalIssues: 0,
      warnings: 0
    }
  };

  try {
    // 1. Validate balance consistency
    console.log(`\n1️⃣ Validating balance consistency...`);
    await validateBalanceConsistency(report, start, end);

    // 2. Validate blockchain transactions
    console.log(`\n2️⃣ Validating blockchain transactions...`);
    await validateBlockchainTransactions(report, start, end);

    // 3. Validate merkle consistency
    console.log(`\n3️⃣ Validating merkle consistency...`);
    await validateMerkleConsistency(report, end);

    // Generate summary
    report.summary.criticalIssues =
      report.balanceConsistency.mismatches +
      report.blockchainValidation.notFound +
      report.blockchainValidation.errors;

    report.summary.warnings = 0; // Add warning conditions as needed

    report.summary.overallValid = report.summary.criticalIssues === 0;

    console.log(`\n📊 Validation Summary:`);
    console.log(`   Balance checks: ${report.balanceConsistency.checked} (${report.balanceConsistency.mismatches} mismatches)`);
    console.log(`   Blockchain checks: ${report.blockchainValidation.checked} (${report.blockchainValidation.notFound} not found, ${report.blockchainValidation.errors} errors)`);
    console.log(`   Critical issues: ${report.summary.criticalIssues}`);
    console.log(`   Overall valid: ${report.summary.overallValid ? '✅ YES' : '❌ NO'}`);

    return report;

  } catch (error) {
    console.error(`❌ Validation failed:`, error);
    report.summary.overallValid = false;
    report.summary.criticalIssues++;
    throw error;
  }
}

async function validateBalanceConsistency(
  report: ValidationReport,
  start: Date,
  end: Date
): Promise<void> {
  // Get all user balances
  const userBalances = await prisma.userBalance.findMany({
    where: {
      amount: { gt: 0 }
    },
    include: {
      Token: { select: { decimals: true } }
    }
  });

  console.log(`📊 Checking ${userBalances.length} user balances...`);

  // Get derived balances from transaction log up to end date
  const derivedBalances = await prisma.$queryRaw`
    SELECT
      bd."userId" as user_id,
      bd."tokenId" as token_id,
      t.decimals,
      SUM(CAST(bd."amountDelta" AS DECIMAL)) as total_delta
    FROM "BalanceDelta" bd
    JOIN "Transaction" tx ON bd."transactionId" = tx.id
    JOIN "Token" t ON bd."tokenId" = t.id
    WHERE tx."createdAt" <= ${end}
      AND tx.status = 'CONFIRMED'
      AND bd."userId" IS NOT NULL
    GROUP BY bd."userId", bd."tokenId", t.decimals
  ` as Array<{
    user_id: number;
    token_id: number;
    decimals: number;
    total_delta: string;
  }>;

  const tolerance = 1000n; // 1000 wei tolerance for rounding errors

  for (const userBalance of userBalances) {
    report.balanceConsistency.checked++;

    const derived = derivedBalances.find(
      d => d.user_id === userBalance.userId && d.token_id === userBalance.tokenId
    );

    if (!derived) {
      // User has balance but no transaction history - this could be legacy data
      console.warn(`⚠️  User ${userBalance.userId} has balance for token ${userBalance.tokenId} but no transaction history`);
      continue;
    }

    const userBalanceAtomic = parseUnits(userBalance.amount.toString(), userBalance.Token.decimals);
    const derivedAtomic = parseUnits(String(derived.total_delta), derived.decimals);
    const difference = userBalanceAtomic > derivedAtomic
      ? userBalanceAtomic - derivedAtomic
      : derivedAtomic - userBalanceAtomic;

    if (difference > tolerance) {
      report.balanceConsistency.mismatches++;
      report.balanceConsistency.details.push({
        userId: userBalance.userId,
        tokenId: userBalance.tokenId,
        userBalance: formatUnits(userBalanceAtomic, userBalance.Token.decimals),
        derivedBalance: formatUnits(derivedAtomic, derived.decimals),
        difference: formatUnits(difference, userBalance.Token.decimals)
      });

      console.error(`❌ Balance mismatch: User ${userBalance.userId}, Token ${userBalance.tokenId}`);
      console.error(`   UserBalance: ${formatUnits(userBalanceAtomic, userBalance.Token.decimals)}`);
      console.error(`   Derived: ${formatUnits(derivedAtomic, derived.decimals)}`);
      console.error(`   Difference: ${formatUnits(difference, userBalance.Token.decimals)}`);
    }
  }

  console.log(`✅ Balance consistency check completed: ${report.balanceConsistency.mismatches} mismatches found`);
}

async function validateBlockchainTransactions(
  report: ValidationReport,
  start: Date,
  end: Date
): Promise<void> {
  // Get all transactions with txHash in the time window
  const transactions = await prisma.transaction.findMany({
    where: {
      createdAt: {
        gte: start,
        lte: end
      },
      txHash: {
        not: null
      }
    },
    select: {
      id: true,
      txHash: true
    }
  });

  console.log(`🔗 Checking ${transactions.length} blockchain transactions...`);

  if (transactions.length === 0) {
    console.log(`ℹ️  No blockchain transactions found in time window`);
    return;
  }

  const provider = new JsonRpcProvider(getAbstractRpcUrl());

  // Check transactions in batches to avoid rate limiting
  const batchSize = 10;
  for (let i = 0; i < transactions.length; i += batchSize) {
    const batch = transactions.slice(i, i + batchSize);

    await Promise.all(batch.map(async (transaction) => {
      report.blockchainValidation.checked++;

      try {
        const receipt = await provider.getTransactionReceipt(transaction.txHash!);

        if (!receipt) {
          report.blockchainValidation.notFound++;
          report.blockchainValidation.details.push({
            transactionId: transaction.id,
            txHash: transaction.txHash!,
            status: 'NOT_FOUND'
          });
          console.error(`❌ Transaction not found on blockchain: ${transaction.txHash}`);
        } else {
          report.blockchainValidation.details.push({
            transactionId: transaction.id,
            txHash: transaction.txHash!,
            status: 'EXISTS'
          });
        }

      } catch (error) {
        report.blockchainValidation.errors++;
        report.blockchainValidation.details.push({
          transactionId: transaction.id,
          txHash: transaction.txHash!,
          status: 'ERROR',
          error: error instanceof Error ? error.message : String(error)
        });
        console.error(`❌ Error checking transaction ${transaction.txHash}:`, error);
      }
    }));

    // Small delay between batches
    if (i + batchSize < transactions.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`✅ Blockchain validation completed: ${report.blockchainValidation.notFound} not found, ${report.blockchainValidation.errors} errors`);
}

async function validateMerkleConsistency(
  report: ValidationReport,
  cutoff: Date
): Promise<void> {
  // Get latest published snapshot
  const latestSnapshot = await prisma.merkleSnapshot.findFirst({
    where: {
      timestamp: { lte: cutoff }
    },
    orderBy: {
      timestamp: 'desc'
    }
  });

  if (!latestSnapshot) {
    console.log(`ℹ️  No published snapshots found before cutoff`);
    return;
  }

  console.log(`🌳 Validating merkle consistency for snapshot: ${latestSnapshot.merkleRoot.slice(0, 10)}...`);

  try {
    // Build merkle tree from transaction log at snapshot timestamp
    const { merklePublisher } = await import('../src/services/merkle_publisher.js');

    // Temporarily enable transaction log mode for validation
    const originalEnv = process.env.MERKLE_FROM_TXLOG;
    process.env.MERKLE_FROM_TXLOG = 'true';

    try {
      const treeData = await merklePublisher.generateMerkleTree(latestSnapshot.timestamp);

      const matches = treeData.merkleRoot === latestSnapshot.merkleRoot;

      report.merkleConsistency.latestSnapshot = {
        merkleRoot: latestSnapshot.merkleRoot,
        timestamp: latestSnapshot.timestamp,
        derivedRoot: treeData.merkleRoot,
        matches
      };

      if (matches) {
        console.log(`✅ Merkle root matches transaction log derivation`);
      } else {
        console.error(`❌ Merkle root mismatch:`);
        console.error(`   Published: ${latestSnapshot.merkleRoot}`);
        console.error(`   Derived: ${treeData.merkleRoot}`);
        report.summary.criticalIssues++;
      }

    } finally {
      // Restore original environment
      if (originalEnv !== undefined) {
        process.env.MERKLE_FROM_TXLOG = originalEnv;
      } else {
        delete process.env.MERKLE_FROM_TXLOG;
      }
    }

  } catch (error) {
    console.error(`❌ Merkle consistency check failed:`, error);
    report.summary.criticalIssues++;
  }
}

async function main() {
  const args = process.argv.slice(2);

  let startDate: Date | undefined;
  let endDate: Date | undefined;

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start' && args[i + 1]) {
      startDate = new Date(args[i + 1]);
      i++;
    } else if (args[i] === '--end' && args[i + 1]) {
      endDate = new Date(args[i + 1]);
      i++;
    }
  }

  try {
    const report = await validateTransactionLogIntegrity(startDate, endDate);

    // Save report
    const timestamp = Date.now();
    const reportPath = `/tmp/claude/validation_report_${timestamp}.json`;

    try {
      const { mkdirSync, writeFileSync } = await import('fs');
      mkdirSync('/tmp/claude', { recursive: true });
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\n📄 Report saved to: ${reportPath}`);
    } catch (error) {
      console.warn(`⚠️  Could not save report to file: ${error}`);
      console.log(`\n📄 Report:\n${JSON.stringify(report, null, 2)}`);
    }

    // Exit with appropriate code
    if (report.summary.overallValid) {
      console.log(`\n✅ Transaction log validation PASSED`);
      process.exit(0);
    } else {
      console.log(`\n❌ Transaction log validation FAILED`);
      console.log(`   Critical issues: ${report.summary.criticalIssues}`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`❌ Validation script failed:`, error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}