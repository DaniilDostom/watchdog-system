
let cachedServersList = [];

async function initSelectServerHub() {
    const user = getAuthUser();
    if (!user) {
        location.href = 'login.html';
        return;
    }

    if (!user.isMaster) {
        location.href = 'index.html';
        return;
    }

    const subEl = document.getElementById('select-hero-subtitle');
    if (subEl && user.name) {
        subEl.textContent = `Welcome back, ${user.name}! Manage customer licenses and inspect isolated databases.`;
    }

    loadServerCards();
}

async function loadServerCards() {
    const user = getAuthUser();
    const grid = document.getElementById('servers-select-grid');
    if (!grid) return;

    try {
        const res = await fetch(`${API_URL}/admin/servers`, {
            headers: { 'x-discord-id': user?.discordId || '' }
        });

        if (!res.ok) {
            grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 30px;">Failed to load servers.</div>`;
            return;
        }

        const servers = await res.json();
        cachedServersList = servers;

        // Compute KPIs
        let sumPlayers = 0;
        let sumActions = 0;
        servers.forEach(s => {
            sumPlayers += (s.playerCount || 0);
            sumActions += (s.actionCount || 0);
        });

        const kpiServers = document.getElementById('kpi-total-servers');
        const kpiPlayers = document.getElementById('kpi-total-players');
        const kpiActions = document.getElementById('kpi-total-actions');

        if (kpiServers) kpiServers.textContent = servers.length;
        if (kpiPlayers) kpiPlayers.textContent = sumPlayers;
        if (kpiActions) kpiActions.textContent = sumActions;

        renderServerCards(servers);
    } catch (err) {
        grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 30px;">Error loading servers.</div>`;
    }
}

