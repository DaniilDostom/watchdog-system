let allPlayers = [];
let allActions = [];
let filteredData = [];
let currentPage = 1;
const PLAYERS_PREFS_KEY = 'playersTablePrefs';
const PLAYERS_PAGE_KEY = 'playersCurrentPage';
const PLAYERS_VIEWED_KEY = 'playersLastViewed';
const PLAYER_PREFETCH_KEY = 'playerPrefetch';
const AVATAR_CACHE_KEY = 'players_avatar_cache_v3';

// Fast avatar cache stored in localStorage — { url, isDefault }
function getAvatarCache() {
    try { return JSON.parse(localStorage.getItem(AVATAR_CACHE_KEY) || '{}'); } catch { return {}; }
}
function setAvatarCache(cache) {
    try { localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

// Returns true if the URL is a Discord default/embed avatar (not a real custom one)
function isDefaultAvatarUrl(url) {
    if (!url) return true;
    return url.includes('/embed/avatars/'); // custom avatars use /avatars/<userId>/
}

// Compute Discord default avatar index from snowflake ID
function discordDefaultAvatarIdx(discordId) {
    try {
        if (!/^\d{17,20}$/.test(discordId)) return 0;
        return Number((BigInt(discordId) >> 22n) % 6n);
    } catch { return 0; }
}

// Get best available avatar URL immediately (real if cached, CDN default otherwise)
function getAvatarUrl(discordId) {
    if (!discordId || !/^\d{17,20}$/.test(discordId)) return null;
    const cache = getAvatarCache();
    const entry = cache[discordId];
    if (entry?.url && !isDefaultAvatarUrl(entry.url)) return entry.url;
    return `https://cdn.discordapp.com/embed/avatars/${discordDefaultAvatarIdx(discordId)}.png`;
}

// After render, batch-fetch real Discord avatars and update DOM in-place
async function preloadRealAvatars(players) {
    const cache = getAvatarCache();
    const ids = players
        .map(p => p.discordId)
        .filter(id => id && /^\d{17,20}$/.test(id));

    // Re-fetch if not in cache OR if what we have is a default avatar URL
    const needFetch = ids.filter(id => {
        const entry = cache[id];
        return !entry || isDefaultAvatarUrl(entry.url);
    });

    if (needFetch.length > 0) {
        try {
            const res = await fetch('/api/discord-avatars', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userIds: needFetch })
            });
            if (res.ok) {
                const results = await res.json();
                Object.entries(results).forEach(([id, profile]) => {
                    if (profile?.url) {
                        cache[id] = { url: profile.url };
                    }
                });
                setAvatarCache(cache);
            }
        } catch {}
    }

    updateVisibleAvatars(cache);
}

// Swap <img> src to real avatar URL without re-rendering the table
function updateVisibleAvatars(cache) {
    document.querySelectorAll('.player-avatar-img[data-discord-id]').forEach(img => {
        const id = img.dataset.discordId;
        const entry = cache[id];
        if (entry?.url && !isDefaultAvatarUrl(entry.url) && img.src !== entry.url) {
            img.src = entry.url;
        }
    });
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (isNaN(diffMs)) return 'N/A';
    if (diffMs < 0) return 'Today';

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return '1d ago';
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    const diffYears = Math.floor(diffDays / 365);
    return `${diffYears}y ago`;
}

function getLastViewedPlayers() {
    try { return JSON.parse(sessionStorage.getItem(PLAYERS_VIEWED_KEY) || '{}'); } catch { return {}; }
}

