// src/web/admin.ts - Modular admin interface
import "dotenv/config";
import { Router, Request, Response, NextFunction } from "express";
import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Import route modules
import { adsRouter } from "./admin/ads.js";
import { tiersRouter } from "./admin/tiers.js";
import { serversRouter } from "./admin/servers.js";
import { serverApplicationsRouter } from "./admin/server_applications.js";
import { channelsRouter } from "./admin/channels.js";
import { tokensRouter } from "./admin/tokens.js";
import { configRouter } from "./admin/config.js";
import { usersRouter } from "./admin/users.js";
import { transactionsRouter } from "./admin/transactions.js";
import { groupTipsRouter } from "./admin/groupTips.js";
import { systemRouter } from "./admin/system.js";
// import { backupRouter } from "./admin/backup.js"; // Disabled due to environment issues
import { statsRouter } from "./admin/stats.js";
import { pengubookRouter } from "./admin/pengubook.js";
import achievementAdminRouter from "./admin/achievements.js";
import roleTaxRouter from "./admin/role_tax_management.js";
import roleRakeRouter from "./admin/role_rake_management.js";
import { resourcesRouter } from "./admin/resources.js";
import { goodKnightWebhooksRouter } from "./admin/good_knight_webhooks.js";
import tierRolesRouter from "./admin/tier_roles.js";
import { treasurySafetyRouter } from "./admin/treasury_safety.js";
import { predictionMarketsRouter } from "./admin/prediction_markets.js";
import { automationAdminRouter } from "./admin/automation.js";
import pipchipsAdminRouter from "./admin/pipchips_admin.js";
import { tournamentsRouter } from "./admin/tournaments.js";
import { adminMarketsRouter } from "./admin_markets.js";
import { cancelNonApiMarkets } from "./admin/cancel_non_api_markets.js";

// Import remaining services and utilities
import { Prisma } from "@prisma/client";
import { JsonRpcProvider, Contract } from "ethers";
import { prisma } from "../services/db.js";
import { getConfig } from "../config.js";
import { getAbstractRpcUrl } from "../services/network.js";
import { getDiscordClient, fetchMultipleUsernames, fetchMultipleServernames } from "../services/discord_users.js";
import { getTreasurySnapshot, invalidateTreasuryCache } from "../services/treasury.js";
import { priceAPI } from "../services/price_api.js";
import { verifyCSRFToken, generateCSRFToken, getCSRFStats } from "../services/csrf_protection.js";
import { getSecureAdminSecret } from "../services/secure_key.js";

export const adminRouter = Router();

// Get current directory for file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read lazily so .env is loaded and hot-reloads work
const getAdminSecret = () => (process.env.ADMIN_SECRET ?? "").trim();

/* ------------------------------------------------------------------------ */
/*                       Security Headers Middleware                        */
/* ------------------------------------------------------------------------ */
const setSecurityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Content Security Policy - Strict for admin interface
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // Allowing inline for admin-generated content only
    "style-src 'self' 'unsafe-inline'", // Allowing inline styles for admin interface
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join("; "));

  // Additional security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");

  // HSTS for HTTPS environments
  if (req.secure || req.get('X-Forwarded-Proto') === 'https') {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  next();
};

// Apply security headers to all admin routes
adminRouter.use(setSecurityHeaders);

