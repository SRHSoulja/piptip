// Incident Notification System - Real-time security alerts and notifications
import type { Request } from 'express';

interface SecurityIncident {
  id: string;
  userId: string;
  type: 'session_hijack' | 'brute_force' | 'anomaly_detected' | 'suspicious_transaction' | 'account_locked' | 'password_change' | '2fa_enabled' | '2fa_disabled';
  severity: 'info' | 'warning' | 'high' | 'critical';
  title: string;
  description: string;
  userMessage: string; // User-friendly message
  technicalDetails: Record<string, any>;
  timestamp: Date;
  resolved: boolean;
  actions: SecurityAction[];
  metadata: {
    ipAddress?: string;
    userAgent?: string;
    location?: string;
    previousActivity?: string;
  };
}

interface SecurityAction {
  id: string;
  label: string;
  type: 'acknowledge' | 'resolve' | 'block_ip' | 'reset_password' | 'enable_2fa' | 'contact_support';
  url?: string;
  confirmationRequired: boolean;
}

interface NotificationChannel {
  type: 'email' | 'discord' | 'webhook' | 'in_app';
  enabled: boolean;
  config: Record<string, any>;
}

class IncidentNotificationService {
  private incidents: Map<string, SecurityIncident> = new Map();
  private userChannels: Map<string, NotificationChannel[]> = new Map();
  private readonly MAX_INCIDENTS = 1000;

  constructor() {
    // Cleanup old incidents every hour
    setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);

