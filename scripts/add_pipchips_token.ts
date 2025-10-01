// scripts/add_pipchips_token.ts - Add PIPCHIPS as virtual token for transaction logging
import { prisma } from '../src/services/db.js';

const VIRTUAL_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'; // Zero address for virtual tokens
const PIPCHIPS_DECIMALS = 0; // PIPChips are whole numbers, no decimals

async function main() {
  console.log('🎰 Adding PIPCHIPS as virtual token...');

  // Check if PIPCHIPS token already exists
  const existing = await prisma.token.findUnique({
    where: { symbol: 'PIPCHIPS' }
  });

  if (existing) {
    console.log('✅ PIPCHIPS token already exists:');
    console.log(`   ID: ${existing.id}`);
    console.log(`   Symbol: ${existing.symbol}`);
    console.log(`   Address: ${existing.address}`);
    console.log(`   Decimals: ${existing.decimals}`);
    console.log(`   Active: ${existing.active}`);
    return;
  }

  // Create PIPCHIPS token
  const pipchipsToken = await prisma.token.create({
    data: {
      address: VIRTUAL_TOKEN_ADDRESS,
      symbol: 'PIPCHIPS',
      decimals: PIPCHIPS_DECIMALS,
      active: true,
      minDeposit: 0, // Virtual token, no deposits from blockchain
      minWithdraw: 0, // Virtual token, no withdrawals to blockchain
      tipFeeBps: 0, // No fees for virtual token
      houseFeeBps: 0,
      withdrawMaxPerTx: null,
      withdrawDailyCap: null,
      updatedAt: new Date()
    }
  });

  console.log('✅ PIPCHIPS token created successfully!');
  console.log(`   ID: ${pipchipsToken.id}`);
  console.log(`   Symbol: ${pipchipsToken.symbol}`);
  console.log(`   Address: ${pipchipsToken.address}`);
  console.log(`   Decimals: ${pipchipsToken.decimals}`);

  console.log('\n📝 Next steps:');
  console.log('   1. Wire pipchipsService.processTransaction() to tx_logger');
  console.log('   2. Update prediction markets to use transaction logging');
  console.log('   3. Migrate existing PipchipsTransaction data (optional)');
  console.log('   4. Add PIPChips validation to transaction log validator');

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('❌ Error adding PIPCHIPS token:', error);
  process.exit(1);
});