/* ------------------------------------------------------------------------ */
/*                           Admin UI (HTML shell)                          */
/* ------------------------------------------------------------------------ */
adminRouter.get("/ui", (_req: Request, res: Response) => {
  res.type("html").send(`<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>PIPtip Admin</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="referrer" content="strict-origin-when-cross-origin"/>
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet"/>
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
      <label for="secret">Admin Secret</label>
      <input id="secret" name="secret" type="password" placeholder="Paste ADMIN_SECRET"/>
      <button id="saveSecret">Save & Connect</button>
      <span id="authStatus"></span>
    </div>
    <div class="row" style="margin-top:10px; font-size:0.9em; color:#9ca3af;">
      🔐 Enhanced CSRF Protection: All operations protected with session-bound tokens, Double Submit Cookies, and HMAC validation.
    </div>
  </section>

  <section>
    <h2>🔗 Admin Interfaces</h2>
    <div class="row">
      <a href="/admin/achievements" target="_blank" style="margin-right: 10px; padding: 8px 12px; background: #3b82f6; color: white; text-decoration: none; border-radius: 4px;">🏆 Achievement Management</a>
      <a href="/admin/role-tax" target="_blank" style="margin-right: 10px; padding: 8px 12px; background: #10b981; color: white; text-decoration: none; border-radius: 4px;">💰 Role Tax Exemptions</a>
      <a href="/admin/role-rake" target="_blank" style="margin-right: 10px; padding: 8px 12px; background: #f59e0b; color: white; text-decoration: none; border-radius: 4px;">🎲 Role Rake Reductions</a>
      <a href="/admin/resources" target="_blank" style="margin-right: 10px; padding: 8px 12px; background: #ef4444; color: white; text-decoration: none; border-radius: 4px;">📈 Resource Monitor</a>
      <a href="/admin/good-knight" target="_blank" style="margin-right: 10px; padding: 8px 12px; background: #8b5cf6; color: white; text-decoration: none; border-radius: 4px;">🛡️ Good Knight Webhooks</a>
      <a href="/admin/tier-roles/status" target="_blank" style="margin-right: 10px; padding: 8px 12px; background: #6366f1; color: white; text-decoration: none; border-radius: 4px;">👑 Tier Role Management</a>
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
        <label for="serverSort" style="margin-left: auto; margin-right: 8px;">Sort:</label>
        <select id="serverSort" name="serverSort">
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
        <label for="tokenSort" style="margin-left: auto; margin-right: 8px;">Sort:</label>
        <select id="tokenSort" name="tokenSort">
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
      <label for="minDeposit">Min Deposit</label>
      <input id="minDeposit" name="minDeposit" type="number" min="0" step="0.0000000001"/>
      <label for="minWithdraw">Min Withdraw</label>
      <input id="minWithdraw" name="minWithdraw" type="number" min="0" step="0.0000000001"/>
      <label for="withdrawMaxPerTx">Max Withdraw / tx (0 = none)</label>
      <input id="withdrawMaxPerTx" name="withdrawMaxPerTx" type="number" min="0" step="0.0000000001"/>
      <label for="withdrawDailyCap">Daily Withdraw Cap (0 = none)</label>
      <input id="withdrawDailyCap" name="withdrawDailyCap" type="number" min="0" step="0.0000000001"/>
      <button id="saveCfg">Save Config</button>
      <button id="reloadCfg">Reload Cache</button>
      <span id="cfgMsg"></span>
    </div>
  </section>

  <section>
    <h2>🏷️ Tiers</h2>
    <div class="row">
      <label for="tierName">Name</label>
      <input id="tierName" name="tierName" placeholder="Name" style="width:180px"/>
      <label for="tierDesc">Description</label>
      <input id="tierDesc" name="tierDesc" placeholder="Description" style="width:260px"/>
      <label for="tierToken">Token</label>
      <select id="tierToken" name="tierToken"></select>
      <label for="tierPrice">Price</label>
      <input id="tierPrice" name="tierPrice" type="number" step="0.00000001" placeholder="Price"/>
      <label for="tierDays">Days</label>
      <input id="tierDays" name="tierDays" type="number" min="1" placeholder="Days" style="width:100px"/>
      <label style="min-width:auto"><input id="tierTaxFree" name="tierTaxFree" type="checkbox"/> Tip Tax Free</label>
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
      <label for="newTokenAddress">Token Address</label>
      <input id="newTokenAddress" name="newTokenAddress" placeholder="0x..." maxlength="42"/>
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
      <label for="newGuildId">Guild ID</label>
      <input id="newGuildId" name="newGuildId" placeholder="Guild ID" pattern="[0-9]+"/>
      <label for="newGuildNote">Description</label>
      <input id="newGuildNote" name="newGuildNote" placeholder="Server description"/>
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
      <button id="loadTreasury" onclick="loadTreasury()">Load Treasury Balances</button>
      <button id="reloadTreasury" style="display:none">Refresh Balances</button>
      <span id="treasuryMsg">Click "Load Treasury Balances" to view current balances</span>
    </div>
    <table id="treasuryTbl">
      <thead>
        <tr><th>Asset</th><th>Balance</th><th>USD Value</th><th>Price (USD)</th></tr>
      </thead>
      <tbody></tbody>
    </table>
  </section>

  <section>
    <h2>🔒 Withdrawal Security & Monitoring</h2>
    <div class="row">
      <button id="loadWithdrawalStats">🔄 Refresh Stats</button>
      <button id="clearCooldowns">⚡ Clear All Cooldowns</button>
      <label for="withdrawalTimeframe">Timeframe:</label>
      <select id="withdrawalTimeframe" name="withdrawalTimeframe">
        <option value="1">Last 1 Hour</option>
        <option value="6">Last 6 Hours</option>
        <option value="24" selected>Last 24 Hours</option>
        <option value="168">Last 7 Days</option>
      </select>
      <span id="withdrawalMsg"></span>
    </div>

    <!-- Withdrawal Protection Status Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 16px 0;">
      <div class="kpi-card" style="background: linear-gradient(135deg, #10b981, #059669); padding: 20px; border-radius: 12px; text-align: center; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 2.5em; font-weight: bold;" id="withdrawal-total">-</h3>
        <p style="margin: 0; opacity: 0.9;">Total Withdrawals</p>
      </div>
      <div class="kpi-card" style="background: linear-gradient(135deg, #ef4444, #dc2626); padding: 20px; border-radius: 12px; text-align: center; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 2.5em; font-weight: bold;" id="withdrawal-blocked">-</h3>
        <p style="margin: 0; opacity: 0.9;">Blocked Attempts</p>
      </div>
      <div class="kpi-card" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed); padding: 20px; border-radius: 12px; text-align: center; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 2.5em; font-weight: bold;" id="withdrawal-users">-</h3>
        <p style="margin: 0; opacity: 0.9;">Active Users</p>
      </div>
      <div class="kpi-card" style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 20px; border-radius: 12px; text-align: center; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 2.5em; font-weight: bold;" id="gas-saved">-</h3>
        <p style="margin: 0; opacity: 0.9;">ETH Gas Saved</p>
      </div>
    </div>

    <!-- Protection Success Rate -->
    <div style="background: #1a1a1a; padding: 16px; border-radius: 8px; border: 1px solid #333; margin: 16px 0;">
      <h4 style="margin: 0 0 12px 0; color: #fff;">🛡️ Protection Effectiveness</h4>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span style="font-size: 2em; color: #10b981; font-weight: bold;" id="success-rate">-</span>
          <span style="color: #9ca3af; margin-left: 8px;">Success Rate</span>
        </div>
        <div style="text-align: right; color: #9ca3af; font-size: 0.9em;">
          <div id="timeframe-display">Last 24 hours</div>
          <div id="gas-cost-estimate">Est. ~- ETH in gas costs prevented</div>
        </div>
      </div>
    </div>

    <!-- High-Risk Users Alert Table -->
    <div style="margin-top: 20px;">
      <h3 style="margin: 0 0 12px 0; color: #fff;">⚠️ High-Risk Activity Alerts</h3>
      <div id="high-risk-users" style="background: #1a1a1a; padding: 16px; border-radius: 8px; border: 1px solid #333; min-height: 60px;">
        <div style="color: #9ca3af; text-align: center; padding: 20px;">
          Click "Refresh Stats" to load withdrawal monitoring data
        </div>
      </div>
    </div>
  </section>

  <section>
    <h2>🪧 Ads</h2>
    <div class="row">
      <label for="adText">Ad Text</label>
      <input id="adText" name="adText" placeholder="Ad text (max 500 chars)" style="width:420px" maxlength="500"/>
      <label for="adUrl">URL</label>
      <input id="adUrl" name="adUrl" placeholder="https://destination.example" style="width:320px"/>
      <label for="adWeight">Weight</label>
      <input id="adWeight" name="adWeight" type="number" min="1" max="100" value="5" style="width:80px"/>
      <label style="min-width:auto"><input id="adActive" name="adActive" type="checkbox" checked/> Active</label>
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
          <label for="searchUser" style="display: block; margin-bottom: 4px;">Search by Discord ID:</label>
          <input id="searchUser" name="searchUser" placeholder="Start typing Discord ID..." style="width: 100%;"/>
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
        <label for="topUsersSort" style="margin-left: 12px; margin-right: 4px;">Sort:</label>
        <select id="topUsersSort" name="topUsersSort">
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
      <label for="txType">Type:</label>
      <select id="txType" name="txType">
        <option value="">All Types</option>
        <option value="TIP">Tips</option>
        <option value="DEPOSIT">Deposits</option>
        <option value="WITHDRAW">Withdrawals</option>
        <option value="PURCHASE">Purchases</option>
        <option value="SYSTEM_BACKUP">System Backups</option>
      </select>
      <label for="txUser">User:</label>
      <input id="txUser" name="txUser" placeholder="Discord ID"/>
      <label for="txSince">Since:</label>
      <input id="txSince" name="txSince" type="datetime-local"/>
      <label for="txLimit">Limit:</label>
      <input id="txLimit" name="txLimit" type="number" value="50" min="1" max="1000" style="width:80px"/>
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
      <label for="gtStatus">Status Filter:</label>
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
    <h2>📊 Resource Monitor</h2>
    <p>Real-time monitoring for 0.5 vCPU / 2 GiB Replit Reserved VM</p>
    <div class="row">
      <button id="refreshResources">🔄 Refresh Metrics</button>
      <button id="loadResourceHistory">📈 Load History</button>
      <button id="checkUpgrade">🚀 Check Upgrade Need</button>
      <span id="resourceMsg"></span>
    </div>

    <!-- Resource Status Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; margin: 16px 0;">
      <div class="kpi-card" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); padding: 20px; border-radius: 12px; text-align: center; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 2.5em; font-weight: bold;" id="memory-usage">-</h3>
        <p style="margin: 0; opacity: 0.9;">Memory Usage</p>
        <small id="memory-details" style="opacity: 0.7;">- / -</small>
      </div>
      <div class="kpi-card" style="background: linear-gradient(135deg, #10b981, #059669); padding: 20px; border-radius: 12px; text-align: center; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 2.5em; font-weight: bold;" id="cpu-usage">-</h3>
        <p style="margin: 0; opacity: 0.9;">CPU Usage</p>
        <small id="cpu-details" style="opacity: 0.7;">0.5 vCPU</small>
      </div>
      <div class="kpi-card" style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 20px; border-radius: 12px; text-align: center; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 2.5em; font-weight: bold;" id="event-loop-delay">-</h3>
        <p style="margin: 0; opacity: 0.9;">Event Loop Delay</p>
        <small id="event-loop-details" style="opacity: 0.7;">Performance metric</small>
      </div>
      <div class="kpi-card" style="background: linear-gradient(135deg, #8b5cf6, #7c3aed); padding: 20px; border-radius: 12px; text-align: center; color: white;">
        <h3 style="margin: 0 0 8px 0; font-size: 2.5em; font-weight: bold;" id="uptime-display">-</h3>
        <p style="margin: 0; opacity: 0.9;">Uptime</p>
        <small id="uptime-details" style="opacity: 0.7;">System stability</small>
      </div>
    </div>

    <!-- Alerts Section -->
    <div id="resource-alerts" style="background: #1a1a1a; padding: 16px; border-radius: 8px; border: 1px solid #333; margin: 16px 0; display: none;">
      <h4 style="margin: 0 0 12px 0; color: #fff;">🚨 Resource Alerts</h4>
      <div id="alerts-container"></div>
    </div>

    <!-- Upgrade Recommendations -->
    <div id="upgrade-recommendations" style="background: #1a1a1a; padding: 16px; border-radius: 8px; border: 1px solid #333; margin: 16px 0;">
      <h4 style="margin: 0 0 12px 0; color: #fff;">💡 Recommendations</h4>
      <div id="recommendations-container">
        <div style="color: #9ca3af; text-align: center; padding: 20px;">
          Click "Refresh Metrics" to load resource analysis
        </div>
      </div>
    </div>

    <!-- Resource History Chart Placeholder -->
    <div style="margin-top: 20px;">
      <h3 style="margin: 0 0 12px 0; color: #fff;">📈 Resource History (Last Hour)</h3>
      <div id="resource-history" style="background: #1a1a1a; padding: 16px; border-radius: 8px; border: 1px solid #333; min-height: 200px; display: flex; align-items: center; justify-content: center;">
        <div style="color: #9ca3af; text-align: center;">
          <div>📊</div>
          <div>Click "Load History" to view resource trends</div>
        </div>
      </div>
    </div>
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
      <span style="color:#ef4444; font-weight:bold;">⚠️ DANGER ZONE</span>
      <button id="pauseWithdrawals" style="background:#dc2626;">Pause All Withdrawals</button>
      <button id="pauseTipping" style="background:#dc2626;">Pause All Tipping</button>
      <button id="emergencyMode" style="background:#dc2626;">Emergency Mode</button>
      <button id="resumeAll" style="background:#059669;">Resume All Operations</button>
      <button id="grandReset" style="background:#7c2d12;">💀 GRAND RESET</button>
      <span id="emergencyMsg"></span>
    </div>
    <div class="row" style="margin-top:12px;">
      <span>🔄 System Health</span>
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
      <label for="feesSince">From Date</label>
      <input id="feesSince" type="date"/>
      <label for="feesUntil">To Date</label>
      <input id="feesUntil" type="date"/>
      <label for="feesGuild">Guild (optional)</label>
      <input id="feesGuild" placeholder="Guild ID"/>
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
    <h2>🏆 Achievement Management</h2>
    <p>Manage dynamic achievements and user progress</p>
    <div class="row">
      <button id="loadAchievements">🔄 Refresh Achievements</button>
      <button id="createAchievement">➕ Create Achievement</button>
      <button id="seedAchievements">🌱 Seed Default Achievements</button>
      <span id="achievementMsg"></span>
    </div>
    <table id="achievementsTbl">
      <thead>
        <tr>
          <th>ID</th><th>Title</th><th>Description</th><th>Type</th>
          <th>Target</th><th>Reward</th><th>Active</th><th>Completions</th><th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
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

  <script src="/admin/ui.js"></script>
</body>
</html>`);
});

