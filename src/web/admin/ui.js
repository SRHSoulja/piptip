// src/web/admin/ui_complete.js - Complete Admin frontend JavaScript

// Security utilities (inline to avoid module issues)
const escapeHtml = (str) => str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const setSecureContent = (el, content) => { el.textContent = content; };
const createElement = (tag, options = {}) => {
  const el = document.createElement(tag);
  if (options.className) el.className = options.className;
  if (options.textContent) el.textContent = options.textContent;
  if (options.innerHTML && options.trusted) el.innerHTML = options.innerHTML;
  if (options.style) Object.assign(el.style, options.style);
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([key, value]) => {
      el.setAttribute(key, value);
    });
  }
  return el;
};
// Removed duplicate createSecureButton function
const createTableRow = (cells) => {
  const tr = document.createElement('tr');
  cells.forEach(cell => {
    const td = document.createElement('td');
    if (cell.type === 'element' && cell.element) {
      // Handle pre-created elements
      td.appendChild(cell.element);
      tr.appendChild(td);
    } else if (cell.innerHTML && cell.trusted) {
      td.innerHTML = cell.innerHTML;
      tr.appendChild(td);
    } else if (cell.textContent) {
      td.textContent = cell.textContent;
      tr.appendChild(td);
    } else {
      // Fallback for empty cells
      tr.appendChild(td);
    }
  });
  return tr;
};

const createSecureButton = (text, clickHandler, options = {}) => {
  const button = document.createElement('button');
  button.textContent = text;

  if (options.className) button.className = options.className;
  if (options.style) {
    Object.entries(options.style).forEach(([property, value]) => {
      button.style[property] = value;
    });
  }
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([key, value]) => {
      button.setAttribute(key, escapeHtml(String(value)));
    });
  }

  if (typeof clickHandler === 'function') {
    button.addEventListener('click', clickHandler);
  }

  return button;
};

// Token table row creation
const createTokenTableRow = (token) => {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${token.id}</td>
    <td><strong>${escapeHtml(token.symbol)}</strong></td>
    <td><code>${escapeHtml(token.address)}</code></td>
    <td>${token.decimals}</td>
    <td><input type="checkbox" ${token.active ? 'checked' : ''} data-field="active" aria-label="Token ${escapeHtml(token.symbol)} active status" id="token-active-${token.id}" name="token-active-${token.id}"/></td>
    <td><input value="${token.minDeposit}" data-field="minDeposit" type="number" step="0.01" style="width:80px" aria-label="Token ${escapeHtml(token.symbol)} minimum deposit" id="token-minDeposit-${token.id}" name="token-minDeposit-${token.id}"/></td>
    <td><input value="${token.minWithdraw}" data-field="minWithdraw" type="number" step="0.01" style="width:80px" aria-label="Token ${escapeHtml(token.symbol)} minimum withdrawal" id="token-minWithdraw-${token.id}" name="token-minWithdraw-${token.id}"/></td>
    <td><input value="${token.tipFeeBps || ''}" placeholder="default" data-field="tipFeeBps" type="number" step="1" style="width:60px" aria-label="Token ${escapeHtml(token.symbol)} tip fee basis points" id="token-tipFeeBps-${token.id}" name="token-tipFeeBps-${token.id}"/></td>
    <td><input value="${token.houseFeeBps || ''}" placeholder="default" data-field="houseFeeBps" type="number" step="1" style="width:60px" aria-label="Token ${escapeHtml(token.symbol)} house fee basis points" id="token-houseFeeBps-${token.id}" name="token-houseFeeBps-${token.id}"/></td>
    <td><input value="${token.withdrawMaxPerTx || ''}" placeholder="default" data-field="withdrawMaxPerTx" type="number" step="0.01" style="width:80px" aria-label="Token ${escapeHtml(token.symbol)} maximum withdrawal per transaction" id="token-withdrawMaxPerTx-${token.id}" name="token-withdrawMaxPerTx-${token.id}"/></td>
    <td><input value="${token.withdrawDailyCap || ''}" placeholder="default" data-field="withdrawDailyCap" type="number" step="0.01" style="width:80px" aria-label="Token ${escapeHtml(token.symbol)} daily withdrawal cap" id="token-withdrawDailyCap-${token.id}" name="token-withdrawDailyCap-${token.id}"/></td>
    <td>
      <button class="saveToken" data-id="${token.id}">Save</button>
      <button class="deleteToken" data-id="${token.id}">Delete</button>
    </td>
  `;
  return tr;
};

const createServerTableRow = (server) => {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${server.id}</td>
    <td><strong>${escapeHtml(server.servername || server.guildId || 'Unknown Server')}</strong></td>
    <td><code>${escapeHtml(server.guildId)}</code></td>
    <td><input value="${escapeHtml(server.note || '')}" data-field="note" type="text" style="width:200px" aria-label="Server ${escapeHtml(server.guildId)} note" id="note-${server.guildId}" name="note-${server.guildId}"/></td>
    <td>
      <div class="status-indicator ${server.enabled ? 'online' : 'offline'}"></div>
      <input type="checkbox" ${server.enabled ? 'checked' : ''} data-field="enabled" aria-label="Server ${escapeHtml(server.guildId)} enabled status" id="enabled-${server.guildId}" name="enabled-${server.guildId}"/>
    </td>
    <td>
      <button class="saveServer" data-id="${server.id}">Save</button>
      <button class="deleteServer" data-id="${server.id}">Delete</button>
    </td>
  `;
  return tr;
};

const createTreasuryRow = (token) => createTableRow([
  { innerHTML: `<strong>${escapeHtml(token.symbol)}</strong>`, trusted: true },
  { textContent: token.human },
  { textContent: token.formattedUSD || 'N/A' },
  { textContent: token.priceUSD ? `$${token.priceUSD.toFixed(6)}` : 'N/A' }
]);

const createAdTableRow = (ad) => {
  const tr = document.createElement('tr');
  tr.dataset.id = ad.id;
  tr.innerHTML = `
    <td>${ad.id}</td>
    <td><input value="${escapeHtml(ad.text || '')}" data-field="text" maxlength="500" style="width:420px" aria-label="Ad ${ad.id} text content" id="text-${ad.id}" name="text-${ad.id}"/></td>
    <td><input value="${escapeHtml(ad.url || '')}" data-field="url" placeholder="https://..." style="width:320px" aria-label="Ad ${ad.id} URL" id="url-${ad.id}" name="url-${ad.id}"/></td>
    <td><input value="${escapeHtml(String(ad.weight))}" data-field="weight" type="number" min="1" max="100" style="width:80px" aria-label="Ad ${ad.id} weight" id="weight-${ad.id}" name="weight-${ad.id}"/></td>
    <td>
      <div class="status-indicator ${ad.active ? 'online' : 'offline'}"></div>
      <input type="checkbox" ${ad.active ? 'checked' : ''} data-field="active" aria-label="Ad ${ad.id} active status" id="ad-active-${ad.id}" name="ad-active-${ad.id}"/>
    </td>
    <td>
      <button class="saveAd">Save</button>
      <button class="deleteAd" style="background:#ef4444;">Delete</button>
    </td>
  `;
  return tr;
};

