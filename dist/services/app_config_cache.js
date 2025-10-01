import { prisma } from "./db.js";
const CACHE_TTL_MS = 60 * 1e3;
let cachedConfig = null;
let cacheTimestamp = 0;
async function getAppConfig() {
  const now = Date.now();
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedConfig;
  }
  const config = await prisma.appConfig.findFirst();
  if (!config) {
    throw new Error("AppConfig not initialized. Run scripts/init_app_config.ts");
  }
  cachedConfig = config;
  cacheTimestamp = now;
  return config;
}
async function refreshAppConfigCache() {
  cachedConfig = null;
  cacheTimestamp = 0;
  return getAppConfig();
}
function clearAppConfigCache() {
  cachedConfig = null;
  cacheTimestamp = 0;
}
function getAppConfigCacheStats() {
  return {
    cached: cachedConfig !== null,
    age_ms: cachedConfig ? Date.now() - cacheTimestamp : 0,
    ttl_ms: CACHE_TTL_MS
  };
}
export {
  clearAppConfigCache,
  getAppConfig,
  getAppConfigCacheStats,
  refreshAppConfigCache
};
//# sourceMappingURL=app_config_cache.js.map
