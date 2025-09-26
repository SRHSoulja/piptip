// Anomaly Detection Service
// Detects suspicious user behavior patterns for enhanced security

import type { Request } from 'express';

interface UserBehaviorProfile {
  userId: string;
  patterns: {
    loginTimes: number[]; // Hours of day (0-23)
    sessionDurations: number[]; // Minutes
    commandFrequency: Record<string, number>;
    ipAddresses: string[];
    userAgents: string[];
    geographicRegions: string[];
    financialActivity: {
      avgTipAmount: number;
      tipFrequency: number; // Tips per hour
      withdrawalPattern: number[]; // Days of week (0-6)
      largeTransactionCount: number;
    };
  };
  riskFactors: {
    rapidLocationChanges: number;
    unusualLoginTimes: number;
    commandSpikes: number;
    suspiciousFinancialActivity: number;
    deviceInconsistencies: number;
  };
  lastUpdated: Date;
  createdAt: Date;
}

interface AnomalyAlert {
  id: string;
  userId: string;
  type: 'BEHAVIORAL' | 'FINANCIAL' | 'ACCESS' | 'DEVICE' | 'LOCATION';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  evidence: Record<string, any>;
  timestamp: Date;
  resolved: boolean;
  falsePositive: boolean;
}

interface BehaviorAnalysis {
  suspicious: boolean;
  riskScore: number; // 0-100
  anomalies: string[];
  recommendations: ('MONITOR' | 'MFA_REQUIRED' | 'RESTRICT_FINANCIAL' | 'TEMPORARY_SUSPEND')[];
}

class AnomalyDetectionService {
  private userProfiles = new Map<string, UserBehaviorProfile>();
  private anomalyAlerts: AnomalyAlert[] = [];
  private readonly cleanupInterval: NodeJS.Timeout;
  private readonly MAX_ALERTS = 5000; // Keep last 5000 alerts

  // Configurable thresholds
  private readonly THRESHOLDS = {
    RAPID_LOCATION_CHANGES: 3, // Different countries within 1 hour
    UNUSUAL_LOGIN_DEVIATION: 4, // Hours deviation from typical login pattern
    COMMAND_SPIKE_MULTIPLIER: 5, // 5x normal command frequency
    LARGE_TRANSACTION_THRESHOLD: 1000, // USD equivalent
    SESSION_DURATION_DEVIATION: 3, // Standard deviations from normal
    IP_CHANGE_FREQUENCY: 5, // Different IPs within 24 hours
    USER_AGENT_CHANGES: 3 // Different user agents within 24 hours
  };

  constructor() {
    // Cleanup old profiles and alerts every 6 hours
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 6 * 60 * 60 * 1000);

