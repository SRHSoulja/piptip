import express from "express";
import { prisma } from "../services/db.js";
import { findOrCreateUser } from "../services/user_helpers.js";
const securityDashboardRouter = express.Router();
securityDashboardRouter.get("/:discordId", async (req, res) => {
  try {
    const { discordId } = req.params;
    const user = await findOrCreateUser(discordId);
    const securityProfile = await getUserSecurityProfile(discordId);
    const securityScore = calculateSecurityScore(securityProfile);
    const recentEvents = await getRecentSecurityEvents(discordId);
    res.send(renderSecurityDashboard({
      user,
      securityProfile,
      securityScore,
      recentEvents,
      discordId
    }));
  } catch (error) {
    console.error("Security dashboard error:", error);
    res.status(500).send("Security dashboard unavailable");
  }
});
async function getUserSecurityProfile(discordId) {
  const user = await prisma.user.findFirst({
    where: { discordId }
  });
  const has2FA = false;
  const hasStrongPassword = true;
  const hasBackupCodes = false;
  const lastPasswordChange = new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3);
  const suspiciousActivityCount = 0;
  const activeSessions = 1;
  const trustedDevices = 2;
  return {
    has2FA,
    hasStrongPassword,
    hasBackupCodes,
    lastPasswordChange,
    suspiciousActivityCount,
    activeSessions,
    trustedDevices,
    accountAge: user ? Math.floor((Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1e3)) : 0
  };
}
function calculateSecurityScore(profile) {
  let score = 0;
  score += 20;
  if (profile.has2FA) score += 30;
  if (profile.hasStrongPassword) score += 15;
  if (profile.hasBackupCodes) score += 10;
  const daysSincePasswordChange = Math.floor((Date.now() - profile.lastPasswordChange.getTime()) / (24 * 60 * 60 * 1e3));
  if (daysSincePasswordChange < 90) score += 10;
  if (profile.suspiciousActivityCount === 0) score += 10;
  if (profile.accountAge > 30) score += 5;
  return Math.min(score, 100);
}
async function getRecentSecurityEvents(discordId) {
  return [
    {
      type: "login",
      description: "Successful login from Discord",
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1e3),
      severity: "info"
    },
    {
      type: "tip",
      description: "Large tip sent (1000 PENGUIN)",
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1e3),
      severity: "info"
    }
  ];
}
function renderSecurityDashboard(data) {
  const { user, securityProfile, securityScore, recentEvents, discordId } = data;
  let securityLevel = "Critical";
  let securityColor = "#ff4444";
  let progressBarClass = "critical";
  if (securityScore >= 80) {
    securityLevel = "Excellent";
    securityColor = "#00c851";
    progressBarClass = "excellent";
  } else if (securityScore >= 60) {
    securityLevel = "Good";
    securityColor = "#33b5e5";
    progressBarClass = "good";
  } else if (securityScore >= 40) {
    securityLevel = "Fair";
    securityColor = "#ffbb33";
    progressBarClass = "fair";
  }
  const recommendations = getSecurityRecommendations(securityProfile);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Dashboard - PIPTip</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      color: white;
      margin-bottom: 30px;
    }

    .header h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }

    .header p {
      opacity: 0.9;
      font-size: 1.1em;
    }

    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .card {
      background: white;
      border-radius: 15px;
      padding: 25px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }

    .card:hover {
      transform: translateY(-5px);
      box-shadow: 0 15px 40px rgba(0, 0, 0, 0.15);
    }

    .security-score-card {
      grid-column: span 2;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    .score-display {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 20px 0;
    }

    .score-circle {
      width: 180px;
      height: 180px;
      border-radius: 50%;
      background: conic-gradient(
        ${securityColor} 0deg ${securityScore * 3.6}deg,
        rgba(255, 255, 255, 0.2) ${securityScore * 3.6}deg 360deg
      );
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .score-circle::before {
      content: '';
      position: absolute;
      width: 150px;
      height: 150px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .score-value {
      position: relative;
      font-size: 3em;
      font-weight: bold;
      z-index: 1;
    }

    .score-label {
      text-align: center;
      margin-top: 15px;
    }

    .score-label h2 {
      font-size: 1.8em;
      margin-bottom: 5px;
    }

    .score-label p {
      opacity: 0.9;
    }

    .security-status {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      margin-top: 20px;
    }

    .status-item {
      padding: 15px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .status-icon {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .status-icon.enabled {
      color: #00c851;
    }

    .status-icon.disabled {
      color: #ffbb33;
    }

    .status-text {
      flex: 1;
    }

    .status-text .label {
      font-size: 0.9em;
      opacity: 0.8;
    }

    .status-text .value {
      font-weight: 600;
    }

    .quick-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .action-button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 15px;
      background: #f8f9fa;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.3s ease;
      text-decoration: none;
      color: #333;
    }

    .action-button:hover {
      background: #e9ecef;
    }

    .action-button.primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    .action-button.primary:hover {
      opacity: 0.9;
    }

    .action-text {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .badge {
      padding: 3px 8px;
      background: #28a745;
      color: white;
      border-radius: 12px;
      font-size: 0.75em;
      font-weight: 600;
    }

    .badge.warning {
      background: #ffc107;
    }

    .badge.danger {
      background: #dc3545;
    }

    .recent-activity {
      max-height: 300px;
      overflow-y: auto;
    }

    .activity-item {
      display: flex;
      align-items: start;
      gap: 15px;
      padding: 15px 0;
      border-bottom: 1px solid #e9ecef;
    }

    .activity-item:last-child {
      border-bottom: none;
    }

    .activity-icon {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .activity-icon.info {
      background: #e3f2fd;
      color: #2196f3;
    }

    .activity-icon.warning {
      background: #fff3e0;
      color: #ff9800;
    }

    .activity-icon.danger {
      background: #ffebee;
      color: #f44336;
    }

    .activity-details {
      flex: 1;
    }

    .activity-title {
      font-weight: 600;
      margin-bottom: 3px;
    }

    .activity-time {
      font-size: 0.85em;
      color: #666;
    }

    .recommendations {
      background: #fff3cd;
      border: 1px solid #ffc107;
      padding: 15px;
      border-radius: 10px;
      margin-top: 15px;
    }

    .recommendations h4 {
      color: #856404;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .recommendations ul {
      margin: 0;
      padding-left: 20px;
      color: #856404;
    }

    .recommendations li {
      margin: 5px 0;
    }

    .progress-bar {
      height: 8px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 20px;
    }

    .progress-fill {
      height: 100%;
      background: ${securityColor};
      width: ${securityScore}%;
      transition: width 1s ease;
    }

    .shield-icon {
      font-size: 1.2em;
    }

    @media (max-width: 768px) {
      .dashboard-grid {
        grid-template-columns: 1fr;
      }

      .security-score-card {
        grid-column: span 1;
      }

      .security-status {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>
        <span class="shield-icon">\u{1F6E1}\uFE0F</span>
        Security Dashboard
      </h1>
      <p>Manage your PIPTip account security and privacy</p>
    </div>

    <div class="dashboard-grid">
      <!-- Security Score Card -->
      <div class="card security-score-card">
        <div class="score-display">
          <div class="score-circle">
            <div class="score-value">${securityScore}</div>
          </div>
        </div>
        <div class="score-label">
          <h2>Security Score: ${securityLevel}</h2>
          <p>Your account protection level</p>
        </div>
        <div class="progress-bar">
          <div class="progress-fill"></div>
        </div>

        <div class="security-status">
          <div class="status-item">
            <div class="status-icon ${securityProfile.has2FA ? "enabled" : "disabled"}">
              ${securityProfile.has2FA ? "\u2705" : "\u26A0\uFE0F"}
            </div>
            <div class="status-text">
              <div class="label">Two-Factor Auth</div>
              <div class="value">${securityProfile.has2FA ? "Enabled" : "Not Set"}</div>
            </div>
          </div>

          <div class="status-item">
            <div class="status-icon ${securityProfile.hasStrongPassword ? "enabled" : "disabled"}">
              ${securityProfile.hasStrongPassword ? "\u2705" : "\u26A0\uFE0F"}
            </div>
            <div class="status-text">
              <div class="label">Password Strength</div>
              <div class="value">${securityProfile.hasStrongPassword ? "Strong" : "Weak"}</div>
            </div>
          </div>

          <div class="status-item">
            <div class="status-icon enabled">
              \u{1F510}
            </div>
            <div class="status-text">
              <div class="label">Active Sessions</div>
              <div class="value">${securityProfile.activeSessions}</div>
            </div>
          </div>

          <div class="status-item">
            <div class="status-icon enabled">
              \u{1F4F1}
            </div>
            <div class="status-text">
              <div class="label">Trusted Devices</div>
              <div class="value">${securityProfile.trustedDevices}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="card">
        <h3 style="margin-bottom: 20px;">Quick Actions</h3>
        <div class="quick-actions">
          <button class="action-button primary" onclick="setup2FA()">
            <span class="action-text">
              <span>\u{1F510}</span>
              <span>Enable Two-Factor Authentication</span>
            </span>
            <span class="badge">+30 pts</span>
          </button>

          <button class="action-button" onclick="changePassword()">
            <span class="action-text">
              <span>\u{1F511}</span>
              <span>Change Password</span>
            </span>
            <span>\u2192</span>
          </button>

          <button class="action-button" onclick="viewSessions()">
            <span class="action-text">
              <span>\u{1F4BB}</span>
              <span>Manage Sessions</span>
            </span>
            <span>\u2192</span>
          </button>

          <button class="action-button" onclick="downloadData()">
            <span class="action-text">
              <span>\u{1F4E5}</span>
              <span>Download My Data</span>
            </span>
            <span>\u2192</span>
          </button>

          <button class="action-button" onclick="privacySettings()">
            <span class="action-text">
              <span>\u{1F512}</span>
              <span>Privacy Settings</span>
            </span>
            <span>\u2192</span>
          </button>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="card">
        <h3 style="margin-bottom: 20px;">Recent Activity</h3>
        <div class="recent-activity">
          ${recentEvents.map((event) => `
            <div class="activity-item">
              <div class="activity-icon ${event.severity}">
                ${getActivityIcon(event.type)}
              </div>
              <div class="activity-details">
                <div class="activity-title">${event.description}</div>
                <div class="activity-time">${formatTimeAgo(event.timestamp)}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Security Recommendations -->
      <div class="card">
        <h3 style="margin-bottom: 20px;">Security Recommendations</h3>
        ${recommendations.length > 0 ? `
          <div class="recommendations">
            <h4>\u26A0\uFE0F Action Required</h4>
            <ul>
              ${recommendations.map((rec) => `<li>${rec}</li>`).join("")}
            </ul>
          </div>
        ` : `
          <div style="padding: 20px; text-align: center; background: #d4edda; border-radius: 10px; color: #155724;">
            <div style="font-size: 2em; margin-bottom: 10px;">\u2705</div>
            <div style="font-weight: 600;">All security features enabled!</div>
            <div style="margin-top: 5px; font-size: 0.9em;">Your account is well protected</div>
          </div>
        `}

        <div style="margin-top: 20px;">
          <h4 style="margin-bottom: 10px;">Security Tips</h4>
          <ul style="list-style: none; padding: 0;">
            <li style="padding: 8px 0; display: flex; align-items: start; gap: 8px;">
              <span>\u{1F4A1}</span>
              <span>Use a unique password for your PIPTip account</span>
            </li>
            <li style="padding: 8px 0; display: flex; align-items: start; gap: 8px;">
              <span>\u{1F4A1}</span>
              <span>Enable notifications for suspicious activities</span>
            </li>
            <li style="padding: 8px 0; display: flex; align-items: start; gap: 8px;">
              <span>\u{1F4A1}</span>
              <span>Review your connected apps regularly</span>
            </li>
            <li style="padding: 8px 0; display: flex; align-items: start; gap: 8px;">
              <span>\u{1F4A1}</span>
              <span>Keep your recovery email up to date</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>

  <script>
    function setup2FA() {
      window.location.href = '/security/2fa-setup/${discordId}';
    }

    function changePassword() {
      window.location.href = '/security/password/${discordId}';
    }

    function viewSessions() {
      window.location.href = '/security/sessions/${discordId}';
    }

    function downloadData() {
      if (confirm('This will prepare a download of all your PIPTip data. Continue?')) {
        window.location.href = '/security/export/${discordId}';
      }
    }

    function privacySettings() {
      window.location.href = '/security/privacy/${discordId}';
    }

    // Animate score on page load
    window.addEventListener('load', () => {
      const progressFill = document.querySelector('.progress-fill');
      setTimeout(() => {
        progressFill.style.width = '${securityScore}%';
      }, 100);
    });

    // Auto-refresh every 30 seconds
    setInterval(() => {
      window.location.reload();
    }, 30000);
  </script>
</body>
</html>`;
}
function getActivityIcon(type) {
  const icons = {
    login: "\u{1F513}",
    logout: "\u{1F512}",
    tip: "\u{1F4B0}",
    withdrawal: "\u{1F4B8}",
    deposit: "\u{1F4B3}",
    password_change: "\u{1F511}",
    "2fa_enabled": "\u{1F510}",
    suspicious: "\u26A0\uFE0F",
    blocked: "\u{1F6AB}"
  };
  return icons[type] || "\u{1F4DD}";
}
function formatTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1e3);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 2592e3) return `${Math.floor(seconds / 86400)} days ago`;
  return date.toLocaleDateString();
}
function getSecurityRecommendations(profile) {
  const recommendations = [];
  if (!profile.has2FA) {
    recommendations.push("Enable Two-Factor Authentication for maximum security");
  }
  if (!profile.hasStrongPassword) {
    recommendations.push("Update your password to meet strength requirements");
  }
  if (!profile.hasBackupCodes) {
    recommendations.push("Generate backup codes for account recovery");
  }
  const daysSincePasswordChange = Math.floor((Date.now() - profile.lastPasswordChange.getTime()) / (24 * 60 * 60 * 1e3));
  if (daysSincePasswordChange > 90) {
    recommendations.push("Consider changing your password (last changed " + daysSincePasswordChange + " days ago)");
  }
  if (profile.suspiciousActivityCount > 0) {
    recommendations.push("Review recent suspicious activities in your account");
  }
  return recommendations;
}
export {
  securityDashboardRouter
};
//# sourceMappingURL=security_dashboard.js.map
