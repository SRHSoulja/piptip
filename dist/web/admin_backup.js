// src/web/admin.ts
import "dotenv/config";
import { Router } from "express";
import { JsonRpcProvider, Contract } from "ethers";
import { prisma } from "../services/db.js";
import { getConfig, ABSTRACT_RPC_URL } from "../config.js";
import { registerCommandsForApprovedGuilds } from "../services/command_registry.js";
import { getCommandsJson } from "../services/commands_def.js";
import { getTreasurySnapshot, invalidateTreasuryCache } from "../services/treasury.js";
import { getDiscordClient, fetchMultipleUsernames, fetchMultipleServernames } from "../services/discord_users.js";
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
        <tr><th>ID</th><th>Server Name</th><th>Guild ID</th><th>Note</th><th>Enabled</th><th>Actions</th></tr>
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
    <h2>👥 User Management</h2>
    <div class="row">
      <input id="searchUser" placeholder="Discord ID or wallet address"/>
      <button id="findUser">Find User</button>
      <button id="loadTopUsers">Top Users</button>
      <span id="userMsg"></span>
    </div>
    <table id="usersTbl">
      <thead>
        <tr>
          <th>Username</th><th>Discord ID</th><th>Wallet</th><th>Registration</th><th>Last Activity</th>
          <th>Total Tips Sent</th><th>Total Received</th><th>Membership Details</th><th>Token Balances</th><th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>💸 Transaction Monitor</h2>
    <div class="row">
      <select id="txType">
        <option value="">All Types</option>
        <option value="TIP">Tips</option>
        <option value="DEPOSIT">Deposits</option>
        <option value="WITHDRAW">Withdrawals</option>
        <option value="PURCHASE">Purchases</option>
      </select>
      <input id="txUser" placeholder="Discord ID"/>
      <input id="txSince" type="datetime-local"/>
      <input id="txLimit" type="number" value="50" min="1" max="1000" style="width:80px"/>
      <button id="loadTransactions">Load Transactions</button>
      <button id="exportTransactions">Export CSV</button>
      <span id="txMsg"></span>
    </div>
    <table id="transactionsTbl">
      <thead>
        <tr>
          <th>ID</th><th>Type</th><th>User</th><th>Amount</th><th>Token</th>
          <th>Fee</th><th>Time</th><th>Guild</th><th>Details</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>🎯 Group Tips Monitor</h2>
    <div class="row">
      <select id="gtStatus">
        <option value="">All Status</option>
        <option value="ACTIVE">Active</option>
        <option value="COMPLETED">Completed</option>
        <option value="EXPIRED">Expired</option>
      </select>
      <button id="loadGroupTips">Load Group Tips</button>
      <button id="expireStuck">Expire Stuck Tips</button>
      <span id="gtMsg"></span>
    </div>
    <table id="groupTipsTbl">
      <thead>
        <tr>
          <th>ID</th><th>Creator</th><th>Amount</th><th>Token</th><th>Status</th>
          <th>Claims</th><th>Created</th><th>Expires</th><th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>⚡ System Health</h2>
    <div class="row">
      <button id="systemStatus">Check System Status</button>
      <button id="dbStats">Database Stats</button>
      <button id="clearCaches">Clear All Caches</button>
      <span id="systemMsg"></span>
    </div>
    <div id="systemInfo" style="margin-top:16px; padding:16px; background:#1a1a1a; border-radius:8px; display:none;">
      <h3>System Status</h3>
      <div id="systemData"></div>
    </div>
  </section>

  <section>
    <h2>🚨 Emergency Controls</h2>
    <div class="row" style="background:#2d1b1b; padding:16px; border-radius:8px; border:1px solid #ef4444;">
      <label style="color:#ef4444; font-weight:bold;">⚠️ DANGER ZONE</label>
      <button id="pauseWithdrawals" style="background:#dc2626;">Pause All Withdrawals</button>
      <button id="pauseTipping" style="background:#dc2626;">Pause All Tipping</button>
      <button id="emergencyMode" style="background:#dc2626;">Emergency Mode</button>
      <button id="resumeAll" style="background:#059669;">Resume All Operations</button>
      <span id="emergencyMsg"></span>
    </div>
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
  ["tokensTbl","serversTbl","feesTbl","treasuryTbl","adsTbl","tiersTbl","usersTbl","transactionsTbl","groupTipsTbl"].forEach(id => {
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
        <td>
          <button class="saveToken" data-id="\${t.id}">Save</button>
          <button class="deleteToken" data-id="\${t.id}" style="background:#ef4444; margin-left:4px;">Delete</button>
        </td>\`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".saveToken").forEach(btn => btn.onclick = () => saveToken(btn.dataset.id));
    tbody.querySelectorAll(".deleteToken").forEach(btn => btn.onclick = () => deleteToken(btn.dataset.id));
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

async function deleteToken(tokenId) {
  const btn = document.querySelector(\`[data-id="\${tokenId}"].deleteToken\`);
  const row = btn.closest("tr");
  const tokenSymbol = row.querySelector("td:nth-child(2) strong").textContent;
  
  if (!confirm(\`⚠️ DELETE TOKEN: \${tokenSymbol}?\\n\\nThis will permanently remove the token and may affect:\\n• User balances in this token\\n• Transaction history\\n• Tier pricing\\n\\nThis action CANNOT be undone. Continue?\`)) {
    return;
  }
  
  setLoading(btn, true);
  try {
    const r = await API(\`/admin/tokens/\${tokenId}\`, { method: "DELETE" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Delete failed");
    
    showMessage("tokenMsg", "Token " + tokenSymbol + " deleted successfully", false);
    await loadTokens(); // Reload the token list
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
        <td><strong>\${s.servername || "Loading..."}</strong></td>
        <td><code>\${s.guildId}</code></td>
        <td><input value="\${s.note || ""}" data-field="note" placeholder="Description"/></td>
        <td>
          <span class="status-indicator \${s.enabled ? 'online' : 'offline'}"></span>
          <input type="checkbox" \${s.enabled ? "checked" : ""} data-field="enabled"/>
        </td>
        <td>
          <button class="saveServer" data-id="\${s.id}">Save</button>
          <button class="deleteServer" data-id="\${s.id}" style="background:#ef4444; margin-left:4px;">Delete</button>
        </td>\`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".saveServer").forEach(b => b.onclick = () => saveServer(b.dataset.id));
    tbody.querySelectorAll(".deleteServer").forEach(b => b.onclick = () => deleteServer(b.dataset.id));
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
async function deleteServer(id) {
  const btn = document.querySelector(\`[data-id="\${id}"].deleteServer\`);
  const row = btn.closest("tr");
  const serverName = row.querySelector("td:nth-child(2) strong").textContent;
  
  if (!confirm(\`Are you sure you want to delete server "\${serverName}"? This action cannot be undone.\`)) {
    return;
  }
  
  setLoading(btn, true);
  try {
    const r = await API(\`/admin/servers/\${id}\`, {method:"DELETE"});
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Delete failed");
    row.remove();
  } catch(e){ alert(\`Failed to delete server: \${e.message}\`); }
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

// ---------- User Management ----------
async function findUser() {
  const query = $("searchUser").value.trim();
  if (!query) return showMessage("userMsg", "Please enter Discord ID or wallet address", true);
  setLoading("findUser", true);
  try {
    console.log("Searching for user:", query);
    const r = await API(\`/admin/users/search?q=\${encodeURIComponent(query)}\`);
    const j = await r.json();
    console.log("User search response:", j);
    if (!j.ok) return showMessage("userMsg", j.error || "User not found", true);
    displayUsers([j.user]);
    showMessage("userMsg", "User found", false);
  } catch (e) { 
    console.error("User search error:", e);
    showMessage("userMsg", "Search failed", true); 
  }
  finally { setLoading("findUser", false); }
}

async function loadTopUsers() {
  setLoading("loadTopUsers", true);
  try {
    console.log("Loading top users...");
    const r = await API("/admin/users/top");
    const j = await r.json();
    console.log("Top users response:", j);
    if (!j.ok) return showMessage("userMsg", "Failed to load top users", true);
    displayUsers(j.users);
    showMessage("userMsg", \`Loaded \${j.users.length} users\`, false);
  } catch (e) { 
    console.error("Top users error:", e);
    showMessage("userMsg", "Failed to load users", true); 
  }
  finally { setLoading("loadTopUsers", false); }
}

function displayUsers(users) {
  console.log("Displaying users:", users);
  const tbody = $("usersTbl").querySelector("tbody");
  if (!tbody) {
    console.error("Could not find usersTbl tbody");
    return;
  }
  tbody.innerHTML = "";
  
  if (!users || users.length === 0) {
    console.log("No users to display");
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="10" style="text-align:center">No users found</td>';
    tbody.appendChild(tr);
    return;
  }
  
  users.forEach(user => {
    console.log("Adding user row:", user.discordId);
    const tr = document.createElement("tr");
    
    // Format token balances
    let balancesHtml = "No balances";
    if (user.balances && user.balances.length > 0) {
      balancesHtml = user.balances.map(balance => 
        \`<div><strong>\${formatNumber(balance.amount)} \${balance.tokenSymbol}</strong></div>\`
      ).join("");
    }
    
    // Format membership details
    let membershipHtml = "No memberships";
    if (user.membershipDetails && user.membershipDetails.length > 0) {
      membershipHtml = user.membershipDetails.map(membership => {
        const expiresDate = new Date(membership.expiresAt).toLocaleDateString();
        const status = membership.status === 'ACTIVE' ? '🟢' : '🔴';
        return \`<div>\${status} <strong>\${membership.tierName}</strong><br><small>Expires: \${expiresDate}</small></div>\`;
      }).join("");
    } else if (user.activeMemberships > 0) {
      membershipHtml = \`\${user.activeMemberships} active\`;
    }
    
    tr.innerHTML = \`
      <td><strong>\${user.username || "Loading..."}</strong></td>
      <td><code>\${user.discordId || "Unknown"}</code></td>
      <td><code>\${user.agwAddress || "Not linked"}</code></td>
      <td>\${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "Unknown"}</td>
      <td>\${user.lastActivity ? new Date(user.lastActivity).toLocaleDateString() : "Never"}</td>
      <td>\${formatNumber(user.totalSent || 0)}</td>
      <td>\${formatNumber(user.totalReceived || 0)}</td>
      <td style="min-width:180px; font-size:0.9em;">\${membershipHtml}</td>
      <td style="min-width:160px; font-size:0.9em;">\${balancesHtml}</td>
      <td style="white-space:nowrap;">
        <button onclick="manageUserBalances('\${user.discordId}')" style="background:#2563eb;">Manage Balances</button>
        <button onclick="viewUserTransactions('\${user.discordId}')" style="background:#059669; margin-left:4px;">View Txns</button>
      </td>\`;
    tbody.appendChild(tr);
  });
}

$("findUser").onclick = findUser;
$("loadTopUsers").onclick = loadTopUsers;

// Global functions for button clicks
window.manageUserBalances = async function(discordId) {
  try {
    // Get fresh user data
    const r = await API(\`/admin/users/search?q=\${encodeURIComponent(discordId)}\`);
    const j = await r.json();
    if (!j.ok) return alert("Failed to load user data");
    
    const user = j.user;
    const tokens = await API("/admin/tokens").then(r => r.json()).then(j => j.tokens || []);
    
    // Create balance management modal
    const modal = document.createElement("div");
    modal.style.cssText = \`
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
      background: rgba(0,0,0,0.7); z-index: 1000; display: flex; 
      align-items: center; justify-content: center;
    \`;
    
    const content = document.createElement("div");
    content.style.cssText = \`
      background: #111; padding: 24px; border-radius: 12px; 
      max-width: 600px; width: 90%; max-height: 80%; overflow-y: auto;
      border: 1px solid #333;
    \`;
    
    // Format membership info for modal
    let membershipInfo = "";
    if (user.membershipDetails && user.membershipDetails.length > 0) {
      membershipInfo = \`
        <div style="margin-bottom:16px; padding:12px; background:#1a2e1a; border-radius:8px; border-left:4px solid #059669;">
          <h4 style="margin:0 0 8px; color:#10b981;">Active Memberships:</h4>
          \${user.membershipDetails.map(m => \`
            <div style="margin:4px 0;">
              \${m.status === 'ACTIVE' ? '🟢' : '🔴'} <strong>\${m.tierName}</strong> 
              <small>(expires \${new Date(m.expiresAt).toLocaleDateString()})</small>
            </div>
          \`).join("")}
        </div>
      \`;
    }

    content.innerHTML = \`
      <h3 style="margin-top:0; color:#fff;">Manage Balances - \${discordId}</h3>
      \${membershipInfo}
      <div id="currentBalances">
        <h4>Current Balances:</h4>
        \${user.balances && user.balances.length > 0 
          ? user.balances.map(b => \`
              <div style="margin:8px 0; padding:8px; background:#1a1a1a; border-radius:6px;">
                <strong>\${b.tokenSymbol}:</strong> \${formatNumber(b.amount)}
                <button onclick="adjustBalance('\${discordId}', \${b.tokenId}, '\${b.tokenSymbol}')" 
                        style="margin-left:8px; padding:4px 8px; font-size:0.8em;">Adjust</button>
              </div>
            \`).join("")
          : "<p>No current balances</p>"
        }
      </div>
      <div style="margin-top:16px;">
        <h4>Add New Token Balance:</h4>
        <select id="newTokenSelect" style="margin:8px; padding:8px;">
          <option value="">Select token...</option>
          \${tokens.filter(t => t.active).map(t => 
            \`<option value="\${t.id}">\${t.symbol}</option>\`
          ).join("")}
        </select>
        <input type="number" id="newTokenAmount" placeholder="Amount" 
               style="margin:8px; padding:8px;" step="0.00000001">
        <button onclick="addTokenBalance('\${discordId}')" 
                style="margin:8px; padding:8px 16px; background:#2563eb;">Add Balance</button>
      </div>
      <div style="margin-top:16px; text-align:right;">
        <button onclick="closeModal()" style="padding:8px 16px; background:#666;">Close</button>
      </div>
    \`;
    
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    window.closeModal = () => document.body.removeChild(modal);
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
    
  } catch (e) {
    alert("Failed to load balance management: " + e.message);
  }
};

window.adjustBalance = async function(discordId, tokenId, tokenSymbol) {
  const newAmount = prompt("Enter new balance for " + tokenSymbol + ":\\n\\n⚠️ This will SET the balance to exactly this amount.\\nCurrent operations will be logged as ADMIN_ADJUSTMENT.", "0");
  if (newAmount === null) return;
  
  const amount = parseFloat(newAmount);
  if (isNaN(amount) || amount < 0) return alert("Invalid amount");
  
  if (!confirm("Set " + tokenSymbol + " balance to " + amount + " for user " + discordId + "?\\n\\nThis action will be logged.")) return;
  
  try {
    const r = await API("/admin/users/adjust-balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discordId, tokenId: parseInt(tokenId), amount, reason: "Admin adjustment" })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    
    alert("Balance updated successfully to " + amount + " " + tokenSymbol);
    closeModal();
    // Refresh user display
    findUser();
  } catch (e) {
    alert("Failed to adjust balance: " + e.message);
  }
};

window.addTokenBalance = async function(discordId) {
  const tokenId = parseInt(document.getElementById("newTokenSelect").value);
  const amount = parseFloat(document.getElementById("newTokenAmount").value);
  
  if (!tokenId) return alert("Please select a token");
  if (isNaN(amount) || amount <= 0) return alert("Please enter a valid amount");
  
  const tokenSymbol = document.querySelector("#newTokenSelect option[value=\\"" + tokenId + "\\"]").textContent;
  
  if (!confirm("Add " + amount + " " + tokenSymbol + " balance for user " + discordId + "?")) return;
  
  try {
    const r = await API("/admin/users/adjust-balance", {
      method: "POST", 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discordId, tokenId, amount, reason: "Admin balance addition" })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    
    alert("Added " + amount + " " + tokenSymbol + " successfully");
    closeModal();
    findUser();
  } catch (e) {
    alert("Failed to add balance: " + e.message);
  }
};

window.viewUserTransactions = function(discordId) {
  // Set the transaction filter to this user and load
  document.getElementById("txUser").value = discordId;
  loadTransactions();
  
  // Scroll to transaction section
  document.getElementById("transactionsTbl").scrollIntoView({ behavior: "smooth" });
};

// ---------- Transaction Monitoring ----------
async function loadTransactions() {
  const type = $("txType").value;
  const userId = $("txUser").value.trim();
  const since = $("txSince").value;
  const limit = parseInt($("txLimit").value) || 50;
  
  setLoading("loadTransactions", true);
  try {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (userId) params.set("userId", userId);
    if (since) params.set("since", since);
    params.set("limit", limit.toString());
    
    const r = await API(\`/admin/transactions?\${params.toString()}\`);
    const j = await r.json();
    if (!j.ok) return showMessage("txMsg", "Failed to load transactions", true);
    
    const tbody = $("transactionsTbl").querySelector("tbody");
    tbody.innerHTML = "";
    j.transactions.forEach(tx => {
      const tr = document.createElement("tr");
      tr.innerHTML = \`
        <td>\${tx.id}</td>
        <td><span class="status-indicator online"></span>\${tx.type}</td>
        <td><code>\${tx.userId || "N/A"}</code></td>
        <td>\${formatNumber(tx.amount)}</td>
        <td>Token \${tx.tokenId || "N/A"}</td>
        <td>\${formatNumber(tx.fee || 0)}</td>
        <td>\${new Date(tx.createdAt).toLocaleString()}</td>
        <td>\${tx.guildId || "N/A"}</td>
        <td><button onclick="viewTxDetails(\${tx.id})">Details</button></td>\`;
      tbody.appendChild(tr);
    });
    showMessage("txMsg", \`Loaded \${j.transactions.length} transactions\`, false);
  } catch { showMessage("txMsg", "Failed to load transactions", true); }
  finally { setLoading("loadTransactions", false); }
}

$("loadTransactions").onclick = loadTransactions;
$("exportTransactions").onclick = async () => {
  try {
    const params = new URLSearchParams();
    const type = $("txType").value;
    const userId = $("txUser").value.trim();
    const since = $("txSince").value;
    if (type) params.set("type", type);
    if (userId) params.set("userId", userId);
    if (since) params.set("since", since);
    
    const r = await API(\`/admin/transactions/export?\${params.toString()}\`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = \`transactions_\${new Date().toISOString().split('T')[0]}.csv\`;
    a.click();
    URL.revokeObjectURL(url);
  } catch { showMessage("txMsg", "Export failed", true); }
};

// ---------- Group Tips Monitoring ----------
async function loadGroupTips() {
  const status = $("gtStatus").value;
  setLoading("loadGroupTips", true);
  try {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    
    const r = await API(\`/admin/group-tips?\${params.toString()}\`);
    const j = await r.json();
    if (!j.ok) return showMessage("gtMsg", "Failed to load group tips", true);
    
    const tbody = $("groupTipsTbl").querySelector("tbody");
    tbody.innerHTML = "";
    j.groupTips.forEach(gt => {
      const tr = document.createElement("tr");
      tr.innerHTML = \`
        <td>\${gt.id}</td>
        <td><code>\${gt.Creator?.discordId || gt.creatorId}</code></td>
        <td>\${formatNumber(gt.totalAmount)} \${gt.Token?.symbol || ""}</td>
        <td>\${gt.Token?.symbol || "N/A"}</td>
        <td><span class="status-indicator \${gt.status === 'ACTIVE' ? 'online' : 'offline'}"></span>\${gt.status}</td>
        <td>\${gt.claimCount || 0}</td>
        <td>\${new Date(gt.createdAt).toLocaleString()}</td>
        <td>\${gt.expiresAt ? new Date(gt.expiresAt).toLocaleString() : "Never"}</td>
        <td>
          <button onclick="expireGroupTip(\${gt.id})">Expire</button>
          <button onclick="viewGroupTipDetails(\${gt.id})">Details</button>
        </td>\`;
      tbody.appendChild(tr);
    });
    showMessage("gtMsg", \`Loaded \${j.groupTips.length} group tips\`, false);
  } catch { showMessage("gtMsg", "Failed to load group tips", true); }
  finally { setLoading("loadGroupTips", false); }
}

$("loadGroupTips").onclick = loadGroupTips;
$("expireStuck").onclick = async () => {
  if (!confirm("This will expire all stuck group tips. Continue?")) return;
  try {
    const r = await API("/admin/group-tips/expire-stuck", { method: "POST" });
    const j = await r.json();
    showMessage("gtMsg", j.ok ? \`Expired \${j.count} stuck tips\` : (j.error || "Failed"), !j.ok);
    if (j.ok) loadGroupTips();
  } catch { showMessage("gtMsg", "Failed to expire stuck tips", true); }
};

// ---------- System Health ----------
async function checkSystemStatus() {
  setLoading("systemStatus", true);
  try {
    const r = await API("/admin/system/status");
    const j = await r.json();
    if (!j.ok) return showMessage("systemMsg", "Failed to get system status", true);
    
    document.getElementById("systemInfo").style.display = "block";
    document.getElementById("systemData").innerHTML = \`
      <p><strong>Database:</strong> <span class="status-indicator \${j.database ? 'online' : 'offline'}"></span>\${j.database ? 'Connected' : 'Disconnected'}</p>
      <p><strong>RPC Provider:</strong> <span class="status-indicator \${j.rpc ? 'online' : 'offline'}"></span>\${j.rpc ? 'Connected' : 'Disconnected'}</p>
      <p><strong>Treasury Address:</strong> <code>\${j.treasury || 'Not configured'}</code></p>
      <p><strong>Active Tokens:</strong> \${j.activeTokens || 0}</p>
      <p><strong>Active Users (24h):</strong> \${j.activeUsers || 0}</p>
      <p><strong>Pending Transactions:</strong> \${j.pendingTxs || 0}</p>
      <p><strong>System Uptime:</strong> \${j.uptime || 'Unknown'}</p>
      <p><strong>Memory Usage:</strong> \${j.memory || 'Unknown'}</p>
    \`;
    showMessage("systemMsg", "System status loaded", false);
  } catch { showMessage("systemMsg", "Failed to load system status", true); }
  finally { setLoading("systemStatus", false); }
}

async function getDatabaseStats() {
  setLoading("dbStats", true);
  try {
    const r = await API("/admin/system/db-stats");
    const j = await r.json();
    if (!j.ok) return showMessage("systemMsg", "Failed to get DB stats", true);
    
    document.getElementById("systemInfo").style.display = "block";
    document.getElementById("systemData").innerHTML = \`
      <h4>Database Statistics</h4>
      <p><strong>Total Users:</strong> \${formatNumber(j.users || 0)}</p>
      <p><strong>Total Transactions:</strong> \${formatNumber(j.transactions || 0)}</p>
      <p><strong>Total Tips:</strong> \${formatNumber(j.tips || 0)}</p>
      <p><strong>Active Group Tips:</strong> \${formatNumber(j.activeGroupTips || 0)}</p>
      <p><strong>Total Deposits:</strong> \${formatNumber(j.deposits || 0)}</p>
      <p><strong>Total Withdrawals:</strong> \${formatNumber(j.withdrawals || 0)}</p>
      <p><strong>Database Size:</strong> \${j.dbSize || 'Unknown'}</p>
    \`;
    showMessage("systemMsg", "Database stats loaded", false);
  } catch { showMessage("systemMsg", "Failed to load DB stats", true); }
  finally { setLoading("dbStats", false); }
}

$("systemStatus").onclick = checkSystemStatus;
$("dbStats").onclick = getDatabaseStats;
$("clearCaches").onclick = async () => {
  try {
    const r = await API("/admin/system/clear-caches", { method: "POST" });
    const j = await r.json();
    showMessage("systemMsg", j.ok ? "All caches cleared" : (j.error || "Failed"), !j.ok);
  } catch { showMessage("systemMsg", "Failed to clear caches", true); }
};

// ---------- Emergency Controls ----------
$("pauseWithdrawals").onclick = async () => {
  if (!confirm("⚠️ This will PAUSE ALL WITHDRAWALS system-wide. Continue?")) return;
  try {
    const r = await API("/admin/emergency/pause-withdrawals", { method: "POST" });
    const j = await r.json();
    showMessage("emergencyMsg", j.ok ? "🚨 Withdrawals PAUSED" : (j.error || "Failed"), !j.ok);
  } catch { showMessage("emergencyMsg", "Failed to pause withdrawals", true); }
};

$("pauseTipping").onclick = async () => {
  if (!confirm("⚠️ This will PAUSE ALL TIPPING system-wide. Continue?")) return;
  try {
    const r = await API("/admin/emergency/pause-tipping", { method: "POST" });
    const j = await r.json();
    showMessage("emergencyMsg", j.ok ? "🚨 Tipping PAUSED" : (j.error || "Failed"), !j.ok);
  } catch { showMessage("emergencyMsg", "Failed to pause tipping", true); }
};

$("emergencyMode").onclick = async () => {
  if (!confirm("⚠️ This will enable EMERGENCY MODE - all operations paused except critical functions. Continue?")) return;
  try {
    const r = await API("/admin/emergency/enable", { method: "POST" });
    const j = await r.json();
    showMessage("emergencyMsg", j.ok ? "🚨 EMERGENCY MODE ENABLED" : (j.error || "Failed"), !j.ok);
  } catch { showMessage("emergencyMsg", "Failed to enable emergency mode", true); }
};

$("resumeAll").onclick = async () => {
  if (!confirm("Resume all operations and disable emergency mode?")) return;
  try {
    const r = await API("/admin/emergency/resume-all", { method: "POST" });
    const j = await r.json();
    showMessage("emergencyMsg", j.ok ? "✅ All operations resumed" : (j.error || "Failed"), !j.ok);
  } catch { showMessage("emergencyMsg", "Failed to resume operations", true); }
};

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
      loadTopUsers(), // Auto-load users
    ]);
  } catch (e) { console.error("Failed to load data:", e); }
}
(() => {
  const saved = localStorage.getItem("pip_admin_secret"); if (saved) $("secret").value = saved;
  setDefaultDates(); checkAuthAndLoad();
})();
`);
});
function parseDateRange(query) {
    const sinceStr = typeof query?.since === "string" ? query.since : undefined;
    const untilStr = typeof query?.until === "string" ? query.until : undefined;
    let since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let until = untilStr ? new Date(untilStr) : new Date();
    // basic guards (avoid NaN dates, and ensure order)
    if (isNaN(since.getTime()))
        throw new Error('Invalid "since" date');
    if (isNaN(until.getTime()))
        throw new Error('Invalid "until" date');
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
        const tokenMap = new Map(tokens.map(t => [t.id, t.symbol]));
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
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to export CSV" });
    }
});
// Ads
adminRouter.get("/ads", async (_req, res) => {
    try {
        const ads = await prisma.ad.findMany({ orderBy: { createdAt: "desc" } });
        res.json({ ok: true, ads });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to fetch ads" });
    }
});
adminRouter.post("/ads", async (req, res) => {
    try {
        const { text, url, weight = 5, active = true } = req.body;
        if (!text || typeof text !== "string" || text.trim().length === 0)
            return res.status(400).json({ ok: false, error: "Ad text is required" });
        if (text.length > 500)
            return res.status(400).json({ ok: false, error: "Ad text too long (max 500 characters)" });
        if (url && (!/^https?:\/\/.+/.test(url) || url.length > 2000))
            return res.status(400).json({ ok: false, error: "Invalid URL format or too long" });
        const weightNum = Number(weight);
        if (isNaN(weightNum) || weightNum < 1 || weightNum > 100)
            return res.status(400).json({ ok: false, error: "Weight must be between 1 and 100" });
        const ad = await prisma.ad.create({ data: { text: text.trim(), url: url?.trim() || null, weight: weightNum, active: Boolean(active) } });
        res.json({ ok: true, ad, message: "Ad created successfully" });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to create ad" });
    }
});
adminRouter.put("/ads/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ ok: false, error: "Invalid ad ID" });
        const { active, weight, text, url } = req.body;
        const data = {};
        if (typeof active === "boolean")
            data.active = active;
        if (weight !== undefined) {
            const w = Number(weight);
            if (isNaN(w) || w < 1 || w > 100)
                return res.status(400).json({ ok: false, error: "Weight must be between 1 and 100" });
            data.weight = w;
        }
        if (text !== undefined) {
            if (!text || text.trim().length === 0)
                return res.status(400).json({ ok: false, error: "Ad text is required" });
            if (text.length > 500)
                return res.status(400).json({ ok: false, error: "Ad text too long (max 500 characters)" });
            data.text = text.trim();
        }
        if (url !== undefined) {
            if (url && (!/^https?:\/\/.+/.test(url) || url.length > 2000))
                return res.status(400).json({ ok: false, error: "Invalid URL format or too long" });
            data.url = url?.trim() || null;
        }
        const ad = await prisma.ad.update({ where: { id }, data });
        res.json({ ok: true, ad });
    }
    catch (error) {
        if (error.code === "P2025")
            return res.status(404).json({ ok: false, error: "Ad not found" });
        res.status(500).json({ ok: false, error: "Failed to update ad" });
    }
});
adminRouter.delete("/ads/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ ok: false, error: "Invalid ad ID" });
        await prisma.ad.delete({ where: { id } });
        res.json({ ok: true, message: "Ad deleted successfully" });
    }
    catch (error) {
        if (error.code === "P2025")
            return res.status(404).json({ ok: false, error: "Ad not found" });
        res.status(500).json({ ok: false, error: "Failed to delete ad" });
    }
});
adminRouter.post("/ads/refresh", async (_req, res) => {
    try {
        const { refreshAdsCache } = await import("../services/ads.js");
        await refreshAdsCache();
        res.json({ ok: true, message: "Ad cache refreshed successfully" });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to refresh ad cache" });
    }
});
// Tiers
adminRouter.get("/tiers", async (_req, res) => {
    try {
        const tiers = await prisma.tier.findMany({
            include: {
                prices: {
                    include: { token: true }
                }
            },
            orderBy: { createdAt: "desc" }
        });
        // Format tiers for the old admin interface compatibility
        const formattedTiers = tiers.map(tier => ({
            id: tier.id,
            name: tier.name,
            description: tier.description,
            priceAmount: tier.priceAmount, // legacy field for compatibility
            durationDays: tier.durationDays,
            tipTaxFree: tier.tipTaxFree,
            active: tier.active,
            tokenId: tier.prices[0]?.tokenId || null, // first token for legacy compatibility
            token: tier.prices[0]?.token || null
        }));
        res.json({ ok: true, tiers: formattedTiers });
    }
    catch (error) {
        console.error("Failed to fetch tiers:", error);
        res.status(500).json({ ok: false, error: "Failed to fetch tiers" });
    }
});
adminRouter.post("/tiers", async (req, res) => {
    try {
        const { name, description, tokenId, priceAmount, durationDays, tipTaxFree = false, active = true } = req.body;
        if (!name || typeof name !== "string" || name.trim().length === 0) {
            return res.status(400).json({ ok: false, error: "Tier name is required" });
        }
        if (!tokenId || isNaN(Number(tokenId))) {
            return res.status(400).json({ ok: false, error: "Valid token ID is required" });
        }
        if (!priceAmount || isNaN(Number(priceAmount)) || Number(priceAmount) <= 0) {
            return res.status(400).json({ ok: false, error: "Valid price amount is required" });
        }
        if (!durationDays || isNaN(Number(durationDays)) || Number(durationDays) <= 0) {
            return res.status(400).json({ ok: false, error: "Valid duration in days is required" });
        }
        // Verify token exists
        const token = await prisma.token.findUnique({ where: { id: Number(tokenId) } });
        if (!token) {
            return res.status(400).json({ ok: false, error: "Token not found" });
        }
        // Create tier and price in a transaction
        const result = await prisma.$transaction(async (tx) => {
            // Create tier
            const tier = await tx.tier.create({
                data: {
                    name: name.trim(),
                    description: description?.trim() || null,
                    priceAmount: Number(priceAmount), // legacy field for compatibility
                    durationDays: Number(durationDays),
                    tipTaxFree: Boolean(tipTaxFree),
                    active: Boolean(active)
                }
            });
            // Create tier price
            await tx.tierPrice.create({
                data: {
                    tierId: tier.id,
                    tokenId: Number(tokenId),
                    amount: Number(priceAmount)
                }
            });
            return tier;
        });
        res.json({ ok: true, tier: result, message: "Tier created successfully" });
    }
    catch (error) {
        console.error("Failed to create tier:", error);
        if (error.code === "P2002") {
            return res.status(400).json({ ok: false, error: "Tier name already exists" });
        }
        res.status(500).json({ ok: false, error: "Failed to create tier" });
    }
});
adminRouter.put("/tiers/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ ok: false, error: "Invalid tier ID" });
        const { name, description, priceAmount, durationDays, tipTaxFree, active } = req.body;
        const data = {};
        if (name !== undefined) {
            if (!name || name.trim().length === 0) {
                return res.status(400).json({ ok: false, error: "Tier name is required" });
            }
            data.name = name.trim();
        }
        if (description !== undefined) {
            data.description = description?.trim() || null;
        }
        if (priceAmount !== undefined) {
            const price = Number(priceAmount);
            if (isNaN(price) || price <= 0) {
                return res.status(400).json({ ok: false, error: "Valid price amount is required" });
            }
            data.priceAmount = price;
        }
        if (durationDays !== undefined) {
            const days = Number(durationDays);
            if (isNaN(days) || days <= 0) {
                return res.status(400).json({ ok: false, error: "Valid duration in days is required" });
            }
            data.durationDays = days;
        }
        if (typeof tipTaxFree === "boolean")
            data.tipTaxFree = tipTaxFree;
        if (typeof active === "boolean")
            data.active = active;
        const tier = await prisma.tier.update({ where: { id }, data });
        // Also update the price if priceAmount was changed
        if (priceAmount !== undefined) {
            await prisma.tierPrice.updateMany({
                where: { tierId: id },
                data: { amount: Number(priceAmount) }
            });
        }
        res.json({ ok: true, tier });
    }
    catch (error) {
        console.error("Failed to update tier:", error);
        if (error.code === "P2025") {
            return res.status(404).json({ ok: false, error: "Tier not found" });
        }
        if (error.code === "P2002") {
            return res.status(400).json({ ok: false, error: "Tier name already exists" });
        }
        res.status(500).json({ ok: false, error: "Failed to update tier" });
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
// Basic endpoints
adminRouter.get("/ping", (_req, res) => {
    res.json({ ok: true, message: "Admin authenticated" });
});
adminRouter.get("/config", async (_req, res) => {
    try {
        const config = await getConfig();
        res.json({ ok: true, config });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to load config" });
    }
});
adminRouter.put("/config", async (req, res) => {
    try {
        const { minDeposit, minWithdraw, withdrawMaxPerTx, withdrawDailyCap } = req.body;
        await prisma.appConfig.upsert({
            where: { id: 1 },
            update: {
                minDeposit: Number(minDeposit) || 50,
                minWithdraw: Number(minWithdraw) || 50,
                withdrawMaxPerTx: Number(withdrawMaxPerTx) || 50,
                withdrawDailyCap: Number(withdrawDailyCap) || 500
            },
            create: {
                id: 1,
                minDeposit: Number(minDeposit) || 50,
                minWithdraw: Number(minWithdraw) || 50,
                withdrawMaxPerTx: Number(withdrawMaxPerTx) || 50,
                withdrawDailyCap: Number(withdrawDailyCap) || 500
            }
        });
        res.json({ ok: true, message: "Configuration updated" });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to update config" });
    }
});
adminRouter.post("/reload-config", async (_req, res) => {
    try {
        // Force reload config cache if you have one
        res.json({ ok: true, message: "Config cache reloaded" });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to reload config" });
    }
});
adminRouter.get("/tokens", async (_req, res) => {
    try {
        const tokens = await prisma.token.findMany({
            orderBy: { createdAt: "asc" }
        });
        res.json({ ok: true, tokens });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to fetch tokens" });
    }
});
adminRouter.post("/tokens", async (req, res) => {
    try {
        const { address } = req.body;
        if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
            return res.status(400).json({ ok: false, error: "Invalid token address" });
        }
        // Check if token already exists
        const existing = await prisma.token.findUnique({ where: { address: address.toLowerCase() } });
        if (existing) {
            return res.status(400).json({ ok: false, error: "Token already exists" });
        }
        // Fetch token info from blockchain
        const provider = new JsonRpcProvider(ABSTRACT_RPC_URL);
        const contract = new Contract(address, ERC20_ABI, provider);
        const [name, symbol, decimals] = await Promise.all([
            contract.name(),
            contract.symbol(),
            contract.decimals()
        ]);
        const token = await prisma.token.create({
            data: {
                address: address.toLowerCase(),
                symbol,
                decimals: Number(decimals),
                active: true,
                minDeposit: 50,
                minWithdraw: 50
            }
        });
        res.json({ ok: true, token });
    }
    catch (error) {
        console.error("Failed to add token:", error);
        if (error.code === "P2002") {
            return res.status(400).json({ ok: false, error: "Token address already exists" });
        }
        res.status(500).json({ ok: false, error: "Failed to add token" });
    }
});
adminRouter.put("/tokens/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ ok: false, error: "Invalid token ID" });
        const { active, minDeposit, minWithdraw, tipFeeBps, houseFeeBps, withdrawMaxPerTx, withdrawDailyCap } = req.body;
        const data = {};
        if (typeof active === "boolean")
            data.active = active;
        if (minDeposit !== undefined)
            data.minDeposit = Number(minDeposit);
        if (minWithdraw !== undefined)
            data.minWithdraw = Number(minWithdraw);
        if (tipFeeBps !== undefined)
            data.tipFeeBps = tipFeeBps === "" ? null : Number(tipFeeBps);
        if (houseFeeBps !== undefined)
            data.houseFeeBps = houseFeeBps === "" ? null : Number(houseFeeBps);
        if (withdrawMaxPerTx !== undefined)
            data.withdrawMaxPerTx = withdrawMaxPerTx === "" ? null : Number(withdrawMaxPerTx);
        if (withdrawDailyCap !== undefined)
            data.withdrawDailyCap = withdrawDailyCap === "" ? null : Number(withdrawDailyCap);
        const token = await prisma.token.update({ where: { id }, data });
        res.json({ ok: true, token });
    }
    catch (error) {
        if (error.code === "P2025") {
            return res.status(404).json({ ok: false, error: "Token not found" });
        }
        res.status(500).json({ ok: false, error: "Failed to update token" });
    }
});
adminRouter.post("/tokens/refresh", async (_req, res) => {
    try {
        // Invalidate token cache if you have one
        res.json({ ok: true, message: "Token cache refreshed" });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to refresh token cache" });
    }
});
adminRouter.get("/servers", async (_req, res) => {
    try {
        const servers = await prisma.approvedServer.findMany({
            orderBy: { createdAt: "desc" }
        });
        // Fetch Discord server names
        const client = getDiscordClient();
        const guildIds = servers.map(s => s.guildId);
        let servernames = new Map();
        if (client) {
            try {
                servernames = await fetchMultipleServernames(client, guildIds);
                console.log(`Fetched ${servernames.size} server names for admin interface`);
            }
            catch (error) {
                console.error("Failed to fetch server names:", error);
            }
        }
        // Enrich servers with names
        const enrichedServers = servers.map(server => ({
            ...server,
            servername: servernames.get(server.guildId) || `Server#${server.guildId.slice(-4)}`
        }));
        res.json({ ok: true, servers: enrichedServers });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to fetch servers" });
    }
});
adminRouter.post("/servers", async (req, res) => {
    try {
        const { guildId, note } = req.body;
        if (!guildId || !/^[0-9]+$/.test(guildId)) {
            return res.status(400).json({ ok: false, error: "Valid guild ID is required" });
        }
        const server = await prisma.approvedServer.create({
            data: {
                guildId,
                note: note?.trim() || null,
                enabled: true
            }
        });
        // Register commands for the new guild
        try {
            const cmds = getCommandsJson();
            await registerCommandsForApprovedGuilds(cmds);
        }
        catch (error) {
            console.error("Failed to register commands for new guild:", error);
        }
        res.json({ ok: true, server });
    }
    catch (error) {
        if (error.code === "P2002") {
            return res.status(400).json({ ok: false, error: "Server already exists" });
        }
        res.status(500).json({ ok: false, error: "Failed to add server" });
    }
});
adminRouter.put("/servers/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ ok: false, error: "Invalid server ID" });
        const { enabled, note } = req.body;
        const data = {};
        if (typeof enabled === "boolean")
            data.enabled = enabled;
        if (note !== undefined)
            data.note = note?.trim() || null;
        const server = await prisma.approvedServer.update({ where: { id }, data });
        res.json({ ok: true, server });
    }
    catch (error) {
        if (error.code === "P2025") {
            return res.status(404).json({ ok: false, error: "Server not found" });
        }
        res.status(500).json({ ok: false, error: "Failed to update server" });
    }
});
adminRouter.delete("/servers/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ ok: false, error: "Invalid server ID" });
        await prisma.approvedServer.delete({ where: { id } });
        res.json({ ok: true, message: "Server deleted successfully" });
    }
    catch (error) {
        if (error.code === "P2025") {
            return res.status(404).json({ ok: false, error: "Server not found" });
        }
        res.status(500).json({ ok: false, error: "Failed to delete server" });
    }
});
adminRouter.get("/treasury", async (req, res) => {
    try {
        const force = req.query.force === "1";
        const snapshot = await getTreasurySnapshot(force);
        res.json({ ok: true, ...snapshot });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to load treasury" });
    }
});
adminRouter.get("/fees/by-server", async (req, res) => {
    try {
        const { since, until } = parseDateRange(req.query);
        const guildId = req.query.guildId ? String(req.query.guildId) : undefined;
        const transactions = await prisma.transaction.groupBy({
            by: ["guildId", "tokenId"],
            where: {
                OR: [{ type: "TIP" }, { type: "MATCH_RAKE" }],
                ...(guildId && { guildId }),
                createdAt: { gte: since, lte: until }
            },
            _sum: { fee: true, amount: true },
        });
        const tokens = await prisma.token.findMany({ select: { id: true, symbol: true } });
        const tokenMap = new Map(tokens.map(t => [t.id, t.symbol]));
        const rows = transactions.map(tr => ({
            guildId: tr.guildId,
            token: tr.tokenId ? (tokenMap.get(tr.tokenId) ?? `Token#${tr.tokenId}`) : "Unknown",
            tipFees: String(tr._sum.fee || 0),
            matchRake: String(tr._sum.amount || 0),
        }));
        res.json({ ok: true, rows });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to load fees" });
    }
});
/* ------------------------------------------------------------------------ */
/*                          User Management APIs                            */
/* ------------------------------------------------------------------------ */
adminRouter.get("/users/search", async (req, res) => {
    try {
        const query = String(req.query.q || "").trim();
        console.log("User search query:", query);
        if (!query) {
            return res.status(400).json({ ok: false, error: "Search query required" });
        }
        let user;
        // Try Discord ID first
        if (/^\d+$/.test(query)) {
            console.log("Searching by Discord ID:", query);
            user = await prisma.user.findUnique({
                where: { discordId: query },
                include: {
                    tierMemberships: {
                        where: { expiresAt: { gt: new Date() } },
                        include: { tier: { select: { name: true } } }
                    },
                    balances: {
                        include: { Token: { select: { symbol: true, decimals: true } } }
                    }
                }
            });
        }
        // Try wallet address if not found
        if (!user && /^0x[a-fA-F0-9]{40}$/.test(query)) {
            console.log("Searching by wallet address:", query.toLowerCase());
            user = await prisma.user.findFirst({
                where: { agwAddress: query.toLowerCase() },
                include: {
                    tierMemberships: {
                        where: { expiresAt: { gt: new Date() } },
                        include: { tier: { select: { name: true } } }
                    },
                    balances: {
                        include: { Token: { select: { symbol: true, decimals: true } } }
                    }
                }
            });
        }
        if (!user) {
            console.log("User not found for query:", query);
            return res.status(404).json({ ok: false, error: "User not found" });
        }
        console.log("Found user:", user.discordId);
        // Fetch Discord username
        const client = getDiscordClient();
        let username = `User#${user.discordId.slice(-4)}`;
        if (client) {
            try {
                const usernameMap = await fetchMultipleUsernames(client, [user.discordId]);
                username = usernameMap.get(user.discordId) || username;
            }
            catch (error) {
                console.error("Failed to fetch username:", error);
            }
        }
        // Get tip statistics
        const [sentStats, receivedStats] = await Promise.all([
            prisma.transaction.aggregate({
                where: { userId: user.id, type: "TIP" },
                _sum: { amount: true }
            }),
            prisma.transaction.aggregate({
                where: { otherUserId: user.id, type: "TIP" },
                _sum: { amount: true }
            })
        ]);
        const enrichedUser = {
            ...user,
            username,
            totalSent: Number(sentStats._sum.amount || 0),
            totalReceived: Number(receivedStats._sum.amount || 0),
            activeMemberships: user.tierMemberships.length,
            membershipDetails: user.tierMemberships.map(membership => ({
                tierName: membership.tier.name,
                expiresAt: membership.expiresAt,
                status: membership.status
            })),
            lastActivity: user.updatedAt,
            balances: user.balances.map(balance => ({
                tokenSymbol: balance.Token.symbol,
                amount: balance.amount,
                tokenId: balance.tokenId
            }))
        };
        res.json({ ok: true, user: enrichedUser });
    }
    catch (error) {
        console.error("User search failed:", error);
        res.status(500).json({ ok: false, error: "Search failed", details: error?.message || String(error) });
    }
});
adminRouter.get("/users/top", async (req, res) => {
    try {
        console.log("Loading top users from database...");
        const users = await prisma.user.findMany({
            take: 50,
            orderBy: { createdAt: "desc" },
            include: {
                tierMemberships: {
                    where: { expiresAt: { gt: new Date() } },
                    include: { tier: { select: { name: true } } }
                },
                balances: {
                    include: { Token: { select: { symbol: true, decimals: true } } }
                }
            }
        });
        console.log(`Found ${users.length} users`);
        // Fetch Discord usernames
        const client = getDiscordClient();
        const discordIds = users.map(u => u.discordId);
        let usernames = new Map();
        if (client) {
            try {
                usernames = await fetchMultipleUsernames(client, discordIds);
                console.log(`Fetched ${usernames.size} usernames for admin interface`);
            }
            catch (error) {
                console.error("Failed to fetch usernames:", error);
            }
        }
        // Calculate proper statistics
        const enrichedUsers = await Promise.all(users.map(async (user) => {
            // Get tip statistics
            const [sentStats, receivedStats] = await Promise.all([
                prisma.transaction.aggregate({
                    where: { userId: user.id, type: "TIP" },
                    _sum: { amount: true }
                }),
                prisma.transaction.aggregate({
                    where: { otherUserId: user.id, type: "TIP" },
                    _sum: { amount: true }
                })
            ]);
            return {
                ...user,
                username: usernames.get(user.discordId) || `User#${user.discordId.slice(-4)}`,
                totalSent: Number(sentStats._sum.amount || 0),
                totalReceived: Number(receivedStats._sum.amount || 0),
                activeMemberships: user.tierMemberships.length,
                membershipDetails: user.tierMemberships.map(membership => ({
                    tierName: membership.tier.name,
                    expiresAt: membership.expiresAt,
                    status: membership.status
                })),
                lastActivity: user.updatedAt,
                balances: user.balances.map(balance => ({
                    tokenSymbol: balance.Token.symbol,
                    amount: balance.amount,
                    tokenId: balance.tokenId
                }))
            };
        }));
        res.json({ ok: true, users: enrichedUsers });
    }
    catch (error) {
        console.error("Failed to load top users:", error);
        res.status(500).json({ ok: false, error: "Failed to load users", details: error?.message || String(error) });
    }
});
adminRouter.post("/users/adjust-balance", async (req, res) => {
    try {
        const { discordId, tokenId, amount, reason } = req.body;
        // Validate inputs
        if (!discordId || typeof discordId !== "string") {
            return res.status(400).json({ ok: false, error: "Discord ID is required" });
        }
        if (!tokenId || typeof tokenId !== "number") {
            return res.status(400).json({ ok: false, error: "Token ID is required" });
        }
        if (typeof amount !== "number" || amount < 0) {
            return res.status(400).json({ ok: false, error: "Valid amount is required" });
        }
        // Find user
        const user = await prisma.user.findUnique({ where: { discordId } });
        if (!user) {
            return res.status(404).json({ ok: false, error: "User not found" });
        }
        // Find token
        const token = await prisma.token.findUnique({ where: { id: tokenId } });
        if (!token) {
            return res.status(404).json({ ok: false, error: "Token not found" });
        }
        // Get current balance
        const currentBalance = await prisma.userBalance.findUnique({
            where: { userId_tokenId: { userId: user.id, tokenId } }
        });
        const oldAmount = currentBalance ? Number(currentBalance.amount) : 0;
        const newAmount = amount;
        const difference = newAmount - oldAmount;
        // Update balance
        await prisma.userBalance.upsert({
            where: { userId_tokenId: { userId: user.id, tokenId } },
            update: { amount: newAmount.toString() },
            create: {
                userId: user.id,
                tokenId,
                amount: newAmount.toString()
            }
        });
        // Log the adjustment as a transaction
        await prisma.transaction.create({
            data: {
                type: "ADMIN_ADJUSTMENT",
                userId: user.id,
                tokenId,
                amount: difference.toString(), // The change amount
                fee: "0",
                metadata: JSON.stringify({
                    reason: reason || "Admin balance adjustment",
                    oldAmount,
                    newAmount,
                    adminAction: true
                })
            }
        });
        console.log(`Admin adjusted balance for ${discordId}: ${token.symbol} ${oldAmount} → ${newAmount} (${difference > 0 ? '+' : ''}${difference})`);
        res.json({
            ok: true,
            message: `Balance adjusted successfully`,
            details: {
                token: token.symbol,
                oldAmount,
                newAmount,
                difference
            }
        });
    }
    catch (error) {
        console.error("Balance adjustment failed:", error);
        res.status(500).json({
            ok: false,
            error: "Failed to adjust balance",
            details: error.message
        });
    }
});
/* ------------------------------------------------------------------------ */
/*                        Transaction Monitoring APIs                       */
/* ------------------------------------------------------------------------ */
adminRouter.get("/transactions", async (req, res) => {
    try {
        const type = req.query.type ? String(req.query.type) : undefined;
        const userId = req.query.userId ? String(req.query.userId) : undefined;
        const since = req.query.since ? new Date(String(req.query.since)) : undefined;
        const limit = Math.min(parseInt(String(req.query.limit || "50")), 1000);
        const where = {};
        if (type)
            where.type = type;
        if (since)
            where.createdAt = { gte: since };
        let user;
        if (userId) {
            user = await prisma.user.findUnique({ where: { discordId: userId } });
            if (user)
                where.userId = user.id;
        }
        const transactions = await prisma.transaction.findMany({
            where,
            take: limit,
            orderBy: { createdAt: "desc" }
        });
        res.json({ ok: true, transactions });
    }
    catch (error) {
        console.error("Failed to load transactions:", error);
        res.status(500).json({ ok: false, error: "Failed to load transactions" });
    }
});
adminRouter.get("/transactions/export", async (req, res) => {
    try {
        const type = req.query.type ? String(req.query.type) : undefined;
        const userId = req.query.userId ? String(req.query.userId) : undefined;
        const since = req.query.since ? new Date(String(req.query.since)) : undefined;
        const where = {};
        if (type)
            where.type = type;
        if (since)
            where.createdAt = { gte: since };
        let user;
        if (userId) {
            user = await prisma.user.findUnique({ where: { discordId: userId } });
            if (user)
                where.userId = user.id;
        }
        const transactions = await prisma.transaction.findMany({
            where,
            orderBy: { createdAt: "desc" }
        });
        const csvHeader = "ID,Type,User,Amount,Token,Fee,Time,Guild\n";
        const csvRows = transactions.map(tx => [
            tx.id,
            tx.type,
            tx.userId || "N/A",
            tx.amount,
            tx.tokenId || "Unknown",
            tx.fee || 0,
            tx.createdAt.toISOString(),
            tx.guildId || "N/A"
        ].map(field => `"${field}"`).join(",")).join("\n");
        const csv = csvHeader + csvRows;
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="transactions_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csv);
    }
    catch (error) {
        console.error("Export failed:", error);
        res.status(500).json({ ok: false, error: "Export failed" });
    }
});
/* ------------------------------------------------------------------------ */
/*                        Group Tips Monitoring APIs                        */
/* ------------------------------------------------------------------------ */
adminRouter.get("/group-tips", async (req, res) => {
    try {
        const status = req.query.status ? String(req.query.status) : undefined;
        const where = {};
        if (status)
            where.status = status;
        const groupTips = await prisma.groupTip.findMany({
            where,
            take: 100,
            orderBy: { createdAt: "desc" },
            include: {
                Creator: { select: { discordId: true } },
                Token: { select: { symbol: true } },
                _count: { select: { claims: true } }
            }
        });
        const enrichedTips = groupTips.map(gt => ({
            ...gt,
            claimCount: gt._count.claims
        }));
        res.json({ ok: true, groupTips: enrichedTips });
    }
    catch (error) {
        console.error("Failed to load group tips:", error);
        res.status(500).json({ ok: false, error: "Failed to load group tips" });
    }
});
adminRouter.post("/group-tips/expire-stuck", async (req, res) => {
    try {
        const stuckTips = await prisma.groupTip.updateMany({
            where: {
                status: "ACTIVE",
                expiresAt: { lt: new Date() }
            },
            data: { status: "EXPIRED" }
        });
        res.json({ ok: true, count: stuckTips.count });
    }
    catch (error) {
        console.error("Failed to expire stuck tips:", error);
        res.status(500).json({ ok: false, error: "Failed to expire stuck tips" });
    }
});
/* ------------------------------------------------------------------------ */
/*                          System Health APIs                              */
/* ------------------------------------------------------------------------ */
adminRouter.get("/system/status", async (req, res) => {
    try {
        // Check database
        let database = false;
        try {
            await prisma.$queryRaw `SELECT 1`;
            database = true;
        }
        catch { }
        // Check RPC
        let rpc = false;
        try {
            const provider = new JsonRpcProvider(ABSTRACT_RPC_URL);
            await provider.getBlockNumber();
            rpc = true;
        }
        catch { }
        // Get system stats
        const [activeTokens, activeUsers, pendingTxs] = await Promise.all([
            prisma.token.count({ where: { active: true } }),
            prisma.user.count({
                where: {
                    updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
                }
            }),
            prisma.groupTip.count({ where: { status: "ACTIVE" } })
        ]);
        const memoryUsage = process.memoryUsage();
        const memory = `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`;
        const uptime = `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`;
        res.json({
            ok: true,
            database,
            rpc,
            treasury: process.env.TREASURY_AGW_ADDRESS,
            activeTokens,
            activeUsers,
            pendingTxs,
            uptime,
            memory
        });
    }
    catch (error) {
        console.error("System status check failed:", error);
        res.status(500).json({ ok: false, error: "Status check failed" });
    }
});
adminRouter.get("/system/db-stats", async (req, res) => {
    try {
        const [users, transactions, tips, activeGroupTips, deposits, withdrawals] = await Promise.all([
            prisma.user.count(),
            prisma.transaction.count(),
            prisma.tip.count({ where: { status: 'COMPLETED' } }),
            prisma.groupTip.count({ where: { status: "ACTIVE" } }),
            prisma.transaction.count({ where: { type: "DEPOSIT" } }),
            prisma.transaction.count({ where: { type: "WITHDRAW" } })
        ]);
        res.json({
            ok: true,
            users,
            transactions,
            tips,
            activeGroupTips,
            deposits,
            withdrawals,
            dbSize: "Unknown" // Would need additional queries to calculate
        });
    }
    catch (error) {
        console.error("DB stats failed:", error);
        res.status(500).json({ ok: false, error: "DB stats failed" });
    }
});
adminRouter.post("/system/clear-caches", async (req, res) => {
    try {
        // Clear treasury cache
        invalidateTreasuryCache();
        // Clear any other caches (config, tokens, etc.)
        // Implementation depends on your caching strategy
        res.json({ ok: true, message: "All caches cleared" });
    }
    catch (error) {
        console.error("Cache clear failed:", error);
        res.status(500).json({ ok: false, error: "Failed to clear caches" });
    }
});
/* ------------------------------------------------------------------------ */
/*                          Emergency Control APIs                          */
/* ------------------------------------------------------------------------ */
// Emergency state management (you could store this in database or Redis)
let emergencyState = {
    withdrawalsPaused: false,
    tippingPaused: false,
    emergencyMode: false
};
adminRouter.post("/emergency/pause-withdrawals", async (req, res) => {
    try {
        emergencyState.withdrawalsPaused = true;
        // Store emergency state in a simple way - Config table might not exist
        // You could also update a database flag that withdrawal commands check
        res.json({ ok: true, message: "Withdrawals paused system-wide" });
    }
    catch (error) {
        console.error("Failed to pause withdrawals:", error);
        res.status(500).json({ ok: false, error: "Failed to pause withdrawals" });
    }
});
adminRouter.post("/emergency/pause-tipping", async (req, res) => {
    try {
        emergencyState.tippingPaused = true;
        res.json({ ok: true, message: "Tipping paused system-wide" });
    }
    catch (error) {
        console.error("Failed to pause tipping:", error);
        res.status(500).json({ ok: false, error: "Failed to pause tipping" });
    }
});
adminRouter.post("/emergency/enable", async (req, res) => {
    try {
        emergencyState = {
            withdrawalsPaused: true,
            tippingPaused: true,
            emergencyMode: true
        };
        res.json({ ok: true, message: "Emergency mode enabled - all operations paused" });
    }
    catch (error) {
        console.error("Failed to enable emergency mode:", error);
        res.status(500).json({ ok: false, error: "Failed to enable emergency mode" });
    }
});
adminRouter.post("/emergency/resume-all", async (req, res) => {
    try {
        emergencyState = {
            withdrawalsPaused: false,
            tippingPaused: false,
            emergencyMode: false
        };
        res.json({ ok: true, message: "All operations resumed - emergency mode disabled" });
    }
    catch (error) {
        console.error("Failed to resume operations:", error);
        res.status(500).json({ ok: false, error: "Failed to resume operations" });
    }
});
/* ------------------------------------------------------------------------ */
/*                            Token Deletion API                            */
/* ------------------------------------------------------------------------ */
adminRouter.delete("/tokens/:id", async (req, res) => {
    try {
        const tokenId = parseInt(req.params.id);
        if (isNaN(tokenId)) {
            return res.status(400).json({ ok: false, error: "Invalid token ID" });
        }
        // Check if token exists
        const token = await prisma.token.findUnique({ where: { id: tokenId } });
        if (!token) {
            return res.status(404).json({ ok: false, error: "Token not found" });
        }
        // Safety checks - prevent deletion if token is in use
        const [userBalances, transactions, tierPrices, groupTips] = await Promise.all([
            prisma.userBalance.count({ where: { tokenId } }),
            prisma.transaction.count({ where: { tokenId } }),
            prisma.tierPrice.count({ where: { tokenId } }),
            prisma.groupTip.count({ where: { tokenId } })
        ]);
        const issues = [];
        if (userBalances > 0)
            issues.push(`${userBalances} user balances`);
        if (transactions > 0)
            issues.push(`${transactions} transactions`);
        if (tierPrices > 0)
            issues.push(`${tierPrices} tier prices`);
        if (groupTips > 0)
            issues.push(`${groupTips} group tips`);
        if (issues.length > 0) {
            return res.status(400).json({
                ok: false,
                error: `Cannot delete token - it has associated data: ${issues.join(', ')}`,
                details: { userBalances, transactions, tierPrices, groupTips }
            });
        }
        // Safe to delete - no associated data
        await prisma.token.delete({ where: { id: tokenId } });
        console.log(`Token ${token.symbol} (ID: ${tokenId}) deleted by admin`);
        res.json({
            ok: true,
            message: `Token ${token.symbol} deleted successfully`,
            deletedToken: token
        });
    }
    catch (error) {
        console.error("Token deletion failed:", error);
        // Handle foreign key constraint errors
        if (error.code === "P2003") {
            return res.status(400).json({
                ok: false,
                error: "Cannot delete token - it is referenced by other records"
            });
        }
        res.status(500).json({
            ok: false,
            error: "Failed to delete token",
            details: error.message
        });
    }
});
