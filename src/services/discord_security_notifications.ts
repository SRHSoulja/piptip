// Discord-Focused Security Notifications for PIPTip
import type { Request } from 'express';
import { createSecurityIncident } from './incident_notification';

interface DiscordSecurityEvent {
  userId: string;
  discordId: string;
  type: 'oauth_login' | 'admin_access' | 'api_key_usage' | 'suspicious_activity' | 'location_change' | 'large_transaction';
  severity: 'info' | 'warning' | 'high' | 'critical';
  location?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

class DiscordSecurityNotifications {
  private recentEvents: Map<string, DiscordSecurityEvent[]> = new Map();
  private readonly MAX_EVENTS_PER_USER = 50;

  /**
   * Track Discord OAuth login
   */
  async trackOAuthLogin(params: {
    userId: string;
    discordId: string;
    req: Request;
    isNewLocation?: boolean;
    isNewDevice?: boolean;
  }) {
    const { userId, discordId, req, isNewLocation, isNewDevice } = params;

    // Create security event
    const event: DiscordSecurityEvent = {
      userId,
      discordId,
      type: 'oauth_login',
      severity: isNewLocation || isNewDevice ? 'warning' : 'info',
      location: this.getLocationFromRequest(req),
      ipAddress: this.getIpAddress(req),
      userAgent: req.get('User-Agent'),
      metadata: {
        isNewLocation,
        isNewDevice,
        timestamp: new Date()
      }
    };

    this.addEvent(userId, event);

    // Send notification if suspicious
    if (isNewLocation || isNewDevice) {
      await this.sendDiscordLoginNotification(event);
    }

    console.log(`🔐 Discord OAuth login tracked: ${discordId} from ${event.location}`);
  }

  /**
   * Track admin panel access
   */
  async trackAdminAccess(params: {
    adminId: string;
    req: Request;
    action: string;
    success: boolean;
  }) {
    const { adminId, req, action, success } = params;

    const event: DiscordSecurityEvent = {
      userId: adminId,
      discordId: adminId,
      type: 'admin_access',
      severity: success ? 'info' : 'high',
      location: this.getLocationFromRequest(req),
      ipAddress: this.getIpAddress(req),
      userAgent: req.get('User-Agent'),
      metadata: {
        action,
        success,
        timestamp: new Date()
      }
    };

    this.addEvent(adminId, event);

    // Always notify admin access
    await this.sendAdminAccessNotification(event);

    console.log(`🛡️ Admin access tracked: ${action} (${success ? 'success' : 'failed'}) from ${event.location}`);
  }

  /**
   * Track API key usage spikes
   */
  async trackApiKeyUsage(params: {
    userId: string;
    keyId: string;
    requestCount: number;
    isSpike: boolean;
    isRateLimited: boolean;
  }) {
    const { userId, keyId, requestCount, isSpike, isRateLimited } = params;

    if (!isSpike && !isRateLimited) return; // Only track anomalies

    const event: DiscordSecurityEvent = {
      userId,
      discordId: userId,
      type: 'api_key_usage',
      severity: isRateLimited ? 'warning' : 'info',
      metadata: {
        keyId: keyId.slice(0, 8) + '...',
        requestCount,
        isSpike,
        isRateLimited,
        timestamp: new Date()
      }
    };

    this.addEvent(userId, event);

    if (isSpike) {
      await this.sendApiUsageSpikeNotification(event);
    }

    console.log(`📊 API usage tracked: ${requestCount} requests (spike: ${isSpike}, limited: ${isRateLimited})`);
  }

  /**
   * Track suspicious financial activity
   */
  async trackSuspiciousTransaction(params: {
    userId: string;
    discordId: string;
    type: 'large_withdrawal' | 'unusual_pattern' | 'rapid_transactions';
    amount?: number;
    req?: Request;
  }) {
    const { userId, discordId, type, amount, req } = params;

    const event: DiscordSecurityEvent = {
      userId,
      discordId,
      type: 'large_transaction',
      severity: 'warning',
      location: req ? this.getLocationFromRequest(req) : undefined,
      ipAddress: req ? this.getIpAddress(req) : undefined,
      metadata: {
        transactionType: type,
        amount,
        timestamp: new Date()
      }
    };

    this.addEvent(userId, event);
    await this.sendTransactionNotification(event);

    console.log(`💰 Suspicious transaction tracked: ${type} ${amount ? `($${amount})` : ''} for ${discordId}`);
  }

