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
// Check if Discord OAuth is properly configured
const isDiscordOAuthConfigured = () => {
    return DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && REDIRECT_URI;
};
// GET /auth/discord - Initiate Discord OAuth
authRouter.get("/discord", (req, res) => {
    if (!isDiscordOAuthConfigured()) {
        return res.status(500).send(`
      <h2>PenguBook Authentication Not Configured</h2>
      <p>Discord OAuth is not properly configured. Missing environment variables:</p>
      <ul>
        ${!DISCORD_CLIENT_ID ? '<li>DISCORD_CLIENT_ID</li>' : ''}
        ${!DISCORD_CLIENT_SECRET ? '<li>DISCORD_CLIENT_SECRET</li>' : ''}
        ${!REDIRECT_URI ? '<li>DISCORD_REDIRECT_URI</li>' : ''}
      </ul>
      <p><a href="/">← Back to Home</a></p>
    `);
    }
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
    console.log("🔔 Discord OAuth callback triggered:", {
        query: req.query,
        sessionId: req.sessionID,
        hasSession: !!req.session,
        timestamp: new Date().toISOString()
    });
    if (!isDiscordOAuthConfigured()) {
        console.error("❌ Discord OAuth is not properly configured");
        return res.status(500).send("Discord OAuth is not properly configured");
    }
    try {
        const { code, state } = req.query;
        console.log("📝 Received callback params:", {
            hasCode: !!code,
            hasState: !!state,
            codeType: typeof code,
            stateType: typeof state
        });
        if (!code || !state || typeof code !== "string" || typeof state !== "string") {
            console.error("❌ Missing or invalid parameters in callback");
            return res.status(400).send("Missing or invalid parameters");
        }
        console.log("✅ Valid parameters received");
        // Verify state to prevent CSRF
        const stateData = oauthStates.get(state);
        console.log("🔍 State verification:", {
            stateExists: !!stateData,
            totalStates: oauthStates.size
        });
        if (!stateData) {
            console.error("❌ Invalid or expired state parameter");
            return res.status(400).send("Invalid or expired state");
        }
        oauthStates.delete(state);
        console.log("✅ State verified and deleted");
        // Exchange code for access token
        console.log("🔄 Exchanging code for token...");
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
        console.log("📡 Token response status:", tokenResponse.status);
        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error("❌ Failed to exchange code for token:", {
                status: tokenResponse.status,
                error: errorText
            });
            throw new Error(`Failed to exchange code for token: ${errorText}`);
        }
        const tokenData = await tokenResponse.json();
        const { access_token, refresh_token } = tokenData;
        console.log("✅ Token exchange successful");
        // Fetch user info from Discord
        console.log("👤 Fetching user info from Discord...");
        const userResponse = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        console.log("📡 User response status:", userResponse.status);
        if (!userResponse.ok) {
            const errorText = await userResponse.text();
            console.error("❌ Failed to fetch user info:", {
                status: userResponse.status,
                error: errorText
            });
            throw new Error(`Failed to fetch user info: ${errorText}`);
        }
        const discordUser = await userResponse.json();
        console.log("✅ User info fetched:", {
            id: discordUser.id,
            username: discordUser.username
        });
        // Create or find user in our database
        console.log("💾 Creating/finding user in database...");
        await findOrCreateUser(discordUser.id);
        console.log("✅ User created/found in database");
        console.log("💾 Storing user session:", {
            discordId: discordUser.id,
            username: discordUser.username,
            sessionId: req.sessionID,
            sessionExists: !!req.session
        });
        // Store user session
        req.session.discordId = discordUser.id;
        req.session.username = discordUser.username;
        req.session.avatar = discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordUser.id.slice(-1)) % 6}.png`;
        req.session.accessToken = access_token;
        req.session.refreshToken = refresh_token;
        console.log("✅ Session stored successfully. Verifying storage...");
        console.log("🔍 Session verification:", {
            discordId: req.session.discordId,
            username: req.session.username,
            hasAvatar: !!req.session.avatar,
            hasAccessToken: !!req.session.accessToken
        });
        // Redirect to intended destination
        const redirectUrl = stateData.redirectTo || "/pengubook";
        console.log("🔄 Redirecting to:", redirectUrl);
        if (redirectUrl.startsWith("/")) {
            // Direct redirect to ngrok URL
            const baseUrl = req.get('host') ? `${req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http'}://${req.get('host')}` : 'http://localhost:3000';
            const fullRedirectUrl = `${baseUrl}${redirectUrl}`;
            console.log("📍 Full redirect URL:", fullRedirectUrl);
            res.redirect(fullRedirectUrl);
        }
        else {
            console.log("📍 External redirect URL:", redirectUrl);
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
    console.log("🔐 Auth check:", {
        hasSession: !!req.session,
        discordId: req.session?.discordId ? "SET" : "MISSING",
        sessionId: req.sessionID,
        url: req.originalUrl,
        secure: req.secure,
        cookies: Object.keys(req.cookies || {}),
        headers: {
            host: req.get('host'),
            'x-forwarded-proto': req.get('x-forwarded-proto'),
            'user-agent': req.get('user-agent')?.slice(0, 50)
        }
    });
    if (!req.session || !req.session.discordId) {
        console.log("❌ No Discord ID in session, redirecting to auth");
        return res.redirect(`/auth/discord?redirect=${encodeURIComponent(req.originalUrl)}`);
    }
    console.log("✅ Auth check passed");
    next();
}
// Middleware to get current user info
export function getCurrentUser(req) {
    if (!req.session || !req.session.discordId)
        return null;
    return {
        discordId: req.session.discordId,
        username: req.session.username || "Unknown",
        avatar: req.session.avatar || `https://cdn.discordapp.com/embed/avatars/0.png`
    };
}
