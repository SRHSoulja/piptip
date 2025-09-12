// tests/load/loadTest.ts - Main load test entry point
import 'dotenv/config';
import {
  CONFIG,
  TestUser,
  TestToken,
  LoadTestResult,
  cleanupTestData,
  createTestUsers,
  createTestTokens,
  fundUserBalances,
  assertNoNegativeBalances,
  checkBalanceConservation,
  checkTransactionConsistency,
  checkClaimUniqueness,
  PerformanceTracker,
  writeFailureReport,
  prisma,
  randomInt,
  randomChoice,
  randomAmount,
  batchArray,
} from './helpers.js';
import { transferToken, creditToken } from '../../src/services/balances.js';
import { RefundEngine } from '../../src/services/refund_engine.js';
import { finalizeExpiredGroupTip } from '../../src/features/finalizeExpiredGroupTip.js';
import { decToBigDirect } from '../../src/services/token.js';

// Global test state
let testUsers: TestUser[] = [];
let testTokens: TestToken[] = [];
let createdTips: number[] = [];
let createdGroupTips: number[] = [];
let tracker: PerformanceTracker;

async function runSingleTipsBurst(): Promise<void> {
  console.log(`\n💸 Starting ${CONFIG.SINGLE_TIPS} single tips burst (concurrency: ${CONFIG.CONCURRENCY})...`);
  
  // Generate tip operations
  const tipOps = [];
  for (let i = 0; i < CONFIG.SINGLE_TIPS; i++) {
    const fromUser = randomChoice(testUsers);
    let toUser = randomChoice(testUsers);
    // Ensure different users
    while (toUser.id === fromUser.id) {
      toUser = randomChoice(testUsers);
    }
    
    const token = randomChoice(testTokens);
    
    tipOps.push({
      id: i,
      fromUser,
      toUser,
      token,
    });
  }
  
  // Execute in batches
  const batches = batchArray(tipOps, CONFIG.CONCURRENCY);
  let completedTips = 0;
  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchStart = tracker.startOperation();
    
    // Execute batch in parallel
    const batchPromises = batch.map(async (op) => {
      const opStart = tracker.startOperation();
      
      try {
        // Get current balance to determine tip amount
        const balance = await prisma.userBalance.findUnique({
          where: {
            userId_tokenId: {
              userId: op.fromUser.id,
              tokenId: op.token.id,
            }
          }
        });
        
        if (!balance || BigInt(balance.amount.toString()) <= BigInt(1000000)) {
          // Skip if insufficient balance (less than 1 token)
          return null;
        }
        
        const tipAmount = randomAmount(balance.amount.toString(), op.token.decimals);
        
        // Execute the tip
        await transferToken(
          op.fromUser.discordId,
          op.toUser.discordId,
          op.token.id,
          tipAmount,
          'TIP',
          {
            feeAtomic: tipAmount / BigInt(100), // 1% fee
            note: `Load test tip ${op.id}`,
          }
        );
        
        // Create tip record
        const tip = await prisma.tip.create({
          data: {
            fromUserId: op.fromUser.id,
            toUserId: op.toUser.id,
            tokenId: op.token.id,
            amountAtomic: tipAmount.toString(),
            feeAtomic: (tipAmount / BigInt(100)).toString(),
            taxAtomic: (tipAmount / BigInt(100)).toString(),
            note: `Load test tip ${op.id}`,
            status: 'COMPLETED',
          }
        });
        
        createdTips.push(tip.id);
        return tip.id;
        
      } catch (error: any) {
        // Handle insufficient balance gracefully
        if (error.message?.includes('insufficient') || error.message?.includes('balance')) {
          return null; // Skip this tip
        }
        tracker.recordError(`Tip ${op.id}: ${error.message}`);
        return null;
      } finally {
        tracker.endOperation(opStart, 'TIP_CREATE');
      }
    });
    
    const results = await Promise.all(batchPromises);
    const successful = results.filter(r => r !== null).length;
    completedTips += successful;
    
    tracker.endOperation(batchStart, `TIP_BATCH_${batchIndex}`);
    
    // Progress update
    if (batchIndex % 10 === 0 || batchIndex === batches.length - 1) {
      console.log(`  Progress: ${completedTips}/${CONFIG.SINGLE_TIPS} tips (${Math.round((batchIndex + 1) / batches.length * 100)}%)`);
    }
  }
  
  console.log(`✅ Completed ${completedTips} single tips`);
}

