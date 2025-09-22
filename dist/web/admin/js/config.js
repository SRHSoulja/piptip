// src/web/admin/js/config.js - Configuration management module
import { makeAuthenticatedRequest } from '/admin/core.js';

export async function loadConfig() {
  console.log("⚙️ Config loading skipped - not implemented in modular admin");
  // Config section not implemented in modular admin yet
  return;

  /* Future implementation:
  try {
    const data = await makeAuthenticatedRequest('/admin/config');
    if (!data.ok) {
      throw new Error(data.error);
    }

    // Update config form fields
    const config = data.config;
    if (config) {
      Object.keys(config).forEach(key => {
        const input = document.getElementById(`config-${key}`);
        if (input) {
          if (input.type === 'checkbox') {
            input.checked = Boolean(config[key]);
          } else {
            input.value = config[key] || '';
          }
        }
      });
    }

    console.log("✅ Configuration loaded");
  } catch (error) {
    console.error("❌ Failed to load configuration:", error);
    const msg = document.getElementById('configMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to load config: ${error.message}</span>`;
    }
  }
  */
}

export function initConfigSection() {
  // Add event listeners for config functionality
  const saveBtn = document.getElementById('saveConfig');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        // Collect all config values
        const config = {};
        const configInputs = document.querySelectorAll('[id^="config-"]');
        configInputs.forEach(input => {
          const key = input.id.replace('config-', '');
          if (input.type === 'checkbox') {
            config[key] = input.checked;
          } else if (input.type === 'number') {
            config[key] = Number(input.value);
          } else {
            config[key] = input.value;
          }
        });

        const data = await makeAuthenticatedRequest('/admin/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });

        if (!data.ok) {
          throw new Error(data.error);
        }

        const msg = document.getElementById('configMsg');
        if (msg) {
          msg.innerHTML = `<span class="ok">Configuration saved successfully</span>`;
        }
      } catch (error) {
        console.error("❌ Failed to save configuration:", error);
        const msg = document.getElementById('configMsg');
        if (msg) {
          msg.innerHTML = `<span class="err">Failed to save config: ${error.message}</span>`;
        }
      }
    });
  }
}