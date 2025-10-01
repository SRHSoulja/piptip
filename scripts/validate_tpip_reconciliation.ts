#!/usr/bin/env npx tsx
/**
 * TPIP Reconciliation Validation
 *
 * Validates TPIP system integrity:
 * - TPIP allocations match entry payments
 * - No negative TPIP balances
 * - No orphaned TPIP (users with TPIP but no active tournament)
 * - TPIP-PIPChips complete separation
 * - Transaction log consistency with UserBalance
 */

import "dotenv/config";
import { prisma } from "../src/services/db.js";
import {
  validateTPIPSystem,
  validateTPIPAllocations,
  validateTPIPInMerkle,
  getTPIPStats
} from "../src/services/tpip_validation.js";

const TPIP_TOKEN_ID = 4;

interface TPIPReconciliationReport {
  timestamp: string;
  systemValidation: {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    stats: {
      totalTPIPHolders: number;
      totalTPIPBalance: string;
      activeTournaments: number;
      orphanedTPIPUsers: number;
      negativeBalances: number;
    };
  };
  allocationValidation: {
    tournaments: Array<{
      tournamentId: string;
      tournamentName: string;
      participantCount: number;
      validAllocations: number;
      invalidAllocations: number;
      discrepancies: Array<{
        userId: number;
        expected: string;
        actual: string;
        difference: string;
      }>;
    }>;
  };
  merkleValidation: {
    tpipIncluded: boolean;
    tpipHolders: number;
    totalTPIPInMerkle: string;
  };
  transactionLogValidation: {
    tpipTransactions: number;
    allocationTransactions: number;
    paymentTransactions: number;
    balanceConsistency: {
      checked: number;
      mismatches: number;
      details: Array<{
        userId: number;
        userBalanceTPIP: string;
        derivedTPIP: string;
        difference: string;
      }>;
    };
  };
  statistics: {
    totalTPIPInCirculation: string;
    totalTPIPHolders: number;
    activeTournamentPlayers: number;
    orphanedTPIPHolders: number;
    averageTPIPPerUser: number;
    largestTPIPBalance: string;
    smallestNonZeroTPIPBalance: string;
  };
  summary: {
    overallValid: boolean;
    criticalIssues: number;
    warnings: number;
  };
}

