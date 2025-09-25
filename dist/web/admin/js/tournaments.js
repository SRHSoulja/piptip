// src/web/admin/js/tournaments.js - Tournament management module
import { makeAuthenticatedRequest } from '/admin/core.js';

export async function loadTournaments() {
  console.log("🏆 Loading tournaments...");

  try {
    const data = await makeAuthenticatedRequest('/admin/tournaments');
    if (!data.ok) {
      throw new Error(data.error);
    }

    const tbody = document.querySelector('#tournamentsTbl tbody');
    if (!tbody) {
      console.warn("Tournaments table not found, skipping tournament loading");
      return;
    }

    tbody.innerHTML = '';
    data.tournaments.forEach(tournament => {
      tbody.appendChild(createTournamentTableRow(tournament));
    });

    console.log(`✅ Loaded ${data.tournaments.length} tournaments`);
  } catch (error) {
    console.error("❌ Failed to load tournaments:", error);
    const msg = document.getElementById('tournamentsMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to load tournaments: ${error.message}</span>`;
    }
  }
}

function createTournamentTableRow(tournament) {
  const row = document.createElement('tr');

  const statusColors = {
    'SETUP': '#f59e0b',
    'REGISTRATION': '#3b82f6',
    'ACTIVE': '#10b981',
    'COMPLETED': '#6b7280',
    'CANCELLED': '#ef4444'
  };

  const prizeTokensDisplay = tournament.prizeTokens?.map(token =>
    `${token.amount} ${token.tokenSymbol}`
  ).join(' + ') || 'No prizes set';

  row.innerHTML = `
    <td>${tournament.id}</td>
    <td><strong>${tournament.name}</strong></td>
    <td>${tournament.description || 'No description'}</td>
    <td><span style="color: ${statusColors[tournament.status] || '#6b7280'}">${tournament.status}</span></td>
    <td>${tournament.type}</td>
    <td>${tournament.maxParticipants || 'Unlimited'}</td>
    <td><small>${prizeTokensDisplay}</small></td>
    <td>
      <button onclick="viewTournament('${tournament.id}')" class="btn-view">View</button>
      ${tournament.status !== 'COMPLETED' ? `<button onclick="editTournament('${tournament.id}')" class="btn-edit">Edit</button>` : ''}
      ${tournament.status === 'SETUP' ? `<button onclick="startTournament('${tournament.id}')" class="btn-action">Start</button>` : ''}
      ${tournament.status === 'ACTIVE' ? `<button onclick="completeTournament('${tournament.id}')" class="btn-action">Complete</button>` : ''}
      ${tournament.status === 'COMPLETED' ? `<button onclick="distributePrizes('${tournament.id}')" class="btn-success">Distribute Prizes</button>` : ''}
    </td>
  `;

  return row;
}

