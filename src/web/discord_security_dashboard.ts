// Discord-Focused Security Dashboard for PIPTip
import type { Request, Response } from 'express';
import { prisma } from '../services/database';
import { sessionFingerprinting } from '../services/session_fingerprinting';
import { apiKeyManager } from '../services/api_key_management';
import { getUserIncidents, getUnresolvedIncidents } from '../services/incident_notification';

interface DiscordSecurityProfile {
  discordId: string;
  discordUsername: string;
  discordHas2FA: boolean;
  adminHas2FA: boolean;
  hasActiveApiKeys: boolean;
  hasRecentSessions: boolean;
  lastOAuthLogin: Date;
  totalLogins: number;
  suspiciousActivity: number;
}

export async function getDiscordSecurityDashboard(req: Request, res: Response) {
  try {
    const { discordId } = req.params;

    if (!discordId) {
      return res.status(400).json({ error: 'Discord ID required' });
    }

    // Get user profile
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        id: true,
        discordId: true,
        createdAt: true,
        updatedAt: true,
        agwAddress: true,
        isBanned: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build security profile
    const profile = await buildDiscordSecurityProfile(user);

    // Calculate security score
    const securityScore = calculateDiscordSecurityScore(profile);

    // Get security incidents
    const recentIncidents = getUserIncidents(user.id.toString(), 5);
    const unresolvedIncidents = getUnresolvedIncidents(user.id.toString());

    // Get OAuth session history
    const sessionHistory = await getDiscordSessionHistory(discordId);

    // Get API key usage
    const apiKeyStats = await getApiKeyStats(user.id.toString());

    res.send(generateDiscordSecurityDashboard({
      profile,
      securityScore,
      recentIncidents,
      unresolvedIncidents,
      sessionHistory,
      apiKeyStats
    }));

  } catch (error) {
    console.error('Discord security dashboard error:', error);
    res.status(500).json({ error: 'Failed to load security dashboard' });
  }
}

async function buildDiscordSecurityProfile(user: any): Promise<DiscordSecurityProfile> {
  // In a real implementation, you'd check Discord's API for 2FA status
  // For now, we'll simulate this data
  return {
    discordId: user.discordId,
    discordUsername: `User#${user.discordId.slice(-4)}`, // Mock username
    discordHas2FA: Math.random() > 0.3, // 70% chance of having Discord 2FA
    adminHas2FA: false, // TODO: Check admin 2FA status
    hasActiveApiKeys: false, // TODO: Check API key status
    hasRecentSessions: true,
    lastOAuthLogin: user.updatedAt,
    totalLogins: Math.floor(Math.random() * 50) + 10,
    suspiciousActivity: Math.floor(Math.random() * 3)
  };
}

function calculateDiscordSecurityScore(profile: DiscordSecurityProfile): number {
  let score = 30; // Base Discord OAuth score
  if (profile.discordHas2FA) score += 25; // Discord 2FA
  if (profile.adminHas2FA) score += 20; // Admin panel 2FA
  if (profile.hasActiveApiKeys) score += 10; // API key management
  if (profile.hasRecentSessions && profile.suspiciousActivity === 0) score += 15; // Clean session history
  return Math.min(score, 100);
}

async function getDiscordSessionHistory(discordId: string) {
  // Mock session history - in production, track OAuth sessions
  return [
    {
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      location: 'San Francisco, US',
      ipAddress: '192.168.1.1',
      userAgent: 'Chrome 120.0.0.0',
      status: 'active'
    },
    {
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
      location: 'San Francisco, US',
      ipAddress: '192.168.1.1',
      userAgent: 'Firefox 119.0',
      status: 'expired'
    },
    {
      timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      location: 'New York, US',
      ipAddress: '203.0.113.1',
      userAgent: 'Chrome 119.0.0.0',
      status: 'expired'
    }
  ];
}

