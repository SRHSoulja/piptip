#!/usr/bin/env npx tsx
// scripts/test_database_switching.ts
// Test database switching between testnet and mainnet

import "dotenv/config";
import { getDatabaseUrl, getFullNetworkInfo, getNetworkType } from "../src/services/network.js";

async function main() {
  console.log(`🔄 Testing Database Switching\n`);

  // Test current configuration
  console.log(`📍 Current Configuration:`);
  const networkInfo = getFullNetworkInfo();
  console.log(`   Network: ${networkInfo.network}`);
  console.log(`   Chain ID: ${networkInfo.chainId}`);
  console.log(`   RPC URL: ${networkInfo.rpcUrl}`);
  console.log(`   Database URL: ${networkInfo.databaseUrl}`);

  // Show raw database URL resolution
  console.log(`\n🗄️ Database URL Resolution:`);
  const rawDbUrl = getDatabaseUrl();
  const maskedDbUrl = rawDbUrl.replace(/\/\/[^@]+@/, '//***:***@');
  console.log(`   Resolved URL: ${maskedDbUrl}`);

  // Check environment variables
  console.log(`\n🔧 Environment Variables:`);
  console.log(`   NETWORK: ${process.env.NETWORK || 'not set (defaults to mainnet)'}`);
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? 'set' : 'not set'}`);
  console.log(`   TEST_DATABASE_URL: ${process.env.TEST_DATABASE_URL ? 'set' : 'not set'}`);

  // Show what would happen in different scenarios
  console.log(`\n📋 Database Switching Logic:`);

  if (getNetworkType() === 'testnet') {
    console.log(`   ✅ TESTNET MODE detected`);
    if (process.env.TEST_DATABASE_URL) {
      console.log(`   ✅ TEST_DATABASE_URL is set → Using isolated test database`);
      console.log(`   🛡️ Production data is safe from test operations`);
    } else {
      console.log(`   ⚠️ TEST_DATABASE_URL not set → Using production DATABASE_URL`);
      console.log(`   ⚠️ WARNING: Test data will be mixed with production data!`);
    }
  } else {
    console.log(`   ✅ MAINNET MODE detected`);
    console.log(`   ✅ Using production DATABASE_URL`);
    if (process.env.TEST_DATABASE_URL) {
      console.log(`   ✅ TEST_DATABASE_URL is also configured for testnet isolation`);
    } else {
      console.log(`   ⚠️ TEST_DATABASE_URL not configured - testnet will use production DB`);
    }
  }

  // Recommendations
  console.log(`\n💡 Recommendations:`);

  if (!process.env.TEST_DATABASE_URL) {
    console.log(`   1. Create a test database: CREATE DATABASE piptip_test;`);
    console.log(`   2. Set TEST_DATABASE_URL in your .env file`);
    console.log(`   3. Run database migrations on test DB: NETWORK=testnet npx prisma migrate deploy`);
  } else {
    console.log(`   ✅ Database isolation is properly configured`);
    console.log(`   ✅ Ready for safe testnet testing`);
  }

  // Test different network scenarios
  console.log(`\n🧪 Testing Different Network Scenarios:`);

  // Save original NETWORK value
  const originalNetwork = process.env.NETWORK;

  // Test mainnet
  process.env.NETWORK = 'mainnet';
  const mainnetUrl = getDatabaseUrl();
  console.log(`   NETWORK=mainnet → ${mainnetUrl.replace(/\/\/[^@]+@/, '//***:***@')}`);

  // Test testnet
  process.env.NETWORK = 'testnet';
  const testnetUrl = getDatabaseUrl();
  console.log(`   NETWORK=testnet → ${testnetUrl.replace(/\/\/[^@]+@/, '//***:***@')}`);

  // Test unset
  delete process.env.NETWORK;
  const defaultUrl = getDatabaseUrl();
  console.log(`   NETWORK=unset   → ${defaultUrl.replace(/\/\/[^@]+@/, '//***:***@')} (default)`);

  // Restore original
  if (originalNetwork) {
    process.env.NETWORK = originalNetwork;
  }

  console.log(`\n✅ Database switching test complete!`);
}

main().catch((error) => {
  console.error(`❌ Database switching test failed:`, error);
  process.exit(1);
});