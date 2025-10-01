#!/usr/bin/env npx tsx
// scripts/test_private_key.ts
// Test private key format and derive address

import "dotenv/config";
import { ethers } from "ethers";

async function main() {
  console.log("🔍 Testing Private Key Format");

  const privateKey = process.env.AGW_SESSION_PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ AGW_SESSION_PRIVATE_KEY not set");
    process.exit(1);
  }

  console.log(`Raw private key length: ${privateKey.length}`);
  console.log(`Raw private key starts with 0x: ${privateKey.startsWith('0x')}`);

  // Try different formats
  const formats = [
    privateKey,
    `0x${privateKey}`,
    privateKey.replace('0x', ''),
  ];

  for (const [index, format] of formats.entries()) {
    try {
      console.log(`\nTesting format ${index + 1}: length=${format.length}, starts with 0x=${format.startsWith('0x')}`);
      const wallet = new ethers.Wallet(format);
      console.log(`✅ Format ${index + 1} works! Address: ${wallet.address}`);

      // Check if this matches our expected address
      const expectedAddress = "0xCbBD2Df1B3cD2Ce32438E2d553B49f9eF825C0C2";
      console.log(`   Expected: ${expectedAddress}`);
      console.log(`   Match: ${wallet.address.toLowerCase() === expectedAddress.toLowerCase()}`);

      if (wallet.address.toLowerCase() === expectedAddress.toLowerCase()) {
        console.log(`🎯 Found correct format: ${format.startsWith('0x') ? 'with 0x prefix' : 'without 0x prefix'}`);
        break;
      }
    } catch (error) {
      console.log(`❌ Format ${index + 1} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}

main().catch(console.error);