async function getApiKeyStats(userId: string) {
  try {
    const keys = await apiKeyManager.getUserApiKeys(userId);
    return {
      totalKeys: keys.length,
      activeKeys: keys.filter((k: any) => k.isActive).length,
      totalRequests: keys.reduce((sum: number, k: any) => sum + k.requestCount, 0),
      lastUsed: keys.length > 0 ? new Date() : null
    };
  } catch (error) {
    return {
      totalKeys: 0,
      activeKeys: 0,
      totalRequests: 0,
      lastUsed: null
    };
  }
}

function generateDiscordSecurityDashboard(data: any): string {
  const { profile, securityScore, recentIncidents, unresolvedIncidents, sessionHistory, apiKeyStats } = data;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Discord Security Dashboard - PIPTip</title>
      <style>
        ${getDiscordSecurityStyles()}
      </style>
    </head>
    <body>
      <div class="dashboard-container">
        <header class="dashboard-header">
          <div class="header-content">
            <h1>🛡️ Discord Security Dashboard</h1>
            <div class="user-info">
              <div class="discord-user">
                <span class="discord-avatar">👤</span>
                <div>
                  <div class="username">${profile.discordUsername}</div>
                  <div class="discord-id">${profile.discordId}</div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div class="dashboard-grid">
          <!-- Security Score -->
          <div class="security-score-card">
            <div class="score-circle ${getScoreClass(securityScore)}">
              <span class="score-number">${securityScore}</span>
              <span class="score-label">/100</span>
            </div>
            <div class="score-details">
              <h3>Security Score</h3>
              <p class="score-status ${getScoreClass(securityScore)}">${getScoreStatus(securityScore)}</p>
              <div class="score-breakdown">
                <div class="breakdown-item complete">
                  <span class="icon">✅</span>
                  <span>Discord OAuth Connected</span>
                  <span class="points">+30</span>
                </div>
                <div class="breakdown-item ${profile.discordHas2FA ? 'complete' : 'incomplete'}">
                  <span class="icon">${profile.discordHas2FA ? '✅' : '❌'}</span>
                  <span>Discord 2FA Enabled</span>
                  <span class="points">+25</span>
                </div>
                <div class="breakdown-item ${profile.adminHas2FA ? 'complete' : 'incomplete'}">
                  <span class="icon">${profile.adminHas2FA ? '✅' : '❌'}</span>
                  <span>Admin Panel 2FA</span>
                  <span class="points">+20</span>
                </div>
                <div class="breakdown-item ${profile.hasActiveApiKeys ? 'complete' : 'incomplete'}">
                  <span class="icon">${profile.hasActiveApiKeys ? '✅' : '❌'}</span>
                  <span>API Keys Managed</span>
                  <span class="points">+10</span>
                </div>
                <div class="breakdown-item ${profile.hasRecentSessions && profile.suspiciousActivity === 0 ? 'complete' : 'incomplete'}">
                  <span class="icon">${profile.hasRecentSessions && profile.suspiciousActivity === 0 ? '✅' : '❌'}</span>
                  <span>Clean Session History</span>
                  <span class="points">+15</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Discord Actions -->
          <div class="card">
            <h3>🔐 Security Actions</h3>
            <div class="actions-grid">
              <a href="https://discord.com/channels/@me" class="action-button primary" target="_blank">
                <div class="action-icon">🔗</div>
                <div class="action-content">
                  <h4>Discord Settings</h4>
                  <p>Manage Discord 2FA & security</p>
                </div>
              </a>
              <a href="/admin/2fa-setup" class="action-button ${profile.adminHas2FA ? 'complete' : 'secondary'}">
                <div class="action-icon">🔒</div>
                <div class="action-content">
                  <h4>Admin Panel 2FA</h4>
                  <p>${profile.adminHas2FA ? 'Enabled' : 'Setup required'}</p>
                </div>
              </a>
              <a href="/admin/api-keys" class="action-button secondary">
                <div class="action-icon">🗝️</div>
                <div class="action-content">
                  <h4>API Keys</h4>
                  <p>${apiKeyStats.totalKeys} keys managed</p>
                </div>
              </a>
              <a href="/security/sessions" class="action-button secondary">
                <div class="action-icon">📱</div>
                <div class="action-content">
                  <h4>Session History</h4>
                  <p>${profile.totalLogins} total logins</p>
                </div>
              </a>
            </div>
          </div>

          <!-- Recent Sessions -->
          <div class="card">
            <h3>📱 Discord OAuth Sessions</h3>
            <div class="sessions-list">
              ${sessionHistory.map((session: any) => `
                <div class="session-item">
                  <div class="session-info">
                    <div class="session-location">${session.location}</div>
                    <div class="session-details">
                      ${session.userAgent} • ${session.ipAddress}
                    </div>
                    <div class="session-time">${formatTimeAgo(session.timestamp)}</div>
                  </div>
                  <div class="session-status ${session.status}">
                    ${session.status === 'active' ? '🟢 Active' : '⚫ Expired'}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- API Usage -->
          <div class="card">
            <h3>🗝️ API Key Usage</h3>
            <div class="api-stats">
              <div class="stat-item">
                <div class="stat-value">${apiKeyStats.totalKeys}</div>
                <div class="stat-label">Total Keys</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${apiKeyStats.activeKeys}</div>
                <div class="stat-label">Active Keys</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${apiKeyStats.totalRequests.toLocaleString()}</div>
                <div class="stat-label">Total Requests</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${apiKeyStats.lastUsed ? formatTimeAgo(apiKeyStats.lastUsed) : 'Never'}</div>
                <div class="stat-label">Last Used</div>
              </div>
            </div>
          </div>

          <!-- Security Alerts -->
          <div class="card">
            <h3>🚨 Security Alerts</h3>
            <div class="alerts-summary">
              <div class="alert-stat">
                <span class="alert-count ${unresolvedIncidents.length > 0 ? 'warning' : 'success'}">${unresolvedIncidents.length}</span>
                <span>Unresolved</span>
              </div>
              <div class="alert-stat">
                <span class="alert-count">${recentIncidents.length}</span>
                <span>Recent</span>
              </div>
            </div>
            <div class="incidents-list">
              ${recentIncidents.slice(0, 3).map((incident: any) => `
                <div class="incident-item ${incident.severity}">
                  <div class="incident-icon">${getIncidentIcon(incident.type)}</div>
                  <div class="incident-content">
                    <div class="incident-title">${incident.userMessage}</div>
                    <div class="incident-time">${formatTimeAgo(new Date(incident.timestamp))}</div>
                  </div>
                  <div class="incident-status ${incident.resolved ? 'resolved' : 'unresolved'}">
                    ${incident.resolved ? '✅' : '⚠️'}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <script>
        ${getDiscordSecurityScript()}
      </script>
    </body>
    </html>
  `;
}

function getDiscordSecurityStyles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      color: #333;
    }

    .dashboard-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }

    .dashboard-header {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 30px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .dashboard-header h1 {
      color: #4f46e5;
      font-size: 2rem;
      font-weight: 700;
    }

    .discord-user {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .discord-avatar {
      width: 48px;
      height: 48px;
      background: #5865f2;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    .username {
      font-weight: 600;
      color: #1f2937;
    }

    .discord-id {
      font-size: 0.875rem;
      color: #6b7280;
      font-family: monospace;
    }

    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 24px;
    }

    .card {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .card h3 {
      margin-bottom: 20px;
      color: #1f2937;
      font-size: 1.25rem;
    }

    .security-score-card {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      align-items: center;
      gap: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .score-circle {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border: 6px solid;
    }

    .score-circle.excellent { border-color: #10b981; background: rgba(16, 185, 129, 0.1); }
    .score-circle.good { border-color: #f59e0b; background: rgba(245, 158, 11, 0.1); }
    .score-circle.needs-improvement { border-color: #ef4444; background: rgba(239, 68, 68, 0.1); }

    .score-number {
      font-size: 2.5rem;
      font-weight: 700;
      color: #1f2937;
    }

    .score-label {
      font-size: 1rem;
      color: #6b7280;
    }

    .score-breakdown {
      margin-top: 16px;
    }

    .breakdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      border-bottom: 1px solid #f3f4f6;
    }

    .breakdown-item:last-child {
      border-bottom: none;
    }

    .breakdown-item.complete {
      color: #10b981;
    }

    .breakdown-item.incomplete {
      color: #ef4444;
    }

    .points {
      margin-left: auto;
      font-weight: 600;
      font-size: 0.875rem;
    }

    .actions-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }

    .action-button {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      border-radius: 8px;
      text-decoration: none;
      transition: all 0.2s;
      border: 2px solid transparent;
    }

    .action-button.primary {
      background: #5865f2;
      color: white;
    }

    .action-button.secondary {
      background: #f8fafc;
      color: #374151;
      border-color: #e5e7eb;
    }

    .action-button.complete {
      background: #dcfce7;
      color: #166534;
      border-color: #bbf7d0;
    }

    .action-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .action-icon {
      font-size: 24px;
    }

    .action-content h4 {
      font-size: 1rem;
      margin-bottom: 4px;
    }

    .action-content p {
      font-size: 0.875rem;
      opacity: 0.8;
    }

    .sessions-list, .incidents-list {
      space-y: 12px;
    }

    .session-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      background: #f8fafc;
      border-radius: 8px;
      margin-bottom: 12px;
    }

    .session-location {
      font-weight: 600;
      color: #1f2937;
    }

    .session-details {
      font-size: 0.875rem;
      color: #6b7280;
      margin: 4px 0;
    }

    .session-time {
      font-size: 0.75rem;
      color: #9ca3af;
    }

    .session-status.active {
      color: #10b981;
      font-weight: 600;
    }

    .session-status.expired {
      color: #6b7280;
    }

    .api-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 16px;
    }

    .stat-item {
      text-align: center;
      padding: 16px;
      background: #f8fafc;
      border-radius: 8px;
    }

    .stat-value {
      font-size: 1.875rem;
      font-weight: 700;
      color: #1f2937;
    }

    .stat-label {
      font-size: 0.875rem;
      color: #6b7280;
      margin-top: 4px;
    }

    .alerts-summary {
      display: flex;
      gap: 24px;
      margin-bottom: 20px;
    }

    .alert-stat {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .alert-count {
      background: #f3f4f6;
      color: #374151;
      padding: 4px 12px;
      border-radius: 20px;
      font-weight: 600;
    }

    .alert-count.warning {
      background: #fef3c7;
      color: #d97706;
    }

    .alert-count.success {
      background: #dcfce7;
      color: #166534;
    }

    .incident-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background: #f8fafc;
      border-radius: 8px;
      margin-bottom: 12px;
    }

    .incident-item.warning {
      border-left: 4px solid #f59e0b;
    }

    .incident-item.high {
      border-left: 4px solid #ef4444;
    }

    .incident-icon {
      font-size: 20px;
    }

    .incident-title {
      font-weight: 600;
      color: #1f2937;
    }

    .incident-time {
      font-size: 0.875rem;
      color: #6b7280;
    }

    .incident-status {
      margin-left: auto;
    }

    @media (max-width: 768px) {
      .dashboard-grid {
        grid-template-columns: 1fr;
      }

      .security-score-card {
        flex-direction: column;
        text-align: center;
      }

      .actions-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
}

function getScoreClass(score: number): string {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  return 'needs-improvement';
}

function getScoreStatus(score: number): string {
  if (score >= 80) return 'Excellent Security';
  if (score >= 60) return 'Good Security';
  return 'Needs Improvement';
}

function getIncidentIcon(type: string): string {
  const icons: Record<string, string> = {
    'session_hijack': '🔓',
    'brute_force': '🔨',
    'anomaly_detected': '⚠️',
    'suspicious_transaction': '💰',
    'account_locked': '🔒',
    'password_change': '🔑',
    '2fa_enabled': '🔐',
    '2fa_disabled': '🚨'
  };
  return icons[type] || '❓';
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
}

function getDiscordSecurityScript(): string {
  return `
    // Auto-refresh every 30 seconds
    setTimeout(() => {
      location.reload();
    }, 30000);

    // Add click animations
    document.querySelectorAll('.action-button').forEach(button => {
      button.addEventListener('click', (e) => {
        button.style.transform = 'scale(0.95)';
        setTimeout(() => {
          button.style.transform = '';
        }, 150);
      });
    });
  `;
}