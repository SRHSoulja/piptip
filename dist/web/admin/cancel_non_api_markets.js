import { prisma } from "../../services/db.js";
const CRYPTO_MARKET_TYPES = [
  "CRYPTO_PRICE_DIRECTION",
  "CRYPTO_DAILY_CHANGE",
  "CRYPTO_VOLUME",
  "CRYPTO_PRICE_TARGET",
  "CRYPTO_PRICE_RANGE",
  "CRYPTO_RANK_TARGET",
  "PRICE_UP_DOWN",
  "PRICE_ABOVE_BELOW",
  "VOLUME_RANKING"
];
async function cancelNonApiMarkets(req, res) {
  try {
    const violatingMarkets = await prisma.predictionMarket.findMany({
      where: {
        status: "ACTIVE",
        marketType: { in: CRYPTO_MARKET_TYPES }
      }
    });
    const toCancel = violatingMarkets.filter((m) => {
      const marketData = m.marketData;
      return !marketData?.templateBased || !marketData?.apiGuaranteed;
    });
    if (toCancel.length === 0) {
      return res.json({
        success: true,
        message: "No markets to cancel",
        cancelled: 0
      });
    }
    const results = await Promise.all(
      toCancel.map(async (market) => {
        try {
          await prisma.predictionMarket.update({
            where: { id: market.id },
            data: {
              status: "CANCELLED",
              outcome: "CANCEL",
              resolvedAt: /* @__PURE__ */ new Date()
            }
          });
          return { id: market.id, title: market.title, success: true };
        } catch (error) {
          return { id: market.id, title: market.title, success: false, error: error.message };
        }
      })
    );
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;
    res.json({
      success: true,
      cancelled: successCount,
      failed: failCount,
      markets: results
    });
  } catch (error) {
    console.error("Error cancelling non-API markets:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
export {
  cancelNonApiMarkets
};
//# sourceMappingURL=cancel_non_api_markets.js.map
