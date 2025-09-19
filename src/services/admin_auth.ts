// Multi-Factor Admin Authentication System
// Enhances admin security beyond simple bearer tokens

import { prisma } from './db.js';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

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
  adminMiddleware(requiredPermissions: string[] = []) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sessionId = req.headers['x-admin-session'] as string;

        if (!sessionId) {
          return res.status(401).json({
            error: 'Session ID required',
            code: 'MISSING_SESSION'
          });
        }

        const validation = await this.validateSession(sessionId, requiredPermissions);

        if (!validation.valid) {
          return res.status(401).json({
            error: validation.error,
            code: validation.error === 'MFA verification required' ? 'MFA_REQUIRED' : 'INVALID_SESSION'
          });
        }

        // Add session to request for downstream use
        (req as any).adminSession = validation.session;
        next();

      } catch (error) {
        console.error('Admin middleware error:', error);
        res.status(500).json({ error: 'Authentication system error' });
      }
    };
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

// Export convenience functions
export const adminMiddleware = (permissions: string[] = []) =>
  adminAuth.adminMiddleware(permissions);

export async function authenticateAdmin(bearerToken: string, req: Request) {
  return adminAuth.authenticateAdmin(bearerToken, req);
}

export async function initiateMFA(sessionId: string) {
  return adminAuth.initiateMFA(sessionId);
}

export async function verifyMFA(challengeId: string, code: string) {
  return adminAuth.verifyMFA(challengeId, code);
}