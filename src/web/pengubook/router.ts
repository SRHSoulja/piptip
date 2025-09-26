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
import { statsHandler } from "./routes/stats.js";
import { transactionsHandler } from "./routes/transactions.js";
import { applyHandler, applyPostHandler } from "./routes/apply.js";
import { marketsHandler, marketDetailHandler, placeBetHandler, createMarketHandler } from "./routes/markets.js";
import { pipchipsMarketsHandler, pipchipsMarketDetailHandler } from "./routes/pipchips_markets.js";
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

// Prediction Markets routes (legacy token-based)
pengubookModularRouter.get("/markets", marketsHandler);
pengubookModularRouter.get("/markets/create", createMarketHandler);
pengubookModularRouter.post("/markets/create", createMarketHandler);
pengubookModularRouter.get("/markets/:marketId", marketDetailHandler);
pengubookModularRouter.post("/markets/bet", placeBetHandler);

// PIPChips Prediction Markets routes
pengubookModularRouter.get("/pipchips", pipchipsMarketsHandler);
pengubookModularRouter.get("/pipchips/market/:marketId", pipchipsMarketDetailHandler);

// API routes
pengubookModularRouter.get("/api/unread-count", apiHandlers.unreadCount);
pengubookModularRouter.get("/api/token-price/:tokenSymbol", apiHandlers.tokenPrice);
pengubookModularRouter.get("/api/discord-user/:discordId", apiHandlers.discordUser);
pengubookModularRouter.post("/api/discord-users-batch", apiHandlers.discordUsersBatch);
pengubookModularRouter.get("/api/user-data", apiHandlers.userData);
pengubookModularRouter.post("/api/tip", apiHandlers.tip);
pengubookModularRouter.post("/api/tip-preview", apiHandlers.tipPreview);
pengubookModularRouter.post("/api/profile", apiHandlers.profile);
pengubookModularRouter.post("/api/apply", applyPostHandler);
pengubookModularRouter.get("/api/balance", apiHandlers.balance);
pengubookModularRouter.post("/api/send-message", apiHandlers.sendMessage);
pengubookModularRouter.post("/api/react", apiHandlers.react);
pengubookModularRouter.post("/api/follow", apiHandlers.follow);
pengubookModularRouter.get("/api/social-data/:discordId", apiHandlers.socialData);
pengubookModularRouter.get("/api/activity-feed", apiHandlers.activityFeed);
pengubookModularRouter.get("/api/search-users", apiHandlers.searchUsers);
pengubookModularRouter.post("/api/claim-daily", apiHandlers.claimDaily);
pengubookModularRouter.get("/api/buy-chips-options", apiHandlers.buyChipsOptions);
pengubookModularRouter.post("/api/create-market", apiHandlers.createMarket);

// Export template function for use in routes
export { generateBaseHTML };