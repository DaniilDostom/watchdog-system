// Initialize Icons
if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
window.escapeHtml = escapeHtml;

const pendingToast = sessionStorage.getItem('pendingToast');
if (pendingToast) {
    sessionStorage.removeItem('pendingToast');
    const toastData = JSON.parse(pendingToast);
    setTimeout(() => showToast(toastData.message, toastData.type), 0);
}

// Toast Notifications
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconName = 'check-circle';
    if (type === 'error') iconName = 'alert-circle';
    else if (type === 'warning') iconName = 'alert-triangle';
    else if (type === 'info') iconName = 'info';

    toast.innerHTML = `<i data-lucide="${iconName}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    if (window.lucide && lucide.createIcons) lucide.createIcons();

    setTimeout(() => {
        toast.classList.add('toast-hiding');
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

// Input Error Shake & Glow Helper
function highlightInvalidInput(el, msg = 'Please fill out this field.') {
    if (!el) return;
    el.classList.remove('input-error-shake');
    void el.offsetWidth; // trigger reflow
    el.classList.add('input-error-shake');
    el.focus();
    el.addEventListener('input', () => el.classList.remove('input-error-shake'), { once: true });
    showToast(msg, 'warning');
}

// Custom Glass Confirmation Modal (replaces window.confirm)
function showCustomConfirm({
    title = 'Are you sure?',
    message = 'This action cannot be undone.',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    type = 'danger',
    icon = 'alert-triangle'
} = {}) {
    return new Promise((resolve) => {
        let overlay = document.getElementById('custom-confirm-modal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'custom-confirm-modal';
            overlay.className = 'modal-overlay';
            overlay.style.zIndex = '99990';
            document.body.appendChild(overlay);
        }

        const confirmBtnBg = type === 'danger'
            ? 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)'
            : 'linear-gradient(135deg, #d97706 0%, #b45309 100%)';
        const confirmBtnShadow = type === 'danger'
            ? '0 4px 14px rgba(220, 38, 38, 0.4)'
            : '0 4px 14px rgba(217, 119, 6, 0.4)';

        const safeTitle = String(title).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const safeConfirm = String(confirmText).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const safeCancel = String(cancelText).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

        overlay.innerHTML = `
            <div class="modal custom-confirm-box modal-anim" style="max-width: 440px; padding: 26px; text-align: center; border-top: 3px solid ${type === 'danger' ? '#ef4444' : '#6366f1'};">
                <div style="width: 52px; height: 52px; border-radius: 14px; background: ${type === 'danger' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(99, 102, 241, 0.15)'}; color: ${type === 'danger' ? '#f87171' : '#818cf8'}; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; border: 1px solid rgba(255, 255, 255, 0.1);">
                    <i data-lucide="${icon}" style="width: 26px; height: 26px;"></i>
                </div>
                <h3 style="font-size: 19px; font-weight: 800; color: #f8fafc; margin-bottom: 8px;">${safeTitle}</h3>
                <p style="font-size: 13.5px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px;">${message}</p>
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button type="button" class="cta btn-confirm-cancel" style="width: auto; flex: 1; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); color: #cbd5e1; border-radius: 8px;">${safeCancel}</button>
                    <button type="button" class="cta btn-confirm-ok" style="background: ${confirmBtnBg}; color: white; box-shadow: ${confirmBtnShadow}; width: auto; flex: 1; padding: 9px 20px; font-weight: 700; border-radius: 8px;">${safeConfirm}</button>
                </div>
            </div>
        `;

        if (window.lucide && lucide.createIcons) lucide.createIcons();
        overlay.style.display = 'flex';

        function cleanup(result) {
            overlay.style.display = 'none';
            overlay.innerHTML = '';
            document.removeEventListener('keydown', onKeyDown);
            resolve(result);
        }

        function onKeyDown(e) {
            if (e.key === 'Escape') cleanup(false);
        }

        document.addEventListener('keydown', onKeyDown);

        const cancelBtn = overlay.querySelector('.btn-confirm-cancel');
        if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
        const okBtn = overlay.querySelector('.btn-confirm-ok');
        if (okBtn) okBtn.onclick = () => cleanup(true);
        overlay.onclick = (e) => {
            if (e.target === overlay) cleanup(false);
        };
    });
}
window.showCustomConfirm = showCustomConfirm;

// Modal Logic
async function openModal(playerId) {
    document.getElementById('modal-player-id').value = playerId;
    window.reasonSelection = [];
    await populateIssuerSelect();
    populateReasonSelect(document.getElementById('action-type').value);
    document.getElementById('action-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('action-modal').style.display = 'none';
    document.getElementById('action-form').reset();
}

const actionType = document.getElementById('action-type');
if (actionType) {
    actionType.addEventListener('change', (e) => {
        document.getElementById('ban-type-group').style.display = e.target.value === 'BAN' ? 'block' : 'none';
        document.getElementById('last-chance-group').style.display = e.target.value === 'BAN' ? 'block' : 'none';
        populateReasonSelect(e.target.value);
    });
}

// Staff Decision Team Modal
window.showStaffTeamModal = async function(issuer = 'Staff', otherStaffers = []) {
    let overlay = document.getElementById('staff-team-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'staff-team-modal-overlay';
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '99995';
        document.body.appendChild(overlay);
    }

    let localCache = {};
    try {
        localCache = JSON.parse(localStorage.getItem('staff_discord_profiles_v1') || '{}');
    } catch {}

    let moderators = [];
    if (typeof ModAPI !== 'undefined' && ModAPI.getModerators) {
        moderators = await ModAPI.getModerators().catch(() => []);
    }

    function getStafferAvatar(name) {
        const modObj = moderators.find(m => m.name && m.name.toLowerCase() === (name || '').toLowerCase());
        const localProfile = modObj?.discordId ? localCache[modObj.discordId] : localCache[name];
        let avatarUrl = modObj?.avatarUrl || localProfile?.url || null;
        if (!avatarUrl && modObj?.discordId && /^\d{17,20}$/.test(modObj.discordId)) {
            try {
                const defaultIdx = Number((BigInt(modObj.discordId) >> 22n) % 6n);
                avatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultIdx}.png`;
            } catch {}
        }
        return avatarUrl;
    }

    const leadAvatar = getStafferAvatar(issuer);
    const leadAvatarHtml = leadAvatar
        ? `<img src="${leadAvatar}" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover;border:2px solid #6366f1;" onerror="this.style.display='none';" />`
        : `<div style="width:34px;height:34px;border-radius:50%;background:#6366f1;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;">${(issuer || '?').slice(0, 2).toUpperCase()}</div>`;

    const staffList = Array.isArray(otherStaffers) ? otherStaffers : [];
    const othersHtml = (staffList.length === 0)
        ? `<div style="color:#94a3b8;font-size:12.5px;padding:8px 0;text-align:center;">No additional staffers were registered for this decision.</div>`
        : staffList.map(name => {
            const avatar = getStafferAvatar(name);
            const avHtml = avatar
                ? `<img src="${avatar}" alt="" style="width:30px;height:30px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.15);" onerror="this.style.display='none';" />`
                : `<div style="width:30px;height:30px;border-radius:50%;background:#475569;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;">${name.slice(0, 2).toUpperCase()}</div>`;
            return `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(15,23,42,0.6);border:1px solid rgba(255,255,255,0.06);border-radius:8px;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        ${avHtml}
                        <span style="font-weight:600;font-size:13px;color:#f1f5f9;">${escapeHtml(name)}</span>
                    </div>
                    <span style="font-size:10.5px;font-weight:700;color:#38bdf8;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.25);padding:2px 8px;border-radius:12px;text-transform:uppercase;">Assisting</span>
                </div>
            `;
        }).join('');

    overlay.innerHTML = `
        <div class="modal modal-anim" style="max-width: 420px; padding: 24px; background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,0.6); backdrop-filter: blur(20px);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px;">
                <div style="display:flex; align-items:center; gap: 10px;">
                    <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(99, 102, 241, 0.15); color: #818cf8; display: flex; align-items: center; justify-content: center;">
                        <i data-lucide="users" style="width: 18px; height: 18px;"></i>
                    </div>
                    <div>
                        <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #ffffff;">Staff Decision Team</h3>
                        <span style="font-size: 11.5px; color: #94a3b8;">Staff members involved in this sanction</span>
                    </div>
                </div>
                <button type="button" class="btn-close-staff-team" style="background: transparent; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px; line-height: 1;">&times;</button>
            </div>

            <!-- Lead Staffer Card -->
            <div style="margin-bottom: 16px;">
                <span style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">Lead Staff Issuer</span>
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.3);border-radius:10px;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        ${leadAvatarHtml}
                        <div>
                            <div style="font-weight:700;font-size:14px;color:#ffffff;">${escapeHtml(issuer)}</div>
                            <span style="font-size:11px;color:#cbd5e1;">Responsible for sanction</span>
                        </div>
                    </div>
                    <span style="font-size:10.5px;font-weight:700;color:#818cf8;background:rgba(99,102,241,0.25);border:1px solid rgba(99,102,241,0.4);padding:3px 8px;border-radius:12px;text-transform:uppercase;">Primary</span>
                </div>
            </div>

            <!-- Other Staffers List -->
            <div>
                <span style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">Assisting Staffers (${staffList.length})</span>
                <div style="max-height: 200px; overflow-y: auto;">
                    ${othersHtml}
                </div>
            </div>

            <div style="margin-top: 20px; display: flex; justify-content: flex-end;">
                <button type="button" class="cta btn-close-staff-team" style="width: auto; padding: 8px 18px; font-size: 13px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: #fff;">Close</button>
            </div>
        </div>
    `;

    if (window.lucide && lucide.createIcons) lucide.createIcons();
    overlay.style.display = 'flex';

    function close() {
        overlay.style.display = 'none';
        overlay.innerHTML = '';
    }

    overlay.querySelectorAll('.btn-close-staff-team').forEach(btn => btn.onclick = close);
    overlay.onclick = (e) => {
        if (e.target === overlay) close();
    };
};