const createTransactionTableRow = (transaction) => {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${transaction.id}</td>
    <td>${escapeHtml(transaction.type)}</td>
    <td>${escapeHtml(transaction.userId || 'System')}</td>
    <td>${formatNumber(transaction.amount)}</td>
    <td>${escapeHtml(transaction.tokenId || 'N/A')}</td>
    <td>${formatNumber(transaction.fee)}</td>
    <td>${new Date(transaction.createdAt).toLocaleString()}</td>
    <td>${escapeHtml(transaction.guildId || 'N/A')}</td>
    <td>${escapeHtml(transaction.metadata || '')}</td>
    <td><button onclick="deleteTransaction(${transaction.id})" style="background:#dc2626; color:white; border:none; padding:2px 6px; border-radius:3px; cursor:pointer; font-size:11px;">🗑️ Delete</button></td>
  `;
  return tr;
};

const createGroupTipTableRow = (groupTip) => {
  const tr = document.createElement('tr');
  const creatorId = groupTip.Creator?.discordId?.slice(0, 8) || groupTip.creatorId || 'Unknown';
  tr.innerHTML = `
    <td>${groupTip.id}</td>
    <td>${escapeHtml(creatorId)}...</td>
    <td>${formatNumber(groupTip.totalAmount)}</td>
    <td>${escapeHtml(groupTip.Token?.symbol || 'Unknown')}</td>
    <td>${escapeHtml(groupTip.status)}</td>
    <td>${groupTip.claimCount || 0}</td>
    <td>${new Date(groupTip.createdAt).toLocaleString()}</td>
    <td>${new Date(groupTip.expiresAt).toLocaleString()}</td>
    <td><button class="expireGroupTip" data-id="${groupTip.id}" style="background:#f59e0b; color:white; border:none; padding:2px 6px; border-radius:3px; cursor:pointer; font-size:11px;">Expire</button></td>
  `;
  return tr;
};

const createTierTableRow = (tier) => {
  const tr = document.createElement('tr');
  tr.dataset.id = tier.id;
  tr.innerHTML = `
    <td>${tier.id}</td>
    <td><input value="${escapeHtml(tier.name)}" data-field="name" style="width:160px"/></td>
    <td>${escapeHtml(tier.token?.symbol || tier.tokenId)}</td>
    <td><input value="${escapeHtml(String(tier.priceAmount))}" data-field="priceAmount" type="number" step="0.00000001" style="width:140px" id="priceAmount-${tier.id}" name="priceAmount-${tier.id}"/></td>
    <td><input value="${escapeHtml(String(tier.durationDays))}" data-field="durationDays" type="number" min="1" style="width:90px" id="durationDays-${tier.id}" name="durationDays-${tier.id}"/></td>
    <td><input type="checkbox" ${tier.tipTaxFree ? "checked" : ""} data-field="tipTaxFree" id="tipTaxFree-${tier.id}" name="tipTaxFree-${tier.id}"/></td>
    <td><input type="checkbox" ${tier.active ? "checked" : ""} data-field="active" id="tier-active-${tier.id}" name="tier-active-${tier.id}"/></td>
    <td><button class="saveTier">Save</button></td>
  `;
  return tr;
};

// ---------- Utility helpers ----------
const $ = (id) => document.getElementById(id);

// CSRF token management
let csrfToken = null;
let csrfSecret = null;
let csrfExpiry = null;

const refreshCSRFToken = async () => {
  const secret = localStorage.getItem("pip_admin_secret") || "";
  if (!secret) {
    console.warn("⚠️ No admin secret available for CSRF token generation");
    return false;
  }

  try {
    console.log("🔄 Refreshing CSRF token...");
    const response = await fetch("/admin/csrf-token", {
      headers: { "Authorization": `Bearer ${secret}` }
    });

    if (!response.ok) {
      throw new Error(`Failed to get CSRF token: ${response.status}`);
    }

    const data = await response.json();
    csrfToken = data.token;
    csrfSecret = data.secret;
    csrfExpiry = Date.now() + data.expiresIn;

    console.log("✅ CSRF token refreshed successfully");
    return true;
  } catch (error) {
    console.error("❌ Failed to refresh CSRF token:", error);
    return false;
  }
};

const ensureCSRFToken = async () => {
  // Check if we have a valid token
  if (csrfToken && csrfSecret && csrfExpiry && Date.now() < (csrfExpiry - 60000)) {
    return true; // Token still valid (with 1 minute buffer)
  }

  // Token expired or missing, refresh it
  return await refreshCSRFToken();
};

const API = async (path, opts = {}) => {
  const secret = localStorage.getItem("pip_admin_secret") || "";
  const headers = { "Authorization": `Bearer ${secret}`, ...(opts.headers || {}) };

  // Bearer token authentication provides CSRF protection
  // Server-side exempts bearer-authenticated admin requests from CSRF validation
  // So we don't need to add CSRF tokens here

  console.log(`🌐 Making API call to: ${path}`);
  try {
    const response = await fetch(path, { ...opts, headers });
    console.log(`📡 API response status: ${response.status}`);

    // If CSRF error, try to refresh and retry once
    if (response.status === 403 && opts.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(opts.method.toUpperCase())) {
      const errorText = await response.text();
      if (errorText.includes('CSRF')) {
        console.warn("🔄 CSRF error detected, refreshing token and retrying...");

        const refreshed = await refreshCSRFToken();
        if (refreshed && csrfToken && csrfSecret) {
          headers['X-CSRF-Token'] = csrfToken;
          headers['X-CSRF-Secret'] = csrfSecret;

          // Clear token after use
          csrfToken = null;
          csrfSecret = null;
          csrfExpiry = null;

          // Retry the request
          const retryResponse = await fetch(path, { ...opts, headers });
          console.log(`🔄 Retry response status: ${retryResponse.status}`);
          return retryResponse;
        }
      }
    }

    return response;
  }
  catch (error) { console.error("API request failed:", error); throw error; }
};
const showMessage = (elementId, message, isError = false) => {
  const el = $(elementId);
  if (el) { el.textContent = message; el.className = isError ? "err" : "ok"; }
};
const setLoading = (elementOrId, isLoading) => {
  const el = typeof elementOrId === "string" ? $(elementOrId) : elementOrId;
  if (el) { el.disabled = isLoading; el.classList.toggle("loading", isLoading); }
};
const formatNumber = (n) => Number(n ?? 0).toLocaleString(undefined,{maximumFractionDigits:8,minimumFractionDigits:0});
const setDefaultDates = () => {
  const today = new Date(); const weekAgo = new Date(today.getTime() - 7*24*60*60*1000);
  $("feesSince").value = weekAgo.toISOString().split('T')[0];
  $("feesUntil").value = today.toISOString().split('T')[0];
};

// ---------- Resource monitoring ----------
async function loadResourceMetrics() {
  try {
    setLoading("refreshResources", true);
    showMessage("resourceMsg", "Loading resource metrics...");

    const response = await API("/admin/resources");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const result = await response.json();
    if (!result.success) throw new Error(result.error);

    const data = result.data;

    // Update metric cards
    $("memory-usage").textContent = `${data.current.memory.percentage}%`;
    $("memory-details").textContent = `${data.current.memory.used} / ${data.current.memory.total}`;

    $("cpu-usage").textContent = `${data.current.cpu.usage}%`;
    $("cpu-details").textContent = `${data.current.cpu.cores} cores, Load: ${data.current.cpu.loadAverage[0].toFixed(2)}`;

    $("event-loop-delay").textContent = `${data.current.performance.eventLoopDelay}ms`;
    $("event-loop-details").textContent = data.current.performance.eventLoopDelay > 100 ? "High latency" : "Normal";

    const uptimeHours = Math.floor(data.current.system.uptime / 3600);
    const uptimeMinutes = Math.floor((data.current.system.uptime % 3600) / 60);
    $("uptime-display").textContent = uptimeHours > 0 ? `${uptimeHours}h ${uptimeMinutes}m` : `${uptimeMinutes}m`;
    $("uptime-details").textContent = `${data.current.system.platform} ${data.current.system.nodeVersion}`;

    // Show alerts if any - SECURE VERSION
    if (data.alerts && data.alerts.length > 0) {
      const alertsContainer = $("alerts-container");
      const alertsSection = $("resource-alerts");

      // Clear container and add secure alert elements
      setSecureContent(alertsContainer, data.alerts.map(alert => createAlertDiv(alert)));

      alertsSection.style.display = 'block';
    } else {
      $("resource-alerts").style.display = 'none';
    }

    // Update recommendations - SECURE VERSION
    const recommendationsContainer = $("recommendations-container");
    if (data.recommendations && data.recommendations.length > 0) {
      setSecureContent(recommendationsContainer, data.recommendations.map(rec => createRecommendationDiv(rec)));
    } else {
      setSecureContent(recommendationsContainer, createElement('div', {
        style: { color: '#9ca3af', textAlign: 'center', padding: '20px' },
        textContent: 'No specific recommendations at this time'
      }));
    }

    showMessage("resourceMsg", `✓ Updated at ${new Date().toLocaleTimeString()}`, false);

    // Update card colors based on usage
    updateMetricCardColors(data.current.memory.percentage, data.current.cpu.usage);

  } catch (error) {
    console.error("Resource metrics error:", error);
    showMessage("resourceMsg", `✗ ${error.message}`, true);
  } finally {
    setLoading("refreshResources", false);
  }
}

function updateMetricCardColors(memoryPercent, cpuPercent) {
  const memoryCard = $("memory-usage").parentElement;
  const cpuCard = $("cpu-usage").parentElement;

  // Memory card colors
  if (memoryPercent > 85) {
    memoryCard.style.background = 'linear-gradient(135deg, #dc2626, #991b1b)'; // Red
  } else if (memoryPercent > 75) {
    memoryCard.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)'; // Yellow
  } else {
    memoryCard.style.background = 'linear-gradient(135deg, #3b82f6, #1d4ed8)'; // Blue
  }

  // CPU card colors
  if (cpuPercent > 80) {
    cpuCard.style.background = 'linear-gradient(135deg, #dc2626, #991b1b)'; // Red
  } else if (cpuPercent > 60) {
    cpuCard.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)'; // Yellow
  } else {
    cpuCard.style.background = 'linear-gradient(135deg, #10b981, #059669)'; // Green
  }
}

async function loadResourceHistory() {
  try {
    setLoading("loadResourceHistory", true);
    showMessage("resourceMsg", "Loading resource history...");

    const response = await API("/admin/resources/history?minutes=60");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const result = await response.json();
    if (!result.success) throw new Error(result.error);

    const history = result.data.history;
    const historyContainer = $("resource-history");

    if (history.length === 0) {
      setSecureContent(historyContainer, createElement('div', {
        style: { color: '#9ca3af', textAlign: 'center', padding: '40px' },
        textContent: 'No history data available yet'
      }));
      return;
    }

    // Create secure resource history chart (data comes from trusted admin backend)
    const chartContainer = createElement('div', {
      style: { fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.4' }
    });

    const headerGrid = createElement('div', {
      style: { display: 'grid', gridTemplateColumns: '60px 1fr', gap: '12px', marginBottom: '16px' }
    });

    const memoryHeader = createElement('div', {
      style: { fontWeight: 'bold', color: '#3b82f6' },
      textContent: 'Memory'
    });

    const cpuHeader = createElement('div', {
      style: { fontWeight: 'bold', color: '#10b981' },
      textContent: 'CPU'
    });

    headerGrid.appendChild(memoryHeader);
    headerGrid.appendChild(cpuHeader);
    chartContainer.appendChild(headerGrid);

    // Show last 12 data points (1 hour with 5min intervals)
    const recent = history.slice(-12);
    recent.forEach((point, i) => {
      // Validate and sanitize numeric data (admin backend data should be clean, but safety first)
      const safeMemory = Math.max(0, Math.min(100, Number(point.memory) || 0));
      const safeCpu = Math.max(0, Math.min(100, Number(point.cpu) || 0));
      const safeAlertCount = Math.max(0, Number(point.alertCount) || 0);

      const time = new Date(point.timestamp).toLocaleTimeString().slice(0, 5);
      const memBar = '█'.repeat(Math.floor(safeMemory / 5)) + '░'.repeat(20 - Math.floor(safeMemory / 5));
      const cpuBar = '█'.repeat(Math.floor(safeCpu / 5)) + '░'.repeat(20 - Math.floor(safeCpu / 5));

      const rowDiv = createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: '60px 200px 50px 200px 50px 60px',
          gap: '8px',
          padding: '2px 0',
          alignItems: 'center'
        }
      });

      const timeDiv = createElement('div', { style: { color: '#9ca3af' }, textContent: time });
      const memBarDiv = createElement('div', { style: { color: '#3b82f6', fontFamily: 'monospace' }, textContent: memBar });
      const memPctDiv = createElement('div', { style: { color: '#3b82f6' }, textContent: `${safeMemory.toFixed(1)}%` });
      const cpuBarDiv = createElement('div', { style: { color: '#10b981', fontFamily: 'monospace' }, textContent: cpuBar });
      const cpuPctDiv = createElement('div', { style: { color: '#10b981' }, textContent: `${safeCpu.toFixed(1)}%` });
      const statusDiv = createElement('div', {
        style: { color: safeAlertCount > 0 ? '#ef4444' : '#9ca3af' },
        textContent: safeAlertCount > 0 ? `${safeAlertCount} alerts` : 'OK'
      });

      rowDiv.appendChild(timeDiv);
      rowDiv.appendChild(memBarDiv);
      rowDiv.appendChild(memPctDiv);
      rowDiv.appendChild(cpuBarDiv);
      rowDiv.appendChild(cpuPctDiv);
      rowDiv.appendChild(statusDiv);

      chartContainer.appendChild(rowDiv);
    });

    const legendDiv = createElement('div', {
      style: { fontSize: '10px', color: '#9ca3af', marginTop: '12px', textAlign: 'center' },
      textContent: 'Each █ represents 5% usage'
    });

    chartContainer.appendChild(legendDiv);
    setSecureContent(historyContainer, chartContainer);
    showMessage("resourceMsg", `✓ Loaded ${recent.length} data points`, false);

  } catch (error) {
    console.error("Resource history error:", error);
    showMessage("resourceMsg", `✗ ${escapeHtml(error.message)}`, true);
    setSecureContent($("resource-history"), createElement('div', {
      style: { color: '#ef4444', textAlign: 'center', padding: '40px' },
      textContent: 'Failed to load history'
    }));
  } finally {
    setLoading("loadResourceHistory", false);
  }
}

async function checkUpgradeNeeded() {
  try {
    setLoading("checkUpgrade", true);
    showMessage("resourceMsg", "Analyzing upgrade requirements...");

    const response = await API("/admin/resources/upgrade-check");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const result = await response.json();
    if (!result.success) throw new Error(result.error);

    const upgrade = result.data;
    const container = $("recommendations-container");

    let html = `
      <div style="border-left: 4px solid ${upgrade.immediate ? '#dc2626' : upgrade.recommended ? '#f59e0b' : '#10b981'}; padding-left: 16px; margin-bottom: 20px;">
        <h5 style="margin: 0 0 8px; color: ${upgrade.immediate ? '#dc2626' : upgrade.recommended ? '#f59e0b' : '#10b981'};">
          ${upgrade.immediate ? '🔥 IMMEDIATE UPGRADE REQUIRED' : upgrade.recommended ? '⚠️ UPGRADE RECOMMENDED' : '✅ CURRENT RESOURCES SUFFICIENT'}
        </h5>
        <div style="color: #e5e5e5; margin-bottom: 12px;">
          ${upgrade.reasoning.join(' • ')}
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
        <div style="background: #2d2d2d; padding: 16px; border-radius: 8px; border: 1px solid #444;">
          <h6 style="margin: 0 0 8px; color: #9ca3af;">Current Configuration</h6>
          <div style="color: #e5e5e5;">
            <div>💻 ${upgrade.currentSpecs.vcpu} vCPU</div>
            <div>💾 ${upgrade.currentSpecs.ram} RAM</div>
            <div>💰 ${upgrade.currentSpecs.cost}</div>
          </div>
        </div>

        <div style="background: #2d2d2d; padding: 16px; border-radius: 8px; border: 1px solid ${upgrade.recommended ? '#f59e0b' : '#444'};">
          <h6 style="margin: 0 0 8px; color: ${upgrade.recommended ? '#f59e0b' : '#9ca3af'};">Recommended Configuration</h6>
          <div style="color: #e5e5e5;">
            <div>💻 ${upgrade.recommendedSpecs.vcpu} vCPU</div>
            <div>💾 ${upgrade.recommendedSpecs.ram} RAM</div>
            <div>💰 ${upgrade.recommendedSpecs.cost}</div>
          </div>
        </div>
      </div>
    `;

    // Secure upgrade analysis display
    setSecureContent(container, '');

    const upgradeDiv = createElement('div', {
      style: {
        padding: '20px',
        borderRadius: '8px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        marginBottom: '20px'
      }
    });

    const titleDiv = createElement('div', {
      style: { fontSize: '20px', fontWeight: 'bold', marginBottom: '16px' },
      textContent: '💡 Recommended Upgrade Path'
    });

    const currentDiv = createElement('div', {
      style: { marginBottom: '16px' }
    });
    const currentTitle = createElement('div', {
      style: { fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' },
      textContent: '📊 Current Resources'
    });
    const currentCpu = createElement('div', {
      textContent: `🔥 ${escapeHtml(String(upgrade.current.cpu))}% CPU`
    });
    const currentMemory = createElement('div', {
      textContent: `💾 ${escapeHtml(String(upgrade.current.memory))}% Memory`
    });
    currentDiv.appendChild(currentTitle);
    currentDiv.appendChild(currentCpu);
    currentDiv.appendChild(currentMemory);

    const recommendedDiv = createElement('div');
    const recommendedTitle = createElement('div', {
      style: { fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' },
      textContent: '🚀 Recommended Specs'
    });
    const recommendedCpu = createElement('div', {
      textContent: `🔥 ${escapeHtml(upgrade.recommendedSpecs.cpu)}`
    });
    const recommendedRam = createElement('div', {
      textContent: `💾 ${escapeHtml(upgrade.recommendedSpecs.ram)} RAM`
    });
    const recommendedCost = createElement('div', {
      textContent: `💰 ${escapeHtml(upgrade.recommendedSpecs.cost)}`
    });
    recommendedDiv.appendChild(recommendedTitle);
    recommendedDiv.appendChild(recommendedCpu);
    recommendedDiv.appendChild(recommendedRam);
    recommendedDiv.appendChild(recommendedCost);

    upgradeDiv.appendChild(titleDiv);
    upgradeDiv.appendChild(currentDiv);
    upgradeDiv.appendChild(recommendedDiv);

    container.appendChild(upgradeDiv);
    showMessage("resourceMsg", `✓ Upgrade analysis complete`, false);

  } catch (error) {
    console.error("Upgrade check error:", error);
    showMessage("resourceMsg", `✗ ${error.message}`, true);
  } finally {
    setLoading("checkUpgrade", false);
  }
}

// ---------- Auth flow ----------
async function checkAuthAndLoad() {
  try {
    const response = await API("/admin/ping");
    const data = await response.json();
    if (data.ok) { showMessage("authStatus","✓ Connected",false); await loadAllData(); }
    else { showMessage("authStatus","× Not authorized",true); clearAllTables(); }
  } catch { showMessage("authStatus","× Connection failed",true); clearAllTables(); }
}
function clearAllTables() {
  ["tokensTbl","serversTbl","feesTbl","treasuryTbl","adsTbl","tiersTbl","usersTbl","transactionsTbl","groupTipsTbl"].forEach(id => {
    const tbody = document.querySelector(`#${id} tbody`); if (tbody) setSecureContent(tbody, '');
  });
}
$("saveSecret").onclick = () => {
  const secret = $("secret").value.trim();
  if (!secret) return showMessage("authStatus","Please enter admin secret",true);
  localStorage.setItem("pip_admin_secret", secret);
  checkAuthAndLoad();
};

// ---------- Config ----------
async function loadConfig() {
  try {
    const r = await API("/admin/config"); const j = await r.json();
    if (j.ok && j.config) {
      ["minDeposit","minWithdraw","withdrawMaxPerTx","withdrawDailyCap"].forEach(k => {
        const input = $(k); if (input) input.value = j.config[k] ?? "";
      });
    }
  } catch { showMessage("cfgMsg","Failed to load configuration",true); }
}
$("saveCfg").onclick = async () => {
  setLoading("saveCfg", true);
  try {
    const body = {
      minDeposit: Number($("minDeposit").value),
      minWithdraw: Number($("minWithdraw").value),
      withdrawMaxPerTx: Number($("withdrawMaxPerTx").value),
      withdrawDailyCap: Number($("withdrawDailyCap").value),
    };
    const r = await API("/admin/config",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const j = await r.json();
    showMessage("cfgMsg", j.ok ? "Configuration saved" : (j.error || "Save failed"), !j.ok);
  } catch { showMessage("cfgMsg","Network error",true); }
  finally { setLoading("saveCfg", false); }
};
$("reloadCfg").onclick = async () => {
  try { await API("/admin/reload-config",{method:"POST"}); showMessage("cfgMsg","Cache reloaded successfully",false); }
  catch { showMessage("cfgMsg","Reload failed",true); }
};

// ---------- Tiers ----------
async function loadTierTokenOptions() {
  try {
    const r = await API("/admin/tokens");
    const j = await r.json();
    if (!j.ok) return;
    const sel = $("tierToken");
    setSecureContent(sel, '');
    (j.tokens || []).forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.symbol}`;
      sel.appendChild(opt);
    });
  } catch {}
}

async function loadTiers() {
  try {
    const r = await API("/admin/tiers");
    const j = await r.json();
    if (!j.ok) return showMessage("tierMsg","Failed to load tiers",true);
    const tb = $("tiersTbl").querySelector("tbody");
    setSecureContent(tb, '');
    (j.tiers || []).forEach(t => {
      const tierRow = createTierTableRow(t);
      tb.appendChild(tierRow);
    });
    tb.querySelectorAll(".saveTier").forEach(btn => btn.onclick = async (ev) => {
      const row = ev.target.closest("tr");
      const id = row.dataset.id;
      const body = {
        name: row.querySelector('[data-field="name"]').value.trim(),
        priceAmount: Number(row.querySelector('[data-field="priceAmount"]').value),
        durationDays: Number(row.querySelector('[data-field="durationDays"]').value),
        tipTaxFree: row.querySelector('[data-field="tipTaxFree"]').checked,
        active: row.querySelector('[data-field="active"]').checked,
      };
      setLoading(ev.target, true);
      try {
        const r = await API(`/admin/tiers/${id}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "Save failed");
        ev.target.textContent = "✓ Saved"; setTimeout(()=>ev.target.textContent="Save", 1500);
        showMessage("tierMsg","Tier saved",false);
      } catch(e){ showMessage("tierMsg", e.message || "Save failed", true); }
      finally { setLoading(ev.target, false); }
    });
    showMessage("tierMsg", `Loaded ${j.tiers.length} tiers`, false);
  } catch { showMessage("tierMsg","Failed to load tiers",true); }
}

