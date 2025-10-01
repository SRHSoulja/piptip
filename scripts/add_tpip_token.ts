#!/usr/bin/env npx tsx
/**
 * Add Tournament PIPChips (TPIP) Token
 *
 * TPIP is a temporary currency that only exists during tournaments.
 * - Decimals: 0 (whole numbers only)
 * - Symbol: TPIP
 * - Name: Tournament PIPChips
 * - Address: Special marker for temporary token
 */

import { prisma } from "../src/services/db.js";

async function addTPIPToken() {
  console.log("🎯 Adding Tournament PIPChips (TPIP) token...\n");

  try {
    // Check if TPIP already exists
    const existing = await prisma.token.findFirst({
      where: { symbol: "TPIP" }
    });

    if (existing) {
      console.log("✅ TPIP token already exists:");
      console.log(`   ID: ${existing.id}`);
      console.log(`   Symbol: ${existing.symbol}`);
      console.log(`   Decimals: ${existing.decimals}`);
      console.log(`   Address: ${existing.address}`);
      return;
    }

    // Create TPIP token
    const tpip = await prisma.token.create({
      data: {
        symbol: "TPIP",
        decimals: 0, // Whole numbers only
        address: "0xTPIP000000000000000000000000000000000000", // Special marker for temporary token
        active: true,
        minDeposit: 0,
        minWithdraw: 0,
        updatedAt: new Date()
      }
    });

    console.log("✅ TPIP token created successfully:");
    console.log(`   ID: ${tpip.id}`);
    console.log(`   Symbol: ${tpip.symbol}`);
    console.log(`   Decimals: ${tpip.decimals}`);
    console.log(`   Address: ${tpip.address}`);
    console.log("\n🎯 TPIP is a temporary tournament currency that:");
    console.log("   • Is credited when players enter tournaments");
    console.log("   • Is used for all in-tournament wagers");
    console.log("   • Is converted back to PIPCHIPS for winners");
    console.log("   • Must be reset to zero after tournament ends");

  } catch (error) {
    console.error("❌ Error adding TPIP token:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  addTPIPToken();
}