// API Key Management System
// Secure API key generation and validation for partner integrations

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { getSecureCredential } from './secure_key.js';

interface ApiKey {
  id: string;
  name: string;
  keyHash: string; // SHA256 hash of the actual key
  keyPrefix: string; // First 8 characters for identification
  permissions: string[];
  partnerId: string;
  partnerName: string;
  rateLimitTier: 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
  createdAt: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
  isActive: boolean;
  usageStats: {
    totalRequests: number;
    requestsThisHour: number;
    requestsToday: number;
    lastHourReset: Date;
    lastDayReset: Date;
  };
  ipWhitelist?: string[]; // Optional IP restrictions
  allowedEndpoints?: string[]; // Optional endpoint restrictions
}

interface RateLimitConfig {
  BASIC: { perMinute: number; perHour: number; perDay: number };
  PREMIUM: { perMinute: number; perHour: number; perDay: number };
  ENTERPRISE: { perMinute: number; perHour: number; perDay: number };
}

const RATE_LIMITS: RateLimitConfig = {
  BASIC: { perMinute: 10, perHour: 100, perDay: 1000 },
  PREMIUM: { perMinute: 100, perHour: 1000, perDay: 10000 },
  ENTERPRISE: { perMinute: 500, perHour: 5000, perDay: 50000 }
};

class ApiKeyManagementService {
  private apiKeys = new Map<string, ApiKey>();
  private cleanupInterval: NodeJS.Timeout;
  private readonly ENCRYPTION_KEY: string;

  constructor() {
    // Get encryption key for API key storage
    try {
      this.ENCRYPTION_KEY = getSecureCredential('API_KEY_ENCRYPTION_KEY');
    } catch {
      try {
        const adminSecret = getSecureCredential('ADMIN_SECRET');
        this.ENCRYPTION_KEY = crypto.createHmac('sha256', adminSecret).update('api-key-encryption').digest('hex');
      } catch {
        if (process.env.NODE_ENV === 'development') {
          this.ENCRYPTION_KEY = 'dev-api-key-encryption-change-in-production';
          console.warn('⚠️ Using fallback API key encryption in development mode');
        } else {
          throw new Error('API_KEY_ENCRYPTION_KEY required for API key management');
        }
      }
    }

    // Cleanup expired keys and reset counters every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);

    console.log('🔑 API key management service initialized');
  }

