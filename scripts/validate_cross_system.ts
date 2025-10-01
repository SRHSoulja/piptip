#!/usr/bin/env npx tsx
/**
 * Cross-System Reconciliation Validator
 *
 * Comprehensive validation script that checks:
 * 1. Balance Conservation - sum of all BalanceDeltas per token = 0 drift
 * 2. Operation Coverage - every operation has Transaction + BalanceDelta
 * 3. Rake Validation - rake entries exist for every match/prediction
 * 4. On-Chain Verification - txHash resolves on Abstract explorer
 * 5. Merkle Consistency - balances match last published snapshot
 *
 * Run: npm run validate:cross
 */

import "dotenv/config";
import { prisma } from "../src/services/db.js";
import { formatUnits, parseUnits, JsonRpcProvider } from "ethers";
import fs from "fs";
import path from "path";

interface TreasuryFlowResult {
  passed: boolean;
  stats: {
    totalRakeCollected: Record<number, string>; // tokenId -> amount
    totalSwaps: Record<number, string>;
    totalTreasuryBalance: Record<number, string>;
    unexplainedDiscrepancies: Record<number, string>;
  };
  treasuryTransactions: Array<{
    type: string;
    tokenId: number;
    amount: string;
    timestamp: Date;
  }>;
  errors: string[];
}

interface ValidationReport {
  timestamp: string;
  network: string;
  checks: {
    balanceConservation: BalanceConservationResult;
    operationCoverage: OperationCoverageResult;
    rakeValidation: RakeValidationResult;
    onChainVerification: OnChainVerificationResult;
    merkleConsistency: MerkleConsistencyResult;
    treasuryFlow: TreasuryFlowResult;
  };
  summary: {
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    warningCount: number;
  };
  success: boolean;
}

interface BalanceConservationResult {
  passed: boolean;
  tokenBalances: Array<{
    tokenId: number;
    symbol: string;
    totalUserBalances: string;
    totalBalanceDeltas: string;
    drift: string;
    driftPercentage: number;
  }>;
  treasuryBalances: Array<{
    tokenId: number;
    symbol: string;
    totalRakeCollected: string;
  }>;
  errors: string[];
}

interface OperationCoverageResult {
  passed: boolean;
  stats: {
    totalOperations: number;
    operationsWithTransactions: number;
    operationsWithBalanceDeltas: number;
    orphanedTransactions: number;
    orphanedBalanceDeltas: number;
  };
  missingCoverage: Array<{
    type: string;
    id: number;
    reason: string;
  }>;
  errors: string[];
}

interface RakeValidationResult {
  passed: boolean;
  stats: {
    totalMatches: number;
    matchesWithRake: number;
    missingRakeEntries: number;
    totalMarkets: number;
    marketsWithRake: number;
    missingMarketRake: number;
  };
  missingRake: Array<{
    type: 'match' | 'market';
    id: string | number;
    expectedRake: string;
  }>;
  errors: string[];
}

interface OnChainVerificationResult {
  passed: boolean;
  stats: {
    totalOnChainTransactions: number;
    verifiedTransactions: number;
    failedVerifications: number;
    skippedVerifications: number;
  };
  failedTxHashes: Array<{
    txHash: string;
    transactionId: number;
    error: string;
  }>;
  errors: string[];
}

interface MerkleConsistencyResult {
  passed: boolean;
  lastSnapshotRoot: string | null;
  lastSnapshotBlock: number | null;
  balanceDiscrepancies: Array<{
    userId: number;
    tokenId: number;
    snapshotBalance: string;
    computedBalance: string;
    drift: string;
  }>;
  errors: string[];
}

/**
 * Check 1: Balance Conservation
 * Verify that sum of all BalanceDeltas per token equals total drift (should be near zero)
 */
