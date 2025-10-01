import { Router } from "express";
import { randomBytes } from "crypto";
import { findOrCreateUser } from "../services/user_helpers.js";
import { getSecureCredential } from "../services/secure_key.js";
const authRouter = Router();
const oauthStates = /* @__PURE__ */ new Map();
setInterval(() => {
  const oneHourAgo = Date.now() - 36e5;
  for (const [state, data] of oauthStates.entries()) {
    if (data.timestamp < oneHourAgo) {
      oauthStates.delete(state);
    }
  }
}, 36e5);
const getDiscordCredentials = () => {
  try {
    return {
      clientId: process.env.DISCORD_CLIENT_ID,
      // This is public, doesn't need encryption
      clientSecret: getSecureCredential("DISCORD_CLIENT_SECRET"),
      redirectUri: process.env.DISCORD_REDIRECT_URI
      // This is also public config
    };
  } catch (error) {
    return null;
  }
};
const SCOPES = "identify guilds";
const isDiscordOAuthConfigured = () => {
  const credentials = getDiscordCredentials();
  return credentials && credentials.clientId && credentials.clientSecret && credentials.redirectUri;
};
authRouter.get("/discord", (req, res) => {
  const credentials = getDiscordCredentials();
  if (!credentials) {
    return res.status(500).send(`
      <h2>PenguBook Authentication Not Configured</h2>
      <p>Discord OAuth is not properly configured. Missing environment variables:</p>
      <ul>
        <li>DISCORD_CLIENT_ID</li>
        <li>DISCORD_CLIENT_SECRET</li>
        <li>DISCORD_REDIRECT_URI</li>
      </ul>
      <p><a href="/">\u2190 Back to Home</a></p>
    `);
  }
  const state = randomBytes(32).toString("hex");
  const redirectTo = req.query.redirect;
  oauthStates.set(state, {
    timestamp: Date.now(),
    redirectTo: redirectTo || "/pengubook"
  });
  const authUrl = new URL("https://discord.com/api/oauth2/authorize");
  authUrl.searchParams.set("client_id", credentials.clientId);
  authUrl.searchParams.set("redirect_uri", credentials.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);
  res.redirect(authUrl.toString());
});
authRouter.get("/discord/callback", async (req, res) => {
  console.log("\u{1F514} Discord OAuth callback triggered:", {
    query: req.query,
    sessionId: req.sessionID,
    hasSession: !!req.session,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  const credentials = getDiscordCredentials();
  if (!credentials) {
    console.error("\u274C Discord OAuth is not properly configured");
    return res.status(500).send("Discord OAuth is not properly configured");
  }
  try {
    const { code, state } = req.query;
    console.log("\u{1F4DD} Received callback params:", {
      hasCode: !!code,
      hasState: !!state,
      codeType: typeof code,
      stateType: typeof state
    });
    if (!code || !state || typeof code !== "string" || typeof state !== "string") {
      console.error("\u274C Missing or invalid parameters in callback");
      return res.status(400).send("Missing or invalid parameters");
    }
    console.log("\u2705 Valid parameters received");
    const stateData = oauthStates.get(state);
    console.log("\u{1F50D} State verification:", {
      stateExists: !!stateData,
      totalStates: oauthStates.size
    });
    if (!stateData) {
      console.error("\u274C Invalid or expired state parameter");
      return res.status(400).send("Invalid or expired state");
    }
    oauthStates.delete(state);
    console.log("\u2705 State verified and deleted");
    console.log("\u{1F504} Exchanging code for token...");
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: credentials.redirectUri
      })
    });
    console.log("\u{1F4E1} Token response status:", tokenResponse.status);
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("\u274C Failed to exchange code for token:", {
        status: tokenResponse.status,
        error: errorText
      });
      throw new Error(`Failed to exchange code for token: ${errorText}`);
    }
    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token } = tokenData;
    console.log("\u2705 Token exchange successful");
    console.log("\u{1F464} Fetching user info from Discord...");
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    console.log("\u{1F4E1} User response status:", userResponse.status);
    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error("\u274C Failed to fetch user info:", {
        status: userResponse.status,
        error: errorText
      });
      throw new Error(`Failed to fetch user info: ${errorText}`);
    }
    const discordUser = await userResponse.json();
    console.log("\u2705 User info fetched:", {
      id: discordUser.id,
      username: discordUser.username
    });
    console.log("\u{1F4BE} Creating/finding user in database...");
    await findOrCreateUser(discordUser.id);
    console.log("\u2705 User created/found in database");
    console.log("\u{1F4BE} Storing user session:", {
      discordId: discordUser.id,
      username: discordUser.username,
      sessionId: req.sessionID,
      sessionExists: !!req.session
    });
    req.session.regenerate((err) => {
      if (err) {
        console.error("\u274C Session regeneration error:", err);
        return res.status(500).send("Session security error");
      }
      console.log("\u{1F510} Session ID regenerated for security:", {
        newSessionId: req.sessionID,
        discordId: discordUser.id
      });
      req.session.discordId = discordUser.id;
      req.session.username = discordUser.username;
      req.session.avatar = discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordUser.id.slice(-1)) % 6}.png`;
      req.session.accessToken = access_token;
      req.session.refreshToken = refresh_token;
      console.log("\u2705 Session stored successfully. Verifying storage...");
      console.log("\u{1F50D} Session verification:", {
        discordId: req.session.discordId,
        username: req.session.username,
        hasAvatar: !!req.session.avatar,
        hasAccessToken: !!req.session.accessToken,
        newSessionId: req.sessionID
      });
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("\u274C Session save error:", saveErr);
        } else {
          console.log("\u2705 Session saved to store with new ID");
        }
        const redirectUrl = stateData.redirectTo || "/pengubook";
        console.log("\u{1F504} Redirecting to:", redirectUrl);
        console.log("\u{1F36A} Response headers before redirect:", {
          "set-cookie": res.getHeaders()["set-cookie"],
          "sessionID": req.sessionID
        });
        if (redirectUrl.startsWith("/")) {
          console.log("\u{1F4CD} Relative redirect URL:", redirectUrl);
          res.redirect(redirectUrl);
        } else {
          console.log("\u{1F4CD} External redirect URL:", redirectUrl);
          res.redirect(redirectUrl);
        }
      });
    });
  } catch (error) {
    console.error("Discord OAuth callback error:", error);
    console.error("Request details:", { code: req.query.code, state: req.query.state, headers: req.headers });
    res.status(500).send(`Authentication failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
});
authRouter.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});
function requireAuth(req, res, next) {
  console.log("\u{1F510} Auth check:", {
    hasSession: !!req.session,
    discordId: req.session?.discordId ? "SET" : "MISSING",
    sessionId: req.sessionID,
    url: req.originalUrl,
    secure: req.secure,
    cookies: Object.keys(req.cookies || {}),
    headers: {
      host: req.get("host"),
      "x-forwarded-proto": req.get("x-forwarded-proto"),
      "user-agent": req.get("user-agent")?.slice(0, 50)
    }
  });
  if (!req.session || !req.session.discordId) {
    console.log("\u274C No Discord ID in session, redirecting to auth");
    return res.redirect(`/auth/discord?redirect=${encodeURIComponent(req.originalUrl)}`);
  }
  console.log("\u2705 Auth check passed");
  next();
}
function getCurrentUser(req) {
  if (!req.session || !req.session.discordId) return null;
  return {
    discordId: req.session.discordId,
    username: req.session.username || "Unknown",
    avatar: req.session.avatar || `https://cdn.discordapp.com/embed/avatars/0.png`
  };
}
export {
  authRouter,
  getCurrentUser,
  requireAuth
};
//# sourceMappingURL=auth.js.map
