// src/web/admin/js/tokens.js - Token management functionality
import { API, showMessage, setLoading, $ } from './core.js';
import { setupFeeInputs } from './fees.js';
import { createElement, createTableRow, createSecureInput, createSecureButton, escapeHtml, sanitizeInput } from './security.js';

export async function loadTokens() {
  try {
    const r = await API("/admin/tokens"); const j = await r.json();
    if (!j.ok) return showMessage("tokenMsg","Failed to load tokens",true);
    const tbody = $("tokensTbl").querySelector("tbody");
    tbody.innerHTML = ""; // Clear existing content

    j.tokens.forEach(t => {
      // Safely create table row with escaped content
      const tr = createSecureTokenRow(t);
      tbody.appendChild(tr);
    });
    // Event listeners are attached during row creation for security
    // Add fee functionality
    setupFeeInputs(tbody);
  } catch { showMessage("tokenMsg","Failed to load tokens",true); }
}

/**
 * Securely create a token table row with proper escaping
 * @param {Object} token - Token data
 * @returns {HTMLTableRowElement} - Secure table row
 */
function createSecureTokenRow(token) {
  const tr = document.createElement('tr');

  // Create cells with proper escaping
  const idCell = createElement('td', { textContent: String(token.id) });

  const symbolCell = createElement('td');
  const symbolStrong = createElement('strong', { textContent: escapeHtml(token.symbol) });
  symbolCell.appendChild(symbolStrong);

  const addressCell = createElement('td');
  const addressCode = createElement('code', { textContent: escapeHtml(token.address) });
  addressCell.appendChild(addressCode);

  const decimalsCell = createElement('td', { textContent: String(token.decimals) });

  // Active checkbox
  const activeCell = createElement('td');
  const activeInput = createSecureInput('checkbox', {
    attributes: {
      'data-field': 'active'
    }
  });
  activeInput.checked = Boolean(token.active);
  activeCell.appendChild(activeInput);

  // Min deposit input
  const minDepositCell = createElement('td');
  const minDepositInput = createSecureInput('number', {
    attributes: {
      'data-field': 'minDeposit',
      step: '0.01',
      value: String(token.minDeposit || '')
    },
    style: { width: '80px' }
  });
  minDepositCell.appendChild(minDepositInput);

  // Min withdraw input
  const minWithdrawCell = createElement('td');
  const minWithdrawInput = createSecureInput('number', {
    attributes: {
      'data-field': 'minWithdraw',
      step: '0.01',
      value: String(token.minWithdraw || '')
    },
    style: { width: '80px' }
  });
  minWithdrawCell.appendChild(minWithdrawInput);

  // Tip fee container
  const tipFeeCell = createElement('td');
  const tipFeeContainer = createFeeInputContainer(token, 'tipFee');
  tipFeeCell.appendChild(tipFeeContainer);

  // House fee container
  const houseFeeCell = createElement('td');
  const houseFeeContainer = createFeeInputContainer(token, 'houseFee');
  houseFeeCell.appendChild(houseFeeContainer);

  // Withdraw max per tx
  const withdrawMaxCell = createElement('td');
  const withdrawMaxInput = createSecureInput('number', {
    attributes: {
      'data-field': 'withdrawMaxPerTx',
      step: '0.01',
      value: String(token.withdrawMaxPerTx || ''),
      placeholder: 'default'
    },
    style: { width: '80px' }
  });
  withdrawMaxCell.appendChild(withdrawMaxInput);

  // Withdraw daily cap
  const withdrawCapCell = createElement('td');
  const withdrawCapInput = createSecureInput('number', {
    attributes: {
      'data-field': 'withdrawDailyCap',
      step: '0.01',
      value: String(token.withdrawDailyCap || ''),
      placeholder: 'default'
    },
    style: { width: '80px' }
  });
  withdrawCapCell.appendChild(withdrawCapInput);

  // Action buttons
  const actionsCell = createElement('td');

  const saveBtn = createSecureButton('Save', () => saveToken(token.id), {
    className: 'saveToken',
    attributes: { 'data-id': String(token.id) }
  });

  const deleteBtn = createSecureButton('Delete', () => deleteToken(token.id), {
    className: 'deleteToken',
    attributes: { 'data-id': String(token.id) },
    style: { background: '#ef4444', marginLeft: '4px' }
  });

  actionsCell.appendChild(saveBtn);
  actionsCell.appendChild(deleteBtn);

  // Append all cells to row
  tr.appendChild(idCell);
  tr.appendChild(symbolCell);
  tr.appendChild(addressCell);
  tr.appendChild(decimalsCell);
  tr.appendChild(activeCell);
  tr.appendChild(minDepositCell);
  tr.appendChild(minWithdrawCell);
  tr.appendChild(tipFeeCell);
  tr.appendChild(houseFeeCell);
  tr.appendChild(withdrawMaxCell);
  tr.appendChild(withdrawCapCell);
  tr.appendChild(actionsCell);

  return tr;
}