/* ------------------------------------------------------------------------ */
/*                      Admin UI (client JS served here)                    */
/* ------------------------------------------------------------------------ */
adminRouter.get("/ui.js", async (_req: Request, res: Response) => {
  try {
    // Always look in src directory for ui.js since it's not compiled
    const srcDir = process.cwd();
    const jsPath = join(srcDir, "src", "web", "admin", "ui.js");
    console.log("🔍 Trying to read ui.js from:", jsPath);
    console.log("📁 Working directory:", srcDir);
    const jsContent = await readFile(jsPath, 'utf-8');
    console.log("✅ Successfully read ui.js, size:", jsContent.length, "bytes");
    res.type("application/javascript").send(jsContent);
  } catch (error) {
    console.error("❌ Failed to serve admin UI JavaScript:", error);
    console.error("Error details:", {
      message: error instanceof Error ? error.message : String(error),
      code: error && typeof error === 'object' && 'code' in error ? error.code : 'unknown',
      path: error && typeof error === 'object' && 'path' in error ? error.path : 'unknown'
    });
    res.status(500).send("// Failed to load admin JavaScript");
  }
});

// Serve modular admin interface
adminRouter.get("/modular", async (_req: Request, res: Response) => {
  try {
    const srcDir = process.cwd();
    const htmlPath = join(srcDir, "src", "web", "admin", "admin-modular.html");
    const htmlContent = await readFile(htmlPath, 'utf-8');
    res.type("text/html").send(htmlContent);
  } catch (error) {
    console.error("❌ Failed to serve modular admin HTML:", error);
    res.status(500).send("Failed to load modular admin interface");
  }
});