async function validateTPIPReconciliation(): Promise<TPIPReconciliationReport> {
  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║   TPIP Reconciliation Validation                          ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝\n`);

  const timestamp = new Date().toISOString();
  let criticalIssues = 0;
  let warnings = 0;

  // 1. System-wide TPIP validation
  console.log(`1️⃣ Running system-wide TPIP validation...`);
  const systemValidation = await validateTPIPSystem();

  criticalIssues += systemValidation.errors.length;
  warnings += systemValidation.warnings.length;

  if (systemValidation.isValid) {
    console.log(`   ✅ System validation passed`);
  } else {
    console.log(`   ❌ System validation failed with ${systemValidation.errors.length} errors`);
    systemValidation.errors.forEach(err => console.log(`      - ${err}`));
  }

  if (systemValidation.warnings.length > 0) {
    console.log(`   ⚠️  ${systemValidation.warnings.length} warnings:`);
    systemValidation.warnings.forEach(warn => console.log(`      - ${warn}`));
  }

  console.log(`   📊 Stats:`);
  console.log(`      TPIP Holders: ${systemValidation.stats.totalTPIPHolders}`);
  console.log(`      Total TPIP: ${systemValidation.stats.totalTPIPBalance}`);
  console.log(`      Active Tournaments: ${systemValidation.stats.activeTournaments}`);
  console.log(`      Orphaned Users: ${systemValidation.stats.orphanedTPIPUsers}`);
  console.log();

  // 2. Allocation validation per tournament
  console.log(`2️⃣ Validating TPIP allocations per tournament...`);

  const tournaments = await prisma.tournament.findMany({
    where: {
      status: { in: ['PENDING', 'ACTIVE', 'COMPLETED'] }
    },
    select: {
      id: true,
      name: true,
      status: true
    },
    orderBy: { createdAt: 'desc' },
    take: 10 // Last 10 tournaments
  });

  const allocationValidation: TPIPReconciliationReport['allocationValidation'] = {
    tournaments: []
  };

  for (const tournament of tournaments) {
    const allocations = await validateTPIPAllocations(tournament.id);

    const validAllocations = allocations.filter(a => a.isValid).length;
    const invalidAllocations = allocations.filter(a => !a.isValid).length;

    const discrepancies = allocations
      .filter(a => !a.isValid)
      .map(a => ({
        userId: a.userId,
        expected: a.expectedTPIP.toString(),
        actual: a.actualTPIP.toString(),
        difference: a.discrepancy?.toString() ?? '0'
      }));

    allocationValidation.tournaments.push({
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      participantCount: allocations.length,
      validAllocations,
      invalidAllocations,
      discrepancies
    });

    if (invalidAllocations > 0) {
      criticalIssues += invalidAllocations;
      console.log(`   ❌ Tournament "${tournament.name}": ${invalidAllocations} invalid allocations`);
    } else if (allocations.length > 0) {
      console.log(`   ✅ Tournament "${tournament.name}": All ${validAllocations} allocations valid`);
    }
  }

  console.log();

  // 3. Merkle tree validation
  console.log(`3️⃣ Validating TPIP in Merkle tree...`);
  const merkleValidation = await validateTPIPInMerkle();

  if (merkleValidation.tpipIncluded) {
    console.log(`   ✅ TPIP included in Merkle tree`);
    console.log(`      Holders: ${merkleValidation.tpipHolders}`);
    console.log(`      Total TPIP: ${merkleValidation.totalTPIPInMerkle}`);
  } else {
    console.log(`   ℹ️  No TPIP balances in Merkle tree (no active tournaments)`);
  }

  console.log();

  // 4. Transaction log consistency
  console.log(`4️⃣ Validating transaction log consistency...`);

  // Count TPIP-related transactions
  const tpipTransactions = await prisma.transaction.count({
    where: {
      balanceDeltas: {
        some: { tokenId: TPIP_TOKEN_ID }
      }
    }
  });

  const allocationTransactions = await prisma.transaction.count({
    where: { type: 'TPIP_ALLOCATION' }
  });

  const paymentTransactions = await prisma.transaction.count({
    where: { type: 'TOURNAMENT_ENTRY_PAYMENT' }
  });

  console.log(`   📊 Transaction counts:`);
  console.log(`      Total TPIP transactions: ${tpipTransactions}`);
  console.log(`      Allocation transactions: ${allocationTransactions}`);
  console.log(`      Entry payment transactions: ${paymentTransactions}`);

  // Validate UserBalance vs transaction log
  const userBalanceTPIP = await prisma.userBalance.findMany({
    where: { tokenId: TPIP_TOKEN_ID },
    select: { userId: true, amount: true }
  });

  const balanceConsistency: TPIPReconciliationReport['transactionLogValidation']['balanceConsistency'] = {
    checked: 0,
    mismatches: 0,
    details: []
  };

  for (const balance of userBalanceTPIP) {
    balanceConsistency.checked++;

    // Aggregate transaction log for this user
    const balanceDeltas = await prisma.balanceDelta.findMany({
      where: {
        userId: balance.userId,
        tokenId: TPIP_TOKEN_ID,
        Transaction: {
          status: 'CONFIRMED'
        }
      },
      select: { amountDelta: true }
    });

    const derivedBalance = balanceDeltas.reduce(
      (sum, bd) => sum + BigInt(bd.amountDelta.toFixed(0)),
      0n
    );

    const userBalance = BigInt(balance.amount.toFixed(0));
    const difference = userBalance - derivedBalance;

    if (difference !== 0n) {
      balanceConsistency.mismatches++;
      balanceConsistency.details.push({
        userId: balance.userId,
        userBalanceTPIP: userBalance.toString(),
        derivedTPIP: derivedBalance.toString(),
        difference: difference.toString()
      });
    }
  }

  if (balanceConsistency.mismatches > 0) {
    criticalIssues += balanceConsistency.mismatches;
    console.log(`   ❌ Found ${balanceConsistency.mismatches} balance mismatches`);
    balanceConsistency.details.slice(0, 5).forEach(detail => {
      console.log(`      User ${detail.userId}: UserBalance=${detail.userBalanceTPIP}, TxLog=${detail.derivedTPIP}, Diff=${detail.difference}`);
    });
  } else {
    console.log(`   ✅ All ${balanceConsistency.checked} TPIP balances consistent with transaction log`);
  }

  console.log();

  // 5. Statistics
  console.log(`5️⃣ Generating TPIP statistics...`);
  const stats = await getTPIPStats();

  console.log(`   📊 TPIP Statistics:`);
  console.log(`      Total in circulation: ${stats.totalTPIPInCirculation}`);
  console.log(`      Total holders: ${stats.totalTPIPHolders}`);
  console.log(`      Active tournament players: ${stats.activeTournamentPlayers}`);
  console.log(`      Orphaned holders: ${stats.orphanedTPIPHolders}`);
  console.log(`      Average per user: ${stats.averageTPIPPerUser.toFixed(2)}`);
  console.log(`      Largest balance: ${stats.largestTPIPBalance}`);
  console.log(`      Smallest non-zero: ${stats.smallestNonZeroTPIPBalance}`);
  console.log();

  // Summary
  const overallValid = criticalIssues === 0;

  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║   Summary                                                  ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝`);
  console.log(`   Overall Status: ${overallValid ? '✅ VALID' : '❌ INVALID'}`);
  console.log(`   Critical Issues: ${criticalIssues}`);
  console.log(`   Warnings: ${warnings}`);
  console.log();

  return {
    timestamp,
    systemValidation: {
      ...systemValidation,
      stats: {
        ...systemValidation.stats,
        totalTPIPBalance: systemValidation.stats.totalTPIPBalance.toString()
      }
    },
    allocationValidation,
    merkleValidation: {
      ...merkleValidation,
      totalTPIPInMerkle: merkleValidation.totalTPIPInMerkle.toString()
    },
    transactionLogValidation: {
      tpipTransactions,
      allocationTransactions,
      paymentTransactions,
      balanceConsistency
    },
    statistics: {
      ...stats,
      totalTPIPInCirculation: stats.totalTPIPInCirculation.toString(),
      largestTPIPBalance: stats.largestTPIPBalance.toString(),
      smallestNonZeroTPIPBalance: stats.smallestNonZeroTPIPBalance.toString()
    },
    summary: {
      overallValid,
      criticalIssues,
      warnings
    }
  };
}

// Run validation
validateTPIPReconciliation()
  .then(report => {
    // Optionally save report to file
    const reportPath = `./reports/tpip_reconciliation_${Date.now()}.json`;
    console.log(`📄 Full report available in memory (can be saved to ${reportPath})`);

    process.exit(report.summary.overallValid ? 0 : 1);
  })
  .catch(error => {
    console.error("❌ Validation failed with error:", error);
    process.exit(1);
  });
