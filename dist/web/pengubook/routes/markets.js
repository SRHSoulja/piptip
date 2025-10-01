import { getCurrentUser } from "../../auth.js";
async function marketsHandler(req, res) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.redirect("/auth/discord");
    }
    return res.redirect("/pengubook/pipchips");
  } catch (error) {
    console.error("Legacy markets redirect error:", error);
    res.status(500).send("Error redirecting to PIPChips markets");
  }
}
async function marketDetailHandler(req, res) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.redirect("/auth/discord");
    }
    const { marketId } = req.params;
    return res.redirect(`/pengubook/pipchips/market/${marketId}`);
  } catch (error) {
    console.error("Legacy market detail redirect error:", error);
    res.status(500).send("Error redirecting to PIPChips market");
  }
}
async function createMarketHandler(req, res) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.redirect("/auth/discord");
    }
    return res.redirect("/pengubook/pipchips");
  } catch (error) {
    console.error("Legacy create market redirect error:", error);
    res.status(500).send("Error redirecting to PIPChips markets");
  }
}
async function placeBetHandler(req, res) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.redirect("/auth/discord");
    }
    return res.redirect("/pengubook/pipchips");
  } catch (error) {
    console.error("Legacy place bet redirect error:", error);
    res.status(500).send("Error redirecting to PIPChips markets");
  }
}
export {
  createMarketHandler,
  marketDetailHandler,
  marketsHandler,
  placeBetHandler
};
//# sourceMappingURL=markets.js.map