async function runGroupTipsAndClaims(): Promise<void> {
  console.log(`\n🎯 Creating ${CONFIG.GROUP_TIPS} group tips with concurrent claims...`);
  
  // Create group tips
  const groupTipPromises = [];
  for (let i = 0; i < CONFIG.GROUP_TIPS; i++) {
    const creator = randomChoice(testUsers);
    const token = randomChoice(testTokens);
    const amount = randomAmount(CONFIG.INITIAL_BALANCE, token.decimals);
    
    groupTipPromises.push(
      createGroupTip(creator, token, amount, i)
    );
  }
  
  // Create group tips in batches
  const groupTipBatches = batchArray(groupTipPromises, CONFIG.CONCURRENCY);
  for (const batch of groupTipBatches) {
    await Promise.all(batch);
  }
  
  console.log(`✅ Created ${createdGroupTips.length} group tips`);
  
  // Now run claims for each group tip
  let totalClaims = 0;
  
  for (let i = 0; i < createdGroupTips.length; i++) {
    const groupTipId = createdGroupTips[i];
    const claimerCount = randomInt(CONFIG.CLAIMERS_MIN, CONFIG.CLAIMERS_MAX);
    
    // Select random users to claim (ensuring uniqueness)
    const claimers = new Set<TestUser>();
    while (claimers.size < Math.min(claimerCount, testUsers.length - 1)) {
      const claimer = randomChoice(testUsers);
      claimers.add(claimer);
    }
    
    // Execute claims in parallel
    const claimPromises = Array.from(claimers).map(async (claimer) => {
      const opStart = tracker.startOperation();
      
      try {
        await prisma.groupTipClaim.create({
          data: {
            groupTipId,
            userId: claimer.id,
            status: 'CLAIMED',
            claimedAt: new Date(),
          }
        });
        
        return true;
      } catch (error: any) {
        if (error.code === 'P2002') {
          // Unique constraint violation - this is expected in race conditions
          tracker.recordUniqueViolation();
          return false;
        }
        tracker.recordError(`Claim ${groupTipId}/${claimer.id}: ${error.message}`);
        return false;
      } finally {
        tracker.endOperation(opStart, 'CLAIM_CREATE');
      }
    });
    
    const results = await Promise.all(claimPromises);
    const successful = results.filter(r => r === true).length;
    totalClaims += successful;
    
    // Progress update
    if (i % 20 === 0 || i === createdGroupTips.length - 1) {
      console.log(`  Progress: ${i + 1}/${createdGroupTips.length} group tips processed`);
    }
  }
  
  console.log(`✅ Processed ${totalClaims} claims across ${createdGroupTips.length} group tips`);
}

async function createGroupTip(creator: TestUser, token: TestToken, amount: bigint, index: number): Promise<void> {
  const opStart = tracker.startOperation();
  
  try {
    // Debit creator's balance
    await prisma.userBalance.update({
      where: {
        userId_tokenId: {
          userId: creator.id,
          tokenId: token.id,
        }
      },
      data: {
        amount: {
          decrement: amount.toString(),
        }
      }
    });
    
    // Create group tip
    const groupTip = await prisma.groupTip.create({
      data: {
        creatorId: creator.id,
        tokenId: token.id,
        totalAmount: (Number(amount) / Math.pow(10, token.decimals)).toString(), // Human readable
        taxAtomic: (amount / BigInt(100)).toString(), // 1% tax in atomic
        duration: 3600, // 1 hour
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 60000), // 1 minute for testing
        guildId: 'load_test_guild',
      }
    });
    
    createdGroupTips.push(groupTip.id);
    
  } catch (error: any) {
    tracker.recordError(`Group tip ${index}: ${error.message}`);
  } finally {
    tracker.endOperation(opStart, 'GROUP_TIP_CREATE');
  }
}

