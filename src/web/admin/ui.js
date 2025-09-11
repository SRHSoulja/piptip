// src/web/admin/ui_complete.js - Complete Admin frontend JavaScript

// ---------- Utility helpers ----------
const $ = (id) => document.getElementById(id);
const API = async (path, opts = {}) => {
  const secret = localStorage.getItem("pip_admin_secret") || "";
  const headers = { "Authorization": `Bearer ${secret}`, ...(opts.headers || {}) };
  console.log(`🌐 Making API call to: ${path}`);
  try { 
    const response = await fetch(path, { ...opts, headers }); 
    console.log(`📡 API response status: ${response.status}`);
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
    const tbody = document.querySelector(`#${id} tbody`); if (tbody) tbody.innerHTML = "";
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
    sel.innerHTML = "";
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
    tb.innerHTML = "";
    (j.tiers || []).forEach(t => {
      const tr = document.createElement("tr");
      tr.dataset.id = t.id;
      tr.innerHTML = `
        <td>${t.id}</td>
        <td><input value="${t.name}" data-field="name" style="width:160px"/></td>
        <td>${t.token?.symbol || t.tokenId}</td>
        <td><input value="${t.priceAmount}" data-field="priceAmount" type="number" step="0.00000001" style="width:140px"/></td>
        <td><input value="${t.durationDays}" data-field="durationDays" type="number" min="1" style="width:90px"/></td>
        <td><input type="checkbox" ${t.tipTaxFree ? "checked" : ""} data-field="tipTaxFree"/></td>
        <td><input type="checkbox" ${t.active ? "checked" : ""} data-field="active"/></td>
        <td><button class="saveTier">Save</button></td>`;
      tb.appendChild(tr);
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
    const tbody = $("serversTbl").querySelector("tbody"); tbody.innerHTML = "";
    j.servers.forEach(s => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${s.id}</td>
        <td><strong>${s.servername || "Loading..."}</strong></td>
        <td><code>${s.guildId}</code></td>
        <td><input value="${s.note || ""}" data-field="note" placeholder="Description"/></td>
        <td>
          <span class="status-indicator ${s.enabled ? 'online' : 'offline'}"></span>
          <input type="checkbox" ${s.enabled ? "checked" : ""} data-field="enabled"/>
        </td>
        <td>
          <button class="saveServer" data-id="${s.id}">Save</button>
          <button class="deleteServer" data-id="${s.id}" style="background:#ef4444; margin-left:4px;">Delete</button>
        </td>`;
      tbody.appendChild(tr);
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
    const tbody = $("treasuryTbl").querySelector("tbody"); tbody.innerHTML = "";
    if (!j.ok) return showMessage("treasuryMsg","Failed to load treasury",true);
    const ethRow = document.createElement("tr");
    ethRow.innerHTML = `<td><strong>ETH (gas)</strong></td><td>${j.ethHuman}</td>`;
    tbody.appendChild(ethRow);
    (j.tokens || []).forEach(t => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><strong>${t.symbol}</strong></td><td>${t.human}</td>`;
      tbody.appendChild(tr);
    });
    showMessage("treasuryMsg", `Updated at ${new Date(j.ts).toLocaleTimeString()}`, false);
  } catch { showMessage("treasuryMsg","Failed to load treasury",true); }
}
$("reloadTreasury").onclick = () => loadTreasury(true);

// ---------- Ads ----------
async function loadAds() {
  try {
    const r = await API("/admin/ads"); const j = await r.json();
    if (!j.ok) return showMessage("adsMsg","Failed to load ads",true);
    const tb = $("adsTbl").querySelector("tbody"); tb.innerHTML = "";
    (j.ads || []).forEach(ad => {
      const tr = document.createElement("tr"); tr.dataset.id = ad.id;
      tr.innerHTML = `
        <td>${ad.id}</td>
        <td><input value="${(ad.text || "").replace(/"/g,"&quot;")}" data-field="text" maxlength="500" style="width:420px"/></td>
        <td><input value="${ad.url || ""}" data-field="url" placeholder="https://..." style="width:320px"/></td>
        <td><input value="${ad.weight}" data-field="weight" type="number" min="1" max="100" style="width:80px"/></td>
        <td style="white-space:nowrap">
          <span class="status-indicator ${ad.active ? 'online' : 'offline'}"></span>
          <input type="checkbox" ${ad.active ? "checked" : ""} data-field="active"/>
        </td>
        <td>
          <button class="saveAd">Save</button>
          <button class="deleteAd" style="background:#ef4444">Delete</button>
        </td>`;
      tb.appendChild(tr);
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
    const tbody = $("feesTbl").querySelector("tbody"); tbody.innerHTML = "";
    let totalTipFees = 0, totalMatchRake = 0;
    j.rows.forEach(row => {
      const tip = parseFloat(row.tipFees), rake = parseFloat(row.matchRake), total = tip + rake;
      totalTipFees += tip; totalMatchRake += rake;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${row.guildId || "Unknown"}</td>
        <td><strong>${row.token}</strong></td>
        <td>${formatNumber(tip)}</td>
        <td>${formatNumber(rake)}</td>
        <td><strong>${formatNumber(total)}</strong></td>`;
      tbody.appendChild(tr);
    });
    if (j.rows.length > 1) {
      const tr = document.createElement("tr");
      tr.style.borderTop = "2px solid #444"; tr.style.fontWeight = "bold";
      tr.innerHTML = `
        <td colspan="2"><strong>TOTAL</strong></td>
        <td><strong>${formatNumber(totalTipFees)}</strong></td>
        <td><strong>${formatNumber(totalMatchRake)}</strong></td>
        <td><strong>${formatNumber(totalTipFees + totalMatchRake)}</strong></td>`;
      tbody.appendChild(tr);
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

function displayUsers(users) {
  console.log("🎨 displayUsers called with:", users);
  const tbody = $("usersTbl").querySelector("tbody");
  if (!tbody) {
    console.error("❌ Could not find users table tbody element");
    return;
  }
  
  tbody.innerHTML = "";
  
  if (!users || users.length === 0) {
    console.log("ℹ️ No users to display");
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:#9ca3af;">No users found</td></tr>';
    return;
  }
  
  console.log(`🎯 Displaying ${users.length} users`);
  users.forEach((user, index) => {
    console.log(`👤 Processing user ${index + 1}:`, user);
    const tr = document.createElement("tr");
    
    const balances = user.balances?.map(b => `${formatNumber(b.amount)} ${b.tokenSymbol}`).join(", ") || "None";
    const memberships = user.membershipDetails?.map(m => `${m.tierName} (${m.status})`).join(", ") || "None";
    
    tr.innerHTML = `
      <td><strong>${user.username || "Unknown"}</strong></td>
      <td><code>${user.discordId}</code></td>
      <td><code>${user.agwAddress || "Not linked"}</code></td>
      <td>${new Date(user.createdAt).toLocaleDateString()}</td>
      <td>${user.lastActivity ? new Date(user.lastActivity).toLocaleDateString() : "Never"}</td>
      <td>${formatNumber(user.totalTipsSent || 0)}</td>
      <td>${formatNumber(user.totalTipsReceived || 0)}</td>
      <td>${memberships}</td>
      <td>${balances}</td>
      <td>
        <button class="exportUser" data-discord-id="${user.discordId}" style="background:#2563eb; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; margin-right:4px;">📊 Export CSV</button><br/>
        <button class="deleteUser" data-discord-id="${user.discordId}" style="background:#f59e0b; color:white; border:none; padding:3px 6px; border-radius:4px; cursor:pointer; margin-right:4px; margin-top:4px;">Delete (Anonymize)</button>
        <button class="hardDeleteUser" data-discord-id="${user.discordId}" style="background:#dc2626; color:white; border:none; padding:3px 6px; border-radius:4px; cursor:pointer; margin-top:4px;">Hard Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  // Add export functionality
  tbody.querySelectorAll(".exportUser").forEach(btn => {
    btn.onclick = () => exportUserData(btn.dataset.discordId);
  });
  
  // Add delete functionality
  tbody.querySelectorAll(".deleteUser").forEach(btn => {
    btn.onclick = () => deleteUser(btn.dataset.discordId, false);
  });
  tbody.querySelectorAll(".hardDeleteUser").forEach(btn => {
    btn.onclick = () => deleteUser(btn.dataset.discordId, true);
  });
}

async function deleteUser(discordId, hardDelete = false) {
  const btn = document.querySelector(`[data-discord-id="${discordId}"]${hardDelete ? '.hardDeleteUser' : '.deleteUser'}`);
  const row = btn.closest("tr");
  const username = row.querySelector("td:first-child strong").textContent;
  
  // Different confirmation messages for different deletion types
  let confirmMessage, promptMessage, deleteType;
  
  if (hardDelete) {
    deleteType = "HARD DELETE";
    confirmMessage = `🚨 HARD DELETE USER: ${username}\\n\\nDiscord ID: ${discordId}\\n\\nThis will PERMANENTLY REMOVE:\\n• User account and profile\\n• All token balances\\n• ALL transaction history\\n• Tier memberships\\n• All tips sent/received (others' tip counts will decrease!)\\n• Group tip participation\\n• Match history\\n\\n⚠️ THIS AFFECTS OTHER USERS' STATISTICS!\\n⚠️ THIS ACTION CANNOT BE UNDONE!\\n\\nOnly use for cleaning up test data!`;
    promptMessage = `To permanently HARD DELETE user "${username}" and remove all transaction history, type HARD DELETE in ALL CAPS:`;
  } else {
    deleteType = "SOFT DELETE";
    confirmMessage = `⚠️ DELETE USER: ${username}\\n\\nDiscord ID: ${discordId}\\n\\nThis will:\\n• Delete user account and profile\\n• Delete token balances\\n• Anonymize transaction history (preserves others' statistics)\\n• Delete tier memberships\\n• Anonymize tips (preserves tip counts for other users)\\n• Anonymize group tip and match participation\\n\\n✅ Other users' statistics remain intact\\n\\nThis action CANNOT be undone!`;
    promptMessage = `To delete user "${username}" and anonymize their data, type DELETE in ALL CAPS:`;
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
  
  dropdown.innerHTML = "";
  
  if (users.length === 0) {
    dropdown.innerHTML = '<div style="padding: 12px; color: #9ca3af; text-align: center;">No users found</div>';
  } else {
    users.forEach(user => {
      const item = document.createElement("div");
      item.style.cssText = `
        padding: 12px;
        cursor: pointer;
        border-bottom: 1px solid #f3f4f6;
        transition: background-color 0.15s;
      `;
      item.innerHTML = `
        <div style="font-weight: 500; color: #111827;">${user.username}</div>
        <div style="font-size: 0.875rem; color: #6b7280;">ID: ${user.discordId}</div>
        <div style="font-size: 0.875rem; color: #6b7280;">Joined: ${new Date(user.createdAt).toLocaleDateString()}</div>
      `;
      
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
$("userSearchInput").oninput = handleUserSearchInput;
$("userSearchInput").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    searchUsers();
  } else if (e.key === "Escape") {
    hideSearchDropdown();
  }
};
$("searchUserBtn").onclick = searchUsers;
$("findUser").onclick = findUser;
$("loadTopUsers").onclick = loadTopUsers;
$("clearSearch").onclick = () => {
  $("searchUser").value = "";
  const tbody = $("usersTbl").querySelector("tbody");
  tbody.innerHTML = "";
  showMessage("userMsg", "", false);
};
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
    statusDiv.innerHTML = `
      <p><strong>Service Status:</strong> ${serviceStatus}</p>
      <p><strong>Backup Interval:</strong> ${j.intervalMinutes} minutes</p>
      <p><strong>Total Backups:</strong> ${j.totalBackups}/${j.maxBackups}</p>
      <p><strong>Backup Directory:</strong> <code>${j.backupDir || 'Default'}</code></p>
      ${j.error ? `<p style="color:#ef4444;"><strong>Error:</strong> ${j.error}</p>` : ''}
    `;
    
    // Load recent backups table
    const tbody = $("backupTbl").querySelector("tbody");
    tbody.innerHTML = "";
    
    if (j.recentBackups && j.recentBackups.length > 0) {
      j.recentBackups.forEach(backup => {
        const tr = document.createElement("tr");
        const createdDate = new Date(backup.created).toLocaleString();
        tr.innerHTML = `
          <td><code>${backup.filename}</code></td>
          <td>${formatNumber(backup.size)}</td>
          <td>${createdDate}</td>
          <td>
            <button class="downloadBackup" data-filename="${backup.filename}" style="background:#2563eb; color:white; border:none; padding:2px 6px; border-radius:3px; cursor:pointer;">📥 Download</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      
      // Add download handlers
      tbody.querySelectorAll(".downloadBackup").forEach(btn => {
        btn.onclick = () => downloadBackup(btn.dataset.filename);
      });
    } else {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#9ca3af;">No backups found</td></tr>';
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
    biggestTipDiv.innerHTML = `
      <div style="font-size: 1.2em; font-weight: bold; color: #f59e0b;">
        ${amount} ${highlights.biggestTip.token}
      </div>
      <div style="font-size: 0.9em; color: #9ca3af; margin-top: 4px;">
        ${date}
      </div>
    `;
  } else {
    biggestTipDiv.innerHTML = '<div style="color: #9ca3af;">No tips recorded</div>';
  }
  
  // Most active user
  const mostActiveDiv = $("most-active");
  if (highlights.mostActiveUser) {
    const user = highlights.mostActiveUser;
    mostActiveDiv.innerHTML = `
      <div style="font-size: 1.1em; font-weight: bold; color: #10b981;">
        ${user.username || `User ${user.discordId.slice(0, 8)}...`}
      </div>
      <div style="font-size: 0.9em; color: #9ca3af; margin-top: 4px;">
        ${user.tipCount} tips • ${user.gameCount} games
      </div>
      <div style="font-size: 0.8em; color: #6b7280; margin-top: 2px;">
        ${user.totalActivity} total activities
      </div>
    `;
  } else {
    mostActiveDiv.innerHTML = '<div style="color: #9ca3af;">No activity recorded</div>';
  }
}

function updateServerStats(servers) {
  const tbody = $("serverStatsTbl").querySelector("tbody");
  tbody.innerHTML = "";
  
  if (servers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#9ca3af;">No server data available</td></tr>';
    return;
  }
  
  servers.forEach(server => {
    const tr = document.createElement("tr");
    const lastActivity = server.lastActivity 
      ? new Date(server.lastActivity).toLocaleDateString()
      : "Never";
    
    const totalActivity = server.tipCount + server.gameCount + server.groupTipCount;
    
    tr.innerHTML = `
      <td><strong>${server.serverName}</strong><br/><small style="color:#9ca3af;">${server.guildId}</small></td>
      <td>${formatNumber(server.tipCount)}</td>
      <td>${formatNumber(server.gameCount)}</td>
      <td>${formatNumber(server.groupTipCount)}</td>
      <td>${formatNumber(server.activeUsers)}</td>
      <td>${lastActivity}</td>
      <td>
        <button class="exportGuildFromStats" data-guild-id="${server.guildId}" style="background:#2563eb; color:white; border:none; padding:2px 6px; border-radius:3px; cursor:pointer; font-size:11px;">📊 Export</button>
      </td>
    `;
    tbody.appendChild(tr);
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
  tbody.innerHTML = "";
  
  if (tokens.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#9ca3af;">No token data available</td></tr>';
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
    
    tr.innerHTML = `
      <td>
        <strong>${token.symbol}</strong><br/>
        <small style="color:#9ca3af;">${token.address.slice(0, 10)}...</small>
      </td>
      <td>${totalTipped}</td>
      <td>${formatNumber(token.tipCount)}</td>
      <td>${avgTipSize}</td>
      <td>${lastActivity}</td>
    `;
    tbody.appendChild(tr);
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
    tbody.innerHTML = "";

    j.transactions.forEach(tx => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${tx.id}</td>
        <td>${tx.type}</td>
        <td>${tx.userId || "System"}</td>
        <td>${formatNumber(tx.amount)}</td>
        <td>${tx.tokenId || "N/A"}</td>
        <td>${formatNumber(tx.fee)}</td>
        <td>${new Date(tx.createdAt).toLocaleString()}</td>
        <td>${tx.guildId || "N/A"}</td>
        <td>${tx.metadata || ""}</td>
      `;
      tbody.appendChild(tr);
    });

    showMessage("txMsg", `Loaded ${j.transactions.length} transactions`, false);
  } catch {
    showMessage("txMsg", "Failed to load transactions", true);
  } finally {
    setLoading("loadTransactions", false);
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
    tbody.innerHTML = "";

    j.groupTips.forEach(gt => {
      const tr = document.createElement("tr");
      const expiresAt = new Date(gt.expiresAt).toLocaleString();
      const createdAt = new Date(gt.createdAt).toLocaleString();
      
      tr.innerHTML = `
        <td>${gt.id}</td>
        <td>${gt.Creator?.discordId?.slice(0, 8) || gt.creatorId || "Unknown"}...</td>
        <td>${formatNumber(gt.totalAmount)}</td>
        <td>${gt.Token?.symbol || "Unknown"}</td>
        <td>${gt.status}</td>
        <td>${gt.claimCount || 0}</td>
        <td>${createdAt}</td>
        <td>${expiresAt}</td>
        <td>
          <button class="expireGroupTip" data-id="${gt.id}" style="background:#f59e0b; color:white; border:none; padding:2px 6px; border-radius:3px; cursor:pointer; font-size:11px;">Expire</button>
        </td>
      `;
      tbody.appendChild(tr);
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
      loadTreasury(),
      loadAds(),
      loadTransactions(),
      loadGroupTips(),
      loadTopUsers(), // AUTO-LOAD USERS
    ]);
    
    console.log("✅ Initial admin data loaded including users.");
  } catch (e) { console.error("Failed to load data:", e); }
}

// Initialize on page load
(() => {
  const saved = localStorage.getItem("pip_admin_secret"); if (saved) $("secret").value = saved;
  setDefaultDates(); checkAuthAndLoad();
})();