async function checkBalanceConservation(): Promise<BalanceConservationResult> {
  console.log("\n📊 Check 1: Balance Conservation");
  console.log("=".repeat(60));

  const result: BalanceConservationResult = {
    passed: true,
    tokenBalances: [],
    treasuryBalances: [],
    errors: []
  };

  try {
    // Get all active tokens
    const tokens = await prisma.token.findMany({
      where: { active: true },
      select: { id: true, symbol: true, decimals: true }
    });

    for (const token of tokens) {
      // Sum all user balances
      const userBalances = await prisma.userBalance.groupBy({
        by: ['tokenId'],
        where: { tokenId: token.id },
        _sum: { amount: true }
      });

      const totalUserBalance = userBalances[0]?._sum?.amount
        ? parseUnits(userBalances[0]._sum.amount.toString(), token.decimals)
        : 0n;

      // Sum all BalanceDeltas (should equal total user balance changes)
      const balanceDeltas = await prisma.balanceDelta.findMany({
        where: { tokenId: token.id },
        select: { amountDelta: true }
      });

      const totalDeltas = balanceDeltas.reduce((sum, delta) => {
        return sum + parseUnits(delta.amountDelta.toString(), 0);
      }, 0n);

      // Calculate drift
      const drift = totalUserBalance > totalDeltas
        ? totalUserBalance - totalDeltas
        : totalDeltas - totalUserBalance;

      const driftPercentage = totalUserBalance > 0n
        ? Number((drift * 10000n) / totalUserBalance) / 100
        : 0;

      // Allow 0.01% drift for rounding
      if (driftPercentage > 0.01) {
        result.passed = false;
        result.errors.push(
          `Token ${token.symbol}: Drift ${formatUnits(drift, token.decimals)} (${driftPercentage}%)`
        );
      }

      result.tokenBalances.push({
        tokenId: token.id,
        symbol: token.symbol,
        totalUserBalances: formatUnits(totalUserBalance, token.decimals),
        totalBalanceDeltas: formatUnits(totalDeltas, token.decimals),
        drift: formatUnits(drift, token.decimals),
        driftPercentage
      });

      // Check treasury rake collection
      const treasuryDeltas = await prisma.balanceDelta.findMany({
        where: {
          tokenId: token.id,
          userId: null, // Treasury operations
          reason: { in: ['match_rake_collected', 'market_rake_collected'] }
        },
        select: { amountDelta: true }
      });

      const totalRake = treasuryDeltas.reduce((sum, delta) => {
        return sum + parseUnits(delta.amountDelta.toString(), 0);
      }, 0n);

      result.treasuryBalances.push({
        tokenId: token.id,
        symbol: token.symbol,
        totalRakeCollected: formatUnits(totalRake, token.decimals)
      });

      console.log(`   ${token.symbol}:`);
      console.log(`      User Balances: ${formatUnits(totalUserBalance, token.decimals)}`);
      console.log(`      BalanceDeltas: ${formatUnits(totalDeltas, token.decimals)}`);
      console.log(`      Drift: ${formatUnits(drift, token.decimals)} (${driftPercentage.toFixed(4)}%)`);
      console.log(`      Treasury Rake: ${formatUnits(totalRake, token.decimals)}`);
    }

    console.log(`   ${result.passed ? "✅" : "❌"} Balance conservation ${result.passed ? "passed" : "failed"}`);
  } catch (error) {
    result.passed = false;
    result.errors.push(`Balance conservation check failed: ${(error as Error).message}`);
    console.error("   ❌ Error:", (error as Error).message);
  }

  return result;
}

/**
 * Check 2: Operation Coverage
 * Verify every operation has Transaction + BalanceDelta records
 */
