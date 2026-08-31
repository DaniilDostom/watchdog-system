
let currentEditingStaffer = null;

function setModEditRole(role) {
    const input = document.getElementById('mod-edit-role-input');
    if (input) input.value = role;

    ['helper', 'moderator', 'admin'].forEach(r => {
        const btn = document.getElementById('role-btn-' + r);
        if (!btn) return;
        const isSel = (r === role);
        btn.style.borderColor = isSel ? (r === 'helper' ? '#22c55e' : (r === 'admin' ? '#a855f7' : '#eab308')) : 'rgba(255, 255, 255, 0.1)';
        btn.style.background = isSel ? (r === 'helper' ? 'rgba(34, 197, 94, 0.18)' : (r === 'admin' ? 'rgba(168, 85, 247, 0.18)' : 'rgba(234, 179, 8, 0.18)')) : 'rgba(15, 23, 42, 0.6)';
    });
}
window.setModEditRole = setModEditRole;

let staffersCache = [];
let allActionsCache = [];

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function cssEscape(value) {
    return String(value ?? '').replace(/["\\]/g, '\\$&');
}

// Local cache for Discord avatars & banners
const LOCAL_PROFILE_KEY = 'staff_discord_profiles_v1';

function getLocalProfileCache() {
    try {
        const raw = localStorage.getItem(LOCAL_PROFILE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function saveLocalProfileCache(cache) {
    try {
        localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(cache));
    } catch {}
}

function applyStafferProfile(name, profile) {
    if (!profile) return;
    const card = document.querySelector(`.staffer-card-v2[data-name="${cssEscape(name)}"]`);
    if (!card) return;
    const bannerEl = card.querySelector('.staffer-card-banner');
    const avatarEl = card.querySelector('.staffer-avatar-ring');

    if (bannerEl) {
        if (profile.bannerUrl) {
            bannerEl.style.backgroundImage = `url("${profile.bannerUrl}")`;
        } else {
            bannerEl.style.backgroundImage = '';
        }
    }

    if (avatarEl) {
        if (profile.url) {
            avatarEl.style.backgroundImage = `url("${profile.url}")`;
            avatarEl.textContent = '';
        } else {
            avatarEl.style.backgroundImage = '';
            avatarEl.textContent = name.charAt(0).toUpperCase();
        }
    }
}

function computeStafferStats() {
    const issuedMap = new Map();
    const assistedMap = new Map();

    allActionsCache.forEach(action => {
        if (action.moderator) {
            const lead = String(action.moderator).trim();
            issuedMap.set(lead, (issuedMap.get(lead) || 0) + 1);
        }
        const otherMods = Array.isArray(action.otherModerators) && action.otherModerators.length
            ? action.otherModerators
            : (Array.isArray(action.otherStaffers) ? action.otherStaffers : []);
        
        otherMods.forEach(assist => {
            const name = String(assist).trim();
            assistedMap.set(name, (assistedMap.get(name) || 0) + 1);
        });
    });

    let totalIssued = 0;
    let totalAssisted = 0;
    let activeStaffers = 0;
    let formerStaffers = 0;

    staffersCache.forEach(s => {
        s.issuedCount = issuedMap.get(s.name) || 0;
        s.assistedCount = assistedMap.get(s.name) || 0;
        totalIssued += s.issuedCount;
        totalAssisted += s.assistedCount;
        if (s.isFormer) {
            formerStaffers++;
        } else {
            activeStaffers++;
        }
    });

    const totalStaffers = staffersCache.length;

    const elTotal = document.getElementById('total-moderators');
    const elActive = document.getElementById('stat-active-staffers');
    const elFormer = document.getElementById('stat-former-staffers');
    const elIssued = document.getElementById('stat-total-issued');

    if (elTotal) elTotal.innerText = totalStaffers;
    if (elActive) elActive.innerText = activeStaffers;
    if (elFormer) elFormer.innerText = formerStaffers;
    if (elIssued) elIssued.innerText = totalIssued;
}

async function renderStaffers() {
    const grid = document.getElementById('moderators-grid');
    const emptyState = document.getElementById('staffers-empty-state');
    if (!grid) return;

    computeStafferStats();

    const searchQuery = (document.getElementById('staffer-search-input')?.value || '').toLowerCase().trim();
    const statusFilter = (document.getElementById('filter-staff-status')?.value || 'ALL').toUpperCase();
    const sortBy = document.getElementById('staffer-sort-select')?.value || 'MOST_ACTIONS';

    let filtered = staffersCache.filter(s => {
        const matchName = s.name.toLowerCase().includes(searchQuery);
        const matchDiscord = (s.discordId || '').includes(searchQuery);
        const matchSearch = matchName || matchDiscord;

        let matchStatus = true;
        if (statusFilter === 'ACTIVE') {
            matchStatus = !s.isFormer;
        } else if (statusFilter === 'FORMER') {
            matchStatus = Boolean(s.isFormer);
        }

        return matchSearch && matchStatus;
    });

    filtered.sort((a, b) => {
        if (sortBy === 'MOST_ACTIONS') return b.issuedCount - a.issuedCount || b.assistedCount - a.assistedCount;
        if (sortBy === 'MOST_ASSISTED') return b.assistedCount - a.assistedCount || b.issuedCount - a.issuedCount;
        if (sortBy === 'AZ') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        if (sortBy === 'ZA') return b.name.localeCompare(a.name, undefined, { sensitivity: 'base' });
        if (sortBy === 'LINKED') return (b.discordId ? 1 : 0) - (a.discordId ? 1 : 0) || b.issuedCount - a.issuedCount;
        return 0;
    });

    if (!filtered.length) {
        grid.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const localProfiles = getLocalProfileCache();

    grid.innerHTML = filtered.map(m => {
        const safeName = escapeHtml(m.name);
        const cached = m.discordId ? localProfiles[m.discordId] : null;
        const banner = m.bannerUrl || cached?.bannerUrl;
        const avatar = m.avatarUrl || cached?.url;

        const bannerStyle = banner ? `style="background-image: url('${banner}');"` : '';
        const avatarStyle = avatar ? `style="background-image: url('${avatar}');"` : '';
        const avatarLetter = avatar ? '' : safeName.charAt(0).toUpperCase();

        const discordBadgeHtml = m.discordId
            ? `<span class="staffer-discord-badge"><i data-lucide="hash" style="width: 12px; height: 12px;"></i> ${escapeHtml(m.discordId)}</span>`
            : `<span style="font-size: 11px; color: #64748b; font-style: italic;">No Discord linked</span>`;

        const isFormer = Boolean(m.isFormer);
        const roleTagHtml = isFormer
            ? `<span class="staffer-role-tag tag-former"><i data-lucide="user-minus" style="width: 11px; height: 11px;"></i> Former Staffer</span>`
            : `<span class="staffer-role-tag tag-active"><i data-lucide="shield-check" style="width: 11px; height: 11px;"></i> Active Staffer</span>`;

        return `
            <div class="staffer-card-v2 ${isFormer ? 'is-former' : ''}" data-name="${safeName}" id="mod-card-${safeName}">
                <div class="staffer-card-banner" ${bannerStyle}></div>
                <div class="staffer-card-body">
                    <div class="staffer-avatar-anchor">
                        <div class="staffer-avatar-ring" id="mod-avatar-${safeName}" ${avatarStyle}>${avatarLetter}</div>
                        ${discordBadgeHtml}
                    </div>

                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px;">
                        <div class="staffer-name-head" title="${safeName}">${safeName}</div>
                        ${roleTagHtml}
                    </div>
                    <div class="staffer-discord-subtext">${m.discordId ? 'Registered Staff Member' : 'Unlinked Staff Member'}</div>

                    <div class="staffer-stats-row">
                        <div class="staffer-stat-item">
                            <span class="staffer-stat-val">${m.issuedCount || 0}</span>
                            <span class="staffer-stat-lbl">Sanctions</span>
                        </div>
                        <div class="staffer-stat-item">
                            <span class="staffer-stat-val">${m.assistedCount || 0}</span>
                            <span class="staffer-stat-lbl">Assisted</span>
                        </div>
                    </div>

                    <div class="staffer-card-actions">
                        <button type="button" class="btn-staff-link" onclick="openStaffEditModal('${safeName}')">
                            <i data-lucide="user-cog" style="width: 14px; height: 14px;"></i>
                            Edit Staffer
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }

    // Background asynchronous fetch for all Discord profiles simultaneously
    const discordStaffers = filtered.filter(s => s.discordId);
    if (discordStaffers.length > 0) {
        (async () => {
            const allIds = discordStaffers.map(s => s.discordId);
            try {
                const freshProfiles = await ModAPI.getDiscordAvatars(allIds);
                if (freshProfiles && typeof freshProfiles === 'object') {
                    const updatedCache = { ...getLocalProfileCache(), ...freshProfiles };
                    saveLocalProfileCache(updatedCache);

                    let dbNeedsUpdate = false;
                    discordStaffers.forEach(staffer => {
                        if (staffer.discordId && freshProfiles[staffer.discordId]) {
                            const p = freshProfiles[staffer.discordId];
                            applyStafferProfile(staffer.name, p);
                            if (staffer.avatarUrl !== p.url || staffer.bannerUrl !== (p.bannerUrl || null)) {
                                staffer.avatarUrl = p.url || null;
                                staffer.bannerUrl = p.bannerUrl || null;
                                dbNeedsUpdate = true;
                            }
                        }
                    });
                    if (dbNeedsUpdate) {
                        ModAPI.saveModerators(staffersCache).catch(() => {});
                    }
                }
            } catch (err) {
                console.warn('Background Discord profile fetch failed:', err);
            }
        })();
    }
}

function setModEditStatus(isFormer) {
    const inputHidden = document.getElementById('mod-edit-is-former');
    const btnActive = document.getElementById('btn-status-active');
    const btnFormer = document.getElementById('btn-status-former');

    if (inputHidden) inputHidden.value = isFormer ? '1' : '0';
    if (btnActive) btnActive.classList.toggle('active', !isFormer);
    if (btnFormer) btnFormer.classList.toggle('active', Boolean(isFormer));
}

window.setModEditStatus = setModEditStatus;

async function initStaffers() {
    // 1. Fetch actions and stored staffers
    const [actions, stored] = await Promise.all([
        ModAPI.getActions(),
        ModAPI.getModerators()
    ]);
    allActionsCache = actions || [];

    const detected = [...new Set(
        allActionsCache.filter(a => ['WARN', 'BAN', 'LAST_CHANCE'].includes(a.type))
            .map(a => a.moderator).filter(name => name && name.toLocaleLowerCase() !== 'unknow')
    )];

    const map = new Map((stored || []).map(m => [m.name.toLowerCase(), m]));
    let changed = false;

    detected.forEach(name => {
        if (!map.has(name.toLowerCase())) {
            map.set(name.toLowerCase(), { name, discordId: null, avatarUrl: null, bannerUrl: null, isFormer: 0 });
            changed = true;
        }
    });

    staffersCache = [...map.values()];
    if (changed) {
        ModAPI.saveModerators(staffersCache).catch(() => {});
    }

    // Setup status filter pills
    const pillContainer = document.getElementById('staffer-status-pills');
    const statusHidden = document.getElementById('filter-staff-status');
    if (pillContainer) {
        pillContainer.querySelectorAll('.filter-pill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                pillContainer.querySelectorAll('.filter-pill-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (statusHidden) statusHidden.value = btn.dataset.status;
                renderStaffers();
            });
        });
    }

    // Setup search & sort events
    const searchInput = document.getElementById('staffer-search-input');
    const clearBtn = document.getElementById('staffer-search-clear');
    const sortSelect = document.getElementById('staffer-sort-select');

    let staffSearchTimer = null;
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            if (clearBtn) clearBtn.style.display = searchInput.value ? 'block' : 'none';
            clearTimeout(staffSearchTimer);
            staffSearchTimer = setTimeout(renderStaffers, 80);
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            clearBtn.style.display = 'none';
            renderStaffers();
            searchInput.focus();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', renderStaffers);
    }

    // Render immediately!
    await renderStaffers();
}

window.openStaffEditModal = (name) => {
    const staffer = staffersCache.find(m => m.name.toLowerCase() === String(name || '').toLowerCase());
    const nameEl = document.getElementById('mod-edit-name');
    const inputEl = document.getElementById('mod-edit-discord-input');
    const modalEl = document.getElementById('mod-edit-modal');
    if (nameEl) nameEl.innerText = staffer ? staffer.name : name;
    if (inputEl) inputEl.value = staffer?.discordId || '';

    setModEditStatus(Boolean(staffer?.isFormer));

    if (modalEl) {
        modalEl.dataset.name = staffer ? staffer.name : name;
        modalEl.style.display = 'flex';
    }
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    inputEl?.focus();
};

window.closeStaffEditModal = () => {
    const modalEl = document.getElementById('mod-edit-modal');
    if (modalEl) modalEl.style.display = 'none';
};

// Aliases for compatibility
window.openModEditModal = window.openStaffEditModal;
window.closeModEditModal = window.closeStaffEditModal;

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('mod-edit-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const modalEl = document.getElementById('mod-edit-modal');
            const name = modalEl?.dataset.name;
            const inputEl = document.getElementById('mod-edit-discord-input');
            const discordId = inputEl ? inputEl.value.trim() : '';
            const isFormer = document.getElementById('mod-edit-is-former')?.value === '1' ? 1 : 0;

            const idx = staffersCache.findIndex(m => m.name.toLowerCase() === String(name || '').toLowerCase());
            if (idx > -1) {
                let avatarUrl = staffersCache[idx].avatarUrl;
                let bannerUrl = staffersCache[idx].bannerUrl;
                if (discordId && discordId !== staffersCache[idx].discordId) {
                    try {
                        const profile = await ModAPI.getDiscordAvatar(discordId);
                        if (profile) {
                            avatarUrl = profile.url || null;
                            bannerUrl = profile.bannerUrl || null;
                        }
                    } catch {}
                } else if (!discordId) {
                    avatarUrl = null;
                    bannerUrl = null;
                }

                staffersCache[idx] = {
                    ...staffersCache[idx],
                    discordId: discordId || null,
                    avatarUrl,
                    bannerUrl,
                    isFormer
                };
            }
            await ModAPI.saveModerators(staffersCache);
            closeStaffEditModal();
            showToast('Staff profile updated successfully.');
            await renderStaffers();
        });
    }

    initStaffers();
});

