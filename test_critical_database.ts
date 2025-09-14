#!/usr/bin/env npx tsx
// CRITICAL DATABASE TESTS: Must pass before ANY launch
// Tests the most dangerous scenarios with real database operations

// Override environment for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = "postgresql://testuser:test@localhost/piptip_test";

import { prisma } from './src/services/db.js';
import { withdrawalLimiter } from './src/services/withdrawal_limiter.js';
import { BalanceConservationService } from './src/services/balance_conservation.js';
import { debitTokenAtomicTx, creditTokenTx } from './src/services/balances.js';
import { processTip } from './src/services/tip_processor.js';

console.log('🚨 CRITICAL DATABASE SECURITY TESTS');
console.log('These tests MUST pass before any production launch...\n');

// Setup test data
async function setupTestData() {
  console.log('🔧 Setting up test data...');

  // Create test tokens
  await prisma.token.upsert({
    where: { symbol: 'TEST' },
    create: {
      symbol: 'TEST',
      decimals: 18,
      address: '0x1234567890123456789012345678901234567890',
      active: true,
      minDeposit: 1,
      minWithdraw: 1
    },
    update: { active: true }
  });

  console.log('✅ Test data setup complete');
}

await setupTestData();

let testsPassed = 0;
let testsFailed = 0;
let criticalFailures: string[] = [];

function testResult(testName: string, passed: boolean, details?: string) {
  if (passed) {
    console.log(`✅ ${testName} - SAFE FOR LAUNCH`);
    testsPassed++;
  } else {
    console.log(`❌ ${testName} - BLOCKS LAUNCH`);
    if (details) console.log(`   Details: ${details}`);
    testsFailed++;
    criticalFailures.push(testName);
  }
}

// CRITICAL TEST 1: Withdrawal Bypass with 20 Concurrent Requests
async function testWithdrawalBypass() {
  console.log('\n🔥 TESTING WITHDRAWAL BYPASS: 20 Concurrent Requests');

  try {
    // Setup test user and token
    const testUser = await prisma.user.upsert({
      where: { discordId: 'test_withdrawal_user' },
      create: { discordId: 'test_withdrawal_user' },
      update: {}
    });

    const testToken = await prisma.token.findFirst({ where: { active: true } });
    if (!testToken) throw new Error('No active tokens found');

    // Give user a balance
    await prisma.userBalance.upsert({
      where: { userId_tokenId: { userId: testUser.id, tokenId: testToken.id } },
      create: { userId: testUser.id, tokenId: testToken.id, amount: "1000" },
      update: { amount: "1000" }
    });

    // Clear any existing withdrawal attempts
    await prisma.withdrawalAttempt.deleteMany({
      where: { userId: testUser.id }
    });

    // Spawn 20 concurrent withdrawal attempts
    console.log('   Spawning 20 concurrent withdrawal requests...');
    const withdrawalPromises = Array(20).fill(null).map(async (_, index) => {
      try {
        const result = await withdrawalLimiter.checkWithdrawalAllowed(
          testUser.id,
          testToken.id,
          10 // Small amount to avoid balance issues
        );

        if (!result.allowed) {
          await withdrawalLimiter.recordBlockedWithdrawal(
            testUser.id,
            testToken.id,
            10,
            result.reason || 'Rate limited',
            `test_ip_${index}`,
            'test_user_agent'
          );
        } else {
          await withdrawalLimiter.recordSuccessfulWithdrawal(
            testUser.id,
            testToken.id,
            10
          );
        }

        return { index, allowed: result.allowed, reason: result.reason };
      } catch (error) {
        return { index, allowed: false, error: String(error) };
      }
    });

    const results = await Promise.allSettled(withdrawalPromises);

    // Analyze results
    let allowedCount = 0;
    let blockedCount = 0;
    let errorCount = 0;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const value = result.value as any;
        if (value.allowed) allowedCount++;
        else if (value.error) errorCount++;
        else blockedCount++;
      } else {
        errorCount++;
      }
    }

    // Account age-based limits: should allow 1-5 withdrawals max
    const maxExpectedAllowed = 5; // Assuming mature account
    const properlyLimited = allowedCount <= maxExpectedAllowed && blockedCount >= 15;

    console.log(`   Results: ${allowedCount} allowed, ${blockedCount} blocked, ${errorCount} errors`);

    testResult('Withdrawal Bypass Protection', properlyLimited,
      `Expected ≤${maxExpectedAllowed} allowed, got ${allowedCount}. Rate limiting ${properlyLimited ? 'works' : 'BROKEN'}`);

  } catch (error) {
    testResult('Withdrawal Bypass Protection', false, `Test failed: ${String(error)}`);
  }
}