// Persistent Active Player navigation in Sidebar
function initSidebarPlayerNavigation() {
    const nav = document.querySelector('aside.sidebar nav');
    if (!nav) return;

    const isPlayerPage = window.location.pathname.endsWith('player.html') || window.location.href.includes('player.html');
    const isPlayersListPage = window.location.pathname.endsWith('players.html') || window.location.href.includes('players.html');

    const playersLink = nav.querySelector('a[href*="players.html"], a[href*="player.html"]');
    if (playersLink) {
        playersLink.href = 'players.html';
        if (isPlayerPage || isPlayersListPage) {
            playersLink.classList.add('active');
        }
    }

    // Dynamic Master Hub link ONLY for Master Admin
    const user = getAuthUser();
    if (user && user.isMaster) {
        if (!nav.querySelector('a[href*="admin.html"]')) {
            const adminLink = document.createElement('a');
            adminLink.href = 'admin.html';
            adminLink.innerHTML = '<i data-lucide="crown"></i> <span>Master Hub</span>';
            adminLink.style.background = 'linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.1))';
            adminLink.style.borderColor = 'rgba(245, 158, 11, 0.35)';
            adminLink.style.color = '#fbbf24';
            if (window.location.pathname.endsWith('admin.html') || window.location.href.includes('admin.html')) {
                adminLink.classList.add('active');
            }
            nav.appendChild(adminLink);
            if (window.lucide && lucide.createIcons) lucide.createIcons();
        }
    }
}

