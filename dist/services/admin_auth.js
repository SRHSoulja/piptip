import crypto from "crypto";
import { getSecureAdminSecret } from "./secure_key.js";
const isReplitEnvironment = () => {
  return !!(process.env.REPLIT_DB_URL || process.env.REPL_ID || process.env.REPL_SLUG);
};
const isDevelopmentMode = () => {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "dev" || !process.env.NODE_ENV;
};
const AUTH_TIERS = {
  DEMO: "demo",
  // Simple bearer for demos/Replit
  BASIC: "basic",
  // Bearer with rate limiting
  SECURE: "secure"
  // MFA required for sensitive operations
};
function getAuthTier(operationType) {
  const criticalOps = ["withdrawal", "deposit", "balance_edit", "user_ban", "emergency", "grand_reset", "treasury_management", "config_update", "user_balance_modification"];
  if (operationType && criticalOps.includes(operationType)) {
    return AUTH_TIERS.SECURE;
  }
  if (isReplitEnvironment()) {
    const sensitiveOps = ["user_management", "system_config", "token_management"];
    if (operationType && sensitiveOps.includes(operationType)) {
      return AUTH_TIERS.BASIC;
    }
    return AUTH_TIERS.DEMO;
  }
  if (isDevelopmentMode()) {
    return AUTH_TIERS.BASIC;
  }
  return AUTH_TIERS.SECURE;
}
class AdminAuthSystem {
  sessions = /* @__PURE__ */ new Map();
  mfaChallenges = /* @__PURE__ */ new Map();
  failedAttempts = /* @__PURE__ */ new Map();
  SESSION_TIMEOUT = 24 * 60 * 60 * 1e3;
  // 24 hours
  MFA_TIMEOUT = 5 * 60 * 1e3;
  // 5 minutes
  MAX_FAILED_ATTEMPTS = 5;
  LOCKOUT_DURATION = 30 * 60 * 1e3;
  // 30 minutes
  /**
   * Authenticate admin with bearer token and create session
   */
  async authenticateAdmin(bearerToken, req) {
    const clientId = this.getClientId(req);
    const failureData = this.failedAttempts.get(clientId);
    if (failureData && failureData.count >= this.MAX_FAILED_ATTEMPTS) {
      const timeSinceLastAttempt = Date.now() - failureData.lastAttempt.getTime();
      if (timeSinceLastAttempt < this.LOCKOUT_DURATION) {
        const remainingLockout = Math.ceil((this.LOCKOUT_DURATION - timeSinceLastAttempt) / 6e4);
        return {
          success: false,
          error: `Account locked. Try again in ${remainingLockout} minutes.`
        };
      } else {
        this.failedAttempts.delete(clientId);
      }
    }
    let expectedToken;
    try {
      expectedToken = getSecureAdminSecret();
    } catch (error) {
      return { success: false, error: "Admin authentication not configured" };
    }
    if (!this.timingSafeEqual(bearerToken, expectedToken)) {
      this.recordFailedAttempt(clientId);
      return { success: false, error: "Invalid authentication token" };
    }
    const adminId = "admin";
    const existingSession = this.findSessionByAdmin(adminId, req);
    if (existingSession && this.isSessionValid(existingSession)) {
      existingSession.lastActivity = /* @__PURE__ */ new Date();
      return {
        success: true,
        session: existingSession,
        requiresMFA: !existingSession.mfaVerified
      };
    }
    const session = {
      sessionId: crypto.randomBytes(32).toString("hex"),
      adminId,
      ipAddress: this.getClientIP(req),
      userAgent: req.get("User-Agent") || "Unknown",
      createdAt: /* @__PURE__ */ new Date(),
      lastActivity: /* @__PURE__ */ new Date(),
      mfaVerified: false,
      permissions: ["admin"]
      // In a role-based system, this would be dynamic
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
  async initiateMFA(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !this.isSessionValid(session)) {
      return { success: false, error: "Invalid session" };
    }
    const randomBytes = crypto.randomBytes(4);
    const code = (1e5 + randomBytes.readUInt32BE(0) % 9e5).toString();
    const challengeId = crypto.randomBytes(16).toString("hex");
    const challenge = {
      challengeId,
      adminId: session.adminId,
      code,
      expiresAt: new Date(Date.now() + this.MFA_TIMEOUT),
      verified: false
    };
    this.mfaChallenges.set(challengeId, challenge);
    if (process.env.NODE_ENV === "development") {
      console.log(`\u{1F510} MFA Code for admin session ${sessionId}: ${code}`);
    }
    return { success: true, challengeId };
  }
  /**
   * Verify MFA code
   */
  async verifyMFA(challengeId, providedCode) {
    const challenge = this.mfaChallenges.get(challengeId);
    if (!challenge) {
      return { success: false, error: "Invalid challenge ID" };
    }
    if (challenge.verified) {
      return { success: false, error: "Challenge already used" };
    }
    if (Date.now() > challenge.expiresAt.getTime()) {
      this.mfaChallenges.delete(challengeId);
      return { success: false, error: "Challenge expired" };
    }
    if (!this.timingSafeEqual(providedCode, challenge.code)) {
      return { success: false, error: "Invalid verification code" };
    }
    challenge.verified = true;
    const session = this.findSessionByAdminId(challenge.adminId);
    if (session) {
      session.mfaVerified = true;
      session.lastActivity = /* @__PURE__ */ new Date();
      this.mfaChallenges.delete(challengeId);
      return { success: true, sessionId: session.sessionId };
    }
    return { success: false, error: "Session not found" };
  }
  /**
   * Validate session for admin routes
   */
  async validateSession(sessionId, requiredPermissions = []) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { valid: false, error: "Session not found" };
    }
    if (!this.isSessionValid(session)) {
      this.sessions.delete(sessionId);
      return { valid: false, error: "Session expired" };
    }
    if (!session.mfaVerified) {
      return { valid: false, error: "MFA verification required" };
    }
    if (requiredPermissions.length > 0) {
      const hasPermission = requiredPermissions.some(
        (perm) => session.permissions.includes(perm)
      );
      if (!hasPermission) {
        return { valid: false, error: "Insufficient permissions" };
      }
    }
    session.lastActivity = /* @__PURE__ */ new Date();
    return { valid: true, session };
  }
  /**
   * Express middleware for admin authentication
   */
  adminMiddleware(requiredPermissions = [], operationType) {
    return async (req, res, next) => {
      try {
        const authTier = getAuthTier(operationType);
        if (authTier === AUTH_TIERS.DEMO) {
          return this.handleBearerAuth(req, res, next, requiredPermissions);
        }
        if (authTier === AUTH_TIERS.BASIC) {
          return this.handleBasicAuth(req, res, next, requiredPermissions);
        }
        const sessionId = req.headers["x-admin-session"];
        if (!sessionId) {
          return res.status(401).json({
            error: "Session ID required for secure operations",
            code: "MISSING_SESSION",
            authTier: "secure",
            hint: "Use /admin/auth/login to get a session"
          });
        }
        const validation = await this.validateSession(sessionId, requiredPermissions);
        if (!validation.valid) {
          return res.status(401).json({
            error: validation.error,
            code: validation.error === "MFA verification required" ? "MFA_REQUIRED" : "INVALID_SESSION",
            authTier: "secure"
          });
        }
        req.adminSession = validation.session;
        req.authTier = authTier;
        next();
      } catch (error) {
        console.error("Admin middleware error:", error);
        res.status(500).json({ error: "Authentication system error" });
      }
    };
  }
  /**
   * Handle simple bearer token authentication (for Replit/demo mode)
   */
  handleBearerAuth(req, res, next, requiredPermissions = []) {
    const authHeader = req.headers.authorization;
    let expectedToken;
    try {
      expectedToken = getSecureAdminSecret();
    } catch (error) {
      return res.status(500).json({
        error: "Admin authentication not configured",
        authTier: "demo"
      });
    }
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Bearer token required for demo mode",
        code: "MISSING_BEARER",
        authTier: "demo",
        hint: "Use Authorization: Bearer <ADMIN_SECRET> header"
      });
    }
    const token = authHeader.substring(7);
    if (!this.timingSafeEqual(token, expectedToken)) {
      return res.status(401).json({
        error: "Invalid bearer token",
        code: "INVALID_BEARER",
        authTier: "demo"
      });
    }
    req.adminSession = {
      sessionId: "bearer-" + Date.now(),
      adminId: "admin",
      authMethod: "bearer",
      permissions: ["admin"]
    };
    req.authTier = AUTH_TIERS.DEMO;
    next();
  }
  /**
   * Handle basic authentication with rate limiting (for development)
   */
  handleBasicAuth(req, res, next, requiredPermissions = []) {
    const clientId = this.getClientId(req);
    const failureData = this.failedAttempts.get(clientId);
    if (failureData && failureData.count >= 3) {
      const timeSinceLastAttempt = Date.now() - failureData.lastAttempt.getTime();
      if (timeSinceLastAttempt < 5 * 60 * 1e3) {
        return res.status(429).json({
          error: "Too many failed attempts",
          code: "RATE_LIMITED",
          authTier: "basic"
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
  logout(sessionId) {
    return this.sessions.delete(sessionId);
  }
  /**
   * Get all active sessions (for monitoring)
   */
  getActiveSessions() {
    return Array.from(this.sessions.values()).filter((s) => this.isSessionValid(s));
  }
  /**
   * Clean up expired sessions and challenges
   */
  cleanup() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (!this.isSessionValid(session)) {
        this.sessions.delete(sessionId);
      }
    }
    for (const [challengeId, challenge] of this.mfaChallenges.entries()) {
      if (now > challenge.expiresAt.getTime()) {
        this.mfaChallenges.delete(challengeId);
      }
    }
    for (const [clientId, failure] of this.failedAttempts.entries()) {
      if (now - failure.lastAttempt.getTime() > this.LOCKOUT_DURATION) {
        this.failedAttempts.delete(clientId);
      }
    }
  }
  // Private helper methods
  timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
  isSessionValid(session) {
    const now = Date.now();
    return now - session.lastActivity.getTime() < this.SESSION_TIMEOUT;
  }
  findSessionByAdmin(adminId, req) {
    const clientId = this.getClientId(req);
    for (const session of this.sessions.values()) {
      if (session.adminId === adminId && session.ipAddress === this.getClientIP(req) && this.isSessionValid(session)) {
        return session;
      }
    }
    return void 0;
  }
  findSessionByAdminId(adminId) {
    for (const session of this.sessions.values()) {
      if (session.adminId === adminId && this.isSessionValid(session)) {
        return session;
      }
    }
    return void 0;
  }
  getClientIP(req) {
    return req.headers["x-forwarded-for"]?.split(",")[0] || req.connection.remoteAddress || req.socket.remoteAddress || "unknown";
  }
  getClientId(req) {
    return `${this.getClientIP(req)}_${req.get("User-Agent") || "unknown"}`;
  }
  recordFailedAttempt(clientId) {
    const existing = this.failedAttempts.get(clientId);
    if (existing) {
      existing.count++;
      existing.lastAttempt = /* @__PURE__ */ new Date();
    } else {
      this.failedAttempts.set(clientId, {
        count: 1,
        lastAttempt: /* @__PURE__ */ new Date()
      });
    }
  }
}
const adminAuth = new AdminAuthSystem();
setInterval(() => {
  adminAuth.cleanup();
}, 6e4);
const adminMiddleware = (permissions = [], operationType) => adminAuth.adminMiddleware(permissions, operationType);
const secureAdminMiddleware = (permissions = []) => adminAuth.adminMiddleware(permissions, "secure");
const financialAdminMiddleware = (permissions = []) => adminAuth.adminMiddleware(permissions, "withdrawal");
const viewOnlyAdminMiddleware = (permissions = []) => adminAuth.adminMiddleware(permissions);
const basicAdminMiddleware = (permissions = []) => adminAuth.adminMiddleware(permissions, "user_management");
const criticalAdminMiddleware = (permissions = []) => adminAuth.adminMiddleware(permissions, "emergency");
function checkBearerAuth(req) {
  const authHeader = req.headers.authorization;
  let expectedToken;
  try {
    expectedToken = getSecureAdminSecret();
  } catch (error) {
    return { valid: false, error: "Admin authentication not configured" };
  }
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Bearer token required" };
  }
  const token = authHeader.substring(7);
  const expected = expectedToken.trim();
  if (token.length !== expected.length) {
    return { valid: false, error: "Invalid bearer token" };
  }
  let result = 0;
  for (let i = 0; i < token.length; i++) {
    result |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (result !== 0) {
    return { valid: false, error: "Invalid bearer token" };
  }
  return { valid: true };
}
async function authenticateAdmin(bearerToken, req) {
  return adminAuth.authenticateAdmin(bearerToken, req);
}
async function initiateMFA(sessionId) {
  return adminAuth.initiateMFA(sessionId);
}
async function verifyMFA(challengeId, code) {
  return adminAuth.verifyMFA(challengeId, code);
}
export {
  AUTH_TIERS,
  adminAuth,
  adminMiddleware,
  authenticateAdmin,
  basicAdminMiddleware,
  checkBearerAuth,
  criticalAdminMiddleware,
  financialAdminMiddleware,
  getAuthTier,
  initiateMFA,
  secureAdminMiddleware,
  verifyMFA,
  viewOnlyAdminMiddleware
};
//# sourceMappingURL=admin_auth.js.map
