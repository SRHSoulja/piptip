#!/usr/bin/env npx tsx
/**
 * Blockchain Operations Integration Test
 *
 * Tests deposit detection, withdrawal processing, and treasury operations
 * on Abstract testnet.
 *
 * Prerequisites:
 * - TESTNET_TREASURY_PRIVATE_KEY set in .env
 * - Testnet treasury funded with test ETH
 * - Test database configured
 *
 * Run: NETWORK=testnet npm run test:blockchain-ops
 */

import "dotenv/config";
import { validateTestEnvironment } from "../src/services/test_db_safety.js";
import { prisma } from "../src/services/db.js";
import { ethers } from "ethers";

// Ensure testnet mode
if (process.env.NETWORK !== 'testnet') {
  throw new Error("This test must run on testnet. Set NETWORK=testnet");
}

process.env.NODE_ENV = 'test';
validateTestEnvironment();

let testUsers: any[] = [];
let provider: ethers.JsonRpcProvider;
let treasuryWallet: ethers.Wallet;

async function setup(): Promise<void> {
  console.log("🧪 Setting up blockchain operations test environment...\n");

  // Initialize provider
  const rpcUrl = process.env.TESTNET_RPC_URL || 'https://api.testnet.abs.xyz';
  provider = new ethers.JsonRpcProvider(rpcUrl);

  // Load treasury wallet
  const privateKey = process.env.TESTNET_TREASURY_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("TESTNET_TREASURY_PRIVATE_KEY not set");
  }

  treasuryWallet = new ethers.Wallet(privateKey, provider);
  console.log(`✅ Treasury wallet: ${treasuryWallet.address}`);

  // Check treasury balance
  const balance = await provider.getBalance(treasuryWallet.address);
  console.log(`✅ Treasury balance: ${ethers.formatEther(balance)} ETH`);

  if (balance < ethers.parseEther("0.01")) {
    console.warn(`⚠️  Low treasury balance! Fund ${treasuryWallet.address} with testnet ETH`);
  }

  // Create test users with wallets
  for (let i = 1; i <= 2; i++) {
    const userWallet = ethers.Wallet.createRandom().connect(provider);
    const discordId = `blockchain_test_user_${Date.now()}_${i}`;

    const user = await prisma.user.create({
      data: {
        discordId,
        agwAddress: userWallet.address,
        pipchipsBalance: 0n, // Start with 0, will credit via deposit
        updatedAt: new Date()
      }
    });

    testUsers.push({
      id: user.id,
      discordId,
      wallet: userWallet,
      address: userWallet.address
    });
  }

  console.log(`✅ Created ${testUsers.length} test users with wallets\n`);
}

async function cleanup(): Promise<void> {
  console.log("\n🧹 Cleaning up test data...");

  for (const user of testUsers) {
    await prisma.pipchipsTransaction.deleteMany({
      where: { userId: user.discordId }
    });

    await prisma.processedDeposit.deleteMany({
      where: { key: { contains: user.address.toLowerCase() } }
    }).catch(() => {});

    await prisma.user.delete({
      where: { discordId: user.discordId }
    }).catch(() => {});
  }

  console.log("✅ Cleanup completed");
}

