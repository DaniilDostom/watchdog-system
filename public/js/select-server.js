
async function initSelectServerHub() {
    const user = getAuthUser();
    if (!user) {
        location.href = 'index.html';
        return;
    }

    if (!user.isMaster) {
        // If not Master Admin, automatically redirect to customer dashboard
        location.href = 'index.html';
        return;
    }

    const subEl = document.getElementById('select-hero-subtitle');
    if (subEl && user.name) {
        subEl.textContent = `Welcome back, ${user.name}! Select which server environment you want to launch.`;
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

        const cardsHtml = servers.map(s => {
            const isMaster = s.isMaster;
            const iconClass = isMaster ? 'gold' : 'blue';
            const iconName = isMaster ? 'crown' : 'server';
            const statusClass = s.status === 'ACTIVE' ? 'active' : 'suspended';

            return `
                <div class="server-tenant-card ${isMaster ? 'master-server' : ''}" onclick="launchServer('${escapeHtml(s.id)}', '${escapeHtml(s.name)}')">
                    <div>
                        <div class="card-top-row">
                            <div class="server-card-icon ${iconClass}">
                                <i data-lucide="${iconName}"></i>
                            </div>
                            <span class="server-status-pill ${statusClass}">
                                ${escapeHtml(s.status)}
                            </span>
                        </div>

                        <h3 class="server-card-title">${escapeHtml(s.name)}</h3>
                        <div class="server-card-id">${escapeHtml(s.id)} ${isMaster ? '• (Primary Master)' : ''}</div>

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

                        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 12px; padding: 8px 12px; margin-bottom: 18px; display: flex; align-items: center; gap: 10px;">
                            <img src="${escapeHtml(s.ownerAvatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png')}" alt="Avatar" style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.15); object-fit: cover;" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
                            <div style="display: flex; flex-direction: column; overflow: hidden; text-align: left;">
                                <span style="font-weight: 700; color: #ffffff; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${escapeHtml(s.ownerName || s.ownerUsername || 'Server Owner')}
                                </span>
                                <span style="font-size: 11px; color: #94a3b8; font-family: monospace;">
                                    @${escapeHtml(s.ownerUsername || 'user')} • ${escapeHtml(s.ownerDiscordId)}
                                </span>
                            </div>
                        </div>
                    </div>

                    <button type="button" class="btn-launch-server" onclick="event.stopPropagation(); launchServer('${escapeHtml(s.id)}', '${escapeHtml(s.name)}')">
                        <span>Enter Dashboard</span>
                        <i data-lucide="arrow-right" style="width: 15px; height: 15px;"></i>
                    </button>
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
    } catch (err) {
        grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 30px;">Error loading servers.</div>`;
    }
}

function launchServer(id, name) {
    localStorage.setItem('watchdog_active_server_id', id);
    if (typeof clearClientApiCache === 'function') clearClientApiCache();
    showToast(`Launching database for "${name || id}"...`, 'success');
    setTimeout(() => {
        location.href = 'index.html';
    }, 350);
}
window.launchServer = launchServer;

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