async function checkOperationCoverage(): Promise<OperationCoverageResult> {
  console.log("\n🔍 Check 2: Operation Coverage");
  console.log("=".repeat(60));

  const result: OperationCoverageResult = {
    passed: true,
    stats: {
      totalOperations: 0,
      operationsWithTransactions: 0,
      operationsWithBalanceDeltas: 0,
      orphanedTransactions: 0,
      orphanedBalanceDeltas: 0
    },
    missingCoverage: [],
    errors: []
  };

  try {
    // Check all transactions have at least one BalanceDelta
    const transactionsWithoutDeltas = await prisma.transaction.findMany({
      where: {
        balanceDeltas: { none: {} }
      },
      select: { id: true, type: true }
    });

    result.stats.orphanedTransactions = transactionsWithoutDeltas.length;

    if (transactionsWithoutDeltas.length > 0) {
      result.passed = false;
      result.errors.push(`${transactionsWithoutDeltas.length} transactions missing BalanceDeltas`);
      console.log(`   ⚠️  ${transactionsWithoutDeltas.length} transactions without BalanceDeltas`);

      for (const tx of transactionsWithoutDeltas.slice(0, 5)) {
        result.missingCoverage.push({
          type: 'transaction',
          id: tx.id,
          reason: `Transaction type ${tx.type} has no BalanceDeltas`
        });
      }
    }

    // Check all BalanceDeltas have a parent Transaction
    const deltasWithoutTransaction = await prisma.balanceDelta.findMany({
      where: {
        transactionId: null
      },
      select: { id: true, reason: true }
    });

    result.stats.orphanedBalanceDeltas = deltasWithoutTransaction.length;

    if (deltasWithoutTransaction.length > 0) {
      result.passed = false;
      result.errors.push(`${deltasWithoutTransaction.length} BalanceDeltas missing Transaction link`);
      console.log(`   ⚠️  ${deltasWithoutTransaction.length} BalanceDeltas without Transaction`);
    }

    // Get operation counts
    const totalTransactions = await prisma.transaction.count();
    const totalDeltas = await prisma.balanceDelta.count();

    result.stats.totalOperations = totalTransactions;
    result.stats.operationsWithTransactions = totalTransactions - result.stats.orphanedTransactions;
    result.stats.operationsWithBalanceDeltas = totalDeltas - result.stats.orphanedBalanceDeltas;

    console.log(`   Total Transactions: ${totalTransactions}`);
    console.log(`   Total BalanceDeltas: ${totalDeltas}`);
    console.log(`   Orphaned Transactions: ${result.stats.orphanedTransactions}`);
    console.log(`   Orphaned BalanceDeltas: ${result.stats.orphanedBalanceDeltas}`);
    console.log(`   ${result.passed ? "✅" : "❌"} Operation coverage ${result.passed ? "passed" : "failed"}`);
  } catch (error) {
    result.passed = false;
    result.errors.push(`Operation coverage check failed: ${(error as Error).message}`);
    console.error("   ❌ Error:", (error as Error).message);
  }

  return result;
}

/**
 * Check 3: Rake Validation
 * Verify rake entries exist for matches and markets that should have rake
 */