async function runClaimVsExpiryRace(): Promise<void> {
  console.log(`\n⚡ Testing ${CONFIG.EXPIRE_COUNT} claim vs expiry race conditions...`);
  
  // Select random group tips for race testing
  const raceGroupTips = createdGroupTips
    .slice(0, CONFIG.EXPIRE_COUNT)
    .map(id => ({ id, users: testUsers.slice(0, 20) })); // Use first 20 users for consistency
  
  const racePromises = raceGroupTips.map(async ({ id: groupTipId, users }) => {
    const opStart = tracker.startOperation();
    
    try {
      // Start expiry process
      const expiryPromise = finalizeExpiredGroupTip(groupTipId);
      
      // Start concurrent claim attempts
      const claimPromises = users.slice(0, 10).map(async (user) => {
        try {
          await prisma.groupTipClaim.create({
            data: {
              groupTipId,
              userId: user.id,
              status: 'CLAIMED',
              claimedAt: new Date(),
            }
          });
          return { success: true, type: 'claim' };
        } catch (error: any) {
          if (error.code === 'P2002') {
            tracker.recordUniqueViolation();
          }
          return { success: false, type: 'claim', error: error.message };
        }
      });
      
      // Wait for all operations to complete
      const [expiryResult, ...claimResults] = await Promise.all([
        expiryPromise,
        ...claimPromises
      ]);
      
      // Verify final state
      const finalState = await prisma.groupTip.findUnique({
        where: { id: groupTipId },
        include: { claims: true }
      });
      
      // Assert invariants
      if (finalState) {
        const claims = finalState.claims;
        const uniqueClaims = new Set(claims.map(c => c.userId));
        
        if (claims.length !== uniqueClaims.size) {
          tracker.recordError(`Group tip ${groupTipId}: Duplicate claims found`);
        }
        
        // Verify terminal state
        if (finalState.status !== 'FINALIZED' && finalState.status !== 'REFUNDED') {
          tracker.recordError(`Group tip ${groupTipId}: Invalid final status ${finalState.status}`);
        }
      }
      
      return true;
      
    } catch (error: any) {
      tracker.recordError(`Race test ${groupTipId}: ${error.message}`);
      return false;
    } finally {
      tracker.endOperation(opStart, 'RACE_TEST');
    }
  });
  
  const results = await Promise.all(racePromises);
  const successful = results.filter(r => r === true).length;
  
  console.log(`✅ Completed ${successful}/${CONFIG.EXPIRE_COUNT} race tests`);
}

async function runRefundIdempotencyTest(): Promise<void> {
  console.log(`\n🔄 Testing refund idempotency...`);
  
  // Select some tips for refund testing
  const tipsToRefund = createdTips.slice(0, Math.min(50, createdTips.length));
  
  for (const tipId of tipsToRefund) {
    const opStart = tracker.startOperation();
    
    try {
      // First refund
      const result1 = await RefundEngine.refundTip(tipId);
      
      // Second refund (should be idempotent)
      const result2 = await RefundEngine.refundTip(tipId);
      
      // Verify idempotency
      if (!result1.success || !result2.success) {
        tracker.recordError(`Refund failed for tip ${tipId}`);
        continue;
      }
      
      if (!result2.alreadyRefunded) {
        tracker.recordError(`Refund not idempotent for tip ${tipId}`);
        continue;
      }
      
      if (result1.refundedAmount !== result2.refundedAmount || 
          result1.refundedTax !== result2.refundedTax) {
        tracker.recordError(`Refund amounts inconsistent for tip ${tipId}`);
        continue;
      }
      
    } catch (error: any) {
      tracker.recordError(`Refund test ${tipId}: ${error.message}`);
    } finally {
      tracker.endOperation(opStart, 'REFUND_TEST');
    }
  }
  
  // Test group tip refunds too
  const groupTipsToRefund = createdGroupTips.slice(0, Math.min(25, createdGroupTips.length));
  
  for (const groupTipId of groupTipsToRefund) {
    const opStart = tracker.startOperation();
    
    try {
      // First refund
      const result1 = await RefundEngine.refundContribution(groupTipId);
      
      // Second refund (should be idempotent)
      const result2 = await RefundEngine.refundContribution(groupTipId);
      
      // Verify idempotency
      if (!result1.success || !result2.success) {
        tracker.recordError(`Group refund failed for ${groupTipId}`);
        continue;
      }
      
      if (!result2.alreadyRefunded) {
        tracker.recordError(`Group refund not idempotent for ${groupTipId}`);
        continue;
      }
      
    } catch (error: any) {
      tracker.recordError(`Group refund test ${groupTipId}: ${error.message}`);
    } finally {
      tracker.endOperation(opStart, 'GROUP_REFUND_TEST');
    }
  }
  
  console.log(`✅ Completed refund idempotency tests`);
}

