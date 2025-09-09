// src/web/admin.ts
import "dotenv/config";
import { Router } from "express";
import { JsonRpcProvider, Contract } from "ethers";
import { getConfig } from "../config.js";
import { registerCommandsForApprovedGuilds } from "../services/command_registry.js";
import { getCommandsJson } from "../services/commands_def.js";
import { prisma } from "../services/db.js";
import { getActiveTokens } from "../services/token.js";
import { ABSTRACT_RPC_URL } from "../config.js";

export const adminRouter = Router();
// Read lazily so .env is loaded and hot-reloads work
const getAdminSecret = () => (process.env.ADMIN_SECRET ?? "").trim();

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

// ---------- Lightweight UI (public so HTML can load) ----------
adminRouter.get("/ui", (_req, res) => {
  res.type("html").send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>PIPtip Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
  body { margin: 24px; }
  h1 { margin: 0 0 12px; }
  section { border: 1px solid #333; border-radius: 12px; padding: 16px; margin: 16px 0; }
  label { display: inline-block; min-width: 220px; }
  input, select, button { padding: 6px 10px; margin: 6px 6px 6px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border-bottom: 1px solid #2a2a2a; padding: 6px 8px; text-align: left; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .ok { color: #6ee782; }
  .err { color: #ff7b7b; }
  code { background:#222; padding:2px 6px; border-radius:6px; }
</style>
</head>
<body>
  <h1>PIPtip Admin</h1>

  <section>
    <div class="row">
      <label>Admin Secret</label>
      <input id="secret" type="password" placeholder="Paste ADMIN_SECRET"/>
      <button id="saveSecret">Save</button>
      <span id="authStatus"></span>
    </div>
  </section>

  <section>
    <h2>Configuration</h2>
    <div id="cfgForm" class="row">
      <label>Min Deposit</label><input id="minDeposit" type="number" min="0" step="0.0000000001"/>
      <label>Min Withdraw</label><input id="minWithdraw" type="number" min="0" step="0.0000000001"/>
      <label>Max Withdraw / tx (0 = none)</label><input id="withdrawMaxPerTx" type="number" min="0" step="0.0000000001"/>
      <label>Daily Withdraw Cap (0 = none)</label><input id="withdrawDailyCap" type="number" min="0" step="0.0000000001"/>
      <button id="saveCfg">Save Config</button>
      <button id="reloadCfg">Reload Cache</button>
      <span id="cfgMsg"></span>
    </div>
  </section>


  <section>
    <h2>Tokens</h2>
    <div class="row">
      <button id="refreshTokens">Refresh Token Cache</button>
    </div>
<table id="tokensTbl"><thead>
<tr>
  <th>ID</th><th>Symbol</th><th>Address</th><th>Decimals</th>
  <th>Active</th><th>MinDep</th><th>MinWdr</th>
  <th>TipFee(bps)</th><th>House(bps)</th>
  <th>Max/Tx</th><th>DailyCap</th><th>Save</th>
</tr>
</thead><tbody></tbody></table>
  </section>

  <section>
    <h2>Servers</h2>
    <div class="row">
      <input id="newGuildId" placeholder="Guild ID"/>
      <input id="newGuildNote" placeholder="Note"/>
      <button id="addServer">Add/Enable</button>
    </div>
    <table id="serversTbl"><thead>
      <tr><th>ID</th><th>Guild</th><th>Note</th><th>Enabled</th><th>Save</th></tr>
    </thead><tbody></tbody></table>
  </section>

  <section>
  <h2>Treasury Balances</h2>
  <div class="row">
    <button id="reloadTreasury">Reload</button>
    <span id="treasuryMsg"></span>
  </div>
  <table id="treasuryTbl"><thead>
    <tr><th>Asset</th><th>Balance</th></tr>
  </thead><tbody></tbody></table>
</section>

  <section>
    <h2>House Earnings (Tip Fees + Match Rake)</h2>
    <div class="row">
      <label>Since (YYYY-MM-DD)</label><input id="feesSince" placeholder="2025-09-01"/>
      <label>Until (YYYY-MM-DD)</label><input id="feesUntil" placeholder="2025-09-08"/>
      <label>Guild (optional)</label><input id="feesGuild" placeholder="1234567890"/>
      <button id="loadFees">Load Summary</button>
      <button id="csvFees">Download CSV</button>
      <span id="feesMsg"></span>
    </div>
    <table id="feesTbl"><thead>
      <tr><th>Guild</th><th>Token</th><th>Tip Fees</th><th>Match Rake</th><th>Total</th></tr>
    </thead><tbody></tbody></table>
    <p><small>
      Tip fees are taken from <code>Transaction.fee</code> where <code>type="TIP"</code>.<br/>
      Match rake uses <code>Transaction.amount</code> where <code>type="MATCH_RAKE"</code>.
    </small></p>
  </section>

<script>
const $ = (id)=>document.getElementById(id);
const API = (path, opts={}) => {
  const secret = localStorage.getItem("pip_admin_secret") || "";
  const headers = Object.assign({ "Authorization": "Bearer " + secret }, opts.headers||{});
  return fetch(path, Object.assign({}, opts, { headers }));
};
function fmt(n){ return Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 }); }

// ---- AUTH GATE ----
async function checkAuthAndLoad() {
  try {
    const r = await API("/admin/ping");
    const j = await r.json().catch(()=>({ ok:false }));
    $("authStatus").textContent = j.ok ? "✓ Auth OK" : "× Not authorized";
    $("authStatus").className = j.ok ? "ok" : "err";
    if (j.ok) {
      // only load data once authorized
      await loadAll();
    } else {
      // clear tables if unauthorized
      (document.querySelector("#tokensTbl tbody")||{}).innerHTML = "";
      (document.querySelector("#serversTbl tbody")||{}).innerHTML = "";
      (document.querySelector("#feesTbl tbody")||{}).innerHTML = "";
    }
  } catch {
    $("authStatus").textContent = "× Not authorized";
    $("authStatus").className = "err";
  }
}
$("saveSecret").onclick = ()=>{ 
  localStorage.setItem("pip_admin_secret", $("secret").value.trim()); 
  checkAuthAndLoad();
};


// ---- CONFIG ----
async function loadCfg() {
  const r = await API("/admin/config");
  const j = await r.json().catch(() => ({ ok: false }));
  if (!j.ok) { $("cfgMsg").textContent = "Load failed"; $("cfgMsg").className = "err"; return; }
  const c = j.config || {};
  ["minDeposit","minWithdraw","withdrawMaxPerTx","withdrawDailyCap"].forEach(k => {
    if ($(k)) $(k).value = c[k] ?? "";
  });
}

$("saveCfg").onclick = async () => {
  const body = {
    minDeposit: Number($("minDeposit").value),
    minWithdraw: Number($("minWithdraw").value),
    withdrawMaxPerTx: Number($("withdrawMaxPerTx").value),
    withdrawDailyCap: Number($("withdrawDailyCap").value),
  };
  const r = await API("/admin/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  $("cfgMsg").textContent = j.ok ? "Saved" : (j.error || "Save failed");
  $("cfgMsg").className = j.ok ? "ok" : "err";
};


$("reloadCfg").onclick = () => API("/admin/reload-config", { method:"POST" })
  .then(() => { $("cfgMsg").textContent = "Cache reloaded"; $("cfgMsg").className = "ok"; });

  
// ---- TOKENS ----
async function loadTokens() {
  const r = await API("/admin/tokens");
  const j = await r.json().catch(()=>({ok:false}));
  const tb = $("tokensTbl").querySelector("tbody");
  tb.innerHTML = "";
  if (!j.ok) { console.warn("Failed to load tokens", j.error); return; }

  j.tokens.forEach((t) => {
    const tr = document.createElement("tr");
    tr.innerHTML = \`
  <td>\${t.id}</td>
  <td>\${t.symbol}</td>
  <td><code>\${t.address}</code></td>
  <td>\${t.decimals}</td>
  <td><input type="checkbox" \${t.active ? "checked" : ""} data-k="active"/></td>
  <td><input value="\${t.minDeposit}" data-k="minDeposit" size="8"/></td>
  <td><input value="\${t.minWithdraw}" data-k="minWithdraw" size="8"/></td>
  <td><input value="\${t.tipFeeBps ?? ""}" placeholder="default" data-k="tipFeeBps" size="6"/></td>
  <td><input value="\${t.houseFeeBps ?? ""}" placeholder="default" data-k="houseFeeBps" size="6"/></td>
  <td><input value="\${t.withdrawMaxPerTx ?? ""}" placeholder="default" data-k="withdrawMaxPerTx" size="8"/></td>
  <td><input value="\${t.withdrawDailyCap ?? ""}" placeholder="default" data-k="withdrawDailyCap" size="8"/></td>
  <td><button data-id="\${t.id}" class="saveToken">Save</button></td>
\`;

    tb.appendChild(tr);
  });

  tb.querySelectorAll(".saveToken").forEach((btn) => {
    btn.onclick = async () => {
const row = btn.closest("tr");
const v = (sel) => row.querySelector(sel).value.trim();

const body = {
  active: row.querySelector('input[data-k="active"]').checked,
  minDeposit: Number(v('input[data-k="minDeposit"]')),
  minWithdraw: Number(v('input[data-k="minWithdraw"]')),
  tipFeeBps: (() => { const x = v('input[data-k="tipFeeBps"]'); return x === "" ? null : Number(x); })(),
  houseFeeBps: (() => { const x = v('input[data-k="houseFeeBps"]'); return x === "" ? null : Number(x); })(),
  withdrawMaxPerTx: (() => { const x = v('input[data-k="withdrawMaxPerTx"]'); return x === "" ? null : Number(x); })(),
  withdrawDailyCap: (() => { const x = v('input[data-k="withdrawDailyCap"]'); return x === "" ? null : Number(x); })(),
};

const r = await API("/admin/tokens/" + btn.dataset.id, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
alert((await r.json()).ok ? "Saved" : "Save failed");
    };
  });
}
$("refreshTokens").onclick = ()=>API("/admin/tokens/refresh", { method:"POST" }).then(loadTokens);

// ---- SERVERS ----
async function loadServers() {
  const r = await API("/admin/servers"); 
  const j = await r.json().catch(()=>({ok:false}));
  const tb = $("serversTbl").querySelector("tbody"); 
  tb.innerHTML="";
  if(!j.ok) return;
  j.servers.forEach(s=>{
    const tr = document.createElement("tr");
    tr.innerHTML = \`
      <td>\${s.id}</td>
      <td><code>\${s.guildId}</code></td>
      <td><input value="\${s.note||""}" data-k="note" size="20"/></td>
      <td><input type="checkbox" \${s.enabled?"checked":""} data-k="enabled"/></td>
      <td><button data-id="\${s.id}" class="saveSrv">Save</button></td>
    \`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll(".saveSrv").forEach(btn=>{
    btn.onclick = async ()=>{
      const tr = btn.closest("tr");
      const enabled = tr.querySelector('input[data-k="enabled"]').checked;
      const note = tr.querySelector('input[data-k="note"]').value;
      const r = await API("/admin/servers/"+btn.dataset.id, { method:"PUT", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ enabled, note }) });
      alert((await r.json()).ok ? "Saved" : "Save failed");
    };
  });
}
$("addServer").onclick = async ()=>{
  const body = { guildId: $("newGuildId").value.trim(), note: $("newGuildNote").value.trim() };
  if(!body.guildId) return alert("Guild ID required");
  const r = await API("/admin/servers", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
  alert((await r.json()).ok ? "Added/Enabled" : "Failed");
  loadServers();
};

// ---- FEES ----
async function loadFees() {
  const qs = new URLSearchParams();
  const s=$("feesSince").value.trim(), u=$("feesUntil").value.trim(), g=$("feesGuild").value.trim();
  if(s) qs.set("since", s); if(u) qs.set("until", u); if(g) qs.set("guildId", g);
  const r = await API("/admin/fees/by-server?"+qs.toString()); 
  const j = await r.json().catch(()=>({ok:false, rows:[]}));
  const tb = $("feesTbl").querySelector("tbody"); tb.innerHTML="";
  if(!j.ok) { $("feesMsg").textContent="Load failed"; $("feesMsg").className="err"; return; }
  j.rows.forEach(x=>{
    const tr=document.createElement("tr");
    tr.innerHTML = \`<td>\${x.guildId || "-"}</td><td>\${x.token}</td><td>\${fmt(x.tipFees)}</td><td>\${fmt(x.matchRake)}</td><td>\${fmt((+x.tipFees)+(+x.matchRake))}</td>\`;
    tb.appendChild(tr);
  });
  $("feesMsg").textContent = "Loaded";
  $("feesMsg").className = "ok";
}
$("loadFees").onclick = loadFees;

$("csvFees").onclick = async ()=>{
  const qs = new URLSearchParams();
  const s=$("feesSince").value.trim(), u=$("feesUntil").value.trim(), g=$("feesGuild").value.trim();
  if(s) qs.set("since", s); if(u) qs.set("until", u); if(g) qs.set("guildId", g);
  const resp = await API("/admin/fees/export.csv?"+qs.toString());
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download="house_fees.csv"; a.click();
  URL.revokeObjectURL(url);
};

// ---- TREASURY ----
async function loadTreasury(force) {
  if (force === undefined) force = false;
  var r = await API('/admin/treasury' + (force ? '?force=1' : ''));
  var j;
  try { j = await r.json(); } catch (e) { j = { ok: false }; }

  var tb = document.querySelector('#treasuryTbl tbody');
  if (tb) tb.innerHTML = '';

  if (!j.ok) {
    $('treasuryMsg').textContent = 'Load failed';
    $('treasuryMsg').className = 'err';
    return;
  }

  var trEth = document.createElement('tr');
  trEth.innerHTML = '<td>ETH (gas)</td><td>' + j.ethHuman + '</td>';
  if (tb) tb.appendChild(trEth);

  (j.tokens || []).forEach(function (t) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + t.symbol + '</td><td>' + t.human + '</td>';
    if (tb) tb.appendChild(tr);
  });

  $('treasuryMsg').textContent = 'As of ' + new Date(j.ts).toLocaleTimeString();
  $('treasuryMsg').className = 'ok';
}

$('reloadTreasury').onclick = function () { loadTreasury(true); };


// ---- BOOT ----
async function loadAll(){ 
  await Promise.all([loadCfg(), loadTokens(), loadServers()]); 
}
(() => { 
  $("secret").value = localStorage.getItem("pip_admin_secret")||""; 
  checkAuthAndLoad(); 
})();


</script>
</body>
</html>
  `);
});

// ---------- All routes below require ADMIN secret ----------
adminRouter.use((req, res, next) => {
  const got = (req.headers.authorization ?? "").trim();
  const expected = `Bearer ${getAdminSecret()}`;
  if (!getAdminSecret() || got !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
});


// health
adminRouter.get("/ping", (_req, res) => res.json({ ok: true }));

// reload AppConfig cache
adminRouter.post("/reload-config", async (_req, res) => {
  try {
    await getConfig(true);
    res.json({ ok: true, reloaded: "config" });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "reload-config failed" });
  }
});

// re-register slash commands
adminRouter.post("/reload-commands", async (_req, res) => {
  try {
    const commands = getCommandsJson();
    await registerCommandsForApprovedGuilds(commands);
    res.json({ ok: true, reloaded: "commands" });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "reload-commands failed" });
  }
});

adminRouter.post("/reload-all", async (_req, res) => {
  try {
    await (await import("../config.js")).getConfig(true);
    const commands = getCommandsJson();
    await registerCommandsForApprovedGuilds(commands);
    res.json({ ok: true, reloaded: ["config", "commands"] });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "reload-all failed" });
  }
});