  /**
   * Send Discord OAuth login notification
   */
  private async sendDiscordLoginNotification(event: DiscordSecurityEvent) {
    const isNewLocation = event.metadata?.isNewLocation;
    const isNewDevice = event.metadata?.isNewDevice;

    let title = '🔐 New Discord Login';
    let description = `New login to PIPTip from ${event.location}`;

    if (isNewLocation && isNewDevice) {
      title = '🚨 New Location & Device Login';
      description = `Someone logged into PIPTip from a new location AND device: ${event.location}`;
    } else if (isNewLocation) {
      title = '🌍 New Location Login';
      description = `New login to PIPTip from: ${event.location}`;
    } else if (isNewDevice) {
      title = '📱 New Device Login';
      description = `New device used to access PIPTip from ${event.location}`;
    }

    await createSecurityIncident({
      userId: event.userId,
      type: 'session_hijack',
      severity: event.severity,
      title,
      description: `${description}\n\nDevice: ${event.userAgent}\nIP: ${event.ipAddress}\nTime: ${new Date().toLocaleString()}`,
      technicalDetails: {
        location: event.location,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        isNewLocation,
        isNewDevice
      }
    });
  }

  /**
   * Send admin access notification
   */
  private async sendAdminAccessNotification(event: DiscordSecurityEvent) {
    const { action, success } = event.metadata || {};

    const title = success ? '🛡️ Admin Panel Access' : '🚨 Failed Admin Access';
    const description = success
      ? `Admin panel accessed: ${action} from ${event.location}`
      : `Failed admin panel access attempt: ${action} from ${event.location}`;

    await createSecurityIncident({
      userId: event.userId,
      type: success ? 'anomaly_detected' : 'brute_force',
      severity: event.severity,
      title,
      description: `${description}\n\nDevice: ${event.userAgent}\nIP: ${event.ipAddress}\nTime: ${new Date().toLocaleString()}`,
      technicalDetails: {
        action,
        success,
        location: event.location,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent
      }
    });
  }

  /**
   * Send API usage spike notification
   */
  private async sendApiUsageSpikeNotification(event: DiscordSecurityEvent) {
    const { keyId, requestCount, isRateLimited } = event.metadata || {};

    const title = '📈 API Usage Spike Detected';
    const description = `Your API key ${keyId} processed ${requestCount.toLocaleString()} requests in the last hour${isRateLimited ? ' and hit rate limits' : ''}`;

    await createSecurityIncident({
      userId: event.userId,
      type: 'anomaly_detected',
      severity: 'info',
      title,
      description: `${description}\n\nThis could indicate:\n• Successful integration launch\n• Potential bot/scraping activity\n• Integration bug causing loops\n\nReview your API usage in the dashboard.`,
      technicalDetails: {
        keyId,
        requestCount,
        isRateLimited,
        timestamp: new Date()
      }
    });
  }

  /**
   * Send transaction notification
   */
  private async sendTransactionNotification(event: DiscordSecurityEvent) {
    const { transactionType, amount } = event.metadata || {};

    const titles = {
      'large_withdrawal': '💰 Large Withdrawal Detected',
      'unusual_pattern': '⚠️ Unusual Transaction Pattern',
      'rapid_transactions': '⚡ Rapid Transaction Activity'
    };

    const descriptions = {
      'large_withdrawal': `Large withdrawal of $${amount} detected from ${event.location}`,
      'unusual_pattern': `Unusual transaction pattern detected from ${event.location}`,
      'rapid_transactions': `Multiple rapid transactions detected from ${event.location}`
    };

    await createSecurityIncident({
      userId: event.userId,
      type: 'suspicious_transaction',
      severity: 'warning',
      title: titles[transactionType as keyof typeof titles] || 'Transaction Alert',
      description: `${descriptions[transactionType as keyof typeof descriptions]}\n\nIf this was you, no action needed. If not, secure your Discord account immediately and contact support.`,
      technicalDetails: {
        transactionType,
        amount,
        location: event.location,
        ipAddress: event.ipAddress,
        timestamp: new Date()
      }
    });
  }

  /**
   * Get user's recent security events
   */
  getUserEvents(userId: string, limit: number = 10): DiscordSecurityEvent[] {
    const events = this.recentEvents.get(userId) || [];
    return events.slice(-limit).reverse();
  }

  /**
   * Check for Discord 2FA and send reminder
   */
  async checkDiscord2FA(userId: string, discordId: string, has2FA: boolean) {
    if (!has2FA) {
      await createSecurityIncident({
        userId,
        type: '2fa_disabled',
        severity: 'warning',
        title: '🔒 Discord 2FA Disabled',
        description: 'Your Discord account doesn\'t have 2FA enabled. Enable Discord 2FA to:\n\n• Protect your PIPTip account\n• Earn bonus rewards\n• Increase security score\n• Unlock premium features',
        technicalDetails: {
          discordId,
          recommendation: 'Enable 2FA in Discord Settings > Account > Two-Factor Authentication'
        }
      });

      console.log(`🔔 Discord 2FA reminder sent to ${discordId}`);
    }
  }

