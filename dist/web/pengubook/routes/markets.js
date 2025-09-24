import { getCurrentUser } from "../../auth.js";
export async function marketsHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser) {
            return res.redirect("/auth/discord");
        }
        // Redirect to PIPChips markets - all markets now use PIPChips
        return res.redirect("/pengubook/pipchips-markets");
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
        return res.redirect(`/pengubook/pipchips-markets/${marketId}`);
    }
    catch (error) {
        console.error('Legacy market detail redirect error:', error);
        res.status(500).send('Error redirecting to PIPChips market');
    }
}
// Legacy bet placement handler - redirect to the new PIPChips market flow
export async function placeBetHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser) {
            return res.redirect("/auth/discord");
        }
        const marketId = req.body?.marketId ?? req.query?.marketId;
        if (marketId) {
            return res.redirect(`/pengubook/pipchips-markets/${marketId}`);
        }
        return res.redirect("/pengubook/pipchips-markets");
    }
    catch (error) {
        console.error('Legacy bet placement redirect error:', error);
        res.status(500).send('Error redirecting to PIPChips markets');
    }
}
// Legacy market creation handler - redirect to the PIPChips markets page
export async function createMarketHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser) {
            return res.redirect("/auth/discord");
        }
        return res.redirect("/pengubook/pipchips-markets");
    }
    catch (error) {
        console.error('Legacy market creation redirect error:', error);
        res.status(500).send('Error redirecting to PIPChips markets');
    }
}

