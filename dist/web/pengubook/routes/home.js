import { getCurrentUser } from "../../auth.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { generateBaseHTML, generateHomeContent } from "../templates.js";
export async function homeHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        const referralCode = req.query.ref;
        if (!currentUser) {
            if (referralCode) {
                req.session.pendingReferralCode = referralCode;
            }
            return res.redirect("/auth/discord");
        }
        const user = await findOrCreateUser(currentUser.discordId);
        const unreadCount = await getUnreadMessageCount(currentUser.discordId);
        // Process referral code logic (same as before)
        if (referralCode || req.session.pendingReferralCode) {
            const codeToProcess = referralCode || req.session.pendingReferralCode;
            if (codeToProcess) {
                const { processReferralSignup } = await import("../../../services/referrals.js");
                const success = await processReferralSignup(codeToProcess, currentUser.discordId);
                if (success) {
                    delete req.session.pendingReferralCode;
                    return res.redirect("/pengubook/profile?referred=true");
                }
                delete req.session.pendingReferralCode;
            }
        }
        const content = generateHomeContent(user, currentUser);
        res.send(generateBaseHTML(content, '🐧 PenguBook - Home', 'home', {
            user: currentUser,
            unreadCount
        }));
    }
    catch (error) {
        console.error("PenguBook home error:", error);
        res.status(500).send("Error loading PenguBook");
    }
}