window.openPlayerPage = async (playerId, button, event) => {
    if (event && (event.ctrlKey || event.metaKey || event.button === 1)) {
        return; // Allow browser to open in new tab
    }
    if (event && event.preventDefault) event.preventDefault();

    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-lucide="loader" style="width:13px;height:13px;"></i> Loading...';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    try {
        const [players, actions] = await Promise.all([ModAPI.getPlayers(), ModAPI.getActions()]);
        const player = players.find(item => item.id === playerId);
        const avatar = player ? await ModAPI.getDiscordAvatar(player.discordId) : { url: null };
        sessionStorage.setItem(PLAYER_PREFETCH_KEY, JSON.stringify({ playerId, players, actions, avatar, createdAt: Date.now() }));
        location.href = `player.html?id=${encodeURIComponent(playerId)}`;
    } catch {
        location.href = `player.html?id=${encodeURIComponent(playerId)}`;
    }
};

function resetPlayerViewButtons() {
    document.querySelectorAll('#players-list-tbody button[onclick*="openPlayerPage"]').forEach(button => {
        button.disabled = false;
        button.innerHTML = '<i data-lucide="eye" style="width:13px;height:13px;"></i> View';
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.addEventListener('pageshow', resetPlayerViewButtons);

function getStoredPlayerPrefs() {
    try {
        const raw = sessionStorage.getItem(PLAYERS_PREFS_KEY);
        const prefs = raw ? JSON.parse(raw) : {};
        if (prefs.status === 'Active') prefs.status = 'Clean';
        return prefs;
    } catch { return {}; }
}

function savePlayerPrefs() {
    const prefs = {
        status: document.getElementById('filter-status')?.value || 'ALL',
        sort: document.getElementById('sort-select')?.value || 'AZ',
        limit: document.getElementById('limit-select')?.value || '25'
    };
    if (prefs.status === 'Active') prefs.status = 'Clean';
    sessionStorage.setItem(PLAYERS_PREFS_KEY, JSON.stringify(prefs));
}

function applyStoredPlayerPrefs() {
    const prefs = getStoredPlayerPrefs();
    const statusSelect = document.getElementById('filter-status');
    const sortSelect = document.getElementById('sort-select');
    const limitSelect = document.getElementById('limit-select');
    if (statusSelect && prefs.status) statusSelect.value = prefs.status === 'Active' ? 'Clean' : prefs.status;
    if (sortSelect && prefs.sort) sortSelect.value = prefs.sort;
    if (limitSelect && prefs.limit) limitSelect.value = prefs.limit;
}

async function initPlayers() {
    applyStoredPlayerPrefs();
    currentPage = Number(sessionStorage.getItem(PLAYERS_PAGE_KEY)) || 1;
    const [playersData, actionsData] = await Promise.all([ModAPI.getPlayers(), ModAPI.getActions()]);
    allActions = actionsData;

    // Fast O(1) pre-indexing of actions by playerId
    const actionsByPlayer = new Map();
    for (const a of actionsData) {
        if (!a || !a.playerId) continue;
        let list = actionsByPlayer.get(a.playerId);
        if (!list) {
            list = [];
            actionsByPlayer.set(a.playerId, list);
        }
        list.push(a);
    }

    allPlayers = playersData.map(p => {
        const pActions = actionsByPlayer.get(p.id) || [];
        const warns = pActions.filter(a => isWarningActive(a, pActions)).length;
        const bans = pActions.filter(a => a.type === 'BAN').length;
        const pSanctions = pActions
            .filter(a => a.type === 'WARN' || a.type === 'BAN' || a.type === 'LAST_CHANCE' || a.lastChance)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const lastAction = pSanctions[0] || (pActions.length ? [...pActions].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] : null);
        const permanentBanRemovals = pActions.filter(a => a.permanentBanRemoval);
        const activeBans = pActions.filter(a => a.type === 'BAN' && isActionActive(a))
            .filter(a => !permanentBanRemovals.some(r => r.removedFromActionId === a.id));
        const lastChance = hasActiveLastChance(pActions);
        let derivedStatus;
        if (activeBans.some(a => a.permanent)) derivedStatus = 'Permanently Banned';
        else if (activeBans.length > 0) derivedStatus = 'Banned';
        else if (warns > 0) derivedStatus = 'Warned';
        else if (lastChance) derivedStatus = 'Last Chance';
        else derivedStatus = 'Clean';
        return { ...p, warns, bans, lastAction, status: derivedStatus, lastChance };
    });

    updateOverviewStats();
    syncPillButtonsWithFilter();
    applyFilters();
    setupEventListeners();

    // Background: try to load real avatars and update them without re-render
    preloadRealAvatars(allPlayers);
}

function updateOverviewStats() {
    let clean = 0, warned = 0, lastchance = 0, banned = 0;
    for (const p of allPlayers) {
        if (p.status === 'Clean') clean++;
        else if (p.status === 'Warned') warned++;
        else if (p.status === 'Last Chance') lastchance++;
        else if (p.status === 'Banned' || p.status === 'Permanently Banned') banned++;
    }
    const total = allPlayers.length;
    const elTotal = document.getElementById('stat-total-players');
    const elClean = document.getElementById('stat-clean-players');
    const elWarned = document.getElementById('stat-warned-players');
    const elLastChance = document.getElementById('stat-lastchance-players');
    const elBanned = document.getElementById('stat-banned-players');
    if (elTotal) elTotal.innerText = total;
    if (elClean) elClean.innerText = clean;
    if (elWarned) elWarned.innerText = warned;
    if (elLastChance) elLastChance.innerText = lastchance;
    if (elBanned) elBanned.innerText = banned;
}

function syncPillButtonsWithFilter() {
    const currentStatus = document.getElementById('filter-status')?.value || 'ALL';
    document.querySelectorAll('#status-pill-filter .filter-pill-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.status === currentStatus);
    });
}

let searchDebounceTimer = null;
function setupEventListeners() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            if (clearBtn) clearBtn.style.display = searchInput.value ? 'block' : 'none';
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                currentPage = 1;
                applyFilters();
            }, 90);
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            clearBtn.style.display = 'none';
            currentPage = 1;
            applyFilters();
            searchInput.focus();
        });
    }
    document.querySelectorAll('#status-pill-filter .filter-pill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const status = btn.dataset.status;
            const filterInput = document.getElementById('filter-status');
            if (filterInput) filterInput.value = status;
            syncPillButtonsWithFilter();
            currentPage = 1;
            savePlayerPrefs();
            applyFilters();
        });
    });
    document.getElementById('sort-select')?.addEventListener('change', () => { currentPage = 1; savePlayerPrefs(); applyFilters(); });
    document.getElementById('limit-select')?.addEventListener('change', () => { currentPage = 1; savePlayerPrefs(); applyFilters(); });
    document.getElementById('btn-prev')?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderTable(); } });
    document.getElementById('btn-next')?.addEventListener('click', () => {
        const limit = parseInt(document.getElementById('limit-select')?.value || '25');
        if (currentPage * limit < filteredData.length) { currentPage++; renderTable(); }
    });
}

