// src/index.ts
import "dotenv/config";
import express, { Request, Response } from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import cors from "cors";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import { flushNoticesEphemeral } from "./services/notifier.js";
import {
  Client,
  GatewayIntentBits,
  Events,
  type Interaction,
} from "discord.js";

import { ensurePrisma, prisma } from "./services/db.js";
import { healthRouter } from "./web/health.js";
import { internalRouter } from "./web/internal.js";

import pipWithdraw from "./commands/pip_withdraw.js";
import pipLink from "./commands/pip_link.js";
import pipProfile from "./commands/pip_profile.js";
import pipDeposit from "./commands/pip_deposit.js";
import pipGame from "./commands/pip_game.js";
import pipTip from "./commands/pip_tip.js";
import pipHelp from "./commands/pip_help.js";
import pipStats from "./commands/pip_stats.js";
import pipBio from "./commands/pip_bio.js";
import pipPenguBook from "./commands/pip_pengubook.js";
import pipAchievements from "./commands/pip_achievements.js";
import pipLeaderboard from "./commands/pip_leaderboard.js";
import pipApply from "./commands/pip_apply.js";
import pipSettings from "./commands/pip_settings.js";
import pipSafety from "./commands/pip_safety.js";
import pipBalance from "./commands/pip_balance.js";
import pipDaily from "./commands/pip_daily.js";
import pipBuyChips from "./commands/pip_buy_chips.js";
import pipAutomationStatus from "./commands/pip_automation_status.js";
import pipReferral from "./commands/pip_referral.js";
import { withAutoChannelCheck } from "./middleware/channel_check.js";
import { handlePipButton } from "./interactions/pip_buttons.js";
import { handleGroupTipButton } from "./interactions/group_tip_buttons.js";
import { handleGroupTipModal } from "./interactions/group_tip_modal.js";
import { isButtonInteraction, isModalSubmitInteraction } from "./discord/guards.js";
import { restoreGroupTipExpiryTimers } from "./features/group_tip_expiry.js";
import { TierRoleSyncService } from "./services/tier_role_manager.js";
import { MembershipExpiryService } from "./services/membership_expiry_service.js";
import { marketAutomation } from "./services/market_automation.js";
import { marketAutomationScheduler } from "./services/market_automation_scheduler.js";

// shared command defs + registrar
import { getCommandsJson } from "./services/commands_def.js";
import { registerCommandsForApprovedGuilds } from "./services/command_registry.js";
import { getActiveTokens } from "./services/token.js";
import { setDiscordClient } from "./services/discord_users.js";
// import { backupService } from "./services/backup.js"; // Disabled - using external cron job

const TOKEN = process.env.DISCORD_TOKEN!;
// Replit compatibility: Use port 5000 if in Replit environment
const PORT = Number(process.env.PORT || (process.env.REPLIT_DB_URL ? 5000 : 3000));

// ---------- Express (REST) ----------
const app = express();

// Trust proxy for Railway/Heroku-style deployments
if (process.env.NODE_ENV === "production") {
  app.set('trust proxy', 1);
  console.log("✅ Trust proxy enabled for production");
}

// Global rate limiting middleware
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please wait before making more requests.',
    retryAfter: Math.ceil(15 * 60) // 15 minutes in seconds
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for health checks and internal endpoints
    return req.path.startsWith('/health') ||
           req.path.startsWith('/internal') ||
           req.path === '/favicon.ico';
  },
  keyGenerator: (req, res) => {
    // Use express-rate-limit's IPv6-compatible helper
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ip = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0].trim();
      return ipKeyGenerator(ip);
    }
    return ipKeyGenerator(req.ip || req.socket.remoteAddress || 'anonymous');
  }
});

// Apply global rate limiting
app.use(globalLimiter);

