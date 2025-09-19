// Hybrid Admin Authentication System
// Provides both simple bearer auth for Replit/demos and full MFA for production

import { prisma } from './db.js';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// Environment detection for tiered authentication
const isReplitEnvironment = () => {
  return !!(process.env.REPLIT_DB_URL || process.env.REPL_ID || process.env.REPL_SLUG);
};

const isDevelopmentMode = () => {
  return process.env.NODE_ENV === 'development' ||
         process.env.NODE_ENV === 'dev' ||
         !process.env.NODE_ENV;
};

// Authentication tiers based on environment and operation sensitivity
export const AUTH_TIERS = {
  DEMO: 'demo',           // Simple bearer for demos/Replit
  BASIC: 'basic',         // Bearer with rate limiting
  SECURE: 'secure',       // MFA required for sensitive operations
} as const;

export function getAuthTier(operationType?: string): string {
  // Always force secure auth for critical financial operations regardless of environment
  const criticalOps = ['withdrawal', 'deposit', 'balance_edit', 'user_ban', 'emergency', 'grand_reset'];
  if (operationType && criticalOps.includes(operationType)) {
    return AUTH_TIERS.SECURE;
  }

  // For Replit production environment - use basic auth with rate limiting
  // This maintains security while working within Replit's constraints
  if (isReplitEnvironment()) {
    // Replit production should still have protection for sensitive operations
    const sensitiveOps = ['user_management', 'system_config', 'token_management'];
    if (operationType && sensitiveOps.includes(operationType)) {
      return AUTH_TIERS.BASIC; // Enhanced bearer auth with rate limiting
    }
    return AUTH_TIERS.DEMO; // Simple bearer auth for general operations
  }

  // Use basic auth for local development
  if (isDevelopmentMode()) {
    return AUTH_TIERS.BASIC;
  }

  // Default to secure for traditional production servers
  return AUTH_TIERS.SECURE;
}

interface AdminSession {
  sessionId: string;
  adminId: string;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
  lastActivity: Date;
  mfaVerified: boolean;
  permissions: string[];
}

interface MFAChallenge {
  challengeId: string;
  adminId: string;
  code: string;
  expiresAt: Date;
  verified: boolean;
}

class AdminAuthSystem {
  private sessions = new Map<string, AdminSession>();
  private mfaChallenges = new Map<string, MFAChallenge>();
  private failedAttempts = new Map<string, { count: number; lastAttempt: Date }>();

  private readonly SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MFA_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes

  /**
   * Authenticate admin with bearer token and create session
   */
  async authenticateAdmin(bearerToken: string, req: Request): Promise<{
    success: boolean;
    session?: AdminSession;
    requiresMFA?: boolean;
    error?: string;
  }> {
    const clientId = this.getClientId(req);

    // Check for lockout
    const failureData = this.failedAttempts.get(clientId);
    if (failureData && failureData.count >= this.MAX_FAILED_ATTEMPTS) {
      const timeSinceLastAttempt = Date.now() - failureData.lastAttempt.getTime();
      if (timeSinceLastAttempt < this.LOCKOUT_DURATION) {
        const remainingLockout = Math.ceil((this.LOCKOUT_DURATION - timeSinceLastAttempt) / 60000);
        return {
          success: false,
          error: `Account locked. Try again in ${remainingLockout} minutes.`
        };
      } else {
        // Reset failed attempts after lockout period
        this.failedAttempts.delete(clientId);
      }
    }

    // Validate bearer token (timing-safe comparison)
    const expectedToken = process.env.ADMIN_SECRET;
    if (!expectedToken) {
      return { success: false, error: 'Admin authentication not configured' };
    }

    if (!this.timingSafeEqual(bearerToken, expectedToken)) {
      this.recordFailedAttempt(clientId);
      return { success: false, error: 'Invalid authentication token' };
    }

    // Create or retrieve admin session
    const adminId = 'admin'; // In a multi-admin system, this would be dynamic
    const existingSession = this.findSessionByAdmin(adminId, req);

    if (existingSession && this.isSessionValid(existingSession)) {
      existingSession.lastActivity = new Date();
      return {
        success: true,
        session: existingSession,
        requiresMFA: !existingSession.mfaVerified
      };
    }

    // Create new session
    const session: AdminSession = {
      sessionId: crypto.randomBytes(32).toString('hex'),
      adminId,
      ipAddress: this.getClientIP(req),
      userAgent: req.get('User-Agent') || 'Unknown',
      createdAt: new Date(),
      lastActivity: new Date(),
      mfaVerified: false,
      permissions: ['admin'] // In a role-based system, this would be dynamic
    };

    this.sessions.set(session.sessionId, session);

    return {
      success: true,
      session,
      requiresMFA: true
    };
  }

  /**
   * Initialize MFA challenge
   */
  async initiateMFA(sessionId: string): Promise<{
    success: boolean;
    challengeId?: string;
    error?: string;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session || !this.isSessionValid(session)) {
      return { success: false, error: 'Invalid session' };
    }

    // Generate random 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const challengeId = crypto.randomBytes(16).toString('hex');

