// src/web/admin/ui_complete.js - Complete Admin frontend JavaScript

// ---------- Utility helpers ----------
const $ = (id) => document.getElementById(id);
const API = async (path, opts = {}) => {
  const secret = localStorage.getItem("pip_admin_secret") || "";
  const headers = { "Authorization": `Bearer ${secret}`, ...(opts.headers || {}) };
  try { return await fetch(path, { ...opts, headers }); }
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

// Load all data on page load
async function loadAllData() {
  try {
    await Promise.all([
      loadConfig(),
      loadTierTokenOptions(),
      loadTiers(),
      loadTokens(),
      loadServers(),
      loadTreasury(),
      loadAds(),
    ]);
  } catch (e) { console.error("Failed to load data:", e); }
}

// Initialize on page load
(() => {
  const saved = localStorage.getItem("pip_admin_secret"); if (saved) $("secret").value = saved;
  setDefaultDates(); checkAuthAndLoad();
})();