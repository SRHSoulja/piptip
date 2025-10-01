// src/services/crypto_market_validator.ts - Startup validator for crypto market API guarantees
import { prisma } from './db.js';

/**
 * Validate all active crypto markets have API settlement guarantees
 * This runs on startup to catch any markets that slipped through without proper templates
 */
export async function validateCryptoMarketsOnStartup(): Promise<void> {
  try {
    console.log('🔍 Validating crypto markets for API guarantees...');

    const cryptoMarketTypes = [
      'CRYPTO_PRICE_DIRECTION',
      'CRYPTO_DAILY_CHANGE',
      'CRYPTO_VOLUME',
      'CRYPTO_PRICE_TARGET',
      'CRYPTO_PRICE_RANGE',
      'CRYPTO_RANK_TARGET',
      'PRICE_UP_DOWN',
      'PRICE_ABOVE_BELOW',
      'VOLUME_RANKING'
    ];

    // Find all active crypto markets
    const activeMarkets = await prisma.predictionMarket.findMany({
      where: {
        status: 'ACTIVE',
        marketType: {
          in: cryptoMarketTypes
        }
      },
      select: {
        id: true,
        title: true,
        marketType: true,
        marketData: true,
        createdAt: true
      }
    });

    const violatingMarkets: any[] = [];

    for (const market of activeMarkets) {
      const marketData = market.marketData as any;

      // Check for API guarantee flags
      const hasTemplateFlag = marketData?.templateBased === true;
      const hasAPIGuarantee = marketData?.apiGuaranteed === true;

      if (!hasTemplateFlag || !hasAPIGuarantee) {
        violatingMarkets.push({
          id: market.id,
          title: market.title,
          marketType: market.marketType,
          createdAt: market.createdAt,
          flags: {
            templateBased: hasTemplateFlag,
            apiGuaranteed: hasAPIGuarantee
          }
        });
      }
    }

    if (violatingMarkets.length > 0) {
      console.error('❌ CRITICAL: Found crypto markets without API guarantees!');
      console.error(`📊 Total violations: ${violatingMarkets.length}`);
      console.error('🚨 These markets cannot be auto-resolved and may require manual intervention:');

      violatingMarkets.forEach(m => {
        console.error(`   - ${m.id}: "${m.title}" (${m.marketType})`);
        console.error(`     Flags: templateBased=${m.flags.templateBased}, apiGuaranteed=${m.flags.apiGuaranteed}`);
      });

      console.error('\n⚠️  RECOMMENDATION: Cancel these markets or manually add API guarantees to marketData');
      console.error('    Use admin panel or run: UPDATE "PredictionMarket" SET "marketData" = ...');
    } else {
      console.log(`✅ All ${activeMarkets.length} active crypto markets have API guarantees`);
    }

  } catch (error) {
    console.error('❌ Failed to validate crypto markets:', error);
  }
}

/**
 * Check if a market has proper API guarantees
 */
export function hasAPIGuarantees(marketData: any): boolean {
  return marketData?.templateBased === true && marketData?.apiGuaranteed === true;
}

/**
 * Get list of API-guaranteed market types
 */
export function getAPIGuaranteedMarketTypes(): string[] {
  return [
    'CRYPTO_PRICE_DIRECTION',
    'CRYPTO_DAILY_CHANGE',
    'CRYPTO_VOLUME',
    'CRYPTO_PRICE_TARGET',
    'CRYPTO_PRICE_RANGE',
    'CRYPTO_RANK_TARGET',
    'SPORTS_WINNER',
    'SPORTS_TOTAL',
    'SPORTS_SPREAD',
    'PRICE_UP_DOWN',
    'PRICE_ABOVE_BELOW',
    'VOLUME_RANKING'
  ];
}