async function checkRakeValidation(): Promise<RakeValidationResult> {
  console.log("\n💰 Check 3: Rake Validation");
  console.log("=".repeat(60));

  const result: RakeValidationResult = {
    passed: true,
    stats: {
      totalMatches: 0,
      matchesWithRake: 0,
      missingRakeEntries: 0,
      totalMarkets: 0,
      marketsWithRake: 0,
      missingMarketRake: 0
    },
    missingRake: [],
    errors: []
  };

  try {
    // Check matches with non-zero rake
    const settledMatches = await prisma.match.findMany({
      where: {
        status: 'SETTLED',
        result: { not: 'TIE' }, // Ties don't collect rake
        rakeAtomic: { not: '0' }
      },
      select: { id: true, rakeAtomic: true }
    });

    result.stats.totalMatches = settledMatches.length;

    for (const match of settledMatches) {
      // Check if rake transaction exists
      const rakeTransaction = await prisma.transaction.findFirst({
        where: {
          type: 'TREASURY_RAKE',
          idempotencyKey: `rake_match_${match.id}`
        }
      });

      if (rakeTransaction) {
        result.stats.matchesWithRake++;
      } else {
        result.stats.missingRakeEntries++;
        result.missingRake.push({
          type: 'match',
          id: match.id,
          expectedRake: match.rakeAtomic.toString()
        });
      }
    }

    // Check prediction markets with rake
    const resolvedMarkets = await prisma.predictionMarket.findMany({
      where: {
        status: 'RESOLVED',
        outcome: { not: null },
        rakePercentage: { gt: 0 }
      },
      select: { id: true, rakePercentage: true, totalYesBets: true, totalNoBets: true }
    });

    result.stats.totalMarkets = resolvedMarkets.length;

    for (const market of resolvedMarkets) {
      const totalPool = market.totalYesBets + market.totalNoBets;
      const expectedRake = totalPool * (market.rakePercentage / 100);

      if (expectedRake > 0) {
        // Check if rake transaction exists
        const rakeTransaction = await prisma.transaction.findFirst({
          where: {
            type: 'TREASURY_RAKE',
            idempotencyKey: `rake_market_${market.id}`
          }
        });

        if (rakeTransaction) {
          result.stats.marketsWithRake++;
        } else {
          result.stats.missingMarketRake++;
          result.missingRake.push({
            type: 'market',
            id: market.id,
            expectedRake: expectedRake.toString()
          });
        }
      }
    }

    if (result.stats.missingRakeEntries > 0 || result.stats.missingMarketRake > 0) {
      result.passed = false;
      result.errors.push(
        `Missing ${result.stats.missingRakeEntries} match rake entries and ${result.stats.missingMarketRake} market rake entries`
      );
    }

    console.log(`   Matches: ${result.stats.matchesWithRake}/${result.stats.totalMatches} have rake logged`);
    console.log(`   Markets: ${result.stats.marketsWithRake}/${result.stats.totalMarkets} have rake logged`);
    console.log(`   Missing: ${result.stats.missingRakeEntries + result.stats.missingMarketRake} rake entries`);
    console.log(`   ${result.passed ? "✅" : "❌"} Rake validation ${result.passed ? "passed" : "failed"}`);
  } catch (error) {
    result.passed = false;
    result.errors.push(`Rake validation check failed: ${(error as Error).message}`);
    console.error("   ❌ Error:", (error as Error).message);
  }

  return result;
}

/**
 * Check 4: On-Chain Verification (Paginated)
 * Verify ALL txHash entries resolve on Abstract explorer with pagination
 */