function renderServerCards(servers) {
    const grid = document.getElementById('servers-select-grid');
    if (!grid) return;

    const cardsHtml = servers.map(s => {
        const isMaster = s.isMaster;
        const iconClass = isMaster ? 'gold' : 'blue';
        const iconName = isMaster ? 'crown' : 'server';
        const isActive = s.status === 'ACTIVE';
        const statusClass = isActive ? 'active' : 'suspended';
        const expiryStr = s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : 'Lifetime';

        return `
            <div class="server-tenant-card ${isMaster ? 'master-server' : ''}" id="card-${escapeHtml(s.id)}">
                <div>
                    <div class="card-top-row">
                        <div class="server-card-icon ${iconClass}">
                            <i data-lucide="${iconName}"></i>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="server-status-pill ${statusClass}">
                                ${escapeHtml(s.status)}
                            </span>
                            ${!isMaster ? `
                                <button type="button" class="btn-tool-icon" onclick="toggleServerStatus('${escapeHtml(s.id)}')" title="Toggle Active / Suspended">
                                    <i data-lucide="${isActive ? 'pause' : 'play'}" style="width: 14px; height: 14px; color: ${isActive ? '#f59e0b' : '#34d399'};"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>

                    <h3 class="server-card-title">
                        ${escapeHtml(s.name)}
                        ${isMaster ? '<span style="font-size: 10px; font-weight: 800; color: #fbbf24; background: rgba(245, 158, 11, 0.15); padding: 2px 6px; border-radius: 8px;">MASTER</span>' : ''}
                    </h3>
                    <div class="server-card-id">
                        <span>ID: ${escapeHtml(s.id)}</span>
                        <span>•</span>
                        <span>${expiryStr}</span>
                    </div>

                    <div class="server-card-stats">
                        <div class="server-stat-box">
                            <div class="server-stat-val">${s.playerCount || 0}</div>
                            <div class="server-stat-label">Players</div>
                        </div>
                        <div class="server-stat-box">
                            <div class="server-stat-val">${s.actionCount || 0}</div>
                            <div class="server-stat-label">Sanctions</div>
                        </div>
                    </div>

                    <!-- Owner Profile Pill -->
                    <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 12px; padding: 8px 12px; margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
                        <img src="${escapeHtml(s.ownerAvatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png')}" alt="Avatar" style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.15); object-fit: cover;" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
                        <div style="display: flex; flex-direction: column; overflow: hidden; text-align: left; min-width: 0;">
                            <span style="font-weight: 700; color: #ffffff; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                ${escapeHtml(s.ownerName || s.ownerUsername || 'Server Owner')}
                            </span>
                            <span style="font-size: 11px; color: #94a3b8; font-family: monospace;">
                                @${escapeHtml(s.ownerUsername || 'user')} • ${escapeHtml(s.ownerDiscordId)}
                            </span>
                        </div>
                    </div>

                    <!-- Secret API Key Box -->
                    <div class="server-key-box">
                        <i data-lucide="key" style="width: 13px; height: 13px; color: #818cf8; flex-shrink: 0;"></i>
                        <input type="password" value="${escapeHtml(s.apiKey)}" id="key-input-${escapeHtml(s.id)}" readonly class="server-key-input" />
                        <button type="button" class="key-action-btn" onclick="toggleKeyVisibility('${escapeHtml(s.id)}')" title="Toggle Visibility">
                            <i data-lucide="eye" id="eye-${escapeHtml(s.id)}" style="width: 13px; height: 13px;"></i>
                        </button>
                        <button type="button" class="key-action-btn" onclick="copyServerKey('${escapeHtml(s.id)}')" title="Copy Key">
                            <i data-lucide="copy" style="width: 13px; height: 13px;"></i>
                        </button>
                        <button type="button" class="key-action-btn" onclick="regenerateServerKey('${escapeHtml(s.id)}')" title="Regenerate Key">
                            <i data-lucide="refresh-cw" style="width: 13px; height: 13px;"></i>
                        </button>
                    </div>
                </div>

                <!-- Footer Action Buttons -->
                <div class="card-actions-row">
                    <button type="button" class="btn-launch-server" onclick="launchServer('${escapeHtml(s.id)}', '${escapeHtml(s.name)}')">
                        <i data-lucide="external-link" style="width: 14px; height: 14px;"></i>
                        <span>Enter Dashboard</span>
                    </button>
                    <button type="button" class="btn-tool-icon" onclick="exportServerDatabase('${escapeHtml(s.id)}')" title="Export Backup JSON">
                        <i data-lucide="download" style="width: 15px; height: 15px;"></i>
                    </button>
                    ${!isMaster ? `
                        <button type="button" class="btn-tool-icon danger" onclick="deleteServerLicense('${escapeHtml(s.id)}', '${escapeHtml(s.name)}')" title="Delete Server License">
                            <i data-lucide="trash-2" style="width: 15px; height: 15px;"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    const addCardHtml = `
        <div class="add-new-server-card" onclick="openCreateServerModal()">
            <div style="width: 52px; height: 52px; border-radius: 50%; background: rgba(99, 102, 241, 0.15); color: #818cf8; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; border: 1px solid rgba(129, 140, 248, 0.25);">
                <i data-lucide="plus" style="width: 24px; height: 24px;"></i>
            </div>
            <div style="font-size: 16px; font-weight: 700; color: #ffffff; margin-bottom: 4px;">Register New Server</div>
            <div style="font-size: 12.5px; color: #94a3b8;">Generate a customer license & isolated DB</div>
        </div>
    `;

    grid.innerHTML = cardsHtml + addCardHtml;
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function filterServerCards(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
        renderServerCards(cachedServersList);
        return;
    }
    const filtered = cachedServersList.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.id || '').toLowerCase().includes(q) ||
        (s.ownerDiscordId || '').includes(q) ||
        (s.ownerName || '').toLowerCase().includes(q) ||
        (s.ownerUsername || '').toLowerCase().includes(q)
    );
    renderServerCards(filtered);
}
window.filterServerCards = filterServerCards;

function launchServer(id, name) {
    localStorage.setItem('watchdog_active_server_id', id);
    if (typeof clearClientApiCache === 'function') clearClientApiCache();
    showToast(`Launching database for "${name || id}"...`, 'success');
    setTimeout(() => {
        location.href = 'index.html';
    }, 350);
}
window.launchServer = launchServer;

function toggleKeyVisibility(id) {
    const input = document.getElementById(`key-input-${id}`);
    const icon = document.getElementById(`eye-${id}`);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.setAttribute('data-lucide', 'eye-off');
    } else {
        input.type = 'password';
        if (icon) icon.setAttribute('data-lucide', 'eye');
    }
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}
window.toggleKeyVisibility = toggleKeyVisibility;

function copyServerKey(id) {
    const input = document.getElementById(`key-input-${id}`);
    if (input && input.value) {
        navigator.clipboard.writeText(input.value).then(() => {
            showToast('Secret API Key copied to clipboard!', 'success');
        });
    }
}
window.copyServerKey = copyServerKey;

async function regenerateServerKey(id) {
    const confirmed = await showCustomConfirm({
        title: 'Regenerate Secret API Key?',
        message: 'This will permanently invalidate the current Secret Key for this customer server. The FiveM server will need its config.lua updated.',
        confirmText: 'Regenerate Key',
        cancelText: 'Cancel',
        type: 'danger',
        icon: 'refresh-cw'
    });
    if (!confirmed) return;
    const user = getAuthUser();
    try {
        const res = await fetch(`${API_URL}/admin/servers/${encodeURIComponent(id)}/regenerate-key`, {
            method: 'POST',
            headers: { 'x-discord-id': user?.discordId || '' }
        });
        if (res.ok) {
            showToast('Secret Key regenerated!', 'success');
            loadServerCards();
        }
    } catch (err) {
        showToast('Failed to regenerate key', 'error');
    }
}
window.regenerateServerKey = regenerateServerKey;

async function toggleServerStatus(id) {
    const user = getAuthUser();
    try {
        const res = await fetch(`${API_URL}/admin/servers/${encodeURIComponent(id)}/toggle-status`, {
            method: 'POST',
            headers: { 'x-discord-id': user?.discordId || '' }
        });
        if (res.ok) {
            const data = await res.json();
            showToast(`Server is now ${data.status}`, 'info');
            loadServerCards();
        }
    } catch (err) {
        showToast('Failed to toggle server status', 'error');
    }
}
window.toggleServerStatus = toggleServerStatus;

function exportServerDatabase(id) {
    const user = getAuthUser();
    window.open(`${API_URL}/admin/servers/${encodeURIComponent(id)}/export?adminId=${encodeURIComponent(user?.discordId || '')}`, '_blank');
}
window.exportServerDatabase = exportServerDatabase;

async function deleteServerLicense(id, name) {
    const confirmed = await showCustomConfirm({
        title: 'Delete Server License?',
        message: `Are you sure you want to permanently delete "${name}" (${id}) and all its database records? This action cannot be reversed.`,
        confirmText: 'Delete Server',
        cancelText: 'Cancel',
        type: 'danger',
        icon: 'trash-2'
    });
    if (!confirmed) return;
    const user = getAuthUser();
    try {
        const res = await fetch(`${API_URL}/admin/servers/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'x-discord-id': user?.discordId || '' }
        });
        if (res.ok) {
            showToast('Server license deleted.', 'info');
            loadServerCards();
        } else {
            const data = await res.json();
            showToast(data.error || 'Failed to delete server', 'error');
        }
    } catch (err) {
        showToast('Failed to delete server', 'error');
    }
}
window.deleteServerLicense = deleteServerLicense;

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
            loadServerCards();
        } else {
            showToast(data.error || 'Failed to create server', 'error');
        }
    } catch (err) {
        showToast('Network error while creating server', 'error');
    }
}
window.handleCreateServerSubmit = handleCreateServerSubmit;

document.addEventListener('DOMContentLoaded', initSelectServerHub);
