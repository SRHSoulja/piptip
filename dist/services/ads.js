import { prisma } from "./db.js";
let _cache = null;
const TTL_MS = 6e4;
async function getActiveAd() {
  try {
    const now = Date.now();
    if (!_cache || now - _cache.ts > TTL_MS) {
      console.log("Refreshing ads cache...");
      const rows = await prisma.ad.findMany({
        where: {
          active: true,
          weight: { gt: 0 }
        },
        select: { text: true, url: true, weight: true },
        orderBy: { id: "asc" }
      });
      console.log(`Found ${rows.length} active ads`);
      _cache = {
        ads: rows.map((r) => ({
          text: r.text,
          url: r.url || void 0,
          weight: Number(r.weight || 1)
        })),
        ts: now
      };
    }
    const ads = _cache.ads;
    if (!ads.length) {
      console.log("No active ads available");
      return null;
    }
    const total = ads.reduce((sum, ad) => sum + ad.weight, 0);
    if (total <= 0) {
      console.log("Total ad weight is 0");
      return null;
    }
    let roll = Math.random() * total;
    console.log(`Rolling for ad selection: ${roll} out of ${total}`);
    for (const ad of ads) {
      roll -= ad.weight;
      if (roll <= 0) {
        console.log(`Selected ad: "${ad.text.substring(0, 50)}..."`);
        return { text: ad.text, url: ad.url };
      }
    }
    const fallback = ads[ads.length - 1];
    console.log("Using fallback ad");
    return { text: fallback.text, url: fallback.url };
  } catch (error) {
    console.error("Error getting active ad:", error);
    return null;
  }
}
async function refreshAdsCache() {
  _cache = null;
  await getActiveAd();
}
async function debugAds() {
  const allAds = await prisma.ad.findMany({
    select: { id: true, text: true, active: true, weight: true },
    orderBy: { id: "asc" }
  });
  const activeAds = allAds.filter((ad) => ad.active && ad.weight > 0);
  const totalWeight = activeAds.reduce((sum, ad) => sum + ad.weight, 0);
  return {
    totalAds: allAds.length,
    activeAds: activeAds.length,
    totalWeight,
    ads: allAds
  };
}
async function seedSampleAds() {
  const sampleAds = [
    {
      text: "\u{1F680} Trade crypto with zero fees on AbstractSwap!",
      url: "https://abstractswap.com",
      weight: 10,
      active: true
    },
    {
      text: "\u{1F3AE} Join the largest Web3 gaming community!",
      url: "https://example-gaming.com",
      weight: 5,
      active: true
    },
    {
      text: "\u{1F48E} Stake your tokens and earn 15% APY",
      url: "https://example-staking.com",
      weight: 8,
      active: true
    }
  ];
  for (const ad of sampleAds) {
    const existing = await prisma.ad.findFirst({
      where: { text: ad.text }
    });
    if (!existing) {
      await prisma.ad.create({ data: ad });
      console.log(`Created ad: "${ad.text.substring(0, 30)}..."`);
    } else {
      console.log(`Ad already exists: "${ad.text.substring(0, 30)}..."`);
    }
  }
  console.log(`Sample ads seeding complete`);
  await refreshAdsCache();
}
export {
  debugAds,
  getActiveAd,
  refreshAdsCache,
  seedSampleAds
};
//# sourceMappingURL=ads.js.map