// Serve JavaScript modules dynamically
const jsModules = ['security.js', 'validation.js', 'ui-secure-helpers.js', 'tokens.js', 'core.js', 'fees.js', 'dashboard.js', 'ads.js', 'tiers.js', 'tournaments.js', 'config.js', 'servers.js', 'treasury.js', 'fees-data.js', 'special-markets.js'];

jsModules.forEach(module => {
  adminRouter.get(`/${module}`, async (_req: Request, res: Response) => {
    try {
      const srcDir = process.cwd();
      const jsPath = join(srcDir, "src", "web", "admin", "js", module);
      const jsContent = await readFile(jsPath, 'utf-8');
      res.type("application/javascript").send(jsContent);
    } catch (error) {
      console.error(`❌ Failed to serve ${module}:`, error);
      res.status(500).send(`// Failed to load ${module}`);
    }
  });
});

/* ------------------------------------------------------------------------ */
/*                    Enhanced Multi-Factor Authentication                   */
/* ------------------------------------------------------------------------ */

// Authentication endpoints (before middleware)
adminRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { authenticateAdmin } = await import('../services/admin_auth.js');
    const bearerToken = req.body.token || '';

    const result = await authenticateAdmin(bearerToken, req);

    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      sessionId: result.session!.sessionId,
      requiresMFA: result.requiresMFA,
      message: result.requiresMFA ? 'MFA verification required' : 'Authentication successful'
    });

  } catch (error: any) {
    console.error('Admin login error:', error);
    res.status(500).json({ success: false, error: 'Authentication system error' });
  }
});

