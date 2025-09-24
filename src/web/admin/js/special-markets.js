// src/web/admin/js/special-markets.js - Special Market Management Dashboard
import { apiCall, showMessage } from '/admin/core.js';

let availableTemplates = [];
let selectedTemplate = null;
let adminLevel = null;

/**
 * Initialize the special markets section
 */
export function initSpecialMarketsSection() {
  console.log("🌟 Initializing special markets section...");

  // Check admin permissions
  initAdminPermissionCheck();

  // Initialize template selection
  initTemplateSelection();

  // Initialize form handlers
  initFormHandlers();

  // Initialize resolution section
  initResolutionSection();

  // Load initial data
  loadSpecialMarketsData();

  console.log("✅ Special markets section initialized");
}

/**
 * Check admin permissions and display status
 */
async function initAdminPermissionCheck() {
  const adminLevelIndicator = document.getElementById('adminLevelIndicator');
  const createForm = document.getElementById('createSpecialMarketForm');

  try {
    const response = await apiCall('/admin/prediction_markets/templates', 'GET');

    if (response.success) {
      const isAdmin = response.isAdmin;
      const isSuperUser = response.isSuperUser;

      if (isSuperUser) {
        adminLevel = 'super-user';
        adminLevelIndicator.innerHTML = '<span class="admin-level-indicator super-user">🔥 SUPER USER</span>';
        createForm.style.display = 'block';
      } else if (isAdmin) {
        adminLevel = 'admin';
        adminLevelIndicator.innerHTML = '<span class="admin-level-indicator admin">⭐ ADMIN</span>';
        createForm.style.display = 'block';
      } else {
        adminLevel = 'no-admin';
        adminLevelIndicator.innerHTML = '<span class="admin-level-indicator no-admin">❌ NO ADMIN ACCESS</span>';
        createForm.style.display = 'none';
        showMessage('specialMarketsMsg', 'You do not have admin privileges to create special markets', 'err');
      }
    } else {
      throw new Error(response.error || 'Failed to check admin status');
    }
  } catch (error) {
    console.error('Failed to check admin permissions:', error);
    adminLevelIndicator.innerHTML = '<span class="admin-level-indicator no-admin">❌ ERROR CHECKING ACCESS</span>';
    createForm.style.display = 'none';
  }
}

/**
 * Initialize template selection
 */
async function initTemplateSelection() {
  try {
    const response = await apiCall('/admin/prediction_markets/templates', 'GET');

    if (response.success) {
      availableTemplates = response.templates;
      renderTemplateGrid();
      populateTemplateSelect();
      updateTemplateStats();
    } else {
      throw new Error(response.error || 'Failed to load templates');
    }
  } catch (error) {
    console.error('Failed to load templates:', error);
    showMessage('specialMarketsMsg', `Failed to load templates: ${error.message}`, 'err');
  }
}

/**
 * Render template grid
 */
function renderTemplateGrid() {
  const templateGrid = document.getElementById('templateGrid');

  if (!availableTemplates || availableTemplates.length === 0) {
    templateGrid.innerHTML = '<div style="color: #9ca3af;">No templates available</div>';
    return;
  }

  templateGrid.innerHTML = availableTemplates.map(template => `
    <div class="template-card" data-template="${template.templateType}">
      <div class="template-name">${template.name}</div>
      <div class="template-description">${template.description}</div>
      <div class="template-details">
        <span class="template-category ${template.category}">${template.category}</span>
        <span class="template-category">${template.resolutionMethod}</span>
        <span class="template-category">${template.marketOutcomes.length} outcomes</span>
      </div>
    </div>
  `).join('');

  // Add click handlers for template cards
  templateGrid.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => {
      const templateType = card.dataset.template;
      selectTemplate(templateType);
    });
  });
}

/**
 * Populate template select dropdown
 */
function populateTemplateSelect() {
  const templateSelect = document.getElementById('specialMarketTemplate');

  templateSelect.innerHTML = '<option value="">Select a template...</option>' +
    availableTemplates.map(template =>
      `<option value="${template.templateType}">${template.name} (${template.category})</option>`
    ).join('');

  templateSelect.addEventListener('change', (e) => {
    if (e.target.value) {
      selectTemplate(e.target.value);
    }
  });
}

/**
 * Select a template
 */
function selectTemplate(templateType) {
  selectedTemplate = availableTemplates.find(t => t.templateType === templateType);

  // Update UI
  document.querySelectorAll('.template-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.template === templateType);
  });

  document.getElementById('specialMarketTemplate').value = templateType;

  // Update form based on template
  updateFormForTemplate(selectedTemplate);

  console.log('Selected template:', selectedTemplate);
}

/**
 * Update form based on selected template
 */
