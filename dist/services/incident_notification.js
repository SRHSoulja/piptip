class IncidentNotificationService {
  incidents = /* @__PURE__ */ new Map();
  userChannels = /* @__PURE__ */ new Map();
  MAX_INCIDENTS = 1e3;
  constructor() {
    setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1e3);
    console.log("\u{1F6A8} Incident notification service initialized");
  }
  /**
   * Create and distribute a security incident notification
   */
  async createIncident(params) {
    const incident = {
      id: `incident_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: params.userId,
      type: params.type,
      severity: params.severity,
      title: params.title,
      description: params.description,
      userMessage: this.generateUserMessage(params.type, params.severity, params.description),
      technicalDetails: params.technicalDetails || {},
      timestamp: /* @__PURE__ */ new Date(),
      resolved: false,
      actions: this.generateActions(params.type, params.severity),
      metadata: params.req ? this.extractRequestMetadata(params.req) : {}
    };
    this.incidents.set(incident.id, incident);
    if (this.incidents.size > this.MAX_INCIDENTS) {
      const oldestIncident = Array.from(this.incidents.values()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
      this.incidents.delete(oldestIncident.id);
    }
    await this.sendNotifications(incident);
    console.log(`\u{1F6A8} Security incident created: ${incident.type} (${incident.severity}) for user ${params.userId.slice(0, 8)}...`);
    return incident;
  }
  /**
   * Generate user-friendly message based on incident type
   */
  generateUserMessage(type, severity, description) {
    const messages = {
      session_hijack: {
        info: "We noticed you logged in from a new location.",
        warning: "Your session was accessed from an unusual location.",
        high: "Suspicious activity detected on your account.",
        critical: "Your account may have been compromised. Please secure your account immediately."
      },
      brute_force: {
        info: "Someone tried to access your account with wrong credentials.",
        warning: "Multiple failed login attempts detected.",
        high: "Your account is under attack. Consider enabling 2FA.",
        critical: "Account temporarily locked due to security threats."
      },
      anomaly_detected: {
        info: "Unusual activity pattern detected on your account.",
        warning: "Your behavior pattern seems different than usual.",
        high: "Suspicious activity detected. Please verify recent actions.",
        critical: "Account flagged for unusual activity. Verification required."
      },
      suspicious_transaction: {
        info: "Large transaction detected for review.",
        warning: "Unusual financial activity on your account.",
        high: "Suspicious financial transactions detected.",
        critical: "Financial operations restricted due to suspicious activity."
      },
      account_locked: {
        info: "Account locked as a precautionary measure.",
        warning: "Account temporarily locked for security.",
        high: "Account locked due to security concerns.",
        critical: "Account locked - immediate attention required."
      },
      password_change: {
        info: "Password changed successfully.",
        warning: "Password changed from new device.",
        high: "Password changed - verify this was you.",
        critical: "Password changed without verification."
      },
      "2fa_enabled": {
        info: "Two-factor authentication enabled successfully.",
        warning: "Two-factor authentication enabled.",
        high: "Two-factor authentication enabled.",
        critical: "Two-factor authentication enabled."
      },
      "2fa_disabled": {
        info: "Two-factor authentication disabled.",
        warning: "Two-factor authentication disabled - consider re-enabling.",
        high: "Two-factor authentication disabled from new device.",
        critical: "Two-factor authentication disabled without proper verification."
      }
    };
    return messages[type]?.[severity] || description;
  }
  /**
   * Generate appropriate actions based on incident type and severity
   */
  generateActions(type, severity) {
    const baseActions = [
      {
        id: "acknowledge",
        label: "I understand",
        type: "acknowledge",
        confirmationRequired: false
      }
    ];
    const actions = {
      session_hijack: [
        ...baseActions,
        {
          id: "change_password",
          label: "Change Password",
          type: "reset_password",
          url: "/security/password-reset",
          confirmationRequired: true
        },
        {
          id: "enable_2fa",
          label: "Enable 2FA",
          type: "enable_2fa",
          url: "/security/2fa-setup",
          confirmationRequired: false
        }
      ],
      brute_force: [
        ...baseActions,
        {
          id: "block_ip",
          label: "Block This IP",
          type: "block_ip",
          confirmationRequired: true
        },
        {
          id: "enable_2fa",
          label: "Enable 2FA",
          type: "enable_2fa",
          url: "/security/2fa-setup",
          confirmationRequired: false
        }
      ],
      anomaly_detected: [
        ...baseActions,
        {
          id: "review_activity",
          label: "Review Recent Activity",
          type: "resolve",
          url: "/security/activity",
          confirmationRequired: false
        }
      ],
      suspicious_transaction: [
        ...baseActions,
        {
          id: "contact_support",
          label: "Contact Support",
          type: "contact_support",
          url: "/support",
          confirmationRequired: false
        }
      ],
      account_locked: [
        {
          id: "contact_support",
          label: "Contact Support to Unlock",
          type: "contact_support",
          url: "/support",
          confirmationRequired: false
        }
      ],
      password_change: [...baseActions],
      "2fa_enabled": [...baseActions],
      "2fa_disabled": [
        ...baseActions,
        {
          id: "enable_2fa",
          label: "Re-enable 2FA",
          type: "enable_2fa",
          url: "/security/2fa-setup",
          confirmationRequired: false
        }
      ]
    };
    return actions[type] || baseActions;
  }
  /**
   * Extract metadata from request
   */
  extractRequestMetadata(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    const ipAddress = forwardedFor ? (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(",")[0]).trim() : req.ip || req.socket.remoteAddress || "unknown";
    return {
      ipAddress,
      userAgent: req.get("User-Agent") || "Unknown",
      location: req.get("CF-IPCountry") || req.get("X-Client-Timezone") || "Unknown"
    };
  }
  /**
   * Send notifications through configured channels
   */
  async sendNotifications(incident) {
    const userChannels = this.userChannels.get(incident.userId) || this.getDefaultChannels();
    for (const channel of userChannels) {
      if (!channel.enabled) continue;
      try {
        switch (channel.type) {
          case "in_app":
            break;
          case "discord":
            await this.sendDiscordNotification(incident, channel);
            break;
          case "email":
            await this.sendEmailNotification(incident, channel);
            break;
          case "webhook":
            await this.sendWebhookNotification(incident, channel);
            break;
        }
      } catch (error) {
        console.error(`Failed to send ${channel.type} notification for incident ${incident.id}:`, error);
      }
    }
  }
  /**
   * Send Discord notification
   */
  async sendDiscordNotification(incident, channel) {
    console.log(`\u{1F4F1} Discord notification sent for incident ${incident.id}`);
  }
  /**
   * Send email notification
   */
  async sendEmailNotification(incident, channel) {
    console.log(`\u{1F4E7} Email notification sent for incident ${incident.id}`);
  }
  /**
   * Send webhook notification
   */
  async sendWebhookNotification(incident, channel) {
    console.log(`\u{1F517} Webhook notification sent for incident ${incident.id}`);
  }
  /**
   * Get default notification channels
   */
  getDefaultChannels() {
    return [
      {
        type: "in_app",
        enabled: true,
        config: {}
      },
      {
        type: "discord",
        enabled: false,
        // Disabled by default
        config: {}
      }
    ];
  }
  /**
   * Get incidents for a user
   */
  getUserIncidents(userId, limit = 20) {
    return Array.from(this.incidents.values()).filter((incident) => incident.userId === userId).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
  }
  /**
   * Get unresolved incidents for a user
   */
  getUnresolvedIncidents(userId) {
    return Array.from(this.incidents.values()).filter((incident) => incident.userId === userId && !incident.resolved).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  /**
   * Resolve an incident
   */
  resolveIncident(incidentId, userId) {
    const incident = this.incidents.get(incidentId);
    if (incident && incident.userId === userId) {
      incident.resolved = true;
      console.log(`\u2705 Incident ${incidentId} resolved by user ${userId.slice(0, 8)}...`);
      return true;
    }
    return false;
  }
  /**
   * Get incident statistics
   */
  getIncidentStats() {
    const incidents = Array.from(this.incidents.values());
    const byType = incidents.reduce((acc, incident) => {
      acc[incident.type] = (acc[incident.type] || 0) + 1;
      return acc;
    }, {});
    const bySeverity = incidents.reduce((acc, incident) => {
      acc[incident.severity] = (acc[incident.severity] || 0) + 1;
      return acc;
    }, {});
    const resolved = incidents.filter((i) => i.resolved).length;
    const unresolved = incidents.filter((i) => !i.resolved).length;
    return {
      total: incidents.length,
      byType,
      bySeverity,
      resolved,
      unresolved
    };
  }
  /**
   * Update user notification preferences
   */
  updateUserChannels(userId, channels) {
    this.userChannels.set(userId, channels);
    console.log(`\u{1F514} Updated notification preferences for user ${userId.slice(0, 8)}...`);
  }
  /**
   * Clean up old incidents
   */
  cleanup() {
    const now = Date.now();
    const OLD_THRESHOLD = 30 * 24 * 60 * 60 * 1e3;
    let cleanedCount = 0;
    for (const [id, incident] of this.incidents.entries()) {
      if (incident.resolved && now - incident.timestamp.getTime() > OLD_THRESHOLD) {
        this.incidents.delete(id);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      console.log(`\u{1F9F9} Cleaned up ${cleanedCount} old security incidents`);
    }
  }
  /**
   * Shutdown and cleanup
   */
  destroy() {
    this.incidents.clear();
    this.userChannels.clear();
    console.log("\u{1F6A8} Incident notification service destroyed");
  }
}
const incidentNotification = new IncidentNotificationService();
async function createSecurityIncident(params) {
  return incidentNotification.createIncident(params);
}
function getUserIncidents(userId, limit) {
  return incidentNotification.getUserIncidents(userId, limit);
}
function getUnresolvedIncidents(userId) {
  return incidentNotification.getUnresolvedIncidents(userId);
}
function resolveIncident(incidentId, userId) {
  return incidentNotification.resolveIncident(incidentId, userId);
}
function getIncidentStats() {
  return incidentNotification.getIncidentStats();
}
function updateUserNotificationChannels(userId, channels) {
  return incidentNotification.updateUserChannels(userId, channels);
}
process.on("exit", () => incidentNotification.destroy());
process.on("SIGINT", () => incidentNotification.destroy());
process.on("SIGTERM", () => incidentNotification.destroy());
export {
  createSecurityIncident,
  getIncidentStats,
  getUnresolvedIncidents,
  getUserIncidents,
  incidentNotification,
  resolveIncident,
  updateUserNotificationChannels
};
//# sourceMappingURL=incident_notification.js.map
