// src/web/pengubook/templates.ts - PenguBook HTML template generators
import fs from "fs";
import path from "path";

// Load the enhanced CSS file
const cssPath = path.join(process.cwd(), 'src/web/static/pengubook.css');
let enhancedCSS = '';
try {
  enhancedCSS = fs.readFileSync(cssPath, 'utf8');
} catch (error) {
  console.warn('Enhanced CSS file not found, falling back to inline styles');
  enhancedCSS = '/* Enhanced CSS not available - falling back to basic styles */';
}

// Base HTML template with enhanced design system
export function generateBaseHTML(content: string, title: string = 'PenguBook', currentPage: string = '', userData: any = null): string {
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
        <a href="/pengubook/profile" class="pg-nav__link ${currentPage === 'profile' ? 'pg-nav__link--active' : ''}">
            ⚙️ Profile
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
    </script>
</body>
</html>`;
}

// Generate home page content
export function generateHomeContent(user: any, currentUser: any): string {
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
    </div>`;
}

// Generate empty state content
export function generateEmptyState(icon: string, title: string, description: string, buttonText?: string, buttonLink?: string): string {
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