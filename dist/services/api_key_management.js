import crypto from "crypto";
import { getSecureCredential } from "./secure_key.js";
const RATE_LIMITS = {
  BASIC: { perMinute: 10, perHour: 100, perDay: 1e3 },
  PREMIUM: { perMinute: 100, perHour: 1e3, perDay: 1e4 },
  ENTERPRISE: { perMinute: 500, perHour: 5e3, perDay: 5e4 }
};
class ApiKeyManagementService {
  apiKeys = /* @__PURE__ */ new Map();
  cleanupInterval;
  ENCRYPTION_KEY;
  constructor() {
    try {
      this.ENCRYPTION_KEY = getSecureCredential("API_KEY_ENCRYPTION_KEY");
    } catch {
      try {
        const adminSecret = getSecureCredential("ADMIN_SECRET");
        this.ENCRYPTION_KEY = crypto.createHmac("sha256", adminSecret).update("api-key-encryption").digest("hex");
      } catch {
        if (process.env.NODE_ENV === "development") {
          this.ENCRYPTION_KEY = "dev-api-key-encryption-change-in-production";
          console.warn("\u26A0\uFE0F Using fallback API key encryption in development mode");
        } else {
          throw new Error("API_KEY_ENCRYPTION_KEY required for API key management");
        }
      }
    }
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1e3);
    console.log("\u{1F511} API key management service initialized");
  }
  /**
   * Generate a new API key for a partner
   */
  async generateApiKey(params) {
    const keyBytes = crypto.randomBytes(32);
    const secretKey = `pk_${params.rateLimitTier.toLowerCase()}_${keyBytes.toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(secretKey).digest("hex");
    const keyPrefix = secretKey.slice(0, 16);
    const now = /* @__PURE__ */ new Date();
    const expiresAt = params.expiresInDays ? new Date(now.getTime() + params.expiresInDays * 24 * 60 * 60 * 1e3) : void 0;
    const apiKey = {
      id: crypto.randomUUID(),
      name: params.name,
      keyHash,
      keyPrefix,
      permissions: [...params.permissions],
      partnerId: params.partnerId,
      partnerName: params.partnerName,
      rateLimitTier: params.rateLimitTier,
      createdAt: now,
      expiresAt,
      isActive: true,
      usageStats: {
        totalRequests: 0,
        requestsThisHour: 0,
        requestsToday: 0,
        lastHourReset: now,
        lastDayReset: now
      },
      ipWhitelist: params.ipWhitelist,
      allowedEndpoints: params.allowedEndpoints
    };
    this.apiKeys.set(keyHash, apiKey);
    console.log(`\u{1F511} Generated API key for partner ${params.partnerName} (${params.rateLimitTier} tier)`);
    return { apiKey, secretKey };
  }
  /**
   * Validate API key and check permissions
   */
  async validateApiKey(key, req) {
    if (!key || !key.startsWith("pk_")) {
      return { valid: false, error: "Invalid API key format" };
    }
    const keyHash = crypto.createHash("sha256").update(key).digest("hex");
    const apiKey = this.apiKeys.get(keyHash);
    if (!apiKey) {
      return { valid: false, error: "API key not found" };
    }
    if (!apiKey.isActive) {
      return { valid: false, error: "API key is deactivated" };
    }
    if (apiKey.expiresAt && Date.now() > apiKey.expiresAt.getTime()) {
      return { valid: false, error: "API key expired" };
    }
    if (apiKey.ipWhitelist && apiKey.ipWhitelist.length > 0) {
      const clientIP = this.getClientIP(req);
      if (!apiKey.ipWhitelist.includes(clientIP)) {
        console.warn(`\u{1F6AB} API key ${apiKey.keyPrefix}... blocked: IP ${clientIP} not in whitelist`);
        return { valid: false, error: "IP address not authorized" };
      }
    }
    if (apiKey.allowedEndpoints && apiKey.allowedEndpoints.length > 0) {
      const isEndpointAllowed = apiKey.allowedEndpoints.some(
        (endpoint) => req.path.startsWith(endpoint) || req.path.match(new RegExp(endpoint))
      );
      if (!isEndpointAllowed) {
        console.warn(`\u{1F6AB} API key ${apiKey.keyPrefix}... blocked: endpoint ${req.path} not allowed`);
        return { valid: false, error: "Endpoint not authorized" };
      }
    }
    const rateLimitCheck = this.checkRateLimit(apiKey);
    if (!rateLimitCheck.allowed) {
      console.warn(`\u23F1\uFE0F Rate limit exceeded for API key ${apiKey.keyPrefix}... (${apiKey.rateLimitTier})`);
      return {
        valid: false,
        error: `Rate limit exceeded: ${rateLimitCheck.error}`,
        rateLimitExceeded: true
      };
    }
    this.updateUsageStats(apiKey);
    return { valid: true, apiKey };
  }
  /**
   * Check rate limits for an API key
   */
  checkRateLimit(apiKey) {
    const now = /* @__PURE__ */ new Date();
    const limits = RATE_LIMITS[apiKey.rateLimitTier];
    if (now.getTime() - apiKey.usageStats.lastHourReset.getTime() >= 60 * 60 * 1e3) {
      apiKey.usageStats.requestsThisHour = 0;
      apiKey.usageStats.lastHourReset = now;
    }
    if (now.getTime() - apiKey.usageStats.lastDayReset.getTime() >= 24 * 60 * 60 * 1e3) {
      apiKey.usageStats.requestsToday = 0;
      apiKey.usageStats.lastDayReset = now;
    }
    if (apiKey.usageStats.requestsToday >= limits.perDay) {
      return { allowed: false, error: "Daily limit exceeded" };
    }
    if (apiKey.usageStats.requestsThisHour >= limits.perHour) {
      return { allowed: false, error: "Hourly limit exceeded" };
    }
    return { allowed: true };
  }
  /**
   * Update usage statistics for an API key
   */
  updateUsageStats(apiKey) {
    apiKey.lastUsedAt = /* @__PURE__ */ new Date();
    apiKey.usageStats.totalRequests++;
    apiKey.usageStats.requestsThisHour++;
    apiKey.usageStats.requestsToday++;
  }
  /**
   * Express middleware for API key authentication
   */
  apiKeyMiddleware(requiredPermissions = []) {
    return async (req, res, next) => {
      const apiKey = req.get("X-API-Key") || req.query.api_key;
      if (!apiKey) {
        return res.status(401).json({
          error: "API key required",
          code: "MISSING_API_KEY",
          message: "Provide API key in X-API-Key header or api_key query parameter"
        });
      }
      const validation = await this.validateApiKey(apiKey, req);
      if (!validation.valid) {
        const status = validation.rateLimitExceeded ? 429 : 401;
        return res.status(status).json({
          error: validation.error,
          code: validation.rateLimitExceeded ? "RATE_LIMIT_EXCEEDED" : "INVALID_API_KEY"
        });
      }
      if (requiredPermissions.length > 0) {
        const hasPermission = requiredPermissions.every(
          (perm) => validation.apiKey.permissions.includes(perm) || validation.apiKey.permissions.includes("*")
          // Wildcard permission
        );
        if (!hasPermission) {
          return res.status(403).json({
            error: "Insufficient permissions",
            code: "INSUFFICIENT_PERMISSIONS",
            required: requiredPermissions,
            available: validation.apiKey.permissions
          });
        }
      }
      req.apiKey = validation.apiKey;
      req.partnerId = validation.apiKey.partnerId;
      next();
    };
  }
  /**
   * Deactivate an API key
   */
  deactivateApiKey(keyId) {
    for (const [hash, apiKey] of this.apiKeys.entries()) {
      if (apiKey.id === keyId) {
        apiKey.isActive = false;
        console.log(`\u{1F512} Deactivated API key ${apiKey.keyPrefix}... for ${apiKey.partnerName}`);
        return true;
      }
    }
    return false;
  }
  /**
   * Delete an API key permanently
   */
  deleteApiKey(keyId) {
    for (const [hash, apiKey] of this.apiKeys.entries()) {
      if (apiKey.id === keyId) {
        this.apiKeys.delete(hash);
        console.log(`\u{1F5D1}\uFE0F Deleted API key ${apiKey.keyPrefix}... for ${apiKey.partnerName}`);
        return true;
      }
    }
    return false;
  }
  /**
   * Get all API keys (without sensitive data)
   */
  getAllApiKeys() {
    return Array.from(this.apiKeys.values()).map((key) => {
      const { keyHash, ...safeKey } = key;
      return safeKey;
    });
  }
  /**
   * Get API key statistics
   */
  getApiKeyStats() {
    const keys = Array.from(this.apiKeys.values());
    const now = /* @__PURE__ */ new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
    const stats = {
      totalKeys: keys.length,
      activeKeys: keys.filter((k) => k.isActive).length,
      expiredKeys: keys.filter((k) => k.expiresAt && now > k.expiresAt).length,
      totalRequests: keys.reduce((sum, k) => sum + k.usageStats.totalRequests, 0),
      requestsLast24h: keys.reduce((sum, k) => sum + k.usageStats.requestsToday, 0),
      topPartners: this.getTopPartners(keys, 10),
      rateLimitTierBreakdown: this.getRateLimitTierBreakdown(keys)
    };
    return stats;
  }
  /**
   * Get top partners by request volume
   */
  getTopPartners(keys, limit) {
    const partnerStats = keys.reduce((acc, key) => {
      acc[key.partnerId] = (acc[key.partnerId] || 0) + key.usageStats.totalRequests;
      return acc;
    }, {});
    return Object.entries(partnerStats).sort(([, a], [, b]) => b - a).slice(0, limit).map(([partnerId, requests]) => ({ partnerId, requests }));
  }
  /**
   * Get breakdown by rate limit tier
   */
  getRateLimitTierBreakdown(keys) {
    return keys.reduce((acc, key) => {
      acc[key.rateLimitTier] = (acc[key.rateLimitTier] || 0) + 1;
      return acc;
    }, {});
  }
  /**
   * Get client IP address
   */
  getClientIP(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor) ? forwardedFor : forwardedFor.split(",");
      return ips[0].trim();
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  }
  /**
   * Clean up expired keys and reset counters
   */
  cleanup() {
    const now = /* @__PURE__ */ new Date();
    let cleanedKeys = 0;
    for (const [hash, apiKey] of this.apiKeys.entries()) {
      if (apiKey.expiresAt && now.getTime() - apiKey.expiresAt.getTime() > 30 * 24 * 60 * 60 * 1e3) {
        this.apiKeys.delete(hash);
        cleanedKeys++;
      }
    }
    if (cleanedKeys > 0) {
      console.log(`\u{1F9F9} Cleaned up ${cleanedKeys} expired API keys`);
    }
  }
  /**
   * Shutdown and cleanup
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.apiKeys.clear();
    console.log("\u{1F511} API key management service destroyed");
  }
}
const apiKeyManager = new ApiKeyManagementService();
const apiKeyMiddleware = (permissions = []) => apiKeyManager.apiKeyMiddleware(permissions);
const readOnlyApiKey = () => apiKeyMiddleware(["read"]);
const writeApiKey = () => apiKeyMiddleware(["read", "write"]);
const adminApiKey = () => apiKeyMiddleware(["admin"]);
async function generateApiKey(params) {
  return apiKeyManager.generateApiKey(params);
}
function deactivateApiKey(keyId) {
  return apiKeyManager.deactivateApiKey(keyId);
}
function deleteApiKey(keyId) {
  return apiKeyManager.deleteApiKey(keyId);
}
function getAllApiKeys() {
  return apiKeyManager.getAllApiKeys();
}
function getApiKeyStats() {
  return apiKeyManager.getApiKeyStats();
}
process.on("exit", () => apiKeyManager.destroy());
process.on("SIGINT", () => apiKeyManager.destroy());
process.on("SIGTERM", () => apiKeyManager.destroy());
export {
  adminApiKey,
  apiKeyManager,
  apiKeyMiddleware,
  deactivateApiKey,
  deleteApiKey,
  generateApiKey,
  getAllApiKeys,
  getApiKeyStats,
  readOnlyApiKey,
  writeApiKey
};
//# sourceMappingURL=api_key_management.js.map
