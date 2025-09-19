// src/web/admin/js/ui-secure-helpers.js - Secure helper functions for ui.js

import { createElement, createTableRow, escapeHtml, sanitizeInput, setSecureContent } from './security.js';

/**
 * Securely create alert div with proper escaping
 * @param {Object} alert - Alert data
 * @returns {HTMLDivElement} - Safe alert element
 */
export function createAlertDiv(alert) {
  const bgColor = alert.level === 'critical' ? '#dc2626' :
                  alert.level === 'warning' ? '#f59e0b' : '#3b82f6';
  const icon = alert.level === 'critical' ? '🔥' :
               alert.level === 'warning' ? '⚠️' : 'ℹ️';

  const alertDiv = createElement('div', {
    style: {
      background: bgColor,
      padding: '12px',
      borderRadius: '8px',
      margin: '8px 0',
      color: 'white'
    }
  });

  const messageDiv = createElement('div', {
    style: { fontWeight: 'bold' },
    textContent: `${icon} ${escapeHtml(alert.message)}`
  });

  const detailsDiv = createElement('div', {
    style: {
      fontSize: '0.9em',
      opacity: '0.9',
      marginTop: '4px'
    },
    textContent: `${escapeHtml(alert.metric)}: ${escapeHtml(alert.value)}${alert.metric === 'memory' || alert.metric === 'cpu' ? '%' : 'ms'} (threshold: ${escapeHtml(alert.threshold)}${alert.metric === 'memory' || alert.metric === 'cpu' ? '%' : 'ms'})`
  });

  alertDiv.appendChild(messageDiv);
  alertDiv.appendChild(detailsDiv);

  if (alert.recommendation) {
    const recommendationDiv = createElement('div', {
      style: {
        fontSize: '0.9em',
        marginTop: '8px',
        paddingTop: '8px',
        borderTop: '1px solid rgba(255,255,255,0.3)'
      },
      textContent: `💡 ${escapeHtml(alert.recommendation)}`
    });
    alertDiv.appendChild(recommendationDiv);
  }

  return alertDiv;
}

/**
 * Securely create recommendation list item
 * @param {string} recommendation - Recommendation text
 * @returns {HTMLDivElement} - Safe recommendation element
 */
export function createRecommendationDiv(recommendation) {
  return createElement('div', {
    style: { padding: '8px 0', color: '#e5e5e5' },
    textContent: `• ${escapeHtml(recommendation)}`
  });
}

/**
 * Securely create user table row with proper data escaping
 * @param {Object} user - User data
 * @param {Array} balances - User balance data
 * @returns {HTMLTableRowElement} - Safe user row
 */
export function createUserTableRow(user, balances = []) {
  const tr = document.createElement('tr');

  // Create balance HTML safely
  const balanceElements = [];
  balances.forEach(bal => {
    if (bal.amount > 0) {
      const balanceDiv = createElement('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '2px 0'
        }
      });

      const tokenSpan = createElement('span', {
        textContent: `${escapeHtml(bal.symbol)}: ${escapeHtml(String(bal.human))}`
      });

      const editBtn = createElement('button', {
        className: 'edit-balance-btn',
        textContent: '✏️',
        style: {
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          padding: '2px 6px',
          borderRadius: '3px',
          cursor: 'pointer',
          fontSize: '10px',
          marginLeft: '8px'
        },
        attributes: {
          'data-discord-id': escapeHtml(user.discordId),
          'data-token-symbol': escapeHtml(bal.symbol),
          'data-current-amount': escapeHtml(String(bal.amount))
        }
      });

      balanceDiv.appendChild(tokenSpan);
      balanceDiv.appendChild(editBtn);
      balanceElements.push(balanceDiv);
    }
  });

  const addTokenBtn = createElement('button', {
    className: 'add-token-btn',
    textContent: '➕ Add Token',
    style: {
      background: '#059669',
      color: 'white',
      border: 'none',
      padding: '4px 8px',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '11px'
    },
    attributes: {
      'data-discord-id': escapeHtml(user.discordId)
    }
  });

  const balancesCell = createElement('td');
  balanceElements.forEach(el => balancesCell.appendChild(el));
  balancesCell.appendChild(addTokenBtn);

  const memberships = user.membershipDetails?.map(m =>
    `${escapeHtml(m.tierName)} (${escapeHtml(m.status)})`
  ).join(", ") || "None";

  const cells = [
    { textContent: escapeHtml(user.username || "Unknown") },
    { innerHTML: `<code>${escapeHtml(user.discordId)}</code>`, trusted: true },
    { innerHTML: `<code>${escapeHtml(user.agwAddress || "Not linked")}</code>`, trusted: true },
    { textContent: new Date(user.createdAt).toLocaleDateString() },
    { textContent: user.lastActivity ? new Date(user.lastActivity).toLocaleDateString() : "Never" },
    { textContent: formatNumber(user.totalTipsSent || 0) },
    { textContent: formatNumber(user.totalTipsReceived || 0) },
    { textContent: memberships },
    { type: 'element', element: balancesCell },
    { type: 'html', content: createUserActionButtons(user.discordId), trusted: true }
  ];

  return createTableRow(cells);
}

