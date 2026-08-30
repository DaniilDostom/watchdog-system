const API_URL = (typeof window !== 'undefined' && window.location.origin) ? (window.location.origin + '/api') : '/api';
let COMMON_REASONS = [
    'Ricerca ingaggio', 'Mancanza modulo', 'Infrazione regolamento AC',
    'Mancanza clip', 'Infrazione Regolamento',
    'Uso scorretto comando', 'Metagame OOC', 'Slog in azione', 'Spawnkill',
    'Blasfemia', 'FailRP', 'Tossicità', 'Respawn in Azione', 'Powergame', 'No Reason',
    'No Fear', 'Loot in azione', 'Loot non consono', 'Rientro In Azione',
    'RDM', 'Call Discord', 'Utilizzo Tetti', 'Combat Log', 'Comportamento Non Consono',
    'Varie infrazioni', 'Grief Fazione', 'Bug Abuse', 'Troll', 'Termini Bannabili', 'Carjack',
    'Metagame IC', 'Azione In Zona Safe', 'Clip Non Conforme', 'Scarso RP', 'Soft Flame',
    'Azioni Senza Modulo Fazione', 'Uso Scorretto Chat Anon', 'MixChat', 'Scorretto Uso /Ambulanza',
    'Scorretto Uso /Me', 'Doppia Fazione', 'VDM',
];
let BAN_ONLY_REASONS = ['Player non idoneo', 'Insulti allo staff', 'No Fear Estremo', 'Cheating',
'Diffusione Asset', 'Omertà', 'Refusal SS', 'Run Away From SS', 'Omofobia', 'Account Sharing', 'Modding',
'Acquisto Whitelist',
];
let REMOVAL_REASONS = ['Buona Condotta', 'Ricorso Accolto', 'Errore di Applicazione', 'Decisione dello Staff'];
const UNKNOWN_ISSUER = 'Unknow';

// Reason lists are managed on the Reasons page and persisted server-side; refresh the
// in-place arrays (keeping the same references other modules already read from).
async function loadReasonLists() {
    const user = (typeof getAuthUser === 'function') ? getAuthUser() : null;
    if (!user || !user.authorized) return;
    try {
        const data = await fetchDB('reasons');
        if (Array.isArray(data.normal) && data.normal.length) { COMMON_REASONS.length = 0; COMMON_REASONS.push(...data.normal); }
        if (Array.isArray(data.bad)) { BAN_ONLY_REASONS.length = 0; BAN_ONLY_REASONS.push(...data.bad); }
        if (Array.isArray(data.good) && data.good.length) { REMOVAL_REASONS.length = 0; REMOVAL_REASONS.push(...data.good); }
    } catch (error) {
        // Keep the built-in defaults if the request fails.
    }
}
loadReasonLists();

const clientApiCache = new Map();
const inFlightRequests = new Map();

function getActiveServerId() {
    try {
        const user = (typeof getAuthUser === 'function') ? getAuthUser() : null;
        if (!user || !user.authorized) return 'unauthenticated_empty';
        return localStorage.getItem('watchdog_active_server_id') || 'default_server';
    } catch {
        return 'unauthenticated_empty';
    }
}
window.getActiveServerId = getActiveServerId;

function setActiveServerId(serverId) {
    localStorage.setItem('watchdog_active_server_id', serverId || 'default_server');
    clearClientApiCache();
    location.reload();
}
window.setActiveServerId = setActiveServerId;

