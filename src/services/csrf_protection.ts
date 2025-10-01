// src/services/csrf_protection.ts - CSRF protection service for admin operations
import { randomBytes, timingSafeEqual, createHmac } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { getSecureCredential } from './secure_key.js';

interface CSRFToken {
  token: string;
  secret: string;
  createdAt: number;
  expiresAt: number;
  sessionId?: string;  // Bind token to specific session
  userId?: string;     // Bind token to specific user (when available)
}

class CSRFProtectionService {
  private tokenStore = new Map<string, CSRFToken>();
  private readonly tokenExpiry = 1000 * 60 * 60; // 1 hour
  private readonly secretKey: string;
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Use secure credential for CSRF secret, fallback to ADMIN_SECRET
    try {
      this.secretKey = getSecureCredential('CSRF_SECRET');
    } catch {
      try {
        this.secretKey = getSecureCredential('ADMIN_SECRET');
      } catch {
        // Fallback for development - should be replaced with proper secret
        this.secretKey = process.env.NODE_ENV === 'development'
          ? 'dev-csrf-secret-replace-in-production'
          : (() => { throw new Error('CSRF_SECRET or ADMIN_SECRET required for CSRF protection'); })();
      }
    }

    // Cleanup expired tokens every 15 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, 15 * 60 * 1000);

    console.log('🔐 CSRF protection service initialized');
  }

  /**
   * Generate a new CSRF token and secret pair with session binding
   */
  generateToken(sessionId?: string, userId?: string): { token: string; secret: string } {
    const secret = randomBytes(32).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    const timestamp = Date.now();

    // Create HMAC-based token with session/user binding
    const hmac = createHmac('sha256', this.secretKey);
    hmac.update(secret);
    hmac.update(timestamp.toString());
    hmac.update(nonce);

    // Bind token to session and/or user if available
    if (sessionId) {
      hmac.update(sessionId);
    }
    if (userId) {
      hmac.update(userId);
    }

    const token = hmac.digest('hex');

    const csrfToken: CSRFToken = {
      token,
      secret,
      createdAt: timestamp,
      expiresAt: timestamp + this.tokenExpiry,
      sessionId,
      userId
    };

    this.tokenStore.set(token, csrfToken);

    const bindingInfo = [];
    if (sessionId) bindingInfo.push(`session:${sessionId.slice(0, 8)}...`);
    if (userId) bindingInfo.push(`user:${userId}`);
    const bindingStr = bindingInfo.length > 0 ? ` (bound to ${bindingInfo.join(', ')})` : '';

    console.log(`🎫 Generated new CSRF token${bindingStr}, total active:`, this.tokenStore.size);

    return { token, secret };
  }

  /**
   * Verify a CSRF token against its secret with session/user binding validation
   */
  verifyToken(token: string, secret: string, sessionId?: string, userId?: string): boolean {
    if (!token || !secret) {
      console.warn('⚠️ CSRF verification failed: missing token or secret');
      return false;
    }

    const stored = this.tokenStore.get(token);
    if (!stored) {
      console.warn('⚠️ CSRF verification failed: token not found');
      return false;
    }

    // Check expiration
    if (Date.now() > stored.expiresAt) {
      console.warn('⚠️ CSRF verification failed: token expired');
      this.tokenStore.delete(token);
      return false;
    }

    // Verify session binding if token was bound to a session
    if (stored.sessionId && sessionId !== stored.sessionId) {
      console.warn('⚠️ CSRF verification failed: session binding mismatch');
      this.tokenStore.delete(token);
      return false;
    }

    // Verify user binding if token was bound to a user
    if (stored.userId && userId !== stored.userId) {
      console.warn('⚠️ CSRF verification failed: user binding mismatch');
      this.tokenStore.delete(token);
      return false;
    }

    // Verify secret with timing-safe comparison
    try {
      const providedSecret = Buffer.from(secret, 'hex');
      const storedSecret = Buffer.from(stored.secret, 'hex');

      if (providedSecret.length !== storedSecret.length) {
        console.warn('⚠️ CSRF verification failed: secret length mismatch');
        return false;
      }

      const isValid = timingSafeEqual(providedSecret, storedSecret);

      if (isValid) {
        const bindingInfo = [];
        if (stored.sessionId) bindingInfo.push(`session:${stored.sessionId.slice(0, 8)}...`);
        if (stored.userId) bindingInfo.push(`user:${stored.userId}`);
        const bindingStr = bindingInfo.length > 0 ? ` (${bindingInfo.join(', ')})` : '';

        console.log(`✅ CSRF token verified successfully${bindingStr}`);
        // Remove token after successful verification (single-use)
        this.tokenStore.delete(token);
      } else {
        console.warn('⚠️ CSRF verification failed: secret mismatch');
      }

      return isValid;
    } catch (error) {
      console.error('❌ CSRF verification error:', error);
      return false;
    }
  }

  /**
   * Clean up expired tokens
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [token, data] of this.tokenStore.entries()) {
      if (now > data.expiresAt) {
        this.tokenStore.delete(token);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} expired CSRF tokens, ${this.tokenStore.size} remaining`);
    }
  }

  /**
   * Get statistics about CSRF token usage
   */
  getStats(): {
    activeTokens: number;
    oldestToken: number;
    averageAge: number;
  } {
    const now = Date.now();
    const tokens = Array.from(this.tokenStore.values());

    if (tokens.length === 0) {
      return { activeTokens: 0, oldestToken: 0, averageAge: 0 };
    }

    const ages = tokens.map(t => now - t.createdAt);
    const oldestToken = Math.max(...ages);
    const averageAge = ages.reduce((sum, age) => sum + age, 0) / ages.length;

    return {
      activeTokens: tokens.length,
      oldestToken,
      averageAge
    };
  }

  /**
   * Cleanup resources on shutdown
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.tokenStore.clear();
    console.log('🔐 CSRF protection service destroyed');
  }
}

// Create singleton instance
const csrfService = new CSRFProtectionService();

/**
 * Express middleware to generate and provide CSRF tokens
 */