// ============= TOKEN MANAGEMENT =============
adminRouter.get("/tokens", async (_req, res) => {
  try {
    const tokens = await prisma.token.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ ok: true, tokens });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to fetch tokens" });
  }
});

adminRouter.post("/tokens", async (req, res) => {
  try {
    const { address, minDeposit = 1, minWithdraw = 1 } = req.body;
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ ok: false, error: "Invalid contract address" });
    }
    const normalizedAddress = address.toLowerCase();
    const existing = await prisma.token.findUnique({ where: { address: normalizedAddress } });
    if (existing) return res.status(400).json({ ok: false, error: "Token already exists" });

    const provider = new JsonRpcProvider(ABSTRACT_RPC_URL);
    const contract = new Contract(normalizedAddress, ERC20_ABI, provider);
    const [_name, symbol, decimals] = await Promise.all([contract.name(), contract.symbol(), contract.decimals()]);
    const token = await prisma.token.create({
      data: { address: normalizedAddress, symbol, decimals: Number(decimals), minDeposit: String(minDeposit), minWithdraw: String(minWithdraw), active: true }
    });
res.json({ ok: true, token, message: `Added ${symbol} token` });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error.message?.includes("call revert") ? "Invalid token contract or not deployed on Abstract" : "Failed to add token"
    });
  }
});

