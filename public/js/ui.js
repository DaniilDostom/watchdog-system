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
            <div class="modal custom-confirm-box modal-anim" style="border-top: 3px solid ${type === 'danger' ? '#ef4444' : '#f59e0b'};">
                <div class="confirm-icon-badge ${type}">
                    <i data-lucide="${icon}"></i>
                </div>
                <h3 style="font-size: 18px; font-weight: 700; color: #f8fafc; margin-bottom: 8px;">${safeTitle}</h3>
                <p style="font-size: 13.5px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px;">${message}</p>
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button type="button" class="cta btn-confirm-ok" style="background: ${confirmBtnBg}; color: white; box-shadow: ${confirmBtnShadow}; width: auto; padding: 9px 20px; font-weight: 600;">${safeConfirm}</button>
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

        overlay.querySelector('.btn-confirm-cancel').onclick = () => cleanup(false);
        overlay.querySelector('.btn-confirm-ok').onclick = () => cleanup(true);
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
    const urlParams = new URLSearchParams(window.location.search);
    const currentPagePlayerId = urlParams.get('id');

    // If we are currently on a player page with an ID, save this URL as the active player
    if (isPlayerPage && currentPagePlayerId) {
        try {
            sessionStorage.setItem('active_player_url', `player.html?id=${encodeURIComponent(currentPagePlayerId)}`);
        } catch {}
    } else if (isPlayersListPage) {
        // If user is explicitly on players.html list, clear active player so clicking Players stays on list
        try {
            sessionStorage.removeItem('active_player_url');
        } catch {}
    }

    const activePlayerUrl = sessionStorage.getItem('active_player_url');
    const playersLink = nav.querySelector('a[href*="players.html"], a[href*="player.html"]');

    if (playersLink) {
        if (activePlayerUrl && !isPlayersListPage) {
            // When navigating from dashboard, stats, etc., keep the active player open
            playersLink.href = activePlayerUrl;
        } else {
            playersLink.href = 'players.html';
        }

        if (isPlayerPage || isPlayersListPage) {
            playersLink.classList.add('active');
        }
    }
}

window.initSidebarPlayerNavigation = initSidebarPlayerNavigation;

// Topbar Watchdog SaaS & FiveM Sync Actions
function initWatchdogTopbar() {
    const topbar = document.querySelector('.topbar');
    if (!topbar || topbar.querySelector('.topbar-actions')) return;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'topbar-actions';
    actionsDiv.innerHTML = `
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
}

window.initWatchdogTopbar = initWatchdogTopbar;

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
    if (!confirm('Are you sure you want to regenerate the Secret API Key? You will need to update your config.lua on your FiveM server.')) return;
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
            showToast(`Welcome back, ${data.name}! Logged in as ${data.role === 'owner' ? 'Owner' : 'Staffer'}.`, 'success');

            const overlay = document.getElementById('discord-auth-gate-overlay');
            if (overlay) {
                overlay.style.transition = 'opacity 0.3s ease';
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 300);
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