export function provideCSRFToken(req: Request, res: Response, next: NextFunction) {
  // Skip CSRF for GET requests that don't modify state
  if (req.method === 'GET') {
    return next();
  }

  // Generate new token for this request
  const { token, secret } = csrfService.generateToken();

  // Add token to response locals for templates
  res.locals.csrfToken = token;
  res.locals.csrfSecret = secret;

  next();
}

/**
 * Express middleware to verify CSRF tokens on state-changing requests
 * Uses Double Submit Cookie pattern for enhanced security
 */
export function verifyCSRFToken(req: Request, res: Response, next: NextFunction) {
  // Skip CSRF for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip CSRF for specific endpoints that handle their own protection
  const skipPaths = ['/auth/login', '/auth/mfa/initiate', '/auth/mfa/verify', '/ping'];
  if (skipPaths.some(path => req.path.endsWith(path))) {
    return next();
  }

  // Skip CSRF for admin bearer-authenticated requests (bearer tokens prevent CSRF)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Check both originalUrl and path since path might be relative to router mount point
    const fullPath = req.originalUrl || req.path;
    console.log('🔍 CSRF bearer check:', {
      hasAuth: true,
      fullPath,
      path: req.path,
      includesAdmin: fullPath.includes('/admin/'),
      pathStartsWithSystem: req.path.startsWith('/system/')
    });

    // Skip CSRF for admin bearer-authenticated endpoints
    // Bearer token authentication provides equivalent CSRF protection
    if (fullPath.includes('/admin/')) {
      console.log('🔓 Skipping CSRF for admin bearer-auth request:', fullPath);
      return next();
    }
  }

  // Get token from header or body (primary method)
  const headerToken = req.get('X-CSRF-Token') || req.body._csrf || req.query._csrf;
  const secret = req.get('X-CSRF-Secret') || req.body._csrfSecret || req.query._csrfSecret;

  // Get token from cookie (Double Submit Cookie pattern)
  const cookieToken = req.cookies?.['csrf-token'];

  // Check if we have the required tokens
  if (!headerToken || !secret) {
    console.warn('⚠️ CSRF protection: missing token or secret in request to', req.path);
    return res.status(403).json({
      error: 'CSRF token required',
      message: 'Request must include X-CSRF-Token header and X-CSRF-Secret header'
    });
  }

  // Extract session and user information for binding validation
  const sessionId = req.sessionID;
  const userId = req.session?.discordId;

  // Validate the primary token with secret and session/user binding
  const isTokenValid = csrfService.verifyToken(headerToken, secret, sessionId, userId);

  if (!isTokenValid) {
    console.warn('⚠️ CSRF protection: invalid token for request to', req.path, 'from IP', req.ip);
    return res.status(403).json({
      error: 'Invalid CSRF token',
      message: 'The CSRF token provided is invalid, expired, or not bound to this session'
    });
  }

  // Double Submit Cookie validation (belt-and-suspenders approach)
  if (cookieToken && cookieToken !== headerToken) {
    console.warn('⚠️ CSRF protection: Double Submit Cookie mismatch for request to', req.path, 'from IP', req.ip);
    return res.status(403).json({
      error: 'CSRF cookie mismatch',
      message: 'The CSRF token cookie does not match the header token'
    });
  }

  // Log successful validation with details
  const validationType = cookieToken ? 'token + cookie' : 'token only';
  console.log(`✅ CSRF protection: valid ${validationType} for`, req.method, req.path);
  next();
}

/**
 * Generate a new CSRF token pair (for API endpoints) with optional session/user binding
 */
export function generateCSRFToken(sessionId?: string, userId?: string): { token: string; secret: string } {
  return csrfService.generateToken(sessionId, userId);
}

/**
 * Get CSRF service statistics
 */
export function getCSRFStats() {
  return csrfService.getStats();
}

/**
 * Cleanup CSRF service resources
 */
export function cleanupCSRFService(): void {
  csrfService.destroy();
}

// Cleanup on process exit
process.on('exit', cleanupCSRFService);
process.on('SIGINT', cleanupCSRFService);
process.on('SIGTERM', cleanupCSRFService);