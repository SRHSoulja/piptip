// src/web/admin/js/dashboard.js - Main admin dashboard coordinator
import { initAuth, checkAuthAndLoad, setDefaultDates } from './core.js';
import { loadTokens, initTokensSection } from './tokens.js';

// Lazy load other modules to keep initial bundle small
let modulesLoaded = false;

export async function loadAllData() {
  console.log("🚀 Loading all admin data...");

  try {
    // Load core sections first
    await Promise.all([
      loadTokens(),
      loadConfig(),
      loadTiers(),
    ]);

    // Then load data-heavy sections
    await Promise.all([
      loadServers(),
      loadTreasury(),
      loadAds(),
      loadFees(),
    ]);

    console.log("✅ All admin data loaded successfully");
  } catch (error) {
    console.error("❌ Failed to load admin data:", error);
  }
}

// Stub functions - these will be replaced when we import the actual modules
async function loadConfig() {
  const { loadConfig: loadConfigImpl } = await import('./config.js');
  return loadConfigImpl();
}

async function loadTiers() {
  const { loadTiers: loadTiersImpl } = await import('./tiers.js');
  return loadTiersImpl();
}

async function loadServers() {
  const { loadServers: loadServersImpl } = await import('./servers.js');
  return loadServersImpl();
}

async function loadTreasury() {
  const { loadTreasury: loadTreasuryImpl } = await import('./treasury.js');
  return loadTreasuryImpl();
}

async function loadAds() {
  const { loadAds: loadAdsImpl } = await import('./ads.js');
  return loadAdsImpl();
}

async function loadFees() {
  const { loadFees: loadFeesImpl } = await import('./fees-data.js');
  return loadFeesImpl();
}

// Initialize the admin dashboard
export async function initDashboard() {
  console.log("🎛️ Initializing admin dashboard...");

  // Set up authentication
  initAuth();

  // Initialize sections
  initTokensSection();

  // Lazy load and initialize other sections
  try {
    const { initAdsSection } = await import('./ads.js');
    initAdsSection();

    const { initTiersSection } = await import('./tiers.js');
    initTiersSection();

    const { initConfigSection } = await import('./config.js');
    initConfigSection();

    const { initServersSection } = await import('./servers.js');
    initServersSection();

    const { initTreasurySection } = await import('./treasury.js');
    initTreasurySection();

    const { initFeesSection } = await import('./fees-data.js');
    initFeesSection();

    console.log("✅ All sections initialized");
  } catch (error) {
    console.error("❌ Failed to initialize some sections:", error);
  }

  // Set default dates for date inputs
  setDefaultDates();

  // Check auth on load
  checkAuthAndLoad();

  console.log("✅ Admin dashboard initialized");
}

// Auto-initialize when loaded
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    initDashboard();
  }
}