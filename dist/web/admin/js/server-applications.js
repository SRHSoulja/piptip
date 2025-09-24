// src/web/admin/js/server-applications.js - Server applications management module
import { makeAuthenticatedRequest } from '/admin/core.js';

export async function loadServerApplications(statusFilter = '') {
  console.log("📝 Loading server applications...", statusFilter ? `(status: ${statusFilter})` : '');

  try {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);

    const data = await makeAuthenticatedRequest(`/admin/server-applications?${params.toString()}`);
    if (!data.ok) {
      throw new Error(data.error);
    }

    const tbody = document.querySelector('#serverApplicationsTbl tbody');
    if (!tbody) {
      console.warn("Server applications table not found, skipping loading");
      return;
    }

    tbody.innerHTML = '';
    data.applications.forEach(app => {
      const tr = document.createElement('tr');

      // Status styling
      const statusClass = {
        'PENDING': 'style="color: #fbbf24;"',
        'APPROVED': 'style="color: #10b981;"',
        'REJECTED': 'style="color: #ef4444;"'
      }[app.status] || '';

      // Description preview (truncated)
      const descriptionPreview = app.description.length > 100
        ? app.description.substring(0, 100) + '...'
        : app.description;

      // Parse applicant roles and permissions
      let rolesDisplay = '';
      let permsDisplay = '';
      try {
        if (app.applicantRoles) {
          const roles = JSON.parse(app.applicantRoles);
          if (roles.length > 0) {
            rolesDisplay = `<div style="font-size: 10px; color: #94a3b8;">Roles: ${roles.slice(0, 2).join(", ")}${roles.length > 2 ? ` +${roles.length - 2}` : ""}</div>`;
          }
        }
        if (app.applicantPermissions) {
          const perms = JSON.parse(app.applicantPermissions);
          if (perms.length > 0) {
            permsDisplay = `<div style="font-size: 10px; color: #86efac;">${perms.includes("Administrator") ? "🔑 Administrator" : perms.join(", ")}</div>`;
          }
        }
      } catch (e) {
        // JSON parsing failed, ignore
      }

      tr.innerHTML = `
        <td>#${app.id}</td>
        <td>
          <div style="font-weight: bold;">${app.guildName}</div>
          <div style="font-size: 11px; color: #888;">${app.guildId}</div>
          ${app.serverSize ? `<div style="font-size: 10px; color: #666;">${app.serverSize.toLocaleString()} members</div>` : ''}
        </td>
        <td>
          <div>${app.applicantUsername} ${app.isServerOwner ? '<span style="color: #fbbf24;">👑</span>' : ''}</div>
          <div style="font-size: 11px; color: #888;">${app.applicantId}</div>
          ${permsDisplay}
          ${rolesDisplay}
          ${app.contactInfo ? `<div style="font-size: 10px; color: #666;">📧 ${app.contactInfo}</div>` : ''}
        </td>
        <td ${statusClass}>
          <span style="font-weight: bold;">${app.status}</span>
          ${app.reviewedAt ? `<div style="font-size: 10px;">Reviewed ${new Date(app.reviewedAt).toLocaleDateString()}</div>` : ''}
        </td>
        <td>
          <div>${new Date(app.submittedAt).toLocaleDateString()}</div>
          <div style="font-size: 11px; color: #888;">${new Date(app.submittedAt).toLocaleTimeString()}</div>
        </td>
        <td>
          <div style="max-width: 200px; font-size: 12px;" title="${app.description}">
            ${descriptionPreview}
          </div>
          ${app.useCase ? `<div style="max-width: 200px; font-size: 11px; color: #888; margin-top: 4px;" title="${app.useCase}">Use: ${app.useCase.substring(0, 80)}${app.useCase.length > 80 ? '...' : ''}</div>` : ''}
        </td>
        <td>
          <button onclick="viewApplicationDetails('${app.id}')" style="background: #3b82f6; margin: 2px;">👁️ View</button>
          ${app.status === 'PENDING' ? `
            <button onclick="approveApplication('${app.id}')" style="background: #10b981; margin: 2px;">✅ Approve</button>
            <button onclick="rejectApplication('${app.id}')" style="background: #ef4444; margin: 2px;">❌ Reject</button>
          ` : ''}
          ${app.status !== 'PENDING' ? `
            <button onclick="deleteApplication('${app.id}')" style="background: #6b7280; margin: 2px;">🗑️ Delete</button>
          ` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });

    console.log(`✅ Loaded ${data.applications.length} server applications`);

    // Update pagination info if needed
    if (data.pagination) {
      const { page, totalPages, total } = data.pagination;
      console.log(`📄 Page ${page} of ${totalPages} (${total} total applications)`);
    }

  } catch (error) {
    console.error("❌ Failed to load server applications:", error);
    const msg = document.getElementById('serverApplicationsMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to load applications: ${error.message}</span>`;
    }
  }
}