/**
 * Create a secure fee input container
 * @param {Object} token - Token data
 * @param {string} feeType - 'tipFee' or 'houseFee'
 * @returns {HTMLDivElement} - Fee input container
 */
function createFeeInputContainer(token, feeType) {
  const container = createElement('div', { className: 'fee-input-container' });

  // Main input
  const fieldName = feeType === 'tipFee' ? 'tipFeePercent' : 'houseFeePercent';
  const bpsField = feeType === 'tipFee' ? 'tipFeeBps' : 'houseFeeBps';
  const currentValue = token[bpsField] ? (token[bpsField] / 100).toFixed(2) : '';

  const input = createSecureInput('number', {
    attributes: {
      'data-field': fieldName,
      step: '0.01',
      min: '0',
      max: '10',
      value: currentValue,
      placeholder: 'default'
    },
    style: { width: '50px' }
  });

  const suffix = createElement('span', {
    className: 'fee-suffix',
    textContent: '%'
  });

  // Preset buttons container
  const presetsDiv = createElement('div', { className: 'fee-presets' });

  const presetValues = feeType === 'tipFee' ?
    [{ value: '0.5', text: '0.5%' }, { value: '1', text: '1%' }, { value: '1.5', text: '1.5%' }, { value: '2', text: '2%' }] :
    [{ value: '1', text: '1%' }, { value: '2', text: '2%' }, { value: '2.5', text: '2.5%' }, { value: '3', text: '3%' }];

  presetValues.forEach(preset => {
    const presetBtn = createSecureButton(preset.text, () => {
      input.value = preset.value;
    }, {
      className: 'preset-btn',
      attributes: {
        type: 'button',
        'data-field': fieldName,
        'data-value': preset.value
      }
    });
    presetsDiv.appendChild(presetBtn);
  });

  // Preview div
  const previewDiv = createElement('div', {
    className: 'fee-preview',
    attributes: { 'data-field': `${fieldName.replace('Percent', 'Preview')}` }
  });

  container.appendChild(input);
  container.appendChild(suffix);
  container.appendChild(presetsDiv);
  container.appendChild(previewDiv);

  return container;
}