async function fetchDB(endpoint, forceFresh = false) {
    const user = (typeof getAuthUser === 'function') ? getAuthUser() : null;
    if (!user || !user.authorized) {
        if (endpoint === 'reasons') return { normal: [], bad: [], good: [] };
        return [];
    }

    const serverId = getActiveServerId();
    const cacheKey = `${serverId}:${endpoint}`;

    if (!forceFresh) {
        const cached = clientApiCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return typeof structuredClone === 'function' ? structuredClone(cached.data) : JSON.parse(JSON.stringify(cached.data));
        }
        if (inFlightRequests.has(cacheKey)) {
            return inFlightRequests.get(cacheKey);
        }
    }

    const fetchPromise = (async () => {
        try {
            const headers = {
                'x-server-id': serverId
            };
            if (user && user.token) headers['Authorization'] = `Bearer ${user.token}`;
            if (user && user.discordId) headers['x-discord-id'] = user.discordId;

            const res = await fetch(`${API_URL}/${endpoint}`, { headers });
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            clientApiCache.set(cacheKey, {
                data,
                expiresAt: Date.now() + 8000 // 8s fast client cache
            });
            return data;
        } finally {
            inFlightRequests.delete(cacheKey);
        }
    })();

    inFlightRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
}

async function writeDB(endpoint, data) {
    clientApiCache.clear();
    inFlightRequests.clear();
    const user = (typeof getAuthUser === 'function') ? getAuthUser() : null;
    const serverId = getActiveServerId();
    const headers = {
        'Content-Type': 'application/json',
        'x-server-id': serverId
    };
    if (user && user.token) headers['Authorization'] = `Bearer ${user.token}`;
    if (user && user.discordId) headers['x-discord-id'] = user.discordId;

    const response = await fetch(`${API_URL}/${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    clientApiCache.clear();
}

function clearClientApiCache() {
    clientApiCache.clear();
    inFlightRequests.clear();
}
window.clearClientApiCache = clearClientApiCache;

function isActionActive(action, now = Date.now()) {
    if (!action) return true;
    if (action.permanentBanRemoval) return false;
    if (action.removed) return false;
    if (action.type !== 'BAN' || action.permanent) return true;
    const duration = Number(action.duration);
    const createdAt = new Date(action.timestamp).getTime();
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(createdAt)) return true;
    const durationMs = String(action.durationUnit || 'Days').toLowerCase().startsWith('hour')
        ? duration * 60 * 60 * 1000
        : duration * 24 * 60 * 60 * 1000;
    return now < createdAt + durationMs;
}

function isWarningActive(action, allActions) {
    if (!action || action.type !== 'WARN' || action.removed || action.warningRemoval) return false;
    const removals = (allActions || []).filter(item => item.warningRemoval);
    return !removals.some(removal => removal.removedFromActionId === action.id);
}

function getActionReasons(action) {
    if (Array.isArray(action.reasonKeys) && action.reasonKeys.length) return [...new Set(action.reasonKeys)];
    if (Array.isArray(action.reasonKey) && action.reasonKey.length) return [...new Set(action.reasonKey)];
    return action.reason ? [action.reasonKey || action.reason] : ['Unspecified'];
}

// Last Chance can be granted either as a flag on a ban or as a standalone LAST_CHANCE action, until explicitly lifted.
function isLastChanceGrant(action) {
    return !action.lastChanceRemoval && (action.type === 'LAST_CHANCE' || (action.type === 'BAN' && action.lastChance && !action.permanent));
}

function hasActiveLastChance(playerActions) {
    const grants = playerActions.filter(a => isLastChanceGrant(a) && !a.lastChanceLifted && !a.removed);
    const removals = playerActions.filter(a => a.lastChanceRemoval);
    return grants.some(grant => !removals.some(removal => removal.removedFromActionId === grant.id));
}

function getActiveLastChanceBan(playerActions) {
    const removals = playerActions.filter(a => a.lastChanceRemoval);
    return playerActions
        .filter(a => isLastChanceGrant(a) && !a.lastChanceLifted && !a.removed)
        .filter(grant => !removals.some(removal => removal.removedFromActionId === grant.id))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] || null;
}

function getActionReasonText(action) {
    return getActionReasons(action).join(', ');
}

function notifyAfterNavigation(message, type = 'success') {
    sessionStorage.setItem('pendingToast', JSON.stringify({ message, type }));
}

function getSelectedReasons(select) {
    return [...select.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value).filter(Boolean);
}

let reasonRenderToken = 0;

async function populateReasonSelect(type) {
    const container = document.getElementById('action-reason');
    if (!container) return;
    const renderToken = ++reasonRenderToken;
    const selectedReasons = window.reasonSelection || getSelectedReasons(container);
    const sortMode = document.getElementById('reason-sort')?.value || 'common';
    const filterText = document.getElementById('reason-filter')?.value.trim().toLowerCase() || '';

    const actions = await fetchDB('actions');
    if (renderToken !== reasonRenderToken) return;
    const counts = {};
    actions.forEach(action => {
        if (action.type !== 'WARN' && action.type !== 'BAN') return;
        getActionReasons(action).forEach(reason => { counts[reason] = (counts[reason] || 0) + 1; });
    });

    if (!window.recidiveSelection) window.recidiveSelection = [];

    const reasons = type === 'BAN' ? [...COMMON_REASONS, ...BAN_ONLY_REASONS] : COMMON_REASONS;
    container.innerHTML = reasons
        .sort((a, b) => sortMode === 'az'
            ? a.localeCompare(b)
            : sortMode === 'za'
                ? b.localeCompare(a)
                : (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b))
        .filter(reason => !filterText || reason.toLowerCase().includes(filterText))
        .map((reason, index) => {
            const isRecidivist = (window.recidiveSelection || []).includes(reason);
            return `<label class="reason-checkbox" style="align-items:center; gap:4px;">` +
                `<input type="checkbox" value="${reason}" data-count="${counts[reason] || 0}" id="reason-${index}">` +
                `<span>${reason}</span>` +
                `<button type="button" class="reason-Recidivist-toggle${selectedReasons.includes(reason) ? ' visible' : ''}${isRecidivist ? ' active' : ''}" ` +
                `data-reason="${reason.replace(/"/g, '&quot;')}" title="Marca come Recidivist">` +
                `⟳ Recidivist</button>` +
                `</label>`;
        })
        .join('');

    container.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.checked = selectedReasons.includes(input.value);
        const RecidivistBtn = input.parentElement.querySelector('.reason-Recidivist-toggle');

        input.onchange = () => {
            const currentSelection = new Set(window.reasonSelection || []);
            if (input.checked) {
                currentSelection.add(input.value);
                if (RecidivistBtn) RecidivistBtn.classList.add('visible');
            } else {
                currentSelection.delete(input.value);
                if (RecidivistBtn) {
                    RecidivistBtn.classList.remove('visible', 'active');
                    // also deselect Recidivist
                    const recSet = new Set(window.recidiveSelection || []);
                    recSet.delete(input.value);
                    window.recidiveSelection = [...recSet];
                }
            }
            window.reasonSelection = [...currentSelection];
        };

        if (RecidivistBtn) {
            RecidivistBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const recSet = new Set(window.recidiveSelection || []);
                if (RecidivistBtn.classList.contains('active')) {
                    RecidivistBtn.classList.remove('active');
                    recSet.delete(RecidivistBtn.dataset.reason);
                } else {
                    RecidivistBtn.classList.add('active');
                    recSet.add(RecidivistBtn.dataset.reason);
                }
                window.recidiveSelection = [...recSet];
            };
        }
    });

    const sortSelect = document.getElementById('reason-sort');
    const filterInput = document.getElementById('reason-filter');
    if (sortSelect) sortSelect.onchange = () => populateReasonSelect(type);
    if (filterInput) filterInput.oninput = () => populateReasonSelect(type);
}

