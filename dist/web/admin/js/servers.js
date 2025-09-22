// src/web/admin/js/servers.js - Server management module
import { makeAuthenticatedRequest } from '/admin/core.js';

export async function loadServers() {
  console.log("🖥️ Loading servers...");

  try {
    const data = await makeAuthenticatedRequest('/admin/servers');
    if (!data.ok) {
      throw new Error(data.error);
    }

    const tbody = document.querySelector('#serversTbl tbody');
    if (!tbody) {
      console.warn("Servers table not found, skipping server loading");
      return;
    }

    tbody.innerHTML = '';
    data.servers.forEach(server => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${server.id}</td>
        <td>${server.guildId}</td>
        <td>${server.name || 'Unknown'}</td>
        <td><input type="checkbox" ${server.active ? 'checked' : ''} data-server-id="${server.id}"></td>
        <td>${new Date(server.createdAt).toLocaleDateString()}</td>
        <td>
          <button onclick="deleteServer('${server.id}')" style="background: #ef4444;">🗑️ Remove</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    console.log(`✅ Loaded ${data.servers.length} servers`);
  } catch (error) {
    console.error("❌ Failed to load servers:", error);
    const msg = document.getElementById('serversMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to load servers: ${error.message}</span>`;
    }
  }
}

export function initServersSection() {
  // Add event listeners for server functionality
  const addBtn = document.getElementById('addServer');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      try {
        const guildId = document.getElementById('newServerGuildId')?.value?.trim();
        const name = document.getElementById('newServerName')?.value?.trim();

        if (!guildId) {
          throw new Error('Guild ID is required');
        }

        const data = await makeAuthenticatedRequest('/admin/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildId, name })
        });

        if (!data.ok) {
          throw new Error(data.error);
        }

        // Clear form
        document.getElementById('newServerGuildId').value = '';
        document.getElementById('newServerName').value = '';

        // Reload servers
        await loadServers();

        const msg = document.getElementById('serversMsg');
        if (msg) {
          msg.innerHTML = `<span class="ok">Server added successfully</span>`;
        }
      } catch (error) {
        console.error("❌ Failed to add server:", error);
        const msg = document.getElementById('serversMsg');
        if (msg) {
          msg.innerHTML = `<span class="err">Failed to add server: ${error.message}</span>`;
        }
      }
    });
  }
}

// Global function for delete button (called from inline onclick)
window.deleteServer = async function(serverId) {
  if (!confirm('Are you sure you want to remove this server?')) {
    return;
  }

  try {
    const data = await makeAuthenticatedRequest(`/admin/servers/${serverId}`, {
      method: 'DELETE'
    });

    if (!data.ok) {
      throw new Error(data.error);
    }

    await loadServers();

    const msg = document.getElementById('serversMsg');
    if (msg) {
      msg.innerHTML = `<span class="ok">Server removed successfully</span>`;
    }
  } catch (error) {
    console.error("❌ Failed to remove server:", error);
    const msg = document.getElementById('serversMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to remove server: ${error.message}</span>`;
    }
  }
};