
async function initAdminHub() {
    const user = getAuthUser();
    if (!user || (!user.isOwner && user.role !== 'owner')) {
        showToast('Access denied: Master Admin permissions required.', 'error');
        setTimeout(() => { location.href = 'index.html'; }, 1000);
        return;
    }

    loadServers();
}

async function loadServers() {
    const user = getAuthUser();
    const tbody = document.getElementById('servers-tbody');
    if (!tbody) return;

    try {
        const res = await fetch(`${API_URL}/admin/servers`, {
            headers: { 'x-discord-id': user?.discordId || '' }
        });

        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 24px;">Failed to load servers (HTTP ${res.status}).</td></tr>`;
            return;
        }

        const servers = await res.json();

        // Update KPI
        const totalServersEl = document.getElementById('total-servers-count');
        const totalPlayersEl = document.getElementById('total-players-global');
        const totalActionsEl = document.getElementById('total-actions-global');

        if (totalServersEl) totalServersEl.textContent = servers.length;
        
        let sumPlayers = 0, sumActions = 0;
        servers.forEach(s => {
            sumPlayers += (s.playerCount || 0);
            sumActions += (s.actionCount || 0);
        });

        if (totalPlayersEl) totalPlayersEl.textContent = sumPlayers;
        if (totalActionsEl) totalActionsEl.textContent = sumActions;

        if (servers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 24px;">No customer servers registered yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = servers.map(s => {
            const initial = (s.ownerName || s.ownerUsername || 'O').charAt(0).toUpperCase();
            const isActive = s.status === 'ACTIVE';
            const statusClass = isActive ? 'active' : 'suspended';
            const statusText = isActive ? 'ACTIVE' : 'SUSPENDED';
            const expiryStr = s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : 'Lifetime';

            return `
                <tr>
                    <td>
                        <div style="font-weight: 700; color: #ffffff; font-size: 14px;">${escapeHtml(s.name)}</div>
                        <div style="font-size: 11px; font-family: monospace; color: #64748b;">${escapeHtml(s.id)} ${s.isMaster ? '<span style="color:#fbbf24;font-weight:700;margin-left:4px;">(Master Primary)</span>' : ''}</div>
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div class="player-mini-avatar-wrap" style="width: 24px; height: 24px;">
                                ${s.ownerAvatarUrl 
                                    ? `<img src="${s.ownerAvatarUrl}" class="player-mini-avatar-img" />`
                                    : `<span class="player-mini-avatar-fallback">${initial}</span>`
                                }
                            </div>
                            <div>
                                <span style="font-weight: 600; color: #f1f5f9;">${escapeHtml(s.ownerName || s.ownerUsername || 'Owner')}</span>
                                <div style="font-size: 11px; color: #64748b; font-family: monospace;">${escapeHtml(s.ownerDiscordId)}</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="password" value="${escapeHtml(s.apiKey)}" id="key-input-${escapeHtml(s.id)}" readonly style="background: rgba(3,7,18,0.7); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 4px 8px; font-family: monospace; font-size: 11px; color: #38bdf8; width: 140px;" />
                            <button type="button" class="action-icon-btn" onclick="copyServerKey('${escapeHtml(s.apiKey)}')" title="Copy Secret API Key"><i data-lucide="copy" style="width:13px;height:13px;"></i></button>
                        </div>
                    </td>
                    <td>
                        <span class="server-status-pill ${statusClass}">
                            <i data-lucide="${isActive ? 'check-circle' : 'pause-circle'}" style="width: 11px; height: 11px;"></i>
                            ${statusText}
                        </span>
                    </td>
                    <td style="color: #94a3b8; font-size: 12px; white-space: nowrap;">${expiryStr}</td>
                    <td style="text-align: right; white-space: nowrap;">
                        <button type="button" class="action-icon-btn" onclick="inspectServerDatabase('${escapeHtml(s.id)}')" title="Inspect Server Database"><i data-lucide="database" style="width:14px;height:14px;"></i></button>
                        <button type="button" class="action-icon-btn" onclick="exportServerDatabase('${escapeHtml(s.id)}')" title="Download JSON Backup"><i data-lucide="download" style="width:14px;height:14px;"></i></button>
                        <button type="button" class="action-icon-btn" onclick="toggleServerStatus('${escapeHtml(s.id)}')" title="${isActive ? 'Suspend License' : 'Activate License'}"><i data-lucide="${isActive ? 'pause' : 'play'}" style="width:14px;height:14px;"></i></button>
                        <button type="button" class="action-icon-btn" onclick="regenerateKey('${escapeHtml(s.id)}')" title="Regenerate Secret Key"><i data-lucide="refresh-cw" style="width:14px;height:14px;"></i></button>
                        ${!s.isMaster ? `<button type="button" class="action-icon-btn danger" onclick="deleteServerLicense('${escapeHtml(s.id)}', '${escapeHtml(s.name)}')" title="Delete Server"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');

        if (window.lucide && lucide.createIcons) lucide.createIcons();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 24px;">Error loading server licenses.</td></tr>`;
    }
}

