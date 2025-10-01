// src/services/app_config_cache.ts - Cached AppConfig access to reduce DB queries
import { prisma } from './db.js';
// Cache configuration
const CACHE_TTL_MS = 60 * 1000; // 1 minute - config rarely changes
let cachedConfig = null;
let cacheTimestamp = 0;
/**
 * Get AppConfig with caching to prevent repeated database queries
 * AppConfig is a singleton table that gets hit on every withdrawal/deposit
 */
export async function getAppConfig() {
    const now = Date.now();
    // Return cached config if still valid
    if (cachedConfig && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return cachedConfig;
    }
    // Fetch fresh config from database
    const config = await prisma.appConfig.findFirst();
    if (!config) {
        throw new Error('AppConfig not initialized. Run scripts/init_app_config.ts');
    }
    // Update cache
    cachedConfig = config;
    cacheTimestamp = now;
    return config;
}
/**
 * Force refresh the cache (call after updating AppConfig)
 */
export async function refreshAppConfigCache() {
    cachedConfig = null;
    cacheTimestamp = 0;
    return getAppConfig();
}
/**
 * Clear the cache (for testing)
 */
export function clearAppConfigCache() {
    cachedConfig = null;
    cacheTimestamp = 0;
}
/**
 * Get cache stats for monitoring
 */
export function getAppConfigCacheStats() {
    return {
        cached: cachedConfig !== null,
        age_ms: cachedConfig ? Date.now() - cacheTimestamp : 0,
        ttl_ms: CACHE_TTL_MS
    };
}