async function populateIssuerSelect(issuerId = 'action-issuer', optionsId = 'action-issuer-options') {
    const input = document.getElementById(issuerId);
    if (!input) return;
    
    // Remove native list attribute so browser doesn't show default native popup
    input.removeAttribute('list');
    const datalist = document.getElementById(optionsId);
    if (datalist) datalist.innerHTML = '';
    
    // Ensure custom container wrapper
    let wrap = input.parentElement;
    if (!wrap || !wrap.classList.contains('custom-staffer-input-wrap')) {
        const newWrap = document.createElement('div');
        newWrap.className = 'custom-staffer-input-wrap';
        input.parentNode.insertBefore(newWrap, input);
        newWrap.appendChild(input);
        
        const avatarPreview = document.createElement('div');
        avatarPreview.className = 'staffer-selected-avatar-preview';
        newWrap.appendChild(avatarPreview);
        
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'custom-staffer-toggle-btn';
        toggleBtn.tabIndex = -1;
        toggleBtn.innerHTML = '<i data-lucide="chevron-down"></i>';
        newWrap.appendChild(toggleBtn);
        
        const dropdownList = document.createElement('div');
        dropdownList.className = 'staffer-dropdown-list';
        newWrap.appendChild(dropdownList);
        wrap = newWrap;
        if (window.lucide && lucide.createIcons) lucide.createIcons();
    }

    const dropdownList = wrap.querySelector('.staffer-dropdown-list');
    const toggleBtn = wrap.querySelector('.custom-staffer-toggle-btn');
    let avatarPreview = wrap.querySelector('.staffer-selected-avatar-preview');
    if (!avatarPreview) {
        avatarPreview = document.createElement('div');
        avatarPreview.className = 'staffer-selected-avatar-preview';
        wrap.appendChild(avatarPreview);
    }
    
    // Fetch moderators (with avatars) and actions
    const [moderators, actions] = await Promise.all([
        ModAPI.getModerators().catch(() => []),
        ModAPI.getActions().catch(() => [])
    ]);

    const HIDDEN_STAFFERS = new Set(['system', 'system admin']);
    const stafferNames = [...new Set([
        UNKNOWN_ISSUER,
        ...moderators.map(m => m.name).filter(Boolean),
        ...actions.map(a => a.moderator).filter(Boolean)
    ])].filter(name => !HIDDEN_STAFFERS.has(name.trim().toLowerCase()))
       .sort((a, b) => a.localeCompare(b));

    function updateSelectedAvatar() {
        const val = (input.value || '').trim();
        if (!val) {
            avatarPreview.style.display = 'none';
            avatarPreview.innerHTML = '';
            input.classList.remove('has-avatar-prefix');
            return;
        }

        const modObj = moderators.find(m => m.name && m.name.toLowerCase() === val.toLowerCase());
        let localCache = {};
        try {
            localCache = JSON.parse(localStorage.getItem('staff_discord_profiles_v1') || '{}');
        } catch {}

        const localProfile = modObj?.discordId ? localCache[modObj.discordId] : localCache[val];
        let avatarUrl = modObj?.avatarUrl || localProfile?.url || null;

        if (!avatarUrl && modObj?.discordId && /^\d{17,20}$/.test(modObj.discordId)) {
            try {
                const defaultIdx = Number((BigInt(modObj.discordId) >> 22n) % 6n);
                avatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultIdx}.png`;
            } catch {}
        }

        avatarPreview.style.display = 'flex';
        if (avatarUrl) {
            avatarPreview.innerHTML = `<img src="${avatarUrl}" alt="" onerror="this.onerror=null; this.src='https://cdn.discordapp.com/embed/avatars/0.png';" />`;
        } else {
            avatarPreview.innerHTML = `<span>${val.slice(0, 2).toUpperCase()}</span>`;
        }
        input.classList.add('has-avatar-prefix');
    }

    function renderList(filter = '') {
        const filterLower = filter.trim().toLowerCase();
        const matches = stafferNames.filter(name => !filterLower || name.toLowerCase().includes(filterLower));

        if (!matches.length) {
            dropdownList.innerHTML = `<div style="padding: 10px; font-size: 12px; color: var(--text-secondary); text-align: center;">No staffers found</div>`;
            return;
        }

        let localCache = {};
        try {
            localCache = JSON.parse(localStorage.getItem('staff_discord_profiles_v1') || '{}');
        } catch {}

        dropdownList.innerHTML = matches.map(name => {
            const modObj = moderators.find(m => m.name && m.name.toLowerCase() === name.toLowerCase());
            const localProfile = modObj?.discordId ? localCache[modObj.discordId] : localCache[name];
            let avatarUrl = modObj?.avatarUrl || localProfile?.url || null;

            if (!avatarUrl && modObj?.discordId && /^\d{17,20}$/.test(modObj.discordId)) {
                try {
                    const defaultIdx = Number((BigInt(modObj.discordId) >> 22n) % 6n);
                    avatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultIdx}.png`;
                } catch {}
            }

            const avatarHtml = avatarUrl
                ? `<img class="staffer-item-avatar" src="${avatarUrl}" alt="" loading="lazy" onerror="this.onerror=null; this.src='https://cdn.discordapp.com/embed/avatars/0.png';" />`
                : `<div class="staffer-item-avatar staffer-item-avatar-fallback">${name.slice(0, 2).toUpperCase()}</div>`;

            return `
                <div class="staffer-item" data-name="${name.replace(/"/g, '&quot;')}">
                    ${avatarHtml}
                    <span>${name.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</span>
                </div>
            `;
        }).join('');

        dropdownList.querySelectorAll('.staffer-item').forEach(item => {
            item.onmousedown = (e) => {
                e.preventDefault();
                input.value = item.dataset.name;
                updateSelectedAvatar();
                dropdownList.classList.remove('show');
            };
        });
    }

    input.onfocus = () => {
        renderList(input.value);
        dropdownList.classList.add('show');
    };
    input.oninput = () => {
        updateSelectedAvatar();
        if (document.activeElement === input) {
            renderList(input.value);
            dropdownList.classList.add('show');
        }
    };
    input.onchange = () => {
        updateSelectedAvatar();
    };
    input.onblur = () => {
        setTimeout(() => {
            dropdownList.classList.remove('show');
            updateSelectedAvatar();
        }, 180);
    };
    if (toggleBtn) {
        toggleBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dropdownList.classList.contains('show')) {
                dropdownList.classList.remove('show');
            } else {
                renderList('');
                dropdownList.classList.add('show');
                input.focus();
            }
        };
    }

    updateSelectedAvatar();
    dropdownList.classList.remove('show');
}