window.initSidebarPlayerNavigation = initSidebarPlayerNavigation;

// Topbar Watchdog SaaS, Server Switcher & FiveM Sync Actions
function initWatchdogTopbar() {
    const topbar = document.querySelector('.topbar');
    if (!topbar || topbar.querySelector('.topbar-actions')) return;

    const user = getAuthUser();
    const isMaster = user && user.isMaster;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'topbar-actions';
    actionsDiv.innerHTML = `
        ${isMaster ? `
        <div class="topbar-server-badge" id="topbar-server-badge" onclick="openServerSwitcherModal()" style="cursor:pointer;" title="Switch Active Server Database">
            <i data-lucide="server" style="width: 14px; height: 14px; color: #38bdf8;"></i>
            <span id="topbar-server-name-label">Main Server</span>
            <i data-lucide="chevron-down" style="width: 12px; height: 12px; color: #94a3b8;"></i>
        </div>` : ''}
        <button class="btn-fivem-sync" title="FiveM Server Integration & Secret Key" onclick="openFivemSyncModal()">
            <i data-lucide="key-round"></i>
            <span>FiveM Sync</span>
        </button>
        <div class="topbar-status-badge" title="Watchdog SaaS Engine Online">
            <span class="pulse-dot"></span>
            <span>Cloud Active</span>
        </div>
    `;
    topbar.appendChild(actionsDiv);
    if (window.lucide && lucide.createIcons) lucide.createIcons();
    if (isMaster) updateTopbarServerName();
}

