// src/services/ads.ts
import { prisma } from "./db.js";

export type AdPayload = { text: string; url?: string };

/**
 * Returns a single active ad using simple weighted random selection.
 * Caches the active list for a short TTL to avoid hammering the DB.
 */
let _cache: { ads: { text: string; url?: string; weight: number }[]; ts: number } | null = null;
const TTL_MS = 60_000; // 60s

export async function getActiveAd(): Promise<AdPayload | null> {
  const now = Date.now();
  if (!_cache || now - _cache.ts > TTL_MS) {
    const rows = await prisma.ad.findMany({
      where: { active: true, weight: { gt: 0 } },
      select: { text: true, url: true, weight: true },
      orderBy: { id: "asc" },
    });
    _cache = { ads: rows.map(r => ({ text: r.text, url: r.url || undefined, weight: Number(r.weight || 0) })), ts: now };
  }

  const ads = _cache.ads;
  if (!ads.length) return null;

  const total = ads.reduce((s, a) => s + a.weight, 0);
  if (total <= 0) return null;

  let roll = Math.random() * total;
  for (const ad of ads) {
    if ((roll -= ad.weight) <= 0) {
      return { text: ad.text, url: ad.url };
    }
  }
  // Fallback (shouldn't happen)
  const last = ads[ads.length - 1];
  return { text: last.text, url: last.url };
}
