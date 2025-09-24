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

  // Create prediction market summary
  const marketSummary = [];
  if (tier.canCreateMarkets) {
    marketSummary.push('🎯 Can create markets');
    if (tier.dailyMarketLimit > 0) {
      marketSummary.push(`Max ${tier.dailyMarketLimit}/day`);
    }
    if (tier.customRakePercent) {
      marketSummary.push(`${tier.customRakePercent}% rake`);
    }
    if (tier.marketCooldownMinutes > 0) {
      marketSummary.push(`${tier.marketCooldownMinutes}min cooldown`);
    }
  } else {
    marketSummary.push('❌ No markets');
  }

  const cells = [
    { textContent: String(tier.id) },
    { type: 'html', content: `<input value="${escapeHtml(tier.name)}" data-field="name" style="width:160px" id="name-${tier.id}" name="name-${tier.id}"/>`, trusted: true },
    { type: 'html', content: `<textarea data-field="description" style="width:200px;height:40px;resize:vertical;" id="description-${tier.id}" name="description-${tier.id}">${escapeHtml(tier.description || '')}</textarea>`, trusted: true },
    { type: 'html', content: `<input value="${escapeHtml(String(tier.priceAmount))}" data-field="priceAmount" type="number" step="0.00000001" style="width:100px" id="priceAmount-${tier.id}" name="priceAmount-${tier.id}" aria-label="Tier ${tier.id} price amount"/>`, trusted: true },
    { type: 'html', content: `<div style="font-size:11px;color:#9ca3af;max-width:150px;">${marketSummary.join('<br>')}</div>`, trusted: true },
    { type: 'html', content: `<input type="checkbox" ${tier.active ? "checked" : ""} data-field="active" id="tier-active-${tier.id}" name="tier-active-${tier.id}" aria-label="Tier ${tier.id} active status"/>`, trusted: true },
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
  const statusClass = server.enabled ? 'online' : 'offline';

  const statusCell = createElement('td');
  const statusSpan = createElement('span', {
    className: `status-indicator ${statusClass}`
  });
  const enabledCheckbox = createElement('input', {
    attributes: {
      type: 'checkbox',
      'data-field': 'enabled',
      ...(server.enabled ? { checked: true } : {})
    }
  });
  statusCell.appendChild(statusSpan);
  statusCell.appendChild(enabledCheckbox);

  const actionCell = createElement('td');
  const saveBtn = createElement('button', {
    className: 'saveServer',
    textContent: 'Save',
    attributes: { 'data-id': String(server.id) }
  });
  const deleteBtn = createElement('button', {
    className: 'deleteServer',
    textContent: 'Delete',
    style: { background: '#ef4444', marginLeft: '4px' },
    attributes: { 'data-id': String(server.id) }
  });
  actionCell.appendChild(saveBtn);
  actionCell.appendChild(deleteBtn);

  const cells = [
    { textContent: String(server.id) },
    { innerHTML: `<strong>${escapeHtml(server.servername || 'Loading...')}</strong>`, trusted: true },
    { innerHTML: `<code>${escapeHtml(server.guildId)}</code>`, trusted: true },
    { type: 'html', content: `<input value="${escapeHtml(server.note || '')}" data-field="note" placeholder="Description" id="note-${server.id}" name="note-${server.id}"/>`, trusted: true },
    { type: 'element', element: statusCell },
    { type: 'element', element: actionCell }
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

/**
 * Securely create ads table row
 * @param {Object} ad - Ad data
 * @returns {HTMLTableRowElement} - Safe ad row
 */
export function createAdTableRow(ad) {
  const statusClass = ad.active ? 'online' : 'offline';

  const statusCell = createElement('td', { style: { whiteSpace: 'nowrap' } });
  const statusSpan = createElement('span', {
    className: `status-indicator ${statusClass}`
  });
  const activeCheckbox = createElement('input', {
    attributes: {
      type: 'checkbox',
      'data-field': 'active',
      ...(ad.active ? { checked: true } : {})
    }
  });
  statusCell.appendChild(statusSpan);
  statusCell.appendChild(activeCheckbox);

  const actionCell = createElement('td');
  const saveBtn = createElement('button', {
    className: 'saveAd',
    textContent: 'Save'
  });
  const deleteBtn = createElement('button', {
    className: 'deleteAd',
    textContent: 'Delete',
    style: { background: '#ef4444' }
  });
  actionCell.appendChild(saveBtn);
  actionCell.appendChild(deleteBtn);

  const cells = [
    { textContent: String(ad.id) },
    { type: 'html', content: `<input value="${escapeHtml(ad.text || '')}" data-field="text" maxlength="500" style="width:420px" id="ad-text-${ad.id}" name="ad-text-${ad.id}"/>`, trusted: true },
    { type: 'html', content: `<input value="${escapeHtml(ad.url || '')}" data-field="url" placeholder="https://..." style="width:320px" id="ad-url-${ad.id}" name="ad-url-${ad.id}"/>`, trusted: true },
    { type: 'html', content: `<input value="${escapeHtml(String(ad.weight))}" data-field="weight" type="number" min="1" max="100" style="width:80px" id="ad-weight-${ad.id}" name="ad-weight-${ad.id}" aria-label="Ad ${ad.id} weight"/>`, trusted: true },
    { type: 'element', element: statusCell },
    { type: 'element', element: actionCell }
  ];

  return createTableRow(cells, { dataset: { id: String(ad.id) } });
}

/**
 * Securely create transaction table row
 * @param {Object} transaction - Transaction data
 * @returns {HTMLTableRowElement} - Safe transaction row
 */
export function createTransactionTableRow(transaction) {
  const deleteCell = createElement('td');
  const deleteBtn = createElement('button', {
    textContent: '🗑️ Delete',
    style: { background: '#dc2626', fontSize: '11px', padding: '2px 6px' },
    attributes: { onclick: `deleteTransaction(${transaction.id})` }
  });
  deleteCell.appendChild(deleteBtn);

  const cells = [
    { textContent: String(transaction.id) },
    { textContent: escapeHtml(transaction.type) },
    { textContent: escapeHtml(transaction.userId || 'System') },
    { textContent: formatNumber(transaction.amount) },
    { textContent: escapeHtml(transaction.tokenId || 'N/A') },
    { textContent: formatNumber(transaction.fee) },
    { textContent: new Date(transaction.createdAt).toLocaleString() },
    { textContent: escapeHtml(transaction.guildId || 'N/A') },
    { textContent: escapeHtml(transaction.metadata || '') },
    { type: 'element', element: deleteCell }
  ];

  return createTableRow(cells);
}

/**
 * Securely create group tip table row
 * @param {Object} groupTip - Group tip data
 * @returns {HTMLTableRowElement} - Safe group tip row
 */
export function createGroupTipTableRow(groupTip) {
  const expiresAt = new Date(groupTip.expiresAt).toLocaleString();
  const createdAt = new Date(groupTip.createdAt).toLocaleString();

  const expireCell = createElement('td');
  const expireBtn = createElement('button', {
    className: 'expireGroupTip',
    textContent: 'Expire',
    style: { background: '#f59e0b', color: 'white', border: 'none', padding: '2px 6px', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' },
    attributes: { 'data-id': String(groupTip.id) }
  });
  expireCell.appendChild(expireBtn);

  const creatorId = groupTip.Creator?.discordId?.slice(0, 8) || groupTip.creatorId || 'Unknown';

  const cells = [
    { textContent: String(groupTip.id) },
    { textContent: `${escapeHtml(creatorId)}...` },
    { textContent: formatNumber(groupTip.totalAmount) },
    { textContent: escapeHtml(groupTip.Token?.symbol || 'Unknown') },
    { textContent: escapeHtml(groupTip.status) },
    { textContent: String(groupTip.claimCount || 0) },
    { textContent: createdAt },
    { textContent: expiresAt },
    { type: 'element', element: expireCell }
  ];

  return createTableRow(cells);
}

/**
 * Securely create token management table row
 * @param {Object} token - Token data
 * @returns {HTMLTableRowElement} - Safe token row
 */
export function createTokenTableRow(token) {
  const tr = document.createElement('tr');

  // Create fee input container helper
  const createFeeInputContainer = (fieldName, currentValue, presetValues, token) => {
    const container = createElement('div', { className: 'fee-input-container' });

    const input = createElement('input', {
      attributes: {
        value: currentValue ? currentValue.toFixed(2) : '',
        placeholder: 'default',
        'data-field': fieldName,
        type: 'number',
        step: '0.01',
        min: '0',
        max: '10',
        style: 'width:50px',
        id: `token-${fieldName}-${token.id}`,
        name: `token-${fieldName}-${token.id}`,
        'aria-label': `Token ${token.symbol} ${fieldName.replace('FeePercent', ' fee percentage')}`
      }
    });

    const suffix = createElement('span', {
      className: 'fee-suffix',
      textContent: '%'
    });

    const presets = createElement('div', { className: 'fee-presets' });
    presetValues.forEach(value => {
      const btn = createElement('button', {
        attributes: {
          type: 'button',
          'data-field': fieldName,
          'data-value': String(value)
        },
        className: 'preset-btn',
        textContent: `${value}%`
      });
      presets.appendChild(btn);
    });

    const preview = createElement('div', {
      className: 'fee-preview',
      attributes: { 'data-field': fieldName + 'Preview' }
    });

    container.appendChild(input);
    container.appendChild(suffix);
    container.appendChild(presets);
    container.appendChild(preview);

    return container;
  };

  const cells = [
    { textContent: String(token.id) },
    { innerHTML: `<strong>${escapeHtml(token.symbol)}</strong>`, trusted: true },
    { innerHTML: `<code>${escapeHtml(token.address)}</code>`, trusted: true },
    { textContent: String(token.decimals) },
    { type: 'html', content: `<input type="checkbox" ${token.active ? "checked" : ""} data-field="active" id="token-active-${token.id}" name="token-active-${token.id}" aria-label="Token ${token.symbol} active status"/>`, trusted: true },
    { type: 'html', content: `<input value="${escapeHtml(String(token.minDeposit))}" data-field="minDeposit" type="number" step="0.01" style="width:80px" id="token-minDeposit-${token.id}" name="token-minDeposit-${token.id}" aria-label="Token ${token.symbol} minimum deposit"/>`, trusted: true },
    { type: 'html', content: `<input value="${escapeHtml(String(token.minWithdraw))}" data-field="minWithdraw" type="number" step="0.01" style="width:80px" id="token-minWithdraw-${token.id}" name="token-minWithdraw-${token.id}" aria-label="Token ${token.symbol} minimum withdrawal"/>`, trusted: true },
    { type: 'element', element: createFeeInputContainer('tipFeePercent', token.tipFeeBps ? token.tipFeeBps / 100 : null, [0.5, 1, 1.5, 2], token) },
    { type: 'element', element: createFeeInputContainer('houseFeePercent', token.houseFeeBps ? token.houseFeeBps / 100 : null, [1, 2, 2.5, 3], token) },
    { type: 'html', content: `<input value="${escapeHtml(String(token.withdrawMaxPerTx || ''))}" placeholder="default" data-field="withdrawMaxPerTx" type="number" step="0.01" style="width:80px" id="token-withdrawMaxPerTx-${token.id}" name="token-withdrawMaxPerTx-${token.id}" aria-label="Token ${token.symbol} maximum withdrawal per transaction"/>`, trusted: true },
    { type: 'html', content: `<input value="${escapeHtml(String(token.withdrawDailyCap || ''))}" placeholder="default" data-field="withdrawDailyCap" type="number" step="0.01" style="width:80px" id="token-withdrawDailyCap-${token.id}" name="token-withdrawDailyCap-${token.id}" aria-label="Token ${token.symbol} daily withdrawal cap"/>`, trusted: true }
  ];

  // Create action buttons cell
  const actionCell = createElement('td');
  const saveBtn = createElement('button', {
    className: 'saveToken',
    textContent: 'Save',
    attributes: { 'data-id': String(token.id) }
  });
  const deleteBtn = createElement('button', {
    className: 'deleteToken',
    textContent: 'Delete',
    style: { background: '#ef4444', marginLeft: '4px' },
    attributes: { 'data-id': String(token.id) }
  });

  actionCell.appendChild(saveBtn);
  actionCell.appendChild(deleteBtn);
  cells.push({ type: 'element', element: actionCell });

  return createTableRow(cells);
}