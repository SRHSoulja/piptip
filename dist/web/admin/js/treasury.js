// src/web/admin/js/treasury.js - Treasury management module
import { makeAuthenticatedRequest } from '/admin/core.js';
import { createTransactionTableRow, createGroupTipTableRow } from '/admin/ui-secure-helpers.js';

export async function loadTreasury() {
  console.log("💰 Loading treasury data...");

  try {
    // Load transactions
    await loadTransactions();

    // Load group tips
    await loadGroupTips();

    console.log("✅ Treasury data loaded");
  } catch (error) {
    console.error("❌ Failed to load treasury data:", error);
  }
}

async function loadTransactions() {
  try {
    const data = await makeAuthenticatedRequest('/admin/transactions');
    if (!data.ok) {
      throw new Error(data.error);
    }

    const tbody = document.querySelector('#transactionsTbl tbody');
    if (!tbody) {
      console.warn("Transactions table not found, skipping transaction loading");
      return;
    }

    tbody.innerHTML = '';
    data.transactions.forEach(transaction => {
      tbody.appendChild(createTransactionTableRow(transaction));
    });

    console.log(`✅ Loaded ${data.transactions.length} transactions`);
  } catch (error) {
    console.error("❌ Failed to load transactions:", error);
    const msg = document.getElementById('transactionsMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to load transactions: ${error.message}</span>`;
    }
  }
}

async function loadGroupTips() {
  try {
    const data = await makeAuthenticatedRequest('/admin/group-tips');
    if (!data.ok) {
      throw new Error(data.error);
    }

    const tbody = document.querySelector('#groupTipsTbl tbody');
    if (!tbody) {
      console.warn("Group tips table not found, skipping group tip loading");
      return;
    }

    tbody.innerHTML = '';
    data.groupTips.forEach(groupTip => {
      tbody.appendChild(createGroupTipTableRow(groupTip));
    });

    console.log(`✅ Loaded ${data.groupTips.length} group tips`);
  } catch (error) {
    console.error("❌ Failed to load group tips:", error);
    const msg = document.getElementById('groupTipsMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to load group tips: ${error.message}</span>`;
    }
  }
}

export function initTreasurySection() {
  // Add refresh buttons
  const refreshTransactionsBtn = document.getElementById('refreshTransactions');
  if (refreshTransactionsBtn) {
    refreshTransactionsBtn.addEventListener('click', loadTransactions);
  }

  const refreshGroupTipsBtn = document.getElementById('refreshGroupTips');
  if (refreshGroupTipsBtn) {
    refreshGroupTipsBtn.addEventListener('click', loadGroupTips);
  }
}