// src/index.ts
import "dotenv/config";
import express from "express";
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
    // Start a 2s timer; if no reply yet, defer ephemeral to buy time.
    const timer = setTimeout(async () => {
      // @ts-ignore - these exist on all repliable interactions
      if ("deferred" in i && !i.deferred && "replied" in i && !i.replied && "deferReply" in i) {
        try { await (i as any).deferReply({ ephemeral: true }); } catch {}
      }
    }, 2000);

    try {
      await fn(i);
    } catch (err: any) {
      console.error("Handler error:", err);
      if ("isRepliable" in i && (i as any).isRepliable()) {
        try {
          // If we already deferred/replied, edit; otherwise reply.
          // @ts-ignore
          if (i.deferred || i.replied) await (i as any).editReply({ content: `Error: ${err?.message || err}` });
          else await (i as any).reply({ content: `Error: ${err?.message || err}`, ephemeral: true });
        } catch {}
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

// gate interactions to approved guilds (DMs allowed but your cmds are guild-only)
async function isGuildApproved(guildId: string | null): Promise<boolean> {
  if (!guildId) return true;
  const row = await prisma.approvedServer.findFirst({
    where: { guildId, enabled: true },
    select: { id: true },
  });
  return !!row;
}


// Simple visibility logs to trace flow
bot.on(Events.InteractionCreate, (i: Interaction) => {
  if ("isChatInputCommand" in i && (i as any).isChatInputCommand()) {
    console.log("[INT]", (i as any).commandName, "from", (i as any).user?.id, "in", (i as any).guildId);
  }
});

// Handle autocomplete for token selection
bot.on(Events.InteractionCreate, async (i: Interaction) => {
  if (i.isAutocomplete()) {
    const focusedOption = i.options.getFocused(true);
    if (focusedOption.name === "token") {
      try {
        const tokens = await getActiveTokens();
        const filtered = tokens
          .filter(t =>
            t.symbol.toLowerCase().includes(focusedOption.value.toLowerCase()) ||
            t.address.toLowerCase().includes(focusedOption.value.toLowerCase())
          )
          .slice(0, 25); // Discord limit

        const choices = filtered.map(t => ({
          name: `${t.symbol} (${t.address.slice(0, 8)}...)`,
          value: t.address // address as the value
        }));

        await i.respond(choices);
      } catch (error) {
        console.error("Autocomplete error:", error);
        await i.respond([]);
      }
    }
    return;
  }
});

// Handle commands and buttons
bot.on(Events.InteractionCreate, withAutoAck(async (i: Interaction) => {
  const gid = "guildId" in i ? (i as any).guildId : null;
  if (gid && !(await isGuildApproved(gid))) {
    if (i.isRepliable()) {
      await (i as any).reply({
        content: "⛔ This server isn't approved to use PIPtip yet.",
        ephemeral: true, // <-- use ephemeral, not flags
      }).catch(() => {});
    }
    return;
  }

  if ("isChatInputCommand" in i && (i as any).isChatInputCommand()) {
    switch ((i as any).commandName) {
      case "pip_register": return pipRegister(i as any);
      case "pip_withdraw": return pipWithdraw(i as any);
      case "pip_profile":  return pipProfile(i as any);
      case "pip_deposit":  return pipDeposit(i as any);
      case "pip_start":    return pipStart(i as any);
      case "pip_link":     return pipLink(i as any);
      case "pip_tip":      return pipTip(i as any);
    }
  }

  if ("isButton" in i && (i as any).isButton()) {
    // Route to appropriate button handler based on customId prefix
    const customId = (i as any).customId;
    
    if (customId.startsWith("pip:")) {
      return handlePipButton(i as any);
    }
    
    if (customId.startsWith("grouptip:")) {
      return handleGroupTipButton(i as any);
    }
    
    // If no handler matches, you might want to log this
    console.warn("Unknown button interaction:", customId);
  }
}));

// src/index.ts
import { restoreGroupTipExpiryTimers } from "./features/group_tip_expiry.js";

bot.once(Events.ClientReady, async () => {
  console.log(`🤖 Logged in as ${bot.user?.tag}`);
  await restoreGroupTipExpiryTimers(bot); // 👈 recover + schedule
});


// helpful global logs
process.on("unhandledRejection", (e) => console.error("unhandledRejection", e));
process.on("uncaughtException", (e) => console.error("uncaughtException", e));

async function main() {
  await ensurePrisma();

  // register slash commands to all approved guilds (or fallback)
  const cmds = getCommandsJson();
  await registerCommandsForApprovedGuilds(cmds);

  await bot.login(TOKEN);

  const server = app.listen(PORT, () => console.log(`🌐 Web up on ${PORT}`));
  const shutdown = () => {
    console.log("Shutting down…");
    server.close(() => process.exit(0));
    bot.destroy();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();