function applyFilters() {
    const search = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
    const status = document.getElementById('filter-status')?.value || 'ALL';
    const sort = document.getElementById('sort-select')?.value || 'AZ';
    const normalizedStatus = status === 'Active' ? 'Clean' : status;
    const lastViewedPlayers = getLastViewedPlayers();

    filteredData = allPlayers.filter(p => {
        const matchSearch = p.username.toLowerCase().includes(search) || (p.discordId || '').includes(search);
        const matchStatus = normalizedStatus === 'ALL' || p.status === normalizedStatus;
        return matchSearch && matchStatus;
    });

    filteredData.sort((a, b) => {
        if (sort === 'AZ') return a.username.localeCompare(b.username);
        if (sort === 'ZA') return b.username.localeCompare(a.username);
        if (sort === 'WARNS') return b.warns - a.warns;
        if (sort === 'BANS') return b.bans - a.bans;
        if (sort === 'RECENT') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        if (sort === 'VIEWED') return (lastViewedPlayers[b.id] || 0) - (lastViewedPlayers[a.id] || 0);
        return 0;
    });

    const limit = parseInt(document.getElementById('limit-select')?.value || '25');
    const pageCount = Math.max(1, Math.ceil(filteredData.length / limit));
    currentPage = Math.min(Math.max(1, currentPage), pageCount);
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('players-list-tbody');
    const emptyState = document.getElementById('empty-state');
    const limit = parseInt(document.getElementById('limit-select')?.value || '25');
    sessionStorage.setItem(PLAYERS_PAGE_KEY, String(currentPage));
    if (!tbody) return;
    tbody.innerHTML = '';

    if (filteredData.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        const paginationInfo = document.getElementById('pagination-info');
        if (paginationInfo) paginationInfo.innerText = '';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';
    const start = (currentPage - 1) * limit;
    const end = start + limit;
    const paginated = filteredData.slice(start, end);
    const cache = getAvatarCache();

    paginated.forEach(p => {
        const tr = document.createElement('tr');

        let statusBadgeClass = 'clean';
        let statusIcon = 'shield-check';
        if (p.status === 'Permanently Banned') { statusBadgeClass = 'permbanned'; statusIcon = 'shield-alert'; }
        else if (p.status === 'Banned') { statusBadgeClass = 'banned'; statusIcon = 'ban'; }
        else if (p.status === 'Warned') { statusBadgeClass = 'warned'; statusIcon = 'alert-triangle'; }
        else if (p.status === 'Last Chance') { statusBadgeClass = 'lastchance'; statusIcon = 'flame'; }

        let lastActionText = '<span style="color: #64748b;">No sanctions</span>';
        if (p.lastAction) {
            const timeAgo = formatTimeAgo(p.lastAction.timestamp);
            let actionType = p.lastAction.type || 'SANCTION';
            if (actionType === 'LAST_CHANCE' || (p.lastAction.type === 'BAN' && p.lastAction.lastChance)) {
                actionType = 'LAST CHANCE';
            } else if (actionType === 'BAN' && p.lastAction.permanent) {
                actionType = 'PERMANENT BAN';
            } else {
                actionType = actionType.replace(/_/g, ' ');
            }
            const dateTitle = p.lastAction.timestamp ? new Date(p.lastAction.timestamp).toLocaleString() : '';
            lastActionText = `<span style="color: #cbd5e1; font-weight: 500;">${escapeHtml(actionType)}</span> <span style="color: #64748b; font-size: 11px;" title="${escapeHtml(dateTitle)}">(${timeAgo})</span>`;
        }

        // Avatar: use cached real URL, or immediate Discord CDN default
        const avatarUrl = cache[p.discordId] || getAvatarUrl(p.discordId);
        const initial = (p.username || '?').charAt(0).toUpperCase();
        const avatarHtml = avatarUrl
            ? `<img class="player-avatar-img" src="${escapeHtml(avatarUrl)}" data-discord-id="${escapeHtml(p.discordId || '')}" alt="" loading="lazy" onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='flex';" /><span class="player-avatar-fallback" style="display:none;">${initial}</span>`
            : `<span class="player-avatar-fallback">${initial}</span>`;

        tr.innerHTML = `
            <td>
                <div class="player-identity-cell">
                    <div class="player-avatar-badge">${avatarHtml}</div>
                    <div class="player-info-wrap">
                        <a href="player.html?id=${encodeURIComponent(p.id)}" class="player-title-name" onclick="openPlayerPage('${p.id}', null, event);">${escapeHtml(p.username)}</a>
                    </div>
                </div>
            </td>
            <td>
                <span class="player-discord-sub">
                    <i data-lucide="hash" style="width: 12px; height: 12px; color: #818cf8;"></i> ${escapeHtml(p.discordId || 'N/A')}
                    <i data-lucide="copy" style="width: 13px; height: 13px; cursor: pointer; color: #64748b; margin-left: 2px;" title="Copy Discord ID" onclick="copyToClipboard('${escapeHtml(p.discordId)}')"></i>
                </span>
            </td>
            <td style="text-align: center;">
                <span class="stat-pill-num ${p.warns > 0 ? 'warn' : 'zero'}">${p.warns}</span>
            </td>
            <td style="text-align: center;">
                <span class="stat-pill-num ${p.bans > 0 ? 'ban' : 'zero'}">${p.bans}</span>
            </td>
            <td>
                <div style="display:inline-flex; align-items:center; gap:5px; flex-wrap:wrap;">
                    <span class="player-status-badge ${statusBadgeClass}">
                        <i data-lucide="${statusIcon}" style="width: 12px; height: 12px;"></i> ${p.status}
                    </span>
                    ${p.lastChance && (p.status === 'Banned' || p.status === 'Permanently Banned') ? `<span class="player-status-badge lastchance"><i data-lucide="flame" style="width: 12px; height: 12px;"></i> Last Chance</span>` : ''}
                </div>
            </td>
            <td style="font-size: 12.5px;">${lastActionText}</td>
            <td style="text-align: right;">
                <div style="display: inline-flex; gap: 6px; justify-content: flex-end;">
                    <button type="button" class="btn-staff-link" style="padding: 5px 10px; font-size: 12px;" onclick="openPlayerPage('${p.id}', this, event)"><i data-lucide="eye" style="width: 13px; height: 13px;"></i> View</button>
                    <button type="button" class="btn-staff-link" style="padding: 5px 10px; font-size: 12px; color: #818cf8; border-color: rgba(129,140,248,0.25);" onclick="openEditPlayerModal('${p.id}')"><i data-lucide="edit-2" style="width: 13px; height: 13px;"></i> Edit</button>
                    <button type="button" class="btn-staff-link" style="padding: 5px 10px; font-size: 12px; color: #f87171; border-color: rgba(239,68,68,0.25);" onclick="deletePlayerById('${p.id}')"><i data-lucide="trash-2" style="width: 13px; height: 13px;"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    const paginationInfo = document.getElementById('pagination-info');
    if (paginationInfo) {
        paginationInfo.innerText = `Showing ${start + 1}–${Math.min(end, filteredData.length)} of ${filteredData.length} players`;
    }
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();

    // Load real Discord avatars for current page in background
    preloadRealAvatars(paginated);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function copyToClipboard(text) {
    if (!text || text === 'N/A') return;
    navigator.clipboard.writeText(text).then(() => showToast('Discord ID copied to clipboard.'));
}

document.addEventListener('DOMContentLoaded', initPlayers);

// --- Add Player Modal with Live Discord Auto-Resolution ---

let discordPreviewDebounce = null;
let currentResolvedProfile = null;

async function previewDiscordPlayer(rawId) {
    const discordId = (rawId || '').trim();
    const previewBox = document.getElementById('discord-player-preview');
    const errDiscord = document.getElementById('err-discord');
    if (errDiscord) errDiscord.style.display = 'none';

    clearTimeout(discordPreviewDebounce);
    if (!/^\d{17,20}$/.test(discordId)) {
        if (previewBox) previewBox.style.display = 'none';
        currentResolvedProfile = null;
        return;
    }

    discordPreviewDebounce = setTimeout(async () => {
        try {
            const res = await fetch(`${API_URL}/discord-avatar/${encodeURIComponent(discordId)}`);
            if (res.ok) {
                const profile = await res.json();
                currentResolvedProfile = profile;
                if (previewBox) {
                    const avatarImg = document.getElementById('preview-avatar-img');
                    const nameSpan = document.getElementById('preview-display-name');
                    const tagDiv = document.getElementById('preview-username-tag');

                    if (avatarImg) avatarImg.src = profile.url || 'https://cdn.discordapp.com/embed/avatars/0.png';
                    if (nameSpan) nameSpan.textContent = profile.globalName || profile.username || 'Discord User';
                    if (tagDiv) tagDiv.textContent = `@${profile.username || 'user'} • ${discordId}`;

                    previewBox.style.display = 'flex';
                }
            }
        } catch {}
    }, 250);
}
window.previewDiscordPlayer = previewDiscordPlayer;

function openAddPlayerModal() {
    const modal = document.getElementById('add-player-modal');
    if (modal) modal.style.display = 'flex';
    document.getElementById('add-discord')?.focus();
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

function closeAddPlayerModal() {
    const modal = document.getElementById('add-player-modal');
    if (modal) modal.style.display = 'none';
    document.getElementById('add-player-form')?.reset();
    const previewBox = document.getElementById('discord-player-preview');
    if (previewBox) previewBox.style.display = 'none';
    currentResolvedProfile = null;
    document.querySelectorAll('.error-msg').forEach(el => el.style.display = 'none');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (document.getElementById('add-player-modal')?.style.display === 'flex') closeAddPlayerModal();
        if (document.getElementById('edit-player-modal')?.style.display === 'flex') closeEditPlayerModal();
    }
});

document.getElementById('add-player-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const discordInput = document.getElementById('add-discord');
    const errDiscord = document.getElementById('err-discord');
    const errLicense = document.getElementById('err-license');
    const submitBtn = document.getElementById('btn-submit-player');

    let isValid = true;
    if (errDiscord) errDiscord.style.display = 'none';
    if (errLicense) errLicense.style.display = 'none';

    const discordId = (discordInput?.value || '').trim();
    if (!/^\d{17,20}$/.test(discordId)) {
        if (errDiscord) {
            errDiscord.innerText = 'Please enter a valid 17-20 digit Discord User ID';
            errDiscord.style.display = 'block';
        }
        isValid = false;
    }
    if (!isValid) return;

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Resolving & Creating...</span>';
    }

    try {
        let profile = currentResolvedProfile;
        if (!profile || profile.discordId !== discordId) {
            const res = await fetch(`${API_URL}/discord-avatar/${encodeURIComponent(discordId)}`);
            if (res.ok) profile = await res.json();
        }

        const username = profile?.globalName || profile?.username || `Player_${discordId.slice(-4)}`;
        let license = (document.getElementById('add-license')?.value || '').trim();
        if (license && !license.toLowerCase().startsWith('license:')) {
            license = `license:${license}`;
        }

        const dbPlayers = await ModAPI.getPlayers();
        const duplicate = dbPlayers.find(player => String(player.discordId || '').trim() === discordId);
        if (duplicate) {
            showToast(`Player with this Discord ID already exists: ${duplicate.username}`, 'info');
            location.href = `player.html?id=${encodeURIComponent(duplicate.id)}`;
            return;
        }

        const newPlayer = {
            id: `p${Date.now()}`,
            username,
            discordId,
            createdAt: new Date().toISOString(),
            status: 'Clean',
            fivemLicense: license || null
        };

        dbPlayers.push(newPlayer);
        await ModAPI.savePlayers(dbPlayers);
        await ModAPI.logEvent(`Registered new player: ${newPlayer.username} (${newPlayer.discordId})`, 'Staff');
        notifyAfterNavigation('Player registered successfully!');
        location.href = `player.html?id=${encodeURIComponent(newPlayer.id)}`;
    } catch (err) {
        showToast('Failed to register player', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Register Player';
        }
    }
});

// --- Edit Player Modal ---

let editingPlayerId = null;

window.openEditPlayerModal = (playerId) => {
    editingPlayerId = playerId;
    const player = allPlayers.find(p => p.id === playerId);
    if (!player) return;
    document.getElementById('edit-username').value = player.username || '';
    document.getElementById('edit-discord').value = player.discordId || '';
    document.getElementById('edit-license').value = player.fivemLicense || '';
    document.getElementById('err-edit-username').style.display = 'none';
    document.getElementById('err-edit-discord').style.display = 'none';
    document.getElementById('err-edit-license').style.display = 'none';
    const modal = document.getElementById('edit-player-modal');
    if (modal) modal.style.display = 'flex';
    document.getElementById('edit-username')?.focus();
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
};

function closeEditPlayerModal() {
    const modal = document.getElementById('edit-player-modal');
    if (modal) modal.style.display = 'none';
    editingPlayerId = null;
}

document.getElementById('edit-player-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingPlayerId) return;
    const usernameInput = document.getElementById('edit-username');
    const discordInput = document.getElementById('edit-discord');
    const errUsername = document.getElementById('err-edit-username');
    const errDiscord = document.getElementById('err-edit-discord');
    let isValid = true;
    errUsername.style.display = 'none';
    errDiscord.style.display = 'none';
    const username = usernameInput.value.trim();
    const discordId = discordInput.value.trim();
    if (!username) { errUsername.innerText = 'Username is required'; errUsername.style.display = 'block'; isValid = false; }
    if (discordId && !/^\d+$/.test(discordId)) { errDiscord.innerText = 'Discord ID must be a valid numeric string'; errDiscord.style.display = 'block'; isValid = false; }
    if (!isValid) return;
    const btn = document.getElementById('btn-save-edit-player');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
        const players = await ModAPI.getPlayers();
        const idx = players.findIndex(p => p.id === editingPlayerId);
        if (idx === -1) { showToast('Player not found', 'error'); return; }
        const oldUsername = players[idx].username;
        players[idx].username = username;
        players[idx].discordId = discordId;
        const licenseVal = (document.getElementById('edit-license')?.value || '').trim();
        if (licenseVal && !licenseVal.toLowerCase().startsWith('license:')) {
            const errL = document.getElementById('err-edit-license');
            if (errL) { errL.innerText = 'License must start with "license:" (e.g. license:a1b2c3...)'; errL.style.display = 'block'; }
            btn.disabled = false;
            btn.textContent = 'Save Changes';
            return;
        }
        players[idx].fivemLicense = licenseVal || null;
        await ModAPI.savePlayers(players);
        // If discord ID changed, bust avatar cache for this player
        if (discordId !== players[idx].discordId) {
            const cache = getAvatarCache();
            delete cache[players[idx].discordId];
            setAvatarCache(cache);
        }
        await ModAPI.logEvent(`Edited player ${oldUsername} → username: ${username}, discordId: ${discordId}`, 'System Admin');
        showToast('Player updated successfully.');
        closeEditPlayerModal();
        await initPlayers();
    } catch (err) {
        showToast('Error saving: ' + (err.message || err), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Changes';
    }
});

window.deletePlayerById = async (id) => {
    const players = await ModAPI.getPlayers();
    const target = players.find(p => p.id === id);
    const targetName = target ? target.username : 'this player';

    const confirmed = typeof showCustomConfirm === 'function'
        ? await showCustomConfirm({
            title: `Delete Player "${targetName}"?`,
            message: `Are you sure you want to permanently delete <strong>${escapeHtml(targetName)}</strong> and all their historical warnings, bans, and activity logs? This action cannot be undone.`,
            confirmText: 'Delete Player',
            cancelText: 'Cancel',
            type: 'danger',
            icon: 'trash-2'
        })
        : confirm(`Do you want to delete player "${targetName}"?`);

    if (!confirmed) return;

    const actions = await ModAPI.getActions();
    await ModAPI.savePlayers(players.filter(p => p.id !== id));
    await ModAPI.saveActions(actions.filter(a => a.playerId !== id));
    await ModAPI.logEvent(`Deleted player ${target ? target.username : id} and all associated records`, 'System Admin');
    try {
        const saved = JSON.parse(localStorage.getItem('last_active_player') || '{}');
        if (saved.id === id) {
            localStorage.removeItem('last_active_player');
            sessionStorage.removeItem('last_active_player');
            const link = document.getElementById('sidebar-active-player-link');
            if (link) link.remove();
        }
    } catch {}
    showToast('Player deleted successfully.');
    await initPlayers();
};
