// src/web/admin/js/channels.js - Channel management module
import { makeAuthenticatedRequest } from './core.js';

let currentChannelSettings = [];
let selectedGuildId = null;

export async function loadChannelSettings() {
  console.log("🔧 Loading channel settings...");

  try {
    const data = await makeAuthenticatedRequest('/admin/channels');
    if (!data.ok) {
      throw new Error(data.error);
    }

    currentChannelSettings = data.settings;
    renderChannelSettingsTable();
    updateChannelOverview();

    console.log(`✅ Loaded ${data.settings.length} channel settings`);
  } catch (error) {
    console.error("❌ Failed to load channel settings:", error);
    const msg = document.getElementById('channelsMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to load channel settings: ${error.message}</span>`;
    }
  }
}

function renderChannelSettingsTable() {
  const tbody = document.querySelector('#channelsTbl tbody');
  if (!tbody) {
    console.warn("Channels table not found, skipping render");
    return;
  }

  tbody.innerHTML = '';
  currentChannelSettings.forEach(setting => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${setting.guildId}</td>
      <td>${setting.servername}</td>
      <td>
        <span class="channel-mode ${setting.channelMode.toLowerCase()}">${getModeDisplay(setting.channelMode)}</span>
      </td>
      <td>${setting.allowedChannels.length}</td>
      <td>${setting.blockedChannels.length}</td>
      <td>${setting.tipChannels.length}</td>
      <td>${setting.gameChannels.length}</td>
      <td>
        <button onclick="viewChannelDetails('${setting.guildId}')" class="btn-primary">📋 Details</button>
        <button onclick="editChannelSettings('${setting.guildId}')" class="btn-secondary">⚙️ Edit</button>
        <button onclick="resetChannelSettings('${setting.guildId}')" class="btn-danger">🔄 Reset</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function getModeDisplay(mode) {
  switch (mode) {
    case 'ALLOW_ALL': return '🌐 Allow All';
    case 'WHITELIST': return '✅ Whitelist';
    case 'BLACKLIST': return '🚫 Blacklist';
    default: return mode;
  }
}

export async function viewChannelDetails(guildId) {
  console.log(`📋 Loading details for guild ${guildId}`);

  try {
    const data = await makeAuthenticatedRequest(`/admin/channels/${guildId}`);
    if (!data.ok) {
      throw new Error(data.error);
    }

    selectedGuildId = guildId;
    renderChannelDetails(data.settings);
    showChannelDetailsModal();
  } catch (error) {
    console.error("❌ Failed to load channel details:", error);
    alert(`Failed to load channel details: ${error.message}`);
  }
}

function renderChannelDetails(settings) {
  const detailsContainer = document.getElementById('channelDetailsContent');
  if (!detailsContainer) return;

  detailsContainer.innerHTML = `
    <div class="channel-details">
      <h3>📋 ${settings.servername} (${settings.guildId})</h3>

      <div class="detail-section">
        <h4>🔧 Channel Mode</h4>
        <div class="mode-display ${settings.channelMode.toLowerCase()}">
          ${getModeDisplay(settings.channelMode)}
        </div>
        <p class="mode-description">${getModeDescription(settings.channelMode)}</p>
      </div>

      <div class="detail-section">
        <h4>📝 Channel Lists</h4>
        <div class="channel-lists">
          <div class="channel-list">
            <strong>✅ Allowed Channels (${settings.allowedChannels.length}):</strong>
            <div class="channel-ids">${settings.allowedChannels.join(', ') || 'None'}</div>
          </div>
          <div class="channel-list">
            <strong>🚫 Blocked Channels (${settings.blockedChannels.length}):</strong>
            <div class="channel-ids">${settings.blockedChannels.join(', ') || 'None'}</div>
          </div>
          <div class="channel-list">
            <strong>💸 Tip Channels (${settings.tipChannels.length}):</strong>
            <div class="channel-ids">${settings.tipChannels.join(', ') || 'All allowed channels'}</div>
          </div>
          <div class="channel-list">
            <strong>🎮 Game Channels (${settings.gameChannels.length}):</strong>
            <div class="channel-ids">${settings.gameChannels.join(', ') || 'All allowed channels'}</div>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h4>📢 Special Channels</h4>
        <p><strong>Announcement Channel:</strong> ${settings.announcementChannel || 'Not set'}</p>
      </div>

      <div class="detail-section">
        <h4>⚡ Advanced Settings</h4>
        <p><strong>Auto-suggest Channels:</strong> ${settings.autoSuggestChannels ? '✅ Enabled' : '❌ Disabled'}</p>
        <p><strong>Per-channel Cooldowns:</strong> ${Object.keys(settings.perChannelCooldowns || {}).length} configured</p>
        <p><strong>Feature Restrictions:</strong> ${Object.keys(settings.featureRestrictions || {}).length} configured</p>
      </div>

      <div class="detail-actions">
        <button onclick="loadChannelActivity('${settings.guildId}')" class="btn-info">📊 View Activity</button>
        <button onclick="exportChannelConfig('${settings.guildId}')" class="btn-secondary">📄 Export Config</button>
      </div>
    </div>
  `;
}

function getModeDescription(mode) {
  switch (mode) {
    case 'ALLOW_ALL':
      return 'PIPTip works in all channels (except those specifically blocked)';
    case 'WHITELIST':
      return 'PIPTip only works in channels that have been specifically allowed';
    case 'BLACKLIST':
      return 'PIPTip works everywhere except channels that have been blocked';
    default:
      return 'Unknown mode';
  }
}

export async function editChannelSettings(guildId) {
  console.log(`⚙️ Editing settings for guild ${guildId}`);

  try {
    const data = await makeAuthenticatedRequest(`/admin/channels/${guildId}`);
    if (!data.ok) {
      throw new Error(data.error);
    }

    selectedGuildId = guildId;
    renderChannelEditForm(data.settings);
    showChannelEditModal();
  } catch (error) {
    console.error("❌ Failed to load channel settings for editing:", error);
    alert(`Failed to load channel settings: ${error.message}`);
  }
}

function renderChannelEditForm(settings) {
  const editContainer = document.getElementById('channelEditContent');
  if (!editContainer) return;

  editContainer.innerHTML = `
    <div class="channel-edit-form">
      <h3>⚙️ Edit Settings for ${settings.servername}</h3>

      <div class="form-group">
        <label for="channelMode">Channel Mode:</label>
        <select id="channelMode" value="${settings.channelMode}">
          <option value="ALLOW_ALL" ${settings.channelMode === 'ALLOW_ALL' ? 'selected' : ''}>🌐 Allow All</option>
          <option value="WHITELIST" ${settings.channelMode === 'WHITELIST' ? 'selected' : ''}>✅ Whitelist</option>
          <option value="BLACKLIST" ${settings.channelMode === 'BLACKLIST' ? 'selected' : ''}>🚫 Blacklist</option>
        </select>
      </div>

      <div class="form-group">
        <label for="allowedChannels">Allowed Channels (comma-separated IDs):</label>
        <textarea id="allowedChannels" rows="3" placeholder="Enter channel IDs separated by commas">${settings.allowedChannels.join(', ')}</textarea>
      </div>

      <div class="form-group">
        <label for="blockedChannels">Blocked Channels (comma-separated IDs):</label>
        <textarea id="blockedChannels" rows="3" placeholder="Enter channel IDs separated by commas">${settings.blockedChannels.join(', ')}</textarea>
      </div>

      <div class="form-group">
        <label for="tipChannels">Tip Channels (comma-separated IDs):</label>
        <textarea id="tipChannels" rows="2" placeholder="Leave empty to use all allowed channels">${settings.tipChannels.join(', ')}</textarea>
      </div>

      <div class="form-group">
        <label for="gameChannels">Game Channels (comma-separated IDs):</label>
        <textarea id="gameChannels" rows="2" placeholder="Leave empty to use all allowed channels">${settings.gameChannels.join(', ')}</textarea>
      </div>

      <div class="form-group">
        <label for="announcementChannel">Announcement Channel ID:</label>
        <input type="text" id="announcementChannel" value="${settings.announcementChannel || ''}" placeholder="Enter single channel ID">
      </div>

      <div class="form-group">
        <label>
          <input type="checkbox" id="autoSuggestChannels" ${settings.autoSuggestChannels ? 'checked' : ''}>
          Auto-suggest channels when commands are blocked
        </label>
      </div>

      <div class="form-actions">
        <button onclick="saveChannelSettings()" class="btn-primary">💾 Save Changes</button>
        <button onclick="previewChannelChanges()" class="btn-info">👁️ Preview Changes</button>
        <button onclick="closeChannelEditModal()" class="btn-secondary">❌ Cancel</button>
      </div>
    </div>
  `;
}

export async function saveChannelSettings() {
  if (!selectedGuildId) return;

  console.log(`💾 Saving settings for guild ${selectedGuildId}`);

  try {
    const formData = {
      channelMode: document.getElementById('channelMode').value,
      allowedChannels: parseChannelIds('allowedChannels'),
      blockedChannels: parseChannelIds('blockedChannels'),
      tipChannels: parseChannelIds('tipChannels'),
      gameChannels: parseChannelIds('gameChannels'),
      announcementChannel: document.getElementById('announcementChannel').value || undefined,
      autoSuggestChannels: document.getElementById('autoSuggestChannels').checked
    };

    const data = await makeAuthenticatedRequest(`/admin/channels/${selectedGuildId}`, {
      method: 'PUT',
      body: JSON.stringify(formData)
    });

    if (!data.ok) {
      throw new Error(data.error);
    }

    alert('✅ Channel settings saved successfully!');
    closeChannelEditModal();
    loadChannelSettings(); // Refresh the table
  } catch (error) {
    console.error("❌ Failed to save channel settings:", error);
    alert(`Failed to save settings: ${error.message}`);
  }
}

function parseChannelIds(elementId) {
  const element = document.getElementById(elementId);
  if (!element || !element.value.trim()) return [];

  return element.value
    .split(',')
    .map(id => id.trim())
    .filter(id => id && /^[0-9]+$/.test(id));
}

export async function resetChannelSettings(guildId) {
  if (!confirm(`Are you sure you want to reset channel settings for this guild? This will clear all restrictions and set mode to "Allow All".`)) {
    return;
  }

  console.log(`🔄 Resetting settings for guild ${guildId}`);

  try {
    const data = await makeAuthenticatedRequest(`/admin/channels/${guildId}/reset`, {
      method: 'POST'
    });

    if (!data.ok) {
      throw new Error(data.error);
    }

    alert('✅ Channel settings reset successfully!');
    loadChannelSettings(); // Refresh the table
  } catch (error) {
    console.error("❌ Failed to reset channel settings:", error);
    alert(`Failed to reset settings: ${error.message}`);
  }
}

export async function loadChannelActivity(guildId, hours = 24) {
  console.log(`📊 Loading activity for guild ${guildId}`);

  try {
    const data = await makeAuthenticatedRequest(`/admin/channels/${guildId}/activity?hours=${hours}`);
    if (!data.ok) {
      throw new Error(data.error);
    }

    renderChannelActivity(data.activity, guildId, hours);
    showChannelActivityModal();
  } catch (error) {
    console.error("❌ Failed to load channel activity:", error);
    alert(`Failed to load activity: ${error.message}`);
  }
}

function renderChannelActivity(activity, guildId, hours) {
  const activityContainer = document.getElementById('channelActivityContent');
  if (!activityContainer) return;

  const channelStats = Object.entries(activity.channelStats || {})
    .sort(([,a], [,b]) => b.count - a.count)
    .slice(0, 10);

  activityContainer.innerHTML = `
    <div class="channel-activity">
      <h3>📊 Channel Activity - Last ${hours} Hours</h3>
      <div class="guild-info">Guild ID: ${guildId}</div>

      <div class="activity-summary">
        <div class="summary-item">
          <div class="summary-value">${activity.totalCommands}</div>
          <div class="summary-label">Total Commands</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${Object.keys(activity.channelStats || {}).length}</div>
          <div class="summary-label">Active Channels</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${activity.popularCommands[0]?.command || 'None'}</div>
          <div class="summary-label">Most Popular</div>
        </div>
      </div>

      <div class="activity-section">
        <h4>🔥 Most Active Channels</h4>
        <div class="activity-table">
          <table>
            <thead>
              <tr>
                <th>Channel ID</th>
                <th>Commands</th>
                <th>Success Rate</th>
              </tr>
            </thead>
            <tbody>
              ${channelStats.map(([channelId, stats]) => `
                <tr>
                  <td>${channelId}</td>
                  <td>${stats.count}</td>
                  <td>${Math.round((stats.success / stats.count) * 100)}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="activity-section">
        <h4>⭐ Popular Commands</h4>
        <div class="command-list">
          ${activity.popularCommands.slice(0, 5).map(cmd => `
            <div class="command-item">
              <span class="command-name">${cmd.command}</span>
              <span class="command-count">${cmd.count} uses</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="activity-actions">
        <button onclick="loadChannelActivity('${guildId}', 168)" class="btn-info">📅 7 Days</button>
        <button onclick="loadChannelActivity('${guildId}', 24)" class="btn-info">📅 24 Hours</button>
        <button onclick="exportActivityData('${guildId}')" class="btn-secondary">📄 Export</button>
      </div>
    </div>
  `;
}

async function updateChannelOverview() {
  try {
    const data = await makeAuthenticatedRequest('/admin/channels/stats/overview');
    if (!data.ok) return;

    const overviewContainer = document.getElementById('channelOverview');
    if (!overviewContainer) return;

    const stats = data.stats;
    overviewContainer.innerHTML = `
      <div class="overview-stats">
        <div class="stat-item">
          <div class="stat-value">${stats.totalGuilds}</div>
          <div class="stat-label">Total Guilds</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${stats.settingsByMode.ALLOW_ALL || 0}</div>
          <div class="stat-label">Allow All</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${stats.settingsByMode.WHITELIST || 0}</div>
          <div class="stat-label">Whitelist</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${stats.settingsByMode.BLACKLIST || 0}</div>
          <div class="stat-label">Blacklist</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${stats.recentActivity}</div>
          <div class="stat-label">Recent Activity</div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error("Failed to update channel overview:", error);
  }
}

// Modal management functions
function showChannelDetailsModal() {
  const modal = document.getElementById('channelDetailsModal');
  if (modal) modal.style.display = 'block';
}

function showChannelEditModal() {
  const modal = document.getElementById('channelEditModal');
  if (modal) modal.style.display = 'block';
}

function showChannelActivityModal() {
  const modal = document.getElementById('channelActivityModal');
  if (modal) modal.style.display = 'block';
}

export function closeChannelDetailsModal() {
  const modal = document.getElementById('channelDetailsModal');
  if (modal) modal.style.display = 'none';
}

export function closeChannelEditModal() {
  const modal = document.getElementById('channelEditModal');
  if (modal) modal.style.display = 'none';
}

export function closeChannelActivityModal() {
  const modal = document.getElementById('channelActivityModal');
  if (modal) modal.style.display = 'none';
}

// Initialize channel management
export function initChannelsSection() {
  console.log("🔧 Initializing channels section");

  // Add global functions to window for onclick handlers
  window.viewChannelDetails = viewChannelDetails;
  window.editChannelSettings = editChannelSettings;
  window.resetChannelSettings = resetChannelSettings;
  window.saveChannelSettings = saveChannelSettings;
  window.loadChannelActivity = loadChannelActivity;
  window.closeChannelDetailsModal = closeChannelDetailsModal;
  window.closeChannelEditModal = closeChannelEditModal;
  window.closeChannelActivityModal = closeChannelActivityModal;

  // Load initial data
  if (document.querySelector('#channelsTbl')) {
    loadChannelSettings();
  }
}

// Auto-initialize when module loads
if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initChannelsSection);
}