export async function loadApplicationStats() {
  try {
    const data = await makeAuthenticatedRequest('/admin/server-applications-stats');
    if (!data.ok) {
      throw new Error(data.error);
    }

    const stats = data.stats;

    // Update stat displays
    document.getElementById('totalApplications').textContent = stats.total || '0';
    document.getElementById('pendingApplications').textContent = stats.pending || '0';
    document.getElementById('approvedApplications').textContent = stats.approved || '0';
    document.getElementById('rejectedApplications').textContent = stats.rejected || '0';

    console.log("✅ Application statistics loaded:", stats);
  } catch (error) {
    console.error("❌ Failed to load application stats:", error);
  }
}

export function initServerApplicationsSection() {
  // Filter button
  const filterBtn = document.getElementById('filterApplications');
  if (filterBtn) {
    filterBtn.addEventListener('click', () => {
      const statusFilter = document.getElementById('applicationStatusFilter')?.value || '';
      loadServerApplications(statusFilter);
    });
  }

  // Refresh button
  const refreshBtn = document.getElementById('refreshApplications');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const statusFilter = document.getElementById('applicationStatusFilter')?.value || '';
      Promise.all([
        loadServerApplications(statusFilter),
        loadApplicationStats()
      ]);
    });
  }
}

// Global functions for button onclick handlers
window.viewApplicationDetails = async function(applicationId) {
  try {
    const data = await makeAuthenticatedRequest(`/admin/server-applications/${applicationId}`);
    if (!data.ok) {
      throw new Error(data.error);
    }

    const app = data.application;

    // Parse applicant info
    let rolesInfo = '';
    let permsInfo = '';
    try {
      if (app.applicantRoles) {
        const roles = JSON.parse(app.applicantRoles);
        if (roles.length > 0) {
          rolesInfo = `<strong>Applicant Roles:</strong> ${roles.join(", ")}<br>`;
        }
      }
      if (app.applicantPermissions) {
        const perms = JSON.parse(app.applicantPermissions);
        if (perms.length > 0) {
          permsInfo = `<strong>Applicant Permissions:</strong> ${perms.join(", ")}<br>`;
        }
      }
    } catch (e) {
      // JSON parsing failed
    }

    // Create detailed view modal/popup
    const detailsHtml = `
      <div style="background: #1a1a1a; padding: 20px; border-radius: 8px; border: 1px solid #444; max-width: 600px;">
        <h3>Application #${app.id} Details</h3>

        <div style="margin-bottom: 15px;">
          <strong>Server:</strong> ${app.guildName} (${app.guildId})<br>
          <strong>Applicant:</strong> ${app.applicantUsername} (${app.applicantId}) ${app.isServerOwner ? '👑 <span style="color: #fbbf24;">Server Owner</span>' : ''}<br>
          ${permsInfo}
          ${rolesInfo}
          <strong>Status:</strong> <span style="color: ${app.status === 'APPROVED' ? '#10b981' : app.status === 'REJECTED' ? '#ef4444' : '#fbbf24'};">${app.status}</span><br>
          <strong>Submitted:</strong> ${new Date(app.submittedAt).toLocaleString()}<br>
          ${app.serverSize ? `<strong>Server Size:</strong> ${app.serverSize.toLocaleString()} members<br>` : ''}
          ${app.contactInfo ? `<strong>Contact:</strong> ${app.contactInfo}<br>` : ''}
          ${app.isAlreadyApproved ? '<span style="color: #10b981;">✅ Server is already approved</span><br>' : ''}
        </div>

        <div style="margin-bottom: 15px;">
          <strong>Server Description:</strong><br>
          <div style="background: #333; padding: 10px; border-radius: 4px; margin-top: 5px;">
            ${app.description}
          </div>
        </div>

        <div style="margin-bottom: 15px;">
          <strong>Use Case:</strong><br>
          <div style="background: #333; padding: 10px; border-radius: 4px; margin-top: 5px;">
            ${app.useCase}
          </div>
        </div>

        ${app.reviewedBy ? `
          <div style="margin-bottom: 15px;">
            <strong>Review Info:</strong><br>
            <strong>Reviewed by:</strong> ${app.reviewedBy}<br>
            <strong>Reviewed at:</strong> ${new Date(app.reviewedAt).toLocaleString()}<br>
            ${app.reviewNote ? `<strong>Review note:</strong> ${app.reviewNote}<br>` : ''}
            ${app.rejectionReason ? `<strong>Rejection reason:</strong> ${app.rejectionReason}<br>` : ''}
          </div>
        ` : ''}

        <button onclick="this.parentElement.remove()" style="background: #6b7280;">Close</button>
      </div>
    `;

    // Find a good place to show the details (or create a modal)
    const msg = document.getElementById('serverApplicationsMsg');
    if (msg) {
      msg.innerHTML = detailsHtml;
    }

  } catch (error) {
    console.error("❌ Failed to load application details:", error);
    alert(`Failed to load application details: ${error.message}`);
  }
};

