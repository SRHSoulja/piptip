import { getCurrentUser } from "../../auth.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { generateBaseHTML } from "../templates.js";
import { prisma } from "../../../services/db.js";
function escapeHtml(unsafe) {
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
async function browseHandler(req, res) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");
    const user = await findOrCreateUser(currentUser.discordId);
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);
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
      orderBy: { bioLastUpdated: "desc" },
      take: 50
    });
    const currentUserHasBio = await prisma.user.findFirst({
      where: { id: user.id, bio: { not: null } },
      select: { bio: true }
    });
    const topUsers = users.filter((u) => u.wins + u.losses > 0).sort((a, b) => {
      const winRateA = a.wins / (a.wins + a.losses);
      const winRateB = b.wins / (b.wins + b.losses);
      if (winRateA !== winRateB) return winRateB - winRateA;
      return b.wins + b.losses - (a.wins + a.losses);
    }).slice(0, 3);
    const content = `
    <div class="pg-container">
        <h1 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">\u{1F465} Browse PenguBook Users</h1>

        ${topUsers.length >= 3 ? `
        <!-- Leaderboard Podium -->
        <div class="pg-card" style="margin-bottom: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">\u{1F3C6} Top Players</h2>
            <div class="pg-leaderboard-podium">
                ${topUsers.map((user2, index) => {
      const winRate = (user2.wins / (user2.wins + user2.losses) * 100).toFixed(1);
      const podiumClass = index === 0 ? "first" : index === 1 ? "second" : "third";
      const crown = index === 0 ? "\u{1F451}" : index === 1 ? "\u{1F948}" : "\u{1F949}";
      const rank = index + 1;
      return `
                    <div class="pg-podium-place pg-podium-place--${podiumClass}">
                        <div class="pg-podium-crown">${crown}</div>
                        <div class="pg-podium-rank">#${rank}</div>
                        <div class="pg-podium-user" id="podium-username-${user2.discordId}">User#${user2.discordId.slice(-4)}</div>
                        <div class="pg-podium-score">${winRate}% Win Rate</div>
                        <div style="font-size: var(--pg-text-sm); margin-top: var(--pg-space-1);">${user2.wins}W ${user2.losses}L</div>
                    </div>
                  `;
    }).join("")}
            </div>
        </div>
        ` : ""}

        ${users.length === 0 ? `
        <div class="pg-empty-state">
            <div class="pg-empty-state__icon">\u{1F427}</div>
            <h2 class="pg-empty-state__title">${currentUserHasBio ? "You're the first one here!" : "No other users yet"}</h2>
            <p class="pg-empty-state__description">
                ${currentUserHasBio ? "Looks like you're the pioneer! Your profile is set up, but no other users have joined PenguBook yet. Share with friends to grow the community!" : "No other users have set up their PenguBook profiles yet. Be the first to create your profile!"}
            </p>
            <div style="margin-top: var(--pg-space-6);">
                ${currentUserHasBio ? `<a href="/pengubook/profile" class="pg-btn pg-btn--primary">View Your Profile</a>` : `<a href="/pengubook/profile" class="pg-btn pg-btn--primary">Create Profile</a>`}
            </div>
        </div>
        ` : `
        <div class="pg-grid pg-grid--2">
            ${users.map((user2) => {
      let socials = [];
      try {
        socials = user2.socials ? JSON.parse(user2.socials) : [];
      } catch (e) {
        socials = [];
      }
      const winRate = user2.wins + user2.losses > 0 ? (user2.wins / (user2.wins + user2.losses) * 100).toFixed(1) : "N/A";
      return `
              <div class="pg-card" style="transition: all var(--pg-duration-normal) var(--pg-ease-out);">
                  <div style="display: flex; align-items: center; gap: var(--pg-space-4); margin-bottom: var(--pg-space-4);">
                      <img src="https://cdn.discordapp.com/embed/avatars/${parseInt(user2.discordId.slice(-1)) % 6}.png"
                           alt="Avatar"
                           class="pg-avatar"
                           style="width: 60px; height: 60px;"
                           id="avatar-${user2.discordId}"
                           loading="lazy">
                      <div style="flex: 1; min-width: 0;">
                          <div style="font-weight: 700; color: var(--pg-dark-800); margin-bottom: var(--pg-space-1);" id="username-${user2.discordId}">
                              User#${user2.discordId.slice(-4)}
                          </div>
                          <div style="color: var(--pg-dark-600); font-size: var(--pg-text-sm);">
                              \u{1F440} ${user2.bioViewCount} views
                          </div>
                      </div>
                  </div>

                  <div class="pg-stats-grid" style="margin: var(--pg-space-4) 0;">
                      <div class="pg-stat-card">
                          <div class="pg-stat-value">${user2.wins}</div>
                          <div class="pg-stat-label">Wins</div>
                      </div>
                      <div class="pg-stat-card">
                          <div class="pg-stat-value">${user2.losses}</div>
                          <div class="pg-stat-label">Losses</div>
                      </div>
                      <div class="pg-stat-card">
                          <div class="pg-stat-value">${winRate}%</div>
                          <div class="pg-stat-label">Win Rate</div>
                      </div>
                  </div>

                  ${user2.bio ? `
                  <div style="margin: var(--pg-space-4) 0; padding: var(--pg-space-4); background: var(--pg-dark-100); border-radius: var(--pg-radius-md);">
                      <div style="color: var(--pg-dark-700); font-size: var(--pg-text-sm); line-height: 1.5;">
                          ${escapeHtml(user2.bio.length > 120 ? user2.bio.substring(0, 120) + "..." : user2.bio)}
                      </div>
                  </div>
                  ` : ""}

                  <div style="display: flex; gap: var(--pg-space-2); margin-top: var(--pg-space-4);">
                      <a href="/pengubook/user/${user2.discordId}" class="pg-btn pg-btn--primary pg-btn--sm" style="flex: 1;">
                          \u{1F464} View Profile
                      </a>
                  </div>
              </div>
              `;
    }).join("")}
        </div>
        `}
    </div>

    <script>
        // Batch load Discord usernames and avatars to avoid N+1 queries
        async function loadDiscordUserData() {
            const discordIds = [${users.map((user2) => `'${user2.discordId}'`).join(", ")}];

            if (discordIds.length === 0) return;

            try {
                const response = await fetch('/pengubook/api/discord-users-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ discordIds })
                });

                if (!response.ok) throw new Error('Batch fetch failed');

                const data = await response.json();

                if (data.success && data.users) {
                    // Update all user elements with batched data
                    Object.entries(data.users).forEach(([discordId, userData]) => {
                        const usernameEl = document.getElementById('username-' + discordId);
                        const avatarEl = document.getElementById('avatar-' + discordId);
                        const podiumUsernameEl = document.getElementById('podium-username-' + discordId);

                        if (usernameEl) usernameEl.textContent = userData.username;
                        if (avatarEl) avatarEl.src = userData.avatarURL;
                        if (podiumUsernameEl) podiumUsernameEl.textContent = userData.username;
                    });
                }
            } catch (error) {
                console.warn('Failed to load Discord user data:', error);
                // Fallback names are already in place
            }
        }

        // Load Discord data on page load
        loadDiscordUserData();

        // Add sparkle effects to podium on load
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                const podiumPlaces = document.querySelectorAll('.pg-podium-place');
                podiumPlaces.forEach((place, index) => {
                    setTimeout(() => {
                        place.style.transform = 'translateY(0px)';
                        place.style.opacity = '1';

                        // Add celebration effect for first place
                        if (index === 0) {
                            createCelebrationEffect(place);
                        }
                    }, index * 200);
                });
            }, 500);
        });

        function createCelebrationEffect(element) {
            const emojis = ['\u{1F389}', '\u2728', '\u{1F3C6}', '\u{1F451}', '\u2B50'];
            for (let i = 0; i < 5; i++) {
                setTimeout(() => {
                    const celebration = document.createElement('div');
                    celebration.innerHTML = emojis[Math.floor(Math.random() * emojis.length)];
                    celebration.style.position = 'absolute';
                    celebration.style.fontSize = '20px';
                    celebration.style.zIndex = '9999';
                    celebration.style.pointerEvents = 'none';

                    const rect = element.getBoundingClientRect();
                    celebration.style.left = rect.left + Math.random() * rect.width + 'px';
                    celebration.style.top = rect.top + Math.random() * rect.height + 'px';

                    document.body.appendChild(celebration);

                    celebration.animate([
                        { transform: 'translateY(0px) scale(0)', opacity: 1 },
                        { transform: 'translateY(-50px) scale(1)', opacity: 0 }
                    ], {
                        duration: 2000,
                        easing: 'ease-out'
                    }).onfinish = () => celebration.remove();
                }, i * 300);
            }
        }
    </script>`;
    res.send(generateBaseHTML(content, "\u{1F465} Browse Users - PenguBook", "browse", {
      user: currentUser,
      unreadCount
    }));
  } catch (error) {
    console.error("PenguBook browse error:", error);
    res.status(500).send("Error loading browse page");
  }
}
export {
  browseHandler
};
//# sourceMappingURL=browse.js.map
