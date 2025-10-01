import { prisma } from "./db.js";
async function validateCryptoMarketsOnStartup() {
  try {
    console.log("\u{1F50D} Validating crypto markets for API guarantees...");
    const cryptoMarketTypes = [
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
    const activeMarkets = await prisma.predictionMarket.findMany({
      where: {
        status: "ACTIVE",
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
    const violatingMarkets = [];
    for (const market of activeMarkets) {
      const marketData = market.marketData;
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
      console.error("\u274C CRITICAL: Found crypto markets without API guarantees!");
      console.error(`\u{1F4CA} Total violations: ${violatingMarkets.length}`);
      console.error("\u{1F6A8} These markets cannot be auto-resolved and may require manual intervention:");
      violatingMarkets.forEach((m) => {
        console.error(`   - ${m.id}: "${m.title}" (${m.marketType})`);
        console.error(`     Flags: templateBased=${m.flags.templateBased}, apiGuaranteed=${m.flags.apiGuaranteed}`);
      });
      console.error("\n\u26A0\uFE0F  RECOMMENDATION: Cancel these markets or manually add API guarantees to marketData");
      console.error('    Use admin panel or run: UPDATE "PredictionMarket" SET "marketData" = ...');
    } else {
      console.log(`\u2705 All ${activeMarkets.length} active crypto markets have API guarantees`);
    }
  } catch (error) {
    console.error("\u274C Failed to validate crypto markets:", error);
  }
}
function hasAPIGuarantees(marketData) {
  return marketData?.templateBased === true && marketData?.apiGuaranteed === true;
}
function getAPIGuaranteedMarketTypes() {
  return [
    "CRYPTO_PRICE_DIRECTION",
    "CRYPTO_DAILY_CHANGE",
    "CRYPTO_VOLUME",
    "CRYPTO_PRICE_TARGET",
    "CRYPTO_PRICE_RANGE",
    "CRYPTO_RANK_TARGET",
    "SPORTS_WINNER",
    "SPORTS_TOTAL",
    "SPORTS_SPREAD",
    "PRICE_UP_DOWN",
    "PRICE_ABOVE_BELOW",
    "VOLUME_RANKING"
  ];
}
export {
  getAPIGuaranteedMarketTypes,
  hasAPIGuarantees,
  validateCryptoMarketsOnStartup
};
//# sourceMappingURL=crypto_market_validator.js.map
