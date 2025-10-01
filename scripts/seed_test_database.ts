import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedTestDatabase() {
  console.log('🌱 Seeding test database...\n');

  // 1. Seed PIPCHIPS token
  const pipchips = await prisma.token.upsert({
    where: { symbol: 'PIPCHIPS' },
    create: {
      symbol: 'PIPCHIPS',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 0,
      active: true,
      minDeposit: 0,
      minWithdraw: 0,
      tipFeeBps: 0,
      houseFeeBps: 0,
      updatedAt: new Date()
    },
    update: {
      active: true,
      updatedAt: new Date()
    }
  });
  console.log('✅ PIPCHIPS token seeded (ID: ' + pipchips.id + ')');

  // 2. Seed TPIP token
  const tpip = await prisma.token.upsert({
    where: { symbol: 'TPIP' },
    create: {
      symbol: 'TPIP',
      address: '0x0000000000000000000000000000000000000001',
      decimals: 0,
      active: true,
      minDeposit: 0,
      minWithdraw: 0,
      tipFeeBps: 0,
      houseFeeBps: 0,
      updatedAt: new Date()
    },
    update: {
      active: true,
      updatedAt: new Date()
    }
  });
  console.log('✅ TPIP token seeded (ID: ' + tpip.id + ')');

  // 3. Seed ETH token (for multi-token tournaments)
  const eth = await prisma.token.upsert({
    where: { symbol: 'ETH' },
    create: {
      symbol: 'ETH',
      address: '0x0000000000000000000000000000000000000002',
      decimals: 18,
      active: true,
      minDeposit: 0.01,
      minWithdraw: 0.01,
      tipFeeBps: 0,
      houseFeeBps: 0,
      updatedAt: new Date()
    },
    update: {
      active: true,
      updatedAt: new Date()
    }
  });
  console.log('✅ ETH token seeded (ID: ' + eth.id + ')');

  // 4. Seed USDC token
  const usdc = await prisma.token.upsert({
    where: { symbol: 'USDC' },
    create: {
      symbol: 'USDC',
      address: '0x0000000000000000000000000000000000000003',
      decimals: 6,
      active: true,
      minDeposit: 10,
      minWithdraw: 10,
      tipFeeBps: 0,
      houseFeeBps: 0,
      updatedAt: new Date()
    },
    update: {
      active: true,
      updatedAt: new Date()
    }
  });
  console.log('✅ USDC token seeded (ID: ' + usdc.id + ')');

  console.log('\n🎉 Test database seeding complete!');
  console.log('\nToken Summary:');
  console.log('  PIPCHIPS ID: ' + pipchips.id + ' (for matches, predictions, tips)');
  console.log('  TPIP ID: ' + tpip.id + ' (for tournament play)');
  console.log('  ETH ID: ' + eth.id + ' (for tournament entry payment)');
  console.log('  USDC ID: ' + usdc.id + ' (for tournament entry payment)');
}

seedTestDatabase()
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