  /**
   * Generate daily security digest
   */
  generateDailyDigest(userId: string): string {
    const events = this.getUserEvents(userId, 50);
    const today = new Date().toDateString();
    const todayEvents = events.filter(e =>
      new Date(e.metadata?.timestamp).toDateString() === today
    );

    if (todayEvents.length === 0) {
      return '✅ No security alerts today - your PIPTip account is secure!';
    }

    const eventCounts = todayEvents.reduce((counts, event) => {
      counts[event.type] = (counts[event.type] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    const digest = [
      '🛡️ Daily Security Digest:',
      ...Object.entries(eventCounts).map(([type, count]) => {
        const labels = {
          'oauth_login': '🔐 Discord logins',
          'admin_access': '🛡️ Admin access',
          'api_key_usage': '📊 API anomalies',
          'large_transaction': '💰 Transaction alerts'
        };
        return `• ${count} ${labels[type as keyof typeof labels] || type}`;
      }),
      '',
      'Review details in your security dashboard.'
    ];

    return digest.join('\n');
  }

  /**
   * Add event to user's history
   */
  private addEvent(userId: string, event: DiscordSecurityEvent) {
    const events = this.recentEvents.get(userId) || [];
    events.push(event);

    // Keep only recent events
    if (events.length > this.MAX_EVENTS_PER_USER) {
      events.splice(0, events.length - this.MAX_EVENTS_PER_USER);
    }

    this.recentEvents.set(userId, events);
  }

  /**
   * Extract location from request
   */
  private getLocationFromRequest(req: Request): string {
    // In production, use IP geolocation service
    const country = req.get('CF-IPCountry') || req.get('X-Client-Country');
    const city = req.get('CF-IPCity') || req.get('X-Client-City');

    if (city && country) {
      return `${city}, ${country}`;
    } else if (country) {
      return country;
    }

    // Mock locations based on IP ranges for demo
    const ip = this.getIpAddress(req);
    if (ip.startsWith('192.168') || ip.startsWith('127.0')) {
      return 'Local Network';
    } else if (ip.startsWith('203.0')) {
      return 'Tokyo, Japan';
    } else if (ip.startsWith('198.51')) {
      return 'London, UK';
    }

    return 'Unknown Location';
  }

  /**
   * Extract IP address from request
   */
  private getIpAddress(req: Request): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    const ipAddress = forwardedFor
      ? (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0]).trim()
      : req.ip || req.socket.remoteAddress || 'unknown';

    return ipAddress;
  }

  /**
   * Clean up old events
   */
  cleanup() {
    const now = Date.now();
    const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

    for (const [userId, events] of this.recentEvents.entries()) {
      const recentEvents = events.filter(event => {
        const eventTime = new Date(event.metadata?.timestamp).getTime();
        return now - eventTime < WEEK_IN_MS;
      });

      if (recentEvents.length === 0) {
        this.recentEvents.delete(userId);
      } else {
        this.recentEvents.set(userId, recentEvents);
      }
    }

    console.log(`🧹 Cleaned up old security events (${this.recentEvents.size} users tracked)`);
  }
}

// Create singleton instance
export const discordSecurityNotifications = new DiscordSecurityNotifications();

// Convenience functions
export async function trackDiscordLogin(params: {
  userId: string;
  discordId: string;
  req: Request;
  isNewLocation?: boolean;
  isNewDevice?: boolean;
}) {
  return discordSecurityNotifications.trackOAuthLogin(params);
}

export async function trackAdminAccess(params: {
  adminId: string;
  req: Request;
  action: string;
  success: boolean;
}) {
  return discordSecurityNotifications.trackAdminAccess(params);
}

export async function trackApiSpike(params: {
  userId: string;
  keyId: string;
  requestCount: number;
  isSpike: boolean;
  isRateLimited: boolean;
}) {
  return discordSecurityNotifications.trackApiKeyUsage(params);
}

export async function trackSuspiciousTransaction(params: {
  userId: string;
  discordId: string;
  type: 'large_withdrawal' | 'unusual_pattern' | 'rapid_transactions';
  amount?: number;
  req?: Request;
}) {
  return discordSecurityNotifications.trackSuspiciousTransaction(params);
}

export function getUserSecurityEvents(userId: string, limit?: number) {
  return discordSecurityNotifications.getUserEvents(userId, limit);
}

export async function sendDiscord2FAReminder(userId: string, discordId: string, has2FA: boolean) {
  return discordSecurityNotifications.checkDiscord2FA(userId, discordId, has2FA);
}

export function getDailySecurityDigest(userId: string): string {
  return discordSecurityNotifications.generateDailyDigest(userId);
}

// Setup cleanup interval
setInterval(() => {
  discordSecurityNotifications.cleanup();
}, 24 * 60 * 60 * 1000); // Daily cleanup

// Export for integration
export default discordSecurityNotifications;