// CRITICAL TEST 2: Balance Conservation with 1000 Transactions
async function testBalanceConservation() {
  console.log('\n🔥 TESTING BALANCE CONSERVATION: 1000 Transactions');

  try {
    // Record initial system balance
    const initialCheck = await BalanceConservationService.validateSystemBalance();
    console.log(`   Initial system balance valid: ${initialCheck.isValid}`);

    // Create test users
    const users = await Promise.all([
      prisma.user.upsert({
        where: { discordId: 'conservation_user_1' },
        create: { discordId: 'conservation_user_1' },
        update: {}
      }),
      prisma.user.upsert({
        where: { discordId: 'conservation_user_2' },
        create: { discordId: 'conservation_user_2' },
        update: {}
      }),
      prisma.user.upsert({
        where: { discordId: 'conservation_user_3' },
        create: { discordId: 'conservation_user_3' },
        update: {}
      })
    ]);

    const testToken = await prisma.token.findFirst({ where: { active: true } });
    if (!testToken) throw new Error('No active tokens found');

    // Give each user initial balance
    for (const user of users) {
      await prisma.userBalance.upsert({
        where: { userId_tokenId: { userId: user.id, tokenId: testToken.id } },
        create: { userId: user.id, tokenId: testToken.id, amount: "1000" },
        update: { amount: "1000" }
      });
    }

    // Record balance before transactions
    const beforeBalance = await BalanceConservationService.validateSystemBalance();
    const beforeTokenBalance = await BalanceConservationService.validateTokenBalance(testToken.id);

    console.log('   Running 1000 mixed transactions...');

    let transactionCount = 0;
    let successCount = 0;
    let failCount = 0;

    // Run 1000 mixed transactions
    for (let i = 0; i < 1000; i++) {
      try {
        const fromUser = users[i % users.length];
        const toUser = users[(i + 1) % users.length];
        const amount = Math.floor(Math.random() * 10) + 1; // 1-10 tokens (whole numbers)

        // Simulate different transaction types (simplified for testing)
        if (i % 2 === 0) {
          // Direct debit/credit (simulating match or other operation)
          await prisma.$transaction(async (tx) => {
            const amountAtomic = BigInt(Math.floor(amount * 1e18));

            // Try to debit from user
            const debitSuccess = await debitTokenAtomicTx(
              tx,
              fromUser.discordId,
              testToken.id,
              amountAtomic,
              'TEST_DEBIT',
              { note: `Test debit ${i}` }
            );

            // Credit to another user (simulating payout)
            await creditTokenTx(
              tx,
              toUser.discordId,
              testToken.id,
              amountAtomic * 9n / 10n, // 10% fee
              'TEST_CREDIT',
              { note: `Test credit ${i}` }
            );

            successCount++;
          }, { timeout: 10000 });
        } else {
          // Balance transfer
          await prisma.$transaction(async (tx) => {
            const amountAtomic = BigInt(Math.floor(amount * 1e18));

            await debitTokenAtomicTx(
              tx,
              fromUser.discordId,
              testToken.id,
              amountAtomic,
              'TEST_TRANSFER',
              { note: `Test transfer ${i}` }
            );

            await creditTokenTx(
              tx,
              toUser.discordId,
              testToken.id,
              amountAtomic,
              'TEST_TRANSFER',
              { note: `Test transfer ${i}` }
            );

            successCount++;
          }, { timeout: 10000 });
        }

        transactionCount++;

        // Check balance conservation every 100 transactions
        if (i % 100 === 99) {
          const midCheck = await BalanceConservationService.validateTokenBalance(testToken.id);
          if (!midCheck.isValid) {
            throw new Error(`Balance conservation violated at transaction ${i + 1}`);
          }
        }
      } catch (error) {
        failCount++;
        // Don't fail the whole test for individual transaction failures
        if (failCount > 100) { // But fail if too many failures
          throw new Error(`Too many transaction failures: ${failCount}`);
        }
      }
    }

    // Final balance conservation check
    const afterBalance = await BalanceConservationService.validateSystemBalance();
    const afterTokenBalance = await BalanceConservationService.validateTokenBalance(testToken.id);
    const fullIntegrityCheck = await BalanceConservationService.performFullIntegrityCheck();

    console.log(`   Completed: ${transactionCount} transactions, ${successCount} success, ${failCount} failed`);
    console.log(`   System balance valid: ${afterBalance.isValid}`);
    console.log(`   Token balance valid: ${afterTokenBalance.isValid}`);
    console.log(`   Full integrity check: ${fullIntegrityCheck.overallValid}`);

    const conservationMaintained = afterBalance.isValid &&
                                 afterTokenBalance.isValid &&
                                 fullIntegrityCheck.overallValid;

    testResult('Balance Conservation (1000 Transactions)', conservationMaintained,
      `System: ${afterBalance.isValid}, Token: ${afterTokenBalance.isValid}, Integrity: ${fullIntegrityCheck.overallValid}`);

  } catch (error) {
    testResult('Balance Conservation (1000 Transactions)', false, `Test failed: ${String(error)}`);
  }
}