function updateFormForTemplate(template) {
  const customOutcomesGroup = document.getElementById('customOutcomesGroup');
  const liquidityInput = document.getElementById('specialMarketLiquidity');
  const titleInput = document.getElementById('specialMarketTitle');
  const descriptionInput = document.getElementById('specialMarketDescription');

  if (template) {
    // Show/hide custom outcomes based on template
    customOutcomesGroup.style.display = template.allowCustomOutcomes ? 'block' : 'none';

    // Set default liquidity
    if (template.defaultLiquidity > 0) {
      liquidityInput.value = template.defaultLiquidity;
    }

    // Auto-populate title and description with example
    if (template.examples && template.examples.length > 0) {
      const example = template.examples[0];
      titleInput.placeholder = example;
      descriptionInput.placeholder = `${template.description}. Example: ${example}`;
    }

    // If template has predefined outcomes, show them as preview
    if (template.marketOutcomes && template.marketOutcomes.length > 0 && !template.allowCustomOutcomes) {
      document.getElementById('specialMarketOutcomes').value = template.marketOutcomes.join(', ');
    }
  }
}

/**
 * Initialize form handlers
 */
function initFormHandlers() {
  // Create special market handler
  document.getElementById('createSpecialMarket').addEventListener('click', async () => {
    await createSpecialMarket();
  });

  // Preview handler
  document.getElementById('previewSpecialMarket').addEventListener('click', () => {
    previewSpecialMarket();
  });

  // Reset form handler
  document.getElementById('resetSpecialMarketForm').addEventListener('click', () => {
    resetSpecialMarketForm();
  });
}

/**
 * Create a special market
 */
async function createSpecialMarket() {
  if (!selectedTemplate) {
    showMessage('specialMarketsMsg', 'Please select a template first', 'err');
    return;
  }

  const title = document.getElementById('specialMarketTitle').value.trim();
  const description = document.getElementById('specialMarketDescription').value.trim();
  const resolveAt = document.getElementById('specialMarketResolveAt').value;
  const liquidity = parseInt(document.getElementById('specialMarketLiquidity').value);
  const customOutcomes = document.getElementById('specialMarketOutcomes').value.trim();

  // Validation
  if (!title || !description || !resolveAt) {
    showMessage('specialMarketsMsg', 'Please fill in all required fields', 'err');
    return;
  }

  if (new Date(resolveAt) <= new Date()) {
    showMessage('specialMarketsMsg', 'Resolution date must be in the future', 'err');
    return;
  }

  if (liquidity < 100 || liquidity > 10000) {
    showMessage('specialMarketsMsg', 'Liquidity must be between 100 and 10,000 PIPChips', 'err');
    return;
  }

  // Prepare outcomes
  let outcomes = [];
  if (selectedTemplate.allowCustomOutcomes && customOutcomes) {
    outcomes = customOutcomes.split(',').map(o => o.trim()).filter(o => o);
    if (outcomes.length < 2 || outcomes.length > 10) {
      showMessage('specialMarketsMsg', 'Please provide 2-10 outcomes', 'err');
      return;
    }
  } else {
    outcomes = selectedTemplate.marketOutcomes;
  }

  try {
    showMessage('specialMarketsMsg', 'Creating special market...', 'ok');

    const response = await apiCall('/admin/prediction_markets/create-special', 'POST', {
      templateType: selectedTemplate.templateType,
      title,
      description,
      resolveAt: new Date(resolveAt).toISOString(),
      liquidity,
      outcomes,
      guildId: 'admin-created' // Admin-created markets get special guild ID
    });

    if (response.success) {
      showMessage('specialMarketsMsg', `✅ Special market created! ID: ${response.market.id}`, 'ok');
      resetSpecialMarketForm();
      loadSpecialMarketsData(); // Refresh stats
    } else {
      throw new Error(response.error || 'Failed to create market');
    }
  } catch (error) {
    console.error('Failed to create special market:', error);
    showMessage('specialMarketsMsg', `❌ Failed to create market: ${error.message}`, 'err');
  }
}

/**
 * Preview special market
 */