/**
 * Create action buttons for user row
 * @param {string} discordId - User's Discord ID
 * @returns {string} - Safe HTML for action buttons
 */
function createUserActionButtons(discordId) {
  const safeId = escapeHtml(discordId);
  return `
    <button class="exportUser" data-discord-id="${safeId}" style="background:#2563eb; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; margin-right:4px;">📊 Export CSV</button><br/>
    <button class="deleteUser" data-discord-id="${safeId}" style="background:#f59e0b; color:white; border:none; padding:3px 6px; border-radius:4px; cursor:pointer; margin-right:4px; margin-top:4px;">Delete (Anonymize)</button>
    <button class="hardDeleteUser" data-discord-id="${safeId}" style="background:#dc2626; color:white; border:none; padding:3px 6px; border-radius:4px; cursor:pointer; margin-top:4px;">Hard Delete</button>
  `;
}

/**
 * Securely create tier table row
 * @param {Object} tier - Tier data
 * @returns {HTMLTableRowElement} - Safe tier row
 */
export function createTierTableRow(tier) {
  const tr = createElement('tr', {
    dataset: { id: String(tier.id) }
  });

  const cells = [
    { textContent: String(tier.id) },
    { type: 'html', content: `<input value="${escapeHtml(tier.name)}" data-field="name" style="width:160px"/>`, trusted: true },
    { textContent: escapeHtml(tier.token?.symbol || tier.tokenId) },
    { type: 'html', content: `<input value="${escapeHtml(String(tier.priceAmount))}" data-field="priceAmount" type="number" step="0.00000001" style="width:140px"/>`, trusted: true },
    { type: 'html', content: `<input value="${escapeHtml(String(tier.durationDays))}" data-field="durationDays" type="number" min="1" style="width:90px"/>`, trusted: true },
    { type: 'html', content: `<input type="checkbox" ${tier.tipTaxFree ? "checked" : ""} data-field="tipTaxFree"/>`, trusted: true },
    { type: 'html', content: `<input type="checkbox" ${tier.active ? "checked" : ""} data-field="active"/>`, trusted: true },
    { type: 'html', content: '<button class="saveTier">Save</button>', trusted: true }
  ];

  return createTableRow(cells);
}

/**
 * Securely create server table row
 * @param {Object} server - Server data
 * @returns {HTMLTableRowElement} - Safe server row
 */
export function createServerTableRow(server) {
  const cells = [
    { textContent: String(server.id) },
    { textContent: escapeHtml(server.name || 'Unknown') },
    { innerHTML: `<code>${escapeHtml(server.guildId)}</code>`, trusted: true },
    { textContent: new Date(server.approvedAt).toLocaleDateString() },
    { textContent: escapeHtml(server.approvedBy || 'System') },
    { type: 'html', content: `<button class="removeServer" data-guild-id="${escapeHtml(server.guildId)}" style="background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Remove</button>`, trusted: true }
  ];

  return createTableRow(cells);
}

/**
 * Format number safely for display
 * @param {number} n - Number to format
 * @returns {string} - Formatted number
 */
function formatNumber(n) {
  return Number(n ?? 0).toLocaleString(undefined, {
    maximumFractionDigits: 8,
    minimumFractionDigits: 0
  });
}

/**
 * Securely create treasury row
 * @param {Object} token - Token data with balance
 * @returns {HTMLTableRowElement} - Safe treasury row
 */
export function createTreasuryRow(token) {
  const cells = [
    { innerHTML: `<strong>${escapeHtml(token.symbol)}</strong>`, trusted: true },
    { textContent: escapeHtml(token.human || '0') }
  ];

  return createTableRow(cells);
}