let selectedOtherStaffers = [];

window.getSelectedOtherStaffers = () => [...selectedOtherStaffers];

window.setSelectedOtherStaffers = (staffers = []) => {
    selectedOtherStaffers = Array.isArray(staffers) ? [...staffers].filter(Boolean) : [];
    if (typeof window.renderOtherStaffersChips === 'function') {
        window.renderOtherStaffersChips();
    }
};

async function initOtherStaffersSelector(wrapId = 'other-staffers-wrap', inputId = 'other-staffers-input', chipsId = 'selected-other-staffers-chips', dropdownId = 'other-staffers-dropdown') {
    const wrap = document.getElementById(wrapId);
    const input = document.getElementById(inputId);
    const chipsContainer = document.getElementById(chipsId);
    const dropdown = document.getElementById(dropdownId);
    if (!wrap || !input || !chipsContainer || !dropdown) return;

    const [moderators, actions] = await Promise.all([
        ModAPI.getModerators().catch(() => []),
        ModAPI.getActions().catch(() => [])
    ]);

    let localCache = {};
    try {
        localCache = JSON.parse(localStorage.getItem('staff_discord_profiles_v1') || '{}');
    } catch {}

    const stafferNames = [...new Set([
        ...moderators.map(m => m.name).filter(Boolean),
        ...actions.map(a => a.moderator).filter(Boolean)
    ])].filter(name => name !== UNKNOWN_ISSUER).sort((a, b) => a.localeCompare(b));

    function getAvatarForStaffer(name) {
        const modObj = moderators.find(m => m.name && m.name.toLowerCase() === name.toLowerCase());
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

    window.renderOtherStaffersChips = () => {
        chipsContainer.innerHTML = selectedOtherStaffers.map(name => {
            const avatarUrl = getAvatarForStaffer(name);
            const avatarHtml = avatarUrl
                ? `<img class="staffer-chip-avatar" src="${avatarUrl}" alt="" onerror="this.style.display='none';" />`
                : `<span class="staffer-chip-avatar">${name.slice(0, 2).toUpperCase()}</span>`;
            return `
                <div class="staffer-chip" data-name="${escapeHtml(name)}">
                    ${avatarHtml}
                    <span>${escapeHtml(name)}</span>
                    <button type="button" class="staffer-chip-remove" onclick="removeOtherStaffer('${escapeHtml(name)}')">&times;</button>
                </div>
            `;
        }).join('');
    };

    window.removeOtherStaffer = (name) => {
        selectedOtherStaffers = selectedOtherStaffers.filter(s => s !== name);
        window.renderOtherStaffersChips();
        if (dropdown.classList.contains('show')) {
            renderDropdown(input.value);
        }
    };

    function openDropdown() {
        renderDropdown(input.value);
        dropdown.classList.add('show');
    }

    function closeDropdown() {
        dropdown.classList.remove('show');
    }

    function addStaffer(name) {
        const trimmed = (name || '').trim();
        if (!trimmed) return;
        const mainIssuer = (document.getElementById('action-issuer')?.value || '').trim();
        if (mainIssuer && mainIssuer.toLowerCase() === trimmed.toLowerCase()) {
            if (typeof showToast === 'function') showToast('The main issuer is already assigned to this action.');
            return;
        }
        if (!selectedOtherStaffers.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
            selectedOtherStaffers.push(trimmed);
            window.renderOtherStaffersChips();
        }
        input.value = '';
        input.focus();
        openDropdown();
    }

    function renderDropdown(filter = '') {
        const filterLower = filter.trim().toLowerCase();
        const mainIssuer = (document.getElementById('action-issuer')?.value || '').trim().toLowerCase();
        const available = stafferNames.filter(name => {
            const nameLower = name.toLowerCase();
            if (nameLower === mainIssuer) return false;
            if (selectedOtherStaffers.some(s => s.toLowerCase() === nameLower)) return false;
            return !filterLower || nameLower.includes(filterLower);
        });

        if (!available.length) {
            dropdown.innerHTML = `<div style="padding: 8px 12px; font-size: 12px; color: var(--text-secondary); text-align: center;">No more staffers found</div>`;
            return;
        }

        dropdown.innerHTML = available.map(name => {
            const avatarUrl = getAvatarForStaffer(name);
            const avatarHtml = avatarUrl
                ? `<img class="staffer-item-avatar" src="${avatarUrl}" alt="" loading="lazy" onerror="this.onerror=null; this.src='https://cdn.discordapp.com/embed/avatars/0.png';" />`
                : `<div class="staffer-item-avatar staffer-item-avatar-fallback">${name.slice(0, 2).toUpperCase()}</div>`;
            return `
                <div class="staffer-item" data-name="${escapeHtml(name)}">
                    ${avatarHtml}
                    <span>${escapeHtml(name)}</span>
                </div>
            `;
        }).join('');

        dropdown.querySelectorAll('.staffer-item').forEach(item => {
            item.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();
                addStaffer(item.dataset.name);
            };
        });
    }

    input.onfocus = () => {
        openDropdown();
    };
    input.onclick = (e) => {
        e.stopPropagation();
        openDropdown();
    };
    input.oninput = () => {
        openDropdown();
    };
    wrap.onclick = (e) => {
        if (e.target.closest('.staffer-chip-remove')) return;
        input.focus();
        openDropdown();
    };
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (input.value.trim()) {
                addStaffer(input.value.trim());
            }
        } else if (e.key === 'Backspace' && !input.value && selectedOtherStaffers.length > 0) {
            selectedOtherStaffers.pop();
            window.renderOtherStaffersChips();
            openDropdown();
        } else if (e.key === 'Escape') {
            closeDropdown();
        }
    };

    if (wrap._docClickHandler) {
        document.removeEventListener('click', wrap._docClickHandler);
    }
    wrap._docClickHandler = (e) => {
        if (!wrap.contains(e.target)) {
            closeDropdown();
        }
    };
    document.addEventListener('click', wrap._docClickHandler);

    window.renderOtherStaffersChips();
}