function previewSpecialMarket() {
  if (!selectedTemplate) {
    showMessage('specialMarketsMsg', 'Please select a template first', 'err');
    return;
  }

  const title = document.getElementById('specialMarketTitle').value.trim();
  const description = document.getElementById('specialMarketDescription').value.trim();
  const resolveAt = document.getElementById('specialMarketResolveAt').value;
  const liquidity = parseInt(document.getElementById('specialMarketLiquidity').value);
  const customOutcomes = document.getElementById('specialMarketOutcomes').value.trim();

  let outcomes = [];
  if (selectedTemplate.allowCustomOutcomes && customOutcomes) {
    outcomes = customOutcomes.split(',').map(o => o.trim()).filter(o => o);
  } else {
    outcomes = selectedTemplate.marketOutcomes;
  }

  const previewHtml = `
    <div class="outcome-preview">
      <strong>Market Preview:</strong><br>
      <strong>Title:</strong> ${title || '[Enter title]'}<br>
      <strong>Description:</strong> ${description || '[Enter description]'}<br>
      <strong>Template:</strong> ${selectedTemplate.name} (${selectedTemplate.resolutionMethod})<br>
      <strong>Outcomes:</strong> ${outcomes.join(', ')}<br>
      <strong>Resolve At:</strong> ${resolveAt ? new Date(resolveAt).toLocaleString() : '[Select date]'}<br>
      <strong>Liquidity:</strong> ${liquidity} PIPChips<br>
      <div class="payout-preview">Each winning outcome pays 1:1 in PIPChips</div>
    </div>
  `;

  showMessage('specialMarketsMsg', previewHtml, 'ok');
}

/**
 * Reset special market form
 */
function resetSpecialMarketForm() {
  document.getElementById('specialMarketTitle').value = '';
  document.getElementById('specialMarketDescription').value = '';
  document.getElementById('specialMarketResolveAt').value = '';
  document.getElementById('specialMarketLiquidity').value = '1000';
  document.getElementById('specialMarketOutcomes').value = '';
  document.getElementById('specialMarketTemplate').value = '';

  // Clear template selection
  selectedTemplate = null;
  document.querySelectorAll('.template-card').forEach(card => {
    card.classList.remove('selected');
  });

  document.getElementById('customOutcomesGroup').style.display = 'none';
}

/**
 * Initialize resolution section
 */
function initResolutionSection() {
  document.getElementById('loadExpiredManualMarkets').addEventListener('click', () => {
    loadManualMarketsForResolution(true);
  });

  document.getElementById('loadAllManualMarkets').addEventListener('click', () => {
    loadManualMarketsForResolution(false);
  });
}

/**
 * Load manual markets for resolution
 */
async function loadManualMarketsForResolution(expiredOnly = true) {
  const resolutionSection = document.getElementById('manualResolutionSection');

  try {
    resolutionSection.innerHTML = '<div style="color: #9ca3af;">Loading manual markets...</div>';

    const response = await apiCall('/admin/prediction_markets/special?status=ACTIVE&manualOnly=true', 'GET');

    if (response.success) {
      const markets = response.markets || [];
      const now = new Date();

      let filteredMarkets = markets;
      if (expiredOnly) {
        filteredMarkets = markets.filter(market => new Date(market.resolveAt) <= now);
      }

      if (filteredMarkets.length === 0) {
        resolutionSection.innerHTML = `<div style="color: #9ca3af;">No ${expiredOnly ? 'expired' : ''} manual markets found</div>`;
        return;
      }

      resolutionSection.innerHTML = filteredMarkets.map(market => renderResolutionMarket(market)).join('');

      // Add event handlers for resolution actions
      initResolutionActions();

    } else {
      throw new Error(response.error || 'Failed to load manual markets');
    }
  } catch (error) {
    console.error('Failed to load manual markets:', error);
    resolutionSection.innerHTML = `<div style="color: #ef4444;">❌ Error: ${error.message}</div>`;
  }
}

/**
 * Render a resolution market card
 */
