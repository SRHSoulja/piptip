// src/services/ads.ts - Fixed version
import { prisma } from "./db.js";
let _cache = null;
const TTL_MS = 60_000; // 60s
export async function getActiveAd() {
    try {
        const now = Date.now();
        // Refresh cache if expired or empty
        if (!_cache || now - _cache.ts > TTL_MS) {
            console.log("Refreshing ads cache...");
            const rows = await prisma.ad.findMany({
                where: {
                    active: true,
                    weight: { gt: 0 }
                },
                select: { text: true, url: true, weight: true },
                orderBy: { id: "asc" },
            });
            console.log(`Found ${rows.length} active ads`);
            _cache = {
                ads: rows.map(r => ({
                    text: r.text,
                    url: r.url || undefined,
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
        // Calculate total weight
        const total = ads.reduce((sum, ad) => sum + ad.weight, 0);
        if (total <= 0) {
            console.log("Total ad weight is 0");
            return null;
        }
        // Weighted random selection
        let roll = Math.random() * total;
        console.log(`Rolling for ad selection: ${roll} out of ${total}`);
        for (const ad of ads) {
            roll -= ad.weight;
            if (roll <= 0) {
                console.log(`Selected ad: "${ad.text.substring(0, 50)}..."`);
                return { text: ad.text, url: ad.url };
            }
        }
        // Fallback (shouldn't happen)
        const fallback = ads[ads.length - 1];
        console.log("Using fallback ad");
        return { text: fallback.text, url: fallback.url };
    }
    catch (error) {
        console.error("Error getting active ad:", error);
        return null;
    }
}
// Force refresh ads cache
export async function refreshAdsCache() {
    _cache = null;
    await getActiveAd();
}
// Debug function to check ads setup
export async function debugAds() {
    const allAds = await prisma.ad.findMany({
        select: { id: true, text: true, active: true, weight: true },
        orderBy: { id: "asc" },
    });
    const activeAds = allAds.filter(ad => ad.active && ad.weight > 0);
    const totalWeight = activeAds.reduce((sum, ad) => sum + ad.weight, 0);
    return {
        totalAds: allAds.length,
        activeAds: activeAds.length,
        totalWeight,
        ads: allAds,
    };
}
// Create some sample ads for testing - FIXED VERSION
export async function seedSampleAds() {
    const sampleAds = [
        {
            text: "🚀 Trade crypto with zero fees on AbstractSwap!",
            url: "https://abstractswap.com",
            weight: 10,
            active: true,
        },
        {
            text: "🎮 Join the largest Web3 gaming community!",
            url: "https://example-gaming.com",
            weight: 5,
            active: true,
        },
        {
            text: "💎 Stake your tokens and earn 15% APY",
            url: "https://example-staking.com",
            weight: 8,
            active: true,
        },
    ];
    // Use createMany or individual creates instead of upsert
    for (const ad of sampleAds) {
        // Check if ad with this text already exists
        const existing = await prisma.ad.findFirst({
            where: { text: ad.text }
        });
        if (!existing) {
            await prisma.ad.create({ data: ad });
            console.log(`Created ad: "${ad.text.substring(0, 30)}..."`);
        }
        else {
            console.log(`Ad already exists: "${ad.text.substring(0, 30)}..."`);
        }
    }
    console.log(`Sample ads seeding complete`);
    await refreshAdsCache();
}
