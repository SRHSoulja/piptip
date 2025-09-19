// src/web/pengubook/routes/profile.ts - Profile page handlers
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

export async function profileHandler(req: Request, res: Response) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");

    const user = await findOrCreateUser(currentUser.discordId);
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);
    const referred = req.query.referred === 'true';

    const content = `
    <div class="pg-container">
        <h1 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">⚙️ Profile Settings</h1>

        ${referred ? `
        <div class="pg-success-banner" style="margin-bottom: var(--pg-space-6);">
            🎉 Welcome! You've successfully joined via referral link!
        </div>
        ` : ''}

        <div class="pg-card">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">Public Profile</h2>
            
            <form id="profileForm" style="display: flex; flex-direction: column; gap: var(--pg-space-4);">
                <div>
                    <label for="bio" style="display: block; margin-bottom: var(--pg-space-2); font-weight: 600; color: var(--pg-dark-700);">
                        Bio (Optional)
                    </label>
                    <textarea 
                        id="bio" 
                        name="bio" 
                        placeholder="Tell others about yourself..."
                        style="width: 100%; min-height: 100px; padding: var(--pg-space-3); border: 2px solid var(--pg-dark-300); border-radius: var(--pg-radius-md); font-family: inherit; resize: vertical;"
                    >${escapeHtml(user.bio || '')}</textarea>
                    <div style="font-size: var(--pg-text-sm); color: var(--pg-dark-600); margin-top: var(--pg-space-1);">
                        Keep it friendly and appropriate for all audiences.
                    </div>
                </div>

                <div>
                    <div style="display: flex; align-items: center; gap: var(--pg-space-2); margin-bottom: var(--pg-space-4);">
                        <input 
                            type="checkbox" 
                            id="showInPenguBook" 
                            ${user.showInPenguBook ? 'checked' : ''}
                            style="transform: scale(1.2);"
                        >
                        <label for="showInPenguBook" style="font-weight: 600; color: var(--pg-dark-700);">
                            Show my profile in PenguBook directory
                        </label>
                    </div>
                    <div style="font-size: var(--pg-text-sm); color: var(--pg-dark-600);">
                        When enabled, other users can find and view your profile in the Browse section.
                    </div>
                </div>

                <div style="display: flex; gap: var(--pg-space-3); flex-wrap: wrap;">
                    <button type="submit" class="pg-btn pg-btn--primary">
                        💾 Save Profile
                    </button>
                    <a href="/pengubook" class="pg-btn pg-btn--secondary">
                        ← Back to Home
                    </a>
                </div>
            </form>
        </div>

        <div class="pg-card" style="margin-top: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">Profile Stats</h2>
            
            <div class="pg-stats-grid">
                <div class="pg-stat-card">
                    <div class="pg-stat-value">${user.bioViewCount || 0}</div>
                    <div class="pg-stat-label">Profile Views</div>
                </div>
                <div class="pg-stat-card">
                    <div class="pg-stat-value">${user.wins || 0}</div>
                    <div class="pg-stat-label">Wins</div>
                </div>
                <div class="pg-stat-card">
                    <div class="pg-stat-value">${user.losses || 0}</div>
                    <div class="pg-stat-label">Losses</div>
                </div>
                <div class="pg-stat-card">
                    <div class="pg-stat-value">${user.ties || 0}</div>
                    <div class="pg-stat-label">Ties</div>
                </div>
            </div>
        </div>
    </div>

    <script>
        document.getElementById('profileForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = e.target.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = '💾 Saving...';
            submitBtn.disabled = true;

            try {
                const response = await fetch('/pengubook/api/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bio: document.getElementById('bio').value,
                        showInPenguBook: document.getElementById('showInPenguBook').checked
                    })
                });

                const data = await response.json();
                
                if (data.success) {
                    submitBtn.textContent = '✅ Saved!';
                    setTimeout(() => {
                        submitBtn.textContent = originalText;
                        submitBtn.disabled = false;
                    }, 2000);
                } else {
                    throw new Error(data.error || 'Failed to save');
                }
            } catch (error) {
                submitBtn.textContent = '❌ Error';
                console.error('Profile save error:', error);
                setTimeout(() => {
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                }, 2000);
            }
        });
    </script>`;

    res.send(generateBaseHTML(content, '⚙️ Profile Settings - PenguBook', 'profile', {
      user: currentUser,
      unreadCount
    }));
  } catch (error) {
    console.error("PenguBook profile error:", error);
    res.status(500).send("Error loading profile");
  }
}

export async function profilePostHandler(req: Request, res: Response) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const { bio, showInPenguBook } = req.body;
    const user = await findOrCreateUser(currentUser.discordId);

    const updateData: any = {};

    if (bio !== undefined) {
      const trimmedBio = bio.trim();
      if (trimmedBio.length > 500) {
        return res.status(400).json({ success: false, error: "Bio must be 500 characters or less" });
      }
      updateData.bio = trimmedBio || null;
      updateData.bioLastUpdated = new Date();
    }

    if (showInPenguBook !== undefined) {
      if (typeof showInPenguBook !== 'boolean') {
        return res.status(400).json({ success: false, error: "showInPenguBook must be a boolean" });
      }
      updateData.showInPenguBook = showInPenguBook;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData
    });

    res.json({ success: true });

  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ success: false, error: "Failed to update profile" });
  }
}