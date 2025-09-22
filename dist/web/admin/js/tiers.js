// src/web/admin/js/tiers.js - Tiers management module
import { makeAuthenticatedRequest } from '/admin/core.js';
import { createTierTableRow } from '/admin/ui-secure-helpers.js';

export async function loadTiers() {
  console.log("🎫 Loading tiers...");

  try {
    const data = await makeAuthenticatedRequest('/admin/tiers');
    if (!data.ok) {
      throw new Error(data.error);
    }

    const tbody = document.querySelector('#tiersTbl tbody');
    if (!tbody) {
      console.warn("Tiers table not found, skipping tier loading");
      return;
    }

    tbody.innerHTML = '';
    data.tiers.forEach(tier => {
      tbody.appendChild(createTierTableRow(tier));
    });

    console.log(`✅ Loaded ${data.tiers.length} tiers`);
  } catch (error) {
    console.error("❌ Failed to load tiers:", error);
    const msg = document.getElementById('tiersMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to load tiers: ${error.message}</span>`;
    }
  }
}

export function initTiersSection() {
  // Add event listeners for tiers functionality
  const createBtn = document.getElementById('createTier');
  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      try {
        const name = document.getElementById('newTierName')?.value?.trim();
        const description = document.getElementById('newTierDescription')?.value?.trim();
        const price = document.getElementById('newTierPrice')?.value || 0;

        if (!name) {
          throw new Error('Tier name is required');
        }

        const data = await makeAuthenticatedRequest('/admin/tiers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, price: Number(price) })
        });

        if (!data.ok) {
          throw new Error(data.error);
        }

        // Clear form
        document.getElementById('newTierName').value = '';
        document.getElementById('newTierDescription').value = '';
        document.getElementById('newTierPrice').value = '0';

        // Reload tiers
        await loadTiers();

        const msg = document.getElementById('tiersMsg');
        if (msg) {
          msg.innerHTML = `<span class="ok">${data.message}</span>`;
        }
      } catch (error) {
        console.error("❌ Failed to create tier:", error);
        const msg = document.getElementById('tiersMsg');
        if (msg) {
          msg.innerHTML = `<span class="err">Failed to create tier: ${error.message}</span>`;
        }
      }
    });
  }
}