  /**
   * Generate a new API key for a partner
   */
  async generateApiKey(params: {
    name: string;
    partnerId: string;
    partnerName: string;
    permissions: string[];
    rateLimitTier: 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
    expiresInDays?: number;
    ipWhitelist?: string[];
    allowedEndpoints?: string[];
  }): Promise<{ apiKey: ApiKey; secretKey: string }> {

    // Generate cryptographically secure key
    const keyBytes = crypto.randomBytes(32);
    const secretKey = `pk_${params.rateLimitTier.toLowerCase()}_${keyBytes.toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(secretKey).digest('hex');
    const keyPrefix = secretKey.slice(0, 16); // Include prefix for identification

    const now = new Date();
    const expiresAt = params.expiresInDays
      ? new Date(now.getTime() + params.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    const apiKey: ApiKey = {
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

    console.log(`🔑 Generated API key for partner ${params.partnerName} (${params.rateLimitTier} tier)`);

    return { apiKey, secretKey };
  }

  /**
   * Validate API key and check permissions
   */
  async validateApiKey(key: string, req: Request): Promise<{
    valid: boolean;
    apiKey?: ApiKey;
    error?: string;
    rateLimitExceeded?: boolean;
  }> {
    if (!key || !key.startsWith('pk_')) {
      return { valid: false, error: 'Invalid API key format' };
    }

    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const apiKey = this.apiKeys.get(keyHash);

    if (!apiKey) {
      return { valid: false, error: 'API key not found' };
    }

    if (!apiKey.isActive) {
      return { valid: false, error: 'API key is deactivated' };
    }

    if (apiKey.expiresAt && Date.now() > apiKey.expiresAt.getTime()) {
      return { valid: false, error: 'API key expired' };
    }

    // Check IP whitelist if configured
    if (apiKey.ipWhitelist && apiKey.ipWhitelist.length > 0) {
      const clientIP = this.getClientIP(req);
      if (!apiKey.ipWhitelist.includes(clientIP)) {
        console.warn(`🚫 API key ${apiKey.keyPrefix}... blocked: IP ${clientIP} not in whitelist`);
        return { valid: false, error: 'IP address not authorized' };
      }
    }

    // Check endpoint restrictions if configured
    if (apiKey.allowedEndpoints && apiKey.allowedEndpoints.length > 0) {
      const isEndpointAllowed = apiKey.allowedEndpoints.some(endpoint =>
        req.path.startsWith(endpoint) || req.path.match(new RegExp(endpoint))
      );

      if (!isEndpointAllowed) {
        console.warn(`🚫 API key ${apiKey.keyPrefix}... blocked: endpoint ${req.path} not allowed`);
        return { valid: false, error: 'Endpoint not authorized' };
      }
    }

    // Check rate limits
    const rateLimitCheck = this.checkRateLimit(apiKey);
    if (!rateLimitCheck.allowed) {
      console.warn(`⏱️ Rate limit exceeded for API key ${apiKey.keyPrefix}... (${apiKey.rateLimitTier})`);
      return {
        valid: false,
        error: `Rate limit exceeded: ${rateLimitCheck.error}`,
        rateLimitExceeded: true
      };
    }

    // Update usage stats
    this.updateUsageStats(apiKey);

    return { valid: true, apiKey };
  }

  /**
   * Check rate limits for an API key
   */
  private checkRateLimit(apiKey: ApiKey): { allowed: boolean; error?: string } {
    const now = new Date();
    const limits = RATE_LIMITS[apiKey.rateLimitTier];

    // Reset hourly counter if needed
    if (now.getTime() - apiKey.usageStats.lastHourReset.getTime() >= 60 * 60 * 1000) {
      apiKey.usageStats.requestsThisHour = 0;
      apiKey.usageStats.lastHourReset = now;
    }

    // Reset daily counter if needed
    if (now.getTime() - apiKey.usageStats.lastDayReset.getTime() >= 24 * 60 * 60 * 1000) {
      apiKey.usageStats.requestsToday = 0;
      apiKey.usageStats.lastDayReset = now;
    }

    // Check daily limit
    if (apiKey.usageStats.requestsToday >= limits.perDay) {
      return { allowed: false, error: 'Daily limit exceeded' };
    }

    // Check hourly limit
    if (apiKey.usageStats.requestsThisHour >= limits.perHour) {
      return { allowed: false, error: 'Hourly limit exceeded' };
    }

    // For minute-based limiting, we'd need a more sophisticated sliding window
    // For now, we use a simple approximation based on recent usage

    return { allowed: true };
  }

  /**
   * Update usage statistics for an API key
   */
  private updateUsageStats(apiKey: ApiKey): void {
    apiKey.lastUsedAt = new Date();
    apiKey.usageStats.totalRequests++;
    apiKey.usageStats.requestsThisHour++;
    apiKey.usageStats.requestsToday++;
  }

  /**
   * Express middleware for API key authentication
   */
  apiKeyMiddleware(requiredPermissions: string[] = []) {
    return async (req: Request, res: Response, next: NextFunction) => {
      const apiKey = req.get('X-API-Key') || req.query.api_key as string;

      if (!apiKey) {
        return res.status(401).json({
          error: 'API key required',
          code: 'MISSING_API_KEY',
          message: 'Provide API key in X-API-Key header or api_key query parameter'
        });
      }

      const validation = await this.validateApiKey(apiKey, req);

      if (!validation.valid) {
        const status = validation.rateLimitExceeded ? 429 : 401;
        return res.status(status).json({
          error: validation.error,
          code: validation.rateLimitExceeded ? 'RATE_LIMIT_EXCEEDED' : 'INVALID_API_KEY'
        });
      }

      // Check required permissions
      if (requiredPermissions.length > 0) {
        const hasPermission = requiredPermissions.every(perm =>
          validation.apiKey!.permissions.includes(perm) ||
          validation.apiKey!.permissions.includes('*') // Wildcard permission
        );

        if (!hasPermission) {
          return res.status(403).json({
            error: 'Insufficient permissions',
            code: 'INSUFFICIENT_PERMISSIONS',
            required: requiredPermissions,
            available: validation.apiKey!.permissions
          });
        }
      }

      // Add API key info to request
      (req as any).apiKey = validation.apiKey;
      (req as any).partnerId = validation.apiKey!.partnerId;
      next();
    };
  }

  /**
   * Deactivate an API key
   */
  deactivateApiKey(keyId: string): boolean {
    for (const [hash, apiKey] of this.apiKeys.entries()) {
      if (apiKey.id === keyId) {
        apiKey.isActive = false;
        console.log(`🔒 Deactivated API key ${apiKey.keyPrefix}... for ${apiKey.partnerName}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Delete an API key permanently
   */
  deleteApiKey(keyId: string): boolean {
    for (const [hash, apiKey] of this.apiKeys.entries()) {
      if (apiKey.id === keyId) {
        this.apiKeys.delete(hash);
        console.log(`🗑️ Deleted API key ${apiKey.keyPrefix}... for ${apiKey.partnerName}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Get all API keys (without sensitive data)
   */
  getAllApiKeys(): Omit<ApiKey, 'keyHash'>[] {
    return Array.from(this.apiKeys.values()).map(key => {
      const { keyHash, ...safeKey } = key;
      return safeKey;
    });
  }

  /**
   * Get API key statistics
   */
  getApiKeyStats(): {
    totalKeys: number;
    activeKeys: number;
    expiredKeys: number;
    totalRequests: number;
    requestsLast24h: number;
    topPartners: { partnerId: string; requests: number }[];
    rateLimitTierBreakdown: Record<string, number>;
  } {
    const keys = Array.from(this.apiKeys.values());
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const stats = {
      totalKeys: keys.length,
      activeKeys: keys.filter(k => k.isActive).length,
      expiredKeys: keys.filter(k => k.expiresAt && now > k.expiresAt).length,
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
  private getTopPartners(keys: ApiKey[], limit: number): { partnerId: string; requests: number }[] {
    const partnerStats = keys.reduce((acc, key) => {
      acc[key.partnerId] = (acc[key.partnerId] || 0) + key.usageStats.totalRequests;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(partnerStats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([partnerId, requests]) => ({ partnerId, requests }));
  }

  /**
   * Get breakdown by rate limit tier
   */
  private getRateLimitTierBreakdown(keys: ApiKey[]): Record<string, number> {
    return keys.reduce((acc, key) => {
      acc[key.rateLimitTier] = (acc[key.rateLimitTier] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  /**
   * Get client IP address
   */
  private getClientIP(req: Request): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor) ? forwardedFor : forwardedFor.split(',');
      return ips[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  /**
   * Clean up expired keys and reset counters
   */
  private cleanup(): void {
    const now = new Date();
    let cleanedKeys = 0;

    for (const [hash, apiKey] of this.apiKeys.entries()) {
      // Remove expired keys that have been expired for more than 30 days
      if (apiKey.expiresAt &&
          now.getTime() - apiKey.expiresAt.getTime() > 30 * 24 * 60 * 60 * 1000) {
        this.apiKeys.delete(hash);
        cleanedKeys++;
      }
    }

    if (cleanedKeys > 0) {
      console.log(`🧹 Cleaned up ${cleanedKeys} expired API keys`);
    }
  }

  /**
   * Shutdown and cleanup
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.apiKeys.clear();
    console.log('🔑 API key management service destroyed');
  }
}

// Create singleton instance
export const apiKeyManager = new ApiKeyManagementService();

// Export middleware functions
export const apiKeyMiddleware = (permissions: string[] = []) =>
  apiKeyManager.apiKeyMiddleware(permissions);

// Specific permission middlewares
export const readOnlyApiKey = () => apiKeyMiddleware(['read']);
export const writeApiKey = () => apiKeyMiddleware(['read', 'write']);
export const adminApiKey = () => apiKeyMiddleware(['admin']);

// Utility functions
export async function generateApiKey(params: Parameters<typeof apiKeyManager.generateApiKey>[0]) {
  return apiKeyManager.generateApiKey(params);
}

export function deactivateApiKey(keyId: string) {
  return apiKeyManager.deactivateApiKey(keyId);
}

export function deleteApiKey(keyId: string) {
  return apiKeyManager.deleteApiKey(keyId);
}

export function getAllApiKeys() {
  return apiKeyManager.getAllApiKeys();
}

export function getApiKeyStats() {
  return apiKeyManager.getApiKeyStats();
}

// Cleanup on process exit
process.on('exit', () => apiKeyManager.destroy());
process.on('SIGINT', () => apiKeyManager.destroy());
process.on('SIGTERM', () => apiKeyManager.destroy());