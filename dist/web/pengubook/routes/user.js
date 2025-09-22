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
export async function userHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser)
            return res.redirect("/auth/discord");
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

        let userTokens = [];
        let userBalances = {};

        // Load user's tokens and balances
        async function loadUserData() {
            try {
                const response = await fetch('/pengubook/api/user-data');
                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        userTokens = data.tokens || [];
                        userBalances = data.balances || {};
                    }
                }
            } catch (error) {
                console.error('Failed to load user data:', error);
            }
        }

        function showTipModal() {
            loadUserData().then(() => {
                showTipModalInternal();
            });
        }

        function showTipModalInternal() {
            const modal = document.createElement('div');
            modal.className = 'pg-modal-overlay';
            modal.innerHTML = \`
                <div class="pg-modal">
                    <div class="pg-modal-header">
                        <h2>💸 Send Tip to User#${targetUser.discordId.slice(-4)}</h2>
                        <button onclick="closeTipModal()" class="pg-modal-close">&times;</button>
                    </div>
                    <form id="tipForm" class="pg-modal-body">
                        <div class="pg-form-group">
                            <label for="tokenSelect">Token</label>
                            <select id="tokenSelect" required>
                                <option value="">Select a token...</option>
                                \${userTokens.map(token => \`
                                    <option value="\${token.id}" data-symbol="\${token.symbol}" data-decimals="\${token.decimals}">
                                        \${token.symbol} (Balance: \${userBalances[token.id] || '0'})
                                    </option>
                                \`).join('')}
                            </select>
                        </div>

                        <div class="pg-form-group">
                            <label for="tipAmount">Amount</label>
                            <input type="number" id="tipAmount" step="0.01" min="0.01" max="1000000" required>
                            <small class="pg-form-hint">Maximum 2 decimal places</small>
                        </div>

                        <div class="pg-form-group">
                            <label for="tipMessage">Message (optional)</label>
                            <textarea id="tipMessage" maxlength="200" placeholder="Add a message with your tip..."></textarea>
                            <small class="pg-form-hint"><span id="messageCount">0</span>/200 characters</small>
                        </div>

                        <div id="tipError" class="pg-error" style="display: none;"></div>

                        <div class="pg-modal-actions">
                            <button type="button" onclick="closeTipModal()" class="pg-btn pg-btn--secondary">Cancel</button>
                            <button type="submit" class="pg-btn pg-btn--primary">Send Tip</button>
                        </div>
                    </form>
                </div>
            \`;

            document.body.appendChild(modal);

            // Add event listeners
            const messageInput = document.getElementById('tipMessage');
            const messageCount = document.getElementById('messageCount');
            messageInput.addEventListener('input', function() {
                messageCount.textContent = this.value.length;
            });

            const form = document.getElementById('tipForm');
            form.addEventListener('submit', handleTipSubmit);

            // Close on outside click
            modal.addEventListener('click', function(e) {
                if (e.target === modal) closeTipModal();
            });
        }

        async function handleTipSubmit(e) {
            e.preventDefault();

            const errorDiv = document.getElementById('tipError');
            const submitBtn = e.target.querySelector('button[type="submit"]');

            // Clear previous errors
            errorDiv.style.display = 'none';
            errorDiv.textContent = '';

            // Get form data
            const tokenId = parseInt(document.getElementById('tokenSelect').value);
            const amount = parseFloat(document.getElementById('tipAmount').value);
            const message = document.getElementById('tipMessage').value.trim();

            // Validate
            if (!tokenId) {
                showTipError('Please select a token');
                return;
            }

            if (!amount || amount <= 0) {
                showTipError('Please enter a valid amount');
                return;
            }

            // Check decimal places
            const decimalPlaces = (amount.toString().split('.')[1] || '').length;
            if (decimalPlaces > 2) {
                showTipError('Amount can have maximum 2 decimal places');
                return;
            }

            // Check balance
            const selectedToken = userTokens.find(t => t.id === tokenId);
            const balance = parseFloat(userBalances[tokenId] || '0');
            if (amount > balance) {
                showTipError(\`Insufficient balance. You have \${balance} \${selectedToken.symbol}\`);
                return;
            }

            // Disable submit button
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';

            try {
                const response = await fetch('/pengubook/api/tip', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        targetDiscordId: '${targetUser.discordId}',
                        tokenId: tokenId,
                        amount: amount,
                        message: message
                    })
                });

                const result = await response.json();

                if (result.success) {
                    closeTipModal();
                    showSuccessMessage(\`Tip sent successfully! \${result.message || ''}\`);
                    // Refresh balances
                    await loadUserData();
                } else {
                    showTipError(result.error || 'Failed to send tip');
                }
            } catch (error) {
                showTipError('Failed to send tip. Please try again.');
                console.error('Tip error:', error);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send Tip';
            }
        }

        function showTipError(message) {
            const errorDiv = document.getElementById('tipError');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }

        function showSuccessMessage(message) {
            const toast = document.createElement('div');
            toast.className = 'pg-toast pg-toast--success';
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.classList.add('pg-toast--show');
            }, 100);

            setTimeout(() => {
                toast.classList.remove('pg-toast--show');
                setTimeout(() => document.body.removeChild(toast), 300);
            }, 3000);
        }

        function closeTipModal() {
            const modal = document.querySelector('.pg-modal-overlay');
            if (modal) {
                document.body.removeChild(modal);
            }
        }

        // Make functions global
        window.showTipModal = showTipModal;
        window.closeTipModal = closeTipModal;
    </script>`;
        res.send(generateBaseHTML(content, `👤 ${targetUser.discordId.slice(-4)} - PenguBook`, 'browse', {
            user: currentUser,
            unreadCount
        }));
    }
    catch (error) {
        console.error("PenguBook user profile error:", error);
        res.status(500).send("Error loading user profile");
    }
}
export async function userTipHandler(req, res) {
    try {
        const currentUser = getCurrentUser(req);
        if (!currentUser) {
            return res.status(401).json({ success: false, error: "Not authenticated" });
        }
        const { targetDiscordId, tokenId, amount, message } = req.body;
        // Validate inputs
        if (!targetDiscordId || !tokenId || !amount) {
            return res.status(400).json({
                success: false,
                error: "Missing required fields: targetDiscordId, tokenId, amount"
            });
        }
        // Validate amount
        if (typeof amount !== 'number' || amount <= 0 || amount > 1e15) {
            return res.status(400).json({
                success: false,
                error: "Invalid amount"
            });
        }
        // Check decimal places
        const decimalPlaces = (amount.toString().split('.')[1] || '').length;
        if (decimalPlaces > 2) {
            return res.status(400).json({
                success: false,
                error: "Amount can have maximum 2 decimal places"
            });
        }
        // Prevent self-tipping
        if (targetDiscordId === currentUser.discordId) {
            return res.status(400).json({
                success: false,
                error: "You cannot tip yourself"
            });
        }
        // Import tip processor
        const { processTip } = await import("../../../services/tip_processor.js");
        const { getDiscordClient } = await import("../../../services/discord_users.js");
        const client = getDiscordClient();
        if (!client) {
            return res.status(500).json({
                success: false,
                error: "Discord client not available"
            });
        }
        // Process the tip
        const tipData = {
            amount,
            tipType: 'direct',
            targetUserId: targetDiscordId,
            note: message || "",
            tokenId: parseInt(tokenId),
            userId: currentUser.discordId,
            guildId: null, // PenguBook tips don't belong to a specific guild
            channelId: null,
            fromPenguBook: true
        };
        const result = await processTip(tipData, client);
        if (result.success) {
            // Note: PenguBook message is automatically created by tip processor
            // when fromPenguBook: true is set in tipData above
            return res.json({
                success: true,
                message: result.message,
                details: result.details
            });
        }
        else {
            return res.status(400).json({
                success: false,
                error: result.message || "Failed to process tip"
            });
        }
    }
    catch (error) {
        console.error("User tip error:", error);
        res.status(500).json({ success: false, error: "Failed to process tip" });
    }
}
