// src/web/pengubook_enhanced.ts - Enhanced PenguBook interface with modern design system
import { Router, Request, Response } from "express";
import { requireAuth, getCurrentUser } from "./auth.js";
import { prisma } from "../services/db.js";
import { findOrCreateUser } from "../services/user_helpers.js";
import { getUnreadMessageCount } from "../interactions/buttons/pengubook.js";
import { getActiveTokens, formatAmount, getTokenByAddress } from "../services/token.js";
import { processTip } from "../services/tip_processor.js";
import { getDiscordClient } from "../services/discord_users.js";
import { getConfig } from "../config.js";
import { getReferralStats, createReferralCode } from "../services/referrals.js";
import fs from "fs";
import path from "path";

export const pengubookEnhancedRouter = Router();

// Load the enhanced CSS file
const cssPath = path.join(process.cwd(), 'src/web/static/pengubook.css');
let enhancedCSS = '';
try {
  enhancedCSS = fs.readFileSync(cssPath, 'utf8');
} catch (error) {
  console.warn('Enhanced CSS file not found, falling back to inline styles');
  enhancedCSS = '/* Enhanced CSS not available - falling back to basic styles */';
}

// Middleware to require authentication for all PenguBook routes
pengubookEnhancedRouter.use(requireAuth);

// Base HTML template with enhanced design system
function generateBaseHTML(content: string, title: string = 'PenguBook', currentPage: string = '', userData: any = null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <meta name="description" content="PenguBook - Social crypto tipping on Abstract Chain">

    <style>
    ${enhancedCSS}
    </style>

    <!-- Preload critical resources -->
    <link rel="preconnect" href="https://cdn.discordapp.com">
    <link rel="dns-prefetch" href="https://discord.com">

    <!-- Performance optimizations -->
    <meta name="theme-color" content="#1f2937">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
</head>
<body>
    <!-- Enhanced Header -->
    <header class="pg-header">
        <a href="/pengubook" class="pg-header__logo">
            🐧 PenguBook
        </a>
        ${userData ? `
        <div class="pg-header__user">
            <span class="pg-header__user-name">Welcome, ${userData.user.username}</span>
            <img src="${userData.user.avatar}" alt="Avatar" class="pg-avatar" loading="lazy">
            <a href="/auth/logout" class="pg-btn pg-btn--secondary pg-btn--sm">Logout</a>
        </div>
        ` : ''}
    </header>

    <!-- Enhanced Navigation -->
    <nav class="pg-nav" role="navigation" aria-label="Main navigation">
        <a href="/pengubook" class="pg-nav__link ${currentPage === 'home' ? 'pg-nav__link--active' : ''}" aria-current="${currentPage === 'home' ? 'page' : 'false'}">
            🏠 Home
        </a>
        <a href="/pengubook/inbox" class="pg-nav__link ${currentPage === 'inbox' ? 'pg-nav__link--active' : ''}">
            📨 Inbox${userData?.unreadCount > 0 ? `<span class="pg-nav__badge">${userData.unreadCount}</span>` : ''}
        </a>
        <a href="/pengubook/browse" class="pg-nav__link ${currentPage === 'browse' ? 'pg-nav__link--active' : ''}">
            👥 Browse Users
        </a>
        <a href="/pengubook/profile" class="pg-nav__link ${currentPage === 'profile' ? 'pg-nav__link--active' : ''}">
            ⚙️ Profile
        </a>
    </nav>

    <!-- Main Content -->
    <main role="main">
        ${content}
    </main>

    <!-- Mobile Bottom Navigation -->
    <nav class="pg-nav-mobile" role="navigation" aria-label="Mobile navigation">
        <a href="/pengubook" class="pg-nav-mobile__item ${currentPage === 'home' ? 'pg-nav-mobile__item--active' : ''}" aria-current="${currentPage === 'home' ? 'page' : 'false'}">
            <span class="pg-nav-mobile__icon">🏠</span>
            <span class="pg-nav-mobile__label">Home</span>
        </a>
        <a href="/pengubook/inbox" class="pg-nav-mobile__item ${currentPage === 'inbox' ? 'pg-nav-mobile__item--active' : ''}">
            <span class="pg-nav-mobile__icon">📨</span>
            <span class="pg-nav-mobile__label">Inbox</span>
            ${userData?.unreadCount > 0 ? `<span class="pg-nav-mobile__badge">${userData.unreadCount}</span>` : ''}
        </a>
        <a href="/pengubook/browse" class="pg-nav-mobile__item ${currentPage === 'browse' ? 'pg-nav-mobile__item--active' : ''}">
            <span class="pg-nav-mobile__icon">👥</span>
            <span class="pg-nav-mobile__label">Browse</span>
        </a>
        <a href="/pengubook/profile" class="pg-nav-mobile__item ${currentPage === 'profile' ? 'pg-nav-mobile__item--active' : ''}">
            <span class="pg-nav-mobile__icon">⚙️</span>
            <span class="pg-nav-mobile__label">Profile</span>
        </a>
    </nav>

    <!-- Loading overlay for better UX -->
    <div id="loadingOverlay" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 20, 25, 0.8); backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center;">
        <div class="pg-card" style="text-align: center; min-width: 200px;">
            <div class="pg-loading" style="width: 40px; height: 40px; margin: 0 auto 1rem;"></div>
            <p>Loading...</p>
        </div>
    </div>

    <!-- Enhanced JavaScript -->
    <script>
        // Performance monitoring
        window.addEventListener('load', () => {
            console.log('🐧 PenguBook Enhanced loaded in', performance.now().toFixed(2), 'ms');
        });

        // Global loading state management
        window.setGlobalLoading = (isLoading) => {
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) {
                overlay.style.display = isLoading ? 'flex' : 'none';
            }
        };

        // Enhanced form handling with loading states
        window.enhancedFormSubmit = async (form, submitHandler) => {
            const submitBtn = form.querySelector('[type="submit"]');
            const originalText = submitBtn?.textContent;

            try {
                if (submitBtn) {
                    submitBtn.classList.add('pg-loading');
                    submitBtn.disabled = true;
                }

                await submitHandler();

            } catch (error) {
                console.error('Form submission error:', error);
                throw error;
            } finally {
                if (submitBtn) {
                    submitBtn.classList.remove('pg-loading');
                    submitBtn.disabled = false;
                    if (originalText) submitBtn.textContent = originalText;
                }
            }
        };

        // Accessibility enhancements
        document.addEventListener('keydown', (e) => {
            // Skip links for keyboard navigation
            if (e.key === 'Tab' && !e.shiftKey && document.activeElement === document.body) {
                const firstFocusable = document.querySelector('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
                if (firstFocusable) {
                    e.preventDefault();
                    firstFocusable.focus();
                }
            }
        });

        // Auto-refresh unread count every 30 seconds
        ${userData ? `
        setInterval(async () => {
            try {
                const response = await fetch('/pengubook/api/unread-count');
                if (response.ok) {
                    const data = await response.json();
                    const badge = document.querySelector('.pg-nav__badge');
                    const inboxLink = document.querySelector('a[href="/pengubook/inbox"]');

                    if (data.count > 0) {
                        if (badge) {
                            badge.textContent = data.count;
                        } else if (inboxLink) {
                            inboxLink.innerHTML += '<span class="pg-nav__badge">' + data.count + '</span>';
                        }
                    } else if (badge) {
                        badge.remove();
                    }
                }
            } catch (error) {
                console.error('Failed to refresh unread count:', error);
            }
        }, 30000);
        ` : ''}

        // Skeleton loading utilities
        window.showSkeletonGrid = (container, count = 6) => {
            const skeletonHTML = Array(count).fill(0).map(() => \`
                <div class="pg-profile-card-enhanced">
                    <div class="pg-profile-card-enhanced__header">
                        <div class="pg-skeleton pg-skeleton--avatar"></div>
                        <div style="flex: 1;">
                            <div class="pg-skeleton pg-skeleton--title"></div>
                            <div class="pg-skeleton pg-skeleton--text" style="width: 70%;"></div>
                        </div>
                    </div>
                    <div style="margin: var(--pg-space-4) 0;">
                        <div class="pg-skeleton pg-skeleton--text"></div>
                        <div class="pg-skeleton pg-skeleton--text" style="width: 80%;"></div>
                        <div class="pg-skeleton pg-skeleton--text" style="width: 60%;"></div>
                    </div>
                    <div class="pg-profile-card-enhanced__stats">
                        <div class="pg-profile-card-enhanced__stat">
                            <div class="pg-skeleton pg-skeleton--text" style="width: 30px; height: 24px;"></div>
                            <div class="pg-skeleton pg-skeleton--text" style="width: 40px; height: 16px;"></div>
                        </div>
                        <div class="pg-profile-card-enhanced__stat">
                            <div class="pg-skeleton pg-skeleton--text" style="width: 30px; height: 24px;"></div>
                            <div class="pg-skeleton pg-skeleton--text" style="width: 40px; height: 16px;"></div>
                        </div>
                        <div class="pg-profile-card-enhanced__stat">
                            <div class="pg-skeleton pg-skeleton--text" style="width: 30px; height: 24px;"></div>
                            <div class="pg-skeleton pg-skeleton--text" style="width: 40px; height: 16px;"></div>
                        </div>
                    </div>
                </div>
            \`).join('');

            if (container) {
                container.innerHTML = skeletonHTML;
                container.classList.add('pg-grid', 'pg-grid--2');
            }
        };

        window.showSearchSkeleton = () => {
            const container = document.querySelector('.pg-grid');
            if (container) {
                window.showSkeletonGrid(container, 4);
            }
        };

        // Enhanced search with skeleton loading
        document.addEventListener('DOMContentLoaded', () => {
            const searchForm = document.querySelector('.pg-search-enhanced');
            const searchInput = document.getElementById('searchInput');

            if (searchForm && searchInput) {
                let searchTimeout;

                // Real-time search with debounce
                let lastSearchValue = searchInput.value;
                searchInput.addEventListener('input', () => {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        if (searchInput.value !== lastSearchValue) {
                            window.showSearchSkeleton();
                            searchForm.submit();
                        }
                    }, 500);
                });

                // Show skeleton on form submit
                searchForm.addEventListener('submit', () => {
                    window.showSearchSkeleton();
                });
            }

            // Page navigation with skeleton loading
            document.querySelectorAll('a[href*="/pengubook/browse"]').forEach(link => {
                if (link.href.includes('page=') || link.href.includes('search=')) {
                    link.addEventListener('click', () => {
                        window.showSearchSkeleton();
                    });
                }
            });
        });
    </script>
</body>
</html>`;
}

// GET /pengubook - Enhanced Main PenguBook page
pengubookEnhancedRouter.get("/", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    const referralCode = req.query.ref as string;

    if (!currentUser) {
      if (referralCode) {
        (req.session as any).pendingReferralCode = referralCode;
      }
      return res.redirect("/auth/discord");
    }

    const user = await findOrCreateUser(currentUser.discordId);
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);

    // Process referral code logic (same as before)
    if (referralCode || (req.session as any).pendingReferralCode) {
      const codeToProcess = referralCode || (req.session as any).pendingReferralCode;
      if (codeToProcess) {
        const { processReferralSignup } = await import("../services/referrals.js");
        const success = await processReferralSignup(codeToProcess, currentUser.discordId);

        if (success) {
          delete (req.session as any).pendingReferralCode;
          return res.redirect("/pengubook/profile?referred=true");
        }

        delete (req.session as any).pendingReferralCode;
      }
    }

    const content = `
    <div class="pg-container">
        <!-- Hero Welcome Section -->
        <div class="pg-card pg-card--gradient">
            <div style="text-align: center;">
                <h1 style="margin: 0 0 1rem 0; font-size: var(--pg-text-4xl); font-weight: 900;">
                    🐧 Welcome to PenguBook Web!
                </h1>
                <p style="margin: 0; font-size: var(--pg-text-lg); opacity: 0.9; max-width: 600px; margin: 0 auto;">
                    Your crypto tipping companion is now available on the web. Send tips, manage your profile, and stay connected with your community!
                </p>
            </div>
        </div>

        <!-- Feature Cards Grid -->
        <div class="pg-grid pg-grid--3">
            <div class="pg-feature-card">
                <span class="pg-feature-icon">💸</span>
                <h3 class="pg-feature-title">Send Tips</h3>
                <p class="pg-feature-description">
                    Tip users across your servers with our multi-token support. Fast, secure, and fun!
                </p>
                <a href="/pengubook/browse" class="pg-btn pg-btn--primary">Start Tipping</a>
            </div>

            <div class="pg-feature-card">
                <span class="pg-feature-icon">📨</span>
                <h3 class="pg-feature-title">Message Center</h3>
                <p class="pg-feature-description">
                    View your tip notifications and messages in one organized place.
                </p>
                <a href="/pengubook/inbox" class="pg-btn pg-btn--primary">View Messages</a>
            </div>

            <div class="pg-feature-card">
                <span class="pg-feature-icon">⚙️</span>
                <h3 class="pg-feature-title">Profile Settings</h3>
                <p class="pg-feature-description">
                    Manage your bio, social links, and preferences with ease.
                </p>
                <a href="/pengubook/profile" class="pg-btn pg-btn--primary">Edit Profile</a>
            </div>
        </div>

        <!-- Real-time Activity Feed -->
        <div class="pg-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--pg-space-6);">
                <h2 style="margin: 0; color: var(--pg-dark-800);">🔥 Live Activity Feed</h2>
                <div class="pg-activity-status">
                    <span class="pg-activity-pulse"></span>
                    <span style="font-size: var(--pg-text-sm); color: var(--pg-dark-600);">Live</span>
                </div>
            </div>

            <div id="activityFeed" class="pg-activity-feed">
                <!-- Activity items will be loaded here -->
                <div class="pg-activity-loading">
                    <div class="pg-spinner"></div>
                    <p style="margin: var(--pg-space-3) 0 0 0; color: var(--pg-dark-600);">Loading activity...</p>
                </div>
            </div>

            <div style="text-align: center; margin-top: var(--pg-space-6);">
                <button id="loadMoreActivity" class="pg-btn pg-btn--outline" style="display: none;">
                    Load More Activity
                </button>
            </div>
        </div>

        ${user?.bio ? `
        <!-- User Bio Section -->
        <div class="pg-card">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">Your Bio</h2>
            <p style="margin: 0 0 var(--pg-space-4) 0; line-height: 1.7; color: var(--pg-dark-700);">
                ${user.bio}
            </p>
            ${user.socials ? `
            <div>
                <strong style="color: var(--pg-dark-800); margin-bottom: var(--pg-space-3); display: block;">Social Links:</strong>
                <div class="pg-social-links">
                    ${JSON.parse(user.socials).map((social: any) =>
                        `<a href="${social.url}" target="_blank" rel="noopener noreferrer" class="pg-social-link">${social.platform}</a>`
                    ).join('')}
                </div>
            </div>
            ` : ''}
        </div>
        ` : `
        <!-- Getting Started CTA -->
        <div class="pg-card" style="text-align: center; border: 2px dashed var(--pg-dark-400);">
            <h3 style="margin: 0 0 var(--pg-space-3) 0; color: var(--pg-dark-700);">Get Started</h3>
            <p style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-600);">
                Complete your profile to get the most out of PenguBook!
            </p>
            <a href="/pengubook/profile" class="pg-btn pg-btn--outline">Set Up Profile</a>
        </div>
        `}

        <!-- Activity Feed JavaScript -->
        <script>
            // Activity feed management
            let currentActivityPage = 1;
            let isLoadingActivity = false;
            let hasMoreActivity = true;

            // Format time relative to now
            function formatTimeAgo(timestamp) {
                const now = new Date();
                const time = new Date(timestamp);
                const diffMs = now - time;
                const diffMinutes = Math.floor(diffMs / (1000 * 60));
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

                if (diffMinutes < 1) return 'Just now';
                if (diffMinutes < 60) return \`\${diffMinutes}m ago\`;
                if (diffHours < 24) return \`\${diffHours}h ago\`;
                if (diffDays < 7) return \`\${diffDays}d ago\`;
                return time.toLocaleDateString();
            }

            // Generate activity item HTML
            function generateActivityHTML(activity) {
                const timeAgo = formatTimeAgo(activity.timestamp);

                switch (activity.type) {
                    case 'tip':
                        return \`
                            <div class="pg-activity-item" data-id="\${activity.id}">
                                <div class="pg-activity-icon pg-activity-icon--tip">💸</div>
                                <div class="pg-activity-content">
                                    <p class="pg-activity-text">
                                        <strong>User#\${activity.data.fromUser.slice(-4)}</strong> tipped
                                        <strong>User#\${activity.data.toUser.slice(-4)}</strong>
                                        \${activity.data.message ? \` - "\${activity.data.message}"\` : ''}
                                    </p>
                                    <div class="pg-activity-meta">
                                        <span class="pg-activity-time">\${timeAgo}</span>
                                        <span class="pg-activity-amount">\${activity.data.amount}</span>
                                    </div>
                                </div>
                            </div>
                        \`;

                    case 'profile_update':
                        return \`
                            <div class="pg-activity-item" data-id="\${activity.id}">
                                <div class="pg-activity-icon pg-activity-icon--user">👤</div>
                                <div class="pg-activity-content">
                                    <p class="pg-activity-text">
                                        <strong>User#\${activity.data.discordId.slice(-4)}</strong> updated their profile
                                        \${activity.data.bio ? \` - "\${activity.data.bio}"\` : ''}
                                    </p>
                                    <div class="pg-activity-meta">
                                        <span class="pg-activity-time">\${timeAgo}</span>
                                        <span class="pg-activity-badge">Profile</span>
                                    </div>
                                </div>
                            </div>
                        \`;

                    case 'match':
                        const winnerText = activity.data.winner ?
                            \`<strong>User#\${activity.data.winner.slice(-4)}</strong> won!\` :
                            'Match ended in a tie!';
                        return \`
                            <div class="pg-activity-item" data-id="\${activity.id}">
                                <div class="pg-activity-icon pg-activity-icon--match">⚔️</div>
                                <div class="pg-activity-content">
                                    <p class="pg-activity-text">
                                        <strong>User#\${activity.data.user1.slice(-4)}</strong> vs
                                        <strong>User#\${activity.data.user2.slice(-4)}</strong> - \${winnerText}
                                    </p>
                                    <div class="pg-activity-meta">
                                        <span class="pg-activity-time">\${timeAgo}</span>
                                        <span class="pg-activity-badge">Match</span>
                                    </div>
                                </div>
                            </div>
                        \`;

                    default:
                        return '';
                }
            }

            // Load activity feed
            async function loadActivityFeed(page = 1, append = false) {
                if (isLoadingActivity) return;

                isLoadingActivity = true;
                const feedContainer = document.getElementById('activityFeed');
                const loadMoreBtn = document.getElementById('loadMoreActivity');

                if (!append) {
                    feedContainer.innerHTML = \`
                        <div class="pg-activity-loading">
                            <div class="pg-spinner"></div>
                            <p style="margin: var(--pg-space-3) 0 0 0; color: var(--pg-dark-600);">Loading activity...</p>
                        </div>
                    \`;
                }

                try {
                    const response = await fetch(\`/pengubook/api/activity-feed?page=\${page}&limit=20\`);
                    const data = await response.json();

                    if (data.success && data.activities.length > 0) {
                        const activitiesHTML = data.activities.map(generateActivityHTML).join('');

                        if (append) {
                            const loadingEl = feedContainer.querySelector('.pg-activity-loading');
                            if (loadingEl) loadingEl.remove();
                            feedContainer.insertAdjacentHTML('beforeend', activitiesHTML);
                        } else {
                            feedContainer.innerHTML = activitiesHTML;
                        }

                        hasMoreActivity = data.hasMore;
                        currentActivityPage = page;

                        if (hasMoreActivity) {
                            loadMoreBtn.style.display = 'block';
                        } else {
                            loadMoreBtn.style.display = 'none';
                        }
                    } else if (data.activities.length === 0 && page === 1) {
                        feedContainer.innerHTML = \`
                            <div class="pg-activity-empty">
                                <div class="pg-activity-empty-icon">🌟</div>
                                <h3 style="margin: 0 0 var(--pg-space-2) 0; color: var(--pg-dark-700);">No Activity Yet</h3>
                                <p style="margin: 0; color: var(--pg-dark-600);">
                                    Start exploring PenguBook! Send tips, update your profile, or play matches to see activity here.
                                </p>
                            </div>
                        \`;
                        loadMoreBtn.style.display = 'none';
                    }
                } catch (error) {
                    console.error('Failed to load activity feed:', error);
                    feedContainer.innerHTML = \`
                        <div class="pg-activity-empty">
                            <div class="pg-activity-empty-icon">⚠️</div>
                            <h3 style="margin: 0 0 var(--pg-space-2) 0; color: var(--pg-dark-700);">Failed to Load</h3>
                            <p style="margin: 0; color: var(--pg-dark-600);">
                                Unable to load activity feed. Please refresh the page to try again.
                            </p>
                        </div>
                    \`;
                    loadMoreBtn.style.display = 'none';
                }

                isLoadingActivity = false;
            }

            // Load more activity handler
            document.addEventListener('DOMContentLoaded', () => {
                const loadMoreBtn = document.getElementById('loadMoreActivity');
                if (loadMoreBtn) {
                    loadMoreBtn.addEventListener('click', () => {
                        if (hasMoreActivity && !isLoadingActivity) {
                            loadActivityFeed(currentActivityPage + 1, true);
                        }
                    });
                }

                // Initial load
                loadActivityFeed(1);

                // Auto-refresh every 30 seconds
                setInterval(() => {
                    if (!isLoadingActivity && currentActivityPage === 1) {
                        loadActivityFeed(1);
                    }
                }, 30000);
            });
        </script>
    </div>`;

    res.send(generateBaseHTML(content, '🐧 PenguBook - Home', 'home', {
      user: currentUser,
      unreadCount
    }));
  } catch (error) {
    console.error("PenguBook home error:", error);
    res.status(500).send("Error loading PenguBook");
  }
});