adminRouter.put("/tokens/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      active,
      minDeposit,
      minWithdraw,
      withdrawMaxPerTx,
      withdrawDailyCap,
      tipFeeBps,
      houseFeeBps,
    } = req.body;

    const token = await prisma.token.update({
      where: { id },
      data: {
        ...(typeof active === "boolean" && { active }),

        ...(minDeposit !== undefined && { minDeposit: String(minDeposit) }),
        ...(minWithdraw !== undefined && { minWithdraw: String(minWithdraw) }),

        ...(withdrawMaxPerTx !== undefined && {
          withdrawMaxPerTx:
            withdrawMaxPerTx === null || withdrawMaxPerTx === ""
              ? null
              : String(withdrawMaxPerTx),
        }),
        ...(withdrawDailyCap !== undefined && {
          withdrawDailyCap:
            withdrawDailyCap === null || withdrawDailyCap === ""
              ? null
              : String(withdrawDailyCap),
        }),

        // NEW: fee overrides (Int? in Prisma)
        ...(tipFeeBps !== undefined && {
          tipFeeBps:
            tipFeeBps === null || tipFeeBps === "" ? null : Number(tipFeeBps),
        }),
        ...(houseFeeBps !== undefined && {
          houseFeeBps:
            houseFeeBps === null || houseFeeBps === ""
              ? null
              : Number(houseFeeBps),
        }),
      },
    });

    res.json({ ok: true, token });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to update token" });
  }
});



