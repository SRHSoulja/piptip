import { getCurrentUser } from "../../auth.js";
export async function marketsHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser) {
            return res.redirect("/auth/discord");
        }
        // Redirect to PIPChips markets - all markets now use PIPChips
        return res.redirect("/pengubook/pipchips");
    }
    catch (error) {
        console.error('Legacy markets redirect error:', error);
        res.status(500).send('Error redirecting to PIPChips markets');
    }
}
// Legacy market detail handler - redirect to PIPChips version
export async function marketDetailHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser) {
            return res.redirect("/auth/discord");
        }
        const { marketId } = req.params;
        return res.redirect(`/pengubook/pipchips/market/${marketId}`);
    }
    catch (error) {
        console.error('Legacy market detail redirect error:', error);
        res.status(500).send('Error redirecting to PIPChips market');
    }
}
// Legacy market creation handler - redirect to PIPChips markets
export async function createMarketHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser) {
            return res.redirect("/auth/discord");
        }
        // Redirect to PIPChips markets main page
        return res.redirect("/pengubook/pipchips");
    }
    catch (error) {
        console.error('Legacy create market redirect error:', error);
        res.status(500).send('Error redirecting to PIPChips markets');
    }
}
// Legacy bet placement handler - redirect to PIPChips markets
export async function placeBetHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser) {
            return res.redirect("/auth/discord");
        }
        // Redirect to PIPChips markets main page
        return res.redirect("/pengubook/pipchips");
    }
    catch (error) {
        console.error('Legacy place bet redirect error:', error);
        res.status(500).send('Error redirecting to PIPChips markets');
    }
}