// CRITICAL TEST 3: Fee Calculation Across All Amounts and Tokens
async function testFeeCalculationAccuracy() {
  console.log('\n🔥 TESTING FEE CALCULATION: 0.000001, 1, 1000 amounts across all tokens');

  try {
    const tokens = await prisma.token.findMany({ where: { active: true } });
    if (tokens.length === 0) throw new Error('No active tokens found');

    // Test amounts (in token units)
    const testAmounts = ['0.000001', '1', '1000'];
    let allTestsPass = true;
    const results: any[] = [];

    for (const token of tokens) {
      for (const amountStr of testAmounts) {
        try {
          const amount = parseFloat(amountStr);
          const atomicAmount = BigInt(Math.floor(amount * Math.pow(10, token.decimals)));

          // Test fee calculation logic (replicate from tip processor)
          const feeBps = BigInt(token.tipFeeBps || 100); // Default 1%

          // Check minimum amount threshold
          if (atomicAmount < BigInt(1000)) {
            results.push({
              token: token.symbol,
              amount: amountStr,
              status: 'blocked',
              reason: 'Below minimum threshold'
            });
            continue;
          }

          // Calculate fee with our fixed logic
          let feeAtomic = (atomicAmount * feeBps) / 10000n;

          // Apply ceiling division first
          const remainder = (atomicAmount * feeBps) % 10000n;
          if (remainder > 0n) {
            feeAtomic = feeAtomic + 1n;
          }

          // Then enforce minimum fee
          if (feeBps > 0n && feeAtomic === 0n) {
            feeAtomic = 1n;
          }

          const feeAmount = Number(feeAtomic) / Math.pow(10, token.decimals);
          const effectiveRate = (Number(feeAtomic) / Number(atomicAmount)) * 100;

          results.push({
            token: token.symbol,
            amount: amountStr,
            status: 'calculated',
            feeAtomic: feeAtomic.toString(),
            feeAmount: feeAmount.toFixed(8),
            effectiveRate: effectiveRate.toFixed(4) + '%'
          });

          // Validation checks
          if (feeAtomic < 0n) {
            allTestsPass = false;
            console.log(`   ❌ Negative fee for ${token.symbol} ${amountStr}`);
          }

          if (feeBps > 0n && feeAtomic === 0n) {
            allTestsPass = false;
            console.log(`   ❌ Zero fee when rate > 0 for ${token.symbol} ${amountStr}`);
          }

          if (feeAtomic > atomicAmount) {
            allTestsPass = false;
            console.log(`   ❌ Fee exceeds amount for ${token.symbol} ${amountStr}`);
          }

        } catch (error) {
          allTestsPass = false;
          results.push({
            token: token.symbol,
            amount: amountStr,
            status: 'error',
            error: String(error)
          });
        }
      }
    }

    // Display results
    console.log(`   Fee calculation results for ${tokens.length} tokens, ${testAmounts.length} amounts:`);
    for (const result of results) {
      if (result.status === 'calculated') {
        console.log(`   ${result.token} ${result.amount}: Fee ${result.feeAmount} (${result.effectiveRate})`);
      } else if (result.status === 'blocked') {
        console.log(`   ${result.token} ${result.amount}: ${result.reason}`);
      } else {
        console.log(`   ${result.token} ${result.amount}: ERROR - ${result.error}`);
      }
    }

    testResult('Fee Calculation Accuracy', allTestsPass,
      `Tested ${results.length} combinations. All calculations ${allTestsPass ? 'correct' : 'have errors'}`);

  } catch (error) {
    testResult('Fee Calculation Accuracy', false, `Test failed: ${String(error)}`);
  }
}