adminRouter.post('/auth/mfa/initiate', async (req: Request, res: Response) => {
  try {
    const { initiateMFA } = await import('../services/admin_auth.js');
    const { sessionId } = req.body;

    const result = await initiateMFA(sessionId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      challengeId: result.challengeId,
      message: 'MFA code sent. Check console for code (development mode).'
    });

  } catch (error: any) {
    console.error('MFA initiation error:', error);
    res.status(500).json({ success: false, error: 'MFA system error' });
  }
});

adminRouter.post('/auth/mfa/verify', async (req: Request, res: Response) => {
  try {
    const { verifyMFA } = await import('../services/admin_auth.js');
    const { challengeId, code, includeJWT } = req.body;

    const result = await verifyMFA(challengeId, code);

    if (!result.success) {
      return res.status(400).json(result);
    }

    let jwtTokens = null;

    // Generate JWT tokens if requested
    if (includeJWT) {
      try {
        const { generateTokenPair } = await import('../services/jwt_auth.js');
        const { adminAuth } = await import('../services/admin_auth.js');

        const sessionValidation = await adminAuth.validateSession(result.sessionId!);
        if (sessionValidation.valid && sessionValidation.session) {
          jwtTokens = await generateTokenPair(
            result.sessionId!,
            sessionValidation.session.adminId,
            sessionValidation.session.permissions,
            req
          );
        }
      } catch (jwtError) {
        console.warn('JWT token generation failed:', jwtError);
        // Continue without JWT tokens - don't fail the whole request
      }
    }

    const response: any = {
      success: true,
      sessionId: result.sessionId,
      message: 'MFA verification successful'
    };

    if (jwtTokens) {
      response.tokens = jwtTokens;
      response.message += ' (JWT tokens included)';
    }

    // Mark session fingerprint as verified after successful MFA
    try {
      const { markSessionAsVerified } = await import('../services/session_fingerprinting.js');
      markSessionAsVerified(result.sessionId!);
    } catch (error) {
      // Non-critical - don't fail the request
      console.warn('Failed to mark session fingerprint as verified:', error);
    }

    res.json(response);

  } catch (error: any) {
    console.error('MFA verification error:', error);
    res.status(500).json({ success: false, error: 'MFA verification error' });
  }
});

// JWT-specific authentication endpoints
adminRouter.post('/auth/jwt/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshAccessToken } = await import('../services/jwt_auth.js');
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token required',
        code: 'MISSING_REFRESH_TOKEN'
      });
    }

    const result = await refreshAccessToken(refreshToken, req);

    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: result.error,
        code: 'REFRESH_FAILED'
      });
    }

    res.json({
      success: true,
      tokens: result.tokenPair,
      message: 'Access token refreshed successfully'
    });

  } catch (error: any) {
    console.error('JWT refresh error:', error);
    res.status(500).json({ success: false, error: 'Token refresh system error' });
  }
});

adminRouter.post('/auth/jwt/logout', async (req: Request, res: Response) => {
  try {
    const { revokeRefreshToken, revokeAllTokensForSession } = await import('../services/jwt_auth.js');
    const { refreshToken, sessionId, revokeAllSessions } = req.body;

    let revokedCount = 0;

    if (revokeAllSessions && sessionId) {
      // Revoke all refresh tokens for the session
      revokedCount = revokeAllTokensForSession(sessionId);
    } else if (refreshToken) {
      // Revoke specific refresh token
      const revoked = revokeRefreshToken(refreshToken);
      revokedCount = revoked ? 1 : 0;
    }

    res.json({
      success: true,
      revokedCount,
      message: revokedCount > 0 ?
        `Successfully revoked ${revokedCount} token(s)` :
        'No tokens were revoked'
    });

  } catch (error: any) {
    console.error('JWT logout error:', error);
    res.status(500).json({ success: false, error: 'Logout system error' });
  }
});

adminRouter.get('/auth/jwt/stats', async (req: Request, res: Response) => {
  try {
    // Simple bearer auth check for stats endpoint
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Bearer token required for JWT stats',
        code: 'MISSING_BEARER'
      });
    }

    const token = authHeader.substring(7);
    const adminSecret = getSecureAdminSecret();
    if (token !== adminSecret) {
      return res.status(401).json({
        success: false,
        error: 'Invalid bearer token',
        code: 'INVALID_BEARER'
      });
    }

    const { getRefreshTokenStats } = await import('../services/jwt_auth.js');
    const stats = getRefreshTokenStats();

    res.json({
      success: true,
      stats: {
        ...stats,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('JWT stats error:', error);
    res.status(500).json({ success: false, error: 'Stats system error' });
  }
});

adminRouter.get('/security/fingerprint/stats', async (req: Request, res: Response) => {
  try {
    // Simple bearer auth check for security endpoint
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Bearer token required for security stats',
        code: 'MISSING_BEARER'
      });
    }

    const token = authHeader.substring(7);
    const adminSecret = getSecureAdminSecret();
    if (token !== adminSecret) {
      return res.status(401).json({
        success: false,
        error: 'Invalid bearer token',
        code: 'INVALID_BEARER'
      });
    }

    const { getSuspiciousActivityStats } = await import('../services/session_fingerprinting.js');
    const stats = getSuspiciousActivityStats();

    res.json({
      success: true,
      stats: {
        ...stats,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('Fingerprint stats error:', error);
    res.status(500).json({ success: false, error: 'Security stats system error' });
  }
});

