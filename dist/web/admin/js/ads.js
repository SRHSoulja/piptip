// src/web/admin/js/ads.js - Ads management module
import { makeAuthenticatedRequest } from '/admin/core.js';
import { createAdTableRow } from '/admin/ui-secure-helpers.js';

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
      const tr = document.createElement('tr');
      tr.dataset.id = ad.id;

      // ID cell
      const idCell = document.createElement('td');
      idCell.textContent = ad.id;
      tr.appendChild(idCell);

      // Text input cell
      const textCell = document.createElement('td');
      const textInput = document.createElement('input');
      textInput.value = ad.text || '';
      textInput.setAttribute('data-field', 'text');
      textInput.maxLength = 500;
      textInput.style.width = '420px';
      textCell.appendChild(textInput);
      tr.appendChild(textCell);

      // URL input cell
      const urlCell = document.createElement('td');
      const urlInput = document.createElement('input');
      urlInput.value = ad.url || '';
      urlInput.setAttribute('data-field', 'url');
      urlInput.placeholder = 'https://...';
      urlInput.style.width = '320px';
      urlCell.appendChild(urlInput);
      tr.appendChild(urlCell);

      // Weight input cell
      const weightCell = document.createElement('td');
      const weightInput = document.createElement('input');
      weightInput.type = 'number';
      weightInput.value = ad.weight;
      weightInput.setAttribute('data-field', 'weight');
      weightInput.min = '1';
      weightInput.max = '100';
      weightInput.style.width = '80px';
      weightCell.appendChild(weightInput);
      tr.appendChild(weightCell);

      // Active checkbox cell
      const activeCell = document.createElement('td');
      const activeCheckbox = document.createElement('input');
      activeCheckbox.type = 'checkbox';
      activeCheckbox.checked = ad.active;
      activeCheckbox.setAttribute('data-field', 'active');
      activeCell.appendChild(activeCheckbox);
      tr.appendChild(activeCell);

      // Actions cell
      const actionsCell = document.createElement('td');
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.className = 'saveAd';
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'deleteAd';
      deleteBtn.style.background = '#ef4444';
      deleteBtn.style.marginLeft = '5px';
      actionsCell.appendChild(saveBtn);
      actionsCell.appendChild(deleteBtn);
      tr.appendChild(actionsCell);

      tbody.appendChild(tr);
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