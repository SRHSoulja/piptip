// src/web/pengubook/router.ts - Main PenguBook router using modular structure
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { generateBaseHTML } from "./templates.js";
// Import route handlers
import { homeHandler } from "./routes/home.js";
import { inboxHandler } from "./routes/inbox.js";
import { browseHandler } from "./routes/browse.js";
import { profileHandler, profilePostHandler } from "./routes/profile.js";
import { userHandler, userTipHandler } from "./routes/user.js";
import { statsHandler } from "./routes/stats.js";
import { transactionsHandler } from "./routes/transactions.js";
import { applyHandler, applyPostHandler } from "./routes/apply.js";
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
pengubookModularRouter.get("/stats", statsHandler);
pengubookModularRouter.get("/transactions", transactionsHandler);
pengubookModularRouter.get("/apply", applyHandler);
pengubookModularRouter.post("/apply", applyPostHandler);
pengubookModularRouter.get("/user/:discordId", userHandler);
pengubookModularRouter.post("/user/:discordId/tip", userTipHandler);
// API routes
pengubookModularRouter.get("/api/unread-count", apiHandlers.unreadCount);
pengubookModularRouter.get("/api/discord-user/:discordId", apiHandlers.discordUser);
pengubookModularRouter.get("/api/user-data", apiHandlers.userData);
pengubookModularRouter.post("/api/tip", apiHandlers.tip);
pengubookModularRouter.post("/api/profile", apiHandlers.profile);
pengubookModularRouter.post("/api/apply", applyPostHandler);
pengubookModularRouter.get("/api/balance", apiHandlers.balance);
pengubookModularRouter.post("/api/send-message", apiHandlers.sendMessage);
pengubookModularRouter.post("/api/react", apiHandlers.react);
pengubookModularRouter.post("/api/follow", apiHandlers.follow);
pengubookModularRouter.get("/api/social-data/:discordId", apiHandlers.socialData);
pengubookModularRouter.get("/api/activity-feed", apiHandlers.activityFeed);
// Export template function for use in routes
export { generateBaseHTML };