// Anomaly detection statistics endpoint
adminRouter.get('/security/anomaly/stats', async (req: Request, res: Response) => {
  try {
    // Simple bearer auth check for security endpoint
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Bearer token required for anomaly stats',
        code: 'MISSING_BEARER'
      });
    }

    const token = authHeader.substring(7);
    const adminSecret = getSecureAdminSecret();
    if (token !== adminSecret) {
      return res.status(401).json({
        success: false,
        error: 'Invalid bearer token',
        code: 'INVALID_BEARER'
      });
    }

    const { getAnomalyStats } = await import('../services/anomaly_detection.js');
    const stats = getAnomalyStats();

    res.json({
      success: true,
      stats: {
        ...stats,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('Anomaly stats error:', error);
    res.status(500).json({ success: false, error: 'Anomaly stats system error' });
  }
});

// Resolve anomaly alert endpoint
adminRouter.post('/security/anomaly/resolve/:alertId', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Bearer token required',
        code: 'MISSING_BEARER'
      });
    }

    const token = authHeader.substring(7);
    const adminSecret = getSecureAdminSecret();
    if (token !== adminSecret) {
      return res.status(401).json({
        success: false,
        error: 'Invalid bearer token',
        code: 'INVALID_BEARER'
      });
    }

    const { alertId } = req.params;
    const { falsePositive = false } = req.body;

    const { resolveAnomalyAlert } = await import('../services/anomaly_detection.js');
    const resolved = resolveAnomalyAlert(alertId, falsePositive);

    if (!resolved) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found'
      });
    }

    res.json({
      success: true,
      message: falsePositive ? 'Alert marked as false positive' : 'Alert resolved',
      alertId
    });

  } catch (error: any) {
    console.error('Resolve anomaly alert error:', error);
    res.status(500).json({ success: false, error: 'Alert resolution system error' });
  }
});

// Get user behavioral profile endpoint
adminRouter.get('/security/anomaly/profile/:userId', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Bearer token required',
        code: 'MISSING_BEARER'
      });
    }

    const token = authHeader.substring(7);
    const adminSecret = getSecureAdminSecret();
    if (token !== adminSecret) {
      return res.status(401).json({
        success: false,
        error: 'Invalid bearer token',
        code: 'INVALID_BEARER'
      });
    }

    const { userId } = req.params;
    const { getUserBehaviorProfile } = await import('../services/anomaly_detection.js');
    const profile = getUserBehaviorProfile(userId);

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'User profile not found'
      });
    }

    // Remove sensitive data and truncate large arrays for API response
    const safeProfile = {
      userId: profile.userId.slice(0, 8) + '...', // Anonymize user ID
      patterns: {
        loginTimes: profile.patterns.loginTimes.slice(-20), // Last 20 login times
        commandFrequency: Object.keys(profile.patterns.commandFrequency).length > 20
          ? Object.fromEntries(
              Object.entries(profile.patterns.commandFrequency)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 20)
            )
          : profile.patterns.commandFrequency,
        ipAddresses: profile.patterns.ipAddresses.slice(-10), // Last 10 IPs
        userAgents: profile.patterns.userAgents.slice(-5), // Last 5 user agents
        geographicRegions: profile.patterns.geographicRegions.slice(-10), // Last 10 regions
        financialActivity: profile.patterns.financialActivity
      },
      riskFactors: profile.riskFactors,
      lastUpdated: profile.lastUpdated,
      createdAt: profile.createdAt
    };

    res.json({
      success: true,
      profile: safeProfile
    });

  } catch (error: any) {
    console.error('Get user profile error:', error);
    res.status(500).json({ success: false, error: 'Profile system error' });
  }
});

// Reset user behavioral profile endpoint (admin function)
adminRouter.delete('/security/anomaly/profile/:userId', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Bearer token required',
        code: 'MISSING_BEARER'
      });
    }

    const token = authHeader.substring(7);
    const adminSecret = getSecureAdminSecret();
    if (token !== adminSecret) {
      return res.status(401).json({
        success: false,
        error: 'Invalid bearer token',
        code: 'INVALID_BEARER'
      });
    }

    const { userId } = req.params;
    const { resetUserBehaviorProfile } = await import('../services/anomaly_detection.js');
    const reset = resetUserBehaviorProfile(userId);

    if (!reset) {
      return res.status(404).json({
        success: false,
        error: 'User profile not found'
      });
    }

    res.json({
      success: true,
      message: 'User behavioral profile reset',
      userId: userId.slice(0, 8) + '...' // Anonymize in response
    });

  } catch (error: any) {
    console.error('Reset user profile error:', error);
    res.status(500).json({ success: false, error: 'Profile reset system error' });
  }
});

// Simple ping endpoint for admin auth verification
adminRouter.get('/ping', (req: Request, res: Response) => {
  try {
    // Check Bearer token authentication using secure credential
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const adminSecret = getSecureAdminSecret();
      if (token === adminSecret) {
        return res.json({ ok: true, message: 'Authenticated' });
      }
    }

    res.status(401).json({ ok: false, error: 'Invalid admin secret' });
  } catch (error) {
    console.error('Admin ping authentication error:', error);
    res.status(500).json({ ok: false, error: 'Authentication system error' });
  }
});

