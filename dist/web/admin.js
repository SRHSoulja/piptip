// src/web/admin.ts - Modular admin interface
import "dotenv/config";
import { Router } from "express";
import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
// Import route modules
import { adsRouter } from "./admin/ads.js";
import { tiersRouter } from "./admin/tiers.js";
import { serversRouter } from "./admin/servers.js";
import { tokensRouter } from "./admin/tokens.js";
import { configRouter } from "./admin/config.js";
import { usersRouter } from "./admin/users.js";
import { transactionsRouter } from "./admin/transactions.js";
import { groupTipsRouter } from "./admin/groupTips.js";
import { systemRouter } from "./admin/system.js";
import { backupRouter } from "./admin/backup.js";
import { statsRouter } from "./admin/stats.js";
import { prisma } from "../services/db.js";
import { getTreasurySnapshot } from "../services/treasury.js";
export const adminRouter = Router();
// Get current directory for file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Read lazily so .env is loaded and hot-reloads work
const getAdminSecret = () => (process.env.ADMIN_SECRET ?? "").trim();
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
  .fee-input-container { position:relative; min-width:120px }
  .fee-suffix { margin-left:2px; color:#9ca3af; font-weight:500 }
  .fee-presets { display:flex; gap:2px; margin-top:4px }
  .preset-btn { padding:2px 6px; font-size:11px; background:#374151; border:1px solid #4b5563; border-radius:3px; cursor:pointer }
  .preset-btn:hover { background:#4b5563 }
  .fee-preview { font-size:10px; color:#9ca3af; margin-top:2px; min-height:12px }
  .fee-warning { color:#f59e0b }
  .fee-error { color:#ef4444 }
  .fee-success { color:#10b981 }
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
    <h2>📊 Bot Statistics Dashboard</h2>
    <div class="row">
      <button id="loadDashboard">🔄 Refresh Dashboard</button>
      <button id="exportStats">📊 Export Stats CSV</button>
      <span id="statsMsg"></span>
    </div>
    
    <!-- KPI Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 16px 0;">
      <div class="kpi-card" style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 20px; border-radius: 12px; text-align: center; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 2.5em; font-weight: bold;" id="kpi-servers">-</h3>
        <p style="margin: 0; opacity: 0.9;">Servers</p>
      </div>
      <div class="kpi-card" style="background: linear-gradient(135deg, #10b981, #059669); padding: 20px; border-radius: 12px; text-align: center; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 2.5em; font-weight: bold;" id="kpi-users">-</h3>
        <p style="margin: 0; opacity: 0.9;">Users</p>
      </div>
      <div class="kpi-card" style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 20px; border-radius: 12px; text-align: center; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 2.5em; font-weight: bold;" id="kpi-tips">-</h3>
        <p style="margin: 0; opacity: 0.9;">Tips Sent</p>
      </div>
      <div class="kpi-card" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed); padding: 20px; border-radius: 12px; text-align: center; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 2.5em; font-weight: bold;" id="kpi-games">-</h3>
        <p style="margin: 0; opacity: 0.9;">Games Played</p>
      </div>
    </div>

    <!-- Highlights Row -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0;">
      <div style="background: #1a1a1a; padding: 16px; border-radius: 8px; border: 1px solid #333;">
        <h4 style="margin: 0 0 12px 0; color: #fff;">🏆 Biggest Tip Ever</h4>
        <div id="biggest-tip">Loading...</div>
      </div>
      <div style="background: #1a1a1a; padding: 16px; border-radius: 8px; border: 1px solid #333;">
        <h4 style="margin: 0 0 12px 0; color: #fff;">⭐ Most Active User</h4>
        <div id="most-active">Loading...</div>
      </div>
    </div>

    <!-- Server Activity Table -->
    <div style="margin-top: 20px;">
      <div class="row">
        <h3 style="margin: 0; color: #fff;">🖥️ Server Activity</h3>
        <select id="serverSort" style="margin-left: auto;">
          <option value="activity">Sort by Total Activity</option>
          <option value="tips">Sort by Tips</option>
          <option value="games">Sort by Games</option>
          <option value="volume">Sort by Volume</option>
          <option value="users">Sort by Active Users</option>
        </select>
      </div>
      <table id="serverStatsTbl" style="margin-top: 12px;">
        <thead>
          <tr>
            <th>Server</th><th>Tips</th><th>Games</th><th>Group Tips</th>
            <th>Active Users</th><th>Last Activity</th><th>Actions</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>

    <!-- Token Performance Table -->
    <div style="margin-top: 20px;">
      <div class="row">
        <h3 style="margin: 0; color: #fff;">🪙 Token Performance</h3>
        <select id="tokenSort" style="margin-left: auto;">
          <option value="volume">Sort by Volume</option>
          <option value="count">Sort by Tip Count</option>
          <option value="avg">Sort by Average Size</option>
          <option value="recent">Sort by Recent Activity</option>
        </select>
      </div>
      <table id="tokenStatsTbl" style="margin-top: 12px;">
        <thead>
          <tr>
            <th>Token</th><th>Total Tipped</th><th>Tip Count</th>
            <th>Avg Tip Size</th><th>Last Activity</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
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
          <th>Tip Fee (%)</th><th>House Rake (%)</th>
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
    
    <!-- User Search with Auto-complete -->
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 12px 0; color: #fff;">🔍 Search Users</h3>
      <div class="row">
        <div style="position: relative; flex: 1; max-width: 400px;">
          <input id="searchUser" placeholder="Start typing Discord ID..." style="width: 100%;"/>
          <div id="searchResults" style="position: absolute; top: 100%; left: 0; right: 0; background: #2a2a2a; border: 1px solid #444; border-top: none; border-radius: 0 0 8px 8px; max-height: 300px; overflow-y: auto; z-index: 1000; display: none;">
            <!-- Auto-complete results will appear here -->
          </div>
        </div>
        <button id="findUser">Find Specific User</button>
        <button id="clearSearch">Clear</button>
        <span id="userMsg"></span>
      </div>
    </div>

    <!-- Top Users Section -->
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 12px 0; color: #fff;">🏆 Top Users</h3>
      <div class="row">
        <button id="loadTopUsers">Load Top 100 Users</button>
        <button id="refreshUsers" style="background:#059669;">🔄 Refresh Users</button>
        <select id="topUsersSort" style="margin-left: 12px;">
          <option value="recent">Sort by Registration Date</option>
          <option value="tips_sent">Sort by Tips Sent</option>
          <option value="tips_received">Sort by Tips Received</option>
          <option value="balance">Sort by Total Balance</option>
        </select>
        <span id="topUsersMsg" style="margin-left: 12px;"></span>
      </div>
    </div>

    <!-- Users Table -->
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
        <option value="SYSTEM_BACKUP">System Backups</option>
      </select>
      <input id="txUser" placeholder="Discord ID"/>
      <input id="txSince" type="datetime-local"/>
      <input id="txLimit" type="number" value="50" min="1" max="1000" style="width:80px"/>
      <button id="loadTransactions">Load Transactions</button>
      <button id="exportTransactions">Export CSV</button>
      <button id="exportGuildData">📊 Export Guild Data</button>
      <span id="txMsg"></span>
    </div>
    <table id="transactionsTbl">
      <thead>
        <tr>
          <th>ID</th><th>Type</th><th>User</th><th>Amount</th><th>Token</th>
          <th>Fee</th><th>Time</th><th>Guild</th><th>Details</th><th>Actions</th>
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
      <button id="grandReset" style="background:#7c2d12;">💀 GRAND RESET</button>
      <span id="emergencyMsg"></span>
    </div>
    <div class="row" style="margin-top:12px;">
      <label>🔄 System Health</label>
      <button id="syncStatus">Check Sync Status</button>
      <button id="fixSync">Auto-Fix Sync</button>
      <button id="clearCaches">Clear Caches</button>
      <button id="systemStats">System Stats</button>
      <span id="systemMsg"></span>
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

  <section>
    <h2>💾 Database Backups</h2>
    <p>Automated hourly backups and manual backup management</p>
    <div class="row">
      <button id="loadBackupStatus">🔄 Refresh Status</button>
      <button id="createManualBackup">📦 Create Manual Backup</button>
      <button id="toggleBackupService">⏯️ Toggle Auto-Backup</button>
      <span id="backupMsg"></span>
    </div>
    <div id="backupStatus" style="margin-top:16px; padding:16px; background:#1a1a1a; border-radius:8px; display:none;">
      <h3>Backup Service Status</h3>
      <div id="backupStatusData"></div>
      <h4>Recent Backups</h4>
      <table id="backupTbl" style="margin-top:8px;">
        <thead>
          <tr><th>Filename</th><th>Size (KB)</th><th>Created</th><th>Actions</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  </section>

  <script src="/admin/ui.js" type="module"></script>
</body>
</html>`);
});
/* ------------------------------------------------------------------------ */
/*                      Admin UI (client JS served here)                    */
/* ------------------------------------------------------------------------ */
adminRouter.get("/ui.js", async (_req, res) => {
    try {
        // Always look in src directory for ui.js since it's not compiled
        const srcDir = process.cwd();
        const jsPath = join(srcDir, "src", "web", "admin", "ui.js");
        console.log("🔍 Trying to read ui.js from:", jsPath);
        console.log("📁 Working directory:", srcDir);
        const jsContent = await readFile(jsPath, 'utf-8');
        console.log("✅ Successfully read ui.js, size:", jsContent.length, "bytes");
        res.type("application/javascript").send(jsContent);
    }
    catch (error) {
        console.error("❌ Failed to serve admin UI JavaScript:", error);
        console.error("Error details:", {
            message: error instanceof Error ? error.message : String(error),
            code: error && typeof error === 'object' && 'code' in error ? error.code : 'unknown',
            path: error && typeof error === 'object' && 'path' in error ? error.path : 'unknown'
        });
        res.status(500).send("// Failed to load admin JavaScript");
    }
});
/* ------------------------------------------------------------------------ */
/*                           Authentication Middleware                       */
/* ------------------------------------------------------------------------ */
adminRouter.use(async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token || token !== getAdminSecret()) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    next();
});
/* ------------------------------------------------------------------------ */
/*                              Route Modules                               */
/* ------------------------------------------------------------------------ */
// Mount route modules
adminRouter.use(configRouter);
adminRouter.use(tokensRouter);
adminRouter.use(serversRouter);
adminRouter.use(adsRouter);
adminRouter.use(tiersRouter);
adminRouter.use(usersRouter);
adminRouter.use(transactionsRouter);
adminRouter.use(groupTipsRouter);
adminRouter.use(systemRouter);
adminRouter.use(backupRouter);
adminRouter.use(statsRouter);
/* ------------------------------------------------------------------------ */
/*                          Remaining Direct Routes                         */
/* ------------------------------------------------------------------------ */
// Treasury endpoint
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
// Fees by server endpoint
adminRouter.get("/fees/by-server", async (req, res) => {
    try {
        const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const until = req.query.until ? new Date(req.query.until) : new Date();
        const guildId = req.query.guildId ? String(req.query.guildId) : undefined;
        const transactions = await prisma.transaction.groupBy({
            by: ["guildId", "tokenId"],
            where: {
                OR: [{ type: "TIP" }, { type: "MATCH_RAKE" }],
                ...(guildId && { guildId }),
                createdAt: { gte: since, lte: until }
            },
            _sum: { fee: true, amount: true }
        });
        const tokens = await prisma.token.findMany({ select: { id: true, symbol: true } });
        const tokenMap = new Map(tokens.map(t => [t.id, t.symbol]));
        const rows = transactions.map(tr => ({
            guildId: tr.guildId || "Unknown",
            token: tr.tokenId ? (tokenMap.get(tr.tokenId) ?? `Token#${tr.tokenId}`) : "Unknown",
            tipFees: tr._sum.fee || 0,
            matchRake: tr._sum.amount || 0
        }));
        res.json({ ok: true, rows });
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to load fees" });
    }
});
// CSV export for fees
adminRouter.get("/fees/export.csv", async (req, res) => {
    try {
        const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const until = req.query.until ? new Date(req.query.until) : new Date();
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
        let csv = "guildId,token,tipFees,matchRake,total,dateRange\\n";
        transactions.forEach(tr => {
            const tipFees = String(tr._sum.fee || 0);
            const matchRake = String(tr._sum.amount || 0);
            const total = (parseFloat(tipFees) + parseFloat(matchRake)).toString();
            const tokenLabel = tr.tokenId ? (tokenMap.get(tr.tokenId) ?? `Token#${tr.tokenId}`) : "Unknown";
            const dateRange = `${since.toDateString()} to ${until.toDateString()}`;
            csv += `"${tr.guildId || ""}","${tokenLabel}","${tipFees}","${matchRake}","${total}","${dateRange}"\\n`;
        });
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="house_fees_export.csv"');
        res.send(csv);
    }
    catch {
        res.status(500).json({ ok: false, error: "Failed to export CSV" });
    }
});
// Favicon route to prevent 404 errors
adminRouter.get("/favicon.ico", (_req, res) => {
    // Return a simple 1x1 transparent PNG
    const favicon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.send(favicon);
});