    console.log('🚨 Incident notification service initialized');
  }

  /**
   * Create and distribute a security incident notification
   */
  async createIncident(params: {
    userId: string;
    type: SecurityIncident['type'];
    severity: SecurityIncident['severity'];
    title: string;
    description: string;
    technicalDetails?: Record<string, any>;
    req?: Request;
  }): Promise<SecurityIncident> {

    const incident: SecurityIncident = {
      id: `incident_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: params.userId,
      type: params.type,
      severity: params.severity,
      title: params.title,
      description: params.description,
      userMessage: this.generateUserMessage(params.type, params.severity, params.description),
      technicalDetails: params.technicalDetails || {},
      timestamp: new Date(),
      resolved: false,
      actions: this.generateActions(params.type, params.severity),
      metadata: params.req ? this.extractRequestMetadata(params.req) : {}
    };

    // Store incident
    this.incidents.set(incident.id, incident);

    // Cleanup if we have too many incidents
    if (this.incidents.size > this.MAX_INCIDENTS) {
      const oldestIncident = Array.from(this.incidents.values())
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
      this.incidents.delete(oldestIncident.id);
    }

    // Send notifications
    await this.sendNotifications(incident);

    console.log(`🚨 Security incident created: ${incident.type} (${incident.severity}) for user ${params.userId.slice(0, 8)}...`);

    return incident;
  }

  /**
   * Generate user-friendly message based on incident type
   */
  private generateUserMessage(type: SecurityIncident['type'], severity: SecurityIncident['severity'], description: string): string {
    const messages: Record<string, Record<string, string>> = {
      session_hijack: {
        info: 'We noticed you logged in from a new location.',
        warning: 'Your session was accessed from an unusual location.',
        high: 'Suspicious activity detected on your account.',
        critical: 'Your account may have been compromised. Please secure your account immediately.'
      },
      brute_force: {
        info: 'Someone tried to access your account with wrong credentials.',
        warning: 'Multiple failed login attempts detected.',
        high: 'Your account is under attack. Consider enabling 2FA.',
        critical: 'Account temporarily locked due to security threats.'
      },
      anomaly_detected: {
        info: 'Unusual activity pattern detected on your account.',
        warning: 'Your behavior pattern seems different than usual.',
        high: 'Suspicious activity detected. Please verify recent actions.',
        critical: 'Account flagged for unusual activity. Verification required.'
      },
      suspicious_transaction: {
        info: 'Large transaction detected for review.',
        warning: 'Unusual financial activity on your account.',
        high: 'Suspicious financial transactions detected.',
        critical: 'Financial operations restricted due to suspicious activity.'
      },
      account_locked: {
        info: 'Account locked as a precautionary measure.',
        warning: 'Account temporarily locked for security.',
        high: 'Account locked due to security concerns.',
        critical: 'Account locked - immediate attention required.'
      },
      password_change: {
        info: 'Password changed successfully.',
        warning: 'Password changed from new device.',
        high: 'Password changed - verify this was you.',
        critical: 'Password changed without verification.'
      },
      '2fa_enabled': {
        info: 'Two-factor authentication enabled successfully.',
        warning: 'Two-factor authentication enabled.',
        high: 'Two-factor authentication enabled.',
        critical: 'Two-factor authentication enabled.'
      },
      '2fa_disabled': {
        info: 'Two-factor authentication disabled.',
        warning: 'Two-factor authentication disabled - consider re-enabling.',
        high: 'Two-factor authentication disabled from new device.',
        critical: 'Two-factor authentication disabled without proper verification.'
      }
    };

    return messages[type]?.[severity] || description;
  }

  /**
   * Generate appropriate actions based on incident type and severity
   */
  private generateActions(type: SecurityIncident['type'], severity: SecurityIncident['severity']): SecurityAction[] {
    const baseActions: SecurityAction[] = [
      {
        id: 'acknowledge',
        label: 'I understand',
        type: 'acknowledge',
        confirmationRequired: false
      }
    ];

    const actions: Record<string, SecurityAction[]> = {
      session_hijack: [
        ...baseActions,
        {
          id: 'change_password',
          label: 'Change Password',
          type: 'reset_password',
          url: '/security/password-reset',
          confirmationRequired: true
        },
        {
          id: 'enable_2fa',
          label: 'Enable 2FA',
          type: 'enable_2fa',
          url: '/security/2fa-setup',
          confirmationRequired: false
        }
      ],
      brute_force: [
        ...baseActions,
        {
          id: 'block_ip',
          label: 'Block This IP',
          type: 'block_ip',
          confirmationRequired: true
        },
        {
          id: 'enable_2fa',
          label: 'Enable 2FA',
          type: 'enable_2fa',
          url: '/security/2fa-setup',
          confirmationRequired: false
        }
      ],
      anomaly_detected: [
        ...baseActions,
        {
          id: 'review_activity',
          label: 'Review Recent Activity',
          type: 'resolve',
          url: '/security/activity',
          confirmationRequired: false
        }
      ],
      suspicious_transaction: [
        ...baseActions,
        {
          id: 'contact_support',
          label: 'Contact Support',
          type: 'contact_support',
          url: '/support',
          confirmationRequired: false
        }
      ],
      account_locked: [
        {
          id: 'contact_support',
          label: 'Contact Support to Unlock',
          type: 'contact_support',
          url: '/support',
          confirmationRequired: false
        }
      ],
      password_change: [...baseActions],
      '2fa_enabled': [...baseActions],
      '2fa_disabled': [
        ...baseActions,
        {
          id: 'enable_2fa',
          label: 'Re-enable 2FA',
          type: 'enable_2fa',
          url: '/security/2fa-setup',
          confirmationRequired: false
        }
      ]
    };

    return actions[type] || baseActions;
  }

  /**
   * Extract metadata from request
   */
  private extractRequestMetadata(req: Request): SecurityIncident['metadata'] {
    const forwardedFor = req.headers['x-forwarded-for'];
    const ipAddress = forwardedFor
      ? (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0]).trim()
      : req.ip || req.socket.remoteAddress || 'unknown';

    return {
      ipAddress,
      userAgent: req.get('User-Agent') || 'Unknown',
      location: req.get('CF-IPCountry') || req.get('X-Client-Timezone') || 'Unknown'
    };
  }

  /**
   * Send notifications through configured channels
   */
  private async sendNotifications(incident: SecurityIncident): Promise<void> {
    const userChannels = this.userChannels.get(incident.userId) || this.getDefaultChannels();

    for (const channel of userChannels) {
      if (!channel.enabled) continue;

      try {
        switch (channel.type) {
          case 'in_app':
            // In-app notifications are stored and shown in dashboard
            break;
          case 'discord':
            await this.sendDiscordNotification(incident, channel);
            break;
          case 'email':
            await this.sendEmailNotification(incident, channel);
            break;
          case 'webhook':
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
  private async sendDiscordNotification(incident: SecurityIncident, channel: NotificationChannel): Promise<void> {
    // In production, integrate with Discord bot to send DM
    console.log(`📱 Discord notification sent for incident ${incident.id}`);
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(incident: SecurityIncident, channel: NotificationChannel): Promise<void> {
    // In production, integrate with email service
    console.log(`📧 Email notification sent for incident ${incident.id}`);
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(incident: SecurityIncident, channel: NotificationChannel): Promise<void> {
    // In production, send HTTP POST to webhook URL
    console.log(`🔗 Webhook notification sent for incident ${incident.id}`);
  }

  /**
   * Get default notification channels
   */
  private getDefaultChannels(): NotificationChannel[] {
    return [
      {
        type: 'in_app',
        enabled: true,
        config: {}
      },
      {
        type: 'discord',
        enabled: false, // Disabled by default
        config: {}
      }
    ];
  }

  /**
   * Get incidents for a user
   */
  getUserIncidents(userId: string, limit: number = 20): SecurityIncident[] {
    return Array.from(this.incidents.values())
      .filter(incident => incident.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get unresolved incidents for a user
   */
  getUnresolvedIncidents(userId: string): SecurityIncident[] {
    return Array.from(this.incidents.values())
      .filter(incident => incident.userId === userId && !incident.resolved)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Resolve an incident
   */
  resolveIncident(incidentId: string, userId: string): boolean {
    const incident = this.incidents.get(incidentId);
    if (incident && incident.userId === userId) {
      incident.resolved = true;
      console.log(`✅ Incident ${incidentId} resolved by user ${userId.slice(0, 8)}...`);
      return true;
    }
    return false;
  }

  /**
   * Get incident statistics
   */
  getIncidentStats(): {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    resolved: number;
    unresolved: number;
  } {
    const incidents = Array.from(this.incidents.values());

    const byType = incidents.reduce((acc, incident) => {
      acc[incident.type] = (acc[incident.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const bySeverity = incidents.reduce((acc, incident) => {
      acc[incident.severity] = (acc[incident.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const resolved = incidents.filter(i => i.resolved).length;
    const unresolved = incidents.filter(i => !i.resolved).length;

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
  updateUserChannels(userId: string, channels: NotificationChannel[]): void {
    this.userChannels.set(userId, channels);
    console.log(`🔔 Updated notification preferences for user ${userId.slice(0, 8)}...`);
  }

  /**
   * Clean up old incidents
   */
  private cleanup(): void {
    const now = Date.now();
    const OLD_THRESHOLD = 30 * 24 * 60 * 60 * 1000; // 30 days
    let cleanedCount = 0;

    for (const [id, incident] of this.incidents.entries()) {
      if (incident.resolved && now - incident.timestamp.getTime() > OLD_THRESHOLD) {
        this.incidents.delete(id);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} old security incidents`);
    }
  }

  /**
   * Shutdown and cleanup
   */
  destroy(): void {
    this.incidents.clear();
    this.userChannels.clear();
    console.log('🚨 Incident notification service destroyed');
  }
}

// Create singleton instance
export const incidentNotification = new IncidentNotificationService();

// Export convenience functions
export async function createSecurityIncident(params: Parameters<typeof incidentNotification.createIncident>[0]) {
  return incidentNotification.createIncident(params);
}

export function getUserIncidents(userId: string, limit?: number) {
  return incidentNotification.getUserIncidents(userId, limit);
}

export function getUnresolvedIncidents(userId: string) {
  return incidentNotification.getUnresolvedIncidents(userId);
}

export function resolveIncident(incidentId: string, userId: string) {
  return incidentNotification.resolveIncident(incidentId, userId);
}

export function getIncidentStats() {
  return incidentNotification.getIncidentStats();
}

export function updateUserNotificationChannels(userId: string, channels: NotificationChannel[]) {
  return incidentNotification.updateUserChannels(userId, channels);
}

// Cleanup on process exit
process.on('exit', () => incidentNotification.destroy());
process.on('SIGINT', () => incidentNotification.destroy());
process.on('SIGTERM', () => incidentNotification.destroy());