// CORS configuration for API endpoints
const corsOptions = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    // Production whitelist
    const allowedOrigins = [
      'https://piptip.app',
      'https://www.piptip.app',
      'https://admin.piptip.app',
      'https://piptip-production.up.railway.app'
    ];

    // Development mode - allow localhost and common dev ports
    if (process.env.NODE_ENV !== 'production') {
      allowedOrigins.push(
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:8000',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:8000'
      );
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`🚫 CORS: Blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS policy'), false);
    }
  },
  credentials: true, // Allow cookies and authorization headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-CSRF-Token',
    'X-CSRF-Secret',
    'Cookie'
  ],
  exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  maxAge: 86400 // Cache preflight for 24 hours
});

// Apply CORS to API endpoints only
app.use('/api', corsOptions);
app.use('/admin/api', corsOptions);
app.use('/internal', corsOptions);

app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

// Session middleware for OAuth - will be configured in main()
let sessionMiddleware: any;

// Favicon route to prevent 404 errors
app.get("/favicon.ico", (_req: Request, res: Response) => {
  // Return a simple 1x1 transparent PNG
  const favicon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
  res.send(favicon);
});

// Routes that don't need sessions
app.use("/health", healthRouter);
app.use("/internal", internalRouter);

// Session-dependent routes will be added after session middleware is configured in main()

// Replit-friendly landing page
app.get("/", (req: Request, res: Response) => {
  const isReplit = !!(process.env.REPL_ID || process.env.REPL_SLUG || process.env.REPLIT_DB_URL);
  const botStatus = bot.user ? 'Online' : 'Starting...';

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PIPTip Bot ${isReplit ? '- Replit Production' : '- Server'}</title>
  <style>
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      margin: 0; padding: 40px 20px; min-height: 100vh; color: white;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
    }
    .container {
      background: rgba(255,255,255,0.1); backdrop-filter: blur(10px);
      border-radius: 20px; padding: 40px; max-width: 600px; text-align: center;
      border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 20px 40px rgba(0,0,0,0.1);
    }
    h1 { margin: 0 0 20px; font-size: 3em; font-weight: 300; }
    .status {
      display: inline-flex; align-items: center; padding: 12px 24px;
      background: ${botStatus === 'Online' ? '#10b981' : '#f59e0b'};
      border-radius: 25px; margin: 20px 0; font-weight: 600;
    }
    .status::before {
      content: '${botStatus === 'Online' ? '🟢' : '🟡'}'; margin-right: 8px;
    }
    .links { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 30px; }
    .link {
      background: rgba(255,255,255,0.15); padding: 20px; border-radius: 12px;
      text-decoration: none; color: white; border: 1px solid rgba(255,255,255,0.2);
      transition: all 0.3s ease; display: flex; flex-direction: column; align-items: center;
    }
    .link:hover {
      background: rgba(255,255,255,0.25); transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(0,0,0,0.1);
    }
    .link-title { font-size: 1.2em; font-weight: 600; margin-bottom: 8px; }
    .link-desc { font-size: 0.9em; opacity: 0.8; }
    .tech-stack {
      margin-top: 40px; font-size: 0.9em; opacity: 0.8;
      display: flex; flex-wrap: wrap; justify-content: center; gap: 16px;
    }
    .tech-badge {
      background: rgba(255,255,255,0.1); padding: 6px 12px; border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.2);
    }
    ${isReplit ? '.replit-badge { background: #ff7f00; color: white; padding: 4px 12px; border-radius: 12px; font-size: 0.8em; font-weight: 600; margin-bottom: 20px; }' : ''}
  </style>
</head>
<body>
  <div class="container">
    ${isReplit ? '<div class="replit-badge">🚀 Running on Replit</div>' : ''}
    <h1>🐧 PIPTip</h1>
    <p>Multi-token Discord tipping bot for Abstract Chain</p>

    <div class="status">Bot Status: ${botStatus}</div>

    <div class="links">
      <a href="/admin/ui" class="link">
        <div class="link-title">🛠️ Admin Panel</div>
        <div class="link-desc">Manage tokens, users, and settings</div>
      </a>
      <a href="/admin/modular" class="link">
        <div class="link-title">🔧 Modular Admin</div>
        <div class="link-desc">Streamlined admin interface with focused modules</div>
      </a>
      <a href="/pengubook" class="link">
        <div class="link-title">📖 PenguBook</div>
        <div class="link-desc">Social profiles and discovery</div>
      </a>
      <a href="/health" class="link">
        <div class="link-title">💚 Health Check</div>
        <div class="link-desc">System status and diagnostics</div>
      </a>
    </div>

    <div class="tech-stack">
      <span class="tech-badge">Discord.js</span>
      <span class="tech-badge">TypeScript</span>
      <span class="tech-badge">Express</span>
      <span class="tech-badge">Prisma</span>
      <span class="tech-badge">Abstract Chain</span>
      ${isReplit ? '<span class="tech-badge">Replit Ready</span>' : ''}
    </div>
  </div>

  <script>
    // Auto-refresh every 30 seconds to show bot status updates
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`);
});

