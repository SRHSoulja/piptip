#!/usr/bin/env npx tsx
// scripts/backfill_balance_deltas.ts
// Backfill BalanceDelta records from existing Transaction records

import "dotenv/config";
import { prisma } from "../src/services/db.js";
import { parseUnits, formatUnits } from "ethers";
import { writeFileSync, mkdirSync } from "fs";

interface BackfillReport {
  timestamp: string;
  totalTransactions: number;
  processedTransactions: number;
  skippedTransactions: number;
  createdBalanceDeltas: number;
  errors: Array<{
    transactionId: number;
    error: string;
  }>;
  userBalanceRecon: Array<{
    userId: number;
    tokenId: number;
    userBalanceAmount: string;
    derivedAmount: string;
    difference: string;
    withinTolerance: boolean;
  }>;
}

async function backfillBalanceDeltas(): Promise<BackfillReport> {
  console.log(`🔄 Starting BalanceDelta backfill from existing Transaction records...`);

  const report: BackfillReport = {
    timestamp: new Date().toISOString(),
    totalTransactions: 0,
    processedTransactions: 0,
    skippedTransactions: 0,
    createdBalanceDeltas: 0,
    errors: [],
    userBalanceRecon: []
  };

  try {
    // Get all existing transactions that don't have balance deltas
    const transactions = await prisma.transaction.findMany({
      where: {
        balanceDeltas: { none: {} } // Only transactions without existing deltas
      },
      include: {
        Token: { select: { decimals: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    report.totalTransactions = transactions.length;
    console.log(`📊 Found ${transactions.length} transactions without BalanceDelta records`);

    for (const transaction of transactions) {
      try {
        console.log(`Processing transaction ${transaction.id}: ${transaction.type}`);

        const balanceDeltas = await deriveBalanceDeltas(transaction);

        if (balanceDeltas.length > 0) {
          // Create BalanceDelta records
          await prisma.$transaction(async (tx) => {
            for (const delta of balanceDeltas) {
              await tx.balanceDelta.create({
                data: {
                  transactionId: transaction.id,
                  tokenId: delta.tokenId,
                  userId: delta.userId,
                  amountDelta: delta.amountDelta,
                  reason: delta.reason,
                  createdAt: transaction.createdAt // Preserve original timestamp
                }
              });
            }
          });

          report.createdBalanceDeltas += balanceDeltas.length;
          console.log(`  ✅ Created ${balanceDeltas.length} balance deltas`);
        } else {
          report.skippedTransactions++;
          console.log(`  ⏭️  Skipped (no balance changes derived)`);
        }

        report.processedTransactions++;

      } catch (error) {
        report.errors.push({
          transactionId: transaction.id,
          error: error instanceof Error ? error.message : String(error)
        });
        console.error(`  ❌ Error processing transaction ${transaction.id}:`, error);
      }
    }

    // Reconcile user balances with derived amounts
    console.log(`\n🔍 Reconciling UserBalance with derived amounts...`);
    await reconcileUserBalances(report);

    console.log(`\n✅ Backfill completed!`);
    console.log(`   Processed: ${report.processedTransactions}/${report.totalTransactions}`);
    console.log(`   Created BalanceDeltas: ${report.createdBalanceDeltas}`);
    console.log(`   Errors: ${report.errors.length}`);

    return report;

  } catch (error) {
    console.error(`❌ Backfill failed:`, error);
    throw error;
  }
}

async function deriveBalanceDeltas(transaction: any): Promise<Array<{
  tokenId: number;
  userId?: number;
  amountDelta: string;
  reason: string;
}>> {
  const balanceDeltas: Array<{
    tokenId: number;
    userId?: number;
    amountDelta: string;
    reason: string;
  }> = [];

  const decimals = transaction.Token?.decimals || 18;

  // Handle mixed format: some amounts are already in atomic units, others are human-readable
  const rawAmount = String(transaction.amount || "0");
  const rawFee = String(transaction.fee || "0");

  // If amount is very large (>1e15), assume it's already in atomic units
  // Otherwise, treat as human-readable and convert
  const isAmountAtomic = Number(rawAmount) >= 1e15;
  const isFeeAtomic = Number(rawFee) >= 1e15;

  const amount = isAmountAtomic ? BigInt(rawAmount) : parseUnits(rawAmount, decimals);
  const fee = isFeeAtomic ? BigInt(rawFee) : parseUnits(rawFee, decimals);

  switch (transaction.type) {
    case 'DEPOSIT':
      if (transaction.userId && transaction.tokenId) {
        balanceDeltas.push({
          tokenId: transaction.tokenId,
          userId: transaction.userId,
          amountDelta: formatUnits(amount, decimals),
          reason: 'deposit'
        });
      }
      break;

    case 'WITHDRAW':
      if (transaction.userId && transaction.tokenId) {
        balanceDeltas.push({
          tokenId: transaction.tokenId,
          userId: transaction.userId,
          amountDelta: formatUnits(-(amount + fee), decimals),
          reason: 'withdraw'
        });

        if (fee > 0n) {
          balanceDeltas.push({
            tokenId: transaction.tokenId,
            amountDelta: formatUnits(fee, decimals),
            reason: 'withdraw_fee'
          });
        }
      }
      break;

    case 'TIP':
      if (transaction.userId && transaction.tokenId) {
        balanceDeltas.push({
          tokenId: transaction.tokenId,
          userId: transaction.userId,
          amountDelta: formatUnits(-(amount + fee), decimals),
          reason: 'tip_sent'
        });
      }

      if (transaction.otherUserId && transaction.tokenId) {
        balanceDeltas.push({
          tokenId: transaction.tokenId,
          userId: transaction.otherUserId,
          amountDelta: formatUnits(amount, decimals),
          reason: 'tip_received'
        });
      }

      if (fee > 0n && transaction.tokenId) {
        balanceDeltas.push({
          tokenId: transaction.tokenId,
          amountDelta: formatUnits(fee, decimals),
          reason: 'tip_fee'
        });
      }
      break;

    case 'MATCH_WAGER':
      if (transaction.userId && transaction.tokenId) {
        balanceDeltas.push({
          tokenId: transaction.tokenId,
          userId: transaction.userId,
          amountDelta: formatUnits(-amount, decimals),
          reason: 'match_wager'
        });
      }
      break;

    case 'MATCH_PAYOUT':
      if (transaction.userId && transaction.tokenId) {
        balanceDeltas.push({
          tokenId: transaction.tokenId,
          userId: transaction.userId,
          amountDelta: formatUnits(amount, decimals),
          reason: 'match_payout'
        });
      }
      break;

    case 'MATCH_RAKE':
      if (transaction.tokenId) {
        balanceDeltas.push({
          tokenId: transaction.tokenId,
          amountDelta: formatUnits(amount, decimals),
          reason: 'match_rake'
        });
      }
      break;

    case 'GROUP_TIP_CONTRIBUTION':
      if (transaction.userId && transaction.tokenId) {
        balanceDeltas.push({
          tokenId: transaction.tokenId,
          userId: transaction.userId,
          amountDelta: formatUnits(-amount, decimals),
          reason: 'group_tip_contribution'
        });
      }
      break;

    case 'GROUP_TIP_PAYOUT':
      if (transaction.userId && transaction.tokenId) {
        balanceDeltas.push({
          tokenId: transaction.tokenId,
          userId: transaction.userId,
          amountDelta: formatUnits(amount, decimals),
          reason: 'group_tip_payout'
        });
      }
      break;

    case 'GROUP_TIP_REFUND':
      if (transaction.userId && transaction.tokenId) {
        balanceDeltas.push({
          tokenId: transaction.tokenId,
          userId: transaction.userId,
          amountDelta: formatUnits(amount, decimals),
          reason: 'group_tip_refund'
        });
      }
      break;

    default:
      // Generic case: treat as user operation if we have userId and tokenId
      if (transaction.userId && transaction.tokenId && amount !== 0n) {
        balanceDeltas.push({
          tokenId: transaction.tokenId,
          userId: transaction.userId,
          amountDelta: formatUnits(amount, decimals),
          reason: transaction.type.toLowerCase()
        });
      }
      break;
  }

  return balanceDeltas;
}

async function reconcileUserBalances(report: BackfillReport): Promise<void> {
  // Get all current user balances
  const userBalances = await prisma.userBalance.findMany({
    include: {
      Token: { select: { decimals: true } }
    }
  });

  // Aggregate balance deltas per user/token
  const derivedBalances = await prisma.$queryRaw`
    SELECT
      bd."userId" as user_id,
      bd."tokenId" as token_id,
      t.decimals,
      SUM(CAST(bd."amountDelta" AS DECIMAL)) as total_delta
    FROM "BalanceDelta" bd
    JOIN "Transaction" tx ON bd."transactionId" = tx.id
    JOIN "Token" t ON bd."tokenId" = t.id
    WHERE tx.status = 'CONFIRMED'
      AND bd."userId" IS NOT NULL
    GROUP BY bd."userId", bd."tokenId", t.decimals
  ` as Array<{
    user_id: number;
    token_id: number;
    decimals: number;
    total_delta: string;
  }>;

  const tolerance = 1000n; // 1000 wei tolerance

  for (const userBalance of userBalances) {
    const derived = derivedBalances.find(
      d => d.user_id === userBalance.userId && d.token_id === userBalance.tokenId
    );

    if (!derived) continue;

    const userBalanceAtomic = parseUnits(userBalance.amount.toString(), userBalance.Token.decimals);
    const derivedAtomic = parseUnits(String(derived.total_delta), derived.decimals);
    const difference = userBalanceAtomic > derivedAtomic
      ? userBalanceAtomic - derivedAtomic
      : derivedAtomic - userBalanceAtomic;

    const withinTolerance = difference <= tolerance;

    report.userBalanceRecon.push({
      userId: userBalance.userId,
      tokenId: userBalance.tokenId,
      userBalanceAmount: formatUnits(userBalanceAtomic, userBalance.Token.decimals),
      derivedAmount: formatUnits(derivedAtomic, derived.decimals),
      difference: formatUnits(difference, userBalance.Token.decimals),
      withinTolerance
    });

    if (!withinTolerance) {
      console.warn(`⚠️  Balance mismatch for user ${userBalance.userId}, token ${userBalance.tokenId}`);
      console.warn(`   UserBalance: ${formatUnits(userBalanceAtomic, userBalance.Token.decimals)}`);
      console.warn(`   Derived: ${formatUnits(derivedAtomic, derived.decimals)}`);
      console.warn(`   Difference: ${formatUnits(difference, userBalance.Token.decimals)}`);
    }
  }

  const mismatches = report.userBalanceRecon.filter(r => !r.withinTolerance);
  console.log(`📊 Balance reconciliation: ${report.userBalanceRecon.length} checked, ${mismatches.length} mismatches`);
}

async function main() {
  try {
    const report = await backfillBalanceDeltas();

    // Create reports directory
    try {
      mkdirSync('reports', { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Save report
    const reportPath = `reports/balance_backfill_${Date.now()}.json`;
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Report saved to: ${reportPath}`);

    // Exit with non-zero if there were errors or significant mismatches
    const significantMismatches = report.userBalanceRecon.filter(r => !r.withinTolerance).length;
    if (report.errors.length > 0 || significantMismatches > 0) {
      console.warn(`⚠️  Backfill completed with issues:`);
      console.warn(`   Errors: ${report.errors.length}`);
      console.warn(`   Balance mismatches: ${significantMismatches}`);
      process.exit(1);
    }

    console.log(`✅ Backfill completed successfully!`);

  } catch (error) {
    console.error(`❌ Backfill script failed:`, error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}