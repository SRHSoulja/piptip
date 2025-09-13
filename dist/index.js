// src/index.ts
import "dotenv/config";
import express from "express";
import session from "express-session";
import { flushNoticesEphemeral } from "./services/notifier.js";
import { Client, GatewayIntentBits, Events, } from "discord.js";
import { ensurePrisma, prisma } from "./services/db.js";
import { healthRouter } from "./web/health.js";
import { internalRouter } from "./web/internal.js";
import { adminRouter } from "./web/admin.js";
import { authRouter } from "./web/auth.js";
import { pengubookRouter } from "./web/pengubook.js";
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
import { handlePipButton } from "./interactions/pip_buttons.js";
import { handleGroupTipButton } from "./interactions/group_tip_buttons.js";
import { isButtonInteraction, isModalSubmitInteraction } from "./discord/guards.js";
import { restoreGroupTipExpiryTimers } from "./features/group_tip_expiry.js";
// shared command defs + registrar
import { getCommandsJson } from "./services/commands_def.js";
import { registerCommandsForApprovedGuilds } from "./services/command_registry.js";
import { getActiveTokens } from "./services/token.js";
import { setDiscordClient } from "./services/discord_users.js";
// import { backupService } from "./services/backup.js"; // Disabled - using external cron job
const TOKEN = process.env.DISCORD_TOKEN;
const PORT = Number(process.env.PORT || 3000);
// ---------- Express (REST) ----------
const app = express();
app.use(express.json({ limit: "256kb" }));
// Session middleware for OAuth
app.use(session({
    secret: process.env.SESSION_SECRET || "fallback-dev-secret-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
// Favicon route to prevent 404 errors
app.get("/favicon.ico", (_req, res) => {
    // Return a simple 1x1 transparent PNG
    const favicon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.send(favicon);
});
app.use("/health", healthRouter);
app.use("/internal", internalRouter);
app.use("/admin", adminRouter);
app.use("/auth", authRouter);
app.use("/pengubook", pengubookRouter);
// ---------- Discord bot ----------
const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
// --- Auto-ACK wrapper: prevents Discord timeouts globally ---
function withAutoAck(fn) {
    return async (i) => {
        let timerCleared = false;
        // auto-defer after 2s if nothing replied yet
        const timer = setTimeout(async () => {
            if (!timerCleared && "deferred" in i && !i.deferred && "replied" in i && !i.replied && "deferReply" in i) {
                try {
                    await i.deferReply({ flags: 64 });
                }
                catch (error) {
                    // Silently ignore auto-defer failures since they're usually due to race conditions
                }
            }
        }, 2000);
        try {
            // run your actual handler (the big switch)
            await fn(i);
            // Clear timer immediately after handler completes
            timerCleared = true;
            clearTimeout(timer);
            // ✅ after the handler has replied/deferred, flush notices as an ephemeral follow-up
            if ("isChatInputCommand" in i && i.isChatInputCommand()) {
                await flushNoticesEphemeral(i).catch(() => { });
            }
        }
        catch (err) {
            console.error("Handler error:", err);
            if ("isRepliable" in i && i.isRepliable()) {
                try {
                    if ("deferred" in i && "replied" in i) {
                        if (i.deferred || i.replied) {
                            await i.editReply({ content: `Error: ${err?.message || err}` });
                        }
                        else {
                            await i.reply({ content: `Error: ${err?.message || err}`, flags: 64 });
                        }
                    }
                }
                catch (replyError) {
                    console.error("Error reply failed:", replyError);
                }
            }
        }
        finally {
            timerCleared = true;
            clearTimeout(timer);
        }
    };
}
// Gate interactions to approved guilds (DMs allowed but your cmds are guild-only)
async function isGuildApproved(guildId) {
    if (!guildId)
        return true;
    try {
        const row = await prisma.approvedServer.findFirst({
            where: { guildId, enabled: true },
            select: { id: true },
        });
        return !!row;
    }
    catch (error) {
        console.error("Guild approval check failed:", error);
        return false;
    }
}
// Check if user is banned from PIPTip
async function isUserBanned(discordId) {
    try {
        const user = await prisma.user.findUnique({
            where: { discordId },
            select: { isBanned: true, bannedReason: true }
        });
        if (user?.isBanned) {
            return { banned: true, reason: user.bannedReason || "No reason provided" };
        }
        return { banned: false };
    }
    catch (error) {
        console.error("Ban check failed:", error);
        return { banned: false }; // Allow on error to prevent false positives
    }
}
// Handle autocomplete for token selection
// Simple visibility logs to trace flow (LOGGING ONLY)
bot.on(Events.InteractionCreate, (i) => {
    if ("isChatInputCommand" in i && i.isChatInputCommand()) {
        console.log("[CMD]", i.commandName, "from", i.user?.id, "in", i.guildId);
    }
});
// Handle autocomplete for token selection (unchanged)
bot.on(Events.InteractionCreate, async (i) => {
    if (!i.isAutocomplete())
        return;
    const focused = i.options.getFocused(true);
    // only handle the "token" option
    if (focused.name !== "token") {
        return i.respond([]).catch(() => { });
    }
    try {
        const tokens = await getActiveTokens(); // [{ symbol, address, decimals, active: true }, ...]
        const q = String(focused.value || "").toLowerCase();
        const filtered = tokens
            .filter(t => t.symbol.toLowerCase().includes(q) ||
            t.address.toLowerCase().includes(q))
            .slice(0, 25); // Discord limit
        await i.respond(filtered.map(t => ({
            name: `${t.symbol} (${t.address.slice(0, 8)}...)`,
            value: t.address, // handler will receive address in options.getString("token")
        })));
    }
    catch (err) {
        console.error("Autocomplete error (token):", err);
        await i.respond([]).catch(() => { });
    }
});
// Handle commands and buttons (ONLY HERE; wrapped with auto-ack)
bot.on(Events.InteractionCreate, withAutoAck(async (i) => {
    const gid = "guildId" in i ? i.guildId : null;
    // Guild allowlist
    if (gid && !(await isGuildApproved(gid))) {
        if ("isRepliable" in i && i.isRepliable()) {
            await i.reply({
                content: "This server isn't approved to use PIPtip yet.",
                flags: 64, // MessageFlags.Ephemeral
            }).catch(() => { });
        }
        return;
    }
    // Ban check
    if ("user" in i && i.user?.id) {
        const banStatus = await isUserBanned(i.user.id);
        if (banStatus.banned) {
            if ("isRepliable" in i && i.isRepliable()) {
                await i.reply({
                    content: `❌ **You are banned from using PIPTip.**\n\n**Reason:** ${banStatus.reason}\n\nIf you believe this is an error, please contact the administrators.`,
                    flags: 64, // MessageFlags.Ephemeral
                }).catch(() => { });
            }
            return;
        }
    }
    // ↓↓↓ FLUSH EPHEMERAL NOTICES RIGHT BEFORE COMMAND ROUTING ↓↓↓
    if ("isChatInputCommand" in i && i.isChatInputCommand()) {
        // fire-and-forget: delivers queued account notices as an ephemeral message
        switch (i.commandName) {
            case "pip_withdraw": return pipWithdraw(i);
            case "pip_profile": return pipProfile(i);
            case "pip_deposit": return pipDeposit(i);
            case "pip_game": return pipGame(i);
            case "pip_link": return pipLink(i);
            case "pip_tip": return pipTip(i);
            case "pip_help": return pipHelp(i);
            case "pip_stats": return pipStats(i);
            case "pip_bio": return pipBio(i);
            case "pip_pengubook": return pipPenguBook(i);
            default:
                console.warn("Unknown command:", i.commandName);
        }
    }
    // Button interactions
    if (isButtonInteraction(i)) {
        const customId = i.customId;
        if (customId.startsWith("pip:"))
            return handlePipButton(i);
        if (customId.startsWith("grouptip:"))
            return handleGroupTipButton(i);
        console.warn("Unknown button interaction:", customId);
        return;
    }
    // Modal submissions
    if (isModalSubmitInteraction(i)) {
        const customId = i.customId;
        if (customId.startsWith("pip:"))
            return handlePipButton(i);
        console.warn("Unknown modal interaction:", customId);
        return;
    }
}));
bot.once(Events.ClientReady, async () => {
    console.log(`Bot logged in as ${bot.user?.tag}`);
    // Set global client reference for admin routes
    setDiscordClient(bot);
    try {
        await restoreGroupTipExpiryTimers(bot);
        console.log("Group tip timers restored");
    }
    catch (error) {
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
        // Backup service disabled - using external cron job with backup-script.js
        // await backupService.start();
        console.log("Backup service: using external cron job");
        // Register slash commands to all approved guilds (or fallback)
        const cmds = getCommandsJson();
        await registerCommandsForApprovedGuilds(cmds);
        console.log("Commands registered");
        await bot.login(TOKEN);
        console.log("Bot login initiated");
        const server = app.listen(PORT, () => {
            console.log(`Web server running on port ${PORT}`);
        });
        const shutdown = async () => {
            console.log("Shutting down...");
            // await backupService.stop(); // Disabled - using external cron job
            server.close(() => {
                bot.destroy();
                process.exit(0);
            });
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
    }
    catch (error) {
        console.error("Failed to start application:", error);
        process.exit(1);
    }
}
main();
