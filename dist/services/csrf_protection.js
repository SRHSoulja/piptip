import { randomBytes, timingSafeEqual, createHmac } from "crypto";
import { getSecureCredential } from "./secure_key.js";
class CSRFProtectionService {
  tokenStore = /* @__PURE__ */ new Map();
  tokenExpiry = 1e3 * 60 * 60;
  // 1 hour
  secretKey;
  cleanupInterval;
  constructor() {
    try {
      this.secretKey = getSecureCredential("CSRF_SECRET");
    } catch {
      try {
        this.secretKey = getSecureCredential("ADMIN_SECRET");
      } catch {
        this.secretKey = process.env.NODE_ENV === "development" ? "dev-csrf-secret-replace-in-production" : (() => {
          throw new Error("CSRF_SECRET or ADMIN_SECRET required for CSRF protection");
        })();
      }
    }
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, 15 * 60 * 1e3);
    console.log("\u{1F510} CSRF protection service initialized");
  }
  /**
   * Generate a new CSRF token and secret pair with session binding
   */
  generateToken(sessionId, userId) {
    const secret = randomBytes(32).toString("hex");
    const nonce = randomBytes(16).toString("hex");
    const timestamp = Date.now();
    const hmac = createHmac("sha256", this.secretKey);
    hmac.update(secret);
    hmac.update(timestamp.toString());
    hmac.update(nonce);
    if (sessionId) {
      hmac.update(sessionId);
    }
    if (userId) {
      hmac.update(userId);
    }
    const token = hmac.digest("hex");
    const csrfToken = {
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
    const bindingStr = bindingInfo.length > 0 ? ` (bound to ${bindingInfo.join(", ")})` : "";
    console.log(`\u{1F3AB} Generated new CSRF token${bindingStr}, total active:`, this.tokenStore.size);
    return { token, secret };
  }
  /**
   * Verify a CSRF token against its secret with session/user binding validation
   */
  verifyToken(token, secret, sessionId, userId) {
    if (!token || !secret) {
      console.warn("\u26A0\uFE0F CSRF verification failed: missing token or secret");
      return false;
    }
    const stored = this.tokenStore.get(token);
    if (!stored) {
      console.warn("\u26A0\uFE0F CSRF verification failed: token not found");
      return false;
    }
    if (Date.now() > stored.expiresAt) {
      console.warn("\u26A0\uFE0F CSRF verification failed: token expired");
      this.tokenStore.delete(token);
      return false;
    }
    if (stored.sessionId && sessionId !== stored.sessionId) {
      console.warn("\u26A0\uFE0F CSRF verification failed: session binding mismatch");
      this.tokenStore.delete(token);
      return false;
    }
    if (stored.userId && userId !== stored.userId) {
      console.warn("\u26A0\uFE0F CSRF verification failed: user binding mismatch");
      this.tokenStore.delete(token);
      return false;
    }
    try {
      const providedSecret = Buffer.from(secret, "hex");
      const storedSecret = Buffer.from(stored.secret, "hex");
      if (providedSecret.length !== storedSecret.length) {
        console.warn("\u26A0\uFE0F CSRF verification failed: secret length mismatch");
        return false;
      }
      const isValid = timingSafeEqual(providedSecret, storedSecret);
      if (isValid) {
        const bindingInfo = [];
        if (stored.sessionId) bindingInfo.push(`session:${stored.sessionId.slice(0, 8)}...`);
        if (stored.userId) bindingInfo.push(`user:${stored.userId}`);
        const bindingStr = bindingInfo.length > 0 ? ` (${bindingInfo.join(", ")})` : "";
        console.log(`\u2705 CSRF token verified successfully${bindingStr}`);
        this.tokenStore.delete(token);
      } else {
        console.warn("\u26A0\uFE0F CSRF verification failed: secret mismatch");
      }
      return isValid;
    } catch (error) {
      console.error("\u274C CSRF verification error:", error);
      return false;
    }
  }
  /**
   * Clean up expired tokens
   */
  cleanupExpiredTokens() {
    const now = Date.now();
    let cleaned = 0;
    for (const [token, data] of this.tokenStore.entries()) {
      if (now > data.expiresAt) {
        this.tokenStore.delete(token);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`\u{1F9F9} Cleaned up ${cleaned} expired CSRF tokens, ${this.tokenStore.size} remaining`);
    }
  }
  /**
   * Get statistics about CSRF token usage
   */
  getStats() {
    const now = Date.now();
    const tokens = Array.from(this.tokenStore.values());
    if (tokens.length === 0) {
      return { activeTokens: 0, oldestToken: 0, averageAge: 0 };
    }
    const ages = tokens.map((t) => now - t.createdAt);
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
  destroy() {
    clearInterval(this.cleanupInterval);
    this.tokenStore.clear();
    console.log("\u{1F510} CSRF protection service destroyed");
  }
}
const csrfService = new CSRFProtectionService();
function provideCSRFToken(req, res, next) {
  if (req.method === "GET") {
    return next();
  }
  const { token, secret } = csrfService.generateToken();
  res.locals.csrfToken = token;
  res.locals.csrfSecret = secret;
  next();
}
function verifyCSRFToken(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }
  const skipPaths = ["/auth/login", "/auth/mfa/initiate", "/auth/mfa/verify", "/ping"];
  if (skipPaths.some((path) => req.path.endsWith(path))) {
    return next();
  }
  const headerToken = req.get("X-CSRF-Token") || req.body._csrf || req.query._csrf;
  const secret = req.get("X-CSRF-Secret") || req.body._csrfSecret || req.query._csrfSecret;
  const cookieToken = req.cookies?.["csrf-token"];
  if (!headerToken || !secret) {
    console.warn("\u26A0\uFE0F CSRF protection: missing token or secret in request to", req.path);
    return res.status(403).json({
      error: "CSRF token required",
      message: "Request must include X-CSRF-Token header and X-CSRF-Secret header"
    });
  }
  const sessionId = req.sessionID;
  const userId = req.session?.discordId;
  const isTokenValid = csrfService.verifyToken(headerToken, secret, sessionId, userId);
  if (!isTokenValid) {
    console.warn("\u26A0\uFE0F CSRF protection: invalid token for request to", req.path, "from IP", req.ip);
    return res.status(403).json({
      error: "Invalid CSRF token",
      message: "The CSRF token provided is invalid, expired, or not bound to this session"
    });
  }
  if (cookieToken && cookieToken !== headerToken) {
    console.warn("\u26A0\uFE0F CSRF protection: Double Submit Cookie mismatch for request to", req.path, "from IP", req.ip);
    return res.status(403).json({
      error: "CSRF cookie mismatch",
      message: "The CSRF token cookie does not match the header token"
    });
  }
  const validationType = cookieToken ? "token + cookie" : "token only";
  console.log(`\u2705 CSRF protection: valid ${validationType} for`, req.method, req.path);
  next();
}
function generateCSRFToken(sessionId, userId) {
  return csrfService.generateToken(sessionId, userId);
}
function getCSRFStats() {
  return csrfService.getStats();
}
function cleanupCSRFService() {
  csrfService.destroy();
}
process.on("exit", cleanupCSRFService);
process.on("SIGINT", cleanupCSRFService);
process.on("SIGTERM", cleanupCSRFService);
export {
  cleanupCSRFService,
  generateCSRFToken,
  getCSRFStats,
  provideCSRFToken,
  verifyCSRFToken
};
//# sourceMappingURL=csrf_protection.js.map