export async function createTournament() {
  try {
    const id = document.getElementById('newTournamentId')?.value?.trim();
    const name = document.getElementById('newTournamentName')?.value?.trim();
    const description = document.getElementById('newTournamentDescription')?.value?.trim();
    const type = document.getElementById('newTournamentType')?.value || 'LEADERBOARD';
    const maxParticipants = document.getElementById('newTournamentMaxParticipants')?.value || null;

    // Prize tokens configuration
    const prizeTokensInput = document.getElementById('newTournamentPrizeTokens')?.value?.trim();

    // Prize distribution configuration
    const firstPlace = document.getElementById('prizeDist1st')?.value || 40;
    const secondPlace = document.getElementById('prizeDist2nd')?.value || 25;
    const thirdPlace = document.getElementById('prizeDist3rd')?.value || 15;
    const remaining = document.getElementById('prizeDistRemaining')?.value || 20;

    if (!id || !name || !prizeTokensInput) {
      throw new Error('Tournament ID, name, and prize tokens are required');
    }

    // Parse prize tokens (format: "tokenId:amount,tokenId:amount")
    const prizeTokens = [];
    const tokenPairs = prizeTokensInput.split(',');
    for (const pair of tokenPairs) {
      const [tokenId, amount] = pair.trim().split(':');
      if (!tokenId || !amount) {
        throw new Error('Prize tokens must be in format: tokenId:amount,tokenId:amount');
      }
      prizeTokens.push({
        tokenId: parseInt(tokenId),
        amount: parseFloat(amount)
      });
    }

    const prizeDistribution = {
      "1": parseFloat(firstPlace),
      "2": parseFloat(secondPlace),
      "3": parseFloat(thirdPlace),
      "4-10": parseFloat(remaining)
    };

    const requestBody = {
      id,
      name,
      description,
      type,
      maxParticipants: maxParticipants ? parseInt(maxParticipants) : null,
      prizeTokens,
      prizeDistribution
    };

    const data = await makeAuthenticatedRequest('/admin/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!data.ok) {
      throw new Error(data.error);
    }

    // Clear form
    document.getElementById('newTournamentId').value = '';
    document.getElementById('newTournamentName').value = '';
    document.getElementById('newTournamentDescription').value = '';
    document.getElementById('newTournamentMaxParticipants').value = '';
    document.getElementById('newTournamentPrizeTokens').value = '';

    // Reload tournaments
    await loadTournaments();

    const msg = document.getElementById('tournamentsMsg');
    if (msg) {
      msg.innerHTML = `<span class="ok">${data.message}</span>`;
    }
  } catch (error) {
    console.error("❌ Failed to create tournament:", error);
    const msg = document.getElementById('tournamentsMsg');
    if (msg) {
      msg.innerHTML = `<span class="err">Failed to create tournament: ${error.message}</span>`;
    }
  }
}

export async function viewTournament(tournamentId) {
  try {
    const data = await makeAuthenticatedRequest(`/admin/tournaments/${tournamentId}`);
    if (!data.ok) {
      throw new Error(data.error);
    }

    const tournament = data.tournament;
    const prizeDisplay = data.prizeDisplay;
    const leaderboard = data.leaderboard;
    const results = data.results;

    // Create modal or redirect to detailed view
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.8); z-index: 10000; padding: 20px;
      overflow-y: auto; display: flex; align-items: center; justify-content: center;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: #1a1a1a; border-radius: 12px; padding: 24px;
      max-width: 800px; width: 100%; max-height: 90vh; overflow-y: auto;
      border: 1px solid #333;
    `;

    modalContent.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="margin: 0; color: #fff;">🏆 ${tournament.name}</h2>
        <button onclick="this.closest('.modal').remove()" style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer;">×</button>
      </div>

      <div style="grid-template-columns: 1fr 1fr; gap: 20px; display: grid; margin-bottom: 20px;">
        <div>
          <h3 style="color: #fff; margin: 0 0 10px 0;">Tournament Details</h3>
          <p><strong>Status:</strong> ${tournament.status}</p>
          <p><strong>Type:</strong> ${tournament.type}</p>
          <p><strong>Description:</strong> ${tournament.description || 'None'}</p>
          <p><strong>Max Participants:</strong> ${tournament.maxParticipants || 'Unlimited'}</p>
        </div>
        <div>
          <h3 style="color: #fff; margin: 0 0 10px 0;">Prize Pool</h3>
          <p><strong>Total:</strong> ${prizeDisplay?.total || 'Not set'}</p>
          ${Object.entries(prizeDisplay?.breakdown || {}).map(([position, prizes]) =>
            `<p><strong>${position}:</strong> ${prizes.join(' + ')}</p>`
          ).join('')}
        </div>
      </div>

      ${leaderboard?.length > 0 ? `
        <h3 style="color: #fff; margin: 20px 0 10px 0;">Current Leaderboard</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #333;">
              <th style="padding: 8px; text-align: left;">Position</th>
              <th style="padding: 8px; text-align: left;">User</th>
              <th style="padding: 8px; text-align: left;">Score</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboard.slice(0, 10).map(entry => `
              <tr style="border-bottom: 1px solid #333;">
                <td style="padding: 8px;">#${entry.position}</td>
                <td style="padding: 8px;">${entry.discordId}</td>
                <td style="padding: 8px;">${entry.score}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}

      ${results ? `
        <h3 style="color: #fff; margin: 20px 0 10px 0;">Tournament Results</h3>
        <p><strong>Completed:</strong> ${new Date(results.completedAt).toLocaleString()}</p>
        <p><strong>Participants:</strong> ${results.participants}</p>
        <p><strong>Prizes Distributed:</strong> ${results.prizesDistributed}</p>
        ${results.errors?.length > 0 ? `<p style="color: #ef4444;"><strong>Errors:</strong> ${results.errors.length}</p>` : ''}
      ` : ''}

      <div style="margin-top: 20px; text-align: right;">
        ${tournament.status === 'SETUP' ? `<button onclick="startTournament('${tournament.id}'); this.closest('.modal').remove();" style="background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 6px; margin-left: 8px; cursor: pointer;">Start Tournament</button>` : ''}
        ${tournament.status === 'ACTIVE' ? `<button onclick="completeTournament('${tournament.id}'); this.closest('.modal').remove();" style="background: #f59e0b; color: white; border: none; padding: 8px 16px; border-radius: 6px; margin-left: 8px; cursor: pointer;">Complete Tournament</button>` : ''}
        ${tournament.status === 'COMPLETED' && !results ? `<button onclick="distributePrizes('${tournament.id}'); this.closest('.modal').remove();" style="background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; margin-left: 8px; cursor: pointer;">Distribute Prizes</button>` : ''}
      </div>
    `;

    modal.className = 'modal';
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

  } catch (error) {
    console.error("❌ Failed to view tournament:", error);
    alert(`Failed to load tournament details: ${error.message}`);
  }
}