window.approveApplication = async function(applicationId) {
  const adminId = prompt('Enter your admin ID/username for the review:');
  if (!adminId) return;

  const reviewNote = prompt('Optional review note:');

  try {
    const data = await makeAuthenticatedRequest(`/admin/server-applications/${applicationId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId, reviewNote })
    });

    if (!data.ok) {
      throw new Error(data.error);
    }

    const msg = document.getElementById('serverApplicationsMsg');
    if (msg) {
      msg.innerHTML = `<span class="ok">Application #${applicationId} approved successfully!</span>`;
    }

    // Refresh the applications list and stats
    const statusFilter = document.getElementById('applicationStatusFilter')?.value || '';
    await Promise.all([
      loadServerApplications(statusFilter),
      loadApplicationStats()
    ]);

  } catch (error) {
    console.error("❌ Failed to approve application:", error);
    const msg = document.getElementById('serverApplicationsMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to approve application: ${error.message}</span>`;
    }
  }
};

window.rejectApplication = async function(applicationId) {
  const rejectionReason = prompt('Enter rejection reason (required):');
  if (!rejectionReason?.trim()) {
    alert('Rejection reason is required');
    return;
  }

  const adminId = prompt('Enter your admin ID/username for the review:');
  if (!adminId) return;

  const reviewNote = prompt('Optional additional review note:');

  try {
    const data = await makeAuthenticatedRequest(`/admin/server-applications/${applicationId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectionReason, adminId, reviewNote })
    });

    if (!data.ok) {
      throw new Error(data.error);
    }

    const msg = document.getElementById('serverApplicationsMsg');
    if (msg) {
      msg.innerHTML = `<span class="ok">Application #${applicationId} rejected</span>`;
    }

    // Refresh the applications list and stats
    const statusFilter = document.getElementById('applicationStatusFilter')?.value || '';
    await Promise.all([
      loadServerApplications(statusFilter),
      loadApplicationStats()
    ]);

  } catch (error) {
    console.error("❌ Failed to reject application:", error);
    const msg = document.getElementById('serverApplicationsMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to reject application: ${error.message}</span>`;
    }
  }
};

window.deleteApplication = async function(applicationId) {
  if (!confirm(`Are you sure you want to delete application #${applicationId}? This action cannot be undone.`)) {
    return;
  }

  try {
    const data = await makeAuthenticatedRequest(`/admin/server-applications/${applicationId}`, {
      method: 'DELETE'
    });

    if (!data.ok) {
      throw new Error(data.error);
    }

    const msg = document.getElementById('serverApplicationsMsg');
    if (msg) {
      msg.innerHTML = `<span class="ok">Application #${applicationId} deleted</span>`;
    }

    // Refresh the applications list and stats
    const statusFilter = document.getElementById('applicationStatusFilter')?.value || '';
    await Promise.all([
      loadServerApplications(statusFilter),
      loadApplicationStats()
    ]);

  } catch (error) {
    console.error("❌ Failed to delete application:", error);
    const msg = document.getElementById('serverApplicationsMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to delete application: ${error.message}</span>`;
    }
  }
};