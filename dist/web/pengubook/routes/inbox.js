import { getCurrentUser } from "../../auth.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { generateBaseHTML } from "../templates.js";
import { prisma } from "../../../services/db.js";
// HTML escaping function to prevent XSS
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
export async function inboxHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser)
            return res.redirect("/auth/discord");
        const user = await findOrCreateUser(currentUser.discordId);
        // Get current unread count before marking as read
        const currentUnreadCount = await getUnreadMessageCount(currentUser.discordId);
        // Get messages with sender info
        const messages = await prisma.penguBookMessage.findMany({
            where: { toUserId: user.id },
            include: {
                from: true,
                tip: {
                    include: { Token: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        // Mark messages as read
        await prisma.penguBookMessage.updateMany({
            where: { toUserId: user.id, read: false },
            data: { read: true }
        });
        const content = `
    <div class="pg-container">
        <h1 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">📨 Your Messages</h1>

        ${messages.length === 0 ? `
        <div class="pg-empty-state">
            <div class="pg-empty-state__icon">📭</div>
            <h2 class="pg-empty-state__title">No messages yet</h2>
            <p class="pg-empty-state__description">
                Your tip notifications and messages will appear here! Start by browsing users and sending some tips.
            </p>
            <div style="margin-top: var(--pg-space-6);">
                <a href="/pengubook/browse" class="pg-btn pg-btn--primary">Browse Users</a>
            </div>
        </div>
        ` : messages.map((msg) => `
        <div class="pg-message ${msg.tip ? 'pg-message--tip' : ''}">
            <div class="pg-message-header">
                <span class="pg-message-sender">
                    ${msg.from && msg.from.discordId ? (msg.from.discordId === msg.from.id ? 'System' : `User#${msg.from.discordId.slice(-4)}`) : 'Unknown User'}
                </span>
                <span class="pg-message-time">
                    ${new Date(msg.createdAt).toLocaleString()}
                </span>
            </div>
            <div class="pg-message-content">
                ${msg.tip ? `
                <div class="pg-tip-amount">
                    💰 Received ${Number(msg.tip.amountAtomic / Math.pow(10, msg.tip.Token.decimals)).toFixed(2)} ${msg.tip.Token.symbol}
                </div>
                ` : ''}
                ${escapeHtml(msg.message || '')}
            </div>
        </div>
        `).join('')}
    </div>`;
        res.send(generateBaseHTML(content, '📨 Inbox - PenguBook', 'inbox', {
            user: currentUser,
            unreadCount: currentUnreadCount
        }));
    }
    catch (error) {
        console.error("PenguBook inbox error:", error);
        res.status(500).send("Error loading inbox");
    }
}