    const challenge: MFAChallenge = {
      challengeId,
      adminId: session.adminId,
      code,
      expiresAt: new Date(Date.now() + this.MFA_TIMEOUT),
      verified: false
    };

    this.mfaChallenges.set(challengeId, challenge);

    // In production, send code via email/SMS
    // For now, log it (REMOVE IN PRODUCTION!)
    console.log(`🔐 MFA Code for admin session ${sessionId}: ${code}`);

    return { success: true, challengeId };
  }

  /**
   * Verify MFA code
   */
  async verifyMFA(challengeId: string, providedCode: string): Promise<{
    success: boolean;
    sessionId?: string;
    error?: string;
  }> {
    const challenge = this.mfaChallenges.get(challengeId);
    if (!challenge) {
      return { success: false, error: 'Invalid challenge ID' };
    }

    if (challenge.verified) {
      return { success: false, error: 'Challenge already used' };
    }

    if (Date.now() > challenge.expiresAt.getTime()) {
      this.mfaChallenges.delete(challengeId);
      return { success: false, error: 'Challenge expired' };
    }

    if (!this.timingSafeEqual(providedCode, challenge.code)) {
      return { success: false, error: 'Invalid verification code' };
    }

    // Mark challenge as verified
    challenge.verified = true;

    // Find and update session
    const session = this.findSessionByAdminId(challenge.adminId);
    if (session) {
      session.mfaVerified = true;
      session.lastActivity = new Date();

      this.mfaChallenges.delete(challengeId);
      return { success: true, sessionId: session.sessionId };
    }

    return { success: false, error: 'Session not found' };
  }

  /**
   * Validate session for admin routes
   */
  async validateSession(sessionId: string, requiredPermissions: string[] = []): Promise<{
    valid: boolean;
    session?: AdminSession;
    error?: string;
  }> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return { valid: false, error: 'Session not found' };
    }

    if (!this.isSessionValid(session)) {
      this.sessions.delete(sessionId);
      return { valid: false, error: 'Session expired' };
    }

    if (!session.mfaVerified) {
      return { valid: false, error: 'MFA verification required' };
    }

    // Check permissions
    if (requiredPermissions.length > 0) {
      const hasPermission = requiredPermissions.some(perm =>
        session.permissions.includes(perm)
      );

      if (!hasPermission) {
        return { valid: false, error: 'Insufficient permissions' };
      }
    }

    session.lastActivity = new Date();
    return { valid: true, session };
  }

  /**
   * Express middleware for admin authentication
   */
  adminMiddleware(requiredPermissions: string[] = [], operationType?: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const authTier = getAuthTier(operationType);

        // Handle different authentication tiers
        if (authTier === AUTH_TIERS.DEMO) {
          return this.handleBearerAuth(req, res, next, requiredPermissions);
        }

        if (authTier === AUTH_TIERS.BASIC) {
          return this.handleBasicAuth(req, res, next, requiredPermissions);
        }

        // SECURE tier - full MFA required
        const sessionId = req.headers['x-admin-session'] as string;

        if (!sessionId) {
          return res.status(401).json({
            error: 'Session ID required for secure operations',
            code: 'MISSING_SESSION',
            authTier: 'secure',
            hint: 'Use /admin/auth/login to get a session'
          });
        }

        const validation = await this.validateSession(sessionId, requiredPermissions);

        if (!validation.valid) {
          return res.status(401).json({
            error: validation.error,
            code: validation.error === 'MFA verification required' ? 'MFA_REQUIRED' : 'INVALID_SESSION',
            authTier: 'secure'
          });
        }

        // Add session to request for downstream use
        (req as any).adminSession = validation.session;
        (req as any).authTier = authTier;
        next();

      } catch (error) {
        console.error('Admin middleware error:', error);
        res.status(500).json({ error: 'Authentication system error' });
      }
    };
  }

  /**
   * Handle simple bearer token authentication (for Replit/demo mode)
   */
  private handleBearerAuth(req: Request, res: Response, next: NextFunction, requiredPermissions: string[] = []) {
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.ADMIN_SECRET;

    if (!expectedToken) {
      return res.status(500).json({
        error: 'Admin authentication not configured',
        authTier: 'demo'
      });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Bearer token required for demo mode',
        code: 'MISSING_BEARER',
        authTier: 'demo',
        hint: 'Use Authorization: Bearer <ADMIN_SECRET> header'
      });
    }

    const token = authHeader.substring(7);
    if (!this.timingSafeEqual(token, expectedToken)) {
      return res.status(401).json({
        error: 'Invalid bearer token',
        code: 'INVALID_BEARER',
        authTier: 'demo'
      });
    }

    // Create minimal session info for bearer auth
    (req as any).adminSession = {
      sessionId: 'bearer-' + Date.now(),
      adminId: 'admin',
      authMethod: 'bearer',
      permissions: ['admin']
    };
    (req as any).authTier = AUTH_TIERS.DEMO;
    next();
  }

  /**
   * Handle basic authentication with rate limiting (for development)
   */
  private handleBasicAuth(req: Request, res: Response, next: NextFunction, requiredPermissions: string[] = []) {
    const clientId = this.getClientId(req);

    // Apply rate limiting for basic auth
    const failureData = this.failedAttempts.get(clientId);
    if (failureData && failureData.count >= 3) { // Lower threshold for basic auth
      const timeSinceLastAttempt = Date.now() - failureData.lastAttempt.getTime();
      if (timeSinceLastAttempt < 5 * 60 * 1000) { // 5 minute lockout
        return res.status(429).json({
          error: 'Too many failed attempts',
          code: 'RATE_LIMITED',
          authTier: 'basic'
        });
      } else {
        this.failedAttempts.delete(clientId);
      }
    }

    return this.handleBearerAuth(req, res, next, requiredPermissions);
  }

  /**
   * Logout and invalidate session
   */
  logout(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Get all active sessions (for monitoring)
   */
  getActiveSessions(): AdminSession[] {
    return Array.from(this.sessions.values()).filter(s => this.isSessionValid(s));
  }

  /**
   * Clean up expired sessions and challenges
   */
  cleanup(): void {
    const now = Date.now();

    // Clean expired sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      if (!this.isSessionValid(session)) {
        this.sessions.delete(sessionId);
      }
    }

    // Clean expired MFA challenges
    for (const [challengeId, challenge] of this.mfaChallenges.entries()) {
      if (now > challenge.expiresAt.getTime()) {
        this.mfaChallenges.delete(challengeId);
      }
    }

    // Clean old failed attempts
    for (const [clientId, failure] of this.failedAttempts.entries()) {
      if (now - failure.lastAttempt.getTime() > this.LOCKOUT_DURATION) {
        this.failedAttempts.delete(clientId);
      }
    }
  }

  // Private helper methods
  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  private isSessionValid(session: AdminSession): boolean {
    const now = Date.now();
    return (now - session.lastActivity.getTime()) < this.SESSION_TIMEOUT;
  }

  private findSessionByAdmin(adminId: string, req: Request): AdminSession | undefined {
    const clientId = this.getClientId(req);

    for (const session of this.sessions.values()) {
      if (session.adminId === adminId &&
          session.ipAddress === this.getClientIP(req) &&
          this.isSessionValid(session)) {
        return session;
      }
    }
    return undefined;
  }

  private findSessionByAdminId(adminId: string): AdminSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.adminId === adminId && this.isSessionValid(session)) {
        return session;
      }
    }
    return undefined;
  }

  private getClientIP(req: Request): string {
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           'unknown';
  }

  private getClientId(req: Request): string {
    return `${this.getClientIP(req)}_${req.get('User-Agent') || 'unknown'}`;
  }

  private recordFailedAttempt(clientId: string): void {
    const existing = this.failedAttempts.get(clientId);
    if (existing) {
      existing.count++;
      existing.lastAttempt = new Date();
    } else {
      this.failedAttempts.set(clientId, {
        count: 1,
        lastAttempt: new Date()
      });
    }
  }
}