window.initWatchdogTopbar = initWatchdogTopbar;

async function updateTopbarServerName() {
    const label = document.getElementById('topbar-server-name-label');
    if (!label) return;
    const activeId = (typeof getActiveServerId === 'function') ? getActiveServerId() : (localStorage.getItem('watchdog_active_server_id') || 'default_server');
    if (activeId === 'default_server') {
        label.textContent = 'Main Server';
        return;
    }
    try {
        const user = (typeof getAuthUser === 'function') ? getAuthUser() : null;
        const res = await fetch(`${API_URL}/admin/servers`, {
            headers: { 'x-discord-id': user?.discordId || '' }
        });
        if (res.ok) {
            const servers = await res.json();
            const current = servers.find(s => s.id === activeId);
            if (current) label.textContent = current.name;
        }
    } catch {}
}
window.updateTopbarServerName = updateTopbarServerName;

async function openServerSwitcherModal() {
    let overlay = document.getElementById('server-switcher-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'server-switcher-modal';
        overlay.className = 'modal-overlay';
        document.body.appendChild(overlay);
    }

    const user = (typeof getAuthUser === 'function') ? getAuthUser() : null;
    let servers = [];
    try {
        const res = await fetch(`${API_URL}/admin/servers`, {
            headers: { 'x-discord-id': user?.discordId || '' }
        });
        if (res.ok) servers = await res.json();
    } catch {}

    const activeId = (typeof getActiveServerId === 'function') ? getActiveServerId() : 'default_server';

    overlay.innerHTML = `
        <div class="modal modal-pro modal-anim" style="max-width: 500px; padding: 24px;">
            <div class="modal-hero-header" style="margin-bottom: 18px;">
                <div class="modal-title-box">
                    <div class="modal-icon-badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">
                        <i data-lucide="server"></i>
                    </div>
                    <div>
                        <h2 style="font-size: 18px; font-weight: 800; color: #fff; margin: 0;">Switch Server Database</h2>
                        <span style="font-size: 12px; color: #94a3b8;">Select a customer server to inspect its isolated database</span>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="closeServerSwitcherModal()"><i data-lucide="x"></i></button>
            </div>

            <div style="display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto; margin-bottom: 20px;">
                ${servers.map(s => {
                    const isCurrent = s.id === activeId;
                    return `
                        <div onclick="selectServerTenant('${escapeHtml(s.id)}', '${escapeHtml(s.name)}')" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 12px; background: ${isCurrent ? 'rgba(99, 102, 241, 0.2)' : 'rgba(15, 23, 42, 0.7)'}; border: 1px solid ${isCurrent ? 'rgba(129, 140, 248, 0.5)' : 'rgba(255, 255, 255, 0.08)'}; cursor: pointer; transition: all 0.15s ease;">
                            <div>
                                <div style="font-weight: 700; color: #ffffff; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
                                    ${escapeHtml(s.name)}
                                    ${s.isMaster ? '<span style="font-size: 10px; font-weight: 800; color: #fbbf24; background: rgba(245, 158, 11, 0.15); padding: 2px 6px; border-radius: 8px;">MASTER</span>' : ''}
                                    ${isCurrent ? '<span style="font-size: 10px; font-weight: 800; color: #34d399; background: rgba(16, 185, 129, 0.15); padding: 2px 6px; border-radius: 8px;">ACTIVE</span>' : ''}
                                </div>
                                <div style="font-size: 11px; color: #94a3b8; font-family: monospace; margin-top: 2px;">
                                    ID: ${escapeHtml(s.id)} • ${s.playerCount || 0} Players • ${s.actionCount || 0} Sanctions
                                </div>
                            </div>
                            <i data-lucide="${isCurrent ? 'check-circle' : 'chevron-right'}" style="width: 16px; height: 16px; color: ${isCurrent ? '#34d399' : '#64748b'};"></i>
                        </div>
                    `;
                }).join('')}
            </div>

            <div style="display: flex; justify-content: flex-end;">
                <button type="button" class="cta" style="width: auto; background: transparent; border: 1px solid rgba(255, 255, 255, 0.15);" onclick="closeServerSwitcherModal()">Cancel</button>
            </div>
        </div>
    `;

    overlay.style.display = 'flex';
    if (window.lucide && lucide.createIcons) lucide.createIcons();
    overlay.onclick = (e) => { if (e.target === overlay) closeServerSwitcherModal(); };
}
window.openServerSwitcherModal = openServerSwitcherModal;

