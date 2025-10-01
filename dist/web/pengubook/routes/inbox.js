import { getCurrentUser } from "../../auth.js";
import { findOrCreateUser } from "../../../services/user_helpers.js";
import { getUnreadMessageCount } from "../../../interactions/buttons/pengubook.js";
import { generateBaseHTML } from "../templates.js";
import { prisma } from "../../../services/db.js";
import { getDiscordClient } from "../../../services/discord_users.js";
function escapeHtml(unsafe) {
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
async function inboxHandler(req, res) {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");
    const user = await findOrCreateUser(currentUser.discordId);
    const currentUnreadCount = await getUnreadMessageCount(currentUser.discordId);
    const messages = await prisma.penguBookMessage.findMany({
      where: { toUserId: user.id },
      include: {
        from: true,
        tip: {
          include: { Token: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    const client = getDiscordClient();
    const discordIdsToFetch = messages.filter((msg) => msg.from?.discordId && msg.from.discordId !== msg.from.id.toString()).map((msg) => msg.from.discordId);
    const uniqueDiscordIds = [...new Set(discordIdsToFetch)];
    const discordUserMap = /* @__PURE__ */ new Map();
    if (client && client.isReady() && uniqueDiscordIds.length > 0) {
      await Promise.allSettled(
        uniqueDiscordIds.map(async (discordId) => {
          try {
            const discordUser = await client.users.fetch(discordId);
            const displayName = discordUser.displayName || discordUser.username;
            if (displayName) {
              discordUserMap.set(discordId, displayName);
            }
          } catch (error) {
            discordUserMap.set(discordId, `Player ${discordId.slice(-4)}`);
          }
        })
      );
    }
    const enhancedMessages = messages.map((msg) => {
      let senderName = "Unknown User";
      if (msg.from?.discordId) {
        if (msg.from.discordId === msg.from.id.toString()) {
          senderName = "System";
        } else {
          senderName = discordUserMap.get(msg.from.discordId) || `Player ${msg.from.discordId.slice(-4)}`;
        }
      }
      return {
        ...msg,
        senderName
      };
    });
    await prisma.penguBookMessage.updateMany({
      where: { toUserId: user.id, read: false },
      data: { read: true }
    });
    const content = `
    <div class="pg-container">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--pg-space-6);">
            <h1 style="margin: 0; color: var(--pg-dark-800);">\u{1F4E8} Your Messages</h1>
            <button onclick="showComposeModal()" class="pg-btn pg-btn--primary">
                \u270D\uFE0F Compose Message
            </button>
        </div>

        ${messages.length === 0 ? `
        <div class="pg-empty-state">
            <div class="pg-empty-state__icon">\u{1F4ED}</div>
            <h2 class="pg-empty-state__title">No messages yet</h2>
            <p class="pg-empty-state__description">
                Your tip notifications and messages will appear here! Start by browsing users and sending some tips.
            </p>
            <div style="margin-top: var(--pg-space-6);">
                <a href="/pengubook/browse" class="pg-btn pg-btn--primary">Browse Users</a>
            </div>
        </div>
        ` : enhancedMessages.map((msg) => `
        <div class="pg-message ${msg.tip ? "pg-message--tip" : ""}">
            <div class="pg-message-header">
                <span class="pg-message-sender">
                    ${msg.senderName}
                </span>
                <span class="pg-message-time">
                    ${new Date(msg.createdAt).toLocaleString()}
                </span>
            </div>
            <div class="pg-message-content">
                ${msg.tip ? `
                <div class="pg-tip-amount">
                    \u{1F4B0} Received ${Number(msg.tip.amountAtomic / Math.pow(10, msg.tip.Token.decimals)).toFixed(2)} ${msg.tip.Token.symbol}
                </div>
                ` : ""}
                ${escapeHtml(msg.message || "")}
            </div>
            ${msg.from && msg.from.discordId && msg.from.discordId !== msg.from.id ? `
            <div class="pg-message-actions">
                <button onclick="replyToMessage('${msg.from.discordId}', '${msg.from.discordId.slice(-4)}')" class="pg-btn pg-btn--sm pg-btn--outline">
                    \u21A9\uFE0F Reply
                </button>
            </div>
            ` : ""}
        </div>
        `).join("")}
    </div>

    <script>
        // Message composition functionality
        function showComposeModal() {
            const modal = document.createElement('div');
            modal.className = 'pg-modal-overlay';
            modal.innerHTML = \`
                <div class="pg-modal">
                    <div class="pg-modal-header">
                        <h2>\u270D\uFE0F Compose Message</h2>
                        <button onclick="closeComposeModal()" class="pg-modal-close">&times;</button>
                    </div>
                    <form id="composeForm" class="pg-modal-body">
                        <div class="pg-form-group" style="position: relative;">
                            <label for="recipientDiscordId">Recipient (Discord ID)</label>
                            <input type="text" id="recipientDiscordId" placeholder="Try: 403, 843, or 104..." required autocomplete="off">
                            <div id="userAutocomplete" style="position: absolute; top: calc(100% + 5px); left: 0; right: 0; background: var(--pg-dark-300, #2a2a2a); border: 1px solid var(--pg-dark-500, #444); border-radius: 8px; max-height: 200px; overflow-y: auto; display: none; z-index: 10000; box-shadow: 0 4px 6px rgba(0,0,0,0.3);"></div>
                            <small class="pg-form-hint">Start typing to search for users by name or Discord ID</small>
                        </div>

                        <div class="pg-form-group">
                            <label for="messageContent">Message</label>
                            <textarea id="messageContent" maxlength="500" placeholder="Type your message here..." required></textarea>
                            <small class="pg-form-hint"><span id="messageCharCount">0</span>/500 characters</small>
                        </div>

                        <div id="composeError" class="pg-error" style="display: none;"></div>

                        <div class="pg-modal-actions">
                            <button type="button" onclick="closeComposeModal()" class="pg-btn pg-btn--secondary">Cancel</button>
                            <button type="submit" class="pg-btn pg-btn--primary">Send Message</button>
                        </div>
                    </form>
                </div>
            \`;

            document.body.appendChild(modal);

            // Add event listeners
            const messageInput = document.getElementById('messageContent');
            const charCount = document.getElementById('messageCharCount');
            messageInput.addEventListener('input', function() {
                charCount.textContent = this.value.length;
            });

            const form = document.getElementById('composeForm');
            form.addEventListener('submit', handleMessageSubmit);

            // Close on outside click
            modal.addEventListener('click', function(e) {
                if (e.target === modal) closeComposeModal();
            });

            // Focus on recipient input
            const recipientInput = document.getElementById('recipientDiscordId');
            recipientInput.focus();

            // Add autocomplete functionality
            setupAutocomplete(recipientInput);
        }

        async function handleMessageSubmit(e) {
            e.preventDefault();

            const errorDiv = document.getElementById('composeError');
            const submitBtn = e.target.querySelector('button[type="submit"]');

            // Clear previous errors
            errorDiv.style.display = 'none';
            errorDiv.textContent = '';

            // Get form data
            let recipientId = document.getElementById('recipientDiscordId').value.trim();
            const message = document.getElementById('messageContent').value.trim();

            // Validate
            if (!recipientId) {
                showComposeError('Please enter a recipient Discord ID');
                return;
            }

            if (!message) {
                showComposeError('Please enter a message');
                return;
            }

            // Parse recipient ID if in User#1234 format
            if (recipientId.startsWith('User#')) {
                showComposeError('Please enter the full Discord ID, not the User#1234 format');
                return;
            }

            // Validate Discord ID format (should be a long number)
            if (!/^\\d{17,20}$/.test(recipientId)) {
                showComposeError('Please enter a valid Discord ID (17-20 digit number)');
                return;
            }

            // Disable submit button
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';

            try {
                const response = await fetch('/pengubook/api/send-message', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        targetDiscordId: recipientId,
                        message: message
                    })
                });

                const result = await response.json();

                if (result.success) {
                    closeComposeModal();
                    showSuccessToast('Message sent successfully!');
                    // Reload the page to show the sent message (if it's to current user)
                    setTimeout(() => window.location.reload(), 1000);
                } else {
                    showComposeError(result.error || 'Failed to send message');
                }
            } catch (error) {
                showComposeError('Failed to send message. Please try again.');
                console.error('Message send error:', error);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send Message';
            }
        }

        function showComposeError(message) {
            const errorDiv = document.getElementById('composeError');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }

        function showSuccessToast(message) {
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

        function closeComposeModal() {
            const modal = document.querySelector('.pg-modal-overlay');
            if (modal) {
                document.body.removeChild(modal);
            }
        }

        // Reply to a specific message
        function replyToMessage(recipientDiscordId, userHandle) {
            const modal = document.createElement('div');
            modal.className = 'pg-modal-overlay';
            modal.innerHTML = \`
                <div class="pg-modal">
                    <div class="pg-modal-header">
                        <h2>\u21A9\uFE0F Reply to User#\${userHandle}</h2>
                        <button onclick="closeComposeModal()" class="pg-modal-close">&times;</button>
                    </div>
                    <form id="composeForm" class="pg-modal-body">
                        <div class="pg-form-group">
                            <label for="recipientDiscordId">Recipient</label>
                            <input type="text" id="recipientDiscordId" value="\${recipientDiscordId}" readonly style="background: var(--pg-dark-200); cursor: not-allowed;">
                            <small class="pg-form-hint">Replying to User#\${userHandle}</small>
                        </div>

                        <div class="pg-form-group">
                            <label for="messageContent">Reply Message</label>
                            <textarea id="messageContent" maxlength="500" placeholder="Type your reply here..." required></textarea>
                            <small class="pg-form-hint"><span id="messageCharCount">0</span>/500 characters</small>
                        </div>

                        <div id="composeError" class="pg-error" style="display: none;"></div>

                        <div class="pg-modal-actions">
                            <button type="button" onclick="closeComposeModal()" class="pg-btn pg-btn--secondary">Cancel</button>
                            <button type="submit" class="pg-btn pg-btn--primary">Send Reply</button>
                        </div>
                    </form>
                </div>
            \`;

            document.body.appendChild(modal);

            // Add event listeners
            const messageInput = document.getElementById('messageContent');
            const charCount = document.getElementById('messageCharCount');
            messageInput.addEventListener('input', function() {
                charCount.textContent = this.value.length;
            });

            const form = document.getElementById('composeForm');
            form.addEventListener('submit', handleMessageSubmit);

            // Close on outside click
            modal.addEventListener('click', function(e) {
                if (e.target === modal) closeComposeModal();
            });

            // Focus on message input for replies
            messageInput.focus();
        }

        // Autocomplete functionality
        function setupAutocomplete(input) {
            const autocompleteDiv = document.getElementById('userAutocomplete');
            let searchTimeout;
            let selectedIndex = -1;

            input.addEventListener('input', async function() {
                clearTimeout(searchTimeout);
                const query = this.value.trim();

                if (query.length < 2) {
                    autocompleteDiv.style.display = 'none';
                    return;
                }

                // Debounce the search
                searchTimeout = setTimeout(async () => {
                    try {
                        const response = await fetch('/pengubook/api/search-users?q=' + encodeURIComponent(query));
                        const data = await response.json();

                        if (data.success && data.users.length > 0) {
                            displayAutocompleteResults(data.users);
                        } else {
                            autocompleteDiv.style.display = 'none';
                        }
                    } catch (error) {
                        console.error('Search error:', error);
                        autocompleteDiv.style.display = 'none';
                    }
                }, 300);
            });

            function displayAutocompleteResults(users) {
                selectedIndex = -1;
                autocompleteDiv.innerHTML = users.map((user, index) => {
                    const bioHtml = user.bioText ? '<div style="font-size: 12px; color: var(--pg-accent-secondary); opacity: 0.6; margin-top: 4px;">' + user.bioText + '</div>' : '';
                    return '<div class="autocomplete-item" data-index="' + index + '" data-discord-id="' + user.discordId + '" style="padding: 12px; cursor: pointer; border-bottom: 1px solid var(--pg-dark-400); display: flex; align-items: center; gap: 12px;">' +
                           '<img src="' + user.avatarURL + '" alt="" style="width: 32px; height: 32px; border-radius: 50%;">' +
                           '<div style="flex: 1;">' +
                           '<div style="font-weight: 500;">' + user.displayName + '</div>' +
                           '<div style="font-size: 12px; color: var(--pg-accent-secondary); opacity: 0.8;">' + user.discordId + '</div>' +
                           bioHtml +
                           '</div>' +
                           '</div>';
                }).join('');

                autocompleteDiv.style.display = 'block';

                // Add click handlers
                const items = autocompleteDiv.querySelectorAll('.autocomplete-item');
                items.forEach(item => {
                    item.addEventListener('click', function() {
                        const discordId = this.dataset.discordId;
                        input.value = discordId;
                        autocompleteDiv.style.display = 'none';
                        // Focus on message content
                        document.getElementById('messageContent').focus();
                    });

                    // Hover effect
                    item.addEventListener('mouseenter', function() {
                        items.forEach(i => i.style.backgroundColor = '');
                        this.style.backgroundColor = 'var(--pg-dark-400)';
                        selectedIndex = parseInt(this.dataset.index);
                    });
                });
            }

            // Handle keyboard navigation
            input.addEventListener('keydown', function(e) {
                const items = autocompleteDiv.querySelectorAll('.autocomplete-item');

                if (items.length === 0) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                    updateSelection(items);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selectedIndex = Math.max(selectedIndex - 1, 0);
                    updateSelection(items);
                } else if (e.key === 'Enter' && selectedIndex >= 0) {
                    e.preventDefault();
                    const selectedItem = items[selectedIndex];
                    if (selectedItem) {
                        input.value = selectedItem.dataset.discordId;
                        autocompleteDiv.style.display = 'none';
                        document.getElementById('messageContent').focus();
                    }
                } else if (e.key === 'Escape') {
                    autocompleteDiv.style.display = 'none';
                }
            });

            function updateSelection(items) {
                items.forEach((item, index) => {
                    if (index === selectedIndex) {
                        item.style.backgroundColor = 'var(--pg-dark-400)';
                        item.scrollIntoView({ block: 'nearest' });
                    } else {
                        item.style.backgroundColor = '';
                    }
                });
            }

            // Hide autocomplete when clicking outside
            document.addEventListener('click', function(e) {
                if (!input.contains(e.target) && !autocompleteDiv.contains(e.target)) {
                    autocompleteDiv.style.display = 'none';
                }
            });
        }

        // Make functions global
        window.showComposeModal = showComposeModal;
        window.closeComposeModal = closeComposeModal;
        window.replyToMessage = replyToMessage;
    </script>`;
    res.send(generateBaseHTML(content, "\u{1F4E8} Inbox - PenguBook", "inbox", {
      user: currentUser,
      unreadCount: currentUnreadCount
    }));
  } catch (error) {
    console.error("PenguBook inbox error:", error);
    res.status(500).send("Error loading inbox");
  }
}
export {
  inboxHandler
};
//# sourceMappingURL=inbox.js.map
