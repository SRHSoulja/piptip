#!/usr/bin/env npx tsx
// scripts/seed_test_balances.ts
// Create dummy test data for merkle tree testing on testnet

import "dotenv/config";
import { prisma } from "../src/services/db.js";
import { getNetworkType, isTestnet } from "../src/services/network.js";

async function main() {
  console.log(`🌱 Seeding test balances for merkle tree testing`);
  console.log(`📍 Current Network: ${getNetworkType()}`);

  // Safety check: only run on testnet
  if (!isTestnet()) {
    console.error(`❌ ERROR: This script can only be run on testnet!`);
    console.error(`   Current network: ${getNetworkType()}`);
    console.error(`   Set NETWORK=testnet to run this script safely`);
    process.exit(1);
  }

  console.log(`🧪 TESTNET MODE: Safe to seed test data`);

  try {
    // Step 1: Check if we have any active tokens
    const tokens = await prisma.token.findMany({
      where: { active: true },
      select: { id: true, symbol: true, address: true, decimals: true }
    });

    if (tokens.length === 0) {
      console.log(`📦 No active tokens found. Creating a test token...`);

      // Create a test token for testnet
      const testToken = await prisma.token.create({
        data: {
          address: '0x1234567890123456789012345678901234567890', // Fake testnet token address
          symbol: 'TEST',
          decimals: 18,
          active: true,
          minDeposit: 1,
          minWithdraw: 1,
          name: 'Test Token',
          description: 'Test token for merkle tree testing'
        }
      });

      tokens.push(testToken);
      console.log(`✅ Created test token: ${testToken.symbol} (${testToken.address})`);
    }

    console.log(`\n📋 Available tokens:`);
    tokens.forEach((token, i) => {
      console.log(`   ${i + 1}. ${token.symbol} (decimals: ${token.decimals})`);
    });

    // Step 2: Create dummy users with AGW addresses
    console.log(`\n👥 Creating dummy test users...`);

    const dummyUsers = [
      {
        discordId: 'test_user_1_' + Date.now(),
        agwAddress: '0x1111111111111111111111111111111111111111'
      },
      {
        discordId: 'test_user_2_' + Date.now(),
        agwAddress: '0x2222222222222222222222222222222222222222'
      },
      {
        discordId: 'test_user_3_' + Date.now(),
        agwAddress: '0x3333333333333333333333333333333333333333'
      },
      {
        discordId: 'test_user_4_' + Date.now(),
        agwAddress: '0x4444444444444444444444444444444444444444'
      },
      {
        discordId: 'test_user_5_' + Date.now(),
        agwAddress: '0x5555555555555555555555555555555555555555'
      }
    ];

    const createdUsers = [];
    for (const userData of dummyUsers) {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { agwAddress: userData.agwAddress }
      });

      if (existingUser) {
        console.log(`   User already exists: ${userData.agwAddress}`);
        createdUsers.push(existingUser);
      } else {
        const user = await prisma.user.create({
          data: userData
        });
        createdUsers.push(user);
        console.log(`   ✅ Created user: ${user.discordId} (${user.agwAddress})`);
      }
    }

    // Step 3: Create dummy balances for the first token
    const testToken = tokens[0];
    console.log(`\n💰 Creating dummy balances for ${testToken.symbol}...`);

    const testBalances = [
      { amount: '100.50', description: 'Test balance 1' },
      { amount: '250.75', description: 'Test balance 2' },
      { amount: '50.25', description: 'Test balance 3' },
      { amount: '500.00', description: 'Test balance 4' },
      { amount: '75.10', description: 'Test balance 5' }
    ];

    let totalTestBalance = 0;
    for (let i = 0; i < createdUsers.length && i < testBalances.length; i++) {
      const user = createdUsers[i];
      const balanceData = testBalances[i];

      // Check if balance already exists
      const existingBalance = await prisma.userBalance.findUnique({
        where: {
          userId_tokenId: {
            userId: user.id,
            tokenId: testToken.id
          }
        }
      });

      if (existingBalance) {
        console.log(`   Balance already exists for ${user.agwAddress}: ${existingBalance.amount}`);
        totalTestBalance += Number(existingBalance.amount);
      } else {
        const balance = await prisma.userBalance.create({
          data: {
            userId: user.id,
            tokenId: testToken.id,
            amount: balanceData.amount
          }
        });

        console.log(`   ✅ ${user.agwAddress}: ${balanceData.amount} ${testToken.symbol}`);
        totalTestBalance += Number(balance.amount);
      }
    }

    // Step 4: Summary
    console.log(`\n📊 Test Data Summary:`);
    console.log(`   Network: testnet`);
    console.log(`   Token: ${testToken.symbol} (${testToken.address})`);
    console.log(`   Users Created: ${createdUsers.length}`);
    console.log(`   Total Test Balance: ${totalTestBalance} ${testToken.symbol}`);

    console.log(`\n🚀 Ready for merkle tree testing!`);
    console.log(`   Next steps:`);
    console.log(`   1. Generate merkle tree: npx tsx scripts/test_merkle_publisher.ts generate`);
    console.log(`   2. Publish snapshot: npx tsx scripts/test_merkle_publisher.ts publish`);
    console.log(`   3. Verify snapshot: npx tsx scripts/test_merkle_publisher.ts verify <merkle_root>`);

  } catch (error) {
    console.error(`❌ Failed to seed test data:`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Safety check before execution
if (process.env.NETWORK !== 'testnet') {
  console.error(`❌ SAFETY CHECK FAILED!`);
  console.error(`   This script can only run with NETWORK=testnet`);
  console.error(`   Current NETWORK: ${process.env.NETWORK || 'not set'}`);
  console.error(`   Set NETWORK=testnet and try again`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`💥 Fatal error:`, error);
  process.exit(1);
});