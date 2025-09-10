// src/index.ts
import "dotenv/config";
import express from "express";
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
import { adminRouter } from "./web/admin.js";

import pipWithdraw from "./commands/pip_withdraw.js";
import pipLink from "./commands/pip_link.js";
import pipRegister from "./commands/pip_register.js";
import pipProfile from "./commands/pip_profile.js";
import pipDeposit from "./commands/pip_deposit.js";
import pipStart from "./commands/pip_start.js";
import pipTip from "./commands/pip_tip.js";
import { handlePipButton } from "./interactions/pip_buttons.js";
import { handleGroupTipButton } from "./interactions/group_tip_buttons.js";
import { restoreGroupTipExpiryTimers } from "./features/group_tip_expiry.js";

// shared command defs + registrar
import { getCommandsJson } from "./services/commands_def.js";
import { registerCommandsForApprovedGuilds } from "./services/command_registry.js";
import { getActiveTokens } from "./services/token.js";

const TOKEN = process.env.DISCORD_TOKEN!;
const PORT = Number(process.env.PORT || 3000);

// ---------- Express (REST) ----------
const app = express();
app.use(express.json({ limit: "256kb" }));
app.use("/health", healthRouter);
app.use("/internal", internalRouter);
app.use("/admin", adminRouter);

// ---------- Discord bot ----------
const bot = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- Auto-ACK wrapper: prevents Discord timeouts globally ---
function withAutoAck(fn: (i: Interaction) => Promise<any>) {
  return async (i: Interaction) => {
    // auto-defer after 2s if nothing replied yet
    const timer = setTimeout(async () => {
      if ("deferred" in i && !i.deferred && "replied" in i && !i.replied && "deferReply" in i) {
        try { await (i as any).deferReply({ ephemeral: true }); } catch (error) {
          console.error("Auto-defer failed:", error);
        }
      }
    }, 2000);

    try {
      // run your actual handler (the big switch)
      await fn(i);

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
              await (i as any).reply({ content: `Error: ${err?.message || err}`, ephemeral: true });
            }
          }
        } catch (replyError) {
          console.error("Error reply failed:", replyError);
        }
      }
    } finally {
      clearTimeout(timer);
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
    const tokens = await getActiveTokens(); // [{ symbol, address, decimals, active: true }, ...]
    const q = String(focused.value || "").toLowerCase();

    const filtered = tokens
      .filter(t =>
        t.symbol.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
      )
      .slice(0, 25); // Discord limit

    await i.respond(
      filtered.map(t => ({
        name: `${t.symbol} (${t.address.slice(0, 8)}...)`,
        value: t.address, // handler will receive address in options.getString("token")
      }))
    );
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
        ephemeral: true,
      }).catch(() => {});
    }
    return;
  }

  // ↓↓↓ FLUSH EPHEMERAL NOTICES RIGHT BEFORE COMMAND ROUTING ↓↓↓
  if ("isChatInputCommand" in i && (i as any).isChatInputCommand()) {
    // fire-and-forget: delivers queued account notices as an ephemeral message
    switch ((i as any).commandName) {
      case "pip_register": return pipRegister(i as any);
      case "pip_withdraw": return pipWithdraw(i as any);
      case "pip_profile":  return pipProfile(i as any);
      case "pip_deposit":  return pipDeposit(i as any);
      case "pip_start":    return pipStart(i as any);
      case "pip_link":     return pipLink(i as any);
      case "pip_tip":      return pipTip(i as any);
      default:
        console.warn("Unknown command:", (i as any).commandName);
    }
  }

  // Buttons (unchanged)
  if ("isButton" in i && (i as any).isButton()) {
    const customId = (i as any).customId;
    if (customId.startsWith("pip:"))      return handlePipButton(i as any);
    if (customId.startsWith("grouptip:")) return handleGroupTipButton(i as any);
    console.warn("Unknown button interaction:", customId);
  }
}));

bot.once(Events.ClientReady, async () => {
  console.log(`Bot logged in as ${bot.user?.tag}`);
  try {
    await restoreGroupTipExpiryTimers(bot);
    console.log("Group tip timers restored");
  } catch (error) {
    console.error("Failed to restore group tip timers:", error);
  }
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

    // Register slash commands to all approved guilds (or fallback)
    const cmds = getCommandsJson();
    await registerCommandsForApprovedGuilds(cmds);
    console.log("Commands registered");

    await bot.login(TOKEN);
    console.log("Bot login initiated");

    const server = app.listen(PORT, () => {
      console.log(`Web server running on port ${PORT}`);
    });

    const shutdown = () => {
      console.log("Shutting down...");
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