// Static CSS route for PenguBook enhanced styles
app.get("/static/pengubook.css", (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/css');
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  res.sendFile(path.join(process.cwd(), 'src/web/static/pengubook.css'));
});

// ---------- Discord bot ----------
const bot = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- Auto-ACK wrapper: prevents Discord timeouts globally ---
function withAutoAck(fn: (i: Interaction) => Promise<any>) {
  return async (i: Interaction) => {
    let timerCleared = false;

    // Skip auto-defer for interactions that might show modals
    const skipAutoDefer = isButtonInteraction(i) &&
      (i.customId.includes("grouptip:add") || i.customId.includes("_add") ||
       i.customId.includes("grouptip:confirm") || i.customId.includes("grouptip:cancel"));

    // auto-defer after 1.5s if nothing replied yet (optimized for faster perceived response)
    const timer = skipAutoDefer ? null : setTimeout(async () => {
      if (!timerCleared && "deferred" in i && !i.deferred && "replied" in i && !i.replied && "deferReply" in i) {
        try { await (i as any).deferReply({ flags: 64 }); } catch (error) {
          // Silently ignore auto-defer failures since they're usually due to race conditions
        }
      }
    }, 1500);

    try {
      // run your actual handler (the big switch)
      await fn(i);
      
      // Clear timer immediately after handler completes
      timerCleared = true;
      if (timer) clearTimeout(timer);

      // ✅ after the handler has replied/deferred, flush notices as an ephemeral follow-up
      if ("isChatInputCommand" in i && (i as any).isChatInputCommand()) {
        await flushNoticesEphemeral(i as any).catch(() => {});
      }
    } catch (err: any) {
      console.error("Handler error:", err);
      if ("isRepliable" in i && (i as any).isRepliable()) {
        try {
          if ("deferred" in i && "replied" in i) {
            if ((i as any).deferred || (i as any).replied) {
              await (i as any).editReply({ content: `Error: ${err?.message || err}` });
            } else {
              await (i as any).reply({ content: `Error: ${err?.message || err}`, flags: 64 });
            }
          }
        } catch (replyError) {
          console.error("Error reply failed:", replyError);
        }
      }
    } finally {
      timerCleared = true;
      if (timer) clearTimeout(timer);
    }
  };
}


// Gate interactions to approved guilds (DMs allowed but your cmds are guild-only)
async function isGuildApproved(guildId: string | null): Promise<boolean> {
  if (!guildId) return true;
  try {
    const row = await prisma.approvedServer.findFirst({
      where: { guildId, enabled: true },
      select: { id: true },
    });
    return !!row;
  } catch (error) {
    console.error("Guild approval check failed:", error);
    return false;
  }
}

// Check if user is banned from PIPTip
async function isUserBanned(discordId: string): Promise<{ banned: boolean; reason?: string }> {
  try {
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: { isBanned: true, bannedReason: true }
    });
    
    if (user?.isBanned) {
      return { banned: true, reason: user.bannedReason || "No reason provided" };
    }
    
    return { banned: false };
  } catch (error) {
    console.error("Ban check failed:", error);
    return { banned: false }; // Allow on error to prevent false positives
  }
}


// Handle autocomplete for token selection
// Simple visibility logs to trace flow (LOGGING ONLY)
bot.on(Events.InteractionCreate, (i: Interaction) => {
  if ("isChatInputCommand" in i && (i as any).isChatInputCommand()) {
    console.log("[CMD]", (i as any).commandName, "from", (i as any).user?.id, "in", (i as any).guildId);
  }
});

// Handle autocomplete for token selection (unchanged)
bot.on(Events.InteractionCreate, async (i: Interaction) => {
  if (!i.isAutocomplete()) return;

  const focused = i.options.getFocused(true);
  // only handle the "token" option
  if (focused.name !== "token") {
    return i.respond([]).catch(() => {});
  }

  try {
    const { tokenCache } = await import("./services/token_cache.js");
    const filtered = await tokenCache.getFilteredTokens(String(focused.value || ""));
    await i.respond(filtered);
  } catch (err) {
    console.error("Autocomplete error (token):", err);
    await i.respond([]).catch(() => {});
  }
});


