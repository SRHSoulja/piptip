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
export async function browseHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser)
            return res.redirect("/auth/discord");
        const user = await findOrCreateUser(currentUser.discordId);
        const unreadCount = await getUnreadMessageCount(currentUser.discordId);
        // Get all users who show in PenguBook (excluding current user)
        const users = await prisma.user.findMany({
            where: {
                showInPenguBook: true,
                id: { not: user.id }
            },
            select: {
                id: true,
                discordId: true,
                bio: true,
                bioLastUpdated: true,
                bioViewCount: true,
                xUsername: true,
                socials: true,
                wins: true,
                losses: true,
                ties: true,
                createdAt: true
            },
            orderBy: { bioLastUpdated: 'desc' },
            take: 50
        });
        const content = `
    <div class="pg-container">
        <h1 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">👥 Browse PenguBook Users</h1>

        ${users.length === 0 ? `
        <div class="pg-empty-state">
            <div class="pg-empty-state__icon">👥</div>
            <h2 class="pg-empty-state__title">No users found</h2>
            <p class="pg-empty-state__description">
                No users have set up their PenguBook profiles yet. Be one of the first to create your profile!
            </p>
            <div style="margin-top: var(--pg-space-6);">
                <a href="/pengubook/profile" class="pg-btn pg-btn--primary">Create Profile</a>
            </div>
        </div>
        ` : `
        <div class="pg-grid pg-grid--2">
            ${users.map((user) => {
            let socials = [];
            try {
                socials = user.socials ? JSON.parse(user.socials) : [];
            }
            catch (e) {
                socials = [];
            }
            const winRate = user.wins + user.losses > 0 ? ((user.wins / (user.wins + user.losses)) * 100).toFixed(1) : 'N/A';
            return `
              <div class="pg-card" style="transition: all var(--pg-duration-normal) var(--pg-ease-out);">
                  <div style="display: flex; align-items: center; gap: var(--pg-space-4); margin-bottom: var(--pg-space-4);">
                      <img src="https://cdn.discordapp.com/embed/avatars/${parseInt(user.discordId.slice(-1)) % 6}.png"
                           alt="Avatar"
                           class="pg-avatar"
                           style="width: 60px; height: 60px;"
                           id="avatar-${user.discordId}"
                           loading="lazy">
                      <div style="flex: 1; min-width: 0;">
                          <div style="font-weight: 700; color: var(--pg-dark-800); margin-bottom: var(--pg-space-1);" id="username-${user.discordId}">
                              User#${user.discordId.slice(-4)}
                          </div>
                          <div style="color: var(--pg-dark-600); font-size: var(--pg-text-sm);">
                              👀 ${user.bioViewCount} views
                          </div>
                      </div>
                  </div>

                  <div class="pg-stats-grid" style="margin: var(--pg-space-4) 0;">
                      <div class="pg-stat-card">
                          <div class="pg-stat-value">${user.wins}</div>
                          <div class="pg-stat-label">Wins</div>
                      </div>
                      <div class="pg-stat-card">
                          <div class="pg-stat-value">${user.losses}</div>
                          <div class="pg-stat-label">Losses</div>
                      </div>
                      <div class="pg-stat-card">
                          <div class="pg-stat-value">${winRate}%</div>
                          <div class="pg-stat-label">Win Rate</div>
                      </div>
                  </div>

                  ${user.bio ? `
                  <div style="margin: var(--pg-space-4) 0; padding: var(--pg-space-4); background: var(--pg-dark-100); border-radius: var(--pg-radius-md);">
                      <div style="color: var(--pg-dark-700); font-size: var(--pg-text-sm); line-height: 1.5;">
                          ${escapeHtml(user.bio.length > 120 ? user.bio.substring(0, 120) + '...' : user.bio)}
                      </div>
                  </div>
                  ` : ''}

                  <div style="display: flex; gap: var(--pg-space-2); margin-top: var(--pg-space-4);">
                      <a href="/pengubook/user/${user.discordId}" class="pg-btn pg-btn--primary pg-btn--sm" style="flex: 1;">
                          👤 View Profile
                      </a>
                  </div>
              </div>
              `;
        }).join('')}
        </div>
        `}
    </div>

    <script>
        // Load Discord usernames and avatars with error handling
        ${users.map((user) => `
        fetch('/pengubook/api/discord-user/${user.discordId}')
            .then(res => res.ok ? res.json() : Promise.reject('Failed to load'))
            .then(data => {
                if (data.success) {
                    const usernameEl = document.getElementById('username-${user.discordId}');
                    const avatarEl = document.getElementById('avatar-${user.discordId}');
                    if (usernameEl) usernameEl.textContent = data.username;
                    if (avatarEl) avatarEl.src = data.avatarURL;
                }
            })
            .catch(() => {
                // Silently fail with fallback already in place
            });
        `).join('')}
    </script>`;
        res.send(generateBaseHTML(content, '👥 Browse Users - PenguBook', 'browse', {
            user: currentUser,
            unreadCount
        }));
    }
    catch (error) {
        console.error("PenguBook browse error:", error);
        res.status(500).send("Error loading browse page");
    }
}