// CSRF token generation endpoint (requires admin auth)
adminRouter.get('/csrf-token', (req: Request, res: Response) => {
  try {
    // Check Bearer token authentication first using secure credential
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Admin authentication required' });
    }

    const token = authHeader.substring(7);
    const adminSecret = getSecureAdminSecret();
    if (token !== adminSecret) {
      return res.status(401).json({ error: 'Invalid admin secret' });
    }

    // Generate session-bound CSRF token with optional user binding
    const sessionId = req.sessionID;
    const userId = req.session?.discordId; // For admin panel, we might have Discord user ID from OAuth
    const csrf = generateCSRFToken(sessionId, userId);

    // Set secure CSRF cookie for Double Submit Cookie pattern
    res.cookie('csrf-token', csrf.token, {
      httpOnly: true,
      secure: req.secure || req.get('X-Forwarded-Proto') === 'https',
      sameSite: 'strict',
      maxAge: 3600000, // 1 hour in ms
      path: '/admin'
    });

    const bindingInfo = [];
    if (sessionId) bindingInfo.push('session');
    if (userId) bindingInfo.push('user');
    const bindingStr = bindingInfo.length > 0 ? ` (bound to ${bindingInfo.join(', ')})` : '';

    res.json({
      ok: true,
      token: csrf.token,
      secret: csrf.secret,
      expiresIn: 3600000, // 1 hour in ms
      usage: 'Include token in X-CSRF-Token header and secret in X-CSRF-Secret header for state-changing requests',
      doubleSubmit: 'CSRF token also set as secure cookie for enhanced protection',
      binding: `Token is bound to current session for maximum security${bindingStr}`
    });
  } catch (error) {
    console.error('CSRF token generation error:', error);
    res.status(500).json({ error: 'CSRF token generation failed' });
  }
});

// CSRF statistics endpoint (requires admin auth)
adminRouter.get('/csrf-stats', (req: Request, res: Response) => {
  try {
    // Check Bearer token authentication first using secure credential
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Admin authentication required' });
    }

    const token = authHeader.substring(7);
    const adminSecret = getSecureAdminSecret();
    if (token !== adminSecret) {
      return res.status(401).json({ error: 'Invalid admin secret' });
    }

    const stats = getCSRFStats();

    res.json({
      ok: true,
      ...stats,
      averageAgeMinutes: Math.round(stats.averageAge / 60000),
      oldestTokenMinutes: Math.round(stats.oldestToken / 60000)
    });
  } catch (error) {
    console.error('CSRF stats error:', error);
    res.status(500).json({ error: 'CSRF stats retrieval failed' });
  }
});

// Serve admin UI without authentication
adminRouter.get('/', (req: Request, res: Response) => {
  res.redirect('/admin/ui');
});


// Authentication middleware - apply AFTER UI routes
function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // Check Bearer token authentication using secure credential
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const adminSecret = getSecureAdminSecret();
      if (token === adminSecret) {
        return next();
      }
    }

    res.status(401).json({
      error: 'Admin authentication required',
      message: 'Please include Authorization: Bearer <ADMIN_SECRET> header'
    });
  } catch (error) {
    console.error('Admin authentication error:', error);
    res.status(500).json({
      error: 'Authentication system error',
      message: 'Unable to verify admin credentials'
    });
  }
}

// Serve JavaScript files securely
const serveJavaScript = (filename: string) => async (req: Request, res: Response) => {
  try {
    const jsPath = join(dirname(fileURLToPath(import.meta.url)), 'admin', 'js', filename);
    const jsContent = await readFile(jsPath, 'utf-8');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(jsContent);
  } catch (error) {
    console.error(`Failed to serve ${filename}:`, error);
    res.status(500).send(`// ${filename} not found`);
  }
};

// Serve admin JavaScript modules
// adminRouter.get('/ui.js', serveJavaScript('ui.js')); // Commented out - duplicate route already exists above
adminRouter.get('/security.js', serveJavaScript('security.js'));
adminRouter.get('/validation.js', serveJavaScript('validation.js'));
adminRouter.get('/ui-secure-helpers.js', serveJavaScript('ui-secure-helpers.js'));
adminRouter.get('/tokens.js', serveJavaScript('tokens.js'));
adminRouter.get('/core.js', serveJavaScript('core.js'));
adminRouter.get('/fees.js', serveJavaScript('fees.js'));
adminRouter.get('/dashboard.js', serveJavaScript('dashboard.js'));

/* ------------------------------------------------------------------------ */
/*                              Route Modules                               */
/* ------------------------------------------------------------------------ */