// Handle commands and buttons (ONLY HERE; wrapped with auto-ack)
bot.on(Events.InteractionCreate, withAutoAck(async (i: Interaction) => {
  const gid = "guildId" in i ? (i as any).guildId : null;

  // Guild allowlist
  if (gid && !(await isGuildApproved(gid))) {
    if ("isRepliable" in i && (i as any).isRepliable()) {
      await (i as any).reply({
        content: "This server isn't approved to use PIPtip yet.",
        flags: 64, // MessageFlags.Ephemeral
      }).catch(() => {});
    }
    return;
  }

  // Ban check
  if ("user" in i && (i as any).user?.id) {
    const banStatus = await isUserBanned((i as any).user.id);
    if (banStatus.banned) {
      if ("isRepliable" in i && (i as any).isRepliable()) {
        await (i as any).reply({
          content: `❌ **You are banned from using PIPTip.**\n\n**Reason:** ${banStatus.reason}\n\nIf you believe this is an error, please contact the administrators.`,
          flags: 64, // MessageFlags.Ephemeral
        }).catch(() => {});
      }
      return;
    }
  }

  // ↓↓↓ REPLIT FIX: Check for expired tips on every interaction ↓↓↓
  // DISABLED - conflicts with native timer system causing duplicate payouts
  // try {
  //   const { checkAndFinalizeExpiredTips } = await import("./services/replit_finalization.js");
  //   // Fire and forget - don't block the interaction
  //   checkAndFinalizeExpiredTips(bot).catch(err =>
  //     console.warn("Self-healing check failed:", err.message)
  //   );
  // } catch (err) {
  //   // Ignore import errors in case service isn't ready
  // }

  // ↓↓↓ FLUSH EPHEMERAL NOTICES RIGHT BEFORE COMMAND ROUTING ↓↓↓
  if ("isChatInputCommand" in i && (i as any).isChatInputCommand()) {
    // fire-and-forget: delivers queued account notices as an ephemeral message

    // Process any pending Discord message updates from expired timers
    try {
      const { processPendingDiscordUpdates } = await import("./features/group_tip_expiry.js");
      processPendingDiscordUpdates(bot).catch(() => {}); // Fire and forget
    } catch (error) {
      // Ignore import errors
    }

    switch ((i as any).commandName) {
      case "pip_withdraw": return withAutoChannelCheck(i as any, pipWithdraw);
      case "pip_profile":  return withAutoChannelCheck(i as any, pipProfile);
      case "pip_deposit":  return withAutoChannelCheck(i as any, pipDeposit);
      case "pip_game":     return withAutoChannelCheck(i as any, pipGame);
      case "pip_link":     return withAutoChannelCheck(i as any, pipLink);
      case "pip_tip":      return withAutoChannelCheck(i as any, pipTip);
      case "pip_help":     return withAutoChannelCheck(i as any, pipHelp);
      case "pip_stats":    return withAutoChannelCheck(i as any, pipStats);
      case "pip_bio":      return withAutoChannelCheck(i as any, pipBio);
      case "pip_pengubook": return withAutoChannelCheck(i as any, pipPenguBook);
      case "pip_achievements": return withAutoChannelCheck(i as any, pipAchievements);
      case "pip_leaderboard": return withAutoChannelCheck(i as any, pipLeaderboard);
      case "pip_apply": return withAutoChannelCheck(i as any, pipApply);
      case "pip_settings": return withAutoChannelCheck(i as any, pipSettings);
      case "pip_safety": return withAutoChannelCheck(i as any, pipSafety);
      case "pip_balance": return withAutoChannelCheck(i as any, pipBalance);
      case "pip_daily": return withAutoChannelCheck(i as any, pipDaily);
      case "pip_buy_chips": return withAutoChannelCheck(i as any, pipBuyChips);
      case "pip_automation_status": return withAutoChannelCheck(i as any, pipAutomationStatus);
      case "pip_referral": return withAutoChannelCheck(i as any, pipReferral);
      default:
        console.warn("Unknown command:", (i as any).commandName);
    }
  }

  // Button interactions
  if (isButtonInteraction(i)) {
    const customId = i.customId;
    if (customId.startsWith("pip:"))      return handlePipButton(i);
    if (customId.startsWith("grouptip:")) return handleGroupTipButton(i);
    console.warn("Unknown button interaction:", customId);
    return;
  }

  // Modal submissions
  if (isModalSubmitInteraction(i)) {
    const customId = i.customId;
    if (customId.startsWith("pip:")) return handlePipButton(i);
    if (customId.startsWith("grouptip_contribute:")) return handleGroupTipModal(i);
    console.warn("Unknown modal interaction:", customId);
    return;
  }
}));

