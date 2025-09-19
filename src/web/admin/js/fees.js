// src/web/admin/js/fees.js - Fee management and preview functionality

export function setupFeeInputs(container) {
  // Setup preset buttons
  container.querySelectorAll('.preset-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const targetField = btn.dataset.field;
      const value = btn.dataset.value;
      const input = btn.closest('.fee-input-container').querySelector(`[data-field="${targetField}"]`);
      input.value = value;
      updateFeePreview(input);
    };
  });

  // Setup live preview on input change
  container.querySelectorAll('[data-field="tipFeePercent"], [data-field="houseFeePercent"]').forEach(input => {
    input.addEventListener('input', () => updateFeePreview(input));
    updateFeePreview(input); // Initial preview
  });
}

function updateFeePreview(input) {
  const container = input.closest('.fee-input-container');
  const previewDiv = container.querySelector('.fee-preview');
  const value = parseFloat(input.value) || 0;
  const isTipFee = input.dataset.field === 'tipFeePercent';

  // Clear existing classes
  previewDiv.className = 'fee-preview';

  if (value === 0) {
    previewDiv.textContent = isTipFee ? 'No tip fees' : 'No house rake';
    previewDiv.classList.add('fee-success');
  } else if (value > 0 && value <= 2) {
    const example = isTipFee ? `$${(100 * value / 100).toFixed(2)} fee on $100 tip` : `$${(100 * value / 100).toFixed(2)} rake on $100 match`;
    previewDiv.textContent = `${example} (${Math.round(value * 100)} BPS)`;
    previewDiv.classList.add('fee-success');
  } else if (value > 2 && value <= 5) {
    const example = isTipFee ? `$${(100 * value / 100).toFixed(2)} fee on $100 tip` : `$${(100 * value / 100).toFixed(2)} rake on $100 match`;
    previewDiv.textContent = `⚠️ ${example} (${Math.round(value * 100)} BPS)`;
    previewDiv.classList.add('fee-warning');
  } else if (value > 5) {
    const example = isTipFee ? `$${(100 * value / 100).toFixed(2)} fee on $100 tip` : `$${(100 * value / 100).toFixed(2)} rake on $100 match`;
    previewDiv.textContent = `🚨 HIGH FEE: ${example} (${Math.round(value * 100)} BPS)`;
    previewDiv.classList.add('fee-error');
  } else {
    previewDiv.textContent = '';
  }
}