$("addTier").onclick = async () => {
  const name = $("tierName").value.trim();
  const description = $("tierDesc").value.trim();
  const tokenId = Number($("tierToken").value);
  const priceAmount = Number($("tierPrice").value);
  const durationDays = Number($("tierDays").value);
  const tipTaxFree = $("tierTaxFree").checked;
  if (!name || !tokenId || !priceAmount || !durationDays) return showMessage("tierMsg","Fill all fields",true);
  setLoading("addTier", true);
  try {
    const r = await API("/admin/tiers", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ name, description, tokenId, priceAmount, durationDays, tipTaxFree, active:true })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Create failed");
    $("tierName").value = ""; $("tierDesc").value = ""; $("tierPrice").value = ""; $("tierDays").value = ""; $("tierTaxFree").checked = false;
    await loadTiers(); showMessage("tierMsg","Tier created",false);
  } catch(e){ showMessage("tierMsg", e.message || "Create failed", true); }
  finally { setLoading("addTier", false); }
};
$("reloadTiers").onclick = () => loadTiers();

// ---------- Tokens ----------
async function loadTokens() {
  try {
    const r = await API("/admin/tokens"); const j = await r.json();
    if (!j.ok) return showMessage("tokenMsg","Failed to load tokens",true);
    const tbody = $("tokensTbl").querySelector("tbody"); setSecureContent(tbody, '');
    j.tokens.forEach(t => {
      const tokenRow = createTokenTableRow(t);
      tbody.appendChild(tokenRow);
    });
    tbody.querySelectorAll(".saveToken").forEach(btn => btn.onclick = () => saveToken(btn.dataset.id));
    tbody.querySelectorAll(".deleteToken").forEach(btn => btn.onclick = () => deleteToken(btn.dataset.id));
    
    // Add fee functionality
    setupFeeInputs(tbody);
  } catch { showMessage("tokenMsg","Failed to load tokens",true); }
}

async function saveToken(tokenId) {
  const btn = document.querySelector(`[data-id="${tokenId}"].saveToken`);
  const row = btn.closest("tr");
  setLoading(btn, true);
  try {
    const get = f => {
      const input = row.querySelector(`[data-field="${f}"]`);
      if (input.type === "checkbox") return input.checked;
      const v = input.value.trim(); return v === "" ? null : Number(v);
    };
    const getPercent = f => {
      const input = row.querySelector(`[data-field="${f}"]`);
      const v = input.value.trim();
      if (v === "") return null;
      return Math.round(Number(v) * 100); // Convert percentage to BPS
    };
    const body = {
      active: get("active"),
      minDeposit: get("minDeposit"),
      minWithdraw: get("minWithdraw"),
      tipFeeBps: getPercent("tipFeePercent"),
      houseFeeBps: getPercent("houseFeePercent"),
      withdrawMaxPerTx: get("withdrawMaxPerTx"),
      withdrawDailyCap: get("withdrawDailyCap"),
    };
    const r = await API(`/admin/tokens/${tokenId}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Save failed");
    btn.textContent = "✓ Saved"; setTimeout(()=>btn.textContent="Save", 2000);
  } catch (e){ alert(`Failed to save token: ${e.message}`); }
  finally { setLoading(btn, false); }
}

async function deleteToken(tokenId) {
  const btn = document.querySelector(`[data-id="${tokenId}"].deleteToken`);
  const row = btn.closest("tr");
  const tokenSymbol = row.querySelector("td:nth-child(2) strong").textContent;
  
  if (!confirm(`⚠️ DELETE TOKEN: ${tokenSymbol}?\\n\\nThis will permanently remove the token and may affect:\\n• User balances in this token\\n• Transaction history\\n• Tier pricing\\n\\nThis action CANNOT be undone. Continue?`)) {
    return;
  }
  
  setLoading(btn, true);
  try {
    const r = await API(`/admin/tokens/${tokenId}`, { method: "DELETE" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Delete failed");
    
    showMessage("tokenMsg", "Token " + tokenSymbol + " deleted successfully", false);
    await loadTokens();
  } catch (e) {
    alert("Failed to delete token: " + e.message);
    showMessage("tokenMsg", "Failed to delete " + tokenSymbol, true);
  } finally {
    setLoading(btn, false);
  }
}

$("addToken").onclick = async () => {
  const address = $("newTokenAddress").value.trim();
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return showMessage("tokenMsg","Please enter a valid contract address",true);
  setLoading("addToken", true);
  try {
    const r = await API("/admin/tokens",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({address})});
    const j = await r.json();
    if (!j.ok) return showMessage("tokenMsg", j.error || "Failed to add token", true);
    showMessage("tokenMsg", `Added ${j.token.symbol} token`, false);
    $("newTokenAddress").value = ""; await loadTokens();
  } catch { showMessage("tokenMsg","Network error",true); }
  finally { setLoading("addToken", false); }
};
$("refreshTokens").onclick = async () => {
  try { await API("/admin/tokens/refresh",{method:"POST"}); await loadTokens(); showMessage("tokenMsg","Token cache refreshed",false); }
  catch { showMessage("tokenMsg","Refresh failed",true); }
};

// ---------- Servers ----------
async function loadServers() {
  try {
    const r = await API("/admin/servers"); const j = await r.json();
    if (!j.ok) return;
    const tbody = $("serversTbl").querySelector("tbody"); setSecureContent(tbody, '');
    j.servers.forEach(s => {
      const serverRow = createServerTableRow(s);
      tbody.appendChild(serverRow);
    });
    tbody.querySelectorAll(".saveServer").forEach(b => b.onclick = () => saveServer(b.dataset.id));
    tbody.querySelectorAll(".deleteServer").forEach(b => b.onclick = () => deleteServer(b.dataset.id));
  } catch (e){ console.error("Failed to load servers:", e); }
}

async function saveServer(id) {
  const btn = document.querySelector(`[data-id="${id}"].saveServer`);
  const row = btn.closest("tr");
  setLoading(btn, true);
  try {
    const enabled = row.querySelector('[data-field="enabled"]').checked;
    const note = row.querySelector('[data-field="note"]').value.trim();
    const r = await API(`/admin/servers/${id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled,note})});
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Save failed");
    btn.textContent = "✓ Saved"; setTimeout(()=>btn.textContent="Save", 2000);
    row.querySelector(".status-indicator").className = `status-indicator ${enabled?'online':'offline'}`;
  } catch(e){ alert(`Failed to save server: ${e.message}`); }
  finally { setLoading(btn, false); }
}

async function deleteServer(id) {
  const btn = document.querySelector(`[data-id="${id}"].deleteServer`);
  const row = btn.closest("tr");
  const serverName = row.querySelector("td:nth-child(2) strong").textContent;
  
  if (!confirm(`Are you sure you want to delete server "${serverName}"? This action cannot be undone.`)) {
    return;
  }
  
  setLoading(btn, true);
  try {
    const r = await API(`/admin/servers/${id}`, {method:"DELETE"});
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Delete failed");
    row.remove();
  } catch(e){ alert(`Failed to delete server: ${e.message}`); }
  finally { setLoading(btn, false); }
}