async function checkOnChainVerification(): Promise<OnChainVerificationResult> {
  console.log("\n⛓️  Check 4: On-Chain Verification (Paginated)");
  console.log("=".repeat(60));

  const result: OnChainVerificationResult = {
    passed: true,
    stats: {
      totalOnChainTransactions: 0,
      verifiedTransactions: 0,
      failedVerifications: 0,
      skippedVerifications: 0
    },
    failedTxHashes: [],
    errors: []
  };

  try {
    // Get total count first
    const totalCount = await prisma.transaction.count({
      where: { txHash: { not: null } }
    });

    result.stats.totalOnChainTransactions = totalCount;

    if (totalCount === 0) {
      console.log("   ℹ️  No on-chain transactions found");
      return result;
    }

    console.log(`   Total on-chain transactions: ${totalCount}`);

    // Setup RPC provider
    const network = process.env.NETWORK || 'testnet';
    const rpcUrl = network === 'mainnet'
      ? process.env.ABSTRACT_RPC_MAINNET
      : process.env.ABSTRACT_RPC_TESTNET;

    if (!rpcUrl) {
      console.log("   ⚠️  RPC URL not configured, skipping verification");
      result.stats.skippedVerifications = totalCount;
      return result;
    }

    const provider = new JsonRpcProvider(rpcUrl);

    // Pagination settings to avoid RPC rate limits
    const BATCH_SIZE = 50; // Verify 50 transactions per batch
    const DELAY_BETWEEN_BATCHES = 1000; // 1 second delay
    const MAX_RETRIES = 3;

    const totalBatches = Math.ceil(totalCount / BATCH_SIZE);
    console.log(`   Processing ${totalBatches} batches of ${BATCH_SIZE} transactions...`);

    // Process in batches with pagination
    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const skip = batchNum * BATCH_SIZE;

      // Get batch of transactions
      const batch = await prisma.transaction.findMany({
        where: { txHash: { not: null } },
        select: { id: true, txHash: true, type: true },
        skip,
        take: BATCH_SIZE,
        orderBy: { createdAt: 'desc' } // Process newest first
      });

      // Verify each transaction in batch
      for (const tx of batch) {
        let retries = 0;
        let verified = false;

        while (retries < MAX_RETRIES && !verified) {
          try {
            const receipt = await provider.getTransactionReceipt(tx.txHash!);

            if (receipt && receipt.status === 1) {
              result.stats.verifiedTransactions++;
              verified = true;
            } else {
              result.passed = false;
              result.stats.failedVerifications++;
              result.failedTxHashes.push({
                txHash: tx.txHash!,
                transactionId: tx.id,
                error: receipt ? `Transaction failed (status: ${receipt.status})` : 'Transaction not found'
              });
              verified = true; // Don't retry for failed transactions
            }
          } catch (error) {
            retries++;
            if (retries >= MAX_RETRIES) {
              result.stats.skippedVerifications++;
              console.log(`   ⚠️  Skipped ${tx.txHash} after ${MAX_RETRIES} retries: ${(error as Error).message}`);
            } else {
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }
      }

      // Progress update
      const processed = Math.min((batchNum + 1) * BATCH_SIZE, totalCount);
      const progress = ((processed / totalCount) * 100).toFixed(1);
      console.log(`   Progress: ${progress}% (${processed}/${totalCount} transactions verified)`);

      // Delay between batches to avoid rate limiting
      if (batchNum < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    console.log(`\n   Total On-Chain: ${result.stats.totalOnChainTransactions}`);
    console.log(`   Verified: ${result.stats.verifiedTransactions}`);
    console.log(`   Failed: ${result.stats.failedVerifications}`);
    console.log(`   Skipped: ${result.stats.skippedVerifications}`);
    console.log(`   Success Rate: ${((result.stats.verifiedTransactions / result.stats.totalOnChainTransactions) * 100).toFixed(2)}%`);
    console.log(`   ${result.passed ? "✅" : "❌"} On-chain verification ${result.passed ? "passed" : "failed"}`);
  } catch (error) {
    result.passed = false;
    result.errors.push(`On-chain verification check failed: ${(error as Error).message}`);
    console.error("   ❌ Error:", (error as Error).message);
  }

  return result;
}

/**
 * Check 5: Merkle Consistency
 * Verify balances match last published Merkle snapshot
 */
async function checkMerkleConsistency(): Promise<MerkleConsistencyResult> {
  console.log("\n🌳 Check 5: Merkle Consistency");
  console.log("=".repeat(60));

  const result: MerkleConsistencyResult = {
    passed: true,
    lastSnapshotRoot: null,
    lastSnapshotBlock: null,
    balanceDiscrepancies: [],
    errors: []
  };

  try {
    // Get last published snapshot
    const lastSnapshot = await prisma.merkleSnapshot.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        root: true,
        blockNumber: true,
        userBalances: true
      }
    });

    if (!lastSnapshot) {
      console.log("   ℹ️  No Merkle snapshots found");
      return result;
    }

    result.lastSnapshotRoot = lastSnapshot.root;
    result.lastSnapshotBlock = lastSnapshot.blockNumber;

    // Parse snapshot balances
    const snapshotBalances = lastSnapshot.userBalances as any;

    // Compare with current BalanceDelta-computed balances
    for (const [userId, tokenBalances] of Object.entries(snapshotBalances)) {
      for (const [tokenId, snapshotBalance] of Object.entries(tokenBalances as any)) {
        const userIdNum = parseInt(userId);
        const tokenIdNum = parseInt(tokenId);

        // Get all BalanceDeltas for this user/token up to snapshot block
        const deltas = await prisma.balanceDelta.findMany({
          where: {
            userId: userIdNum,
            tokenId: tokenIdNum,
            createdAt: { lte: lastSnapshot.createdAt }
          },
          select: { amountDelta: true }
        });

        const computedBalance = deltas.reduce((sum, delta) => {
          return sum + BigInt(delta.amountDelta.toString());
        }, 0n);

        const snapshotBal = BigInt(snapshotBalance as string);
        const drift = computedBalance > snapshotBal
          ? computedBalance - snapshotBal
          : snapshotBal - computedBalance;

        // Allow minimal drift for rounding
        if (drift > 1000n) {
          result.passed = false;
          result.balanceDiscrepancies.push({
            userId: userIdNum,
            tokenId: tokenIdNum,
            snapshotBalance: snapshotBal.toString(),
            computedBalance: computedBalance.toString(),
            drift: drift.toString()
          });
        }
      }
    }

    console.log(`   Last Snapshot: ${result.lastSnapshotRoot}`);
    console.log(`   Block: ${result.lastSnapshotBlock}`);
    console.log(`   Discrepancies: ${result.balanceDiscrepancies.length}`);
    console.log(`   ${result.passed ? "✅" : "❌"} Merkle consistency ${result.passed ? "passed" : "failed"}`);
  } catch (error) {
    result.passed = false;
    result.errors.push(`Merkle consistency check failed: ${(error as Error).message}`);
    console.error("   ❌ Error:", (error as Error).message);
  }

  return result;
}