function openCreateServerModal() {
    const modal = document.getElementById('create-server-modal');
    if (modal) modal.style.display = 'flex';
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}
window.openCreateServerModal = openCreateServerModal;

function closeCreateServerModal() {
    const modal = document.getElementById('create-server-modal');
    if (modal) modal.style.display = 'none';
}
window.closeCreateServerModal = closeCreateServerModal;

async function handleCreateServerSubmit(e) {
    e.preventDefault();
    const user = getAuthUser();
    const name = document.getElementById('srv-name')?.value?.trim();
    const ownerDiscordId = document.getElementById('srv-owner-id')?.value?.trim();
    const durationDays = document.getElementById('srv-duration')?.value;

    if (!name || !ownerDiscordId) {
        showToast('Please fill out all fields.', 'warning');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/admin/servers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-discord-id': user?.discordId || ''
            },
            body: JSON.stringify({ name, ownerDiscordId, durationDays })
        });

        const data = await res.json();
        if (res.ok) {
            showToast(`Server "${data.name}" created successfully!`, 'success');
            closeCreateServerModal();
            document.getElementById('create-server-form')?.reset();
            loadServers();
        } else {
            showToast(data.error || 'Failed to create server', 'error');
        }
    } catch (err) {
        showToast('Network error while creating server', 'error');
    }
}
window.handleCreateServerSubmit = handleCreateServerSubmit;

function copyServerKey(key) {
    if (!key) return;
    navigator.clipboard.writeText(key).then(() => {
        showToast('Secret API Key copied!', 'success');
    });
}
window.copyServerKey = copyServerKey;

async function toggleServerStatus(id) {
    const user = getAuthUser();
    try {
        const res = await fetch(`${API_URL}/admin/servers/${encodeURIComponent(id)}/toggle-status`, {
            method: 'POST',
            headers: { 'x-discord-id': user?.discordId || '' }
        });
        if (res.ok) {
            const data = await res.json();
            showToast(`Server status updated: ${data.status}`, 'info');
            loadServers();
        }
    } catch (err) {
        showToast('Failed to update status', 'error');
    }
}
window.toggleServerStatus = toggleServerStatus;

async function regenerateKey(id) {
    if (!confirm('Are you sure you want to regenerate this server\'s Secret API Key? The FiveM server will need its config.lua updated.')) return;
    const user = getAuthUser();
    try {
        const res = await fetch(`${API_URL}/admin/servers/${encodeURIComponent(id)}/regenerate-key`, {
            method: 'POST',
            headers: { 'x-discord-id': user?.discordId || '' }
        });
        if (res.ok) {
            showToast('Secret Key regenerated!', 'success');
            loadServers();
        }
    } catch (err) {
        showToast('Failed to regenerate key', 'error');
    }
}
window.regenerateKey = regenerateKey;

function exportServerDatabase(id) {
    const user = getAuthUser();
    window.open(`${API_URL}/admin/servers/${encodeURIComponent(id)}/export?adminId=${encodeURIComponent(user?.discordId || '')}`, '_blank');
}
window.exportServerDatabase = exportServerDatabase;

function inspectServerDatabase(id) {
    showToast(`Switched to server ${id}. Redirecting to Dashboard...`, 'info');
    setTimeout(() => {
        location.href = 'index.html';
    }, 600);
}
window.inspectServerDatabase = inspectServerDatabase;

async function deleteServerLicense(id, name) {
    if (!confirm(`Are you sure you want to permanently delete "${name}" (${id}) and all its data?`)) return;
    const user = getAuthUser();
    try {
        const res = await fetch(`${API_URL}/admin/servers/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'x-discord-id': user?.discordId || '' }
        });
        if (res.ok) {
            showToast('Server license deleted.', 'info');
            loadServers();
        } else {
            const data = await res.json();
            showToast(data.error || 'Failed to delete server', 'error');
        }
    } catch (err) {
        showToast('Failed to delete server', 'error');
    }
}
window.deleteServerLicense = deleteServerLicense;

document.addEventListener('DOMContentLoaded', initAdminHub);
