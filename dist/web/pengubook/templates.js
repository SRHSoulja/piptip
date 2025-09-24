// src/web/pengubook/templates.ts - PenguBook HTML template generators
import fs from "fs";
import path from "path";
// Load the enhanced CSS file
const cssPath = path.join(process.cwd(), 'src/web/static/pengubook.css');
let enhancedCSS = '';
try {
    enhancedCSS = fs.readFileSync(cssPath, 'utf8');
}
catch (error) {
    console.warn('Enhanced CSS file not found, falling back to inline styles');
    enhancedCSS = '/* Enhanced CSS not available - falling back to basic styles */';
}
// Base HTML template with enhanced design system
export function generateBaseHTML(content, title = 'PenguBook', currentPage = '', userData = null) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="theme-color" content="#1f2937">
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
        <a href="/pengubook/stats" class="pg-nav__link ${currentPage === 'stats' ? 'pg-nav__link--active' : ''}">
            📊 Stats
        </a>
        <a href="/pengubook/transactions" class="pg-nav__link ${currentPage === 'transactions' ? 'pg-nav__link--active' : ''}">
            📋 Transactions
        </a>
        <a href="/pengubook/apply" class="pg-nav__link ${currentPage === 'apply' ? 'pg-nav__link--active' : ''}">
            📝 Apply
        </a>
        <a href="/pengubook/profile" class="pg-nav__link ${currentPage === 'profile' ? 'pg-nav__link--active' : ''}">
            ⚙️ Profile
        </a>
        <a href="/server" class="pg-nav__link">
            🛡️ Server Admin
        </a>
    </nav>

    <!-- Main Content -->
    <main role="main">
        ${content}
    </main>

    <!-- Loading overlay for better UX -->
    <div id="loadingOverlay" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 20, 25, 0.8); backdrop-filter: blur(4px); z-index: 9999; align-items: center; justify-content: center;">
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
                if (isLoading) {
                    overlay.style.display = 'flex';
                } else {
                    overlay.style.display = 'none';
                }
            }
        };

        // Ensure loading overlay is hidden by default after page load
        document.addEventListener('DOMContentLoaded', () => {
            window.setGlobalLoading(false);
        });

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

        // ===== Global Aesthetic Persistence System =====
        // Load and apply user aesthetic preferences on every page
        (function() {
            // Load preferences from localStorage
            const loadStoredPreferences = () => {
                const stored = localStorage.getItem('pengubook-aesthetics');
                const defaults = {
                    theme: 'dark',
                    accentColor: '#3b82f6',
                    density: 'comfortable',
                    font: 'system'
                };

                if (stored) {
                    try {
                        return { ...defaults, ...JSON.parse(stored) };
                    } catch (e) {
                        console.warn('Failed to parse aesthetic preferences:', e);
                        return defaults;
                    }
                }
                return defaults;
            };

            // Color utility functions
            const hexToRgb = (hex) => {
                const result = /^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i.exec(hex);
                return result ? {
                    r: parseInt(result[1], 16),
                    g: parseInt(result[2], 16),
                    b: parseInt(result[3], 16)
                } : null;
            };

            const lighten = (r, g, b, factor) => {
                return \`rgb(\${Math.round(r + (255 - r) * factor)}, \${Math.round(g + (255 - g) * factor)}, \${Math.round(b + (255 - b) * factor)})\`;
            };

            const darken = (r, g, b, factor) => {
                return \`rgb(\${Math.round(r * (1 - factor))}, \${Math.round(g * (1 - factor))}, \${Math.round(b * (1 - factor))})\`;
            };

            // Apply theme
            const applyTheme = (theme) => {
                document.documentElement.className = document.documentElement.className.replace(/pg-theme-\\w+/g, '');
                document.documentElement.classList.add(\`pg-theme-\${theme}\`);

                // Update meta theme-color for mobile browsers
                const metaTheme = document.querySelector('meta[name="theme-color"]');
                const themeColors = {
                    light: '#ffffff',
                    dark: '#1f2937',
                    midnight: '#0f1419',
                    auto: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#1f2937' : '#ffffff'
                };
                if (metaTheme) {
                    metaTheme.content = themeColors[theme] || themeColors.dark;
                }
            };

            // Apply accent color
            const applyAccentColor = (color) => {
                const rgb = hexToRgb(color);
                if (!rgb) return;

                const { r, g, b } = rgb;

                // Generate color palette
                const variations = {
                    50: lighten(r, g, b, 0.95),
                    100: lighten(r, g, b, 0.9),
                    200: lighten(r, g, b, 0.8),
                    300: lighten(r, g, b, 0.6),
                    400: lighten(r, g, b, 0.3),
                    500: color,
                    600: darken(r, g, b, 0.1),
                    700: darken(r, g, b, 0.2),
                    800: darken(r, g, b, 0.3),
                    900: darken(r, g, b, 0.4)
                };

                // Apply to CSS variables
                Object.entries(variations).forEach(([weight, colorValue]) => {
                    document.documentElement.style.setProperty(\`--pg-primary-\${weight}\`, colorValue);
                });
            };

            // Apply density
            const applyDensity = (density) => {
                document.documentElement.className = document.documentElement.className.replace(/pg-density-\\w+/g, '');
                document.documentElement.classList.add(\`pg-density-\${density}\`);

                const densityMap = {
                    compact: {
                        '--pg-space-4': '0.75rem',
                        '--pg-space-6': '1rem',
                        '--pg-space-8': '1.25rem',
                        '--pg-text-base': '0.875rem',
                        '--pg-text-lg': '1rem'
                    },
                    comfortable: {
                        '--pg-space-4': '1rem',
                        '--pg-space-6': '1.5rem',
                        '--pg-space-8': '2rem',
                        '--pg-text-base': '1rem',
                        '--pg-text-lg': '1.125rem'
                    },
                    spacious: {
                        '--pg-space-4': '1.5rem',
                        '--pg-space-6': '2rem',
                        '--pg-space-8': '2.5rem',
                        '--pg-text-base': '1.125rem',
                        '--pg-text-lg': '1.25rem'
                    }
                };

                const variables = densityMap[density] || densityMap.comfortable;
                Object.entries(variables).forEach(([property, value]) => {
                    document.documentElement.style.setProperty(property, value);
                });
            };

            // Apply font
            const applyFont = (font) => {
                const fontMap = {
                    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
                    inter: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
                    poppins: '"Poppins", -apple-system, BlinkMacSystemFont, sans-serif',
                    jetbrains: '"JetBrains Mono", "SF Mono", "Monaco", "Inconsolata", "Fira Code", monospace',
                    comic: '"Comic Neue", "Comic Sans MS", cursive'
                };

                const fontFamily = fontMap[font] || fontMap.system;
                document.documentElement.style.setProperty('--pg-font-family', fontFamily);
                document.body.style.fontFamily = fontFamily;

                // Load Google Fonts if needed
                if (font !== 'system' && !document.querySelector(\`link[href*="\${font}"]\`)) {
                    const fonts = {
                        inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',
                        poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap',
                        jetbrains: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap',
                        comic: 'https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap'
                    };

                    if (fonts[font]) {
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = fonts[font];
                        document.head.appendChild(link);
                    }
                }
            };

            // Apply all preferences immediately (before DOM loads for smoother experience)
            const preferences = loadStoredPreferences();
            applyTheme(preferences.theme);
            applyAccentColor(preferences.accentColor);
            applyDensity(preferences.density);
            applyFont(preferences.font);

            // Expose global function to re-apply preferences
            window.reapplyAesthetics = () => {
                const prefs = loadStoredPreferences();
                applyTheme(prefs.theme);
                applyAccentColor(prefs.accentColor);
                applyDensity(prefs.density);
                applyFont(prefs.font);
            };

            console.log('🎨 PenguBook Aesthetics loaded:', preferences);
        })();
    </script>
</body>
</html>`;
}
// Generate home page content
export function generateHomeContent(user, currentUser) {
    return `
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

        <!-- Wallet Balance Card -->
        <div class="pg-card" style="margin-bottom: var(--pg-space-6);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--pg-space-4);">
                <h2 style="margin: 0; color: var(--pg-dark-800);">💰 Wallet Balance</h2>
                <button onclick="window.refreshBalances()" class="pg-btn pg-btn--secondary pg-btn--sm" id="refreshBalanceBtn">
                    🔄 Refresh
                </button>
            </div>
            <div id="balanceContainer" style="min-height: 60px;">
                <div class="pg-loading-skeleton">Loading wallet balances...</div>
            </div>
        </div>

        <!-- Recent Activity Feed -->
        <div class="pg-card" style="margin-bottom: var(--pg-space-6);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--pg-space-4);">
                <h2 style="margin: 0; color: var(--pg-dark-800);">🔥 Recent Activity</h2>
                <button onclick="window.refreshActivity()" class="pg-btn pg-btn--secondary pg-btn--sm" id="refreshActivityBtn">
                    🔄 Refresh
                </button>
            </div>
            <div id="activityContainer" style="min-height: 200px;">
                <div class="pg-loading-skeleton">Loading recent activity...</div>
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
                <span class="pg-feature-icon">📊</span>
                <h3 class="pg-feature-title">Statistics</h3>
                <p class="pg-feature-description">
                    Comprehensive gaming stats, win rates, and financial analytics.
                </p>
                <a href="/pengubook/stats" class="pg-btn pg-btn--primary">View Stats</a>
            </div>

            <div class="pg-feature-card">
                <span class="pg-feature-icon">📋</span>
                <h3 class="pg-feature-title">Transactions</h3>
                <p class="pg-feature-description">
                    Complete history of all your tips, deposits, and withdrawals.
                </p>
                <a href="/pengubook/transactions" class="pg-btn pg-btn--primary">View History</a>
            </div>

            <div class="pg-feature-card">
                <span class="pg-feature-icon">🛡️</span>
                <h3 class="pg-feature-title">Server Admin</h3>
                <p class="pg-feature-description">
                    Manage PIPTip settings for your Discord servers.
                </p>
                <a href="/server" class="pg-btn pg-btn--primary">Manage Servers</a>
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
                    ${JSON.parse(user.socials).map((social) => `<a href="${social.url}" target="_blank" rel="noopener noreferrer" class="pg-social-link">${social.platform}</a>`).join('')}
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
    </div>

    <script>
        // Wallet balance functionality
        async function loadBalances() {
            const container = document.getElementById('balanceContainer');
            const refreshBtn = document.getElementById('refreshBalanceBtn');

            if (!container || !refreshBtn) {
                return;
            }

            try {
                refreshBtn.disabled = true;
                refreshBtn.textContent = '🔄 Loading...';

                const response = await fetch('/pengubook/api/balance');
                const data = await response.json();

                if (data.success && data.balances && data.balances.length > 0) {
                    const balanceHTML = \`
                        <div class="pg-balance-grid">
                            \${data.balances.map(balance => \`
                                <div class="pg-balance-item">
                                    <div class="pg-balance-amount">\${balance.amount}</div>
                                    <div class="pg-balance-token">\${balance.Token.symbol}</div>
                                    <div class="pg-balance-usd" style="margin-top: 4px; font-size: var(--pg-text-xs); color: var(--pg-dark-500);">
                                        \${balance.formattedUSD ? \`\${balance.formattedUSD} USD\` : 'USD price unavailable'}
                                    </div>
                                </div>
                            \`).join('')}
                        </div>
                        \${data.formattedTotalUSD ? \`
                        <div style="margin-top: var(--pg-space-4); padding-top: var(--pg-space-3); border-top: 1px solid var(--pg-dark-300); display: flex; justify-content: space-between; align-items: center; font-size: var(--pg-text-sm);">
                            <span style="color: var(--pg-dark-500);">Total USD Value</span>
                            <strong style="color: var(--pg-dark-800);">\${data.formattedTotalUSD} USD</strong>
                        </div>
                        \` : ''}
                        \${data.priceDisclaimer ? \`
                        <div style="margin-top: var(--pg-space-2); font-size: var(--pg-text-xs); color: var(--pg-dark-400);">
                            \${data.priceDisclaimer}
                        </div>
                        \` : ''}
                    \`;
                    container.innerHTML = balanceHTML;
                } else {
                    container.innerHTML = \`
                        <div class="pg-empty-state" style="padding: var(--pg-space-4); text-align: center;">
                            <div style="color: var(--pg-dark-600); margin-bottom: var(--pg-space-2);">
                                💳 No wallet balances found
                            </div>
                            <div style="font-size: var(--pg-text-sm); color: var(--pg-dark-500);">
                                Make a deposit or receive tips to see your balances here
                            </div>
                        </div>
                    \`;
                }
            } catch (error) {
                console.error('Failed to load balances:', error);
                container.innerHTML = \`
                    <div class="pg-error" style="padding: var(--pg-space-4); text-align: center;">
                        ❌ Failed to load wallet balances
                    </div>
                \`;
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '🔄 Refresh';
            }
        }

        function refreshBalances() {
            loadBalances();
        }

        // Activity feed functionality
        async function loadActivity() {
            const container = document.getElementById('activityContainer');
            const refreshBtn = document.getElementById('refreshActivityBtn');

            if (!container || !refreshBtn) {
                return;
            }

            try {
                refreshBtn.disabled = true;
                refreshBtn.textContent = '🔄 Loading...';

                // Fetch real activity feed
                const response = await fetch('/pengubook/api/activity-feed');
                const data = await response.json();

                if (data.success && data.activities && data.activities.length > 0) {
                    const activityHTML = \`
                        <div class="pg-activity-feed">
                            \${data.activities.map(activity => \`
                                <div class="pg-activity-item">
                                    <div class="pg-activity-icon">\${activity.icon}</div>
                                    <div class="pg-activity-content">
                                        <div class="pg-activity-text">\${activity.text}</div>
                                        <div class="pg-activity-time">\${activity.time}</div>
                                    </div>
                                </div>
                            \`).join('')}
                        </div>
                    \`;
                    container.innerHTML = activityHTML;
                } else {
                    container.innerHTML = \`
                        <div class="pg-empty-state" style="padding: var(--pg-space-4); text-align: center;">
                            <div style="color: var(--pg-dark-600); margin-bottom: var(--pg-space-2);">
                                🌟 No recent activity
                            </div>
                            <div style="font-size: var(--pg-text-sm); color: var(--pg-dark-500);">
                                Be the first to react, follow, or tip someone to start the activity feed!
                            </div>
                        </div>
                    \`;
                }

            } catch (error) {
                console.error('Failed to load activity:', error);
                container.innerHTML = \`
                    <div class="pg-error" style="padding: var(--pg-space-4); text-align: center;">
                        ❌ Failed to load activity feed
                    </div>
                \`;
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '🔄 Refresh';
            }
        }

        function refreshActivity() {
            loadActivity();
        }

        // Load balances and activity when page loads
        document.addEventListener('DOMContentLoaded', () => {
            loadBalances();
            loadActivity();
        });

        // Make functions global
        window.refreshBalances = refreshBalances;
        window.refreshActivity = refreshActivity;
    </script>`;
}
// Generate empty state content
export function generateEmptyState(icon, title, description, buttonText, buttonLink) {
    return `
    <div class="pg-empty-state">
        <div class="pg-empty-state__icon">${icon}</div>
        <h2 class="pg-empty-state__title">${title}</h2>
        <p class="pg-empty-state__description">${description}</p>
        ${buttonText && buttonLink ? `
        <div style="margin-top: var(--pg-space-6);">
            <a href="${buttonLink}" class="pg-btn pg-btn--primary">${buttonText}</a>
        </div>
        ` : ''}
    </div>`;
}