bot.once(Events.ClientReady, async () => {
  console.log(`Bot logged in as ${bot.user?.tag}`);
  
  // Set global client reference for admin routes
  setDiscordClient(bot);

  // Initialize achievement notification system
  try {
    const { initializeNotificationSystem } = await import("./services/notifications.js");
    initializeNotificationSystem(bot);
  } catch (error) {
    console.error("Failed to initialize notification system:", error);
  }

  try {
    await restoreGroupTipExpiryTimers(bot);
    console.log("Group tip timers restored");
  } catch (error) {
    console.error("Failed to restore group tip timers:", error);
  }


  // Initialize resilient Discord update service for reliable message updates
  try {
    const { initializeResilientDiscordUpdates } = await import("./services/resilient_discord_updates.js");
    await initializeResilientDiscordUpdates(bot);
    console.log("Resilient Discord update service initialized");
  } catch (error) {
    console.error("Failed to initialize resilient Discord update service:", error);
  }

  // Initialize prediction market automation
  try {
    marketAutomation.start();
    console.log("Prediction market automation started");
  } catch (error) {
    console.error("Failed to start prediction market automation:", error);
  }

  // Initialize Redis timers for second-precise expiration
  // DISABLED - conflicts with native timer system causing duplicate payouts
  // try {
  //   const { redisTimers } = await import("./services/redis_timers.js");
  //   await redisTimers.initialize(bot);
  //   await redisTimers.restoreActiveTimers();
  //   console.log("Redis timer service initialized");
  // } catch (error) {
  //   console.error("Failed to initialize Redis timers:", error);
  // }

  // Start periodic health monitoring
  try {
    const { healthMonitor } = await import("./services/health_monitor.js");
    healthMonitor.startPeriodicHealthChecks();
    console.log("Health monitoring started");
  } catch (error) {
    console.error("Failed to start health monitoring:", error);
  }

  // Start tier role management and membership expiry services
  try {
    TierRoleSyncService.startPeriodicSync();
    MembershipExpiryService.startPeriodicCleanup();
    console.log("Tier management services started");
  } catch (error) {
    console.error("Failed to start tier management services:", error);
  }

  // Start market automation scheduler
  try {
    marketAutomationScheduler.start();
    console.log("Market automation scheduler started");
  } catch (error) {
    console.error("Failed to start market automation scheduler:", error);
  }

  // Start group tip cleanup service to prevent stuck tips
  // DISABLED - conflicts with native timer system that "worked perfectly"
  // try {
  //   const { startCleanupService } = await import("./services/group_tip_cleanup.js");
  //   startCleanupService();
  //   console.log("✅ Group tip cleanup service started");
  // } catch (error) {
  //   console.error("Failed to start group tip cleanup service:", error);
  // }
});

// Global error handlers
process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