function renderResolutionMarket(market) {
  const isExpired = new Date(market.resolveAt) <= new Date();
  const outcomes = market.marketData?.outcomes || market.marketOutcomes || ['Yes', 'No'];

  return `
    <div class="resolution-market ${isExpired ? 'expired' : ''}" data-market-id="${market.id}">
      <h4>${market.title}</h4>
      <div class="resolution-details">
        <div>
          <div class="market-info">
            <strong>Description:</strong> ${market.description}<br>
            <strong>Template:</strong> ${market.marketData?.templateType || 'Unknown'}<br>
            <strong>Resolution Method:</strong> ${market.marketData?.resolutionMethod || 'MANUAL_ADMIN'}<br>
            <strong>Created:</strong> ${new Date(market.createdAt).toLocaleString()}<br>
            <strong>Resolve At:</strong> ${new Date(market.resolveAt).toLocaleString()} ${isExpired ? '⏰ EXPIRED' : ''}<br>
            <strong>Total Bets:</strong> ${market.totalBetCount || 0}<br>
            <strong>Pool Size:</strong> ${market.totalPipchipsVolume ? Number(market.totalPipchipsVolume) : 0} PIPChips
          </div>

          <div class="market-outcomes">
            ${outcomes.map(outcome => `
              <div class="outcome-option" data-outcome="${outcome}">
                ${outcome}
              </div>
            `).join('')}
          </div>

          <div class="outcome-preview" id="preview-${market.id}" style="display: none;">
            <strong>Selected Outcome:</strong> <span id="selected-outcome-${market.id}">None</span><br>
            <div class="payout-preview">Winning bets will be paid 1:1 in PIPChips</div>
          </div>
        </div>

        <div class="resolution-actions">
          <button class="btn-primary resolve-btn" data-market-id="${market.id}">
            ⚖️ Resolve Market
          </button>
          <button class="btn-secondary cancel-btn" data-market-id="${market.id}">
            ❌ Cancel Market
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Initialize resolution actions
 */
function initResolutionActions() {
  // Outcome selection
  document.querySelectorAll('.outcome-option').forEach(option => {
    option.addEventListener('click', (e) => {
      const marketCard = e.target.closest('.resolution-market');
      const marketId = marketCard.dataset.marketId;
      const outcome = e.target.dataset.outcome;

      // Toggle selection
      marketCard.querySelectorAll('.outcome-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      e.target.classList.add('selected');

      // Update preview
      const preview = document.getElementById(`preview-${marketId}`);
      const selectedOutcome = document.getElementById(`selected-outcome-${marketId}`);

      preview.style.display = 'block';
      selectedOutcome.textContent = outcome;
    });
  });

  // Resolve button
  document.querySelectorAll('.resolve-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const marketId = e.target.dataset.marketId;
      await resolveManualMarket(marketId);
    });
  });

  // Cancel button
  document.querySelectorAll('.cancel-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const marketId = e.target.dataset.marketId;
      await cancelManualMarket(marketId);
    });
  });
}

/**
 * Resolve a manual market
 */
async function resolveManualMarket(marketId) {
  const marketCard = document.querySelector(`[data-market-id="${marketId}"]`);
  const selectedOutcome = marketCard.querySelector('.outcome-option.selected');

  if (!selectedOutcome) {
    showMessage('specialMarketsMsg', 'Please select an outcome first', 'err');
    return;
  }

  const outcome = selectedOutcome.dataset.outcome;

  if (!confirm(`Are you sure you want to resolve this market with outcome: "${outcome}"?`)) {
    return;
  }

  try {
    const response = await apiCall(`/admin/prediction_markets/${marketId}/manual-resolve`, 'POST', {
      outcome
    });

    if (response.success) {
      showMessage('specialMarketsMsg', `✅ Market resolved with outcome: ${outcome}`, 'ok');
      marketCard.remove();
      loadSpecialMarketsData(); // Refresh stats
    } else {
      throw new Error(response.error || 'Failed to resolve market');
    }
  } catch (error) {
    console.error('Failed to resolve market:', error);
    showMessage('specialMarketsMsg', `❌ Failed to resolve market: ${error.message}`, 'err');
  }
}

/**
 * Cancel a manual market
 */
async function cancelManualMarket(marketId) {
  if (!confirm('Are you sure you want to cancel this market? All bets will be refunded.')) {
    return;
  }

  try {
    const response = await apiCall(`/admin/prediction_markets/${marketId}/manual-resolve`, 'POST', {
      outcome: 'CANCEL'
    });

    if (response.success) {
      showMessage('specialMarketsMsg', '✅ Market cancelled and bets refunded', 'ok');
      document.querySelector(`[data-market-id="${marketId}"]`).remove();
      loadSpecialMarketsData(); // Refresh stats
    } else {
      throw new Error(response.error || 'Failed to cancel market');
    }
  } catch (error) {
    console.error('Failed to cancel market:', error);
    showMessage('specialMarketsMsg', `❌ Failed to cancel market: ${error.message}`, 'err');
  }
}

/**
 * Update template statistics
 */
function updateTemplateStats() {
  const templatesAvailable = document.getElementById('templatesAvailable');
  templatesAvailable.textContent = availableTemplates ? availableTemplates.length : 0;
}

/**
 * Load and update special market statistics
 */
async function loadSpecialMarketsData() {
  try {
    // Load special market stats
    const statsResponse = await apiCall('/admin/prediction_markets/special', 'GET');

    if (statsResponse.success) {
      const markets = statsResponse.markets || [];

      // Update stats
      document.getElementById('totalSpecialMarkets').textContent = markets.length;
      document.getElementById('activeManualMarkets').textContent =
        markets.filter(m => m.status === 'ACTIVE' && m.marketData?.resolutionMethod === 'MANUAL_ADMIN').length;
      document.getElementById('pendingResolution').textContent =
        markets.filter(m => m.status === 'ACTIVE' && new Date(m.resolveAt) <= new Date() &&
          m.marketData?.resolutionMethod === 'MANUAL_ADMIN').length;
    }
  } catch (error) {
    console.error('Failed to load special market stats:', error);
  }
}

// Auto-initialize if DOM is ready
if (typeof window !== 'undefined' && document.readyState !== 'loading') {
  // Will be initialized by the main dashboard
}