adminRouter.post("/tokens/refresh", async (_req, res) => {
  try {
    await getActiveTokens(true);
    res.json({ ok: true, message: "Token cache refreshed" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to refresh cache" });
  }
});

// ============= SERVER MANAGEMENT =============
adminRouter.get("/servers", async (_req, res) => {
  try {
    const servers = await prisma.approvedServer.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ ok: true, servers });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to fetch servers" });
  }
});

adminRouter.post("/servers", async (req, res) => {
  try {
    const { guildId, note = "" } = req.body;
    if (!guildId) return res.status(400).json({ ok: false, error: "Guild ID required" });
    const server = await prisma.approvedServer.upsert({
      where: { guildId },
      update: { enabled: true, note },
      create: { guildId, note, enabled: true }
    });
    res.json({ ok: true, server });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to add server" });
  }
});

adminRouter.put("/servers/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { enabled, note } = req.body;
    const server = await prisma.approvedServer.update({
      where: { id },
      data: {
        ...(typeof enabled === "boolean" && { enabled }),
        ...(note !== undefined && { note })
      }
    });
    res.json({ ok: true, server });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to update server" });
  }
});

// ============= CONFIG =============
adminRouter.get("/config", async (_req, res) => {
  try {
    const config = await prisma.appConfig.findFirst({ orderBy: { id: "desc" } });
    res.json({ ok: true, config });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to fetch config" });
  }
});