async function runIntegrityChecks(): Promise<{
  noNegativeBalances: boolean;
  balanceConservation: boolean;
  transactionConsistency: boolean;
  claimUniqueness: boolean;
}> {
  console.log(`\n🔍 Running integrity checks...`);
  
  const results = {
    noNegativeBalances: await assertNoNegativeBalances(),
    balanceConservation: await checkBalanceConservation(
      BigInt(CONFIG.INITIAL_BALANCE) * BigInt(CONFIG.USERS) * BigInt(CONFIG.TOKENS) * BigInt(Math.pow(10, 6)), // Total initial funding
      testUsers,
      testTokens
    ),
    transactionConsistency: await checkTransactionConsistency(),
    claimUniqueness: await checkClaimUniqueness(),
  };
  
  return results;
}

async function generateReport(invariants: any): Promise<LoadTestResult> {
  const stats = tracker.getStats();
  const totalDuration = tracker.getTotalDuration();
  
  // Count successful operations
  const successfulTips = createdTips.length;
  const successfulGroupTips = createdGroupTips.length;
  const totalClaims = await prisma.groupTipClaim.count({
    where: {
      User: { discordId: { startsWith: 'load_test_' } }
    }
  });
  
  const result: LoadTestResult = {
    success: Object.values(invariants).every(v => v === true) && stats.errors.length === 0,
    stats: {
      users: testUsers.length,
      tokens: testTokens.length,
      singleTips: successfulTips,
      groupTips: successfulGroupTips,
      totalClaims,
      uniqueViolations: stats.uniqueViolations,
      errors: stats.errors.length,
      slowQueries: stats.slowQueries.length,
    },
    performance: {
      totalDuration,
      p50Duration: tracker.getP50Duration(),
      p95Duration: tracker.getP95Duration(),
      avgTipsPerSecond: successfulTips > 0 ? Math.round((successfulTips * 1000) / totalDuration) : 0,
    },
    invariants,
  };
  
  // Write failure report if needed
  if (!result.success) {
    await writeFailureReport([
      { errors: stats.errors },
      { slowQueries: stats.slowQueries },
      { invariants }
    ]);
  }
  
  return result;
}

// Main execution
async function main(): Promise<void> {
  console.log('🚀 Starting PIPTip Load Test Harness');
  console.log(`Configuration:`, CONFIG);
  
  tracker = new PerformanceTracker();
  
  try {
    // Setup
    await cleanupTestData();
    testUsers = await createTestUsers(CONFIG.USERS);
    testTokens = await createTestTokens(CONFIG.TOKENS);
    await fundUserBalances(testUsers, testTokens);
    
    console.log(`\n📊 Test environment ready:`);
    console.log(`  Users: ${testUsers.length}`);
    console.log(`  Tokens: ${testTokens.length}`);
    console.log(`  Initial balance per user: ${CONFIG.INITIAL_BALANCE} per token`);
    
    // Execute test phases
    await runSingleTipsBurst();
    await runGroupTipsAndClaims();
    await runClaimVsExpiryRace();
    await runRefundIdempotencyTest();
    
    // Final integrity checks
    const invariants = await runIntegrityChecks();
    
    // Generate and display report
    const result = await generateReport(invariants);
    
    console.log(`\n${result.success ? '✅' : '❌'} Load Test Results:`);
    console.log(JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('\n🎉 All tests passed! System is robust under load.');
    } else {
      console.log('\n⚠️  Some invariants failed. Check failure report for details.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Load test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the load test
main().catch(console.error);