async function saveToken(tokenId) {
  // Validate tokenId
  const validTokenId = parseInt(tokenId);
  if (isNaN(validTokenId) || validTokenId <= 0) {
    alert('Invalid token ID');
    return;
  }

  const btn = document.querySelector(`[data-id="${escapeHtml(String(tokenId))}"].saveToken`);
  const row = btn.closest("tr");
  setLoading(btn, true);
  try {
    const get = f => {
      const input = row.querySelector(`[data-field="${escapeHtml(f)}"]`);
      if (!input) throw new Error(`Field ${f} not found`);
      if (input.type === "checkbox") return input.checked;
      const v = sanitizeInput(input.value, { allowNumbers: true });
      return v === "" ? null : Number(v);
    };
    const getPercent = f => {
      const input = row.querySelector(`[data-field="${escapeHtml(f)}"]`);
      if (!input) throw new Error(`Field ${f} not found`);
      const v = sanitizeInput(input.value, { allowNumbers: true });
      if (v === "") return null;
      const numValue = Number(v);
      if (isNaN(numValue) || numValue < 0 || numValue > 10) {
        throw new Error(`Invalid percentage for ${f}: must be between 0-10%`);
      }
      return Math.round(numValue * 100); // Convert percentage to BPS
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

    // Validate numeric values
    ['minDeposit', 'minWithdraw', 'withdrawMaxPerTx', 'withdrawDailyCap'].forEach(field => {
      if (body[field] !== null && (isNaN(body[field]) || body[field] < 0)) {
        throw new Error(`Invalid value for ${field}: must be a positive number`);
      }
    });

    const r = await API(`/admin/tokens/${validTokenId}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Save failed");
    btn.textContent = "✓ Saved"; setTimeout(()=>btn.textContent="Save", 2000);
  } catch (e){ alert(`Failed to save token: ${escapeHtml(e.message)}`); }
  finally { setLoading(btn, false); }
}

async function deleteToken(tokenId) {
  const btn = document.querySelector(`[data-id="${escapeHtml(String(tokenId))}"].deleteToken`);
  const row = btn.closest("tr");
  const tokenSymbol = row.querySelector("td:nth-child(2) strong").textContent;

  // Validate and escape token symbol
  const safeTokenSymbol = escapeHtml(tokenSymbol || 'Unknown');

  if (!confirm(`⚠️ DELETE TOKEN: ${safeTokenSymbol}?\\n\\nThis will permanently remove the token and may affect:\\n• User balances in this token\\n• Transaction history\\n• Tier pricing\\n\\nThis action CANNOT be undone. Continue?`)) {
    return;
  }

  setLoading(btn, true);
  try {
    // Validate tokenId is numeric
    const validTokenId = parseInt(tokenId);
    if (isNaN(validTokenId) || validTokenId <= 0) {
      throw new Error('Invalid token ID');
    }

    const r = await API(`/admin/tokens/${validTokenId}`, { method: "DELETE" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Delete failed");

    // Remove the row from UI
    row.remove();
    showMessage("tokenMsg", `✓ Token ${safeTokenSymbol} deleted successfully`, false);
  } catch (e) {
    alert(`Failed to delete token: ${escapeHtml(e.message)}`);
  } finally {
    setLoading(btn, false);
  }
}

export function initTokensSection() {
  // Initialize token creation form
  $("createToken").onclick = async () => {
    const btn = $("createToken");

    // Sanitize and validate inputs
    const symbolInput = $("newTokenSymbol");
    const addressInput = $("newTokenAddress");
    const decimalsInput = $("newTokenDecimals");

    let symbol, address, decimals;

    try {
      symbol = sanitizeInput(symbolInput.value, {
        allowAlphanumeric: true,
        maxLength: 10,
        pattern: /^[A-Z][A-Z0-9]*$/i
      });

      address = sanitizeInput(addressInput.value, {
        pattern: /^0x[a-fA-F0-9]{40}$/,
        maxLength: 42
      });

      decimals = parseInt(decimalsInput.value);

      if (!symbol || !address || !decimals || decimals < 0 || decimals > 18) {
        throw new Error("Please fill in all fields with valid values");
      }
    } catch (e) {
      return showMessage("tokenMsg", e.message, true);
    }

    setLoading(btn, true);
    try {
      const r = await API("/admin/tokens", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ symbol, address, decimals })
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Creation failed");

      // Clear form and reload
      symbolInput.value = "";
      addressInput.value = "";
      decimalsInput.value = "";

      await loadTokens();
      showMessage("tokenMsg", `✓ Token ${escapeHtml(symbol)} created successfully`, false);
    } catch (e) {
      showMessage("tokenMsg", `Failed to create token: ${escapeHtml(e.message)}`, true);
    } finally {
      setLoading(btn, false);
    }
  };
}