export async function startTournament(tournamentId) {
  try {
    const data = await makeAuthenticatedRequest(`/admin/tournaments/${tournamentId}/start`, {
      method: 'POST'
    });

    if (!data.ok) {
      throw new Error(data.error);
    }

    await loadTournaments();

    const msg = document.getElementById('tournamentsMsg');
    if (msg) {
      msg.innerHTML = `<span class="ok">${data.message}</span>`;
    }
  } catch (error) {
    console.error("❌ Failed to start tournament:", error);
    alert(`Failed to start tournament: ${error.message}`);
  }
}

export async function completeTournament(tournamentId) {
  try {
    const data = await makeAuthenticatedRequest(`/admin/tournaments/${tournamentId}/complete`, {
      method: 'POST'
    });

    if (!data.ok) {
      throw new Error(data.error);
    }

    await loadTournaments();

    const msg = document.getElementById('tournamentsMsg');
    if (msg) {
      msg.innerHTML = `<span class="ok">${data.message}</span>`;
    }
  } catch (error) {
    console.error("❌ Failed to complete tournament:", error);
    alert(`Failed to complete tournament: ${error.message}`);
  }
}

export async function distributePrizes(tournamentId) {
  if (!confirm('Are you sure you want to distribute tournament prizes? This action cannot be undone.')) {
    return;
  }

  try {
    const data = await makeAuthenticatedRequest(`/admin/tournaments/${tournamentId}/distribute-prizes`, {
      method: 'POST'
    });

    if (!data.ok) {
      throw new Error(data.error || 'Failed to distribute prizes');
    }

    await loadTournaments();

    const msg = document.getElementById('tournamentsMsg');
    if (msg) {
      msg.innerHTML = `<span class="ok">${data.message}</span>`;
    }

    alert(`Successfully distributed prizes to ${data.distributed} winners!`);
  } catch (error) {
    console.error("❌ Failed to distribute prizes:", error);
    alert(`Failed to distribute prizes: ${error.message}`);
  }
}

export function initTournamentsSection() {
  // Add event listeners for tournament functionality
  const createBtn = document.getElementById('createTournament');
  if (createBtn) {
    createBtn.addEventListener('click', createTournament);
  }

  const loadBtn = document.getElementById('loadTournaments');
  if (loadBtn) {
    loadBtn.addEventListener('click', loadTournaments);
  }
}

// Make functions globally available for onclick handlers
window.viewTournament = viewTournament;
window.startTournament = startTournament;
window.completeTournament = completeTournament;
window.distributePrizes = distributePrizes;