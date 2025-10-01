import jwt from "jsonwebtoken";
import crypto from "crypto";
import { getSecureCredential } from "./secure_key.js";
import { adminAuth } from "./admin_auth.js";
class JWTAuthService {
  refreshTokens = /* @__PURE__ */ new Map();
  ACCESS_TOKEN_EXPIRY = "15m";
  // 15 minutes
  REFRESH_TOKEN_EXPIRY = "7d";
  // 7 days
  JWT_SECRET;
  REFRESH_SECRET;
  cleanupInterval;
  constructor() {
    try {
      this.JWT_SECRET = getSecureCredential("JWT_SECRET");
      this.REFRESH_SECRET = getSecureCredential("JWT_REFRESH_SECRET");
    } catch {
      try {
        const adminSecret = getSecureCredential("ADMIN_SECRET");
        this.JWT_SECRET = crypto.createHmac("sha256", adminSecret).update("jwt-access").digest("hex");
        this.REFRESH_SECRET = crypto.createHmac("sha256", adminSecret).update("jwt-refresh").digest("hex");
      } catch {
        if (process.env.NODE_ENV === "development") {
          console.warn("\u26A0\uFE0F Using fallback JWT secrets in development mode");
          this.JWT_SECRET = "dev-jwt-secret-change-in-production";
          this.REFRESH_SECRET = "dev-jwt-refresh-secret-change-in-production";
        } else {
          throw new Error("JWT_SECRET and JWT_REFRESH_SECRET required for JWT authentication");
        }
      }
    }
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, 60 * 60 * 1e3);
    console.log("\u{1F511} JWT authentication service initialized");
  }
  /**
   * Generate JWT token pair for authenticated admin session
   */
  async generateTokenPair(sessionId, adminId, permissions, req) {
    const fingerprint = this.generateFingerprint(req);
    const accessPayload = {
      sessionId,
      adminId,
      permissions,
      type: "access"
    };
    const accessToken = jwt.sign(accessPayload, this.JWT_SECRET, {
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
      issuer: "piptip-admin",
      audience: "piptip-api"
    });
    const refreshPayload = {
      sessionId,
      adminId,
      permissions,
      type: "refresh"
    };
    const refreshToken = jwt.sign(refreshPayload, this.REFRESH_SECRET, {
      expiresIn: this.REFRESH_TOKEN_EXPIRY,
      issuer: "piptip-admin",
      audience: "piptip-api"
    });
    const refreshTokenData = {
      token: refreshToken,
      sessionId,
      adminId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3),
      // 7 days
      createdAt: /* @__PURE__ */ new Date(),
      lastUsed: /* @__PURE__ */ new Date(),
      revoked: false,
      fingerprint
    };
    this.refreshTokens.set(refreshToken, refreshTokenData);
    console.log(`\u{1F39F}\uFE0F Generated JWT token pair for admin session ${sessionId.slice(0, 8)}...`);
    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
      // 15 minutes in seconds
      tokenType: "Bearer"
    };
  }
  /**
   * Verify and decode JWT access token
   */
  async verifyAccessToken(token) {
    try {
      const payload = jwt.verify(token, this.JWT_SECRET, {
        issuer: "piptip-admin",
        audience: "piptip-api"
      });
      if (payload.type !== "access") {
        return { valid: false, error: "Invalid token type" };
      }
      const sessionValidation = await adminAuth.validateSession(payload.sessionId, payload.permissions);
      if (!sessionValidation.valid) {
        return { valid: false, error: "Session no longer valid" };
      }
      return { valid: true, payload };
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return { valid: false, error: "Access token expired" };
      } else if (error.name === "JsonWebTokenError") {
        return { valid: false, error: "Invalid access token" };
      } else {
        console.error("JWT verification error:", error);
        return { valid: false, error: "Token verification failed" };
      }
    }
  }
  /**
   * Refresh access token using valid refresh token
   */
  async refreshAccessToken(refreshToken, req) {
    const storedRefreshToken = this.refreshTokens.get(refreshToken);
    if (!storedRefreshToken) {
      return { success: false, error: "Refresh token not found" };
    }
    if (storedRefreshToken.revoked) {
      return { success: false, error: "Refresh token revoked" };
    }
    if (Date.now() > storedRefreshToken.expiresAt.getTime()) {
      this.refreshTokens.delete(refreshToken);
      return { success: false, error: "Refresh token expired" };
    }
    const currentFingerprint = this.generateFingerprint(req);
    if (storedRefreshToken.fingerprint !== currentFingerprint) {
      storedRefreshToken.revoked = true;
      console.warn("\u{1F6A8} JWT refresh token fingerprint mismatch - potential security threat");
      return { success: false, error: "Security validation failed" };
    }
    try {
      const payload = jwt.verify(refreshToken, this.REFRESH_SECRET, {
        issuer: "piptip-admin",
        audience: "piptip-api"
      });
      if (payload.type !== "refresh") {
        return { success: false, error: "Invalid token type" };
      }
      const sessionValidation = await adminAuth.validateSession(payload.sessionId, payload.permissions);
      if (!sessionValidation.valid) {
        this.refreshTokens.delete(refreshToken);
        return { success: false, error: "Session no longer valid" };
      }
      storedRefreshToken.lastUsed = /* @__PURE__ */ new Date();
      const newTokenPair = await this.generateTokenPair(
        payload.sessionId,
        payload.adminId,
        payload.permissions,
        req
      );
      this.refreshTokens.delete(refreshToken);
      console.log(`\u{1F504} Refreshed JWT tokens for admin session ${payload.sessionId.slice(0, 8)}...`);
      return { success: true, tokenPair: newTokenPair };
    } catch (error) {
      console.error("Refresh token verification error:", error);
      return { success: false, error: "Invalid refresh token" };
    }
  }
  /**
   * Express middleware for JWT authentication
   */
  jwtMiddleware(requiredPermissions = []) {
    return async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          error: "Bearer token required",
          code: "MISSING_TOKEN"
        });
      }
      const token = authHeader.substring(7);
      const verification = await this.verifyAccessToken(token);
      if (!verification.valid) {
        return res.status(401).json({
          error: verification.error,
          code: verification.error === "Access token expired" ? "TOKEN_EXPIRED" : "INVALID_TOKEN"
        });
      }
      if (requiredPermissions.length > 0) {
        const hasPermission = requiredPermissions.some(
          (perm) => verification.payload.permissions.includes(perm)
        );
        if (!hasPermission) {
          return res.status(403).json({
            error: "Insufficient permissions",
            code: "INSUFFICIENT_PERMISSIONS"
          });
        }
      }
      req.jwtPayload = verification.payload;
      req.adminId = verification.payload.adminId;
      req.sessionId = verification.payload.sessionId;
      next();
    };
  }
  /**
   * Revoke refresh token (logout)
   */
  revokeRefreshToken(refreshToken) {
    const storedToken = this.refreshTokens.get(refreshToken);
    if (storedToken) {
      storedToken.revoked = true;
      console.log(`\u{1F6AB} Revoked JWT refresh token for session ${storedToken.sessionId.slice(0, 8)}...`);
      return true;
    }
    return false;
  }
  /**
   * Revoke all refresh tokens for a session (admin logout)
   */
  revokeAllTokensForSession(sessionId) {
    let revokedCount = 0;
    for (const [token, tokenData] of this.refreshTokens.entries()) {
      if (tokenData.sessionId === sessionId && !tokenData.revoked) {
        tokenData.revoked = true;
        revokedCount++;
      }
    }
    console.log(`\u{1F6AB} Revoked ${revokedCount} JWT refresh tokens for session ${sessionId.slice(0, 8)}...`);
    return revokedCount;
  }
  /**
   * Get active refresh token statistics
   */
  getRefreshTokenStats() {
    const tokens = Array.from(this.refreshTokens.values());
    const activeTokens = tokens.filter((t) => !t.revoked && Date.now() <= t.expiresAt.getTime()).length;
    const revokedTokens = tokens.filter((t) => t.revoked).length;
    const oldestToken = tokens.length > 0 ? tokens.reduce((oldest, token) => token.createdAt < oldest.createdAt ? token : oldest).createdAt : null;
    return {
      activeTokens,
      revokedTokens,
      totalTokens: tokens.length,
      oldestToken
    };
  }
  /**
   * Clean up expired and revoked refresh tokens
   */
  cleanupExpiredTokens() {
    const now = Date.now();
    let cleaned = 0;
    for (const [token, data] of this.refreshTokens.entries()) {
      if (data.revoked || now > data.expiresAt.getTime()) {
        this.refreshTokens.delete(token);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`\u{1F9F9} Cleaned up ${cleaned} expired/revoked JWT refresh tokens, ${this.refreshTokens.size} remaining`);
    }
  }
  /**
   * Generate client fingerprint for additional security
   */
  generateFingerprint(req) {
    const components = [
      req.get("User-Agent") || "",
      req.get("Accept-Language") || "",
      req.ip || "",
      req.get("Accept-Encoding") || ""
    ];
    return crypto.createHash("sha256").update(components.join("|")).digest("hex").slice(0, 16);
  }
  /**
   * Shutdown and cleanup
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.refreshTokens.clear();
    console.log("\u{1F511} JWT authentication service destroyed");
  }
}
const jwtAuth = new JWTAuthService();
const jwtMiddleware = (permissions = []) => jwtAuth.jwtMiddleware(permissions);
const apiAuthMiddleware = jwtMiddleware(["admin"]);
const readOnlyApiMiddleware = jwtMiddleware([]);
const financialApiMiddleware = jwtMiddleware(["admin", "financial"]);
async function generateTokenPair(sessionId, adminId, permissions, req) {
  return jwtAuth.generateTokenPair(sessionId, adminId, permissions, req);
}
async function refreshAccessToken(refreshToken, req) {
  return jwtAuth.refreshAccessToken(refreshToken, req);
}
function revokeRefreshToken(refreshToken) {
  return jwtAuth.revokeRefreshToken(refreshToken);
}
function revokeAllTokensForSession(sessionId) {
  return jwtAuth.revokeAllTokensForSession(sessionId);
}
function getRefreshTokenStats() {
  return jwtAuth.getRefreshTokenStats();
}
process.on("exit", () => jwtAuth.destroy());
process.on("SIGINT", () => jwtAuth.destroy());
process.on("SIGTERM", () => jwtAuth.destroy());
export {
  apiAuthMiddleware,
  financialApiMiddleware,
  generateTokenPair,
  getRefreshTokenStats,
  jwtAuth,
  jwtMiddleware,
  readOnlyApiMiddleware,
  refreshAccessToken,
  revokeAllTokensForSession,
  revokeRefreshToken
};
//# sourceMappingURL=jwt_auth.js.map