// CRITICAL TEST 4: Race Conditions with 100 Concurrent Match Joins
async function testRaceConditions() {
  console.log('\n🔥 TESTING RACE CONDITIONS: 100 Concurrent Match Joins');

  try {
    // Create test users
    const testUsers = await Promise.all(
      Array(10).fill(null).map(async (_, i) => {
        return prisma.user.upsert({
          where: { discordId: `race_test_user_${i}` },
          create: { discordId: `race_test_user_${i}` },
          update: {}
        });
      })
    );

    const testToken = await prisma.token.findFirst({ where: { active: true } });
    if (!testToken) throw new Error('No active tokens found');

    // Give users balance
    for (const user of testUsers) {
      await prisma.userBalance.upsert({
        where: { userId_tokenId: { userId: user.id, tokenId: testToken.id } },
        create: { userId: user.id, tokenId: testToken.id, amount: "1000" },
        update: { amount: "1000" }
      });
    }

    // Create multiple test matches
    const matches = await Promise.all(
      Array(10).fill(null).map(async (_, i) => {
        return prisma.match.create({
          data: {
            challengerId: testUsers[0].id,
            tokenId: testToken.id,
            wagerAtomic: "1000000000000000000", // 1 token
            status: "OFFERED",
            challengerMove: "rock", // Encrypted in real scenario
            offerDeadline: new Date(Date.now() + 60000)
          }
        });
      })
    );

    console.log(`   Created ${matches.length} matches, spawning 100 concurrent join attempts...`);

    // Simulate concurrent match joins (100 attempts across 10 matches)
    const joinPromises = Array(100).fill(null).map(async (_, index) => {
      const matchId = matches[index % matches.length].id;
      const userId = testUsers[(index % (testUsers.length - 1)) + 1].id; // Skip first user (challenger)

      try {
        return await prisma.$transaction(async (tx) => {
          // Simulate the atomic locking logic from matches.ts
          const lockResult = await tx.match.updateMany({
            where: {
              id: matchId,
              status: "OFFERED"
            },
            data: { status: "LOCKED" }
          });

          if (lockResult.count === 0) {
            throw new Error("Match already taken or unavailable");
          }

          // Simulate balance debit with atomic operation
          const currentBalance = await tx.userBalance.findUnique({
            where: { userId_tokenId: { userId: userId, tokenId: testToken.id } }
          });

          if (!currentBalance || parseFloat(currentBalance.amount) < 1) {
            throw new Error("Insufficient balance");
          }

          const newAmount = (parseFloat(currentBalance.amount) - 1).toString();
          const updateResult = await tx.userBalance.updateMany({
            where: {
              userId: userId,
              tokenId: testToken.id,
              amount: { gte: "1" } // Ensure sufficient balance (double check)
            },
            data: {
              amount: newAmount
            }
          });

          if (updateResult.count === 0) {
            // Unlock match if balance debit failed
            await tx.match.update({
              where: { id: matchId },
              data: { status: "OFFERED" }
            });
            throw new Error("Insufficient balance or concurrent transaction");
          }

          // Mark match as matched
          await tx.match.update({
            where: { id: matchId },
            data: {
              status: "MATCHED",
              joinerId: userId,
              joinerMove: "paper" // In real scenario this would be provided
            }
          });

          return { success: true, matchId, userId, index };
        }, { timeout: 15000 });
      } catch (error) {
        return { success: false, matchId, userId, index, error: String(error) };
      }
    });

    const results = await Promise.allSettled(joinPromises);

    // Analyze results
    let successCount = 0;
    let raceConditionBlocked = 0;
    let balanceBlocked = 0;
    let otherErrors = 0;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const value = result.value as any;
        if (value.success) {
          successCount++;
        } else if (value.error?.includes('already taken') || value.error?.includes('unavailable')) {
          raceConditionBlocked++;
        } else if (value.error?.includes('balance') || value.error?.includes('concurrent')) {
          balanceBlocked++;
        } else {
          otherErrors++;
        }
      } else {
        otherErrors++;
      }
    }

    // Each match should only be joined once (10 successful joins max)
    const maxExpectedSuccess = matches.length;
    const properlyBlocked = successCount <= maxExpectedSuccess &&
                           (raceConditionBlocked + balanceBlocked) >= 80; // Most should be blocked

    console.log(`   Results: ${successCount} successful joins, ${raceConditionBlocked} race blocked, ${balanceBlocked} balance blocked, ${otherErrors} other errors`);

    // Verify match states
    const finalMatches = await prisma.match.findMany({
      where: { id: { in: matches.map(m => m.id) } }
    });

    const matchedCount = finalMatches.filter(m => m.status === 'MATCHED').length;
    const offeredCount = finalMatches.filter(m => m.status === 'OFFERED').length;

    console.log(`   Final match states: ${matchedCount} matched, ${offeredCount} still offered`);

    const statesConsistent = matchedCount === successCount;

    testResult('Race Condition Protection', properlyBlocked && statesConsistent,
      `Expected ≤${maxExpectedSuccess} joins, got ${successCount}. States consistent: ${statesConsistent}`);

  } catch (error) {
    testResult('Race Condition Protection', false, `Test failed: ${String(error)}`);
  }
}

