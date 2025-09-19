// src/web/pengubook/router.ts - Main PenguBook router using modular structure
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { generateBaseHTML, generateHomeContent, generateEmptyState } from "./templates.js";

// Import route handlers
import { homeHandler } from "./routes/home.js";
import { inboxHandler } from "./routes/inbox.js";
import { browseHandler } from "./routes/browse.js";
import { profileHandler, profilePostHandler } from "./routes/profile.js";
import { userHandler, userTipHandler } from "./routes/user.js";
import { apiHandlers } from "./routes/api.js";

export const pengubookModularRouter = Router();

// Middleware to require authentication for all PenguBook routes
pengubookModularRouter.use(requireAuth);

// Main routes
pengubookModularRouter.get("/", homeHandler);
pengubookModularRouter.get("/inbox", inboxHandler);
pengubookModularRouter.get("/browse", browseHandler);
pengubookModularRouter.get("/profile", profileHandler);
pengubookModularRouter.post("/profile", profilePostHandler);
pengubookModularRouter.get("/user/:discordId", userHandler);
pengubookModularRouter.post("/user/:discordId/tip", userTipHandler);

// API routes
pengubookModularRouter.get("/api/unread-count", apiHandlers.unreadCount);
pengubookModularRouter.get("/api/discord-user/:discordId", apiHandlers.discordUser);
pengubookModularRouter.post("/api/tip", apiHandlers.tip);
pengubookModularRouter.post("/api/profile", apiHandlers.profile);
pengubookModularRouter.get("/api/balance", apiHandlers.balance);

// Export template function for use in routes
export { generateBaseHTML };