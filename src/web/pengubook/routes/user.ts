// src/web/pengubook/routes/user.ts - User profile and tipping handlers
import { Request, Response } from "express";
import { getCurrentUser } from "../../auth.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { generateBaseHTML } from "../templates.js";
import { prisma } from "../../../services/db.js";

// HTML escaping function to prevent XSS
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function userHandler(req: Request, res: Response) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");

    const targetDiscordId = req.params.discordId;
    const currentDbUser = await findOrCreateUser(currentUser.discordId);
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);

    // Get target user's profile
    const targetUser = await prisma.user.findUnique({
      where: { discordId: targetDiscordId },
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
        createdAt: true,
        showInPenguBook: true
      }
    });

    if (!targetUser || !targetUser.showInPenguBook) {
      const content = `
      <div class="pg-container">
        <div class="pg-empty-state">
          <div class="pg-empty-state__icon">😔</div>
          <h2 class="pg-empty-state__title">User Not Found</h2>
          <p class="pg-empty-state__description">
            This user either doesn't exist or hasn't made their profile public yet.
          </p>
          <div style="margin-top: var(--pg-space-6);">
            <a href="/pengubook/browse" class="pg-btn pg-btn--primary">Browse Other Users</a>
          </div>
        </div>
      </div>`;
      return res.send(generateBaseHTML(content, '❌ User Not Found - PenguBook', 'browse', {
        user: currentUser,
        unreadCount
      }));
    }

    // Record profile view and increment view count (only if not viewing own profile)
    if (targetUser.discordId !== currentUser.discordId) {
      await prisma.user.update({
        where: { id: targetUser.id },
        data: { bioViewCount: { increment: 1 } }
      });
    }

    const socials = targetUser.socials ? JSON.parse(targetUser.socials) : [];
    const winRate = targetUser.wins + targetUser.losses > 0
      ? ((targetUser.wins / (targetUser.wins + targetUser.losses)) * 100).toFixed(1)
      : 'N/A';

    const content = `
    <div class="pg-container">
        <div style="display: flex; align-items: center; gap: var(--pg-space-4); margin-bottom: var(--pg-space-6);">
            <img src="https://cdn.discordapp.com/embed/avatars/${parseInt(targetUser.discordId.slice(-1)) % 6}.png"
                 alt="Profile Avatar"
                 class="pg-avatar"
                 style="width: 80px; height: 80px;"
                 id="user-avatar"
                 loading="lazy">
            <div style="flex: 1;">
                <h1 id="user-username" style="margin: 0 0 var(--pg-space-2) 0; color: var(--pg-dark-800);">
                    User#${targetUser.discordId.slice(-4)}
                </h1>
                <div style="color: var(--pg-dark-600);">
                    👀 ${targetUser.bioViewCount} profile views
                </div>
            </div>
        </div>

        ${targetUser.bio ? `
        <div class="pg-card" style="margin-bottom: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">About</h2>
            <div style="color: var(--pg-dark-700); line-height: 1.6; white-space: pre-wrap;">
                ${escapeHtml(targetUser.bio)}
            </div>
        </div>
        ` : ''}

        <div class="pg-card" style="margin-bottom: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">Stats</h2>
            
            <div class="pg-stats-grid">
                <div class="pg-stat-card">
                    <div class="pg-stat-value">${targetUser.wins}</div>
                    <div class="pg-stat-label">Wins</div>
                </div>
                <div class="pg-stat-card">
                    <div class="pg-stat-value">${targetUser.losses}</div>
                    <div class="pg-stat-label">Losses</div>
                </div>
                <div class="pg-stat-card">
                    <div class="pg-stat-value">${targetUser.ties}</div>
                    <div class="pg-stat-label">Ties</div>
                </div>
                <div class="pg-stat-card">
                    <div class="pg-stat-value">${winRate}%</div>
                    <div class="pg-stat-label">Win Rate</div>
                </div>
            </div>
        </div>

        <div style="display: flex; gap: var(--pg-space-3); flex-wrap: wrap;">
            <a href="/pengubook/browse" class="pg-btn pg-btn--secondary">
                ← Back to Browse
            </a>
            <button onclick="showTipModal()" class="pg-btn pg-btn--primary">
                💸 Send Tip
            </button>
        </div>
    </div>

    <script>
        // Load Discord username and avatar
        fetch('/pengubook/api/discord-user/${targetUser.discordId}')
            .then(res => res.ok ? res.json() : Promise.reject('Failed to load'))
            .then(data => {
                if (data.success) {
                    const usernameEl = document.getElementById('user-username');
                    const avatarEl = document.getElementById('user-avatar');
                    if (usernameEl) usernameEl.textContent = data.username;
                    if (avatarEl) avatarEl.src = data.avatarURL;
                }
            })
            .catch(() => {
                // Silently fail with fallback already in place
            });

        function showTipModal() {
            alert('Tip functionality will be implemented in the enhanced version!');
        }
    </script>`;

    res.send(generateBaseHTML(content, `👤 ${targetUser.discordId.slice(-4)} - PenguBook`, 'browse', {
      user: currentUser,
      unreadCount
    }));
  } catch (error) {
    console.error("PenguBook user profile error:", error);
    res.status(500).send("Error loading user profile");
  }
}

export async function userTipHandler(req: Request, res: Response) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    // For now, return a placeholder response
    res.status(501).json({ 
      success: false, 
      error: "Tip functionality not yet implemented in modular structure. Use Discord commands for tipping." 
    });

  } catch (error) {
    console.error("User tip error:", error);
    res.status(500).json({ success: false, error: "Failed to process tip" });
  }
}