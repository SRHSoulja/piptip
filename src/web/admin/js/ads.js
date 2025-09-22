// src/web/admin/js/ads.js - Ads management module
import { makeAuthenticatedRequest } from './core.js';
import { createAdTableRow } from './ui-secure-helpers.js';

export async function loadAds() {
  console.log("🎯 Loading ads...");

  try {
    const data = await makeAuthenticatedRequest('/admin/ads');
    if (!data.ok) {
      throw new Error(data.error);
    }

    const tbody = document.querySelector('#adsTbl tbody');
    if (!tbody) {
      console.warn("Ads table not found, skipping ad loading");
      return;
    }

    tbody.innerHTML = '';
    data.ads.forEach(ad => {
      tbody.appendChild(createAdTableRow(ad));
    });

    console.log(`✅ Loaded ${data.ads.length} ads`);
  } catch (error) {
    console.error("❌ Failed to load ads:", error);
    const msg = document.getElementById('adsMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to load ads: ${error.message}</span>`;
    }
  }
}

export async function refreshAdsCache() {
  try {
    const data = await makeAuthenticatedRequest('/admin/ads/refresh', { method: 'POST' });
    if (!data.ok) {
      throw new Error(data.error);
    }

    console.log("✅ Ads cache refreshed");
    await loadAds(); // Reload ads after refresh

    const msg = document.getElementById('adsMsg');
    if (msg) {
      msg.innerHTML = `<span class="ok">${data.message}</span>`;
    }
  } catch (error) {
    console.error("❌ Failed to refresh ads cache:", error);
    const msg = document.getElementById('adsMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to refresh cache: ${error.message}</span>`;
    }
  }
}

export function initAdsSection() {
  // Add event listeners for ads functionality
  const refreshBtn = document.getElementById('refreshAdsCache');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshAdsCache);
  }

  const createBtn = document.getElementById('createAd');
  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      try {
        const text = document.getElementById('newAdText')?.value?.trim();
        const url = document.getElementById('newAdUrl')?.value?.trim();
        const weight = document.getElementById('newAdWeight')?.value || 5;

        if (!text) {
          throw new Error('Ad text is required');
        }

        const data = await makeAuthenticatedRequest('/admin/ads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, url, weight })
        });

        if (!data.ok) {
          throw new Error(data.error);
        }

        // Clear form
        document.getElementById('newAdText').value = '';
        document.getElementById('newAdUrl').value = '';
        document.getElementById('newAdWeight').value = '5';

        // Reload ads
        await loadAds();

        const msg = document.getElementById('adsMsg');
        if (msg) {
          msg.innerHTML = `<span class="ok">${data.message}</span>`;
        }
      } catch (error) {
        console.error("❌ Failed to create ad:", error);
        const msg = document.getElementById('adsMsg');
        if (msg) {
          msg.innerHTML = `<span class="err">Failed to create ad: ${error.message}</span>`;
        }
      }
    });
  }
}