adminRouter.put("/config", async (req, res) => {
  try {
    const { tipFeeBps, houseFeeBps, minDeposit, minWithdraw, withdrawMaxPerTx, withdrawDailyCap } = req.body;
    let configId = 1;
    const existing = await prisma.appConfig.findFirst({ orderBy: { id: "desc" } });
    if (existing) configId = existing.id;

    const config = await prisma.appConfig.upsert({
      where: { id: configId },
      update: {
        ...(tipFeeBps !== undefined && { tipFeeBps: Number(tipFeeBps) }),
        ...(houseFeeBps !== undefined && { houseFeeBps: Number(houseFeeBps) }),
        ...(minDeposit !== undefined && { minDeposit: String(minDeposit) }),
        ...(minWithdraw !== undefined && { minWithdraw: String(minWithdraw) }),
        ...(withdrawMaxPerTx !== undefined && { withdrawMaxPerTx: String(withdrawMaxPerTx) }),
        ...(withdrawDailyCap !== undefined && { withdrawDailyCap: String(withdrawDailyCap) })
      },
      create: {
        tipFeeBps: Number(tipFeeBps || 100),
        houseFeeBps: Number(houseFeeBps || 200),
        minDeposit: String(minDeposit || 50),
        minWithdraw: String(minWithdraw || 50),
        withdrawMaxPerTx: String(withdrawMaxPerTx || 50),
        withdrawDailyCap: String(withdrawDailyCap || 500)
      }
    });

    res.json({ ok: true, config, message: "Configuration updated" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to update config" });
  }
});

// ============= HOUSE EARNINGS (fees & rake) =============
function parseRange(q: any) {
  const since = q.since ? new Date(q.since) : new Date(Date.now() - 7 * 864e5);
  const until = q.until ? new Date(q.until) : new Date();
  return { since, until };
}

adminRouter.get("/fees/by-server", async (req, res) => {
  try {
    const { since, until } = parseRange(req.query);
    const guildId = req.query.guildId ? String(req.query.guildId) : undefined;

    const tipFees = await prisma.transaction.groupBy({
      by: ["guildId", "tokenId"],
      where: {
        type: "TIP",
        ...(guildId ? { guildId } : {}),
        createdAt: { gte: since, lte: until }
      },
      _sum: { fee: true }
    });

    const rake = await prisma.transaction.groupBy({
      by: ["guildId", "tokenId"],
      where: {
        type: "MATCH_RAKE",
        ...(guildId ? { guildId } : {}),
        createdAt: { gte: since, lte: until }
      },
      _sum: { amount: true }
    });

const tokens = await prisma.token.findMany({ select: { id: true, symbol: true } });
const tokMap = new Map<number, string>(tokens.map(t => [t.id, t.symbol]));

// use a normalized key that tolerates null tokenId
const key = (g: string | null | undefined, t: number | null) => `${g || ""}:${t ?? "null"}`;

const rakeMap = new Map<string, string>();
rake.forEach(r => rakeMap.set(key(r.guildId, r.tokenId), String(r._sum.amount || 0)));

const rows = tipFees.map(f => ({
  guildId: f.guildId,
  token: f.tokenId != null ? (tokMap.get(f.tokenId) ?? `#${f.tokenId}`) : "#no-token",
  tipFees: String(f._sum.fee || 0),
  matchRake: rakeMap.get(key(f.guildId, f.tokenId)) || "0"
}));


    res.json({ ok: true, rows, since, until });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "fees/by-server failed" });
  }
});