let selectedInvolvedPlayers = [];

window.getSelectedInvolvedPlayers = () => [...selectedInvolvedPlayers];

window.setSelectedInvolvedPlayers = (players = []) => {
    selectedInvolvedPlayers = Array.isArray(players) ? [...players].filter(Boolean) : [];
    if (typeof window.renderInvolvedPlayersChips === 'function') {
        window.renderInvolvedPlayersChips();
    }
};

async function initInvolvedPlayersSelector(excludePlayerId = null, wrapId = 'involved-players-wrap', inputId = 'involved-players-input', chipsId = 'selected-involved-players-chips', dropdownId = 'involved-players-dropdown') {
    const wrap = document.getElementById(wrapId);
    const input = document.getElementById(inputId);
    const chipsContainer = document.getElementById(chipsId);
    const dropdown = document.getElementById(dropdownId);
    if (!wrap || !input || !chipsContainer || !dropdown) return;

    const players = await ModAPI.getPlayers().catch(() => []);

    window.renderInvolvedPlayersChips = () => {
        chipsContainer.innerHTML = selectedInvolvedPlayers.map(p => {
            const initial = (p.username || '?').charAt(0).toUpperCase();
            return `
                <div class="staffer-chip" data-id="${escapeHtml(p.id)}">
                    <div class="staffer-chip-avatar" style="background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; border-radius: 50%;">${initial}</div>
                    <span>${escapeHtml(p.username)}</span>
                    <button type="button" class="staffer-chip-remove" onclick="removeInvolvedPlayer('${escapeHtml(p.id)}')">&times;</button>
                </div>
            `;
        }).join('');
    };

    window.removeInvolvedPlayer = (id) => {
        selectedInvolvedPlayers = selectedInvolvedPlayers.filter(p => p.id !== id);
        window.renderInvolvedPlayersChips();
        if (dropdown.classList.contains('show')) {
            renderDropdown(input.value);
        }
    };

    function openDropdown() {
        renderDropdown(input.value);
        dropdown.classList.add('show');
    }

    function closeDropdown() {
        dropdown.classList.remove('show');
    }

    function addPlayer(playerObj) {
        if (!playerObj || !playerObj.id) return;
        if (excludePlayerId && playerObj.id === excludePlayerId) {
            if (typeof showToast === 'function') showToast('The main target player is already the recipient of this sanction.');
            return;
        }
        if (!selectedInvolvedPlayers.some(p => p.id === playerObj.id)) {
            selectedInvolvedPlayers.push({
                id: playerObj.id,
                username: playerObj.username,
                discordId: playerObj.discordId
            });
            window.renderInvolvedPlayersChips();
        }
        input.value = '';
        input.focus();
        openDropdown();
    }

    function renderDropdown(filter = '') {
        const filterLower = filter.trim().toLowerCase();
        const available = players.filter(p => {
            if (excludePlayerId && p.id === excludePlayerId) return false;
            if (selectedInvolvedPlayers.some(sel => sel.id === p.id)) return false;
            if (!filterLower) return true;
            return (p.username || '').toLowerCase().includes(filterLower) || (p.discordId || '').includes(filterLower);
        });

        if (!available.length) {
            dropdown.innerHTML = `<div style="padding: 8px 12px; font-size: 12px; color: var(--text-secondary); text-align: center;">No registered players found</div>`;
            return;
        }

        dropdown.innerHTML = available.slice(0, 15).map(p => {
            const initial = (p.username || '?').charAt(0).toUpperCase();
            return `
                <div class="staffer-item" data-id="${escapeHtml(p.id)}">
                    <div class="staffer-item-avatar staffer-item-avatar-fallback" style="background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; border-radius: 50%; width: 24px; height: 24px;">${initial}</div>
                    <div style="display: flex; flex-direction: column; min-width: 0;">
                        <span style="font-weight: 600; color: white; font-size: 12.5px;">${escapeHtml(p.username)}</span>
                        <span style="font-size: 10.5px; color: #64748b;">${escapeHtml(p.discordId || 'No Discord')}</span>
                    </div>
                </div>
            `;
        }).join('');

        dropdown.querySelectorAll('.staffer-item').forEach(item => {
            item.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const p = players.find(x => x.id === item.dataset.id);
                if (p) addPlayer(p);
            };
        });
    }

    input.onfocus = () => { openDropdown(); };
    input.onclick = (e) => { e.stopPropagation(); openDropdown(); };
    input.oninput = () => { openDropdown(); };
    wrap.onclick = (e) => {
        if (e.target.closest('.staffer-chip-remove')) return;
        input.focus();
        openDropdown();
    };
    input.onkeydown = (e) => {
        if (e.key === 'Backspace' && !input.value && selectedInvolvedPlayers.length > 0) {
            selectedInvolvedPlayers.pop();
            window.renderInvolvedPlayersChips();
            openDropdown();
        } else if (e.key === 'Escape') {
            closeDropdown();
        }
    };

    if (wrap._docClickHandler) {
        document.removeEventListener('click', wrap._docClickHandler);
    }
    wrap._docClickHandler = (e) => {
        if (!wrap.contains(e.target)) {
            closeDropdown();
        }
    };
    document.addEventListener('click', wrap._docClickHandler);

    window.renderInvolvedPlayersChips();
}

