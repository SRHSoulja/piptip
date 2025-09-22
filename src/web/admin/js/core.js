// src/web/admin/js/core.js - Core admin utilities and auth
export const $ = (id) => document.getElementById(id);

export const API = async (path, opts = {}) => {
  const secret = localStorage.getItem("pip_admin_secret") || "";
  const headers = { "Authorization": `Bearer ${secret}`, ...(opts.headers || {}) };
  console.log(`🌐 Making API call to: ${path}`);
  console.log(`🔑 Using admin secret: ${secret ? 'SET' : 'NOT SET'} (length: ${secret.length})`);
  console.log(`🔑 Full secret: "${secret}"`);
  try {
    console.log(`🚀 About to fetch: ${path} with headers:`, headers);
    const response = await fetch(path, { ...opts, headers });
    console.log(`📡 API response status: ${response.status}`);
    return response;
  }
  catch (error) {
    console.error("🚨 API request failed:", error);
    console.error("🚨 Error details:", error.message, error.stack);
    throw error;
  }
};

export const showMessage = (elementId, message, isError = false) => {
  const el = $(elementId);
  if (el) { el.textContent = message; el.className = isError ? "err" : "ok"; }
};

export const setLoading = (elementOrId, isLoading) => {
  const el = typeof elementOrId === "string" ? $(elementOrId) : elementOrId;
  if (el) { el.disabled = isLoading; el.classList.toggle("loading", isLoading); }
};

export const formatNumber = (n) => Number(n ?? 0).toLocaleString(undefined,{maximumFractionDigits:8,minimumFractionDigits:0});

export const setDefaultDates = () => {
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7*24*60*60*1000);
  // Only set dates if the elements exist
  const sinceEl = $("feesSince");
  const untilEl = $("feesUntil");
  if (sinceEl) sinceEl.value = weekAgo.toISOString().split('T')[0];
  if (untilEl) untilEl.value = today.toISOString().split('T')[0];
};

// Auth functionality
export async function checkAuthAndLoad() {
  try {
    const response = await API("/admin/ping");
    const data = await response.json();
    if (data.ok) {
      showMessage("authStatus","✓ Connected",false);
      // Dynamic import to load all modules when authenticated
      const { loadAllData } = await import('./dashboard.js');
      await loadAllData();
    }
    else { showMessage("authStatus","× Not authorized",true); clearAllTables(); }
  } catch { showMessage("authStatus","× Connection failed",true); clearAllTables(); }
}

export function clearAllTables() {
  ["tokensTbl","serversTbl","feesTbl","treasuryTbl","adsTbl","tiersTbl","usersTbl","transactionsTbl","groupTipsTbl"].forEach(id => {
    const tbody = document.querySelector(`#${id} tbody`); if (tbody) tbody.innerHTML = "";
  });
}

export function initAuth() {
  $("saveSecret").onclick = () => {
    const secret = $("secret").value.trim();
    if (!secret) return showMessage("authStatus","Please enter admin secret",true);
    localStorage.setItem("pip_admin_secret", secret);
    checkAuthAndLoad();
  };
}

// Export makeAuthenticatedRequest for other modules
export async function makeAuthenticatedRequest(path, opts = {}) {
  const response = await API(path, opts);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}