adminRouter.get("/fees/summary", async (req, res) => {
  try {
    const { since, until } = parseRange(req.query);

    const tipFees = await prisma.transaction.groupBy({
      by: ["tokenId"],
      where: { type: "TIP", createdAt: { gte: since, lte: until } },
      _sum: { fee: true }
    });

    const rake = await prisma.transaction.groupBy({
      by: ["tokenId"],
      where: { type: "MATCH_RAKE", createdAt: { gte: since, lte: until } },
      _sum: { amount: true }
    });

const tokens = await prisma.token.findMany({ select: { id: true, symbol: true } });
const tokMap = new Map<number, string>(tokens.map(t => [t.id, t.symbol]));
const rakeMap = new Map<number | null, string>(
  rake.map(r => [r.tokenId, String(r._sum.amount || 0)])
);

const rows = tipFees.map(f => ({
  token: f.tokenId != null ? (tokMap.get(f.tokenId) ?? `#${f.tokenId}`) : "#no-token",
  tipFees: String(f._sum.fee || 0),
  matchRake: rakeMap.get(f.tokenId ?? null) || "0"
}));


    res.json({ ok: true, rows, since, until });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "fees/summary failed" });
  }
});

adminRouter.get("/fees/export.csv", async (req, res) => {
  try {
    const { since, until } = parseRange(req.query);
    const guildId = req.query.guildId ? String(req.query.guildId) : undefined;

    const byServer = await prisma.transaction.groupBy({
      by: ["guildId", "tokenId"],
      where: {
        OR: [{ type: "TIP" }, { type: "MATCH_RAKE" }],
        ...(guildId ? { guildId } : {}),
        createdAt: { gte: since, lte: until }
      },
      _sum: { fee: true, amount: true }
    });

const tokens = await prisma.token.findMany({ select: { id: true, symbol: true } });
const tokMap = new Map<number, string>(tokens.map(t => [t.id, t.symbol]));

let csv = "guildId,token,tipFees,matchRake,total\n";
byServer.forEach((r) => {
  const tip = String(r._sum.fee || 0);
  const rake = String(r._sum.amount || 0);
  const total = (parseFloat(tip) + parseFloat(rake)).toString();

  // tokenId can be null in groupBy; make a safe label
  const tokenLabel =
    r.tokenId != null ? (tokMap.get(r.tokenId) ?? `#${r.tokenId}`) : "#no-token";

  csv += `${r.guildId ?? ""},${tokenLabel},${tip},${rake},${total}\n`;
});


    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=house_fees.csv");
    res.send(csv);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "fees/export.csv failed" });
  }
});

