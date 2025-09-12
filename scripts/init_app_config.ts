#!/usr/bin/env tsx
// scripts/init_app_config.ts - Initialize AppConfig with emergency control defaults

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function initAppConfig() {
  try {
    console.log('🔧 Initializing AppConfig with emergency controls...');
    
    // Check if AppConfig already exists
    const existingConfig = await prisma.appConfig.findFirst();
    
    if (existingConfig) {
      // Update existing config to add new fields if they're missing
      console.log('📝 Updating existing AppConfig with emergency controls...');
      await prisma.appConfig.update({
        where: { id: existingConfig.id },
        data: {
          emergencyMode: existingConfig.emergencyMode ?? false,
          withdrawalsPaused: existingConfig.withdrawalsPaused ?? false,
          tippingPaused: existingConfig.tippingPaused ?? false
        }
      });
      console.log('✅ AppConfig updated successfully');
    } else {
      // Create new AppConfig with defaults
      console.log('🆕 Creating new AppConfig with defaults...');
      await prisma.appConfig.create({
        data: {
          minDeposit: 50,
          minWithdraw: 50,
          withdrawMaxPerTx: 50,
          withdrawDailyCap: 500,
          houseFeeBps: 200,
          tipFeeBps: 100,
          emergencyMode: false,
          withdrawalsPaused: false,
          tippingPaused: false
        }
      });
      console.log('✅ AppConfig created successfully');
    }
    
    // Display current status
    const config = await prisma.appConfig.findFirst();
    console.log('\n📊 Current AppConfig status:');
    console.log(`   Emergency Mode: ${config?.emergencyMode ? '🚨 ENABLED' : '✅ Disabled'}`);
    console.log(`   Withdrawals: ${config?.withdrawalsPaused ? '⏸️ PAUSED' : '✅ Active'}`);
    console.log(`   Tipping: ${config?.tippingPaused ? '⏸️ PAUSED' : '✅ Active'}`);
    
  } catch (error) {
    console.error('❌ Failed to initialize AppConfig:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  initAppConfig();
}

export { initAppConfig };