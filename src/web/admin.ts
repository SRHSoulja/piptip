// src/web/admin.ts
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { JsonRpcProvider, Contract } from "ethers";
import { prisma } from "../services/db.js";
import { getConfig, ABSTRACT_RPC_URL } from "../config.js";
import { registerCommandsForApprovedGuilds } from "../services/command_registry.js";
import { getCommandsJson } from "../services/commands_def.js";
import { getActiveTokens } from "../services/token.js";
import { getTreasurySnapshot, invalidateTreasuryCache } from "../services/treasury.js";

export const adminRouter = Router();

// Read lazily so .env is loaded and hot-reloads work
const getAdminSecret = () => (process.env.ADMIN_SECRET ?? "").trim();

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

/* ------------------------------------------------------------------------ */
/*                           Admin UI (HTML shell)                          */
/* ------------------------------------------------------------------------ */
adminRouter.get("/ui", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>PIPtip Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial }
  body { margin:24px; background:#0a0a0a; color:#e5e5e5 }
  h1 { margin:0 0 12px; color:#fff }
  h2 { margin:16px 0 12px; color:#fff }
  section { border:1px solid #333; border-radius:12px; padding:16px; margin:16px 0; background:#111 }
  label { display:inline-block; min-width:220px; font-weight:500 }
  input, select, button { padding:8px 12px; margin:6px 6px 6px 0; border:1px solid #444; border-radius:6px; background:#222; color:#e5e5e5 }
  button { background:#2563eb; color:#fff; cursor:pointer; border:none }
  button:hover { background:#1d4ed8 }
  button:disabled { background:#374151; cursor:not-allowed; opacity:.6 }
  table { width:100%; border-collapse:collapse; margin-top:10px }
  th, td { border-bottom:1px solid #2a2a2a; padding:8px; text-align:left }
  th { background:#1a1a1a; font-weight:600 }
  .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center }
  .ok { color:#10b981; font-weight:500 }
  .err { color:#ef4444; font-weight:500 }
  code { background:#1a1a1a; padding:2px 6px; border-radius:4px; font-family:Monaco,Menlo,monospace; font-size:.9em }
  .loading { opacity:.6 }
  .status-indicator { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:8px }
  .status-indicator.online { background:#10b981 }
  .status-indicator.offline { background:#ef4444 }
</style>
</head>
<body>
  <h1>🎯 PIPtip Admin</h1>

  <section>
    <div class="row">
      <label>Admin Secret</label>
      <input id="secret" type="password" placeholder="Paste ADMIN_SECRET"/>
      <button id="saveSecret">Save & Connect</button>
      <span id="authStatus"></span>
    </div>
  </section>

  <section>
    <h2>⚙️ Configuration</h2>
    <div id="cfgForm" class="row">
      <label>Min Deposit</label>
      <input id="minDeposit" type="number" min="0" step="0.0000000001"/>
      <label>Min Withdraw</label>
      <input id="minWithdraw" type="number" min="0" step="0.0000000001"/>
      <label>Max Withdraw / tx (0 = none)</label>
      <input id="withdrawMaxPerTx" type="number" min="0" step="0.0000000001"/>
      <label>Daily Withdraw Cap (0 = none)</label>
      <input id="withdrawDailyCap" type="number" min="0" step="0.0000000001"/>
      <button id="saveCfg">Save Config</button>
      <button id="reloadCfg">Reload Cache</button>
      <span id="cfgMsg"></span>
    </div>
  </section>

  <section>
    <h2>🏷️ Tiers</h2>
    <div class="row">
      <input id="tierName" placeholder="Name" style="width:180px"/>
      <input id="tierDesc" placeholder="Description" style="width:260px"/>
      <select id="tierToken"></select>
      <input id="tierPrice" type="number" step="0.00000001" placeholder="Price"/>
      <input id="tierDays" type="number" min="1" placeholder="Days" style="width:100px"/>
      <label style="min-width:auto"><input id="tierTaxFree" type="checkbox"/> Tip Tax Free</label>
      <button id="addTier">Add Tier</button>
      <button id="reloadTiers">Reload</button>
      <span id="tierMsg"></span>
    </div>
    <table id="tiersTbl">
      <thead>
        <tr>
          <th>ID</th><th>Name</th><th>Token</th><th>Price</th><th>Days</th>
          <th>TaxFree</th><th>Active</th><th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>🪙 Tokens</h2>
    <div class="row">
      <input id="newTokenAddress" placeholder="0x..." maxlength="42"/>
      <button id="addToken">Add Token</button>
      <button id="refreshTokens">Refresh Cache</button>
      <span id="tokenMsg"></span>
    </div>
    <table id="tokensTbl">
      <thead>
        <tr>
          <th>ID</th><th>Symbol</th><th>Address</th><th>Decimals</th>
          <th>Active</th><th>MinDep</th><th>MinWdr</th>
          <th>TipFee(bps)</th><th>House(bps)</th>
          <th>Max/Tx</th><th>DailyCap</th><th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>🖥️ Servers</h2>
    <div class="row">
      <input id="newGuildId" placeholder="Guild ID" pattern="[0-9]+"/>
      <input id="newGuildNote" placeholder="Server description"/>
      <button id="addServer">Add Server</button>
    </div>
    <table id="serversTbl">
      <thead>
        <tr><th>ID</th><th>Guild ID</th><th>Note</th><th>Enabled</th><th>Actions</th></tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>💰 Treasury Balances</h2>
    <div class="row">
      <button id="reloadTreasury">Refresh Balances</button>
      <span id="treasuryMsg"></span>
    </div>
    <table id="treasuryTbl">
      <thead>
        <tr><th>Asset</th><th>Balance</th></tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>🪧 Ads</h2>
    <div class="row">
      <input id="adText" placeholder="Ad text (max 500 chars)" style="width:420px" maxlength="500"/>
      <input id="adUrl" placeholder="https://destination.example" style="width:320px"/>
      <input id="adWeight" type="number" min="1" max="100" value="5" style="width:80px"/>
      <label style="min-width:auto"><input id="adActive" type="checkbox" checked/> Active</label>
      <button id="addAd">Add Ad</button>
      <button id="reloadAds">Reload</button>
      <button id="refreshAdsCache">Refresh Cache</button>
      <span id="adsMsg"></span>
    </div>
    <table id="adsTbl">
      <thead>
        <tr><th>ID</th><th>Text</th><th>URL</th><th>Weight</th><th>Active</th><th>Actions</th></tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>📊 House Earnings</h2>
    <p>Tip fees and match rake collected by the platform</p>
    <div class="row">
      <label>From Date</label><input id="feesSince" type="date"/>
      <label>To Date</label><input id="feesUntil" type="date"/>
      <label>Guild (optional)</label><input id="feesGuild" placeholder="Guild ID"/>
      <button id="loadFees">Load Summary</button>
      <button id="csvFees">Download CSV</button>
      <span id="feesMsg"></span>
    </div>
    <table id="feesTbl">
      <thead><tr><th>Guild</th><th>Token</th><th>Tip Fees</th><th>Match Rake</th><th>Total</th></tr></thead>
      <tbody></tbody>
    </table>
    <p><small><strong>Tip fees:</strong> Platform commission from tips<br/><strong>Match rake:</strong> Platform take from completed matches</small></p>
  </section>

  <script src="/admin/ui.js" type="module"></script>
</body>
</html>`);
});

/* ------------------------------------------------------------------------ */
/*                      Admin UI (client JS served here)                    */
/* ------------------------------------------------------------------------ */
adminRouter.get("/ui.js", (_req, res) => {
  res.type("application/javascript").send(`
// ---------- Utility helpers ----------
const $ = (id) => document.getElementById(id);
const API = async (path, opts = {}) => {
  const secret = localStorage.getItem("pip_admin_secret") || "";
  const headers = { "Authorization": \`Bearer \${secret}\`, ...(opts.headers || {}) };
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
  ["tokensTbl","serversTbl","feesTbl","treasuryTbl","adsTbl"].forEach(id => {
    const tbody = document.querySelector(\`#\${id} tbody\`); if (tbody) tbody.innerHTML = "";
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

// ---------- Tokens ----------
async function loadTokens() {
  try {
    const r = await API("/admin/tokens"); const j = await r.json();
    if (!j.ok) return showMessage("tokenMsg","Failed to load tokens",true);
    const tbody = $("tokensTbl").querySelector("tbody"); tbody.innerHTML = "";
    j.tokens.forEach(t => {
      const tr = document.createElement("tr");
      tr.innerHTML = \`
        <td>\${t.id}</td>
        <td><strong>\${t.symbol}</strong></td>
        <td><code>\${t.address}</code></td>
        <td>\${t.decimals}</td>
        <td><input type="checkbox" \${t.active?"checked":""} data-field="active"/></td>
        <td><input value="\${t.minDeposit}" data-field="minDeposit" type="number" step="0.01" style="width:80px"/></td>
        <td><input value="\${t.minWithdraw}" data-field="minWithdraw" type="number" step="0.01" style="width:80px"/></td>
        <td><input value="\${t.tipFeeBps ?? ""}" placeholder="default" data-field="tipFeeBps" type="number" style="width:60px"/></td>
        <td><input value="\${t.houseFeeBps ?? ""}" placeholder="default" data-field="houseFeeBps" type="number" style="width:60px"/></td>
        <td><input value="\${t.withdrawMaxPerTx ?? ""}" placeholder="default" data-field="withdrawMaxPerTx" type="number" step="0.01" style="width:80px"/></td>
        <td><input value="\${t.withdrawDailyCap ?? ""}" placeholder="default" data-field="withdrawDailyCap" type="number" step="0.01" style="width:80px"/></td>
        <td><button class="saveToken" data-id="\${t.id}">Save</button></td>\`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".saveToken").forEach(btn => btn.onclick = () => saveToken(btn.dataset.id));
  } catch { showMessage("tokenMsg","Failed to load tokens",true); }
}
async function saveToken(tokenId) {
  const btn = document.querySelector(\`[data-id="\${tokenId}"].saveToken\`);
  const row = btn.closest("tr");
  setLoading(btn, true);
  try {
    const get = f => {
      const input = row.querySelector(\`[data-field="\${f}"]\`);
      if (input.type === "checkbox") return input.checked;
      const v = input.value.trim(); return v === "" ? null : Number(v);
    };
    const body = {
      active: get("active"),
      minDeposit: get("minDeposit"),
      minWithdraw: get("minWithdraw"),
      tipFeeBps: get("tipFeeBps"),
      houseFeeBps: get("houseFeeBps"),
      withdrawMaxPerTx: get("withdrawMaxPerTx"),
      withdrawDailyCap: get("withdrawDailyCap"),
    };
    const r = await API(\`/admin/tokens/\${tokenId}\`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Save failed");
    btn.textContent = "✓ Saved"; setTimeout(()=>btn.textContent="Save", 2000);
  } catch (e){ alert(\`Failed to save token: \${e.message}\`); }
  finally { setLoading(btn, false); }
}
$("addToken").onclick = async () => {
  const address = $("newTokenAddress").value.trim();
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return showMessage("tokenMsg","Please enter a valid contract address",true);
  setLoading("addToken", true);
  try {
    const r = await API("/admin/tokens",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({address})});
    const j = await r.json();
    if (!j.ok) return showMessage("tokenMsg", j.error || "Failed to add token", true);
    showMessage("tokenMsg", \`Added \${j.token.symbol} token\`, false);
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
      tr.innerHTML = \`
        <td>\${s.id}</td>
        <td><code>\${s.guildId}</code></td>
        <td><input value="\${s.note || ""}" data-field="note" placeholder="Description"/></td>
        <td>
          <span class="status-indicator \${s.enabled ? 'online' : 'offline'}"></span>
          <input type="checkbox" \${s.enabled ? "checked" : ""} data-field="enabled"/>
        </td>
        <td><button class="saveServer" data-id="\${s.id}">Save</button></td>\`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".saveServer").forEach(b => b.onclick = () => saveServer(b.dataset.id));
  } catch (e){ console.error("Failed to load servers:", e); }
}
async function saveServer(id) {
  const btn = document.querySelector(\`[data-id="\${id}"].saveServer\`);
  const row = btn.closest("tr");
  setLoading(btn, true);
  try {
    const enabled = row.querySelector('[data-field="enabled"]').checked;
    const note = row.querySelector('[data-field="note"]').value.trim();
    const r = await API(\`/admin/servers/\${id}\`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled,note})});
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Save failed");
    btn.textContent = "✓ Saved"; setTimeout(()=>btn.textContent="Save", 2000);
    row.querySelector(".status-indicator").className = \`status-indicator \${enabled?'online':'offline'}\`;
  } catch(e){ alert(\`Failed to save server: \${e.message}\`); }
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
    const r = await API(\`/admin/treasury\${force?'?force=1':''}\`); const j = await r.json();
    const tbody = $("treasuryTbl").querySelector("tbody"); tbody.innerHTML = "";
    if (!j.ok) return showMessage("treasuryMsg","Failed to load treasury",true);
    const ethRow = document.createElement("tr");
    ethRow.innerHTML = \`<td><strong>ETH (gas)</strong></td><td>\${j.ethHuman}</td>\`;
    tbody.appendChild(ethRow);
    (j.tokens || []).forEach(t => {
      const tr = document.createElement("tr");
      tr.innerHTML = \`<td><strong>\${t.symbol}</strong></td><td>\${t.human}</td>\`;
      tbody.appendChild(tr);
    });
    showMessage("treasuryMsg", \`Updated at \${new Date(j.ts).toLocaleTimeString()}\`, false);
  } catch { showMessage("treasuryMsg","Failed to load treasury",true); }
}
$("reloadTreasury").onclick = () => loadTreasury(true);

// ---------- Fees ----------
async function loadFees() {
  const since = $("feesSince").value, until = $("feesUntil").value, guildId = $("feesGuild").value.trim();
  setLoading("loadFees", true);
  try {
    const p = new URLSearchParams(); if (since) p.set("since", since); if (until) p.set("until", until); if (guildId) p.set("guildId", guildId);
    const r = await API(\`/admin/fees/by-server?\${p.toString()}\`); const j = await r.json();
    if (!j.ok) return showMessage("feesMsg","Failed to load fees",true);
    const tbody = $("feesTbl").querySelector("tbody"); tbody.innerHTML = "";
    let totalTipFees = 0, totalMatchRake = 0;
    j.rows.forEach(row => {
      const tip = parseFloat(row.tipFees), rake = parseFloat(row.matchRake), total = tip + rake;
      totalTipFees += tip; totalMatchRake += rake;
      const tr = document.createElement("tr");
      tr.innerHTML = \`
        <td>\${row.guildId || "Unknown"}</td>
        <td><strong>\${row.token}</strong></td>
        <td>\${formatNumber(tip)}</td>
        <td>\${formatNumber(rake)}</td>
        <td><strong>\${formatNumber(total)}</strong></td>\`;
      tbody.appendChild(tr);
    });
    if (j.rows.length > 1) {
      const tr = document.createElement("tr");
      tr.style.borderTop = "2px solid #444"; tr.style.fontWeight = "bold";
      tr.innerHTML = \`
        <td colspan="2"><strong>TOTAL</strong></td>
        <td><strong>\${formatNumber(totalTipFees)}</strong></td>
        <td><strong>\${formatNumber(totalMatchRake)}</strong></td>
        <td><strong>\${formatNumber(totalTipFees + totalMatchRake)}</strong></td>\`;
      tbody.appendChild(tr);
    }
    showMessage("feesMsg", \`Loaded \${j.rows.length} entries\`, false);
  } catch { showMessage("feesMsg","Failed to load fees",true); }
  finally { setLoading("loadFees", false); }
}
$("loadFees").onclick = loadFees;
$("csvFees").onclick = async () => {
  try {
    const p = new URLSearchParams();
    const since = $("feesSince").value, until = $("feesUntil").value, guildId = $("feesGuild").value.trim();
    if (since) p.set("since", since); if (until) p.set("until", until); if (guildId) p.set("guildId", guildId);
    const r = await API(\`/admin/fees/export.csv?\${p.toString()}\`); const blob = await r.blob();
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = \`house_fees_\${since || 'all'}_to_\${until || 'now'}.csv\`; a.click(); URL.revokeObjectURL(url);
  } catch { showMessage("feesMsg","Export failed",true); }
};

// ---------- Ads ----------
async function loadAds() {
  try {
    const r = await API("/admin/ads"); const j = await r.json();
    if (!j.ok) return showMessage("adsMsg","Failed to load ads",true);
    const tb = $("adsTbl").querySelector("tbody"); tb.innerHTML = "";
    (j.ads || []).forEach(ad => {
      const tr = document.createElement("tr"); tr.dataset.id = ad.id;
      tr.innerHTML = \`
        <td>\${ad.id}</td>
        <td><input value="\${(ad.text || "").replace(/"/g,"&quot;")}" data-field="text" maxlength="500" style="width:420px"/></td>
        <td><input value="\${ad.url || ""}" data-field="url" placeholder="https://..." style="width:320px"/></td>
        <td><input value="\${ad.weight}" data-field="weight" type="number" min="1" max="100" style="width:80px"/></td>
        <td style="white-space:nowrap">
          <span class="status-indicator \${ad.active ? 'online' : 'offline'}"></span>
          <input type="checkbox" \${ad.active ? "checked" : ""} data-field="active"/>
        </td>
        <td>
          <button class="saveAd">Save</button>
          <button class="deleteAd" style="background:#ef4444">Delete</button>
        </td>\`;
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
        const r = await API(\`/admin/ads/\${id}\`, { method:"DELETE" }); const j = await r.json();
        if (!j.ok) throw new Error(j.error || "Delete failed");
        row.remove(); showMessage("adsMsg","Ad deleted",false);
      } catch(e){ showMessage("adsMsg", e.message || "Delete failed", true); }
      finally { setLoading(btn, false); }
    });
    showMessage("adsMsg", \`Loaded \${j.ads.length} ads\`, false);
  } catch { showMessage("adsMsg","Failed to load ads",true); }
}
async function saveAd(id, row, buttonEl) {
  const get = (name) => row.querySelector(\`[data-field="\${name}"]\`);
  const text = get("text").value.trim();
  const url = get("url").value.trim();
  const weight = Number(get("weight").value.trim());
  const active = get("active").checked;
  const body = { text, url, weight, active };
  setLoading(buttonEl, true);
  try {
    const r = await API(\`/admin/ads/\${id}\`, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || "Save failed");
    row.querySelector(".status-indicator").className = \`status-indicator \${active?'online':'offline'}\`;
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
      opt.textContent = \`\${t.symbol}\`;
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
      tr.innerHTML = \`
        <td>\${t.id}</td>
        <td><input value="\${t.name}" data-field="name" style="width:160px"/></td>
        <td>\${t.token?.symbol || t.tokenId}</td>
        <td><input value="\${t.priceAmount}" data-field="priceAmount" type="number" step="0.00000001" style="width:140px"/></td>
        <td><input value="\${t.durationDays}" data-field="durationDays" type="number" min="1" style="width:90px"/></td>
        <td><input type="checkbox" \${t.tipTaxFree ? "checked" : ""} data-field="tipTaxFree"/></td>
        <td><input type="checkbox" \${t.active ? "checked" : ""} data-field="active"/></td>
        <td><button class="saveTier">Save</button></td>\`;
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
        const r = await API(\`/admin/tiers/\${id}\`, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "Save failed");
        ev.target.textContent = "✓ Saved"; setTimeout(()=>ev.target.textContent="Save", 1500);
        showMessage("tierMsg","Tier saved",false);
      } catch(e){ showMessage("tierMsg", e.message || "Save failed", true); }
      finally { setLoading(ev.target, false); }
    });
    showMessage("tierMsg", \`Loaded \${j.tiers.length} tiers\`, false);
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

async function loadAllData() {
  try {
    await Promise.all([
      loadConfig(),
      loadTokens(),
      loadServers(),
      loadTreasury(),
      loadAds(),
      loadTierTokenOptions(),
      loadTiers(),
    ]);
  } catch (e) { console.error("Failed to load data:", e); }
}
(() => {
  const saved = localStorage.getItem("pip_admin_secret"); if (saved) $("secret").value = saved;
  setDefaultDates(); checkAuthAndLoad();
})();
`);
});

// ---- date helpers for fees endpoints ----
type DateRange = { since: Date; until: Date };

function parseDateRange(query: any): DateRange {
  const sinceStr = typeof query?.since === "string" ? query.since : undefined;
  const untilStr = typeof query?.until === "string" ? query.until : undefined;

  let since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let until = untilStr ? new Date(untilStr) : new Date();

  // basic guards (avoid NaN dates, and ensure order)
  if (isNaN(since.getTime())) throw new Error('Invalid "since" date');
  if (isNaN(until.getTime())) throw new Error('Invalid "until" date');

  if (until < since) {
    const tmp = since;
    since = until;
    until = tmp;
  }

  return { since, until };
}


adminRouter.get("/fees/export.csv", async (req, res) => {
  try {
    const { since, until } = parseDateRange(req.query);
    const guildId = req.query.guildId ? String(req.query.guildId) : undefined;

    const transactions = await prisma.transaction.groupBy({
      by: ["guildId", "tokenId"],
      where: { OR: [{ type: "TIP" }, { type: "MATCH_RAKE" }], ...(guildId && { guildId }), createdAt: { gte: since, lte: until } },
      _sum: { fee: true, amount: true },
    });

    const tokens = await prisma.token.findMany({ select: { id: true, symbol: true } });
    const tokenMap = new Map<number, string>(tokens.map(t => [t.id, t.symbol]));

    let csv = "guildId,token,tipFees,matchRake,total,dateRange\n";
    transactions.forEach(tr => {
      const tipFees = String(tr._sum.fee || 0);
      const matchRake = String(tr._sum.amount || 0);
      const total = (parseFloat(tipFees) + parseFloat(matchRake)).toString();
      const tokenLabel = tr.tokenId ? (tokenMap.get(tr.tokenId) ?? `Token#${tr.tokenId}`) : "Unknown";
      const dateRange = `${since.toDateString()} to ${until.toDateString()}`;
      csv += `"${tr.guildId || ""}","${tokenLabel}","${tipFees}","${matchRake}","${total}","${dateRange}"\n`;
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="house_fees_export.csv"');
    res.send(csv);
  } catch {
    res.status(500).json({ ok:false, error:"Failed to export CSV" });
  }
});

// Ads
adminRouter.get("/ads", async (_req, res) => {
  try {
    const ads = await prisma.ad.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ ok: true, ads });
  } catch {
    res.status(500).json({ ok:false, error:"Failed to fetch ads" });
  }
});

adminRouter.post("/ads", async (req, res) => {
  try {
    const { text, url, weight = 5, active = true } = req.body;
    if (!text || typeof text !== "string" || text.trim().length === 0) return res.status(400).json({ ok:false, error:"Ad text is required" });
    if (text.length > 500) return res.status(400).json({ ok:false, error:"Ad text too long (max 500 characters)" });
    if (url && (!/^https?:\/\/.+/.test(url) || url.length > 2000)) return res.status(400).json({ ok:false, error:"Invalid URL format or too long" });

    const weightNum = Number(weight);
    if (isNaN(weightNum) || weightNum < 1 || weightNum > 100) return res.status(400).json({ ok:false, error:"Weight must be between 1 and 100" });

    const ad = await prisma.ad.create({ data: { text: text.trim(), url: url?.trim() || null, weight: weightNum, active: Boolean(active) } });
    res.json({ ok:true, ad, message:"Ad created successfully" });
  } catch {
    res.status(500).json({ ok:false, error:"Failed to create ad" });
  }
});

adminRouter.put("/ads/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok:false, error:"Invalid ad ID" });

    const { active, weight, text, url } = req.body;
    const data: any = {};
    if (typeof active === "boolean") data.active = active;
    if (weight !== undefined) {
      const w = Number(weight);
      if (isNaN(w) || w < 1 || w > 100) return res.status(400).json({ ok:false, error:"Weight must be between 1 and 100" });
      data.weight = w;
    }
    if (text !== undefined) {
      if (!text || text.trim().length === 0) return res.status(400).json({ ok:false, error:"Ad text is required" });
      if (text.length > 500) return res.status(400).json({ ok:false, error:"Ad text too long (max 500 characters)" });
      data.text = text.trim();
    }
    if (url !== undefined) {
      if (url && (!/^https?:\/\/.+/.test(url) || url.length > 2000)) return res.status(400).json({ ok:false, error:"Invalid URL format or too long" });
      data.url = url?.trim() || null;
    }

    const ad = await prisma.ad.update({ where: { id }, data });
    res.json({ ok:true, ad });
  } catch (error: any) {
    if (error.code === "P2025") return res.status(404).json({ ok:false, error:"Ad not found" });
    res.status(500).json({ ok:false, error:"Failed to update ad" });
  }
});

adminRouter.delete("/ads/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok:false, error:"Invalid ad ID" });
    await prisma.ad.delete({ where: { id } });
    res.json({ ok:true, message:"Ad deleted successfully" });
  } catch (error: any) {
    if (error.code === "P2025") return res.status(404).json({ ok:false, error:"Ad not found" });
    res.status(500).json({ ok:false, error:"Failed to delete ad" });
  }
});

adminRouter.post("/ads/refresh", async (_req, res) => {
  try {
    const { refreshAdsCache } = await import("../services/ads.js");
    await refreshAdsCache();
    res.json({ ok:true, message:"Ad cache refreshed successfully" });
  } catch {
    res.status(500).json({ ok:false, error:"Failed to refresh ad cache" });
  }
});

/* ------------------------------------------------------------------------ */
/*                        Auth middleware & JSON API                        */
/* ------------------------------------------------------------------------ */

// Authentication
adminRouter.use((req, res, next) => {
  const authHeader = req.headers.authorization?.trim();
  const expectedAuth = `Bearer ${getAdminSecret()}`;
  if (!getAdminSecret() || authHeader !== expectedAuth) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
});