    console.log('🧠 Anomaly detection service initialized');
  }

  /**
   * Analyze user behavior and detect anomalies
   */
  async analyzeUserBehavior(userId: string, req: Request, activityType: string, metadata: Record<string, any> = {}): Promise<BehaviorAnalysis> {
    const profile = this.getOrCreateProfile(userId);
    const currentTime = new Date();

    // Update behavioral profile
    this.updateProfile(profile, req, activityType, metadata, currentTime);

    // Perform anomaly detection
    const anomalies: string[] = [];
    let riskScore = 0;

    // 1. Time-based anomalies
    const timeAnomalies = this.detectTimeAnomalies(profile, currentTime);
    anomalies.push(...timeAnomalies.anomalies);
    riskScore += timeAnomalies.risk;

    // 2. Location-based anomalies
    const locationAnomalies = this.detectLocationAnomalies(profile, req);
    anomalies.push(...locationAnomalies.anomalies);
    riskScore += locationAnomalies.risk;

    // 3. Device/Browser inconsistencies
    const deviceAnomalies = this.detectDeviceAnomalies(profile, req);
    anomalies.push(...deviceAnomalies.anomalies);
    riskScore += deviceAnomalies.risk;

    // 4. Financial behavior anomalies
    const financialAnomalies = this.detectFinancialAnomalies(profile, metadata);
    anomalies.push(...financialAnomalies.anomalies);
    riskScore += financialAnomalies.risk;

    // 5. Command frequency anomalies
    const commandAnomalies = this.detectCommandAnomalies(profile, activityType);
    anomalies.push(...commandAnomalies.anomalies);
    riskScore += commandAnomalies.risk;

    // Generate recommendations based on risk score
    const recommendations = this.generateRecommendations(riskScore, anomalies);

    // Create alert if anomalies detected
    if (anomalies.length > 0) {
      await this.createAnomalyAlert(userId, anomalies, riskScore, metadata);
    }

    const analysis: BehaviorAnalysis = {
      suspicious: riskScore > 30,
      riskScore: Math.min(riskScore, 100),
      anomalies,
      recommendations
    };

    // Update profile with latest analysis
    profile.lastUpdated = currentTime;
    this.userProfiles.set(userId, profile);

    if (analysis.suspicious) {
      console.log(`🚨 Behavioral anomaly detected for user ${userId.slice(0, 8)}...: Risk ${riskScore}/100`, {
        anomalies: anomalies.slice(0, 3),
        recommendations
      });
    }

    return analysis;
  }

  /**
   * Get or create user behavioral profile
   */
  private getOrCreateProfile(userId: string): UserBehaviorProfile {
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
        lastUpdated: new Date(),
        createdAt: new Date()
      };
      this.userProfiles.set(userId, profile);
    }

    return profile;
  }

  /**
   * Update user behavioral profile with new data
   */
  private updateProfile(profile: UserBehaviorProfile, req: Request, activityType: string, metadata: Record<string, any>, currentTime: Date): void {
    const currentHour = currentTime.getHours();
    const userAgent = req.get('User-Agent') || 'Unknown';
    const ipAddress = this.getClientIP(req);

    // Update login times (keep last 50)
    profile.patterns.loginTimes.push(currentHour);
    if (profile.patterns.loginTimes.length > 50) {
      profile.patterns.loginTimes = profile.patterns.loginTimes.slice(-50);
    }

    // Update command frequency
    profile.patterns.commandFrequency[activityType] = (profile.patterns.commandFrequency[activityType] || 0) + 1;

    // Update IP addresses (keep last 20)
    if (!profile.patterns.ipAddresses.includes(ipAddress)) {
      profile.patterns.ipAddresses.push(ipAddress);
      if (profile.patterns.ipAddresses.length > 20) {
        profile.patterns.ipAddresses = profile.patterns.ipAddresses.slice(-20);
      }
    }

    // Update user agents (keep last 10)
    if (!profile.patterns.userAgents.includes(userAgent)) {
      profile.patterns.userAgents.push(userAgent);
      if (profile.patterns.userAgents.length > 10) {
        profile.patterns.userAgents = profile.patterns.userAgents.slice(-10);
      }
    }

    // Update financial activity if applicable
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
  private detectTimeAnomalies(profile: UserBehaviorProfile, currentTime: Date): { anomalies: string[]; risk: number } {
    const anomalies: string[] = [];
    let risk = 0;
    const currentHour = currentTime.getHours();

    if (profile.patterns.loginTimes.length >= 10) {
      // Calculate typical login times
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
  private detectLocationAnomalies(profile: UserBehaviorProfile, req: Request): { anomalies: string[]; risk: number } {
    const anomalies: string[] = [];
    let risk = 0;
    const currentIP = this.getClientIP(req);

    // Check for rapid IP changes
    const recentIPs = profile.patterns.ipAddresses.slice(-this.THRESHOLDS.IP_CHANGE_FREQUENCY);
    const uniqueRecentIPs = [...new Set(recentIPs)];

    if (uniqueRecentIPs.length >= this.THRESHOLDS.IP_CHANGE_FREQUENCY) {
      anomalies.push(`Rapid location changes: ${uniqueRecentIPs.length} different IPs recently`);
      risk += 25;
      profile.riskFactors.rapidLocationChanges++;
    }

    // Check for geographically impossible changes (simplified)
    // This would typically use IP geolocation services
    const timezone = req.get('X-Client-Timezone');
    if (timezone && profile.patterns.geographicRegions.length > 0) {
      const lastRegion = profile.patterns.geographicRegions[profile.patterns.geographicRegions.length - 1];
      if (lastRegion && lastRegion !== timezone) {
        // Simplified check - in practice would use actual geolocation
        const timezonePattern = /GMT[+-]\d{1,2}/;
        if (timezonePattern.test(timezone) && timezonePattern.test(lastRegion)) {
          anomalies.push('Geographically suspicious location change detected');
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
  private detectDeviceAnomalies(profile: UserBehaviorProfile, req: Request): { anomalies: string[]; risk: number } {
    const anomalies: string[] = [];
    let risk = 0;
    const userAgent = req.get('User-Agent') || 'Unknown';

    // Check for rapid user agent changes
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
  private detectFinancialAnomalies(profile: UserBehaviorProfile, metadata: Record<string, any>): { anomalies: string[]; risk: number } {
    const anomalies: string[] = [];
    let risk = 0;

    // Check for unusual transaction amounts
    if (metadata.tipAmount && profile.patterns.financialActivity.avgTipAmount > 0) {
      const deviationRatio = metadata.tipAmount / profile.patterns.financialActivity.avgTipAmount;
      if (deviationRatio > 10) {
        anomalies.push(`Unusually large tip: ${metadata.tipAmount} (typical: ${Math.round(profile.patterns.financialActivity.avgTipAmount)})`);
        risk += 15;
        profile.riskFactors.suspiciousFinancialActivity++;
      }
    }

    // Check for rapid-fire financial transactions
    if (metadata.isFinancialTransaction) {
      const recentFinancialCommands = Object.entries(profile.patterns.commandFrequency)
        .filter(([cmd]) => ['tip', 'withdraw', 'deposit'].some(fin => cmd.includes(fin)))
        .reduce((sum, [, count]) => sum + count, 0);

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
  private detectCommandAnomalies(profile: UserBehaviorProfile, activityType: string): { anomalies: string[]; risk: number } {
    const anomalies: string[] = [];
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
  private generateRecommendations(riskScore: number, anomalies: string[]): ('MONITOR' | 'MFA_REQUIRED' | 'RESTRICT_FINANCIAL' | 'TEMPORARY_SUSPEND')[] {
    const recommendations: ('MONITOR' | 'MFA_REQUIRED' | 'RESTRICT_FINANCIAL' | 'TEMPORARY_SUSPEND')[] = [];

    if (riskScore >= 70) {
      recommendations.push('TEMPORARY_SUSPEND');
    } else if (riskScore >= 50) {
      recommendations.push('RESTRICT_FINANCIAL');
      recommendations.push('MFA_REQUIRED');
    } else if (riskScore >= 30) {
      recommendations.push('MFA_REQUIRED');
      recommendations.push('MONITOR');
    } else if (riskScore >= 15) {
      recommendations.push('MONITOR');
    }

    // Specific recommendations based on anomaly types
    const hasLocationAnomaly = anomalies.some(a => a.includes('location') || a.includes('IP'));
    const hasFinancialAnomaly = anomalies.some(a => a.includes('tip') || a.includes('transaction'));

    if (hasLocationAnomaly && !recommendations.includes('MFA_REQUIRED')) {
      recommendations.push('MFA_REQUIRED');
    }

    if (hasFinancialAnomaly && !recommendations.includes('RESTRICT_FINANCIAL')) {
      recommendations.push('RESTRICT_FINANCIAL');
    }

    return recommendations;
  }

  /**
   * Create an anomaly alert
   */
  private async createAnomalyAlert(userId: string, anomalies: string[], riskScore: number, metadata: Record<string, any>): Promise<void> {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    let type: 'BEHAVIORAL' | 'FINANCIAL' | 'ACCESS' | 'DEVICE' | 'LOCATION';

    if (riskScore >= 70) severity = 'CRITICAL';
    else if (riskScore >= 50) severity = 'HIGH';
    else if (riskScore >= 30) severity = 'MEDIUM';
    else severity = 'LOW';

    // Determine primary type based on anomalies
    if (anomalies.some(a => a.includes('tip') || a.includes('transaction'))) {
      type = 'FINANCIAL';
    } else if (anomalies.some(a => a.includes('location') || a.includes('IP'))) {
      type = 'LOCATION';
    } else if (anomalies.some(a => a.includes('device') || a.includes('browser'))) {
      type = 'DEVICE';
    } else if (anomalies.some(a => a.includes('login'))) {
      type = 'ACCESS';
    } else {
      type = 'BEHAVIORAL';
    }

    const alert: AnomalyAlert = {
      id: alertId,
      userId,
      type,
      severity,
      description: anomalies.join('; '),
      evidence: {
        riskScore,
        anomalies,
        metadata,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date(),
      resolved: false,
      falsePositive: false
    };

    this.anomalyAlerts.push(alert);

    // Keep only the most recent alerts
    if (this.anomalyAlerts.length > this.MAX_ALERTS) {
      this.anomalyAlerts = this.anomalyAlerts.slice(-this.MAX_ALERTS);
    }
  }

  /**
   * Get anomaly statistics and recent alerts
   */
  getAnomalyStats(): {
    totalAlerts: number;
    severityBreakdown: Record<string, number>;
    typeBreakdown: Record<string, number>;
    recentAlerts: AnomalyAlert[];
    topRiskyUsers: { userId: string; riskScore: number; alertCount: number }[];
  } {
    const severityBreakdown = this.anomalyAlerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const typeBreakdown = this.anomalyAlerts.reduce((acc, alert) => {
      acc[alert.type] = (acc[alert.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const recentAlerts = this.anomalyAlerts
      .filter(alert => !alert.resolved)
      .slice(-20)
      .reverse();

    // Calculate risky users
    const userRisks = new Map<string, { totalRisk: number; alertCount: number }>();

    this.anomalyAlerts.forEach(alert => {
      const existing = userRisks.get(alert.userId) || { totalRisk: 0, alertCount: 0 };
      existing.totalRisk += alert.evidence.riskScore || 0;
      existing.alertCount += 1;
      userRisks.set(alert.userId, existing);
    });

    const topRiskyUsers = Array.from(userRisks.entries())
      .map(([userId, data]) => ({
        userId: userId.slice(0, 8) + '...',
        riskScore: Math.round(data.totalRisk / data.alertCount),
        alertCount: data.alertCount
      }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);

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
  resolveAlert(alertId: string, falsePositive: boolean = false): boolean {
    const alert = this.anomalyAlerts.find(a => a.id === alertId);
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
  getUserProfile(userId: string): UserBehaviorProfile | undefined {
    return this.userProfiles.get(userId);
  }

  /**
   * Reset user behavioral profile (admin function)
   */
  resetUserProfile(userId: string): boolean {
    if (this.userProfiles.has(userId)) {
      this.userProfiles.delete(userId);
      return true;
    }
    return false;
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
   * Clean up old profiles and resolved alerts
   */
  private cleanup(): void {
    const now = Date.now();
    const OLD_PROFILE_THRESHOLD = 30 * 24 * 60 * 60 * 1000; // 30 days
    const OLD_ALERT_THRESHOLD = 7 * 24 * 60 * 60 * 1000; // 7 days for resolved alerts

    let cleanedProfiles = 0;
    let cleanedAlerts = 0;

    // Clean old user profiles
    for (const [userId, profile] of this.userProfiles.entries()) {
      if (now - profile.lastUpdated.getTime() > OLD_PROFILE_THRESHOLD) {
        this.userProfiles.delete(userId);
        cleanedProfiles++;
      }
    }

    // Clean old resolved alerts
    const originalLength = this.anomalyAlerts.length;
    this.anomalyAlerts = this.anomalyAlerts.filter(alert => {
      if (alert.resolved && now - alert.timestamp.getTime() > OLD_ALERT_THRESHOLD) {
        return false;
      }
      return true;
    });
    cleanedAlerts = originalLength - this.anomalyAlerts.length;

    if (cleanedProfiles > 0 || cleanedAlerts > 0) {
      console.log(`🧹 Anomaly detection cleanup: ${cleanedProfiles} profiles, ${cleanedAlerts} alerts removed`);
    }
  }

  /**
   * Shutdown and cleanup
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.userProfiles.clear();
    this.anomalyAlerts = [];
    console.log('🧠 Anomaly detection service destroyed');
  }
}

// Create singleton instance
export const anomalyDetection = new AnomalyDetectionService();

// Utility functions for easy integration
export async function analyzeUserBehavior(userId: string, req: Request, activityType: string, metadata: Record<string, any> = {}) {
  return anomalyDetection.analyzeUserBehavior(userId, req, activityType, metadata);
}

export function getAnomalyStats() {
  return anomalyDetection.getAnomalyStats();
}

export function resolveAnomalyAlert(alertId: string, falsePositive: boolean = false) {
  return anomalyDetection.resolveAlert(alertId, falsePositive);
}

export function getUserBehaviorProfile(userId: string) {
  return anomalyDetection.getUserProfile(userId);
}

export function resetUserBehaviorProfile(userId: string) {
  return anomalyDetection.resetUserProfile(userId);
}

// Cleanup on process exit
process.on('exit', () => anomalyDetection.destroy());
process.on('SIGINT', () => anomalyDetection.destroy());
process.on('SIGTERM', () => anomalyDetection.destroy());