function closeServerSwitcherModal() {
    const overlay = document.getElementById('server-switcher-modal');
    if (overlay) overlay.style.display = 'none';
}
window.closeServerSwitcherModal = closeServerSwitcherModal;

function selectServerTenant(id, name) {
    if (typeof setActiveServerId === 'function') {
        setActiveServerId(id);
    } else {
        localStorage.setItem('watchdog_active_server_id', id);
        location.reload();
    }
}
window.selectServerTenant = selectServerTenant;

async function openFivemSyncModal() {
    let overlay = document.getElementById('fivem-sync-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'fivem-sync-modal';
        overlay.className = 'modal-overlay';
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
        <div class="modal modal-pro modal-anim" style="max-width: 580px; padding: 24px;">
            <div class="modal-hero-header" style="margin-bottom: 20px;">
                <div class="modal-title-box">
                    <div class="modal-icon-badge" style="background: rgba(99, 102, 241, 0.2); color: #818cf8;">
                        <i data-lucide="shield-check"></i>
                    </div>
                    <div>
                        <h2 style="font-size: 20px; font-weight: 800; color: #fff; margin: 0;">FiveM Server Integration</h2>
                        <span style="font-size: 12.5px; color: #94a3b8;">Secret API Key & Real-time Ban Synchronization</span>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="closeFivemSyncModal()"><i data-lucide="x"></i></button>
            </div>

            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
                <label style="display: block; font-size: 11.5px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
                    Secret Server API Key
                </label>
                <div style="display: flex; gap: 8px;">
                    <input type="text" id="fivem-key-input" readonly value="Loading..." style="flex: 1; background: #070e1b; border: 1px solid rgba(129, 140, 248, 0.3); border-radius: 8px; padding: 10px 12px; font-family: monospace; font-size: 13px; color: #38bdf8;">
                    <button type="button" class="cta" onclick="copyFivemKey()" style="width: auto; background: #4f46e5; padding: 0 16px; border-radius: 8px; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                        <i data-lucide="copy" style="width: 14px; height: 14px;"></i> Copy
                    </button>
                    <button type="button" class="cta" onclick="regenerateFivemKey()" style="width: auto; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; padding: 0 12px; border-radius: 8px; font-size: 13px;" title="Regenerate new key">
                        <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
            </div>

            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 16px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <label style="font-size: 11.5px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin: 0;">
                        FiveM Config Snippet (config.lua)
                    </label>
                    <button type="button" onclick="copyFivemConfigSnippet()" style="background: transparent; border: none; color: #818cf8; font-size: 12px; font-weight: 600; cursor: pointer;">
                        Copy Snippet
                    </button>
                </div>
                <pre id="fivem-config-preview" style="background: #070e1b; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; color: #a5f3fc; margin: 0; overflow-x: auto; white-space: pre-wrap; line-height: 1.5;"></pre>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 10px;">
                <button type="button" class="cta" style="width: auto; background: transparent; border: 1px solid rgba(255, 255, 255, 0.15);" onclick="closeFivemSyncModal()">Close</button>
            </div>
        </div>
    `;

    overlay.style.display = 'flex';
    if (window.lucide && lucide.createIcons) lucide.createIcons();

    overlay.onclick = (e) => {
        if (e.target === overlay) closeFivemSyncModal();
    };

    try {
        const res = await fetch(`${API_URL}/server/api-key`);
        const data = await res.json();
        const key = data.apiKey || '';
        const keyInput = document.getElementById('fivem-key-input');
        if (keyInput) keyInput.value = key;

        const originUrl = (typeof window !== 'undefined' && window.location.origin) ? window.location.origin : 'http://localhost:3000';
        const snippet = `Config = {}\nConfig.ApiUrl = "${originUrl}"\nConfig.ServerKey = "${key}"\nConfig.Timeout = 3500`;
        const snippetPre = document.getElementById('fivem-config-preview');
        if (snippetPre) snippetPre.textContent = snippet;
    } catch (e) {
        showToast('Failed to load API key', 'error');
    }
}

window.openFivemSyncModal = openFivemSyncModal;

function closeFivemSyncModal() {
    const overlay = document.getElementById('fivem-sync-modal');
    if (overlay) overlay.style.display = 'none';
}
window.closeFivemSyncModal = closeFivemSyncModal;

function copyFivemKey() {
    const keyInput = document.getElementById('fivem-key-input');
    if (keyInput && keyInput.value) {
        navigator.clipboard.writeText(keyInput.value).then(() => {
            showToast('Secret Key copied to clipboard!', 'success');
        });
    }
}
window.copyFivemKey = copyFivemKey;

function copyFivemConfigSnippet() {
    const snippetPre = document.getElementById('fivem-config-preview');
    if (snippetPre && snippetPre.textContent) {
        navigator.clipboard.writeText(snippetPre.textContent).then(() => {
            showToast('Config snippet copied!', 'success');
        });
    }
}
window.copyFivemConfigSnippet = copyFivemConfigSnippet;

async function regenerateFivemKey() {
    const confirmed = await showCustomConfirm({
        title: 'Regenerate Secret API Key?',
        message: 'This will permanently invalidate your current Secret Key. You will need to update the config.lua on your FiveM server.',
        confirmText: 'Regenerate Key',
        cancelText: 'Cancel',
        type: 'danger',
        icon: 'refresh-cw'
    });
    if (!confirmed) return;
    try {
        const res = await fetch(`${API_URL}/server/api-key/regenerate`, { method: 'POST' });
        const data = await res.json();
        const key = data.apiKey || '';
        const keyInput = document.getElementById('fivem-key-input');
        if (keyInput) keyInput.value = key;

        const originUrl = (typeof window !== 'undefined' && window.location.origin) ? window.location.origin : 'http://localhost:3000';
        const snippet = `Config = {}\nConfig.ApiUrl = "${originUrl}"\nConfig.ServerKey = "${key}"\nConfig.Timeout = 3500`;
        const snippetPre = document.getElementById('fivem-config-preview');
        if (snippetPre) snippetPre.textContent = snippet;

        showToast('Secret Key successfully regenerated!', 'success');
    } catch (e) {
        showToast('Failed to regenerate Secret Key', 'error');
    }
}
window.regenerateFivemKey = regenerateFivemKey;

// ==========================================
// DISCORD AUTH GATE & USER SESSION
// ==========================================
function getAuthUser() {
    try {
        const stored = localStorage.getItem('watchdog_auth_user');
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}
window.getAuthUser = getAuthUser;

function setAuthUser(user) {
    if (user) {
        localStorage.setItem('watchdog_auth_user', JSON.stringify(user));
    } else {
        localStorage.removeItem('watchdog_auth_user');
    }
    renderTopbarUser();
}
window.setAuthUser = setAuthUser;

function logoutWatchdogUser() {
    localStorage.removeItem('watchdog_auth_user');
    showToast('Logged out successfully.', 'info');
    setTimeout(() => {
        location.reload();
    }, 400);
}
window.logoutWatchdogUser = logoutWatchdogUser;

function renderTopbarUser() {
    const user = getAuthUser();
    const container = document.querySelector('.topbar-actions');
    if (!container) return;

    let userBadge = container.querySelector('.topbar-user-badge');
    if (!user) {
        if (userBadge) userBadge.remove();
        return;
    }

    const initial = (user.name || user.username || 'U').charAt(0).toUpperCase();
    const isOwner = user.role === 'owner' || user.isOwner;
    const roleText = isOwner ? '👑 Owner' : '🛡️ Staff';
    const roleClass = isOwner ? 'owner' : 'staffer';

    if (!userBadge) {
        userBadge = document.createElement('div');
        userBadge.className = 'topbar-user-badge';
        container.prepend(userBadge);
    }

    userBadge.innerHTML = `
        ${user.avatarUrl 
            ? `<img src="${user.avatarUrl}" alt="${escapeHtml(user.name)}" class="topbar-user-avatar" onerror="this.outerHTML='<div class=\\'topbar-user-avatar\\' style=\\'display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;\\'>${initial}</div>'" />`
            : `<div class="topbar-user-avatar" style="display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;">${initial}</div>`
        }
        <span class="topbar-user-name">${escapeHtml(user.name || user.username || 'User')}</span>
        <span class="topbar-user-role ${roleClass}">${roleText}</span>
        <button type="button" class="btn-topbar-logout" onclick="event.stopPropagation(); logoutWatchdogUser();" title="Log out">
            <i data-lucide="log-out" style="width: 14px; height: 14px;"></i>
        </button>
    `;

    if (window.lucide && lucide.createIcons) lucide.createIcons();
}
window.renderTopbarUser = renderTopbarUser;

function initDiscordAuthGate() {
    const user = getAuthUser();
    renderTopbarUser();

    if (user && user.authorized) {
        // User is already logged in
        return;
    }

    // Show Auth Gate Modal
    let overlay = document.getElementById('discord-auth-gate-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'discord-auth-gate-overlay';
        overlay.className = 'auth-gate-overlay';
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
        <div class="auth-gate-card">
            <img src="logo.png" alt="Watchdog" class="auth-gate-logo" />
            <h2 class="auth-gate-title">Watchdog Access Gate</h2>
            <p class="auth-gate-subtitle">Identify with your Discord account to unlock the Moderation Dashboard.</p>

            <div id="auth-gate-error" class="auth-error-msg"></div>

            <form id="auth-gate-form" onsubmit="handleAuthGateSubmit(event)">
                <div class="auth-input-group">
                    <label>Discord User ID</label>
                    <input type="text" id="auth-discord-id" class="auth-input" placeholder="e.g. 320110089727901697" required autofocus autocomplete="off" />
                </div>
                <button type="submit" id="auth-gate-btn" class="btn-auth-submit">
                    <i data-lucide="shield-check" style="width: 17px; height: 17px;"></i>
                    <span>Verify & Enter</span>
                </button>
            </form>

            <div style="margin-top: 20px; font-size: 11.5px; color: #64748b; line-height: 1.4;">
                <i data-lucide="lock" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 3px;"></i>
                Encrypted access restricted to registered Server Owner & Staff members.
            </div>
        </div>
    `;

    if (window.lucide && lucide.createIcons) lucide.createIcons();
    overlay.style.display = 'flex';
}
window.initDiscordAuthGate = initDiscordAuthGate;

async function handleAuthGateSubmit(e) {
    e.preventDefault();
    const idInput = document.getElementById('auth-discord-id');
    const submitBtn = document.getElementById('auth-gate-btn');
    const errorEl = document.getElementById('auth-gate-error');

    const discordId = (idInput?.value || '').trim();
    if (!discordId) return;

    if (errorEl) errorEl.style.display = 'none';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>Verifying...</span>`;
    }

    try {
        const res = await fetch(`${API_URL}/auth/verify-staff`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discordId })
        });

        const data = await res.json();
        if (res.ok && data.authorized) {
            setAuthUser(data);
            if (data.serverId) {
                localStorage.setItem('watchdog_active_server_id', data.serverId);
                if (typeof clearClientApiCache === 'function') clearClientApiCache();
            }
            showToast(`Welcome back, ${data.name}! Logged in as ${data.role === 'owner' ? 'Owner' : 'Staffer'}.`, 'success');

            const overlay = document.getElementById('discord-auth-gate-overlay');
            if (overlay) {
                overlay.style.transition = 'opacity 0.3s ease';
                overlay.style.opacity = '0';
                setTimeout(() => {
                    overlay.remove();
                    location.reload();
                }, 350);
            }
        } else {
            if (errorEl) {
                errorEl.textContent = data.error || 'Unauthorized: Discord account is not enabled.';
                errorEl.style.display = 'block';
            }
            if (idInput) highlightInvalidInput(idInput, 'Unauthorized Discord ID');
        }
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = 'Server connection error. Please try again.';
            errorEl.style.display = 'block';
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i data-lucide="shield-check" style="width: 17px; height: 17px;"></i> <span>Verify & Enter</span>`;
            if (window.lucide && lucide.createIcons) lucide.createIcons();
        }
    }
}
window.handleAuthGateSubmit = handleAuthGateSubmit;

document.addEventListener('DOMContentLoaded', () => {
    initSidebarPlayerNavigation();
    initWatchdogTopbar();
    initDiscordAuthGate();
});