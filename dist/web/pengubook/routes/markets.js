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
