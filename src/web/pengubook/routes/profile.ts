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

        <!-- Aesthetic Customization Section -->
        <div class="pg-card" style="margin-top: var(--pg-space-6);">
            <h2 style="margin: 0 0 var(--pg-space-4) 0; color: var(--pg-dark-800);">🎨 Aesthetic Customization</h2>
            <p style="margin: 0 0 var(--pg-space-6) 0; color: var(--pg-dark-600);">
                Personalize your PenguBook experience with themes, colors, and layout preferences inspired by your favorite social platforms.
            </p>

            <!-- Theme Selection -->
            <div class="pg-customization-section">
                <h3 class="pg-customization-title">🌙 Theme & Appearance</h3>
                <div class="pg-theme-selector">
                    <div class="pg-theme-option" data-theme="auto">
                        <div class="pg-theme-preview pg-theme-preview--auto"></div>
                        <span class="pg-theme-label">Auto</span>
                        <span class="pg-theme-description">Follows system</span>
                    </div>
                    <div class="pg-theme-option" data-theme="light">
                        <div class="pg-theme-preview pg-theme-preview--light"></div>
                        <span class="pg-theme-label">Light</span>
                        <span class="pg-theme-description">Clean & bright</span>
                    </div>
                    <div class="pg-theme-option" data-theme="dark">
                        <div class="pg-theme-preview pg-theme-preview--dark"></div>
                        <span class="pg-theme-label">Dark</span>
                        <span class="pg-theme-description">Easy on eyes</span>
                    </div>
                    <div class="pg-theme-option" data-theme="midnight">
                        <div class="pg-theme-preview pg-theme-preview--midnight"></div>
                        <span class="pg-theme-label">Midnight</span>
                        <span class="pg-theme-description">Ultra dark</span>
                    </div>
                </div>
            </div>

            <!-- Accent Color Picker -->
            <div class="pg-customization-section">
                <h3 class="pg-customization-title">🎯 Accent Color</h3>
                <div class="pg-color-picker">
                    <div class="pg-color-presets">
                        <div class="pg-color-option" data-color="#3b82f6" style="background: #3b82f6;"></div>
                        <div class="pg-color-option" data-color="#10b981" style="background: #10b981;"></div>
                        <div class="pg-color-option" data-color="#f59e0b" style="background: #f59e0b;"></div>
                        <div class="pg-color-option" data-color="#ef4444" style="background: #ef4444;"></div>
                        <div class="pg-color-option" data-color="#8b5cf6" style="background: #8b5cf6;"></div>
                        <div class="pg-color-option" data-color="#06b6d4" style="background: #06b6d4;"></div>
                        <div class="pg-color-option" data-color="#ec4899" style="background: #ec4899;"></div>
                        <div class="pg-color-option" data-color="#84cc16" style="background: #84cc16;"></div>
                    </div>
                    <div class="pg-custom-color">
                        <input type="color" id="customColor" value="#3b82f6" class="pg-color-input">
                        <label for="customColor" class="pg-color-input-label">Custom Color</label>
                    </div>
                </div>
            </div>

            <!-- Layout Density -->
            <div class="pg-customization-section">
                <h3 class="pg-customization-title">📏 Layout Density</h3>
                <div class="pg-density-selector">
                    <div class="pg-density-option" data-density="compact">
                        <div class="pg-density-preview">
                            <div class="pg-density-bars pg-density-bars--compact"></div>
                        </div>
                        <span class="pg-density-label">Compact</span>
                        <span class="pg-density-description">More content</span>
                    </div>
                    <div class="pg-density-option" data-density="comfortable">
                        <div class="pg-density-preview">
                            <div class="pg-density-bars pg-density-bars--comfortable"></div>
                        </div>
                        <span class="pg-density-label">Comfortable</span>
                        <span class="pg-density-description">Balanced</span>
                    </div>
                    <div class="pg-density-option" data-density="spacious">
                        <div class="pg-density-preview">
                            <div class="pg-density-bars pg-density-bars--spacious"></div>
                        </div>
                        <span class="pg-density-label">Spacious</span>
                        <span class="pg-density-description">Relaxed feel</span>
                    </div>
                </div>
            </div>

            <!-- Font Selection -->
            <div class="pg-customization-section">
                <h3 class="pg-customization-title">✍️ Typography</h3>
                <div class="pg-font-selector">
                    <div class="pg-font-option" data-font="system">
                        <span class="pg-font-preview" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui;">Aa</span>
                        <div class="pg-font-info">
                            <span class="pg-font-name">System</span>
                            <span class="pg-font-description">Native OS font</span>
                        </div>
                    </div>
                    <div class="pg-font-option" data-font="inter">
                        <span class="pg-font-preview" style="font-family: 'Inter', sans-serif;">Aa</span>
                        <div class="pg-font-info">
                            <span class="pg-font-name">Inter</span>
                            <span class="pg-font-description">Modern & clean</span>
                        </div>
                    </div>
                    <div class="pg-font-option" data-font="poppins">
                        <span class="pg-font-preview" style="font-family: 'Poppins', sans-serif;">Aa</span>
                        <div class="pg-font-info">
                            <span class="pg-font-name">Poppins</span>
                            <span class="pg-font-description">Friendly & rounded</span>
                        </div>
                    </div>
                    <div class="pg-font-option" data-font="jetbrains">
                        <span class="pg-font-preview" style="font-family: 'JetBrains Mono', monospace;">Aa</span>
                        <div class="pg-font-info">
                            <span class="pg-font-name">JetBrains</span>
                            <span class="pg-font-description">Coding vibe</span>
                        </div>
                    </div>
                    <div class="pg-font-option" data-font="comic">
                        <span class="pg-font-preview" style="font-family: 'Comic Neue', cursive;">Aa</span>
                        <div class="pg-font-info">
                            <span class="pg-font-name">Comic Neue</span>
                            <span class="pg-font-description">Fun & playful</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Preview & Reset -->
            <div class="pg-customization-actions">
                <button type="button" id="resetCustomization" class="pg-btn pg-btn--secondary">
                    🔄 Reset to Defaults
                </button>
                <button type="button" id="saveCustomization" class="pg-btn pg-btn--primary">
                    💾 Save Appearance
                </button>
            </div>
        </div>

        <!-- Wallet Balance Card -->
        <div class="pg-card" style="margin-top: var(--pg-space-6);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--pg-space-4);">
                <h2 style="margin: 0; color: var(--pg-dark-800);">💰 Wallet Balance</h2>
                <button onclick="refreshProfileBalances()" class="pg-btn pg-btn--secondary pg-btn--sm" id="refreshProfileBalanceBtn">
                    🔄 Refresh
                </button>
            </div>
            <div id="profileBalanceContainer" style="min-height: 60px;">
                <div class="pg-loading-skeleton">Loading wallet balances...</div>
            </div>
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

        // ===== Wallet Balance System =====
        async function loadProfileBalances() {
            const container = document.getElementById('profileBalanceContainer');
            const refreshBtn = document.getElementById('refreshProfileBalanceBtn');

            // Check if global balance loading is already in progress
            if (window.balanceLoadingGlobal) {
                console.log('🚫 Profile balance load skipped - global balance loading in progress');
                return;
            }

            try {
                window.balanceLoadingGlobal = true;
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
                window.balanceLoadingGlobal = false;
                refreshBtn.disabled = false;
                refreshBtn.textContent = '🔄 Refresh';
            }
        }

        function refreshProfileBalances() {
            loadProfileBalances();
        }

        // Load balances when page loads
        document.addEventListener('DOMContentLoaded', loadProfileBalances);

        // Make functions global
        window.refreshProfileBalances = refreshProfileBalances;

        // ===== Aesthetic Customization System =====
        class PenguBookAesthetics {
            constructor() {
                this.preferences = this.loadPreferences();
                this.fontLinks = new Map();
                this.init();
            }

            // Load preferences from localStorage
            loadPreferences() {
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
            }

            // Save preferences to localStorage
            savePreferences() {
                localStorage.setItem('pengubook-aesthetics', JSON.stringify(this.preferences));
            }

            // Initialize the system
            init() {
                this.loadFonts();
                this.bindEvents();
                this.applyPreferences();
                this.updateUI();
            }

            // Load Google Fonts dynamically
            loadFonts() {
                const fonts = [
                    { name: 'Inter', url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap' },
                    { name: 'Poppins', url: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap' },
                    { name: 'JetBrains Mono', url: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap' },
                    { name: 'Comic Neue', url: 'https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap' }
                ];

                fonts.forEach(font => {
                    if (!document.querySelector(\`link[href="\${font.url}"]\`)) {
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = font.url;
                        document.head.appendChild(link);
                        this.fontLinks.set(font.name, link);
                    }
                });
            }

            // Bind event listeners
            bindEvents() {
                // Theme selection with sparkle effects
                document.querySelectorAll('.pg-theme-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const theme = option.dataset.theme;
                        this.setTheme(theme);
                        this.addSparkleEffect();
                    });
                });

                // Color selection with sparkle effects
                document.querySelectorAll('.pg-color-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const color = option.dataset.color;
                        this.setAccentColor(color);
                        document.getElementById('customColor').value = color;
                        this.addSparkleEffect();
                    });
                });

                // Custom color input with sparkle effects
                document.getElementById('customColor').addEventListener('input', (e) => {
                    this.setAccentColor(e.target.value);
                    this.addSparkleEffect();
                });

                // Density selection with sparkle effects
                document.querySelectorAll('.pg-density-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const density = option.dataset.density;
                        this.setDensity(density);
                        this.addSparkleEffect();
                    });
                });

                // Font selection with sparkle effects
                document.querySelectorAll('.pg-font-option').forEach(option => {
                    option.addEventListener('click', () => {
                        const font = option.dataset.font;
                        this.setFont(font);
                        this.addSparkleEffect();
                    });
                });

                // Action buttons
                document.getElementById('resetCustomization').addEventListener('click', () => {
                    this.resetToDefaults();
                });

                document.getElementById('saveCustomization').addEventListener('click', () => {
                    this.savePreferences();
                    this.showSaveNotification();
                });
            }

            // Apply current preferences to the page
            applyPreferences() {
                this.applyTheme(this.preferences.theme);
                this.applyAccentColor(this.preferences.accentColor);
                this.applyDensity(this.preferences.density);
                this.applyFont(this.preferences.font);
            }

            // Update UI to reflect current settings
            updateUI() {
                // Update theme selection
                document.querySelectorAll('.pg-theme-option').forEach(option => {
                    option.classList.toggle('pg-theme-option--active', option.dataset.theme === this.preferences.theme);
                });

                // Update color selection
                document.querySelectorAll('.pg-color-option').forEach(option => {
                    option.classList.toggle('pg-color-option--active', option.dataset.color === this.preferences.accentColor);
                });
                document.getElementById('customColor').value = this.preferences.accentColor;

                // Update density selection
                document.querySelectorAll('.pg-density-option').forEach(option => {
                    option.classList.toggle('pg-density-option--active', option.dataset.density === this.preferences.density);
                });

                // Update font selection
                document.querySelectorAll('.pg-font-option').forEach(option => {
                    option.classList.toggle('pg-font-option--active', option.dataset.font === this.preferences.font);
                });
            }

            // Theme management
            setTheme(theme) {
                this.preferences.theme = theme;
                this.applyTheme(theme);
                this.updateUI();
            }

            applyTheme(theme) {
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
            }

            // Accent color management
            setAccentColor(color) {
                this.preferences.accentColor = color;
                this.applyAccentColor(color);
                this.updateUI();
            }

            applyAccentColor(color) {
                // Parse the color and generate variations
                const rgb = this.hexToRgb(color);
                if (!rgb) return;

                const { r, g, b } = rgb;

                // Generate color palette
                const variations = {
                    50: this.lighten(r, g, b, 0.95),
                    100: this.lighten(r, g, b, 0.9),
                    200: this.lighten(r, g, b, 0.8),
                    300: this.lighten(r, g, b, 0.6),
                    400: this.lighten(r, g, b, 0.3),
                    500: color,
                    600: this.darken(r, g, b, 0.1),
                    700: this.darken(r, g, b, 0.2),
                    800: this.darken(r, g, b, 0.3),
                    900: this.darken(r, g, b, 0.4)
                };

                // Apply to CSS variables
                Object.entries(variations).forEach(([weight, colorValue]) => {
                    document.documentElement.style.setProperty(\`--pg-primary-\${weight}\`, colorValue);
                });
            }

            // Density management
            setDensity(density) {
                this.preferences.density = density;
                this.applyDensity(density);
                this.updateUI();
            }

            applyDensity(density) {
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
            }

            // Font management
            setFont(font) {
                this.preferences.font = font;
                this.applyFont(font);
                this.updateUI();
            }

            applyFont(font) {
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
            }

            // Color utility functions
            hexToRgb(hex) {
                const result = /^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i.exec(hex);
                return result ? {
                    r: parseInt(result[1], 16),
                    g: parseInt(result[2], 16),
                    b: parseInt(result[3], 16)
                } : null;
            }

            lighten(r, g, b, factor) {
                return \`rgb(\${Math.round(r + (255 - r) * factor)}, \${Math.round(g + (255 - g) * factor)}, \${Math.round(b + (255 - b) * factor)})\`;
            }

            darken(r, g, b, factor) {
                return \`rgb(\${Math.round(r * (1 - factor))}, \${Math.round(g * (1 - factor))}, \${Math.round(b * (1 - factor))})\`;
            }

            // Reset to defaults
            resetToDefaults() {
                this.preferences = {
                    theme: 'dark',
                    accentColor: '#3b82f6',
                    density: 'comfortable',
                    font: 'system'
                };
                this.applyPreferences();
                this.updateUI();
                localStorage.removeItem('pengubook-aesthetics');
                this.showResetNotification();
            }

            // Save notification with achievement-style popup
            showSaveNotification() {
                const btn = document.getElementById('saveCustomization');
                const originalText = btn.textContent;
                btn.textContent = '✅ Saved!';
                btn.classList.add('pg-btn--success');

                // Show achievement-style notification
                this.showAchievementNotification('Style Master!', 'Your aesthetic preferences have been saved successfully');

                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('pg-btn--success');
                }, 2000);
            }

            // Achievement-style notification system
            showAchievementNotification(title, text) {
                const notification = document.createElement('div');
                notification.className = 'pg-achievement-unlock';
                notification.innerHTML = \`
                    <div class="pg-achievement-unlock__title">🎨 \${title}</div>
                    <div class="pg-achievement-unlock__text">\${text}</div>
                \`;

                document.body.appendChild(notification);

                // Auto-remove after 4 seconds
                setTimeout(() => {
                    notification.style.animation = 'achievement-slide-in 0.5s ease-out reverse';
                    setTimeout(() => {
                        if (notification.parentNode) {
                            notification.parentNode.removeChild(notification);
                        }
                    }, 500);
                }, 4000);
            }

            // Add sparkle effects on customization interactions
            addSparkleEffect(element) {
                const sparkle = document.createElement('div');
                sparkle.className = 'pg-sparkle';
                sparkle.style.left = Math.random() * window.innerWidth + 'px';
                sparkle.style.top = Math.random() * window.innerHeight + 'px';
                document.body.appendChild(sparkle);

                setTimeout(() => {
                    if (sparkle.parentNode) {
                        sparkle.parentNode.removeChild(sparkle);
                    }
                }, 3000);
            }

            // Reset notification
            showResetNotification() {
                const btn = document.getElementById('resetCustomization');
                const originalText = btn.textContent;
                btn.textContent = '✅ Reset!';

                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            }
        }

        // Initialize the aesthetic system
        document.addEventListener('DOMContentLoaded', () => {
            window.penguBookAesthetics = new PenguBookAesthetics();
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