// GET /pengubook/inbox - Enhanced Messages inbox
pengubookEnhancedRouter.get("/inbox", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");

    const user = await findOrCreateUser(currentUser.discordId);

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
        ` : messages.map((msg: any) => `
        <div class="pg-message ${msg.tip ? 'pg-message--tip' : ''}">
            <div class="pg-message-header">
                <span class="pg-message-sender">
                    ${msg.from.discordId === msg.from.id ? 'System' : `User#${msg.from.discordId.slice(-4)}`}
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
                ${msg.message}
            </div>
        </div>
        `).join('')}
    </div>`;

    res.send(generateBaseHTML(content, '📨 Inbox - PenguBook', 'inbox', {
      user: currentUser,
      unreadCount: 0
    }));
  } catch (error) {
    console.error("PenguBook inbox error:", error);
    res.status(500).send("Error loading inbox");
  }
});

// GET /pengubook/browse - Enhanced user discovery with search and filtering
pengubookEnhancedRouter.get("/browse", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");

    const user = await findOrCreateUser(currentUser.discordId);
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);

    // Extract search and filter parameters
    const searchQuery = (req.query.search as string) || '';
    const sortBy = (req.query.sort as string) || 'recent';
    const filterBy = (req.query.filter as string) || 'all';
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    // Build dynamic where clause based on filters
    let whereClause: any = {
      showInPenguBook: true,
      id: { not: user.id }
    };

    // Add search functionality
    if (searchQuery) {
      whereClause.OR = [
        { bio: { contains: searchQuery, mode: 'insensitive' } },
        { xUsername: { contains: searchQuery, mode: 'insensitive' } },
        { discordId: { contains: searchQuery } }
      ];
    }

    // Add bio filter
    if (filterBy === 'with_bio') {
      whereClause.bio = { not: null };
    } else if (filterBy === 'no_bio') {
      whereClause.bio = null;
    } else if (filterBy === 'with_social') {
      whereClause.xUsername = { not: null };
    } else if (filterBy === 'active_gamers') {
      whereClause.OR = [
        { wins: { gt: 0 } },
        { losses: { gt: 0 } }
      ];
    }

    // Define sort options
    let orderBy: any;
    switch (sortBy) {
      case 'popular':
        orderBy = { bioViewCount: 'desc' };
        break;
      case 'active':
        orderBy = [{ wins: 'desc' }, { bioLastUpdated: 'desc' }];
        break;
      case 'newest':
        orderBy = { createdAt: 'desc' };
        break;
      case 'recent':
      default:
        orderBy = { bioLastUpdated: 'desc' };
        break;
    }

    // Get total count for pagination
    const totalUsers = await prisma.user.count({ where: whereClause });
    const totalPages = Math.ceil(totalUsers / limit);

    // Get filtered and sorted users
    const users = await prisma.user.findMany({
      where: whereClause,
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
        _count: {
          select: {
            tipsSent: { where: { status: 'COMPLETED' } },
            tipsReceived: { where: { status: 'COMPLETED' } }
          }
        }
      },
      orderBy,
      skip: offset,
      take: limit
    });

    const content = `
    <div class="pg-container">
        <h1 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">👥 Browse PenguBook Users</h1>

        <!-- Enhanced Search and Filter Interface -->
        <div style="margin-bottom: var(--pg-space-8);">
            <form class="pg-search-enhanced" method="GET" action="/pengubook/browse">
                <div style="position: relative;">
                    <input
                        type="text"
                        name="search"
                        value="${searchQuery}"
                        placeholder="Search users by bio, username, or Discord ID..."
                        class="pg-search-enhanced__input"
                        id="searchInput"
                    >
                    <span class="pg-search-enhanced__icon">🔍</span>
                </div>

                <!-- Filter Pills -->
                <div class="pg-search-enhanced__filters">
                    <select name="sort" class="pg-search-filter" onchange="this.form.submit()">
                        <option value="recent" ${sortBy === 'recent' ? 'selected' : ''}>Recently Updated</option>
                        <option value="popular" ${sortBy === 'popular' ? 'selected' : ''}>Most Popular</option>
                        <option value="active" ${sortBy === 'active' ? 'selected' : ''}>Most Active</option>
                        <option value="newest" ${sortBy === 'newest' ? 'selected' : ''}>Newest Members</option>
                    </select>

                    <select name="filter" class="pg-search-filter" onchange="this.form.submit()">
                        <option value="all" ${filterBy === 'all' ? 'selected' : ''}>All Users</option>
                        <option value="with_bio" ${filterBy === 'with_bio' ? 'selected' : ''}>Has Bio</option>
                        <option value="with_social" ${filterBy === 'with_social' ? 'selected' : ''}>Has Social Links</option>
                        <option value="active_gamers" ${filterBy === 'active_gamers' ? 'selected' : ''}>Active Gamers</option>
                    </select>

                    ${searchQuery || sortBy !== 'recent' || filterBy !== 'all' ? `
                    <a href="/pengubook/browse" class="pg-search-filter" style="text-decoration: none; display: inline-flex; align-items: center;">
                        ✕ Clear Filters
                    </a>
                    ` : ''}
                </div>
            </form>

            <!-- Results Summary -->
            <div style="margin-top: var(--pg-space-4); color: var(--pg-dark-600); font-size: var(--pg-text-sm);">
                ${totalUsers > 0 ? `
                    Showing ${(page - 1) * limit + 1}-${Math.min(page * limit, totalUsers)} of ${totalUsers} users
                    ${searchQuery ? `matching "${searchQuery}"` : ''}
                ` : 'No users found'}
            </div>
        </div>

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
            ${users.map((user: any) => {
              const socials = user.socials ? JSON.parse(user.socials) : [];
              const winRate = user.wins + user.losses > 0 ? ((user.wins / (user.wins + user.losses)) * 100).toFixed(1) : 'N/A';
              const totalTips = user._count.tipsSent + user._count.tipsReceived;

              return `
              <div class="pg-profile-card-enhanced" onclick="window.location.href='/pengubook/user/${user.discordId}'" style="cursor: pointer;">
                  <div class="pg-profile-card-enhanced__header">
                      <img src="https://cdn.discordapp.com/embed/avatars/${parseInt(user.discordId.slice(-1)) % 6}.png"
                           alt="Avatar"
                           class="pg-profile-card-enhanced__avatar"
                           id="avatar-${user.discordId}"
                           loading="lazy">
                      <div class="pg-profile-card-enhanced__info">
                          <h3 id="username-${user.discordId}">User#${user.discordId.slice(-4)}</h3>
                          <div style="color: var(--pg-dark-600); font-size: var(--pg-text-sm); display: flex; align-items: center; gap: var(--pg-space-3);">
                              <span>👀 ${user.bioViewCount} views</span>
                              ${totalTips > 0 ? `<span>💰 ${totalTips} tips</span>` : ''}
                              ${user.xUsername ? `<span>🐦 @${user.xUsername}</span>` : ''}
                          </div>
                      </div>
                  </div>

                  ${user.bio ? `
                  <div style="margin: var(--pg-space-4) 0; color: var(--pg-dark-700); font-size: var(--pg-text-sm); line-height: 1.5;">
                      ${user.bio.length > 120 ? user.bio.substring(0, 120) + '...' : user.bio}
                  </div>
                  ` : `
                  <div style="margin: var(--pg-space-4) 0; color: var(--pg-dark-500); font-size: var(--pg-text-sm); font-style: italic;">
                      No bio set yet
                  </div>
                  `}

                  <div class="pg-profile-card-enhanced__stats">
                      <div class="pg-profile-card-enhanced__stat">
                          <span class="pg-profile-card-enhanced__stat-value">${user.wins}</span>
                          <span class="pg-profile-card-enhanced__stat-label">Wins</span>
                      </div>
                      <div class="pg-profile-card-enhanced__stat">
                          <span class="pg-profile-card-enhanced__stat-value">${user.losses}</span>
                          <span class="pg-profile-card-enhanced__stat-label">Losses</span>
                      </div>
                      <div class="pg-profile-card-enhanced__stat">
                          <span class="pg-profile-card-enhanced__stat-value">${winRate}%</span>
                          <span class="pg-profile-card-enhanced__stat-label">Win Rate</span>
                      </div>
                  </div>
              </div>
              `;
            }).join('')}
        </div>

        <!-- Pagination -->
        ${totalPages > 1 ? `
        <div style="margin-top: var(--pg-space-8); display: flex; justify-content: center; align-items: center; gap: var(--pg-space-2);">
            ${page > 1 ? `
            <a href="/pengubook/browse?search=${encodeURIComponent(searchQuery)}&sort=${sortBy}&filter=${filterBy}&page=${page - 1}"
               class="pg-btn pg-btn--secondary">← Previous</a>
            ` : ''}

            <span style="color: var(--pg-dark-600); font-size: var(--pg-text-sm); margin: 0 var(--pg-space-4);">
                Page ${page} of ${totalPages}
            </span>

            ${page < totalPages ? `
            <a href="/pengubook/browse?search=${encodeURIComponent(searchQuery)}&sort=${sortBy}&filter=${filterBy}&page=${page + 1}"
               class="pg-btn pg-btn--secondary">Next →</a>
            ` : ''}
        </div>
        ` : ''}
        `}
    </div>

    <script>
        // Load Discord usernames and avatars with error handling
        ${users.map((user: any) => `
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
  } catch (error) {
    console.error("PenguBook browse error:", error);
    res.status(500).send("Error loading browse page");
  }
});

// All other routes remain the same but with enhanced HTML generation
// ... (keeping the existing route logic but updating the HTML generation)

// Enhanced API endpoint for unread count
pengubookEnhancedRouter.get("/api/unread-count", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const count = await getUnreadMessageCount(currentUser.discordId);
    res.json({ success: true, count });
  } catch (error) {
    console.error("Unread count fetch error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch unread count" });
  }
});

// GET /pengubook/user/:discordId - Enhanced individual user profile
pengubookEnhancedRouter.get("/user/:discordId", async (req: Request, res: Response) => {
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

    // Record profile view and increment view count
    await Promise.all([
      prisma.bioBrowse.upsert({
        where: {
          viewerId_profileId: {
            viewerId: currentDbUser.id,
            profileId: targetUser.id
          }
        },
        update: {},
        create: {
          viewerId: currentDbUser.id,
          profileId: targetUser.id
        }
      }),
      prisma.user.update({
        where: { id: targetUser.id },
        data: { bioViewCount: { increment: 1 } }
      })
    ]);

    // Get tokens for tipping
    const tokens = await getActiveTokens();

    // Get current user's balances
    const balances = await prisma.userBalance.findMany({
      where: { userId: currentDbUser.id },
      include: { Token: true }
    });

    // Get app config for tax rates
    const config = await getConfig();

    // Get achievements for the target user
    const { getUserAchievements, getStreakStats } = await import("../services/streaks.js");
    const [achievements, streakStats] = await Promise.all([
      getUserAchievements(targetUser.discordId),
      getStreakStats(targetUser.discordId)
    ]);

    const socials = targetUser.socials ? JSON.parse(targetUser.socials) : [];
    const winRate = targetUser.wins + targetUser.losses > 0
      ? ((targetUser.wins / (targetUser.wins + targetUser.losses)) * 100).toFixed(1)
      : 'N/A';

    const content = generateUserProfileContent(targetUser, socials, winRate, streakStats, achievements, balances, tokens, config);

    res.send(generateBaseHTML(content, `👤 ${targetUser.discordId.slice(-4)} - PenguBook`, 'browse', {
      user: currentUser,
      unreadCount
    }));
  } catch (error) {
    console.error("PenguBook user profile error:", error);
    res.status(500).send("Error loading user profile");
  }
});

// GET /pengubook/profile - Enhanced profile settings
pengubookEnhancedRouter.get("/profile", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.redirect("/auth/discord");

    const user = await findOrCreateUser(currentUser.discordId);
    const unreadCount = await getUnreadMessageCount(currentUser.discordId);
    const referred = req.query.referred === 'true';

    // Get or create referral stats
    let referralStats;
    try {
      referralStats = await getReferralStats(currentUser.discordId);

      // Create referral code if user doesn't have one
      if (!referralStats.referralCode) {
        const newCode = await createReferralCode(currentUser.discordId);
        referralStats = await getReferralStats(currentUser.discordId);
      }
    } catch (error) {
      console.error("Error getting referral stats:", error);
      referralStats = null;
    }

    const content = generateProfileContent(user, referralStats, referred, req);

    res.send(generateBaseHTML(content, '⚙️ Profile Settings - PenguBook', 'profile', {
      user: currentUser,
      unreadCount
    }));
  } catch (error) {
    console.error("PenguBook profile error:", error);
    res.status(500).send("Error loading profile");
  }
});

// POST /pengubook/api/tip - Enhanced tip processing
pengubookEnhancedRouter.post("/api/tip", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const { recipient, token: tokenAddress, amount, message } = req.body;

    if (!recipient || !tokenAddress || !amount) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    // Find recipient user
    const recipientUser = await findOrCreateUser(recipient);
    if (!recipientUser) {
      return res.status(404).json({ success: false, error: "Recipient not found" });
    }

    // Get token info using proper token service
    const token = await getTokenByAddress(tokenAddress);

    if (!token) {
      return res.status(404).json({ success: false, error: "Token not found" });
    }

    // Get Discord client
    const discordClient = getDiscordClient();
    if (!discordClient) {
      return res.status(500).json({ success: false, error: "Discord client not available" });
    }

    // Process the tip using the same logic as Discord tipping
    const tipData = {
      amount: parseFloat(amount),
      tipType: "direct" as const,
      targetUserId: recipient,
      note: message || "",
      tokenId: token.id,
      userId: currentUser.discordId,
      guildId: null, // Web tips are not guild-specific
      channelId: null, // Web tips don't have a channel
      fromPenguBook: true // Flag to indicate this came from PenguBook
    };

    const result = await processTip(tipData, discordClient);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }

    res.json({
      success: true,
      message: result.message
    });

  } catch (error) {
    console.error("Web tip error:", error);
    res.status(500).json({ success: false, error: "Failed to process tip" });
  }
});

// POST /pengubook/api/profile - Enhanced profile updates
pengubookEnhancedRouter.post("/api/profile", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const { bio, socials } = req.body;
    const user = await findOrCreateUser(currentUser.discordId);

    const updateData: any = {};

    if (bio !== undefined) {
      updateData.bio = bio.trim() || null;
      updateData.bioLastUpdated = new Date();
    }

    if (socials !== undefined) {
      updateData.socials = socials.length > 0 ? JSON.stringify(socials) : null;
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
});

// GET /pengubook/api/balance - Enhanced balance endpoint
pengubookEnhancedRouter.get("/api/balance", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const user = await findOrCreateUser(currentUser.discordId);
    const balances = await prisma.userBalance.findMany({
      where: { userId: user.id },
      include: { Token: true },
      orderBy: { Token: { symbol: "asc" } }
    });

    res.json({ success: true, balances });
  } catch (error) {
    console.error("Balance fetch error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch balance" });
  }
});

// GET /pengubook/api/discord-user/:discordId - Enhanced Discord user info
pengubookEnhancedRouter.get("/api/discord-user/:discordId", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) return res.status(401).json({ success: false, error: "Not authenticated" });

    const discordId = req.params.discordId;

    // Get Discord client from services
    const client = getDiscordClient();

    if (!client) {
      return res.json({
        success: true,
        username: `User#${discordId.slice(-4)}`,
        avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1)) % 6}.png`
      });
    }

    try {
      const user = await client.users.fetch(discordId);
      res.json({
        success: true,
        username: user.username || user.displayName || `User#${discordId.slice(-4)}`,
        avatarURL: user.displayAvatarURL({ size: 256, extension: 'png' })
      });
    } catch (error) {
      // User not found or not accessible, return fallback
      res.json({
        success: true,
        username: `User#${discordId.slice(-4)}`,
        avatarURL: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId.slice(-1)) % 6}.png`
      });
    }
  } catch (error) {
    console.error("Discord user fetch error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch user info" });
  }
});

// GET /pengubook/api/activity-feed - Fetch recent activity for activity feed
pengubookEnhancedRouter.get("/api/activity-feed", async (req: Request, res: Response) => {
  try {
    const currentUser = getCurrentUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    // Get recent tips (both given and received)
    const recentTips = await prisma.tip.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: {
        From: true,
        To: true,
        Token: true
      },
      where: {
        OR: [
          { From: { showInPenguBook: true } },
          { To: { showInPenguBook: true } }
        ]
      }
    });

    // Get recent user profile updates
    const recentProfileUpdates = await prisma.user.findMany({
      take: Math.floor(limit / 4),
      orderBy: { updatedAt: 'desc' },
      where: {
        showInPenguBook: true,
        bio: { not: null },
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
      },
      select: {
        discordId: true,
        bio: true,
        updatedAt: true
      }
    });

    // Get recent matches (if available)
    const recentMatches = await prisma.match.findMany({
      take: Math.floor(limit / 4),
      orderBy: { createdAt: 'desc' },
      include: {
        Challenger: { select: { discordId: true, showInPenguBook: true } },
        Joiner: { select: { discordId: true, showInPenguBook: true } }
      },
      where: {
        OR: [
          { Challenger: { showInPenguBook: true } },
          { Joiner: { showInPenguBook: true } }
        ],
        result: { not: null }
      }
    }).catch(() => []); // Fallback if matches table doesn't exist

    // Combine and format activities
    const activities: any[] = [];

    // Add tip activities
    recentTips.forEach(tip => {
      if (!tip.From || !tip.To) return;
      activities.push({
        id: `tip-${tip.id}`,
        type: 'tip',
        timestamp: tip.createdAt,
        data: {
          fromUser: tip.From.discordId,
          toUser: tip.To.discordId,
          amount: formatAmount(BigInt(tip.amountAtomic.toString()), tip.Token),
          message: tip.note
        }
      });
    });

    // Add profile update activities
    recentProfileUpdates.forEach(user => {
      activities.push({
        id: `profile-${user.discordId}-${user.updatedAt.getTime()}`,
        type: 'profile_update',
        timestamp: user.updatedAt,
        data: {
          discordId: user.discordId,
          bio: user.bio?.substring(0, 100) + (user.bio && user.bio.length > 100 ? '...' : '')
        }
      });
    });

    // Add match activities
    recentMatches.forEach(match => {
      if (!match.Challenger || !match.Joiner) return;
      const winner = match.result === 'challenger' ? match.Challenger.discordId :
                    match.result === 'joiner' ? match.Joiner.discordId : null;

      activities.push({
        id: `match-${match.id}`,
        type: 'match',
        timestamp: match.createdAt,
        data: {
          user1: match.Challenger.discordId,
          user2: match.Joiner.discordId,
          winner: winner,
          result: match.result
        }
      });
    });

    // Sort by timestamp and limit
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const limitedActivities = activities.slice(0, limit);

    res.json({
      success: true,
      activities: limitedActivities,
      hasMore: activities.length > limit,
      nextPage: activities.length > limit ? page + 1 : null
    });

  } catch (error) {
    console.error("Activity feed fetch error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch activity feed",
      details: String(error)
    });
  }
});

// Helper function to generate user profile content
function generateUserProfileContent(targetUser: any, socials: any[], winRate: string, streakStats: any, achievements: any[], balances: any[], tokens: any[], config: any): string {
  return `
    <div class="pg-container">
      <div style="margin-bottom: var(--pg-space-6);">
        <a href="/pengubook/browse" class="pg-btn pg-btn--secondary">← Back to Browse</a>
      </div>

      <!-- Profile Header -->
      <div class="pg-profile-header">
        <img src="https://cdn.discordapp.com/embed/avatars/${parseInt(targetUser.discordId.slice(-1)) % 6}.png"
             alt="Profile Avatar"
             class="pg-profile-avatar"
             id="profileAvatar"
             loading="lazy">
        <div class="pg-profile-info">
          <div class="pg-profile-name" id="profileName">User#${targetUser.discordId.slice(-4)}</div>
          <div class="pg-profile-meta">👀 ${targetUser.bioViewCount} profile views • Member since ${new Date(targetUser.createdAt).toLocaleDateString()}</div>

          <!-- Stats Grid -->
          <div class="pg-stats-grid" style="margin: var(--pg-space-6) 0;">
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

          ${socials.length > 0 ? `
          <div class="pg-social-links">
            ${socials.map((social: any) => `
            <a href="${social.url}" target="_blank" rel="noopener noreferrer" class="pg-social-link">
              ${social.platform}
            </a>
            `).join('')}
          </div>
          ` : ''}
        </div>
      </div>

      ${generateProfileSections(targetUser, streakStats, achievements, balances, tokens, config)}
    </div>

    <script>
      ${generateProfileScripts(targetUser, config)}
    </script>`;
}

// Helper function to generate profile sections
function generateProfileSections(targetUser: any, streakStats: any, achievements: any[], balances: any[], tokens: any[], config: any): string {
  return `
      <!-- Bio Section -->
      ${targetUser.bio ? `
      <div class="pg-card">
        <h3 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">✨ About Me</h3>
        <p style="margin: 0; line-height: 1.7; color: var(--pg-dark-700);">
          ${targetUser.bio}
        </p>
      </div>
      ` : `
      <div class="pg-card" style="text-align: center; opacity: 0.7;">
        <h3 style="margin: 0 0 var(--pg-space-3) 0; color: var(--pg-dark-700);">About Me</h3>
        <p style="margin: 0; font-style: italic; color: var(--pg-dark-600);">
          This user hasn't written a bio yet.
        </p>
      </div>
      `}

      <!-- Win Streak Section -->
      ${streakStats && (streakStats.currentWins > 0 || streakStats.longestWins > 0) ? `
      <div class="pg-card">
        <h3 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">🔥 Win Streak</h3>
        <div class="pg-streak-display">
          <div class="pg-streak-current">${streakStats.currentWins}</div>
          <div class="pg-streak-label">Current Streak</div>
          <div class="pg-streak-best">Best: ${streakStats.longestWins} wins</div>
        </div>
      </div>
      ` : ''}

      <!-- Achievements Section -->
      ${achievements && achievements.length > 0 ? `
      <div class="pg-card">
        <h3 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">🏆 Achievements</h3>
        <div class="pg-achievement-grid">
          ${achievements.map((achievement: any) => `
          <div class="pg-achievement-badge">
            <span class="pg-achievement-icon">${achievement.icon}</span>
            <div class="pg-achievement-name">${achievement.name}</div>
            <div class="pg-achievement-date">${new Date(achievement.unlockedAt).toLocaleDateString()}</div>
          </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      ${generateTipSection(balances, tokens, config)}`;
}

// Helper function to generate tip section
function generateTipSection(balances: any[], tokens: any[], config: any): string {
  return `
      <!-- Tip Section -->
      <div class="pg-tip-section">
        <h3 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">💸 Send a Tip</h3>

        <!-- Current Balances -->
        <div style="margin-bottom: var(--pg-space-6);">
          <h4 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-700);">Your Balances</h4>
          ${balances.length === 0 ? `
          <div class="pg-empty-state" style="padding: var(--pg-space-8) var(--pg-space-4);">
            <div class="pg-empty-state__icon">💰</div>
            <p class="pg-empty-state__description">No balances found. Deposit tokens to start tipping!</p>
          </div>
          ` : `
          <div class="pg-balance-grid">
            ${balances.map((balance: any) => `
            <div class="pg-balance-card">
              <div class="pg-balance-symbol">${balance.Token.symbol}</div>
              <div class="pg-balance-amount">${formatAmount(balance.amountAtomic, balance.Token.decimals)}</div>
            </div>
            `).join('')}
          </div>
          `}
        </div>

        ${balances.length > 0 ? generateTipForm(tokens, config) : ''}
      </div>`;
}

// Helper function to generate tip form
function generateTipForm(tokens: any[], config: any): string {
  return `
        <!-- Tip Form -->
        <form id="tipForm" onsubmit="return handleTipSubmit(event)">
          <div class="pg-form-group">
            <label class="pg-form-label" for="tokenSelect">Token</label>
            <select class="pg-form-select" id="tokenSelect" name="token" required onchange="calculateTax()">
              <option value="">Select a token...</option>
              ${tokens.map((token: any) => `
              <option value="${token.contractAddress}">${token.symbol} - ${token.name}</option>
              `).join('')}
            </select>
          </div>

          <div class="pg-form-group">
            <label class="pg-form-label" for="amountInput">Amount</label>
            <input class="pg-form-input" type="number" id="amountInput" name="amount" step="0.0001" min="0.0001" required oninput="calculateTax()">
          </div>

          <div class="pg-form-group">
            <label class="pg-form-label" for="messageInput">Message (optional)</label>
            <textarea class="pg-form-textarea" id="messageInput" name="message" placeholder="Add a personal note..."></textarea>
          </div>

          <!-- Tax Preview -->
          <div id="taxPreview" class="pg-tax-preview">
            <h4 class="pg-tax-preview__title">💰 Transaction Preview</h4>
            <div class="pg-tax-preview__row">
              <span>Amount:</span>
              <span id="previewAmount">-</span>
            </div>
            <div class="pg-tax-preview__row">
              <span>Tax (${(config.tipTaxPercentage * 100).toFixed(1)}%):</span>
              <span id="previewTax">-</span>
            </div>
            <div class="pg-tax-preview__row pg-tax-preview__row--total">
              <span>Recipient receives:</span>
              <span id="previewTotal" class="pg-tax-preview__total">-</span>
            </div>
          </div>

          <button type="submit" class="pg-btn pg-btn--primary pg-btn--lg" style="width: 100%; margin-top: var(--pg-space-4);">
            Send Tip 🚀
          </button>
        </form>`;
}

// Helper function to generate profile scripts
function generateProfileScripts(targetUser: any, config: any): string {
  return `
      // Load Discord username and avatar
      fetch('/pengubook/api/discord-user/${targetUser.discordId}')
        .then(res => res.ok ? res.json() : Promise.reject('Failed to load'))
        .then(data => {
          if (data.success) {
            const nameEl = document.getElementById('profileName');
            const avatarEl = document.getElementById('profileAvatar');
            if (nameEl) nameEl.textContent = data.username;
            if (avatarEl) avatarEl.src = data.avatarURL;
          }
        })
        .catch(() => {
          // Silently fail with fallback already in place
        });

      // Tax calculation
      function calculateTax() {
        const tokenSelect = document.getElementById('tokenSelect');
        const amountInput = document.getElementById('amountInput');
        const taxPreview = document.getElementById('taxPreview');

        if (!tokenSelect || !amountInput || !taxPreview) return;

        if (!tokenSelect.value || !amountInput.value || amountInput.value <= 0) {
          taxPreview.style.display = 'none';
          return;
        }

        const amount = parseFloat(amountInput.value);
        const taxRate = ${config.tipTaxPercentage};
        const tax = amount * taxRate;
        const total = amount - tax;

        const previewAmount = document.getElementById('previewAmount');
        const previewTax = document.getElementById('previewTax');
        const previewTotal = document.getElementById('previewTotal');

        if (previewAmount) previewAmount.textContent = amount.toFixed(4);
        if (previewTax) previewTax.textContent = tax.toFixed(4);
        if (previewTotal) previewTotal.textContent = total.toFixed(4);

        taxPreview.style.display = 'block';
      }

      // Enhanced tip form submission
      async function handleTipSubmit(event) {
        event.preventDefault();
        const form = event.target;

        await window.enhancedFormSubmit(form, async () => {
          const formData = new FormData(form);
          const tipData = {
            recipient: '${targetUser.discordId}',
            token: formData.get('token'),
            amount: formData.get('amount'),
            message: formData.get('message')
          };

          const response = await fetch('/pengubook/api/tip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tipData)
          });

          const result = await response.json();

          if (result.success) {
            alert('✅ Tip sent successfully! ' + result.message);
            form.reset();
            const taxPreview = document.getElementById('taxPreview');
            if (taxPreview) taxPreview.style.display = 'none';
            // Refresh balances
            window.location.reload();
          } else {
            alert('❌ Failed to send tip: ' + result.error);
          }
        });
      }`;
}

// Helper function to generate profile content
function generateProfileContent(user: any, referralStats: any, referred: boolean, req: any): string {
  const socials = user.socials ? JSON.parse(user.socials) : [];

  return `
    <div class="pg-container">
      ${referred ? `
      <div class="pg-card pg-card--success" style="margin-bottom: var(--pg-space-6);">
        <h3 style="margin: 0 0 var(--pg-space-3) 0;">🎉 Welcome! Referral Success</h3>
        <p style="margin: 0;">You've successfully joined PenguBook through a referral! Complete your profile below to get started.</p>
      </div>
      ` : ''}

      <h1 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">⚙️ Profile Settings</h1>

      <!-- Profile Form -->
      <div class="pg-card">
        <h2 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">✨ Your Profile</h2>

        <form id="profileForm" onsubmit="return handleProfileSubmit(event)">
          <div class="pg-form-group">
            <label class="pg-form-label" for="bioInput">
              Bio
              <span style="color: var(--pg-dark-600); font-weight: normal; font-size: var(--pg-text-sm);">
                (Tell others about yourself!)
              </span>
            </label>
            <textarea
              class="pg-form-textarea"
              id="bioInput"
              name="bio"
              placeholder="Share something interesting about yourself..."
              maxlength="500"
              style="min-height: 120px;">${user.bio || ''}</textarea>
            <div style="text-align: right; color: var(--pg-dark-600); font-size: var(--pg-text-xs); margin-top: var(--pg-space-1);">
              <span id="bioCharCount">${(user.bio || '').length}</span>/500 characters
            </div>
          </div>

          <div class="pg-form-group">
            <label class="pg-form-label">Social Links</label>
            <div id="socialLinks">
              ${socials.map((social: any, index: number) => `
              <div class="social-link-item" style="display: flex; gap: var(--pg-space-3); margin-bottom: var(--pg-space-3); align-items: center;">
                <input class="pg-form-input" type="text" placeholder="Platform (e.g., Twitter, GitHub)" value="${social.platform}" style="flex: 1;">
                <input class="pg-form-input" type="url" placeholder="https://..." value="${social.url}" style="flex: 2;">
                <button type="button" class="pg-btn pg-btn--secondary pg-btn--sm" onclick="removeSocialLink(this)">Remove</button>
              </div>
              `).join('')}
            </div>
            <button type="button" class="pg-btn pg-btn--outline" onclick="addSocialLink()" style="margin-top: var(--pg-space-3);">+ Add Social Link</button>
          </div>

          <div class="pg-form-group">
            <label style="display: flex; align-items: center; gap: var(--pg-space-2); cursor: pointer;">
              <input type="checkbox" ${user.showInPenguBook ? 'checked' : ''} style="margin: 0;">
              <span class="pg-form-label" style="margin: 0;">Show my profile publicly in PenguBook</span>
            </label>
            <p style="margin: var(--pg-space-2) 0 0 0; color: var(--pg-dark-600); font-size: var(--pg-text-sm);">
              When enabled, other users can discover and view your profile. You can change this anytime.
            </p>
          </div>

          <button type="submit" class="pg-btn pg-btn--primary pg-btn--lg" style="width: 100%; margin-top: var(--pg-space-6);">
            💾 Save Profile
          </button>
        </form>
      </div>

      ${generateReferralSection(referralStats, req)}
    </div>

    <script>
      ${generateProfileFormScripts()}
    </script>`;
}

// Helper function to generate referral section
function generateReferralSection(referralStats: any, req: any): string {
  if (!referralStats) return '';

  return `
      <!-- Referral Section -->
      <div class="pg-card">
        <h2 style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-800);">🔗 Referrals</h2>

        <div style="background: var(--pg-dark-200); padding: var(--pg-space-4); border-radius: var(--pg-radius-lg); margin-bottom: var(--pg-space-4);">
          <label class="pg-form-label">Your Referral Link</label>
          <div style="display: flex; gap: var(--pg-space-3); align-items: center;">
            <input
              class="pg-form-input"
              type="text"
              value="${req.protocol}://${req.get('host')}/pengubook?ref=${referralStats.referralCode}"
              readonly
              id="referralLink"
              style="flex: 1;">
            <button type="button" class="pg-btn pg-btn--secondary" onclick="copyReferralLink()">📋 Copy</button>
          </div>
        </div>

        <div class="pg-stats-grid">
          <div class="pg-stat-card">
            <div class="pg-stat-value">${referralStats.totalReferrals}</div>
            <div class="pg-stat-label">Total Referrals</div>
          </div>
          <div class="pg-stat-card">
            <div class="pg-stat-value">${referralStats.activeReferrals}</div>
            <div class="pg-stat-label">Active Users</div>
          </div>
          <div class="pg-stat-card">
            <div class="pg-stat-value">${referralStats.totalRewards || 0}</div>
            <div class="pg-stat-label">Rewards Earned</div>
          </div>
        </div>
      </div>`;
}

// Helper function to generate profile form scripts
function generateProfileFormScripts(): string {
  return `
      // Character counter for bio
      const bioInput = document.getElementById('bioInput');
      if (bioInput) {
        bioInput.addEventListener('input', function() {
          const count = this.value.length;
          const counter = document.getElementById('bioCharCount');
          if (counter) counter.textContent = count;
        });
      }

      // Social links management
      function addSocialLink() {
        const container = document.getElementById('socialLinks');
        if (!container) return;

        const div = document.createElement('div');
        div.className = 'social-link-item';
        div.style.cssText = 'display: flex; gap: var(--pg-space-3); margin-bottom: var(--pg-space-3); align-items: center;';
        div.innerHTML = \`
          <input class="pg-form-input" type="text" placeholder="Platform (e.g., Twitter, GitHub)" style="flex: 1;">
          <input class="pg-form-input" type="url" placeholder="https://..." style="flex: 2;">
          <button type="button" class="pg-btn pg-btn--secondary pg-btn--sm" onclick="removeSocialLink(this)">Remove</button>
        \`;
        container.appendChild(div);
      }

      function removeSocialLink(button) {
        if (button && button.parentElement) {
          button.parentElement.remove();
        }
      }

      // Copy referral link
      function copyReferralLink() {
        const input = document.getElementById('referralLink');
        if (!input) return;

        input.select();
        document.execCommand('copy');

        const button = event.target;
        const originalText = button.textContent;
        button.textContent = '✅ Copied!';
        setTimeout(() => {
          button.textContent = originalText;
        }, 2000);
      }

      // Enhanced profile form submission
      async function handleProfileSubmit(event) {
        event.preventDefault();
        const form = event.target;

        await window.enhancedFormSubmit(form, async () => {
          const formData = new FormData(form);

          // Collect social links
          const socialItems = document.querySelectorAll('.social-link-item');
          const socials = [];
          socialItems.forEach(item => {
            const platformInput = item.querySelector('input[type="text"]');
            const urlInput = item.querySelector('input[type="url"]');
            if (platformInput && urlInput) {
              const platform = platformInput.value.trim();
              const url = urlInput.value.trim();
              if (platform && url) {
                socials.push({ platform, url });
              }
            }
          });

          const profileData = {
            bio: formData.get('bio'),
            socials: socials
          };

          const response = await fetch('/pengubook/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileData)
          });

          const result = await response.json();

          if (result.success) {
            alert('✅ Profile updated successfully!');
          } else {
            alert('❌ Failed to update profile: ' + result.error);
          }
        });
      }`;
}

export { generateBaseHTML };