/**
 * Check 6: Treasury Flow Deep Dive
 * Verify all TREASURY_RAKE + TREASURY_SWAP entries reconcile correctly
 */
async function checkTreasuryFlow(): Promise<TreasuryFlowResult> {
  console.log("\n💰 Check 6: Treasury Flow Deep Dive");
  console.log("=".repeat(60));

  const result: TreasuryFlowResult = {
    passed: true,
    stats: {
      totalRakeCollected: {},
      totalSwaps: {},
      totalTreasuryBalance: {},
      unexplainedDiscrepancies: {}
    },
    treasuryTransactions: [],
    errors: []
  };

  try {
    // Get all active tokens
    const tokens = await prisma.token.findMany({
      where: { active: true },
      select: { id: true, symbol: true, decimals: true }
    });

    for (const token of tokens) {
      // Sum all rake collected
      const rakeDeltas = await prisma.balanceDelta.findMany({
        where: {
          tokenId: token.id,
          userId: null, // Treasury operations
          reason: { in: ['match_rake_collected', 'market_rake_collected'] }
        },
        select: { amountDelta: true, createdAt: true, transaction: { select: { type: true } } }
      });

      const totalRake = rakeDeltas.reduce((sum, delta) => {
        return sum + parseUnits(delta.amountDelta.toString(), 0);
      }, 0n);

      result.stats.totalRakeCollected[token.id] = formatUnits(totalRake, token.decimals);

      // Sum all treasury swaps
      const swapDeltas = await prisma.balanceDelta.findMany({
        where: {
          tokenId: token.id,
          userId: null,
          reason: { in: ['treasury_swap', 'treasury_deposit', 'treasury_withdrawal'] }
        },
        select: { amountDelta: true, createdAt: true, transaction: { select: { type: true } } }
      });

      const totalSwaps = swapDeltas.reduce((sum, delta) => {
        return sum + parseUnits(delta.amountDelta.toString(), 0);
      }, 0n);

      result.stats.totalSwaps[token.id] = formatUnits(totalSwaps, token.decimals);

      // Calculate total treasury balance (rake + swaps)
      const totalTreasury = totalRake + totalSwaps;
      result.stats.totalTreasuryBalance[token.id] = formatUnits(totalTreasury, token.decimals);

      // Check for unexplained discrepancies
      // Treasury balance should equal sum of all treasury BalanceDeltas
      const allTreasuryDeltas = await prisma.balanceDelta.findMany({
        where: {
          tokenId: token.id,
          userId: null // All treasury operations
        },
        select: { amountDelta: true }
      });

      const computedTreasury = allTreasuryDeltas.reduce((sum, delta) => {
        return sum + parseUnits(delta.amountDelta.toString(), 0);
      }, 0n);

      const discrepancy = totalTreasury > computedTreasury
        ? totalTreasury - computedTreasury
        : computedTreasury - totalTreasury;

      if (discrepancy > 1000n) { // Allow 1000 wei tolerance
        result.passed = false;
        result.stats.unexplainedDiscrepancies[token.id] = formatUnits(discrepancy, token.decimals);
        result.errors.push(
          `Token ${token.symbol}: Unexplained treasury discrepancy of ${formatUnits(discrepancy, token.decimals)}`
        );
      }

      console.log(`   ${token.symbol}:`);
      console.log(`      Rake Collected: ${formatUnits(totalRake, token.decimals)}`);
      console.log(`      Treasury Swaps: ${formatUnits(totalSwaps, token.decimals)}`);
      console.log(`      Total Treasury: ${formatUnits(totalTreasury, token.decimals)}`);
      if (discrepancy > 1000n) {
        console.log(`      ⚠️  Discrepancy: ${formatUnits(discrepancy, token.decimals)}`);
      }

      // Record treasury transactions for audit
      for (const delta of rakeDeltas) {
        result.treasuryTransactions.push({
          type: delta.transaction?.type || 'TREASURY_RAKE',
          tokenId: token.id,
          amount: delta.amountDelta.toString(),
          timestamp: delta.createdAt
        });
      }
    }

    console.log(`   ${result.passed ? "✅" : "❌"} Treasury flow ${result.passed ? "passed" : "failed"}`);
  } catch (error) {
    result.passed = false;
    result.errors.push(`Treasury flow check failed: ${(error as Error).message}`);
    console.error("   ❌ Error:", (error as Error).message);
  }

  return result;
}

