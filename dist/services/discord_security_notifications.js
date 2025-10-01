import { createSecurityIncident } from "./incident_notification";
class DiscordSecurityNotifications {
  recentEvents = /* @__PURE__ */ new Map();
  MAX_EVENTS_PER_USER = 50;
  /**
   * Track Discord OAuth login
   */
  async trackOAuthLogin(params) {
    const { userId, discordId, req, isNewLocation, isNewDevice } = params;
    const event = {
      userId,
      discordId,
      type: "oauth_login",
      severity: isNewLocation || isNewDevice ? "warning" : "info",
      location: this.getLocationFromRequest(req),
      ipAddress: this.getIpAddress(req),
      userAgent: req.get("User-Agent"),
      metadata: {
        isNewLocation,
        isNewDevice,
        timestamp: /* @__PURE__ */ new Date()
      }
    };
    this.addEvent(userId, event);
    if (isNewLocation || isNewDevice) {
      await this.sendDiscordLoginNotification(event);
    }
    console.log(`\u{1F510} Discord OAuth login tracked: ${discordId} from ${event.location}`);
  }
  /**
   * Track admin panel access
   */
  async trackAdminAccess(params) {
    const { adminId, req, action, success } = params;
    const event = {
      userId: adminId,
      discordId: adminId,
      type: "admin_access",
      severity: success ? "info" : "high",
      location: this.getLocationFromRequest(req),
      ipAddress: this.getIpAddress(req),
      userAgent: req.get("User-Agent"),
      metadata: {
        action,
        success,
        timestamp: /* @__PURE__ */ new Date()
      }
    };
    this.addEvent(adminId, event);
    await this.sendAdminAccessNotification(event);
    console.log(`\u{1F6E1}\uFE0F Admin access tracked: ${action} (${success ? "success" : "failed"}) from ${event.location}`);
  }
  /**
   * Track API key usage spikes
   */
  async trackApiKeyUsage(params) {
    const { userId, keyId, requestCount, isSpike, isRateLimited } = params;
    if (!isSpike && !isRateLimited) return;
    const event = {
      userId,
      discordId: userId,
      type: "api_key_usage",
      severity: isRateLimited ? "warning" : "info",
      metadata: {
        keyId: keyId.slice(0, 8) + "...",
        requestCount,
        isSpike,
        isRateLimited,
        timestamp: /* @__PURE__ */ new Date()
      }
    };
    this.addEvent(userId, event);
    if (isSpike) {
      await this.sendApiUsageSpikeNotification(event);
    }
    console.log(`\u{1F4CA} API usage tracked: ${requestCount} requests (spike: ${isSpike}, limited: ${isRateLimited})`);
  }
  /**
   * Track suspicious financial activity
   */
  async trackSuspiciousTransaction(params) {
    const { userId, discordId, type, amount, req } = params;
    const event = {
      userId,
      discordId,
      type: "large_transaction",
      severity: "warning",
      location: req ? this.getLocationFromRequest(req) : void 0,
      ipAddress: req ? this.getIpAddress(req) : void 0,
      metadata: {
        transactionType: type,
        amount,
        timestamp: /* @__PURE__ */ new Date()
      }
    };
    this.addEvent(userId, event);
    await this.sendTransactionNotification(event);
    console.log(`\u{1F4B0} Suspicious transaction tracked: ${type} ${amount ? `($${amount})` : ""} for ${discordId}`);
  }
  /**
   * Send Discord OAuth login notification
   */
  async sendDiscordLoginNotification(event) {
    const isNewLocation = event.metadata?.isNewLocation;
    const isNewDevice = event.metadata?.isNewDevice;
    let title = "\u{1F510} New Discord Login";
    let description = `New login to PIPTip from ${event.location}`;
    if (isNewLocation && isNewDevice) {
      title = "\u{1F6A8} New Location & Device Login";
      description = `Someone logged into PIPTip from a new location AND device: ${event.location}`;
    } else if (isNewLocation) {
      title = "\u{1F30D} New Location Login";
      description = `New login to PIPTip from: ${event.location}`;
    } else if (isNewDevice) {
      title = "\u{1F4F1} New Device Login";
      description = `New device used to access PIPTip from ${event.location}`;
    }
    await createSecurityIncident({
      userId: event.userId,
      type: "session_hijack",
      severity: event.severity,
      title,
      description: `${description}

Device: ${event.userAgent}
IP: ${event.ipAddress}
Time: ${(/* @__PURE__ */ new Date()).toLocaleString()}`,
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
  async sendAdminAccessNotification(event) {
    const { action, success } = event.metadata || {};
    const title = success ? "\u{1F6E1}\uFE0F Admin Panel Access" : "\u{1F6A8} Failed Admin Access";
    const description = success ? `Admin panel accessed: ${action} from ${event.location}` : `Failed admin panel access attempt: ${action} from ${event.location}`;
    await createSecurityIncident({
      userId: event.userId,
      type: success ? "anomaly_detected" : "brute_force",
      severity: event.severity,
      title,
      description: `${description}

Device: ${event.userAgent}
IP: ${event.ipAddress}
Time: ${(/* @__PURE__ */ new Date()).toLocaleString()}`,
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
  async sendApiUsageSpikeNotification(event) {
    const { keyId, requestCount, isRateLimited } = event.metadata || {};
    const title = "\u{1F4C8} API Usage Spike Detected";
    const description = `Your API key ${keyId} processed ${requestCount.toLocaleString()} requests in the last hour${isRateLimited ? " and hit rate limits" : ""}`;
    await createSecurityIncident({
      userId: event.userId,
      type: "anomaly_detected",
      severity: "info",
      title,
      description: `${description}

This could indicate:
\u2022 Successful integration launch
\u2022 Potential bot/scraping activity
\u2022 Integration bug causing loops

Review your API usage in the dashboard.`,
      technicalDetails: {
        keyId,
        requestCount,
        isRateLimited,
        timestamp: /* @__PURE__ */ new Date()
      }
    });
  }
  /**
   * Send transaction notification
   */
  async sendTransactionNotification(event) {
    const { transactionType, amount } = event.metadata || {};
    const titles = {
      "large_withdrawal": "\u{1F4B0} Large Withdrawal Detected",
      "unusual_pattern": "\u26A0\uFE0F Unusual Transaction Pattern",
      "rapid_transactions": "\u26A1 Rapid Transaction Activity"
    };
    const descriptions = {
      "large_withdrawal": `Large withdrawal of $${amount} detected from ${event.location}`,
      "unusual_pattern": `Unusual transaction pattern detected from ${event.location}`,
      "rapid_transactions": `Multiple rapid transactions detected from ${event.location}`
    };
    await createSecurityIncident({
      userId: event.userId,
      type: "suspicious_transaction",
      severity: "warning",
      title: titles[transactionType] || "Transaction Alert",
      description: `${descriptions[transactionType]}

If this was you, no action needed. If not, secure your Discord account immediately and contact support.`,
      technicalDetails: {
        transactionType,
        amount,
        location: event.location,
        ipAddress: event.ipAddress,
        timestamp: /* @__PURE__ */ new Date()
      }
    });
  }
  /**
   * Get user's recent security events
   */
  getUserEvents(userId, limit = 10) {
    const events = this.recentEvents.get(userId) || [];
    return events.slice(-limit).reverse();
  }
  /**
   * Check for Discord 2FA and send reminder
   */
  async checkDiscord2FA(userId, discordId, has2FA) {
    if (!has2FA) {
      await createSecurityIncident({
        userId,
        type: "2fa_disabled",
        severity: "warning",
        title: "\u{1F512} Discord 2FA Disabled",
        description: "Your Discord account doesn't have 2FA enabled. Enable Discord 2FA to:\n\n\u2022 Protect your PIPTip account\n\u2022 Earn bonus rewards\n\u2022 Increase security score\n\u2022 Unlock premium features",
        technicalDetails: {
          discordId,
          recommendation: "Enable 2FA in Discord Settings > Account > Two-Factor Authentication"
        }
      });
      console.log(`\u{1F514} Discord 2FA reminder sent to ${discordId}`);
    }
  }
  /**
   * Generate daily security digest
   */
  generateDailyDigest(userId) {
    const events = this.getUserEvents(userId, 50);
    const today = (/* @__PURE__ */ new Date()).toDateString();
    const todayEvents = events.filter(
      (e) => new Date(e.metadata?.timestamp).toDateString() === today
    );
    if (todayEvents.length === 0) {
      return "\u2705 No security alerts today - your PIPTip account is secure!";
    }
    const eventCounts = todayEvents.reduce((counts, event) => {
      counts[event.type] = (counts[event.type] || 0) + 1;
      return counts;
    }, {});
    const digest = [
      "\u{1F6E1}\uFE0F Daily Security Digest:",
      ...Object.entries(eventCounts).map(([type, count]) => {
        const labels = {
          "oauth_login": "\u{1F510} Discord logins",
          "admin_access": "\u{1F6E1}\uFE0F Admin access",
          "api_key_usage": "\u{1F4CA} API anomalies",
          "large_transaction": "\u{1F4B0} Transaction alerts"
        };
        return `\u2022 ${count} ${labels[type] || type}`;
      }),
      "",
      "Review details in your security dashboard."
    ];
    return digest.join("\n");
  }
  /**
   * Add event to user's history
   */
  addEvent(userId, event) {
    const events = this.recentEvents.get(userId) || [];
    events.push(event);
    if (events.length > this.MAX_EVENTS_PER_USER) {
      events.splice(0, events.length - this.MAX_EVENTS_PER_USER);
    }
    this.recentEvents.set(userId, events);
  }
  /**
   * Extract location from request
   */
  getLocationFromRequest(req) {
    const country = req.get("CF-IPCountry") || req.get("X-Client-Country");
    const city = req.get("CF-IPCity") || req.get("X-Client-City");
    if (city && country) {
      return `${city}, ${country}`;
    } else if (country) {
      return country;
    }
    const ip = this.getIpAddress(req);
    if (ip.startsWith("192.168") || ip.startsWith("127.0")) {
      return "Local Network";
    } else if (ip.startsWith("203.0")) {
      return "Tokyo, Japan";
    } else if (ip.startsWith("198.51")) {
      return "London, UK";
    }
    return "Unknown Location";
  }
  /**
   * Extract IP address from request
   */
  getIpAddress(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    const ipAddress = forwardedFor ? (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(",")[0]).trim() : req.ip || req.socket.remoteAddress || "unknown";
    return ipAddress;
  }
  /**
   * Clean up old events
   */
  cleanup() {
    const now = Date.now();
    const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1e3;
    for (const [userId, events] of this.recentEvents.entries()) {
      const recentEvents = events.filter((event) => {
        const eventTime = new Date(event.metadata?.timestamp).getTime();
        return now - eventTime < WEEK_IN_MS;
      });
      if (recentEvents.length === 0) {
        this.recentEvents.delete(userId);
      } else {
        this.recentEvents.set(userId, recentEvents);
      }
    }
    console.log(`\u{1F9F9} Cleaned up old security events (${this.recentEvents.size} users tracked)`);
  }
}
const discordSecurityNotifications = new DiscordSecurityNotifications();
async function trackDiscordLogin(params) {
  return discordSecurityNotifications.trackOAuthLogin(params);
}
async function trackAdminAccess(params) {
  return discordSecurityNotifications.trackAdminAccess(params);
}
async function trackApiSpike(params) {
  return discordSecurityNotifications.trackApiKeyUsage(params);
}
async function trackSuspiciousTransaction(params) {
  return discordSecurityNotifications.trackSuspiciousTransaction(params);
}
function getUserSecurityEvents(userId, limit) {
  return discordSecurityNotifications.getUserEvents(userId, limit);
}
async function sendDiscord2FAReminder(userId, discordId, has2FA) {
  return discordSecurityNotifications.checkDiscord2FA(userId, discordId, has2FA);
}
function getDailySecurityDigest(userId) {
  return discordSecurityNotifications.generateDailyDigest(userId);
}
setInterval(() => {
  discordSecurityNotifications.cleanup();
}, 24 * 60 * 60 * 1e3);
var discord_security_notifications_default = discordSecurityNotifications;
export {
  discord_security_notifications_default as default,
  discordSecurityNotifications,
  getDailySecurityDigest,
  getUserSecurityEvents,
  sendDiscord2FAReminder,
  trackAdminAccess,
  trackApiSpike,
  trackDiscordLogin,
  trackSuspiciousTransaction
};
//# sourceMappingURL=discord_security_notifications.js.map
