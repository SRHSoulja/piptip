// src/web/admin/js/tokens.js - Token management functionality
import { API, showMessage, setLoading, $ } from './core.js';
import { setupFeeInputs } from './fees.js';

export async function loadTokens() {
  try {
    const r = await API("/admin/tokens"); const j = await r.json();
    if (!j.ok) return showMessage("tokenMsg","Failed to load tokens",true);
    const tbody = $("tokensTbl").querySelector("tbody"); tbody.innerHTML = "";
    j.tokens.forEach(t => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${t.id}</td>
        <td><strong>${t.symbol}</strong></td>
        <td><code>${t.address}</code></td>
        <td>${t.decimals}</td>
        <td><input type="checkbox" ${t.active?"checked":""} data-field="active"/></td>
        <td><input value="${t.minDeposit}" data-field="minDeposit" type="number" step="0.01" style="width:80px"/></td>
        <td><input value="${t.minWithdraw}" data-field="minWithdraw" type="number" step="0.01" style="width:80px"/></td>
        <td><div class="fee-input-container">
          <input value="${t.tipFeeBps ? (t.tipFeeBps / 100).toFixed(2) : ""}" placeholder="default" data-field="tipFeePercent" type="number" step="0.01" min="0" max="10" style="width:50px"/><span class="fee-suffix">%</span>
          <div class="fee-presets">
            <button type="button" class="preset-btn" data-field="tipFeePercent" data-value="0.5">0.5%</button>
            <button type="button" class="preset-btn" data-field="tipFeePercent" data-value="1">1%</button>
            <button type="button" class="preset-btn" data-field="tipFeePercent" data-value="1.5">1.5%</button>
            <button type="button" class="preset-btn" data-field="tipFeePercent" data-value="2">2%</button>
          </div>
          <div class="fee-preview" data-field="tipFeePreview"></div>
        </div></td>
        <td><div class="fee-input-container">
          <input value="${t.houseFeeBps ? (t.houseFeeBps / 100).toFixed(2) : ""}" placeholder="default" data-field="houseFeePercent" type="number" step="0.01" min="0" max="10" style="width:50px"/><span class="fee-suffix">%</span>
          <div class="fee-presets">
            <button type="button" class="preset-btn" data-field="houseFeePercent" data-value="1">1%</button>
            <button type="button" class="preset-btn" data-field="houseFeePercent" data-value="2">2%</button>
            <button type="button" class="preset-btn" data-field="houseFeePercent" data-value="2.5">2.5%</button>
            <button type="button" class="preset-btn" data-field="houseFeePercent" data-value="3">3%</button>
          </div>
          <div class="fee-preview" data-field="houseFeePreview"></div>
        </div></td>
        <td><input value="${t.withdrawMaxPerTx ?? ""}" placeholder="default" data-field="withdrawMaxPerTx" type="number" step="0.01" style="width:80px"/></td>
        <td><input value="${t.withdrawDailyCap ?? ""}" placeholder="default" data-field="withdrawDailyCap" type="number" step="0.01" style="width:80px"/></td>
        <td>
          <button class="saveToken" data-id="${t.id}">Save</button>
          <button class="deleteToken" data-id="${t.id}" style="background:#ef4444; margin-left:4px;">Delete</button>
        </td>`;
      tbody.appendChild(tr);
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

    // Remove the row from UI
    row.remove();
    showMessage("tokenMsg", `✓ Token ${tokenSymbol} deleted successfully`, false);
  } catch (e) {
    alert(`Failed to delete token: ${e.message}`);
  } finally {
    setLoading(btn, false);
  }
}

export function initTokensSection() {
  // Initialize token creation form
  $("createToken").onclick = async () => {
    const btn = $("createToken");
    const symbol = $("newTokenSymbol").value.trim();
    const address = $("newTokenAddress").value.trim();
    const decimals = parseInt($("newTokenDecimals").value);

    if (!symbol || !address || !decimals) {
      return showMessage("tokenMsg", "Please fill in all fields", true);
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
      $("newTokenSymbol").value = "";
      $("newTokenAddress").value = "";
      $("newTokenDecimals").value = "";

      await loadTokens();
      showMessage("tokenMsg", `✓ Token ${symbol} created successfully`, false);
    } catch (e) {
      showMessage("tokenMsg", `Failed to create token: ${e.message}`, true);
    } finally {
      setLoading(btn, false);
    }
  };
}