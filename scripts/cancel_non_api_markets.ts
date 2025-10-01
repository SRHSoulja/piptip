// Cancel markets that lack API guarantees
import { prisma } from '../src/services/db.js';

const CRYPTO_MARKET_TYPES = [
  'CRYPTO_PRICE_DIRECTION', 'CRYPTO_DAILY_CHANGE', 'CRYPTO_VOLUME',
  'CRYPTO_PRICE_TARGET', 'CRYPTO_PRICE_RANGE', 'CRYPTO_RANK_TARGET',
  'PRICE_UP_DOWN', 'PRICE_ABOVE_BELOW', 'VOLUME_RANKING'
];

async function cancelNonApiMarkets() {
  console.log('🔍 Finding markets without API guarantees...\n');

  // Find all crypto markets without proper flags
  const violatingMarkets = await prisma.predictionMarket.findMany({
    where: {
      status: 'ACTIVE',
      marketType: { in: CRYPTO_MARKET_TYPES }
    },
    include: {
      _count: {
        select: {
          participations: true
        }
      }
    }
  });

  const toCancel = violatingMarkets.filter(m => {
    const marketData = m.marketData as any;
    return !marketData?.templateBased || !marketData?.apiGuaranteed;
  });

  if (toCancel.length === 0) {
    console.log('✅ No markets to cancel - all crypto markets have API guarantees');
    return;
  }

  console.log(`Found ${toCancel.length} markets without API guarantees:\n`);

  for (const market of toCancel) {
    console.log(`  - ${market.id}: "${market.title}"`);
    console.log(`    Type: ${market.marketType}`);
    console.log(`    Participations: ${market._count.participations}`);
    console.log(`    Created: ${market.createdAt.toISOString()}`);
  }

  console.log('\n⚠️  These markets will be CANCELLED (refunds issued)\n');
  console.log('Continue? (Ctrl+C to abort, Enter to continue)');

  // Wait for user confirmation
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  console.log('\n🔄 Cancelling markets...\n');

  let cancelledCount = 0;
  let errorCount = 0;

  for (const market of toCancel) {
    try {
      await prisma.predictionMarket.update({
        where: { id: market.id },
        data: {
          status: 'CANCELLED',
          outcome: 'CANCEL',
          resolvedAt: new Date()
        }
      });

      console.log(`✅ Cancelled: ${market.title}`);
      cancelledCount++;
    } catch (error: any) {
      console.error(`❌ Failed to cancel ${market.id}:`, error.message);
      errorCount++;
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`   ✅ Cancelled: ${cancelledCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log(`\n💡 Note: Refunds will be processed by the market resolver`);
}

cancelNonApiMarkets()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
