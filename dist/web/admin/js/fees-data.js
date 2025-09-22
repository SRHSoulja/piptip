// src/web/admin/js/fees-data.js - Fee data management module
import { makeAuthenticatedRequest } from '/admin/core.js';

export async function loadFees() {
  console.log("💳 Fee data loading skipped - not implemented in modular admin");
  // Fees section not implemented in modular admin yet
  return;

  /* Future implementation:
  try {
    const data = await makeAuthenticatedRequest('/admin/fees/by-server');
    if (!data.ok) {
      throw new Error(data.error);
    }

    // Update fee display elements
    const feeData = data.fees;
    if (feeData) {
      // Update global fee settings
      const tipFeeInput = document.getElementById('globalTipFee');
      if (tipFeeInput && feeData.tipFeeBps !== undefined) {
        tipFeeInput.value = feeData.tipFeeBps;
      }

      const houseFeeInput = document.getElementById('globalHouseFee');
      if (houseFeeInput && feeData.houseFeeBps !== undefined) {
        houseFeeInput.value = feeData.houseFeeBps;
      }

      // Update fee statistics if available
      updateFeeStatistics(feeData.statistics);
    }

    console.log("✅ Fee data loaded");
  } catch (error) {
    console.error("❌ Failed to load fee data:", error);
    const msg = document.getElementById('feesMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to load fees: ${error.message}</span>`;
    }
  }
  */
}

function updateFeeStatistics(stats) {
  if (!stats) return;

  const statsContainer = document.getElementById('feeStatistics');
  if (!statsContainer) return;

  statsContainer.innerHTML = `
    <h4>📊 Fee Statistics</h4>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
      <div style="background: #333; padding: 10px; border-radius: 4px;">
        <div style="color: #60a5fa;">Total Fees Collected</div>
        <div style="font-size: 1.2em; font-weight: bold;">${stats.totalFeesCollected || '0'}</div>
      </div>
      <div style="background: #333; padding: 10px; border-radius: 4px;">
        <div style="color: #60a5fa;">Average Fee Per Transaction</div>
        <div style="font-size: 1.2em; font-weight: bold;">${stats.averageFeePerTransaction || '0'}</div>
      </div>
      <div style="background: #333; padding: 10px; border-radius: 4px;">
        <div style="color: #60a5fa;">Transactions This Month</div>
        <div style="font-size: 1.2em; font-weight: bold;">${stats.transactionsThisMonth || '0'}</div>
      </div>
    </div>
  `;
}

export function initFeesSection() {
  // Add event listeners for fee management
  const saveFeeBtn = document.getElementById('saveFeeSettings');
  if (saveFeeBtn) {
    saveFeeBtn.addEventListener('click', async () => {
      try {
        const tipFeeBps = document.getElementById('globalTipFee')?.value;
        const houseFeeBps = document.getElementById('globalHouseFee')?.value;

        const data = await makeAuthenticatedRequest('/admin/fees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tipFeeBps: Number(tipFeeBps),
            houseFeeBps: Number(houseFeeBps)
          })
        });

        if (!data.ok) {
          throw new Error(data.error);
        }

        const msg = document.getElementById('feesMsg');
        if (msg) {
          msg.innerHTML = `<span class="ok">Fee settings saved successfully</span>`;
        }
      } catch (error) {
        console.error("❌ Failed to save fee settings:", error);
        const msg = document.getElementById('feesMsg');
        if (msg) {
          msg.innerHTML = `<span class="err">Failed to save fees: ${error.message}</span>`;
        }
      }
    });
  }
}