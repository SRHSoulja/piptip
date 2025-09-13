// src/web/auth.ts - Discord OAuth authentication for web PenguBook
import { Router } from "express";
import { randomBytes } from "crypto";
import { findOrCreateUser } from "../services/user_helpers.js";
export const authRouter = Router();
// Store OAuth states (in production, use Redis or similar)
const oauthStates = new Map();
// Clean up expired states every hour
setInterval(() => {
    const oneHourAgo = Date.now() - 3600000;
    for (const [state, data] of oauthStates.entries()) {
        if (data.timestamp < oneHourAgo) {
            oauthStates.delete(state);
        }
    }
}, 3600000);
// Discord OAuth URLs and scopes
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const SCOPES = "identify guilds";
// GET /auth/discord - Initiate Discord OAuth
authRouter.get("/discord", (req, res) => {
    const state = randomBytes(32).toString("hex");
    const redirectTo = req.query.redirect;
    oauthStates.set(state, {
        timestamp: Date.now(),
        redirectTo: redirectTo || "/pengubook"
    });
    const authUrl = new URL("https://discord.com/api/oauth2/authorize");
    authUrl.searchParams.set("client_id", DISCORD_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("state", state);
    res.redirect(authUrl.toString());
});
// GET /auth/discord/callback - Handle Discord OAuth callback
authRouter.get("/discord/callback", async (req, res) => {
    try {
        const { code, state } = req.query;
        if (!code || !state || typeof code !== "string" || typeof state !== "string") {
            return res.status(400).send("Missing or invalid parameters");
        }
        // Verify state to prevent CSRF
        const stateData = oauthStates.get(state);
        if (!stateData) {
            return res.status(400).send("Invalid or expired state");
        }
        oauthStates.delete(state);
        // Exchange code for access token
        const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: "authorization_code",
                code,
                redirect_uri: REDIRECT_URI,
            }),
        });
        if (!tokenResponse.ok) {
            throw new Error("Failed to exchange code for token");
        }
        const tokenData = await tokenResponse.json();
        const { access_token, refresh_token } = tokenData;
        // Fetch user info from Discord
        const userResponse = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!userResponse.ok) {
            throw new Error("Failed to fetch user info");
        }
        const discordUser = await userResponse.json();
        // Create or find user in our database
        await findOrCreateUser(discordUser.id);
        // Store user session
        req.session.discordId = discordUser.id;
        req.session.username = discordUser.username;
        req.session.avatar = discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordUser.id.slice(-1)) % 6}.png`;
        req.session.accessToken = access_token;
        req.session.refreshToken = refresh_token;
        // Redirect to intended destination
        const redirectUrl = stateData.redirectTo || "/pengubook";
        if (redirectUrl.startsWith("/")) {
            // Direct redirect to ngrok URL
            const baseUrl = req.get('host') ? `${req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http'}://${req.get('host')}` : 'http://localhost:3000';
            res.redirect(`${baseUrl}${redirectUrl}`);
        }
        else {
            res.redirect(redirectUrl);
        }
    }
    catch (error) {
        console.error("Discord OAuth callback error:", error);
        console.error("Request details:", { code: req.query.code, state: req.query.state, headers: req.headers });
        res.status(500).send(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});
// GET /auth/logout - Clear session
authRouter.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    });
});
// Middleware to require authentication
export function requireAuth(req, res, next) {
    if (!req.session.discordId) {
        return res.redirect(`/auth/discord?redirect=${encodeURIComponent(req.originalUrl)}`);
    }
    next();
}
// Middleware to get current user info
export function getCurrentUser(req) {
    if (!req.session.discordId)
        return null;
    return {
        discordId: req.session.discordId,
        username: req.session.username || "Unknown",
        avatar: req.session.avatar || `https://cdn.discordapp.com/embed/avatars/0.png`
    };
}