$("addServer").onclick = async () => {
  const guildId = $("newGuildId").value.trim(); const note = $("newGuildNote").value.trim();
  if (!guildId || !/^[0-9]+$/.test(guildId)) return alert("Please enter a valid Guild ID");
  setLoading("addServer", true);
  try {
    const r = await API("/admin/servers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({guildId,note})});
    const j = await r.json();
    if (!j.ok) return alert(j.error || "Failed to add server");
    $("newGuildId").value = ""; $("newGuildNote").value = ""; await loadServers();
  } catch { alert("Network error"); }
  finally { setLoading("addServer", false); }
};

// ---------- Treasury ----------
async function loadTreasury(force=false) {
  try {
    const r = await API(`/admin/treasury${force?'?force=1':''}`); const j = await r.json();
    const tbody = $("treasuryTbl").querySelector("tbody"); setSecureContent(tbody, '');
    if (!j.ok) return showMessage("treasuryMsg","Failed to load treasury",true);
    // ETH row (gas) - add empty cells for USD columns
    const ethCells = [
      { innerHTML: '<strong>ETH (gas)</strong>', trusted: true },
      { textContent: escapeHtml(j.ethHuman) },
      { textContent: 'N/A' },
      { textContent: 'N/A' }
    ];
    const ethRow = createTableRow(ethCells);
    tbody.appendChild(ethRow);

    // Token rows with USD values
    (j.tokens || []).forEach(t => {
      const tokenRow = createTreasuryRow(t);
      tbody.appendChild(tokenRow);
    });

    // Add total USD row if available
    if (j.totalTreasuryUSD !== undefined) {
      const totalCells = [
        { innerHTML: '<strong>TOTAL USD VALUE</strong>', trusted: true },
        { textContent: '—' },
        { innerHTML: `<strong>${j.formattedTotalUSD || `$${j.totalTreasuryUSD.toFixed(2)}`}</strong>`, trusted: true },
        { textContent: '—' }
      ];
      const totalRow = createTableRow(totalCells);
      totalRow.style.borderTop = '2px solid #60a5fa';
      totalRow.style.backgroundColor = '#1f2937';
      tbody.appendChild(totalRow);
    }

    let statusMsg = `Updated at ${new Date(j.ts).toLocaleTimeString()}`;
    if (j.priceDisclaimer) {
      statusMsg += ` • ${j.priceDisclaimer}`;
    }
    showMessage("treasuryMsg", statusMsg, false);

    // Switch to refresh mode after first load
    $("loadTreasury").style.display = "none";
    $("reloadTreasury").style.display = "inline-block";
  } catch { showMessage("treasuryMsg","Failed to load treasury",true); }
}
$("reloadTreasury").onclick = () => loadTreasury(true);

// ---------- Ads ----------
async function loadAds() {
  try {
    const r = await API("/admin/ads"); const j = await r.json();
    if (!j.ok) return showMessage("adsMsg","Failed to load ads",true);
    const tb = $("adsTbl").querySelector("tbody"); setSecureContent(tb, '');
    (j.ads || []).forEach(ad => {
      const adRow = createAdTableRow(ad);
      tb.appendChild(adRow);
    });
    tb.querySelectorAll(".saveAd").forEach(btn => btn.onclick = async (ev) => {
      const row = ev.target.closest("tr"); await saveAd(row.dataset.id, row, btn);
    });
    tb.querySelectorAll(".deleteAd").forEach(btn => btn.onclick = async (ev) => {
      const row = ev.target.closest("tr"); const id = row.dataset.id;
      if (!confirm("Delete this ad?")) return;
      setLoading(btn, true);
      try {
        const r = await API(`/admin/ads/${id}`, { method:"DELETE" }); const j = await r.json();
        if (!j.ok) throw new Error(j.error || "Delete failed");
        row.remove(); showMessage("adsMsg","Ad deleted",false);
      } catch(e){ showMessage("adsMsg", e.message || "Delete failed", true); }
      finally { setLoading(btn, false); }
    });
    showMessage("adsMsg", `Loaded ${j.ads.length} ads`, false);
  } catch { showMessage("adsMsg","Failed to load ads",true); }
}

async function saveAd(id, row, buttonEl) {
  const get = (name) => row.querySelector(`[data-field="${name}"]`);
  const text = get("text").value.trim();
  const url = get("url").value.trim();
  const weight = Number(get("weight").value.trim());
  const active = get("active").checked;
  const body = { text, url, weight, active };
  setLoading(buttonEl, true);
  try {
    const r = await API(`/admin/ads/${id}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || "Save failed");
    row.querySelector(".status-indicator").className = `status-indicator ${active?'online':'offline'}`;
    buttonEl.textContent = "✓ Saved"; setTimeout(()=>{ buttonEl.textContent="Save"; }, 1500);
    showMessage("adsMsg","Ad saved",false);
  } catch(e){ showMessage("adsMsg", e.message || "Save failed", true); }
  finally { setLoading(buttonEl, false); }
}

$("addAd").onclick = async () => {
  const text = $("adText").value.trim();
  const url = $("adUrl").value.trim();
  const weight = Number($("adWeight").value || 5);
  const active = $("adActive").checked;
  if (!text) return showMessage("adsMsg","Ad text is required",true);
  if (text.length > 500) return showMessage("adsMsg","Ad text too long",true);
  setLoading("addAd", true);
  try {
    const r = await API("/admin/ads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,url,weight,active})});
    const j = await r.json(); if (!j.ok) throw new Error(j.error || "Create failed");
    $("adText").value = ""; $("adUrl").value = ""; $("adWeight").value = "5"; $("adActive").checked = true;
    await loadAds(); showMessage("adsMsg","Ad created",false);
  } catch(e){ showMessage("adsMsg", e.message || "Create failed", true); }
  finally { setLoading("addAd", false); }
};
$("refreshAdsCache").onclick = async () => {
  setLoading("refreshAdsCache", true);
  try {
    const r = await API("/admin/ads/refresh",{method:"POST"}); const j = await r.json();
    showMessage("adsMsg", j.ok ? "Ad cache refreshed" : (j.error || "Refresh failed"), !j.ok);
  } catch { showMessage("adsMsg","Refresh failed",true); }
  finally { setLoading("refreshAdsCache", false); }
};
$("reloadAds").onclick = () => loadAds();

// ---------- Fees ----------
async function loadFees() {
  const since = $("feesSince").value, until = $("feesUntil").value, guildId = $("feesGuild").value.trim();
  setLoading("loadFees", true);
  try {
    const p = new URLSearchParams(); if (since) p.set("since", since); if (until) p.set("until", until); if (guildId) p.set("guildId", guildId);
    const r = await API(`/admin/fees/by-server?${p.toString()}`); const j = await r.json();
    if (!j.ok) return showMessage("feesMsg","Failed to load fees",true);
    const tbody = $("feesTbl").querySelector("tbody"); setSecureContent(tbody, '');
    let totalTipFees = 0, totalMatchRake = 0;
    j.rows.forEach(row => {
      const tip = parseFloat(row.tipFees), rake = parseFloat(row.matchRake), total = tip + rake;
      totalTipFees += tip; totalMatchRake += rake;
      const cells = [
        { textContent: escapeHtml(row.guildId || 'Unknown') },
        { innerHTML: `<strong>${escapeHtml(row.token)}</strong>`, trusted: true },
        { textContent: formatNumber(tip) },
        { textContent: formatNumber(rake) },
        { innerHTML: `<strong>${formatNumber(total)}</strong>`, trusted: true }
      ];
      const feeRow = createTableRow(cells);
      tbody.appendChild(feeRow);
    });
    if (j.rows.length > 1) {
      const totalCells = [
        { innerHTML: '<strong>TOTAL</strong>', trusted: true, attributes: { colspan: '2' } },
        { innerHTML: `<strong>${formatNumber(totalTipFees)}</strong>`, trusted: true },
        { innerHTML: `<strong>${formatNumber(totalMatchRake)}</strong>`, trusted: true },
        { innerHTML: `<strong>${formatNumber(totalTipFees + totalMatchRake)}</strong>`, trusted: true }
      ];
      const totalRow = createTableRow(totalCells);
      totalRow.style.borderTop = '2px solid #444';
      totalRow.style.fontWeight = 'bold';
      tbody.appendChild(totalRow);
    }
    showMessage("feesMsg", `Loaded ${j.rows.length} entries`, false);
  } catch { showMessage("feesMsg","Failed to load fees",true); }
  finally { setLoading("loadFees", false); }
}
$("loadFees").onclick = loadFees;
$("csvFees").onclick = async () => {
  try {
    const p = new URLSearchParams();
    const since = $("feesSince").value, until = $("feesUntil").value, guildId = $("feesGuild").value.trim();
    if (since) p.set("since", since); if (until) p.set("until", until); if (guildId) p.set("guildId", guildId);
    const r = await API(`/admin/fees/export.csv?${p.toString()}`); const blob = await r.blob();
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `house_fees_${since || 'all'}_to_${until || 'now'}.csv`; a.click(); URL.revokeObjectURL(url);
  } catch { showMessage("feesMsg","Export failed",true); }
};

// ---------- Fee Input Enhancement ----------
function setupFeeInputs(container) {
  // Setup preset buttons
  container.querySelectorAll('.preset-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const targetField = btn.dataset.field;
      const value = btn.dataset.value;
      const input = btn.closest('.fee-input-container').querySelector(`[data-field="${targetField}"]`);
      input.value = value;
      updateFeePreview(input);
    };
  });

  // Setup live preview on input change
  container.querySelectorAll('[data-field="tipFeePercent"], [data-field="houseFeePercent"]').forEach(input => {
    input.addEventListener('input', () => updateFeePreview(input));
    updateFeePreview(input); // Initial preview
  });
}

function updateFeePreview(input) {
  const container = input.closest('.fee-input-container');
  const previewDiv = container.querySelector('.fee-preview');
  const value = parseFloat(input.value) || 0;
  const isTipFee = input.dataset.field === 'tipFeePercent';
  
  // Clear existing classes
  previewDiv.className = 'fee-preview';
  
  if (value === 0) {
    previewDiv.textContent = isTipFee ? 'No tip fees' : 'No house rake';
    previewDiv.classList.add('fee-success');
  } else if (value > 0 && value <= 2) {
    const example = isTipFee ? `$${(100 * value / 100).toFixed(2)} fee on $100 tip` : `$${(100 * value / 100).toFixed(2)} rake on $100 match`;
    previewDiv.textContent = `${example} (${Math.round(value * 100)} BPS)`;
    previewDiv.classList.add('fee-success');
  } else if (value > 2 && value <= 5) {
    const example = isTipFee ? `$${(100 * value / 100).toFixed(2)} fee on $100 tip` : `$${(100 * value / 100).toFixed(2)} rake on $100 match`;
    previewDiv.textContent = `⚠️ ${example} (${Math.round(value * 100)} BPS)`;
    previewDiv.classList.add('fee-warning');
  } else if (value > 5) {
    const example = isTipFee ? `$${(100 * value / 100).toFixed(2)} fee on $100 tip` : `$${(100 * value / 100).toFixed(2)} rake on $100 match`;
    previewDiv.textContent = `🚨 HIGH FEE: ${example} (${Math.round(value * 100)} BPS)`;
    previewDiv.classList.add('fee-error');
  } else {
    previewDiv.textContent = '';
  }
}

// ---------- Users ----------
async function findUser() {
  const query = $("searchUser").value.trim();
  if (!query) return showMessage("userMsg", "Enter Discord ID or wallet address", true);
  
  setLoading("findUser", true);
  try {
    const r = await API(`/admin/users/search?q=${encodeURIComponent(query)}`);
    const j = await r.json();
    if (!j.ok) return showMessage("userMsg", j.error || "User not found", true);
    
    displayUsers([j.user]);
    showMessage("userMsg", "User found", false);
  } catch {
    showMessage("userMsg", "Search failed", true);
  } finally {
    setLoading("findUser", false);
  }
}

async function loadTopUsers() {
  setLoading("loadTopUsers", true);
  try {
    console.log("🔄 Loading top users...");
    const r = await API("/admin/users/top");
    console.log("📡 API Response status:", r.status);
    const j = await r.json();
    console.log("📊 API Response data:", j);
    
    // Handle authentication error specifically
    if (r.status === 401) {
      console.error("❌ Authentication failed");
      return showMessage("userMsg", "Authentication failed - please check your admin secret", true);
    }
    
    if (!j.ok) {
      console.error("❌ API returned error:", j.error);
      return showMessage("userMsg", j.error || "Failed to load users", true);
    }
    
    console.log(`✅ Received ${j.users?.length || 0} users from API`);
    displayUsers(j.users || []);
    showMessage("userMsg", `Loaded ${j.users?.length || 0} users`, false);
  } catch (error) {
    console.error("❌ Failed to load users:", error);
    showMessage("userMsg", "Failed to load users - " + error.message, true);
  } finally {
    setLoading("loadTopUsers", false);
  }
}

async function addTokenToUser(discordId, buttonElement) {
  console.log(`🔍 addTokenToUser called for user ${discordId}`);

  // Immediate button disable to prevent double-clicking
  if (buttonElement.disabled) {
    console.log('⚠️ Button already disabled, ignoring click');
    return;
  }
  buttonElement.disabled = true;

  // Create inline add form
  const container = buttonElement.closest('.add-token-container');

  // More robust prevention of multiple forms
  if (container && container.querySelector('.add-token-form')) {
    console.log('⚠️ Form already exists in container, aborting');
    buttonElement.disabled = false;
    return; // Form already exists, don't create another
  }

  // Also check if any form is already open globally for this user
  if (document.querySelector(`.add-token-form[data-discord-id="${discordId}"]`)) {
    console.log('⚠️ Form already exists globally for this user, aborting');
    buttonElement.disabled = false;
    return; // Another form is already open for this user
  }

  // Get all active tokens for dropdown
  const tokensResponse = await API("/admin/tokens");
  const tokensData = await tokensResponse.json();
  const activeTokens = tokensData.tokens ? tokensData.tokens.filter(t => t.active) : [];
  
  if (activeTokens.length === 0) {
    alert('No active tokens available to add');
    return;
  }
  
  // Create add form
  const addForm = document.createElement('div');
  addForm.className = 'add-token-form'; // Add class for detection
  addForm.setAttribute('data-discord-id', discordId); // Add discord ID for global tracking
  addForm.style.cssText = 'display:block; background:#2a2a2a; padding:12px; border-radius:6px; border:1px solid #444; margin-top:8px;';
  // Create secure form elements
  const titleDiv = createElement('div', {
    style: { marginBottom: '8px', fontWeight: 'bold', color: '#e5e5e5' },
    textContent: 'Add Token to User'
  });

  const tokenSelect = createElement('select', {
    className: 'token-select',
    style: { padding: '6px', marginRight: '6px', background: '#222', color: '#e5e5e5', border: '1px solid #444', borderRadius: '4px', width: '120px' }
  });
  const defaultOption = createElement('option', {
    attributes: { value: '' },
    textContent: 'Select Token...'
  });
  tokenSelect.appendChild(defaultOption);
  activeTokens.forEach(token => {
    const option = createElement('option', {
      attributes: { value: String(token.id) },
      textContent: escapeHtml(token.symbol)
    });
    tokenSelect.appendChild(option);
  });

  const amountInput = createElement('input', {
    className: 'amount-input',
    attributes: {
      type: 'number',
      step: '0.01',
      max: '999999999.99',
      value: '0',
      placeholder: 'Amount'
    },
    style: { width: '120px', padding: '6px', marginRight: '6px', background: '#222', color: '#e5e5e5', border: '1px solid #444', borderRadius: '4px' }
  });

  const reasonInput = createElement('input', {
    className: 'reason-input',
    attributes: {
      type: 'text',
      placeholder: 'Reason (optional)'
    },
    style: { width: '150px', padding: '6px', marginRight: '6px', background: '#222', color: '#e5e5e5', border: '1px solid #444', borderRadius: '4px' }
  });

  const breakEl = createElement('br', { style: { marginBottom: '8px' } });

  const saveBtn = createElement('button', {
    className: 'save-token',
    textContent: '💾 Add Token',
    style: { background: '#059669', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', marginRight: '6px' }
  });

  const cancelBtn = createElement('button', {
    className: 'cancel-token',
    textContent: '❌ Cancel',
    style: { background: '#6b7280', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }
  });

  addForm.appendChild(titleDiv);
  addForm.appendChild(tokenSelect);
  addForm.appendChild(amountInput);
  addForm.appendChild(reasonInput);
  addForm.appendChild(breakEl);
  addForm.appendChild(saveBtn);
  addForm.appendChild(cancelBtn);
  
  // Hide add button and show form
  buttonElement.style.display = 'none';
  container.appendChild(addForm);
  
  // Focus on token selector
  addForm.querySelector('.token-select').focus();
  
  // Add event handlers
  addForm.querySelector('.cancel-token').onclick = () => {
    console.log('🚫 Form cancelled, re-enabling button');
    buttonElement.disabled = false;
    buttonElement.style.display = 'inline-block';
    addForm.remove();
  };
  
  addForm.querySelector('.save-token').onclick = async () => {
    const tokenId = parseInt(addForm.querySelector('.token-select').value);
    const amount = parseFloat(addForm.querySelector('.amount-input').value);
    const reason = addForm.querySelector('.reason-input').value.trim();
    
    if (!tokenId) {
      alert('Please select a token');
      return;
    }
    
    if (isNaN(amount) || amount < 0) {
      alert('Please enter a valid amount');
      return;
    }
    
    // Enforce 2 decimal places limit for user-friendliness
    const decimalPlaces = (amount.toString().split('.')[1] || '').length;
    if (decimalPlaces > 2) {
      alert('Please limit your amount to 2 decimal places (e.g., 10.50).');
      return;
    }
    
    try {
      const saveBtn = addForm.querySelector('.save-token');
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ Adding...';
      
      const response = await API('/admin/users/adjust-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discordId,
          tokenId,
          amount,
          reason: reason || `Admin granted token via web interface`
        })
      });
      
      const result = await response.json();
      if (result.ok) {
        // Success - refresh the users table
        await loadTopUsers();
        showMessage("userMsg", `✅ Token added successfully`, false);
      } else {
        throw new Error(result.error || 'Failed to add token');
      }
    } catch (error) {
      console.error('Add token failed:', error);
      alert(`Failed to add token: ${error.message}`);
      // Restore form
      addForm.querySelector('.save-token').disabled = false;
      addForm.querySelector('.save-token').textContent = '💾 Add Token';
    }
  };
}

async function editBalance(discordId, tokenSymbol, currentAmount, buttonElement) {
  // Create inline edit form
  const balanceItem = buttonElement.closest('.balance-item');
  const displaySpan = balanceItem.querySelector('.balance-display');
  
  // Get all active tokens for dropdown
  const tokensResponse = await API("/admin/tokens");
  const tokensData = await tokensResponse.json();
  const activeTokens = tokensData.tokens || [];
  
  // Create edit form
  const editForm = document.createElement('div');
  editForm.style.cssText = 'display:inline-block; background:#2a2a2a; padding:8px; border-radius:6px; border:1px solid #444;';
  // Create secure edit form elements
  const editTokenSelect = createElement('select', {
    className: 'token-select',
    style: { padding: '4px', marginRight: '6px', background: '#222', color: '#e5e5e5', border: '1px solid #444', borderRadius: '4px' }
  });
  activeTokens.forEach(token => {
    const option = createElement('option', {
      attributes: {
        value: String(token.id),
        ...(token.symbol === tokenSymbol ? { selected: true } : {})
      },
      textContent: escapeHtml(token.symbol)
    });
    editTokenSelect.appendChild(option);
  });

  const editAmountInput = createElement('input', {
    className: 'amount-input',
    attributes: {
      type: 'number',
      step: '0.01',
      max: '999999999.99',
      value: String(currentAmount),
      placeholder: 'Amount'
    },
    style: { width: '120px', padding: '4px', marginRight: '6px', background: '#222', color: '#e5e5e5', border: '1px solid #444', borderRadius: '4px' }
  });

  const editReasonInput = createElement('input', {
    className: 'reason-input',
    attributes: {
      type: 'text',
      placeholder: 'Reason (optional)'
    },
    style: { width: '150px', padding: '4px', marginRight: '6px', background: '#222', color: '#e5e5e5', border: '1px solid #444', borderRadius: '4px' }
  });

  const editSaveBtn = createElement('button', {
    className: 'save-balance',
    textContent: '💾 Save',
    style: { background: '#059669', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', marginRight: '4px' }
  });

  const editCancelBtn = createElement('button', {
    className: 'cancel-balance',
    textContent: '❌ Cancel',
    style: { background: '#6b7280', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }
  });

  editForm.appendChild(editTokenSelect);
  editForm.appendChild(editAmountInput);
  editForm.appendChild(editReasonInput);
  editForm.appendChild(editSaveBtn);
  editForm.appendChild(editCancelBtn);
  
  // Hide display and show edit form
  displaySpan.style.display = 'none';
  buttonElement.style.display = 'none';
  balanceItem.appendChild(editForm);
  
  // Focus on amount input
  editForm.querySelector('.amount-input').focus();
  
  // Add event handlers
  editForm.querySelector('.cancel-balance').onclick = () => {
    displaySpan.style.display = 'inline';
    buttonElement.style.display = 'inline';
    editForm.remove();
  };
  
  editForm.querySelector('.save-balance').onclick = async () => {
    const tokenId = parseInt(editForm.querySelector('.token-select').value);
    const amount = parseFloat(editForm.querySelector('.amount-input').value);
    const reason = editForm.querySelector('.reason-input').value.trim();
    
    if (isNaN(amount) || amount < 0) {
      alert('Please enter a valid amount');
      return;
    }
    
    // Enforce 2 decimal places limit for user-friendliness
    const decimalPlaces = (amount.toString().split('.')[1] || '').length;
    if (decimalPlaces > 2) {
      alert('Please limit your amount to 2 decimal places (e.g., 10.50).');
      return;
    }
    
    try {
      const saveBtn = editForm.querySelector('.save-balance');
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ Saving...';
      
      const response = await API('/admin/users/adjust-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discordId,
          tokenId,
          amount,
          reason: reason || `Admin balance adjustment via web interface`
        })
      });
      
      const result = await response.json();
      if (result.ok) {
        // Success - refresh the users table
        await loadTopUsers();
        showMessage("userMsg", `✅ Balance updated successfully`, false);
      } else {
        throw new Error(result.error || 'Failed to update balance');
      }
    } catch (error) {
      console.error('Balance update failed:', error);
      alert(`Failed to update balance: ${error.message}`);
      // Restore form
      editForm.querySelector('.save-balance').disabled = false;
      editForm.querySelector('.save-balance').textContent = '💾 Save';
    }
  };
}

function displayUsers(users) {
  console.log("🎨 displayUsers called with:", users);
  const tbody = $("usersTbl").querySelector("tbody");
  if (!tbody) {
    console.error("❌ Could not find users table tbody element");
    return;
  }

  // Clear existing content securely
  setSecureContent(tbody, []);

  if (!users || users.length === 0) {
    console.log("ℹ️ No users to display");
    const noUsersRow = createTableRow([
      { attributes: { colspan: '10' }, style: { textAlign: 'center', color: '#9ca3af' }, textContent: 'No users found' }
    ]);
    tbody.appendChild(noUsersRow);
    return;
  }

  console.log(`🎯 Displaying ${users.length} users`);
  users.forEach((user, index) => {
    console.log(`👤 Processing user ${index + 1}:`, user);

    // Create secure user row with proper data escaping
    const userRow = createSecureUserRow(user);
    tbody.appendChild(userRow);
  });
  
  // Add export functionality
  tbody.querySelectorAll(".exportUser").forEach(btn => {
    btn.onclick = () => exportUserData(btn.dataset.discordId);
  });
  
  // Add balance editing functionality
  tbody.querySelectorAll(".edit-balance-btn").forEach(btn => {
    btn.onclick = () => editBalance(btn.dataset.discordId, btn.dataset.tokenSymbol, btn.dataset.currentAmount, btn);
  });
  
  // Add token functionality
  tbody.querySelectorAll(".add-token-btn").forEach(btn => {
    btn.onclick = () => addTokenToUser(btn.dataset.discordId, btn);
  });
  
  // Add delete functionality
  tbody.querySelectorAll(".deleteUser").forEach(btn => {
    btn.onclick = () => deleteUser(btn.dataset.discordId, false);
  });
  tbody.querySelectorAll(".hardDeleteUser").forEach(btn => {
    btn.onclick = () => deleteUser(btn.dataset.discordId, true);
  });
}

/**
 * Create a secure user table row with proper data escaping
 * @param {Object} user - User data
 * @returns {HTMLTableRowElement} - Secure user row
 */
function createSecureUserRow(user) {
  const tr = document.createElement('tr');

  // Username cell with escaping
  const usernameCell = createElement('td');
  const usernameStrong = createElement('strong', {
    textContent: escapeHtml(user.username || "Unknown")
  });
  usernameCell.appendChild(usernameStrong);

  // Discord ID cell
  const discordIdCell = createElement('td');
  const discordIdCode = createElement('code', {
    textContent: escapeHtml(user.discordId || "")
  });
  discordIdCell.appendChild(discordIdCode);

  // AGW Address cell
  const addressCell = createElement('td');
  const addressCode = createElement('code', {
    textContent: escapeHtml(user.agwAddress || "Not linked")
  });
  addressCell.appendChild(addressCode);

  // Date cells
  const createdCell = createElement('td', {
    textContent: new Date(user.createdAt).toLocaleDateString()
  });

  const lastActivityCell = createElement('td', {
    textContent: user.lastActivity ? new Date(user.lastActivity).toLocaleDateString() : "Never"
  });

  // Tip amount cells
  const tipsSentCell = createElement('td', {
    textContent: formatNumber(user.totalTipsSent || 0)
  });

  const tipsReceivedCell = createElement('td', {
    textContent: formatNumber(user.totalTipsReceived || 0)
  });

  // Memberships cell
  const memberships = user.membershipDetails?.map(m =>
    `${escapeHtml(m.tierName)} (${escapeHtml(m.status)})`
  ).join(", ") || "None";
  const membershipsCell = createElement('td', {
    textContent: memberships
  });

  // Balances cell - secure creation
  const balancesCell = createSecureBalancesCell(user);

  // Actions cell - secure creation
  const actionsCell = createSecureActionsCell(user.discordId);

  // Append all cells
  tr.appendChild(usernameCell);
  tr.appendChild(discordIdCell);
  tr.appendChild(addressCell);
  tr.appendChild(createdCell);
  tr.appendChild(lastActivityCell);
  tr.appendChild(tipsSentCell);
  tr.appendChild(tipsReceivedCell);
  tr.appendChild(membershipsCell);
  tr.appendChild(balancesCell);
  tr.appendChild(actionsCell);

  return tr;
}

/**
 * Create secure balances cell for user
 * @param {Object} user - User data
 * @returns {HTMLTableCellElement} - Secure balances cell
 */
function createSecureBalancesCell(user) {
  const balancesCell = createElement('td');

  if (user.balances && user.balances.length > 0) {
    user.balances.forEach(balance => {
      if (balance.amount > 0) {
        const balanceDiv = createElement('div', {
          className: 'balance-item',
          style: { marginBottom: '4px' }
        });

        const balanceSpan = createElement('span', {
          className: 'balance-display',
          textContent: `${formatNumber(balance.amount)} ${escapeHtml(balance.tokenSymbol)}`
        });

        const editBtn = createSecureButton('✏️', () => {
          editBalance(user.discordId, balance.tokenSymbol, balance.amount, editBtn);
        }, {
          className: 'edit-balance-btn',
          attributes: {
            'data-discord-id': escapeHtml(user.discordId),
            'data-token-symbol': escapeHtml(balance.tokenSymbol),
            'data-current-amount': escapeHtml(String(balance.amount))
          },
          style: {
            background: '#f59e0b',
            color: 'white',
            border: 'none',
            padding: '2px 6px',
            borderRadius: '3px',
            cursor: 'pointer',
            marginLeft: '8px',
            fontSize: '11px'
          }
        });

        balanceDiv.appendChild(balanceSpan);
        balanceDiv.appendChild(editBtn);
        balancesCell.appendChild(balanceDiv);
      }
    });
  } else {
    const noneSpan = createElement('span', {
      style: { color: '#9ca3af' },
      textContent: 'None'
    });
    balancesCell.appendChild(noneSpan);
  }

  // Add token button
  const addTokenContainer = createElement('div', {
    className: 'add-token-container',
    style: {
      marginTop: '8px',
      paddingTop: '8px',
      borderTop: '1px solid #374151'
    }
  });

  const addTokenBtn = createSecureButton('➕ Add Token', () => {
    addTokenToUser(user.discordId, addTokenBtn);
  }, {
    className: 'add-token-btn',
    attributes: {
      'data-discord-id': escapeHtml(user.discordId)
    },
    style: {
      background: '#059669',
      color: 'white',
      border: 'none',
      padding: '4px 8px',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '11px'
    }
  });

  addTokenContainer.appendChild(addTokenBtn);
  balancesCell.appendChild(addTokenContainer);

  return balancesCell;
}

/**
 * Create secure actions cell for user
 * @param {string} discordId - User's Discord ID
 * @returns {HTMLTableCellElement} - Secure actions cell
 */
function createSecureActionsCell(discordId) {
  const actionsCell = createElement('td');

  const exportBtn = createSecureButton('📊 Export CSV', () => {
    exportUserData(discordId);
  }, {
    className: 'exportUser',
    attributes: {
      'data-discord-id': escapeHtml(discordId)
    },
    style: {
      background: '#2563eb',
      color: 'white',
      border: 'none',
      padding: '4px 8px',
      borderRadius: '4px',
      cursor: 'pointer',
      marginRight: '4px'
    }
  });

  const br = document.createElement('br');

  const deleteBtn = createSecureButton('Delete (Anonymize)', () => {
    deleteUser(discordId, false);
  }, {
    className: 'deleteUser',
    attributes: {
      'data-discord-id': escapeHtml(discordId)
    },
    style: {
      background: '#f59e0b',
      color: 'white',
      border: 'none',
      padding: '3px 6px',
      borderRadius: '4px',
      cursor: 'pointer',
      marginRight: '4px',
      marginTop: '4px'
    }
  });

  const hardDeleteBtn = createSecureButton('Hard Delete', () => {
    deleteUser(discordId, true);
  }, {
    className: 'hardDeleteUser',
    attributes: {
      'data-discord-id': escapeHtml(discordId)
    },
    style: {
      background: '#dc2626',
      color: 'white',
      border: 'none',
      padding: '3px 6px',
      borderRadius: '4px',
      cursor: 'pointer',
      marginTop: '4px'
    }
  });

  actionsCell.appendChild(exportBtn);
  actionsCell.appendChild(br);
  actionsCell.appendChild(deleteBtn);
  actionsCell.appendChild(hardDeleteBtn);

  return actionsCell;
}

async function deleteUser(discordId, hardDelete = false) {
  // Validate and escape discordId for query selector
  const safeDiscordId = escapeHtml(discordId);
  const btn = document.querySelector(`[data-discord-id="${safeDiscordId}"]${hardDelete ? '.hardDeleteUser' : '.deleteUser'}`);
  const row = btn.closest("tr");
  const username = row.querySelector("td:first-child strong").textContent;

  // Escape user data for display
  const safeUsername = escapeHtml(username || 'Unknown');
  const safeDiscordIdDisplay = escapeHtml(discordId);

  // Different confirmation messages for different deletion types
  let confirmMessage, promptMessage, deleteType;

  if (hardDelete) {
    deleteType = "HARD DELETE";
    confirmMessage = `🚨 HARD DELETE USER: ${safeUsername}\n\nDiscord ID: ${safeDiscordIdDisplay}\n\nThis will PERMANENTLY REMOVE:\n• User account and profile\n• All token balances\n• ALL transaction history\n• Tier memberships\n• All tips sent/received (others' tip counts will decrease!)\n• Group tip participation\n• Match history\n\n⚠️ THIS AFFECTS OTHER USERS' STATISTICS!\n⚠️ THIS ACTION CANNOT BE UNDONE!\n\nOnly use for cleaning up test data!`;
    promptMessage = `To permanently HARD DELETE user "${safeUsername}" and remove all transaction history, type HARD DELETE in ALL CAPS:`;
  } else {
    deleteType = "SOFT DELETE";
    confirmMessage = `⚠️ DELETE USER: ${safeUsername}\n\nDiscord ID: ${safeDiscordIdDisplay}\n\nThis will:\n• Delete user account and profile\n• Delete token balances\n• Anonymize transaction history (preserves others' statistics)\n• Delete tier memberships\n• Anonymize tips (preserves tip counts for other users)\n• Anonymize group tip and match participation\n\n✅ Other users' statistics remain intact\n\nThis action CANNOT be undone!`;
    promptMessage = `To delete user "${safeUsername}" and anonymize their data, type DELETE in ALL CAPS:`;
  }

  // First confirmation
  if (!confirm(confirmMessage)) {
    return;
  }
  
  // Second confirmation with type verification
  const expectedInput = hardDelete ? "HARD DELETE" : "DELETE";
  const confirmation = prompt(promptMessage);
  if (confirmation !== expectedInput) {
    showMessage("userMsg", "User deletion cancelled", false);
    return;
  }
  
  setLoading(btn, true);
  try {
    const r = await API(`/admin/users/${encodeURIComponent(discordId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, hardDelete: hardDelete })
    });
    
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Delete failed");
    
    row.remove();
    const deleteTypeText = hardDelete ? "hard deleted" : "deleted and anonymized";
    showMessage("userMsg", `User ${username} ${deleteTypeText} successfully`, false);
  } catch (e) {
    showMessage("userMsg", `Failed to delete user: ${e.message}`, true);
  } finally {
    setLoading(btn, false);
  }
}

async function exportUserData(discordId) {
  const btn = document.querySelector(`[data-discord-id="${discordId}"].exportUser`);
  const row = btn.closest("tr");
  const username = row.querySelector("td:first-child strong").textContent;
  
  // Prompt for date range
  const since = prompt("Export from date (YYYY-MM-DD) or leave empty for all data:");
  const until = prompt("Export until date (YYYY-MM-DD) or leave empty for all data:");
  
  setLoading(btn, true);
  try {
    const params = new URLSearchParams();
    if (since && since.trim()) params.set("since", since.trim());
    if (until && until.trim()) params.set("until", until.trim());
    
    const url = `/admin/transactions/export/user/${encodeURIComponent(discordId)}?${params.toString()}`;
    const response = await API(url);
    
    if (!response.ok) throw new Error("Export failed");
    
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `user_${discordId}_activity_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(downloadUrl);
    
    showMessage("userMsg", `User data for ${username} exported successfully`, false);
  } catch (e) {
    showMessage("userMsg", `Failed to export user data: ${e.message}`, true);
  } finally {
    setLoading(btn, false);
  }
}

async function exportGuildData() {
  const guildId = prompt("Enter Guild/Server ID to export:");
  if (!guildId || !guildId.trim()) return;
  
  const since = prompt("Export from date (YYYY-MM-DD) or leave empty for all data:");
  const until = prompt("Export until date (YYYY-MM-DD) or leave empty for all data:");
  
  try {
    const params = new URLSearchParams();
    if (since && since.trim()) params.set("since", since.trim());
    if (until && until.trim()) params.set("until", until.trim());
    
    const url = `/admin/transactions/export/guild/${encodeURIComponent(guildId.trim())}?${params.toString()}`;
    const response = await API(url);
    
    if (!response.ok) throw new Error("Export failed");
    
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `guild_${guildId}_activity_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(downloadUrl);
    
    showMessage("txMsg", `Guild data for ${guildId} exported successfully`, false);
  } catch (e) {
    showMessage("txMsg", `Failed to export guild data: ${e.message}`, true);
  }
}

// User search autocomplete functionality
let searchTimeout;
let currentSearchResults = [];

async function handleUserSearchInput() {
  const searchInput = $("userSearchInput");
  const query = searchInput.value.trim();
  
  // Clear previous timeout
  if (searchTimeout) clearTimeout(searchTimeout);
  
  // Hide dropdown if query is too short
  if (query.length < 2) {
    hideSearchDropdown();
    return;
  }
  
  // Debounce search
  searchTimeout = setTimeout(async () => {
    try {
      const response = await API(`/admin/users/autocomplete?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      
      if (data.ok && data.users) {
        currentSearchResults = data.users;
        showSearchDropdown(data.users);
      }
    } catch (error) {
      console.error("Search failed:", error);
      hideSearchDropdown();
    }
  }, 300);
}

function showSearchDropdown(users) {
  let dropdown = $("userSearchDropdown");
  
  // Create dropdown if it doesn't exist
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.id = "userSearchDropdown";
    dropdown.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: white;
      border: 1px solid #d1d5db;
      border-top: none;
      border-radius: 0 0 6px 6px;
      max-height: 300px;
      overflow-y: auto;
      z-index: 1000;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    `;
    $("userSearchContainer").appendChild(dropdown);
  }
  
  setSecureContent(dropdown, '');
  
  if (users.length === 0) {
    const noUsersDiv = createElement('div', {
      style: { padding: '12px', color: '#9ca3af', textAlign: 'center' },
      textContent: 'No users found'
    });
    dropdown.appendChild(noUsersDiv);
  } else {
    users.forEach(user => {
      const item = document.createElement("div");
      item.style.cssText = `
        padding: 12px;
        cursor: pointer;
        border-bottom: 1px solid #f3f4f6;
        transition: background-color 0.15s;
      `;
      const usernameDiv = createElement('div', {
        style: { fontWeight: '500', color: '#111827' },
        textContent: escapeHtml(user.username)
      });
      const idDiv = createElement('div', {
        style: { fontSize: '0.875rem', color: '#6b7280' },
        textContent: `ID: ${escapeHtml(user.discordId)}`
      });
      const joinedDiv = createElement('div', {
        style: { fontSize: '0.875rem', color: '#6b7280' },
        textContent: `Joined: ${new Date(user.createdAt).toLocaleDateString()}`
      });

      item.appendChild(usernameDiv);
      item.appendChild(idDiv);
      item.appendChild(joinedDiv);
      
      item.onmouseenter = () => item.style.backgroundColor = "#f9fafb";
      item.onmouseleave = () => item.style.backgroundColor = "transparent";
      item.onclick = () => selectSearchUser(user);
      
      dropdown.appendChild(item);
    });
  }
  
  dropdown.style.display = "block";
}

function hideSearchDropdown() {
  const dropdown = $("userSearchDropdown");
  if (dropdown) {
    dropdown.style.display = "none";
  }
}

function selectSearchUser(user) {
  // Fill search input with selected user
  $("userSearchInput").value = user.username;
  hideSearchDropdown();
  
  // Perform detailed search for this user
  performUserSearch(user.discordId);
}

async function performUserSearch(searchQuery) {
  setLoading("searchUserBtn", true);
  try {
    const response = await API(`/admin/users/search?q=${encodeURIComponent(searchQuery)}`);
    const data = await response.json();
    
    if (!data.ok) {
      showMessage("userMsg", data.error || "User not found", true);
      return;
    }
    
    // Display the found user in the table
    displayUsers([data.user]);
    showMessage("userMsg", `Found user: ${data.user.username}`, false);
    
  } catch (error) {
    showMessage("userMsg", "Search failed", true);
  } finally {
    setLoading("searchUserBtn", false);
  }
}

// Handle search button click
async function searchUsers() {
  const query = $("userSearchInput").value.trim();
  if (!query) {
    showMessage("userMsg", "Please enter a search term", true);
    return;
  }
  
  await performUserSearch(query);
}

// Hide dropdown when clicking outside
document.addEventListener("click", (e) => {
  const searchContainer = $("userSearchContainer");
  if (searchContainer && !searchContainer.contains(e.target)) {
    hideSearchDropdown();
  }
});

// Set up event handlers
const userSearchInput = $("userSearchInput");
if (userSearchInput) {
  userSearchInput.oninput = handleUserSearchInput;
  userSearchInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchUsers();
    } else if (e.key === "Escape") {
      hideSearchDropdown();
    }
  };
}
const searchUserBtn = $("searchUserBtn");
if (searchUserBtn) searchUserBtn.onclick = searchUsers;

const findUserBtn = $("findUser");
if (findUserBtn) findUserBtn.onclick = findUser;

const loadTopUsersBtn = $("loadTopUsers");
if (loadTopUsersBtn) loadTopUsersBtn.onclick = loadTopUsers;

const refreshUsersBtn = $("refreshUsers");
if (refreshUsersBtn) refreshUsersBtn.onclick = loadTopUsers;

const clearSearchBtn = $("clearSearch");
if (clearSearchBtn) {
  clearSearchBtn.onclick = () => {
    const searchUserEl = $("searchUser");
    if (searchUserEl) searchUserEl.value = "";
    const usersTbl = $("usersTbl");
    if (usersTbl) {
      const tbody = usersTbl.querySelector("tbody");
      if (tbody) setSecureContent(tbody, '');
    }
    showMessage("userMsg", "", false);
  };
}
$("exportGuildData").onclick = exportGuildData;

// ---------- Backup Management ----------
async function loadBackupStatus() {
  setLoading("loadBackupStatus", true);
  try {
    const r = await API("/admin/backup/status");
    const j = await r.json();
    
    if (!j.ok) throw new Error(j.error || "Failed to load backup status");
    
    const statusDiv = $("backupStatusData");
    const serviceStatus = j.isRunning ? '🟢 Running' : '🔴 Stopped';
    setSecureContent(statusDiv, '');

    const statusP = createElement('p', {
      innerHTML: `<strong>Service Status:</strong> ${serviceStatus}`,
      trusted: true
    });
    const intervalP = createElement('p', {
      innerHTML: `<strong>Backup Interval:</strong> ${escapeHtml(String(j.intervalMinutes))} minutes`,
      trusted: true
    });
    const totalP = createElement('p', {
      innerHTML: `<strong>Total Backups:</strong> ${escapeHtml(String(j.totalBackups))}/${escapeHtml(String(j.maxBackups))}`,
      trusted: true
    });
    const dirP = createElement('p', {
      innerHTML: `<strong>Backup Directory:</strong> <code>${escapeHtml(j.backupDir || 'Default')}</code>`,
      trusted: true
    });

    statusDiv.appendChild(statusP);
    statusDiv.appendChild(intervalP);
    statusDiv.appendChild(totalP);
    statusDiv.appendChild(dirP);

    if (j.error) {
      const errorP = createElement('p', {
        style: { color: '#ef4444' },
        innerHTML: `<strong>Error:</strong> ${escapeHtml(j.error)}`,
        trusted: true
      });
      statusDiv.appendChild(errorP);
    }
    
    // Load recent backups table
    const tbody = $("backupTbl").querySelector("tbody");
    setSecureContent(tbody, '');
    
    if (j.recentBackups && j.recentBackups.length > 0) {
      j.recentBackups.forEach(backup => {
        const tr = document.createElement("tr");
        const createdDate = new Date(backup.created).toLocaleString();
        const backupCells = [
          { innerHTML: `<code>${escapeHtml(backup.filename)}</code>`, trusted: true },
          { textContent: formatNumber(backup.size) },
          { textContent: createdDate }
        ];

        const downloadCell = createElement('td');
        const downloadBtn = createElement('button', {
          className: 'downloadBackup',
          textContent: '📥 Download',
          style: { background: '#2563eb', color: 'white', border: 'none', padding: '2px 6px', borderRadius: '3px', cursor: 'pointer' },
          attributes: { 'data-filename': escapeHtml(backup.filename) }
        });
        downloadCell.appendChild(downloadBtn);
        backupCells.push({ type: 'element', element: downloadCell });

        const backupRow = createTableRow(backupCells);
        tbody.appendChild(backupRow);
      });
      
      // Add download handlers
      tbody.querySelectorAll(".downloadBackup").forEach(btn => {
        btn.onclick = () => downloadBackup(btn.dataset.filename);
      });
    } else {
      const noBackupsRow = createTableRow([{
        innerHTML: 'No backups found',
        trusted: true,
        attributes: { colspan: '4' },
        style: { textAlign: 'center', color: '#9ca3af' }
      }]);
      tbody.appendChild(noBackupsRow);
    }
    
    $("backupStatus").style.display = "block";
    showMessage("backupMsg", "Backup status loaded", false);
    
  } catch (e) {
    showMessage("backupMsg", `Failed to load backup status: ${e.message}`, true);
  } finally {
    setLoading("loadBackupStatus", false);
  }
}

async function createManualBackup() {
  setLoading("createManualBackup", true);
  showMessage("backupMsg", "Creating backup... This may take a moment.", false);
  
  try {
    const r = await API("/admin/backup/create", { method: "POST" });
    const j = await r.json();
    
    if (!j.ok) throw new Error(j.error || "Backup creation failed");
    
    showMessage("backupMsg", `Backup created: ${j.filename} (${j.size} KB)`, false);
    
    // Refresh status to show new backup
    setTimeout(() => loadBackupStatus(), 1000);
    
  } catch (e) {
    showMessage("backupMsg", `Failed to create backup: ${e.message}`, true);
  } finally {
    setLoading("createManualBackup", false);
  }
}

async function toggleBackupService() {
  const btn = $("toggleBackupService");
  const isRunning = btn.textContent.includes("Running");
  const action = isRunning ? "stop" : "start";
  
  setLoading("toggleBackupService", true);
  try {
    const r = await API("/admin/backup/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    const j = await r.json();
    
    if (!j.ok) throw new Error(j.error || "Failed to toggle backup service");
    
    showMessage("backupMsg", j.message, false);
    
    // Refresh status
    setTimeout(() => loadBackupStatus(), 500);
    
  } catch (e) {
    showMessage("backupMsg", `Failed to toggle backup service: ${e.message}`, true);
  } finally {
    setLoading("toggleBackupService", false);
  }
}

async function downloadBackup(filename) {
  try {
    const url = `/admin/backup/download/${encodeURIComponent(filename)}`;
    const response = await API(url);
    
    if (!response.ok) throw new Error("Download failed");
    
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(downloadUrl);
    
    showMessage("backupMsg", `Downloaded: ${filename}`, false);
  } catch (e) {
    showMessage("backupMsg", `Failed to download backup: ${e.message}`, true);
  }
}

$("loadBackupStatus").onclick = loadBackupStatus;
$("createManualBackup").onclick = createManualBackup;
$("toggleBackupService").onclick = toggleBackupService;

// ---------- Stats Dashboard ----------
async function loadDashboard() {
  setLoading("loadDashboard", true);
  showMessage("statsMsg", "Loading dashboard data...", false);
  
  try {
    const [dashboardResponse, highlightsResponse] = await Promise.all([
      API("/admin/stats/dashboard"),
      API("/admin/stats/highlights")
    ]);
    
    const dashboard = await dashboardResponse.json();
    const highlights = await highlightsResponse.json();
    
    if (!dashboard.ok || !highlights.ok) {
      throw new Error(dashboard.error || highlights.error || "Failed to load dashboard");
    }
    
    // Update KPI cards
    $("kpi-servers").textContent = formatNumber(dashboard.stats.kpis.totalServers);
    $("kpi-users").textContent = formatNumber(dashboard.stats.kpis.totalUsers);
    $("kpi-tips").textContent = formatNumber(dashboard.stats.kpis.totalTips);
    $("kpi-games").textContent = formatNumber(dashboard.stats.kpis.totalGames);
    
    // Update highlights
    updateHighlights(highlights.highlights, highlights.globalStats);
    
    // Debug logging
    console.log("🖥️ Server breakdown data:", dashboard.stats.serverBreakdown);
    console.log("🪙 Token breakdown data:", dashboard.stats.tokenBreakdown);

    // Update server stats table
    updateServerStats(dashboard.stats.serverBreakdown);

    // Update token stats table
    updateTokenStats(dashboard.stats.tokenBreakdown);
    
    showMessage("statsMsg", "Dashboard loaded successfully", false);
    
  } catch (e) {
    showMessage("statsMsg", `Failed to load dashboard: ${e.message}`, true);
  } finally {
    setLoading("loadDashboard", false);
  }
}

function updateHighlights(highlights, globalStats) {
  // Biggest tip
  const biggestTipDiv = $("biggest-tip");
  if (highlights.biggestTip) {
    const amount = formatNumber(parseFloat(highlights.biggestTip.amount) / 1e18); // Assuming 18 decimals
    const date = new Date(highlights.biggestTip.date).toLocaleDateString();
    setSecureContent(biggestTipDiv, '');

    const amountDiv = createElement('div', {
      style: { fontSize: '1.2em', fontWeight: 'bold', color: '#f59e0b' },
      textContent: `${amount} ${escapeHtml(highlights.biggestTip.token)}`
    });
    const dateDiv = createElement('div', {
      style: { fontSize: '0.9em', color: '#9ca3af', marginTop: '4px' },
      textContent: date
    });

    biggestTipDiv.appendChild(amountDiv);
    biggestTipDiv.appendChild(dateDiv);
  } else {
    setSecureContent(biggestTipDiv, '');
    const noTipsDiv = createElement('div', {
      style: { color: '#9ca3af' },
      textContent: 'No tips recorded'
    });
    biggestTipDiv.appendChild(noTipsDiv);
  }
  
  // Most active user
  const mostActiveDiv = $("most-active");
  if (highlights.mostActiveUser) {
    const user = highlights.mostActiveUser;
    setSecureContent(mostActiveDiv, '');

    const usernameDiv = createElement('div', {
      style: { fontSize: '1.1em', fontWeight: 'bold', color: '#10b981' },
      textContent: escapeHtml(user.username || `User ${user.discordId.slice(0, 8)}...`)
    });
    const statsDiv = createElement('div', {
      style: { fontSize: '0.9em', color: '#9ca3af', marginTop: '4px' },
      textContent: `${escapeHtml(String(user.tipCount))} tips • ${escapeHtml(String(user.gameCount))} games`
    });
    const activityDiv = createElement('div', {
      style: { fontSize: '0.8em', color: '#6b7280', marginTop: '2px' },
      textContent: `${escapeHtml(String(user.totalActivity))} total activities`
    });

    mostActiveDiv.appendChild(usernameDiv);
    mostActiveDiv.appendChild(statsDiv);
    mostActiveDiv.appendChild(activityDiv);
  } else {
    setSecureContent(mostActiveDiv, '');
    const noActivityDiv = createElement('div', {
      style: { color: '#9ca3af' },
      textContent: 'No activity recorded'
    });
    mostActiveDiv.appendChild(noActivityDiv);
  }
}

function updateServerStats(servers) {
  const tbody = $("serverStatsTbl").querySelector("tbody");
  setSecureContent(tbody, '');
  
  if (servers.length === 0) {
    const noServersRow = createTableRow([{
      innerHTML: 'No server data available',
      trusted: true,
      attributes: { colspan: '7' },
      style: { textAlign: 'center', color: '#9ca3af' }
    }]);
    tbody.appendChild(noServersRow);
    return;
  }
  
  servers.forEach(server => {
    const tr = document.createElement("tr");
    const lastActivity = server.lastActivity 
      ? new Date(server.lastActivity).toLocaleDateString()
      : "Never";
    
    const totalActivity = server.tipCount + server.gameCount + server.groupTipCount;
    
    const serverNameCell = createElement('td');
    const serverName = createElement('strong', {
      textContent: escapeHtml(server.serverName || server.guildId || 'Unknown Server')
    });
    const lineBreak = createElement('br');
    const guildIdSmall = createElement('small', {
      style: { color: '#9ca3af' },
      textContent: escapeHtml(server.guildId)
    });
    serverNameCell.appendChild(serverName);
    serverNameCell.appendChild(lineBreak);
    serverNameCell.appendChild(guildIdSmall);

    const exportCell = createElement('td');
    const exportBtn = createElement('button', {
      className: 'exportGuildFromStats',
      textContent: '📊 Export',
      style: { background: '#2563eb', color: 'white', border: 'none', padding: '2px 6px', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' },
      attributes: { 'data-guild-id': escapeHtml(server.guildId) }
    });
    exportCell.appendChild(exportBtn);

    const serverCells = [
      { type: 'element', element: serverNameCell },
      { textContent: formatNumber(server.tipCount) },
      { textContent: formatNumber(server.gameCount) },
      { textContent: formatNumber(server.groupTipCount) },
      { textContent: formatNumber(server.activeUsers) },
      { textContent: lastActivity },
      { type: 'element', element: exportCell }
    ];
    const serverRow = createTableRow(serverCells);
    tbody.appendChild(serverRow);
  });
  
  // Add export handlers
  tbody.querySelectorAll(".exportGuildFromStats").forEach(btn => {
    btn.onclick = () => {
      const guildId = btn.dataset.guildId;
      exportGuildDataDirect(guildId);
    };
  });
}

function updateTokenStats(tokens) {
  const tbody = $("tokenStatsTbl").querySelector("tbody");
  setSecureContent(tbody, '');
  
  if (tokens.length === 0) {
    const noTokensRow = createTableRow([{
      innerHTML: 'No token data available',
      trusted: true,
      attributes: { colspan: '5' },
      style: { textAlign: 'center', color: '#9ca3af' }
    }]);
    tbody.appendChild(noTokensRow);
    return;
  }
  
  tokens.forEach(token => {
    const tr = document.createElement("tr");
    const lastActivity = token.lastTip 
      ? new Date(token.lastTip).toLocaleDateString()
      : "Never";
    
    // Format amounts using actual token decimals
    const decimals = token.decimals || 18; // Default to 18 if not specified
    const divisor = Math.pow(10, decimals);
    
    const totalTippedRaw = parseFloat(token.totalTipped) || 0;
    const avgTipSizeRaw = parseFloat(token.avgTipSize) || 0;
    
    const totalTipped = formatNumber(totalTippedRaw / divisor);
    const avgTipSize = formatNumber(avgTipSizeRaw / divisor);
    
    const tokenNameCell = createElement('td');
    const tokenSymbol = createElement('strong', {
      textContent: escapeHtml(token.symbol || `Token #${token.tokenId}` || 'Unknown Token')
    });
    const tokenBreak = createElement('br');
    const tokenAddress = createElement('small', {
      style: { color: '#9ca3af' },
      textContent: `${escapeHtml(token.address.slice(0, 10))}...`
    });
    tokenNameCell.appendChild(tokenSymbol);
    tokenNameCell.appendChild(tokenBreak);
    tokenNameCell.appendChild(tokenAddress);

    const tokenCells = [
      { type: 'element', element: tokenNameCell },
      { textContent: totalTipped },
      { textContent: formatNumber(token.tipCount) },
      { textContent: avgTipSize },
      { textContent: lastActivity }
    ];
    const tokenRow = createTableRow(tokenCells);
    tbody.appendChild(tokenRow);
  });
}

async function exportGuildDataDirect(guildId) {
  try {
    const url = `/admin/transactions/export/guild/${encodeURIComponent(guildId)}`;
    const response = await API(url);
    
    if (!response.ok) throw new Error("Export failed");
    
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `guild_${guildId}_activity_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(downloadUrl);
    
    showMessage("statsMsg", `Guild data exported for ${guildId}`, false);
  } catch (e) {
    showMessage("statsMsg", `Failed to export guild data: ${e.message}`, true);
  }
}

async function exportStats() {
  try {
    const response = await API("/admin/stats/export");
    
    if (!response.ok) throw new Error("Export failed");
    
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `bot_stats_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(downloadUrl);
    
    showMessage("statsMsg", "Bot statistics exported successfully", false);
  } catch (e) {
    showMessage("statsMsg", `Failed to export stats: ${e.message}`, true);
  }
}

async function loadServerStats(sortBy = 'activity') {
  try {
    const response = await API(`/admin/stats/servers?sort=${sortBy}`);
    const data = await response.json();
    
    if (!data.ok) throw new Error(data.error || "Failed to load server stats");
    
    updateServerStats(data.servers);
  } catch (e) {
    showMessage("statsMsg", `Failed to load server stats: ${e.message}`, true);
  }
}

async function loadTokenStats(sortBy = 'volume') {
  try {
    const response = await API(`/admin/stats/tokens?sort=${sortBy}`);
    const data = await response.json();
    
    if (!data.ok) throw new Error(data.error || "Failed to load token stats");
    
    updateTokenStats(data.tokens);
  } catch (e) {
    showMessage("statsMsg", `Failed to load token stats: ${e.message}`, true);
  }
}

// Event handlers
$("loadDashboard").onclick = loadDashboard;
$("exportStats").onclick = exportStats;
$("serverSort").onchange = (e) => loadServerStats(e.target.value);
$("tokenSort").onchange = (e) => loadTokenStats(e.target.value);

// ---------- Transactions ----------
async function loadTransactions() {
  const type = $("txType").value;
  const userId = $("txUser").value.trim();
  const since = $("txSince").value;
  const limit = $("txLimit").value;

  setLoading("loadTransactions", true);
  try {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (userId) params.set("userId", userId);
    if (since) params.set("since", since);
    if (limit) params.set("limit", limit);

    const r = await API(`/admin/transactions?${params.toString()}`);
    const j = await r.json();
    if (!j.ok) return showMessage("txMsg", j.error || "Failed to load transactions", true);

    const tbody = $("transactionsTbl").querySelector("tbody");
    setSecureContent(tbody, '');

    j.transactions.forEach(tx => {
      const transactionRow = createTransactionTableRow(tx);
      tbody.appendChild(transactionRow);
    });

    showMessage("txMsg", `Loaded ${j.transactions.length} transactions`, false);
  } catch {
    showMessage("txMsg", "Failed to load transactions", true);
  } finally {
    setLoading("loadTransactions", false);
  }
}

// Delete transaction function
async function deleteTransaction(transactionId) {
  if (!confirm(`⚠️ Delete Transaction #${transactionId}?\n\nThis action is IRREVERSIBLE and will permanently remove this transaction from the database.\n\nAre you sure you want to continue?`)) {
    return;
  }
  
  try {
    const r = await API(`/admin/transactions/${transactionId}`, { method: "DELETE" });
    const j = await r.json();
    
    if (j.ok) {
      showMessage("txMsg", `✅ Transaction #${transactionId} deleted successfully`, false);
      // Reload the transactions table to reflect the deletion
      loadTransactions();
    } else {
      showMessage("txMsg", `❌ Failed to delete transaction: ${j.error}`, true);
    }
  } catch (error) {
    showMessage("txMsg", `❌ Delete error: ${error.message}`, true);
  }
}

async function exportTransactions() {
  try {
    const params = new URLSearchParams();
    const type = $("txType").value;
    const userId = $("txUser").value.trim();
    const since = $("txSince").value;
    if (type) params.set("type", type);
    if (userId) params.set("userId", userId);
    if (since) params.set("since", since);

    const r = await API(`/admin/transactions/export?${params.toString()}`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showMessage("txMsg", "Transactions exported successfully", false);
  } catch {
    showMessage("txMsg", "Export failed", true);
  }
}

$("loadTransactions").onclick = loadTransactions;
$("exportTransactions").onclick = exportTransactions;

// ---------- Group Tips ----------
async function loadGroupTips() {
  const status = $("gtStatus").value;

  setLoading("loadGroupTips", true);
  try {
    const params = new URLSearchParams();
    if (status) params.set("status", status);

    const r = await API(`/admin/group-tips?${params.toString()}`);
    const j = await r.json();
    if (!j.ok) return showMessage("gtMsg", j.error || "Failed to load group tips", true);

    const tbody = $("groupTipsTbl").querySelector("tbody");
    setSecureContent(tbody, '');

    j.groupTips.forEach(gt => {
      const groupTipRow = createGroupTipTableRow(gt);
      tbody.appendChild(groupTipRow);
    });

    // Add expire handlers
    tbody.querySelectorAll(".expireGroupTip").forEach(btn => {
      btn.onclick = () => expireGroupTip(btn.dataset.id);
    });

    showMessage("gtMsg", `Loaded ${j.groupTips.length} group tips`, false);
  } catch {
    showMessage("gtMsg", "Failed to load group tips", true);
  } finally {
    setLoading("loadGroupTips", false);
  }
}

async function expireStuckGroupTips() {
  setLoading("expireStuck", true);
  try {
    const r = await API("/admin/group-tips/expire-stuck", { method: "POST" });
    const j = await r.json();
    if (!j.ok) return showMessage("gtMsg", j.error || "Failed to expire stuck tips", true);

    showMessage("gtMsg", `Expired ${j.count} stuck group tips`, false);
    await loadGroupTips(); // Reload to see changes
  } catch {
    showMessage("gtMsg", "Failed to expire stuck tips", true);
  } finally {
    setLoading("expireStuck", false);
  }
}

$("loadGroupTips").onclick = loadGroupTips;
$("expireStuck").onclick = expireStuckGroupTips;

// Load all data on page load
async function loadAllData() {
  try {
    await Promise.all([
      loadDashboard(),
      loadConfig(),
      loadTierTokenOptions(),
      loadTiers(),
      loadTokens(),
      loadServers(),
      // loadTreasury(), // Load on-demand to reduce RPC calls
      loadAds(),
      loadTransactions(),
      loadGroupTips(),
      loadTopUsers(), // AUTO-LOAD USERS
    ]);
    
    console.log("✅ Initial admin data loaded including users.");
  } catch (e) { console.error("Failed to load data:", e); }
}

// Emergency and System Health Button Handlers
$("grandReset").onclick = async () => {
  if (!confirm("🚨 GRAND RESET WARNING 🚨\n\nThis will PERMANENTLY DELETE:\n• All users and their balances\n• All transactions and tips\n• All matches and group tips\n• All tier memberships\n\nThis action is IRREVERSIBLE!\n\nType 'DELETE EVERYTHING' to confirm:")) return;
  
  const confirmation = prompt("Type exactly: DELETE EVERYTHING");
  if (confirmation !== "DELETE EVERYTHING") {
    alert("Reset cancelled - confirmation text didn't match");
    return;
  }
  
  try {
    const r = await API("/admin/system/grand-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmToken: "RESET_ALL_DATA_PERMANENTLY" })
    });
    const j = await r.json();
    if (j.ok) {
      alert(`✅ Grand Reset Complete!\nDeleted ${j.totalDeleted} records total`);
      location.reload(); // Refresh the page
    } else {
      alert(`❌ Grand Reset Failed: ${j.error}`);
    }
  } catch (error) {
    alert(`❌ Grand Reset Error: ${error.message}`);
  }
};

$("syncStatus").onclick = async () => {
  const msgEl = $("systemMsg");
  try {
    if (msgEl) msgEl.textContent = "🔄 Checking sync status...";
    const r = await API("/admin/sync/status");
    const j = await r.json();
    if (j.ok) {
      const status = j.sync.overallHealthy ? "✅ HEALTHY" : "⚠️ ISSUES DETECTED";
      const message = `Database Sync: ${status} | Schema: ${j.sync.schemaInSync ? '✅' : '❌'} | Migrations: ${j.sync.migrationsApplied ? '✅' : '❌'} | Connection: ${j.sync.connectionHealthy ? '✅' : '❌'} | Issues: ${j.sync.issueCount}`;
      
      // Show detailed issues if any exist
      if (j.sync.issues && j.sync.issues.length > 0) {
        console.log("🔍 Sync Issues Details:", j.sync.issues);
        const detailedMessage = message + "\n\nDetailed Issues:\n" + j.sync.issues.join("\n");
        alert(detailedMessage);
      }
      
      if (msgEl) {
        msgEl.textContent = message;
        msgEl.className = j.sync.overallHealthy ? "ok" : "err";
      } else {
        alert(message);
      }
    } else {
      const errorMsg = `❌ Sync Status Error: ${j.error}`;
      if (msgEl) {
        msgEl.textContent = errorMsg;
        msgEl.className = "err";
      } else {
        alert(errorMsg);
      }
    }
  } catch (error) {
    const errorMsg = `❌ Sync Status Error: ${error.message}`;
    if (msgEl) {
      msgEl.textContent = errorMsg;
      msgEl.className = "err";
    } else {
      alert(errorMsg);
    }
  }
};

$("fixSync").onclick = async () => {
  if (!confirm("Auto-fix database synchronization issues?")) return;
  const msgEl = $("systemMsg");
  try {
    if (msgEl) msgEl.textContent = "🔧 Fixing sync issues...";
    const r = await API("/admin/sync/fix", { method: "POST" });
    const j = await r.json();
    if (j.ok) {
      const message = j.fixed ? "✅ Sync issues automatically resolved!" : "⚠️ Some issues could not be fixed automatically";
      const fullMessage = `${message} | Before: ${j.beforeIssues?.length || 0} issues | After: ${j.afterIssues?.length || 0} issues`;
      if (msgEl) {
        msgEl.textContent = fullMessage;
        msgEl.className = j.fixed ? "ok" : "err";
      } else {
        alert(fullMessage);
      }
    } else {
      const errorMsg = `❌ Sync Fix Error: ${j.error}`;
      if (msgEl) {
        msgEl.textContent = errorMsg;
        msgEl.className = "err";
      } else {
        alert(errorMsg);
      }
    }
  } catch (error) {
    const errorMsg = `❌ Sync Fix Error: ${error.message}`;
    if (msgEl) {
      msgEl.textContent = errorMsg;
      msgEl.className = "err";
    } else {
      alert(errorMsg);
    }
  }
};

$("clearCaches").onclick = async () => {
  if (!confirm("Clear all system caches?")) return;
  const msgEl = $("systemMsg");
  try {
    if (msgEl) msgEl.textContent = "🗑️ Clearing caches...";
    const r = await API("/admin/system/clear-caches", { method: "POST" });
    const j = await r.json();
    const message = j.ok ? "✅ All caches cleared successfully!" : `❌ Cache Clear Error: ${j.error}`;
    if (msgEl) {
      msgEl.textContent = message;
      msgEl.className = j.ok ? "ok" : "err";
    } else {
      alert(message);
    }
  } catch (error) {
    const errorMsg = `❌ Cache Clear Error: ${error.message}`;
    if (msgEl) {
      msgEl.textContent = errorMsg;
      msgEl.className = "err";
    } else {
      alert(errorMsg);
    }
  }
};

$("systemStats").onclick = async () => {
  const msgEl = $("systemMsg");
  try {
    if (msgEl) msgEl.textContent = "📊 Loading system stats...";
    const r = await API("/admin/system/stats");
    const j = await r.json();
    if (j.ok) {
      const statsText = Object.entries(j.stats).map(([key, value]) => `${key}: ${value}`).join(' | ');
      const message = `📊 Total Records: ${j.totalRecords} | ${statsText}`;
      if (msgEl) {
        msgEl.textContent = message;
        msgEl.className = "ok";
      } else {
        alert(`📊 System Statistics\n\nTotal Records: ${j.totalRecords}\n\n${statsText.replace(/\|/g, '\n')}`);
      }
    } else {
      const errorMsg = `❌ System Stats Error: ${j.error}`;
      if (msgEl) {
        msgEl.textContent = errorMsg;
        msgEl.className = "err";
      } else {
        alert(errorMsg);
      }
    }
  } catch (error) {
    const errorMsg = `❌ System Stats Error: ${error.message}`;
    if (msgEl) {
      msgEl.textContent = errorMsg;
      msgEl.className = "err";
    } else {
      alert(errorMsg);
    }
  }
};

// ---------- Withdrawal Security Monitoring ----------
async function loadWithdrawalStats() {
  const timeframe = $("withdrawalTimeframe").value;
  setLoading("loadWithdrawalStats", true);
  showMessage("withdrawalMsg", "Loading withdrawal security stats...", false);

  try {
    const response = await API(`/admin/system/withdrawals/stats?hours=${timeframe}`);
    const data = await response.json();

    if (!data.ok) throw new Error(data.error || "Failed to load withdrawal stats");

    const stats = data.protection;

    // Update KPI cards
    $("withdrawal-total").textContent = formatNumber(stats.totalWithdrawals);
    $("withdrawal-blocked").textContent = formatNumber(stats.blockedAttempts);
    $("withdrawal-users").textContent = formatNumber(stats.uniqueUsers);
    $("gas-saved").textContent = `${stats.estimatedGasSpentETH.toFixed(3)}`;

    // Update success rate
    $("success-rate").textContent = `${stats.successRate}%`;
    $("timeframe-display").textContent = `Last ${stats.timeframeHours} hours`;
    $("gas-cost-estimate").textContent = `Est. ~${stats.estimatedGasSpentETH.toFixed(3)} ETH in gas costs prevented`;

    // Load high-risk activity
    await loadHighRiskActivity();

    showMessage("withdrawalMsg", `Withdrawal stats loaded for ${stats.timeframeHours}h timeframe`, false);

  } catch (e) {
    showMessage("withdrawalMsg", `Failed to load withdrawal stats: ${e.message}`, true);
  } finally {
    setLoading("loadWithdrawalStats", false);
  }
}

async function loadHighRiskActivity() {
  try {
    // Get recent high-activity users who might be hitting limits
    const response = await API("/admin/users/top");
    const data = await response.json();

    if (!data.ok) throw new Error("Failed to load user data");

    const highRiskDiv = $("high-risk-users");
    const users = data.users || [];

    // Filter for users with recent activity that might indicate rapid withdrawals
    const riskUsers = users.filter(user => {
      const lastActivity = user.lastActivity ? new Date(user.lastActivity) : null;
      const hoursAgo = lastActivity ? (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60) : 999;
      return hoursAgo < 24; // Active in last 24 hours
    }).slice(0, 10);

    if (riskUsers.length === 0) {
      setSecureContent(highRiskDiv, '');
      const noRiskDiv = createElement('div', {
        style: { color: '#10b981', textAlign: 'center', padding: '20px' },
        textContent: '🛡️ No high-risk withdrawal activity detected'
      });
      highRiskDiv.appendChild(noRiskDiv);
    } else {
      setSecureContent(highRiskDiv, '');

      const titleDiv = createElement('div', {
        style: { color: '#fff', marginBottom: '12px' },
        innerHTML: '<strong>Recent Activity (Last 24h)</strong>',
        trusted: true
      });
      highRiskDiv.appendChild(titleDiv);

      // Create user rows securely
      riskUsers.forEach(user => {
        const lastActivity = user.lastActivity ? new Date(user.lastActivity).toLocaleString() : 'Never';
        const accountAge = Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (24 * 60 * 60 * 1000));

        let riskLevel = 'LOW';
        let riskColor = '#10b981';

        if (accountAge < 7) {
          riskLevel = 'MEDIUM';
          riskColor = '#f59e0b';
        }
        if (accountAge < 1) {
          riskLevel = 'HIGH';
          riskColor = '#ef4444';
        }

        const userRowDiv = createElement('div', {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px',
            borderBottom: '1px solid #2a2a2a'
          }
        });

        const leftDiv = createElement('div');
        const usernameDiv = createElement('div', {
          style: { fontWeight: 'bold', color: '#fff' },
          textContent: escapeHtml(user.username)
        });
        const detailsDiv = createElement('div', {
          style: { fontSize: '0.9em', color: '#9ca3af' },
          textContent: `ID: ${escapeHtml(user.discordId.slice(0, 12))}... | Age: ${accountAge} days | Last: ${escapeHtml(lastActivity)}`
        });
        leftDiv.appendChild(usernameDiv);
        leftDiv.appendChild(detailsDiv);

        const rightDiv = createElement('div', { style: { textAlign: 'right' } });
        const riskSpan = createElement('span', {
          style: {
            background: riskColor,
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '0.8em',
            fontWeight: 'bold'
          },
          textContent: riskLevel
        });
        rightDiv.appendChild(riskSpan);

        userRowDiv.appendChild(leftDiv);
        userRowDiv.appendChild(rightDiv);
        highRiskDiv.appendChild(userRowDiv);
      });
    }

  } catch (e) {
    const highRiskDiv = $("high-risk-users");
    setSecureContent(highRiskDiv, '');
    const errorDiv = createElement('div', {
      style: { color: '#ef4444', textAlign: 'center', padding: '20px' },
      textContent: '⚠️ Failed to load high-risk activity data'
    });
    highRiskDiv.appendChild(errorDiv);
  }
}

async function clearAllWithdrawalCooldowns() {
  if (!confirm("⚠️ Clear All Withdrawal Cooldowns?\n\nThis will allow ALL users to bypass progressive cooldowns until they withdraw again.\n\nThis should only be used for emergency support cases.\n\nContinue?")) {
    return;
  }

  setLoading("clearCooldowns", true);
  try {
    const response = await API("/admin/system/withdrawals/clear-cooldowns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmToken: "CLEAR_ALL_COOLDOWNS" })
    });
    const data = await response.json();

    if (!data.ok) throw new Error(data.error || "Failed to clear cooldowns");

    showMessage("withdrawalMsg", "✅ All withdrawal cooldowns cleared. Users can now bypass progressive limits.", false);

    // Refresh stats to reflect changes
    setTimeout(() => loadWithdrawalStats(), 1000);

  } catch (e) {
    showMessage("withdrawalMsg", `Failed to clear cooldowns: ${e.message}`, true);
  } finally {
    setLoading("clearCooldowns", false);
  }
}

// Event handlers for withdrawal monitoring
$("loadWithdrawalStats").onclick = loadWithdrawalStats;
$("clearCooldowns").onclick = clearAllWithdrawalCooldowns;
$("withdrawalTimeframe").onchange = loadWithdrawalStats;

// Event handlers for resource monitoring
$("refreshResources").onclick = loadResourceMetrics;
$("loadResourceHistory").onclick = loadResourceHistory;
$("checkUpgrade").onclick = checkUpgradeNeeded;

// ---------- Achievement Management ----------
async function loadAchievements() {
  try {
    setLoading("loadAchievements", true);
    showMessage("achievementMsg", "Loading achievements...");

    const r = await API("/admin/achievements");
    const j = await r.json();

    if (!j.ok) throw new Error(j.error || "Failed to load achievements");

    const tbody = $("achievementsTbl").querySelector("tbody");
    setSecureContent(tbody, '');

    if (!j.achievements || j.achievements.length === 0) {
      const emptyRow = createTableRow([{
        textContent: "No achievements found. Click 'Seed Default Achievements' to get started.",
        attributes: { colspan: "9" },
        style: { textAlign: "center", padding: "20px", color: "#9ca3af" }
      }]);
      tbody.appendChild(emptyRow);
    } else {
      j.achievements.forEach(achievement => {
        const achievementRow = createAchievementTableRow(achievement);
        tbody.appendChild(achievementRow);
      });
    }

    showMessage("achievementMsg", `✓ Loaded ${j.achievements?.length || 0} achievements`, false);
  } catch (e) {
    console.error("Failed to load achievements:", e);
    showMessage("achievementMsg", `Failed to load achievements: ${escapeHtml(e.message)}`, true);
  } finally {
    setLoading("loadAchievements", false);
  }
}

function createAchievementTableRow(achievement) {
  const cells = [
    { textContent: achievement.id },
    { innerHTML: `<strong>${escapeHtml(achievement.title)}</strong>`, trusted: true },
    { textContent: achievement.description || "-" },
    { textContent: achievement.type || "-" },
    { textContent: achievement.target || "-" },
    { textContent: achievement.reward || "-" },
    { innerHTML: achievement.active ? '✅' : '❌', trusted: true },
    { textContent: achievement.completions || 0 },
    {
      type: 'element',
      element: createSecureButton('Edit', () => editAchievement(achievement.id), {
        style: { fontSize: '12px', padding: '4px 8px' }
      })
    }
  ];

  return createTableRow(cells);
}

async function seedAchievements() {
  if (!confirm("This will create default achievements. Continue?")) return;

  try {
    setLoading("seedAchievements", true);
    showMessage("achievementMsg", "Seeding achievements...");

    const r = await API("/admin/achievements/seed", { method: "POST" });
    const j = await r.json();

    if (!j.ok) throw new Error(j.error || "Failed to seed achievements");

    showMessage("achievementMsg", "✓ Default achievements created successfully", false);
    await loadAchievements();
  } catch (e) {
    console.error("Failed to seed achievements:", e);
    showMessage("achievementMsg", `Failed to seed achievements: ${escapeHtml(e.message)}`, true);
  } finally {
    setLoading("seedAchievements", false);
  }
}

function editAchievement(achievementId) {
  showMessage("achievementMsg", "Achievement editing coming soon...", false);
}

// Event handlers for achievement management
$("loadAchievements").onclick = loadAchievements;
$("seedAchievements").onclick = seedAchievements;
$("createAchievement").onclick = () => showMessage("achievementMsg", "Achievement creation coming soon...", false);

// Initialize on page load
(() => {
  const saved = localStorage.getItem("pip_admin_secret"); if (saved) $("secret").value = saved;
  setDefaultDates(); checkAuthAndLoad();
})();