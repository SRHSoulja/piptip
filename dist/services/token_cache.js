import { getActiveTokens } from "./token.js";
class TokenCache {
  cache = /* @__PURE__ */ new Map();
  CACHE_DURATION = 5 * 60 * 1e3;
  // 5 minutes
  CLEANUP_INTERVAL = 10 * 60 * 1e3;
  // 10 minutes
  cleanupTimer;
  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
  }
  /**
   * Get active tokens with caching
   */
  async getActiveTokens() {
    const cacheKey = "active_tokens";
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expires > now) {
      return cached.data;
    }
    try {
      const tokens = await getActiveTokens();
      this.cache.set(cacheKey, {
        data: tokens,
        expires: now + this.CACHE_DURATION
      });
      return tokens;
    } catch (error) {
      console.error("Failed to fetch active tokens:", error);
      if (cached) {
        console.warn("Using stale token cache due to fetch error");
        return cached.data;
      }
      return [];
    }
  }
  /**
   * Filter tokens for autocomplete with caching
   */
  async getFilteredTokens(query) {
    const tokens = await this.getActiveTokens();
    const q = query.toLowerCase();
    const filtered = tokens.filter(
      (t) => t.symbol.toLowerCase().includes(q) || t.address.toLowerCase().includes(q)
    ).slice(0, 25).map((t) => ({
      name: `${t.symbol} (${t.address.slice(0, 8)}...)`,
      value: t.address
    }));
    return filtered;
  }
  /**
   * Invalidate cache - call when tokens are added/removed/modified
   */
  invalidate(key) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
  /**
   * Get cache statistics for monitoring
   */
  getStats() {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      expiresIn: Math.max(0, entry.expires - now)
    }));
    return {
      size: this.cache.size,
      entries
    };
  }
  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires <= now) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      console.log(`\u{1F9F9} Token cache cleaned up ${cleanedCount} expired entries`);
    }
  }
  /**
   * Shutdown cleanup
   */
  shutdown() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cache.clear();
    console.log("\u{1F6D1} Token cache shutdown");
  }
}
const tokenCache = new TokenCache();
export {
  TokenCache,
  tokenCache
};
//# sourceMappingURL=token_cache.js.map