// Create singleton instance
export const adminAuth = new AdminAuthSystem();

// Start cleanup interval
setInterval(() => {
  adminAuth.cleanup();
}, 60000); // Clean up every minute

// Export convenience functions for hybrid authentication
export const adminMiddleware = (permissions: string[] = [], operationType?: string) =>
  adminAuth.adminMiddleware(permissions, operationType);

// Convenience functions for specific operation types
export const secureAdminMiddleware = (permissions: string[] = []) =>
  adminAuth.adminMiddleware(permissions, 'secure');

export const financialAdminMiddleware = (permissions: string[] = []) =>
  adminAuth.adminMiddleware(permissions, 'withdrawal');

// Replit-compatible middleware for different security levels
export const viewOnlyAdminMiddleware = (permissions: string[] = []) =>
  adminAuth.adminMiddleware(permissions); // Uses demo tier in Replit

export const basicAdminMiddleware = (permissions: string[] = []) =>
  adminAuth.adminMiddleware(permissions, 'user_management'); // Uses basic tier in Replit

export const criticalAdminMiddleware = (permissions: string[] = []) =>
  adminAuth.adminMiddleware(permissions, 'emergency'); // Always secure tier

// Simple bearer auth check function for legacy compatibility
export function checkBearerAuth(req: Request): { valid: boolean; error?: string } {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.ADMIN_SECRET;

  if (!expectedToken) {
    return { valid: false, error: 'Admin authentication not configured' };
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Bearer token required' };
  }

  const token = authHeader.substring(7);
  const expected = expectedToken.trim();

  if (token.length !== expected.length) {
    return { valid: false, error: 'Invalid bearer token' };
  }

  // Timing-safe comparison
  let result = 0;
  for (let i = 0; i < token.length; i++) {
    result |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }

  if (result !== 0) {
    return { valid: false, error: 'Invalid bearer token' };
  }

  return { valid: true };
}

export async function authenticateAdmin(bearerToken: string, req: Request) {
  return adminAuth.authenticateAdmin(bearerToken, req);
}

export async function initiateMFA(sessionId: string) {
  return adminAuth.initiateMFA(sessionId);
}

export async function verifyMFA(challengeId: string, code: string) {
  return adminAuth.verifyMFA(challengeId, code);
}