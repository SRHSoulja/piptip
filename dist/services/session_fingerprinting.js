import crypto from "crypto";
class SessionFingerprintingService {
  fingerprints = /* @__PURE__ */ new Map();
  suspiciousActivities = [];
  cleanupInterval;
  MAX_ACTIVITIES = 1e3;
  // Keep last 1000 suspicious activities
  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1e3);
    console.log("\u{1F50D} Session fingerprinting service initialized");
  }
  /**
   * Generate fingerprint from request headers and client info
   */
  generateFingerprint(req) {
    const userAgent = req.get("User-Agent") || "Unknown";
    const acceptLanguage = req.get("Accept-Language") || "Unknown";
    const acceptEncoding = req.get("Accept-Encoding") || "Unknown";
    const ipAddress = this.getClientIP(req);
    const timeZone = req.get("X-Client-Timezone") || "Unknown";
    const screenResolution = req.get("X-Client-Screen") || void 0;
    const colorDepth = req.get("X-Client-Color-Depth") || void 0;
    const platform = req.get("X-Client-Platform") || void 0;
    const components = {
      userAgent,
      acceptLanguage,
      acceptEncoding,
      timeZone,
      screenResolution,
      colorDepth,
      platform
    };
    const fingerprintString = [
      userAgent,
      acceptLanguage,
      acceptEncoding,
      timeZone,
      screenResolution || "",
      colorDepth || "",
      platform || "",
      ipAddress
    ].join("|");
    const hash = crypto.createHash("sha256").update(fingerprintString).digest("hex");
    return {
      hash,
      components,
      ipAddress,
      createdAt: /* @__PURE__ */ new Date(),
      lastSeen: /* @__PURE__ */ new Date(),
      verified: false,
      suspiciousChanges: []
    };
  }
  /**
   * Validate session fingerprint and detect potential hijacking
   */
  async validateFingerprint(sessionId, req) {
    const currentFingerprint = this.generateFingerprint(req);
    const storedFingerprint = this.fingerprints.get(sessionId);
    if (!storedFingerprint) {
      this.fingerprints.set(sessionId, currentFingerprint);
      return {
        valid: true,
        riskLevel: "LOW",
        action: "ALLOW"
      };
    }
    storedFingerprint.lastSeen = /* @__PURE__ */ new Date();
    const changes = this.compareFingerprints(storedFingerprint, currentFingerprint);
    if (changes.length === 0) {
      return {
        valid: true,
        riskLevel: "LOW",
        action: "ALLOW"
      };
    }
    const riskAnalysis = this.analyzeRisk(changes, storedFingerprint, currentFingerprint);
    const suspicious = {
      sessionId,
      oldFingerprint: storedFingerprint,
      newFingerprint: currentFingerprint,
      riskLevel: riskAnalysis.riskLevel,
      changes,
      timestamp: /* @__PURE__ */ new Date(),
      action: riskAnalysis.action
    };
    this.suspiciousActivities.push(suspicious);
    if (this.suspiciousActivities.length > this.MAX_ACTIVITIES) {
      this.suspiciousActivities = this.suspiciousActivities.slice(-this.MAX_ACTIVITIES);
    }
    if (riskAnalysis.riskLevel !== "CRITICAL") {
      storedFingerprint.suspiciousChanges.push(...changes);
      if (storedFingerprint.suspiciousChanges.length > 10) {
        storedFingerprint.suspiciousChanges = storedFingerprint.suspiciousChanges.slice(-10);
      }
    }
    console.log(`\u{1F6A8} Session fingerprint analysis: ${riskAnalysis.riskLevel} risk for session ${sessionId.slice(0, 8)}...`, {
      changes: changes.slice(0, 3),
      // Log first 3 changes
      action: riskAnalysis.action
    });
    return {
      valid: riskAnalysis.action !== "BLOCK",
      riskLevel: riskAnalysis.riskLevel,
      action: riskAnalysis.action,
      changes,
      suspicious
    };
  }
  /**
   * Compare two fingerprints and return list of changes
   */
  compareFingerprints(stored, current) {
    const changes = [];
    if (stored.ipAddress !== current.ipAddress) {
      changes.push(`IP changed from ${stored.ipAddress} to ${current.ipAddress}`);
    }
    if (stored.components.userAgent !== current.components.userAgent) {
      changes.push("User-Agent changed");
    }
    if (stored.components.acceptLanguage !== current.components.acceptLanguage) {
      changes.push("Accept-Language changed");
    }
    if (stored.components.acceptEncoding !== current.components.acceptEncoding) {
      changes.push("Accept-Encoding changed");
    }
    if (stored.components.timeZone !== current.components.timeZone) {
      changes.push(`Timezone changed from ${stored.components.timeZone} to ${current.components.timeZone}`);
    }
    if (stored.components.screenResolution !== current.components.screenResolution) {
      changes.push("Screen resolution changed");
    }
    if (stored.components.platform !== current.components.platform) {
      changes.push("Platform changed");
    }
    return changes;
  }
  /**
   * Analyze risk level based on fingerprint changes
   */
  analyzeRisk(changes, stored, current) {
    let riskScore = 0;
    const criticalChanges = [];
    const highRiskChanges = [];
    for (const change of changes) {
      if (change.includes("IP changed")) {
        riskScore += 30;
        criticalChanges.push(change);
      } else if (change.includes("User-Agent changed")) {
        riskScore += 25;
        highRiskChanges.push(change);
      } else if (change.includes("Platform changed")) {
        riskScore += 20;
        highRiskChanges.push(change);
      } else if (change.includes("Timezone changed")) {
        riskScore += 10;
      } else if (change.includes("Screen resolution changed")) {
        riskScore += 5;
      } else {
        riskScore += 8;
      }
    }
    const recentSuspiciousChanges = stored.suspiciousChanges.filter(
      (change) => change.includes("IP changed") || change.includes("User-Agent changed")
    ).length;
    if (recentSuspiciousChanges >= 3) {
      riskScore += 20;
    }
    if (riskScore >= 50 || criticalChanges.length >= 2) {
      return { riskLevel: "CRITICAL", action: "BLOCK" };
    } else if (riskScore >= 30 || criticalChanges.length >= 1) {
      return { riskLevel: "HIGH", action: "VERIFY" };
    } else if (riskScore >= 15 || highRiskChanges.length >= 1) {
      return { riskLevel: "MEDIUM", action: "WARN" };
    } else {
      return { riskLevel: "LOW", action: "ALLOW" };
    }
  }
  /**
   * Express middleware for session fingerprint validation
   */
  fingerprintMiddleware() {
    return async (req, res, next) => {
      if (!req.sessionID || !req.session) {
        return next();
      }
      try {
        const validation = await this.validateFingerprint(req.sessionID, req);
        req.fingerprintValidation = validation;
        switch (validation.action) {
          case "ALLOW":
            break;
          case "WARN":
            console.warn(`\u26A0\uFE0F Session fingerprint warning for ${req.sessionID.slice(0, 8)}...`, {
              riskLevel: validation.riskLevel,
              changes: validation.changes?.slice(0, 2)
            });
            break;
          case "VERIFY":
            console.warn(`\u{1F50D} Session fingerprint verification required for ${req.sessionID.slice(0, 8)}...`);
            if (req.path.startsWith("/api/") || req.path.startsWith("/admin/api/")) {
              return res.status(403).json({
                error: "Session verification required",
                code: "FINGERPRINT_VERIFICATION_REQUIRED",
                message: "Your session security fingerprint has changed. Please re-authenticate.",
                riskLevel: validation.riskLevel
              });
            }
            break;
          case "BLOCK":
            console.error(`\u{1F6AB} Session fingerprint blocked for ${req.sessionID.slice(0, 8)}...`, {
              riskLevel: validation.riskLevel,
              changes: validation.changes?.slice(0, 3)
            });
            req.session.destroy((err) => {
              if (err) console.error("Session destruction error:", err);
            });
            return res.status(403).json({
              error: "Session security violation",
              code: "FINGERPRINT_SECURITY_VIOLATION",
              message: "Your session has been terminated due to suspicious activity.",
              riskLevel: validation.riskLevel
            });
        }
        next();
      } catch (error) {
        console.error("Fingerprint validation error:", error);
        next();
      }
    };
  }
  /**
   * Mark a session fingerprint as verified (after MFA, etc.)
   */
  markAsVerified(sessionId) {
    const fingerprint = this.fingerprints.get(sessionId);
    if (fingerprint) {
      fingerprint.verified = true;
      return true;
    }
    return false;
  }
  /**
   * Get suspicious activity statistics
   */
  getSuspiciousActivityStats() {
    const riskLevelBreakdown = this.suspiciousActivities.reduce((acc, activity) => {
      acc[activity.riskLevel] = (acc[activity.riskLevel] || 0) + 1;
      return acc;
    }, {});
    const recentActivities = this.suspiciousActivities.slice(-20).reverse();
    const sessionCounts = this.suspiciousActivities.reduce((acc, activity) => {
      const shortId = activity.sessionId.slice(0, 8);
      acc[shortId] = (acc[shortId] || 0) + 1;
      return acc;
    }, {});
    const topSessions = Object.entries(sessionCounts).sort(([, a], [, b]) => b - a).slice(0, 10).map(([sessionId, count]) => ({ sessionId, count }));
    return {
      totalActivities: this.suspiciousActivities.length,
      riskLevelBreakdown,
      recentActivities,
      topSessions
    };
  }
  /**
   * Get client IP address with proxy support
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
   * Clean up old fingerprints and activities
   */
  cleanup() {
    const now = Date.now();
    const OLD_THRESHOLD = 7 * 24 * 60 * 60 * 1e3;
    let cleanedFingerprints = 0;
    let cleanedActivities = 0;
    for (const [sessionId, fingerprint] of this.fingerprints.entries()) {
      if (now - fingerprint.lastSeen.getTime() > OLD_THRESHOLD) {
        this.fingerprints.delete(sessionId);
        cleanedFingerprints++;
      }
    }
    const oldActivities = this.suspiciousActivities.filter(
      (activity) => now - activity.timestamp.getTime() > OLD_THRESHOLD
    );
    cleanedActivities = oldActivities.length;
    this.suspiciousActivities = this.suspiciousActivities.filter(
      (activity) => now - activity.timestamp.getTime() <= OLD_THRESHOLD
    );
    if (cleanedFingerprints > 0 || cleanedActivities > 0) {
      console.log(`\u{1F9F9} Cleaned up ${cleanedFingerprints} old fingerprints and ${cleanedActivities} old activities`);
    }
  }
  /**
   * Shutdown and cleanup
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.fingerprints.clear();
    this.suspiciousActivities = [];
    console.log("\u{1F50D} Session fingerprinting service destroyed");
  }
}
const sessionFingerprinting = new SessionFingerprintingService();
const fingerprintMiddleware = () => sessionFingerprinting.fingerprintMiddleware();
function markSessionAsVerified(sessionId) {
  return sessionFingerprinting.markAsVerified(sessionId);
}
function getSuspiciousActivityStats() {
  return sessionFingerprinting.getSuspiciousActivityStats();
}
process.on("exit", () => sessionFingerprinting.destroy());
process.on("SIGINT", () => sessionFingerprinting.destroy());
process.on("SIGTERM", () => sessionFingerprinting.destroy());
export {
  fingerprintMiddleware,
  getSuspiciousActivityStats,
  markSessionAsVerified,
  sessionFingerprinting
};
//# sourceMappingURL=session_fingerprinting.js.map
