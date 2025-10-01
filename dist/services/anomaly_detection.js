class AnomalyDetectionService {
  userProfiles = /* @__PURE__ */ new Map();
  anomalyAlerts = [];
  cleanupInterval;
  MAX_ALERTS = 5e3;
  // Keep last 5000 alerts
  // Configurable thresholds
  THRESHOLDS = {
    RAPID_LOCATION_CHANGES: 3,
    // Different countries within 1 hour
    UNUSUAL_LOGIN_DEVIATION: 4,
    // Hours deviation from typical login pattern
    COMMAND_SPIKE_MULTIPLIER: 5,
    // 5x normal command frequency
    LARGE_TRANSACTION_THRESHOLD: 1e3,
    // USD equivalent
    SESSION_DURATION_DEVIATION: 3,
    // Standard deviations from normal
    IP_CHANGE_FREQUENCY: 5,
    // Different IPs within 24 hours
    USER_AGENT_CHANGES: 3
    // Different user agents within 24 hours
  };
  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 6 * 60 * 60 * 1e3);
    console.log("\u{1F9E0} Anomaly detection service initialized");
  }
  /**
   * Analyze user behavior and detect anomalies
   */
  async analyzeUserBehavior(userId, req, activityType, metadata = {}) {
    const profile = this.getOrCreateProfile(userId);
    const currentTime = /* @__PURE__ */ new Date();
    this.updateProfile(profile, req, activityType, metadata, currentTime);
    const anomalies = [];
    let riskScore = 0;
    const timeAnomalies = this.detectTimeAnomalies(profile, currentTime);
    anomalies.push(...timeAnomalies.anomalies);
    riskScore += timeAnomalies.risk;
    const locationAnomalies = this.detectLocationAnomalies(profile, req);
    anomalies.push(...locationAnomalies.anomalies);
    riskScore += locationAnomalies.risk;
    const deviceAnomalies = this.detectDeviceAnomalies(profile, req);
    anomalies.push(...deviceAnomalies.anomalies);
    riskScore += deviceAnomalies.risk;
    const financialAnomalies = this.detectFinancialAnomalies(profile, metadata);
    anomalies.push(...financialAnomalies.anomalies);
    riskScore += financialAnomalies.risk;
    const commandAnomalies = this.detectCommandAnomalies(profile, activityType);
    anomalies.push(...commandAnomalies.anomalies);
    riskScore += commandAnomalies.risk;
    const recommendations = this.generateRecommendations(riskScore, anomalies);
    if (anomalies.length > 0) {
      await this.createAnomalyAlert(userId, anomalies, riskScore, metadata);
    }
    const analysis = {
      suspicious: riskScore > 30,
      riskScore: Math.min(riskScore, 100),
      anomalies,
      recommendations
    };
    profile.lastUpdated = currentTime;
    this.userProfiles.set(userId, profile);
    if (analysis.suspicious) {
      console.log(`\u{1F6A8} Behavioral anomaly detected for user ${userId.slice(0, 8)}...: Risk ${riskScore}/100`, {
        anomalies: anomalies.slice(0, 3),
        recommendations
      });
    }
    return analysis;
  }
  /**
   * Get or create user behavioral profile
   */
  getOrCreateProfile(userId) {
    let profile = this.userProfiles.get(userId);
    if (!profile) {
      profile = {
        userId,
        patterns: {
          loginTimes: [],
          sessionDurations: [],
          commandFrequency: {},
          ipAddresses: [],
          userAgents: [],
          geographicRegions: [],
          financialActivity: {
            avgTipAmount: 0,
            tipFrequency: 0,
            withdrawalPattern: [0, 0, 0, 0, 0, 0, 0],
            largeTransactionCount: 0
          }
        },
        riskFactors: {
          rapidLocationChanges: 0,
          unusualLoginTimes: 0,
          commandSpikes: 0,
          suspiciousFinancialActivity: 0,
          deviceInconsistencies: 0
        },
        lastUpdated: /* @__PURE__ */ new Date(),
        createdAt: /* @__PURE__ */ new Date()
      };
      this.userProfiles.set(userId, profile);
    }
    return profile;
  }
  /**
   * Update user behavioral profile with new data
   */
  updateProfile(profile, req, activityType, metadata, currentTime) {
    const currentHour = currentTime.getHours();
    const userAgent = req.get("User-Agent") || "Unknown";
    const ipAddress = this.getClientIP(req);
    profile.patterns.loginTimes.push(currentHour);
    if (profile.patterns.loginTimes.length > 50) {
      profile.patterns.loginTimes = profile.patterns.loginTimes.slice(-50);
    }
    profile.patterns.commandFrequency[activityType] = (profile.patterns.commandFrequency[activityType] || 0) + 1;
    if (!profile.patterns.ipAddresses.includes(ipAddress)) {
      profile.patterns.ipAddresses.push(ipAddress);
      if (profile.patterns.ipAddresses.length > 20) {
        profile.patterns.ipAddresses = profile.patterns.ipAddresses.slice(-20);
      }
    }
    if (!profile.patterns.userAgents.includes(userAgent)) {
      profile.patterns.userAgents.push(userAgent);
      if (profile.patterns.userAgents.length > 10) {
        profile.patterns.userAgents = profile.patterns.userAgents.slice(-10);
      }
    }
    if (metadata.tipAmount) {
      const currentAvg = profile.patterns.financialActivity.avgTipAmount;
      const newAvg = (currentAvg + metadata.tipAmount) / 2;
      profile.patterns.financialActivity.avgTipAmount = newAvg;
      if (metadata.tipAmount > this.THRESHOLDS.LARGE_TRANSACTION_THRESHOLD) {
        profile.patterns.financialActivity.largeTransactionCount++;
      }
    }
    if (metadata.withdrawalAmount && metadata.withdrawalAmount > this.THRESHOLDS.LARGE_TRANSACTION_THRESHOLD) {
      const dayOfWeek = currentTime.getDay();
      profile.patterns.financialActivity.withdrawalPattern[dayOfWeek]++;
    }
  }
  /**
   * Detect time-based behavioral anomalies
   */
  detectTimeAnomalies(profile, currentTime) {
    const anomalies = [];
    let risk = 0;
    const currentHour = currentTime.getHours();
    if (profile.patterns.loginTimes.length >= 10) {
      const avgLoginHour = profile.patterns.loginTimes.reduce((sum, hour) => sum + hour, 0) / profile.patterns.loginTimes.length;
      const deviation = Math.abs(currentHour - avgLoginHour);
      if (deviation > this.THRESHOLDS.UNUSUAL_LOGIN_DEVIATION) {
        anomalies.push(`Unusual login time: ${currentHour}:00 (typical: ${Math.round(avgLoginHour)}:00)`);
        risk += 15;
        profile.riskFactors.unusualLoginTimes++;
      }
    }
    return { anomalies, risk };
  }
  /**
   * Detect location-based anomalies
   */
  detectLocationAnomalies(profile, req) {
    const anomalies = [];
    let risk = 0;
    const currentIP = this.getClientIP(req);
    const recentIPs = profile.patterns.ipAddresses.slice(-this.THRESHOLDS.IP_CHANGE_FREQUENCY);
    const uniqueRecentIPs = [...new Set(recentIPs)];
    if (uniqueRecentIPs.length >= this.THRESHOLDS.IP_CHANGE_FREQUENCY) {
      anomalies.push(`Rapid location changes: ${uniqueRecentIPs.length} different IPs recently`);
      risk += 25;
      profile.riskFactors.rapidLocationChanges++;
    }
    const timezone = req.get("X-Client-Timezone");
    if (timezone && profile.patterns.geographicRegions.length > 0) {
      const lastRegion = profile.patterns.geographicRegions[profile.patterns.geographicRegions.length - 1];
      if (lastRegion && lastRegion !== timezone) {
        const timezonePattern = /GMT[+-]\d{1,2}/;
        if (timezonePattern.test(timezone) && timezonePattern.test(lastRegion)) {
          anomalies.push("Geographically suspicious location change detected");
          risk += 20;
        }
      }
    }
    if (timezone && !profile.patterns.geographicRegions.includes(timezone)) {
      profile.patterns.geographicRegions.push(timezone);
      if (profile.patterns.geographicRegions.length > 10) {
        profile.patterns.geographicRegions = profile.patterns.geographicRegions.slice(-10);
      }
    }
    return { anomalies, risk };
  }
  /**
   * Detect device/browser inconsistencies
   */
  detectDeviceAnomalies(profile, req) {
    const anomalies = [];
    let risk = 0;
    const userAgent = req.get("User-Agent") || "Unknown";
    const recentAgents = profile.patterns.userAgents.slice(-this.THRESHOLDS.USER_AGENT_CHANGES);
    if (recentAgents.length >= this.THRESHOLDS.USER_AGENT_CHANGES && !recentAgents.includes(userAgent)) {
      anomalies.push(`Multiple device signatures: ${recentAgents.length} different browsers/devices recently`);
      risk += 20;
      profile.riskFactors.deviceInconsistencies++;
    }
    return { anomalies, risk };
  }
  /**
   * Detect financial behavior anomalies
   */
  detectFinancialAnomalies(profile, metadata) {
    const anomalies = [];
    let risk = 0;
    if (metadata.tipAmount && profile.patterns.financialActivity.avgTipAmount > 0) {
      const deviationRatio = metadata.tipAmount / profile.patterns.financialActivity.avgTipAmount;
      if (deviationRatio > 10) {
        anomalies.push(`Unusually large tip: ${metadata.tipAmount} (typical: ${Math.round(profile.patterns.financialActivity.avgTipAmount)})`);
        risk += 15;
        profile.riskFactors.suspiciousFinancialActivity++;
      }
    }
    if (metadata.isFinancialTransaction) {
      const recentFinancialCommands = Object.entries(profile.patterns.commandFrequency).filter(([cmd]) => ["tip", "withdraw", "deposit"].some((fin) => cmd.includes(fin))).reduce((sum, [, count]) => sum + count, 0);
      if (recentFinancialCommands > 20) {
        anomalies.push(`High-frequency financial activity: ${recentFinancialCommands} recent transactions`);
        risk += 25;
        profile.riskFactors.suspiciousFinancialActivity++;
      }
    }
    return { anomalies, risk };
  }
  /**
   * Detect command frequency anomalies
   */
  detectCommandAnomalies(profile, activityType) {
    const anomalies = [];
    let risk = 0;
    const currentCount = profile.patterns.commandFrequency[activityType] || 0;
    const totalCommands = Object.values(profile.patterns.commandFrequency).reduce((sum, count) => sum + count, 0);
    if (totalCommands > 50) {
      const avgCommandFreq = totalCommands / Object.keys(profile.patterns.commandFrequency).length;
      if (currentCount > avgCommandFreq * this.THRESHOLDS.COMMAND_SPIKE_MULTIPLIER) {
        anomalies.push(`Command frequency spike: ${activityType} used ${currentCount} times (avg: ${Math.round(avgCommandFreq)})`);
        risk += 15;
        profile.riskFactors.commandSpikes++;
      }
    }
    return { anomalies, risk };
  }
  /**
   * Generate security recommendations based on risk analysis
   */
  generateRecommendations(riskScore, anomalies) {
    const recommendations = [];
    if (riskScore >= 70) {
      recommendations.push("TEMPORARY_SUSPEND");
    } else if (riskScore >= 50) {
      recommendations.push("RESTRICT_FINANCIAL");
      recommendations.push("MFA_REQUIRED");
    } else if (riskScore >= 30) {
      recommendations.push("MFA_REQUIRED");
      recommendations.push("MONITOR");
    } else if (riskScore >= 15) {
      recommendations.push("MONITOR");
    }
    const hasLocationAnomaly = anomalies.some((a) => a.includes("location") || a.includes("IP"));
    const hasFinancialAnomaly = anomalies.some((a) => a.includes("tip") || a.includes("transaction"));
    if (hasLocationAnomaly && !recommendations.includes("MFA_REQUIRED")) {
      recommendations.push("MFA_REQUIRED");
    }
    if (hasFinancialAnomaly && !recommendations.includes("RESTRICT_FINANCIAL")) {
      recommendations.push("RESTRICT_FINANCIAL");
    }
    return recommendations;
  }
  /**
   * Create an anomaly alert
   */
  async createAnomalyAlert(userId, anomalies, riskScore, metadata) {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let severity;
    let type;
    if (riskScore >= 70) severity = "CRITICAL";
    else if (riskScore >= 50) severity = "HIGH";
    else if (riskScore >= 30) severity = "MEDIUM";
    else severity = "LOW";
    if (anomalies.some((a) => a.includes("tip") || a.includes("transaction"))) {
      type = "FINANCIAL";
    } else if (anomalies.some((a) => a.includes("location") || a.includes("IP"))) {
      type = "LOCATION";
    } else if (anomalies.some((a) => a.includes("device") || a.includes("browser"))) {
      type = "DEVICE";
    } else if (anomalies.some((a) => a.includes("login"))) {
      type = "ACCESS";
    } else {
      type = "BEHAVIORAL";
    }
    const alert = {
      id: alertId,
      userId,
      type,
      severity,
      description: anomalies.join("; "),
      evidence: {
        riskScore,
        anomalies,
        metadata,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      timestamp: /* @__PURE__ */ new Date(),
      resolved: false,
      falsePositive: false
    };
    this.anomalyAlerts.push(alert);
    if (this.anomalyAlerts.length > this.MAX_ALERTS) {
      this.anomalyAlerts = this.anomalyAlerts.slice(-this.MAX_ALERTS);
    }
  }
  /**
   * Get anomaly statistics and recent alerts
   */
  getAnomalyStats() {
    const severityBreakdown = this.anomalyAlerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {});
    const typeBreakdown = this.anomalyAlerts.reduce((acc, alert) => {
      acc[alert.type] = (acc[alert.type] || 0) + 1;
      return acc;
    }, {});
    const recentAlerts = this.anomalyAlerts.filter((alert) => !alert.resolved).slice(-20).reverse();
    const userRisks = /* @__PURE__ */ new Map();
    this.anomalyAlerts.forEach((alert) => {
      const existing = userRisks.get(alert.userId) || { totalRisk: 0, alertCount: 0 };
      existing.totalRisk += alert.evidence.riskScore || 0;
      existing.alertCount += 1;
      userRisks.set(alert.userId, existing);
    });
    const topRiskyUsers = Array.from(userRisks.entries()).map(([userId, data]) => ({
      userId: userId.slice(0, 8) + "...",
      riskScore: Math.round(data.totalRisk / data.alertCount),
      alertCount: data.alertCount
    })).sort((a, b) => b.riskScore - a.riskScore).slice(0, 10);
    return {
      totalAlerts: this.anomalyAlerts.length,
      severityBreakdown,
      typeBreakdown,
      recentAlerts,
      topRiskyUsers
    };
  }
  /**
   * Mark an anomaly alert as resolved or false positive
   */
  resolveAlert(alertId, falsePositive = false) {
    const alert = this.anomalyAlerts.find((a) => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.falsePositive = falsePositive;
      return true;
    }
    return false;
  }
  /**
   * Get user behavioral profile
   */
  getUserProfile(userId) {
    return this.userProfiles.get(userId);
  }
  /**
   * Reset user behavioral profile (admin function)
   */
  resetUserProfile(userId) {
    if (this.userProfiles.has(userId)) {
      this.userProfiles.delete(userId);
      return true;
    }
    return false;
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
   * Clean up old profiles and resolved alerts
   */
  cleanup() {
    const now = Date.now();
    const OLD_PROFILE_THRESHOLD = 30 * 24 * 60 * 60 * 1e3;
    const OLD_ALERT_THRESHOLD = 7 * 24 * 60 * 60 * 1e3;
    let cleanedProfiles = 0;
    let cleanedAlerts = 0;
    for (const [userId, profile] of this.userProfiles.entries()) {
      if (now - profile.lastUpdated.getTime() > OLD_PROFILE_THRESHOLD) {
        this.userProfiles.delete(userId);
        cleanedProfiles++;
      }
    }
    const originalLength = this.anomalyAlerts.length;
    this.anomalyAlerts = this.anomalyAlerts.filter((alert) => {
      if (alert.resolved && now - alert.timestamp.getTime() > OLD_ALERT_THRESHOLD) {
        return false;
      }
      return true;
    });
    cleanedAlerts = originalLength - this.anomalyAlerts.length;
    if (cleanedProfiles > 0 || cleanedAlerts > 0) {
      console.log(`\u{1F9F9} Anomaly detection cleanup: ${cleanedProfiles} profiles, ${cleanedAlerts} alerts removed`);
    }
  }
  /**
   * Shutdown and cleanup
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.userProfiles.clear();
    this.anomalyAlerts = [];
    console.log("\u{1F9E0} Anomaly detection service destroyed");
  }
}
const anomalyDetection = new AnomalyDetectionService();
async function analyzeUserBehavior(userId, req, activityType, metadata = {}) {
  return anomalyDetection.analyzeUserBehavior(userId, req, activityType, metadata);
}
function getAnomalyStats() {
  return anomalyDetection.getAnomalyStats();
}
function resolveAnomalyAlert(alertId, falsePositive = false) {
  return anomalyDetection.resolveAlert(alertId, falsePositive);
}
function getUserBehaviorProfile(userId) {
  return anomalyDetection.getUserProfile(userId);
}
function resetUserBehaviorProfile(userId) {
  return anomalyDetection.resetUserProfile(userId);
}
process.on("exit", () => anomalyDetection.destroy());
process.on("SIGINT", () => anomalyDetection.destroy());
process.on("SIGTERM", () => anomalyDetection.destroy());
export {
  analyzeUserBehavior,
  anomalyDetection,
  getAnomalyStats,
  getUserBehaviorProfile,
  resetUserBehaviorProfile,
  resolveAnomalyAlert
};
//# sourceMappingURL=anomaly_detection.js.map