// ============= BASIC ANALYTICS =============
adminRouter.get("/stats", async (_req, res) => {
  try {
    const [totalUsers, totalMatches, totalTips, activeTokens, recentMatches, topTippers] =
      await Promise.all([
        prisma.user.count(),
        prisma.match.count(),
        prisma.tip.count(),
        prisma.token.count({ where: { active: true } }),
        prisma.match.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
        prisma.user.findMany({ orderBy: { wins: "desc" }, take: 5, select: { discordId: true, wins: true, losses: true } })
      ]);

    res.json({ ok: true, stats: { totalUsers, totalMatches, totalTips, activeTokens, recentMatches, topTippers } });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to fetch stats" });
  }
});

import { getTreasurySnapshot, invalidateTreasuryCache } from "../services/treasury.js";

adminRouter.get("/treasury", async (req, res) => {
  try {
    const force = String(req.query.force || "") === "1";
    const snap = await getTreasurySnapshot(force);
    res.json({ ok: true, ...snap });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "treasury failed" });
  }
});

// If you refresh tokens, also invalidate the treasury cache (optional)
adminRouter.post("/tokens/refresh", async (_req, res) => {
  try {
    await getActiveTokens(true);
    invalidateTreasuryCache();
    res.json({ ok: true, message: "Token cache refreshed" });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to refresh cache" });
  }
});