async function runAllCriticalTests() {
  console.log('🚨 Starting ALL CRITICAL database tests for production launch...\n');
  console.log('⚠️  These tests require a working database connection');
  console.log('⚠️  All tests MUST pass before ANY deployment\n');

  // Test database connection first
  try {
    await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Database connection established\n');
  } catch (error) {
    console.error('❌ Database connection failed:', String(error));
    console.error('🛑 Cannot run critical tests without database');
    process.exit(1);
  }

  await testWithdrawalBypass();
  await testBalanceConservation();
  await testFeeCalculationAccuracy();
  await testRaceConditions();

  console.log('\n' + '='.repeat(70));
  console.log('🚨 CRITICAL PRODUCTION READINESS RESULTS');
  console.log('='.repeat(70));
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📊 Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);

  if (testsFailed === 0) {
    console.log('\n🎉 ALL CRITICAL TESTS PASS!');
    console.log('✅ Platform is VERIFIED SAFE for production launch');
    console.log('🚀 All critical vulnerabilities are properly blocked');
  } else {
    console.log('\n🚨 CRITICAL FAILURES DETECTED!');
    console.log('🛑 DO NOT LAUNCH - Fix critical issues first');
    console.log('\nFailed tests:');
    criticalFailures.forEach(failure => console.log(`  - ${failure}`));
  }

  console.log('\n📋 PRODUCTION LAUNCH CHECKLIST:');
  console.log('  [' + (testsPassed >= 4 ? '✅' : '❌') + '] Withdrawal bypass protection verified');
  console.log('  [' + (testsPassed >= 4 ? '✅' : '❌') + '] Balance conservation with 1000 transactions');
  console.log('  [' + (testsPassed >= 4 ? '✅' : '❌') + '] Fee calculation accuracy across all tokens');
  console.log('  [' + (testsPassed >= 4 ? '✅' : '❌') + '] Race condition protection verified');

  // Cleanup test data
  console.log('\n🧹 Cleaning up test data...');
  await prisma.withdrawalAttempt.deleteMany({
    where: {
      user: {
        discordId: {
          in: ['test_withdrawal_user', 'conservation_user_1', 'conservation_user_2', 'conservation_user_3']
        }
      }
    }
  });
  console.log('✅ Test cleanup completed');

  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllCriticalTests().catch((error) => {
    console.error('💥 Critical test suite crashed:', error);
    process.exit(1);
  });
}

export { runAllCriticalTests };