const ModAPI = {
    getPlayers: () => fetchDB('players'),
    getActions: () => fetchDB('actions'),
    getReasons: () => fetchDB('reasons'),
    saveReasons: (data) => writeDB('reasons', data),
    getModerators: () => fetchDB('moderators'),
    saveModerators: (data) => writeDB('moderators', data),
    getDiscordMembers: () => fetchDB('discord-members'),
    getDiscordAvatar: async (userId) => {
        const response = await fetch(`${API_URL}/discord-avatar/${encodeURIComponent(userId)}`);
        return response.json();
    },
    getDiscordAvatars: async (userIds) => {
        try {
            const response = await fetch(`${API_URL}/discord-avatars`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userIds })
            });
            if (response.ok) {
                const text = await response.text();
                if (text && text.trim().startsWith('{')) {
                    return JSON.parse(text);
                }
            }
        } catch (e) {}

        const results = {};
        await Promise.all(userIds.map(async (id) => {
            try {
                const res = await ModAPI.getDiscordAvatar(id);
                if (res) results[id] = res;
            } catch {}
        }));
        return results;
    },
    savePlayers: (data) => writeDB('players', data),
    saveActions: (data) => writeDB('actions', data),
    logEvent: async (message, author) => {
        const actions = await fetchDB('actions');
        actions.push({
            id: `log_${Date.now()}`,
            playerId: 'SYSTEM',
            type: 'LOG',
            reason: message,
            moderator: author || 'System',
            timestamp: new Date().toISOString()
        });
        await writeDB('actions', actions);
    }
};