// Mount route modules
// Mount API route modules with selective authentication and CSRF protection
// Note: ping endpoint needs to be excluded from auth since it's used for auth verification
adminRouter.use((req: Request, res: Response, next: NextFunction) => {
  // Skip auth for specific endpoints and JavaScript modules
  const publicPaths = [
    '/ping', '/ui', '/ui.js', '/', '/modular',
    '/security.js', '/validation.js', '/ui-secure-helpers.js',
    '/tokens.js', '/core.js', '/fees.js', '/dashboard.js',
    '/ads.js', '/tiers.js', '/tournaments.js', '/config.js', '/servers.js', '/treasury.js', '/fees-data.js'
  ];

  // Skip auth for public paths
  if (publicPaths.includes(req.path)) {
    return next();
  }

  // Apply admin authentication first
  const authResult = requireAuth(req, res, (error?: any) => {
    if (error) {
      return next(error);
    }

    // After successful auth, apply CSRF protection for state-changing operations
    // Skip CSRF for auth endpoints and read-only operations
    const skipCSRFPaths = [
      '/csrf-token', '/csrf-stats', '/auth/login', '/auth/mfa/initiate', '/auth/mfa/verify',
      '/auth/jwt/refresh', '/auth/jwt/logout', '/auth/jwt/stats', '/security/fingerprint/stats'
    ];

    if (skipCSRFPaths.some(path => req.path.endsWith(path)) || req.method === 'GET') {
      return next();
    }

    // Apply CSRF verification for POST, PUT, DELETE, PATCH operations
    return verifyCSRFToken(req, res, next);
  });

  return authResult;
});

adminRouter.use(configRouter);
adminRouter.use(tokensRouter);
adminRouter.use(serversRouter);
adminRouter.use(serverApplicationsRouter);
adminRouter.use(channelsRouter);
adminRouter.use(adsRouter);
adminRouter.use(tiersRouter);
adminRouter.use("/achievements", achievementAdminRouter);
adminRouter.use(usersRouter);
adminRouter.use(transactionsRouter);
adminRouter.use(groupTipsRouter);
adminRouter.use(systemRouter);
// adminRouter.use(backupRouter); // Disabled due to environment issues
adminRouter.use(statsRouter);
adminRouter.use(pengubookRouter);
adminRouter.use("/role-tax", roleTaxRouter);
adminRouter.use("/role-rake", roleRakeRouter);
adminRouter.use("/resources", resourcesRouter);
adminRouter.use("/good-knight", goodKnightWebhooksRouter);
adminRouter.use("/tier-roles", tierRolesRouter);
adminRouter.use("/treasury-safety", treasurySafetyRouter);
adminRouter.use(predictionMarketsRouter);
adminRouter.use("/automation", automationAdminRouter);
adminRouter.use("/pipchips", pipchipsAdminRouter);
adminRouter.use("/tournaments", tournamentsRouter);
adminRouter.use(adminMarketsRouter);

// Cancel non-API markets endpoint
adminRouter.post("/cancel-non-api-markets", cancelNonApiMarkets);

/* ------------------------------------------------------------------------ */
/*                          Remaining Direct Routes                         */
/* ------------------------------------------------------------------------ */

// Treasury endpoint with USD values
adminRouter.get("/treasury", async (req: Request, res: Response) => {
  try {
    const force = req.query.force === "1";
    const snapshot = await getTreasurySnapshot(force);

    // Get real-time USD prices from DexTools/CoinGecko/CMC
    const tokenSymbols = snapshot.tokens.map(token => token.symbol);
    const priceResult = await priceAPI.getTokenPrices(tokenSymbols);

    // Add USD value estimates to each token
    const tokensWithUSD = snapshot.tokens.map(token => {
      const price = priceResult.prices[token.symbol] || 0.001; // fallback
      const balanceHuman = parseFloat(token.human);
      const estimatedUSD = balanceHuman * price;

      return {
        ...token,
        priceUSD: price,
        estimatedUSD: estimatedUSD,
        formattedUSD: `$${estimatedUSD.toFixed(2)}`,
        priceSource: priceResult.source
      };
    });

    // Calculate total treasury USD value
    const totalTreasuryUSD = tokensWithUSD.reduce((sum, token) => sum + token.estimatedUSD, 0);

    res.json({
      ok: true,
      ...snapshot,
      tokens: tokensWithUSD,
      totalTreasuryUSD,
      formattedTotalUSD: `$${totalTreasuryUSD.toFixed(2)}`,
      priceDisclaimer: `USD values from ${priceResult.source.toUpperCase()}${priceResult.source === 'fallback' ? ' (estimates only)' : ' (live prices)'}`
    });
  } catch (error) {
    console.error("Failed to load treasury:", error);
    res.status(500).json({ ok: false, error: "Failed to load treasury" });
  }
});

// Fees by server endpoint
adminRouter.get("/fees/by-server", async (req: Request, res: Response) => {
  try {
    const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const until = req.query.until ? new Date(req.query.until as string) : new Date();
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
    const tokenMap = new Map<number, string>(tokens.map(t => [t.id, t.symbol]));

    const rows = transactions.map(tr => ({
      guildId: tr.guildId || "Unknown",
      token: tr.tokenId ? (tokenMap.get(tr.tokenId) ?? `Token#${tr.tokenId}`) : "Unknown",
      tipFees: tr._sum.fee || 0,
      matchRake: tr._sum.amount || 0
    }));

    res.json({ ok: true, rows });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load fees" });
  }
});

// CSV export for fees
adminRouter.get("/fees/export.csv", async (req: Request, res: Response) => {
  try {
    const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const until = req.query.until ? new Date(req.query.until as string) : new Date();
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
    const tokenMap = new Map<number, string>(tokens.map(t => [t.id, t.symbol]));

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
  } catch {
    res.status(500).json({ ok: false, error: "Failed to export CSV" });
  }
});

// Favicon route to prevent 404 errors
adminRouter.get("/favicon.ico", (_req: Request, res: Response) => {
  // Return a simple 1x1 transparent PNG
  const favicon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
  res.send(favicon);
});