async function main() {
  try {
    await ensurePrisma();
    console.log("Database connected");

    // Configure PostgreSQL session store
    const PgSession = connectPgSimple(session);
    const sessionStore = new PgSession({
      conString: process.env.DATABASE_URL,
      tableName: "session",
      createTableIfMissing: true
    });
    console.log("✅ PostgreSQL session store configured");

    sessionMiddleware = session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET || (() => {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('SESSION_SECRET environment variable is required in production');
        }
        console.warn('⚠️ Using fallback session secret in development mode');
        return "fallback-dev-secret-change-this";
      })(),
      resave: false,
      saveUninitialized: false,
      name: 'piptip-session', // Explicit session name
      cookie: {
        secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        sameSite: 'lax', // Use 'lax' for OAuth redirects to work properly
        domain: undefined // Let browser decide
      }
    });

    app.use(sessionMiddleware);
    console.log("✅ Session middleware configured with PostgreSQL store");

    // Add session fingerprinting for security
    try {
      const { fingerprintMiddleware } = await import("./services/session_fingerprinting.js");
      app.use(fingerprintMiddleware());
      console.log("🔍 Session fingerprinting middleware enabled");
    } catch (error) {
      console.error("Failed to initialize session fingerprinting:", error);
    }

    // Initialize anomaly detection service
    try {
      const { anomalyDetection } = await import("./services/anomaly_detection.js");
      // Anomaly detection is passive - no middleware needed, just ensuring service is initialized
      console.log("🧠 Anomaly detection service initialized");
    } catch (error) {
      console.error("Failed to initialize anomaly detection:", error);
    }

    // Add session-dependent routes after session middleware is configured
    const { adminRouter } = await import("./web/admin.js");
    const { authRouter } = await import("./web/auth.js");
    const { serverRouter } = await import("./web/server.js");
    const { pengubookModularRouter } = await import("./web/pengubook/router.js");
    const { marketsApiRouter } = await import("./web/api/markets.js");
    const { default: pipchipsMarketsRouter } = await import("./web/api/pipchips_markets.js");

    app.use("/admin", adminRouter);
    app.use("/auth", authRouter);
    app.use("/server", serverRouter);
    app.use("/pengubook", pengubookModularRouter);
    app.use("/api", marketsApiRouter);
    app.use("/api/pipchips", pipchipsMarketsRouter);

    // Add security dashboard routes
    try {
      const { securityDashboardRouter } = await import("./web/security_dashboard.js");
      const { twoFactorRouter } = await import("./web/2fa_setup.js");
      const { passwordStrengthRouter } = await import("./web/password_strength.js");
      app.use("/security/dashboard", securityDashboardRouter);
      app.use("/security", twoFactorRouter);
      app.use("/security", passwordStrengthRouter);
      console.log("🛡️ Security dashboard routes configured");
    } catch (error) {
      console.error("Failed to load security dashboard routes:", error);
    }

    // Initialize incident notification system
    try {
      const { incidentNotification } = await import("./services/incident_notification.js");
      console.log("🚨 Incident notification system initialized");
    } catch (error) {
      console.error("Failed to initialize incident notification system:", error);
    }

    // Add redirect for common mistyped URL
    app.get("/pipchips", (req, res) => {
      res.redirect("/pengubook/pipchips");
    });

    console.log("✅ Session-dependent routes configured");

    // Backup service disabled - using external cron job with backup-script.js
    // await backupService.start();
    console.log("Backup service: using external cron job");

    // Register slash commands to all approved guilds (or fallback)
    const cmds = getCommandsJson();
    await registerCommandsForApprovedGuilds(cmds);
    console.log("Commands registered");

    await bot.login(TOKEN);
    console.log("Bot login initiated");

    // Validate crypto markets have API guarantees (startup check)
    try {
      const { validateCryptoMarketsOnStartup } = await import('./services/crypto_market_validator.js');
      await validateCryptoMarketsOnStartup();
    } catch (error) {
      console.error("Crypto market validation error:", error);
    }

    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Web server running on 0.0.0.0:${PORT}`);
    });

    const shutdown = async () => {
      console.log("Shutting down...");
      // await backupService.stop(); // Disabled - using external cron job

      // Clean up group tip timers
      try {
        const { clearAllTimers } = await import("./features/group_tip_expiry.js");
        clearAllTimers();
      } catch (error) {
        console.error("Error clearing group tip timers:", error);
      }

      // Clean up rate limiter
      try {
        const { discordRateLimiter } = await import("./services/discord_rate_limiter.js");
        discordRateLimiter.shutdown();
        console.log("🛑 Discord rate limiter shutdown");
      } catch (error) {
        console.error("Error shutting down rate limiter:", error);
      }

      // Session store cleanup handled by express-session

      // Clean up resilient Discord update service
      try {
        const { shutdownResilientDiscordUpdates } = await import("./services/resilient_discord_updates.js");
        await shutdownResilientDiscordUpdates();
        console.log("🛑 Resilient Discord update service shutdown");
      } catch (error) {
        console.error("Error shutting down resilient Discord update service:", error);
      }

      // Clean up token cache
      try {
        const { tokenCache } = await import("./services/token_cache.js");
        tokenCache.shutdown();
      } catch (error) {
        console.error("Error shutting down token cache:", error);
      }

      // Stop group tip cleanup service
      // DISABLED - cleanup service not running
      // try {
      //   const { stopCleanupService } = await import("./services/group_tip_cleanup.js");
      //   stopCleanupService();
      // } catch (error) {
      //   console.error("Error stopping group tip cleanup service:", error);
      // }

      // Stop tier management services
      try {
        TierRoleSyncService.stopPeriodicSync();
        MembershipExpiryService.stopPeriodicCleanup();
        console.log("🛑 Tier management services stopped");
      } catch (error) {
        console.error("Error stopping tier management services:", error);
      }

      // Stop market automation scheduler
      try {
        marketAutomationScheduler.stop();
        console.log("🛑 Market automation scheduler stopped");
      } catch (error) {
        console.error("Error stopping market automation scheduler:", error);
      }

      server.close(() => {
        bot.destroy();
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("Failed to start application:", error);
    process.exit(1);
  }
}

main();