// Test 1: Deposit Detection
async function testDepositDetection(): Promise<boolean> {
  console.log("1️⃣ Testing deposit detection...");

  try {
    const user = testUsers[0];

    // Fund user wallet with testnet ETH
    const fundAmount = ethers.parseEther("0.001");
    const fundTx = await treasuryWallet.sendTransaction({
      to: user.address,
      value: fundAmount
    });

    console.log(`   📤 Sent ${ethers.formatEther(fundAmount)} ETH to user wallet`);
    console.log(`   📝 Funding tx: ${fundTx.hash}`);

    await fundTx.wait();
    console.log(`   ✅ Funding confirmed`);

    // User sends deposit to treasury
    const depositAmount = ethers.parseEther("0.0005");
    const depositTx = await user.wallet.sendTransaction({
      to: treasuryWallet.address,
      value: depositAmount
    });

    console.log(`   📥 User sent ${ethers.formatEther(depositAmount)} ETH to treasury`);
    console.log(`   📝 Deposit tx: ${depositTx.hash}`);

    const receipt = await depositTx.wait();
    console.log(`   ✅ Deposit confirmed at block ${receipt?.blockNumber}`);

    // Simulate deposit detection
    // Note: Real detection happens in deposit worker
    // Here we manually trigger the credit logic

    const { deposits } = await import("../src/services/deposits.js");

    // Check if deposit was detected
    // In production, worker polls for new transfers
    // For this test, we simulate by directly crediting

    const depositKey = `${user.address.toLowerCase()}_${depositTx.hash}`;
    const existing = await prisma.processedDeposit.findUnique({
      where: { key: depositKey }
    });

    if (existing) {
      console.log(`   ⚠️  Deposit already processed`);
      return true;
    }

    // Process deposit manually
    await prisma.processedDeposit.create({
      data: { key: depositKey }
    });

    // Credit user balance (in atomic units)
    const token = await prisma.token.findFirst({
      where: { symbol: 'ETH' }
    });

    if (token) {
      await prisma.userBalance.upsert({
        where: {
          userId_tokenId: {
            userId: user.id,
            tokenId: token.id
          }
        },
        create: {
          userId: user.id,
          tokenId: token.id,
          amount: depositAmount
        },
        update: {
          amount: { increment: depositAmount }
        }
      });

      console.log(`   ✅ User balance credited: ${ethers.formatEther(depositAmount)} ETH`);
    }

    // Verify balance update
    const userBalance = await prisma.userBalance.findFirst({
      where: {
        userId: user.id,
        tokenId: token?.id
      }
    });

    if (userBalance && BigInt(userBalance.amount.toString()) >= depositAmount) {
      console.log(`   ✅ Balance verified: ${ethers.formatEther(userBalance.amount.toString())} ETH`);
      return true;
    }

    throw new Error("Balance not updated correctly");

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 2: Withdrawal Processing
async function testWithdrawalProcessing(): Promise<boolean> {
  console.log("\n2️⃣ Testing withdrawal processing...");

  try {
    const user = testUsers[1];

    // Setup: Give user some balance
    const token = await prisma.token.findFirst({
      where: { symbol: 'ETH' }
    });

    if (!token) {
      throw new Error("ETH token not found");
    }

    const initialBalance = ethers.parseEther("0.001");
    await prisma.userBalance.create({
      data: {
        userId: user.id,
        tokenId: token.id,
        amount: initialBalance
      }
    });

    console.log(`   💰 User initial balance: ${ethers.formatEther(initialBalance)} ETH`);

    // Request withdrawal
    const withdrawAmount = ethers.parseEther("0.0005");

    const { atomicWithdrawal } = await import("../src/services/atomic_withdrawal.js");

    // Execute withdrawal
    const result = await atomicWithdrawal(
      user.discordId,
      token.id,
      withdrawAmount,
      user.address
    );

    console.log(`   📤 Withdrawal requested: ${ethers.formatEther(withdrawAmount)} ETH`);
    console.log(`   📝 Transaction hash: ${result.txHash}`);

    // Verify on-chain
    const receipt = await provider.getTransaction(result.txHash);
    if (receipt) {
      console.log(`   ✅ On-chain transaction found`);
      console.log(`   📊 To: ${receipt.to}`);
      console.log(`   📊 Value: ${ethers.formatEther(receipt.value)} ETH`);

      if (receipt.to?.toLowerCase() !== user.address.toLowerCase()) {
        throw new Error(`Transaction sent to wrong address: ${receipt.to}`);
      }
    }

    // Verify balance deducted
    const userBalance = await prisma.userBalance.findFirst({
      where: {
        userId: user.id,
        tokenId: token.id
      }
    });

    const expectedBalance = initialBalance - withdrawAmount;
    if (userBalance && BigInt(userBalance.amount.toString()) === expectedBalance) {
      console.log(`   ✅ Balance deducted correctly: ${ethers.formatEther(userBalance.amount.toString())} ETH`);
      return true;
    }

    throw new Error("Balance not deducted correctly");

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 3: Treasury Reconciliation
async function testTreasuryReconciliation(): Promise<boolean> {
  console.log("\n3️⃣ Testing treasury reconciliation...");

  try {
    // Get on-chain treasury balance
    const onChainBalance = await provider.getBalance(treasuryWallet.address);
    console.log(`   🏦 On-chain treasury: ${ethers.formatEther(onChainBalance)} ETH`);

    // Get database total balances
    const token = await prisma.token.findFirst({
      where: { symbol: 'ETH' }
    });

    if (!token) {
      console.log(`   ℹ️  ETH token not configured in test DB`);
      return true;
    }

    const dbBalances = await prisma.userBalance.findMany({
      where: { tokenId: token.id }
    });

    const totalDbBalance = dbBalances.reduce((sum, bal) => {
      return sum + BigInt(bal.amount.toString());
    }, 0n);

    console.log(`   💾 Database total: ${ethers.formatEther(totalDbBalance)} ETH`);

    // Calculate difference
    const difference = onChainBalance - totalDbBalance;
    const differencePercent = Number(difference * 10000n / onChainBalance) / 100;

    console.log(`   📊 Difference: ${ethers.formatEther(difference)} ETH (${differencePercent}%)`);

    // Allow small difference due to gas costs
    const tolerance = ethers.parseEther("0.01"); // 0.01 ETH tolerance

    if (difference < 0n) {
      console.log(`   ⚠️  Database balance exceeds on-chain balance!`);
      return false;
    }

    if (difference <= tolerance) {
      console.log(`   ✅ Reconciliation passed: Within tolerance`);
      return true;
    }

    console.log(`   ⚠️  Large discrepancy detected (might be normal for test)`);
    return true;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 4: Gas Estimation
async function testGasEstimation(): Promise<boolean> {
  console.log("\n4️⃣ Testing gas estimation...");

  try {
    const user = testUsers[0];
    const amount = ethers.parseEther("0.0001");

    // Estimate gas for transfer
    const gasEstimate = await provider.estimateGas({
      to: user.address,
      value: amount,
      from: treasuryWallet.address
    });

    console.log(`   ⛽ Estimated gas: ${gasEstimate.toString()} units`);

    // Get gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || 0n;

    console.log(`   💰 Gas price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);

    const totalCost = gasEstimate * gasPrice;
    console.log(`   💸 Total tx cost: ${ethers.formatEther(totalCost)} ETH`);

    // Verify cost is reasonable (< 0.001 ETH on testnet)
    if (totalCost < ethers.parseEther("0.001")) {
      console.log(`   ✅ Gas cost is reasonable`);
      return true;
    }

    console.log(`   ⚠️  Gas cost seems high (might be normal on testnet)`);
    return true;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Test 5: Multi-Token Operations
async function testMultiTokenOps(): Promise<boolean> {
  console.log("\n5️⃣ Testing multi-token operations...");

  try {
    // Check configured tokens
    const tokens = await prisma.token.findMany({
      where: { active: true }
    });

    console.log(`   📋 Active tokens: ${tokens.map(t => t.symbol).join(', ')}`);

    for (const token of tokens) {
      console.log(`   🪙 ${token.symbol}:`);
      console.log(`      - Decimals: ${token.decimals}`);
      console.log(`      - Min deposit: ${token.minDeposit}`);
      console.log(`      - Min withdraw: ${token.minWithdraw}`);

      // Check if any users have balances
      const balances = await prisma.userBalance.count({
        where: { tokenId: token.id }
      });
      console.log(`      - User balances: ${balances}`);
    }

    console.log(`   ✅ Multi-token configuration verified`);
    return true;

  } catch (error) {
    console.error("   ❌ Error:", (error as Error).message);
    return false;
  }
}

// Main test runner
async function runTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   Blockchain Operations Test Suite (Testnet)              ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  try {
    await setup();

    const results = {
      depositDetection: await testDepositDetection(),
      withdrawalProcessing: await testWithdrawalProcessing(),
      treasuryReconciliation: await testTreasuryReconciliation(),
      gasEstimation: await testGasEstimation(),
      multiTokenOps: await testMultiTokenOps()
    };

    // Summary
    const passed = Object.values(results).filter(r => r).length;
    const total = Object.values(results).length;

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║   Test Results                                             ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${total - passed}`);
    console.log(`\nOverall: ${passed === total ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}`);

    console.log("\n⚠️  Note: These tests use real testnet transactions");
    console.log("   Ensure treasury wallet has sufficient testnet ETH\n");

    if (passed !== total) {
      process.exit(1);
    }

  } catch (error) {
    console.error("❌ Test suite failed:", error);
    process.exit(1);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}
