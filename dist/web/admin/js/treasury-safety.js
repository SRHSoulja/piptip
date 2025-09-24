// src/web/admin/js/treasury-safety.js - Treasury safety management module
import { makeAuthenticatedRequest } from '/admin/core.js';

export async function loadTreasurySafety() {
  console.log("🏦 Loading treasury safety data...");

  try {
    const data = await makeAuthenticatedRequest('/admin/treasury-safety');
    if (!data.ok) {
      throw new Error(data.error);
    }

    // Update configuration form
    updateConfigurationForm(data.config);

    // Update safety status display
    updateSafetyStatus(data.safetyReport);

    // Update transfer history table
    updateTransferHistory(data.transferHistory);

    // Update pending transfers
    updatePendingTransfers(data.pendingTransfers);

    // Update active alerts
    updateActiveAlerts(data.activeAlerts);

    console.log("✅ Treasury safety data loaded");
  } catch (error) {
    console.error("❌ Failed to load treasury safety data:", error);
    const msg = document.getElementById('treasurySafetyMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to load treasury safety data: ${error.message}</span>`;
    }
  }
}

function updateConfigurationForm(config) {
  // Update form fields with current configuration
  const fields = [
    'treasuryMaxHoldingUSD',
    'treasuryWarningThresholdUSD',
    'coldWalletAddress',
    'treasuryCheckIntervalMins'
  ];

  fields.forEach(field => {
    const input = document.getElementById(field);
    if (input && config[field] !== undefined && config[field] !== null) {
      input.value = config[field];
    }
  });

  // Update checkboxes
  const monitoringCheckbox = document.getElementById('treasuryMonitoringEnabled');
  if (monitoringCheckbox) {
    monitoringCheckbox.checked = config.treasuryMonitoringEnabled || false;
  }

  const autoTransferCheckbox = document.getElementById('autoTransferEnabled');
  if (autoTransferCheckbox) {
    autoTransferCheckbox.checked = config.autoTransferEnabled || false;
  }
}

function updateSafetyStatus(report) {
  const statusContainer = document.getElementById('treasurySafetyStatus');
  if (!statusContainer || !report) {
    if (statusContainer) {
      statusContainer.innerHTML = '<p>Treasury monitoring is disabled or no data available.</p>';
    }
    return;
  }

  const statusColor = {
    'safe': '#10b981',
    'warning': '#f59e0b',
    'critical': '#ef4444'
  }[report.overallStatus] || '#6b7280';

  let html = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
      <div style="background: #333; padding: 15px; border-radius: 8px; border-left: 4px solid ${statusColor};">
        <h4 style="margin: 0 0 10px 0; color: ${statusColor};">Overall Status</h4>
        <div style="font-size: 1.2em; font-weight: bold; text-transform: uppercase;">${report.overallStatus}</div>
        <div style="font-size: 0.9em; color: #9ca3af; margin-top: 5px;">
          Last Check: ${new Date(report.timestamp).toLocaleString()}
        </div>
      </div>

      <div style="background: #333; padding: 15px; border-radius: 8px;">
        <h4 style="margin: 0 0 10px 0; color: #60a5fa;">Total Treasury Value</h4>
        <div style="font-size: 1.2em; font-weight: bold;">$${report.totalTreasuryUSD.toFixed(2)}</div>
        <div style="font-size: 0.9em; color: #9ca3af; margin-top: 5px;">
          ${report.tokenStatuses.length} tokens
        </div>
      </div>

      <div style="background: #333; padding: 15px; border-radius: 8px;">
        <h4 style="margin: 0 0 10px 0; color: #f59e0b;">Warnings</h4>
        <div style="font-size: 1.2em; font-weight: bold;">${report.warnings.length}</div>
        <div style="font-size: 0.9em; color: #9ca3af; margin-top: 5px;">
          Active warnings
        </div>
      </div>

      <div style="background: #333; padding: 15px; border-radius: 8px;">
        <h4 style="margin: 0 0 10px 0; color: #34d399;">Actions Required</h4>
        <div style="font-size: 1.2em; font-weight: bold;">${report.actions.length}</div>
        <div style="font-size: 0.9em; color: #9ca3af; margin-top: 5px;">
          Recommended actions
        </div>
      </div>
    </div>
  `;

  // Token status details
  if (report.tokenStatuses.length > 0) {
    html += '<h4 style="color: #60a5fa; margin: 20px 0 10px 0;">Token Status Details</h4>';
    html += '<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse;">';
    html += `
      <thead>
        <tr style="background: #374151;">
          <th style="padding: 10px; text-align: left; border: 1px solid #4b5563;">Token</th>
          <th style="padding: 10px; text-align: left; border: 1px solid #4b5563;">Balance</th>
          <th style="padding: 10px; text-align: left; border: 1px solid #4b5563;">USD Value</th>
          <th style="padding: 10px; text-align: left; border: 1px solid #4b5563;">Status</th>
          <th style="padding: 10px; text-align: left; border: 1px solid #4b5563;">Action</th>
        </tr>
      </thead>
      <tbody>
    `;

    report.tokenStatuses.forEach(token => {
      const statusColor = {
        'safe': '#10b981',
        'warning': '#f59e0b',
        'critical': '#ef4444'
      }[token.status];

      html += `
        <tr>
          <td style="padding: 10px; border: 1px solid #4b5563;">${token.tokenSymbol}</td>
          <td style="padding: 10px; border: 1px solid #4b5563;">${token.currentBalanceHuman.toFixed(2)}</td>
          <td style="padding: 10px; border: 1px solid #4b5563;">$${token.estimatedUSDValue.toFixed(2)}</td>
          <td style="padding: 10px; border: 1px solid #4b5563;">
            <span style="color: ${statusColor}; font-weight: bold; text-transform: uppercase;">
              ${token.status}
            </span>
          </td>
          <td style="padding: 10px; border: 1px solid #4b5563;">
            ${token.recommendedAction || 'None'}
            ${token.status === 'critical' && token.excessUSD ?
              `<br><button onclick="initiateTransfer(${token.tokenId}, ${token.excessUSD})"
                      style="background: #ef4444; color: white; border: none; padding: 5px 10px; border-radius: 4px; margin-top: 5px; cursor: pointer;">
                Transfer Excess
              </button>` : ''}
          </td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
  }

  statusContainer.innerHTML = html;
}