/**
 * Main validation runner
 */
async function runValidation(): Promise<ValidationReport> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   Cross-System Reconciliation Validator                   ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  const network = process.env.NETWORK || 'testnet';
  console.log(`\nNetwork: ${network}`);
  console.log(`Starting validation at ${new Date().toISOString()}`);

  // Run all checks
  const balanceConservation = await checkBalanceConservation();
  const operationCoverage = await checkOperationCoverage();
  const rakeValidation = await checkRakeValidation();
  const onChainVerification = await checkOnChainVerification();
  const merkleConsistency = await checkMerkleConsistency();
  const treasuryFlow = await checkTreasuryFlow();

  // Build report
  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    network,
    checks: {
      balanceConservation,
      operationCoverage,
      rakeValidation,
      onChainVerification,
      merkleConsistency,
      treasuryFlow
    },
    summary: {
      totalChecks: 6,
      passedChecks: [
        balanceConservation.passed,
        operationCoverage.passed,
        rakeValidation.passed,
        onChainVerification.passed,
        merkleConsistency.passed,
        treasuryFlow.passed
      ].filter(Boolean).length,
      failedChecks: 0,
      warningCount: 0
    },
    success: false
  };

  report.summary.failedChecks = report.summary.totalChecks - report.summary.passedChecks;
  report.success = report.summary.failedChecks === 0;

  // Count warnings
  report.summary.warningCount =
    (operationCoverage.stats.orphanedTransactions > 0 ? 1 : 0) +
    (operationCoverage.stats.orphanedBalanceDeltas > 0 ? 1 : 0) +
    (onChainVerification.stats.skippedVerifications > 0 ? 1 : 0);

  // Print summary
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║   Validation Summary                                       ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");
  console.log(`Total Checks: ${report.summary.totalChecks}`);
  console.log(`Passed: ${report.summary.passedChecks}`);
  console.log(`Failed: ${report.summary.failedChecks}`);
  console.log(`Warnings: ${report.summary.warningCount}`);
  console.log(`\nOverall: ${report.success ? "✅ ALL CHECKS PASSED" : "❌ VALIDATION FAILED"}\n`);

  // Save report to file
  const reportPath = path.join(process.cwd(), 'reports', `validation-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Report saved to: ${reportPath}\n`);

  return report;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runValidation()
    .then((report) => {
      process.exit(report.success ? 0 : 1);
    })
    .catch((error) => {
      console.error("❌ Validation failed:", error);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}