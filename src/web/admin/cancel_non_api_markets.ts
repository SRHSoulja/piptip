// Admin endpoint to cancel markets without API guarantees
import type { Request, Response } from 'express';
import { prisma } from '../../services/db.js';

const CRYPTO_MARKET_TYPES = [
  'CRYPTO_PRICE_DIRECTION', 'CRYPTO_DAILY_CHANGE', 'CRYPTO_VOLUME',
  'CRYPTO_PRICE_TARGET', 'CRYPTO_PRICE_RANGE', 'CRYPTO_RANK_TARGET',
  'PRICE_UP_DOWN', 'PRICE_ABOVE_BELOW', 'VOLUME_RANKING'
];

// Known stress test market IDs to force cancel
const STRESS_TEST_MARKET_IDS = [
  'cmg6217q20000hyepxpx8e3p6',
  'cmg63d3lf0011hyborcqnw03u',
  'cmg64g4dr000lhyf6ial1izo8'
];

export async function cancelNonApiMarkets(req: Request, res: Response) {
  try {
    // Find all crypto markets without proper flags OR stress test markets
    const violatingMarkets = await prisma.predictionMarket.findMany({
      where: {
        OR: [
          {
            status: 'ACTIVE',
            marketType: { in: CRYPTO_MARKET_TYPES }
          },
          {
            id: { in: STRESS_TEST_MARKET_IDS }
          }
        ]
      }
    });

    const toCancel = violatingMarkets.filter(m => {
      // Always cancel stress test markets
      if (STRESS_TEST_MARKET_IDS.includes(m.id)) {
        return true;
      }
      // Otherwise check API guarantees
      const marketData = m.marketData as any;
      return !marketData?.templateBased || !marketData?.apiGuaranteed;
    });

    if (toCancel.length === 0) {
      return res.json({
        success: true,
        message: 'No markets to cancel',
        cancelled: 0
      });
    }

    // Cancel each market
    const results = await Promise.all(
      toCancel.map(async (market) => {
        try {
          await prisma.predictionMarket.update({
            where: { id: market.id },
            data: {
              status: 'CANCELLED',
              outcome: 'CANCEL',
              resolvedAt: new Date()
            }
          });
          return { id: market.id, title: market.title, success: true };
        } catch (error: any) {
          return { id: market.id, title: market.title, success: false, error: error.message };
        }
      })
    );

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    res.json({
      success: true,
      cancelled: successCount,
      failed: failCount,
      markets: results
    });
  } catch (error: any) {
    console.error('Error cancelling non-API markets:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