function updateTransferHistory(history) {
  const tbody = document.querySelector('#transferHistoryTbl tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (history.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" style="text-align: center; padding: 20px; color: #9ca3af;">No transfer history available</td>';
    tbody.appendChild(tr);
    return;
  }

  history.forEach(transfer => {
    const tr = document.createElement('tr');
    const statusColor = {
      'completed': '#10b981',
      'pending': '#f59e0b',
      'failed': '#ef4444'
    }[transfer.status] || '#6b7280';

    tr.innerHTML = `
      <td>${new Date(transfer.createdAt).toLocaleString()}</td>
      <td>${transfer.tokenSymbol || 'Unknown'}</td>
      <td>${transfer.amount || 'N/A'}</td>
      <td style="max-width: 120px; overflow: hidden; text-overflow: ellipsis;">${transfer.destinationAddress}</td>
      <td><span style="color: ${statusColor}; font-weight: bold;">${transfer.status}</span></td>
      <td>
        ${transfer.txHash ?
          `<a href="#" style="color: #60a5fa;" onclick="copyToClipboard('${transfer.txHash}')">
            Copy TX
          </a>` : 'N/A'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updatePendingTransfers(pending) {
  const container = document.getElementById('pendingTransfers');
  if (!container) return;

  if (pending.length === 0) {
    container.innerHTML = '<p style="color: #9ca3af;">No pending transfers</p>';
    return;
  }

  let html = '<ul style="margin: 0; padding-left: 20px;">';
  pending.forEach(transfer => {
    html += `
      <li style="margin: 5px 0;">
        ${transfer.tokenSymbol || 'Unknown'} - ${transfer.amount || 'N/A'}
        to ${transfer.destinationAddress.slice(0, 10)}...
        <span style="color: #f59e0b;">(${transfer.status})</span>
      </li>
    `;
  });
  html += '</ul>';
  container.innerHTML = html;
}

function updateActiveAlerts(alerts) {
  const container = document.getElementById('activeAlerts');
  if (!container) return;

  if (alerts.length === 0) {
    container.innerHTML = '<p style="color: #9ca3af;">No active alerts</p>';
    return;
  }

  let html = '';
  alerts.forEach(alert => {
    const alertColor = {
      'critical': '#ef4444',
      'warning': '#f59e0b',
      'info': '#60a5fa'
    }[alert.type] || '#6b7280';

    html += `
      <div style="background: #333; border-left: 4px solid ${alertColor}; padding: 10px; margin: 10px 0; border-radius: 4px;">
        <div style="font-weight: bold; color: ${alertColor};">${alert.title}</div>
        <div style="margin: 5px 0; font-size: 0.9em;">${alert.message}</div>
        <div style="margin-top: 10px;">
          <button onclick="acknowledgeAlert(${alert.id})"
                  style="background: #374151; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">
            Acknowledge
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

export function initTreasurySafetySection() {
  // Save configuration button
  const saveConfigBtn = document.getElementById('saveTreasurySafetyConfig');
  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', async () => {
      try {
        const config = {
          treasuryMaxHoldingUSD: parseFloat(document.getElementById('treasuryMaxHoldingUSD')?.value) || null,
          treasuryWarningThresholdUSD: parseFloat(document.getElementById('treasuryWarningThresholdUSD')?.value) || null,
          coldWalletAddress: document.getElementById('coldWalletAddress')?.value?.trim() || null,
          treasuryMonitoringEnabled: document.getElementById('treasuryMonitoringEnabled')?.checked || false,
          autoTransferEnabled: document.getElementById('autoTransferEnabled')?.checked || false,
          treasuryCheckIntervalMins: parseInt(document.getElementById('treasuryCheckIntervalMins')?.value) || 60
        };

        const data = await makeAuthenticatedRequest('/admin/treasury-safety/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });

        if (!data.ok) {
          throw new Error(data.error);
        }

        const msg = document.getElementById('treasurySafetyMsg');
        if (msg) {
          msg.innerHTML = `<span class="ok">Configuration saved successfully</span>`;
        }
      } catch (error) {
        console.error("❌ Failed to save treasury safety config:", error);
        const msg = document.getElementById('treasurySafetyMsg');
        if (msg) {
          msg.innerHTML = `<span class="err">Failed to save config: ${error.message}</span>`;
        }
      }
    });
  }

  // Manual safety check button
  const checkBtn = document.getElementById('runSafetyCheck');
  if (checkBtn) {
    checkBtn.addEventListener('click', async () => {
      try {
        checkBtn.disabled = true;
        checkBtn.textContent = 'Checking...';

        const data = await makeAuthenticatedRequest('/admin/treasury-safety/check', {
          method: 'POST'
        });

        if (!data.ok) {
          throw new Error(data.error);
        }

        // Reload the data to show updated status
        await loadTreasurySafety();

        const msg = document.getElementById('treasurySafetyMsg');
        if (msg) {
          msg.innerHTML = `<span class="ok">${data.message}</span>`;
        }
      } catch (error) {
        console.error("❌ Failed to run safety check:", error);
        const msg = document.getElementById('treasurySafetyMsg');
        if (msg) {
          msg.innerHTML = `<span class="err">Failed to run safety check: ${error.message}</span>`;
        }
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Run Safety Check';
      }
    });
  }

  // Emergency pause button
  const pauseBtn = document.getElementById('emergencyPause');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to emergency pause all cold transfers? This cannot be undone via the UI.')) {
        return;
      }

      try {
        const data = await makeAuthenticatedRequest('/admin/treasury-safety/emergency-pause', {
          method: 'POST'
        });

        if (!data.ok) {
          throw new Error(data.error);
        }

        const msg = document.getElementById('treasurySafetyMsg');
        if (msg) {
          msg.innerHTML = `<span class="ok">${data.message}</span>`;
        }

        // Reload data to reflect changes
        await loadTreasurySafety();
      } catch (error) {
        console.error("❌ Failed to emergency pause:", error);
        const msg = document.getElementById('treasurySafetyMsg');
        if (msg) {
          msg.innerHTML = `<span class="err">Failed to emergency pause: ${error.message}</span>`;
        }
      }
    });
  }
}

