#!/usr/bin/env tsx
// scripts/test_markets.ts - Quick test runner for prediction markets

import { PredictionMarketsTestSuite } from "../tests/prediction_markets_test.js";
import { ensurePrisma } from "../src/services/db.js";

async function runTests() {
  console.log("🚀 Prediction Markets Test Runner");
  console.log("================================\n");

  try {
    // Ensure database connection
    await ensurePrisma();
    console.log("✅ Database connected\n");

    // Run the test suite
    const suite = new PredictionMarketsTestSuite();
    await suite.runAllTests();

  } catch (error) {
    console.error("❌ Test runner failed:", error);
    process.exit(1);
  }
}

// Execute
runTests();