// Global functions for button callbacks
window.initiateTransfer = async function(tokenId, excessUSD) {
  const amount = prompt(`Enter amount to transfer (recommended: ${excessUSD.toFixed(2)} USD worth):`);
  if (!amount) return;

  const coldWallet = document.getElementById('coldWalletAddress')?.value?.trim();
  if (!coldWallet) {
    alert('Cold wallet address must be configured first');
    return;
  }

  const reason = prompt('Enter reason for transfer:', `Excess treasury safety transfer - $${excessUSD.toFixed(2)} over limit`);
  if (!reason) return;

  try {
    const data = await makeAuthenticatedRequest('/admin/treasury-safety/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenId: parseInt(tokenId),
        amount: parseFloat(amount),
        destinationAddress: coldWallet,
        reason
      })
    });

    if (data.ok) {
      alert(`Transfer successful! TX: ${data.txHash}`);
      await loadTreasurySafety();
    } else {
      alert(`Transfer failed: ${data.error}`);
    }
  } catch (error) {
    alert(`Transfer failed: ${error.message}`);
  }
};

window.acknowledgeAlert = async function(alertId) {
  try {
    const data = await makeAuthenticatedRequest(`/admin/treasury-safety/acknowledge-alert/${alertId}`, {
      method: 'POST'
    });

    if (data.ok) {
      await loadTreasurySafety();
    } else {
      alert(`Failed to acknowledge alert: ${data.error}`);
    }
  } catch (error) {
    alert(`Failed to acknowledge alert: ${error.message}`);
  }
};

window.copyToClipboard = function(text) {
  navigator.clipboard.writeText(text).then(() => {
    console.log('Copied to clipboard:', text);
  });
};