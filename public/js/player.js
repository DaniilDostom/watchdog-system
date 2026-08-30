const urlParams = new URLSearchParams(window.location.search);
const playerId = urlParams.get('id');
let currentPlayer = null;
let editingActionId = null;
let removingActionId = null;
let currentLastChanceBanId = null;
let editingLastChanceId = null;
let removingPermanentBanId = null;
let removingWarningId = null;
const PLAYERS_VIEWED_KEY = 'playersLastViewed';
const PLAYER_PREFETCH_KEY = 'playerPrefetch';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function getActivePermanentBan(actions, targetPlayerId = playerId) {
    const removals = actions.filter(action => action.permanentBanRemoval);
    return actions
        .filter(action => action.playerId === targetPlayerId && action.type === 'BAN' && action.permanent)
        .filter(action => !removals.some(removal => removal.removedFromActionId === action.id))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] || null;
}

function getActivePlayerBans(actions, targetPlayerId = playerId) {
    const removals = actions.filter(action => action.permanentBanRemoval);
    return actions.filter(action => action.playerId === targetPlayerId && action.type === 'BAN' && isActionActive(action))
        .filter(action => !removals.some(removal => removal.removedFromActionId === action.id));
}

function getPrefetchedPlayerData() {
    try {
        const prefetch = JSON.parse(sessionStorage.getItem(PLAYER_PREFETCH_KEY) || 'null');
        if (prefetch?.playerId === playerId && Date.now() - prefetch.createdAt < 30000) {
            sessionStorage.removeItem(PLAYER_PREFETCH_KEY);
            return prefetch;
        }
    } catch (error) {
        return null;
    }
    return null;
}

function markPlayerAsViewed() {
    try {
        const viewedPlayers = JSON.parse(sessionStorage.getItem(PLAYERS_VIEWED_KEY) || '{}');
        viewedPlayers[playerId] = Date.now();
        sessionStorage.setItem(PLAYERS_VIEWED_KEY, JSON.stringify(viewedPlayers));
    } catch (error) {
        // Session storage may be unavailable in restricted browser contexts.
    }
}

function toDateTimeLocalValue(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

async function initPlayerProfile() {
    if(!playerId) return location.href = 'players.html';
    markPlayerAsViewed();
    
    const prefetchedData = getPrefetchedPlayerData();
    let players = prefetchedData?.players || await ModAPI.getPlayers();
    currentPlayer = players.find(p => p.id === playerId);
    
    // If not found in prefetch, try a fresh direct fetch from API
    if (!currentPlayer && prefetchedData?.players) {
        players = await ModAPI.getPlayers();
        currentPlayer = players.find(p => p.id === playerId);
    }
    
    if(!currentPlayer) {
        console.warn('Player not found in database:', playerId);
        const usernameEl = document.getElementById('player-username');
        if (usernameEl) usernameEl.innerText = 'Player not found';
        const mainContent = document.querySelector('main.main-content');
        if (mainContent) mainContent.style.visibility = 'visible';
        return;
    }

    const allActions = prefetchedData?.actions || await ModAPI.getActions();
    const playerActions = allActions
        .filter(a => a.playerId === playerId)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    const warns = playerActions.filter(a => a.type === 'WARN' && !a.warningRemoval);
    const warningHistory = playerActions
        .filter(a => a.type === 'WARN' || a.warningRemoval)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const bans = playerActions.filter(a => a.type === 'BAN');
    const lastChanceActions = playerActions.filter(a => isLastChanceGrant(a) || a.lastChanceRemoval || a.lastChanceLifted ||
        (a.type === 'BAN' && a.lastChance && !a.permanent));
    const activeWarns = warns.filter(w => isWarningActive(w, playerActions));
    const permanentBanRemovals = playerActions.filter(a => a.permanentBanRemoval);
    const activeBans = bans.filter(a => isActionActive(a) && !permanentBanRemovals.some(removal =>
        removal.removedFromActionId === a.id || new Date(removal.timestamp).getTime() >= new Date(a.timestamp).getTime()));
    const activePermanentBan = getActivePermanentBan(playerActions);
    removingPermanentBanId = activePermanentBan ? activePermanentBan.id : null;
    const lastChanceBan = getActiveLastChanceBan(playerActions);
    currentLastChanceBanId = lastChanceBan ? lastChanceBan.id : null;

    const breadcrumbName = document.getElementById('bc-name');
    breadcrumbName.innerText = currentPlayer.username;
    breadcrumbName.href = `player.html?id=${encodeURIComponent(currentPlayer.id)}`;
    document.getElementById('player-username').innerText = currentPlayer.username;
    document.getElementById('player-discord').innerText = currentPlayer.discordId;
    const licenseEl = document.getElementById('player-license');
    if (licenseEl) {
        if (currentPlayer.fivemLicense) {
            licenseEl.innerText = currentPlayer.fivemLicense;
            licenseEl.style.color = '';
        } else {
            licenseEl.innerText = '—';
            licenseEl.style.color = '#64748b';
        }
    }

    try {
        localStorage.setItem('last_active_player', JSON.stringify({ id: currentPlayer.id, username: currentPlayer.username }));
        sessionStorage.setItem('last_active_player', JSON.stringify({ id: currentPlayer.id, username: currentPlayer.username }));
        if (typeof window.initSidebarActivePlayer === 'function') window.initSidebarActivePlayer();
    } catch {}
    const avatarElement = document.getElementById('player-avatar');
    const fallbackAvatar = currentPlayer.username.charAt(0).toUpperCase();
    avatarElement.style.backgroundImage = 'none';
    try {
        const avatar = prefetchedData?.avatar || await ModAPI.getDiscordAvatar(currentPlayer.discordId);
        if (avatar?.bannerUrl) {
            const profileCard = document.querySelector('.profile-card');
            if (profileCard) {
                profileCard.style.backgroundImage = `linear-gradient(rgba(15, 23, 42, 0.78), rgba(15, 23, 42, 0.88)), url("${avatar.bannerUrl}")`;
            }
        }
        if (avatar?.url && !avatar.isDefault) {
            avatarElement.textContent = '';
            avatarElement.style.backgroundImage = `url("${avatar.url}")`;
            avatarElement.style.backgroundSize = 'cover';
            avatarElement.style.backgroundPosition = 'center';
            avatarElement.style.visibility = 'visible';
        } else {
            avatarElement.textContent = fallbackAvatar;
            avatarElement.style.color = 'var(--text-primary)';
            avatarElement.style.visibility = 'visible';
        }
    } catch (error) {
        avatarElement.textContent = fallbackAvatar;
        avatarElement.style.color = 'var(--text-primary)';
        avatarElement.style.visibility = 'visible';
    }
    document.getElementById('player-date').innerText = new Date(currentPlayer.createdAt).toLocaleDateString();
    
    document.getElementById('stat-warns').innerText = activeWarns.length;
    document.getElementById('stat-bans').innerText = bans.filter(b => !b.removed && !b.permanentBanRemoval).length;

    // Determine derived status from actual actions
    let derivedStatus;
    if (activePermanentBan) derivedStatus = 'Permanently Banned';
    else if (activeBans.length > 0) derivedStatus = 'Banned';
    else if (lastChanceBan) derivedStatus = 'Last Chance';
    else if (activeWarns.length > 0) derivedStatus = 'Warned';
    else derivedStatus = 'Clean';

    currentPlayer.status = derivedStatus;

    // 1. Status badge in header
    const statusBadge = document.getElementById('player-status-badge');
    if (statusBadge) {
        if (derivedStatus === 'Permanently Banned') {
            statusBadge.className = 'player-status-badge badge-permaban';
            statusBadge.innerHTML = '<i data-lucide="flame" style="width: 13px; height: 13px;"></i> PERMABANNED';
        } else if (derivedStatus === 'Banned') {
            statusBadge.className = 'player-status-badge badge-ban';
            statusBadge.innerHTML = '<i data-lucide="ban" style="width: 13px; height: 13px;"></i> BANNED';
        } else if (derivedStatus === 'Last Chance') {
            statusBadge.className = 'player-status-badge badge-lastchance';
            statusBadge.innerHTML = '<i data-lucide="alert-octagon" style="width: 13px; height: 13px;"></i> LAST CHANCE';
        } else if (derivedStatus === 'Warned') {
            statusBadge.className = 'player-status-badge badge-warn';
            statusBadge.innerHTML = '<i data-lucide="alert-triangle" style="width: 13px; height: 13px;"></i> WARNED';
        } else {
            statusBadge.className = 'player-status-badge badge-clean';
            statusBadge.innerHTML = '<i data-lucide="shield-check" style="width: 13px; height: 13px;"></i> CLEAN';
        }
    }

    // Avatar glow ring
    if (avatarElement) {
        avatarElement.className = 'avatar ring-' + (
            derivedStatus === 'Permanently Banned' ? 'permaban' :
            derivedStatus === 'Banned' ? 'ban' :
            derivedStatus === 'Last Chance' ? 'lastchance' :
            derivedStatus === 'Warned' ? 'warn' : 'clean'
        );
    }

    // 2. Build the Active Sanctions Hub (Strict Hierarchy: 1. Permaban / Ban, 2. Last Chance, 3. Warn)
    const sanctionsHub = document.getElementById('active-sanctions-hub');
    const sanctionCards = [];

    // HIERARCHY 1: Permaban or Temporary Ban
    if (activePermanentBan) {
        sanctionCards.push(`
            <div class="sanction-card-item item-permaban">
                <div class="sanction-info-left">
                    <div class="sanction-icon-box"><i data-lucide="flame"></i></div>
                    <div class="sanction-text-wrap">
                        <h3>PERMANENT BAN ACTIVE</h3>
                        <p><strong>Reason:</strong> ${escapeHtml(getActionReasonText(activePermanentBan))} &bull; <strong>Issued by:</strong> ${escapeHtml(activePermanentBan.moderator || 'Staff')}</p>
                    </div>
                </div>
                <button type="button" class="btn-remove-sanction btn-remove-permaban" onclick="openRemovePermanentBanModal()">
                    <i data-lucide="unlock" style="width: 14px; height: 14px;"></i> Revoke Permanent Ban
                </button>
            </div>
        `);
    } else if (activeBans.length > 0) {
        const primaryBan = activeBans[0];
        const isWeapon = primaryBan.banCategory === 'weapon';
        sanctionCards.push(`
            <div class="sanction-card-item item-ban">
                <div class="sanction-info-left">
                    <div class="sanction-icon-box"><i data-lucide="clock"></i></div>
                    <div class="sanction-text-wrap">
                        <h3>${isWeapon ? 'WEAPON BAN ACTIVE' : 'TRADITIONAL BAN ACTIVE'}</h3>
                        <p><strong>Duration:</strong> ${escapeHtml(primaryBan.duration || '')} ${escapeHtml(primaryBan.durationUnit || 'Days')} &bull; <strong>Reason:</strong> ${escapeHtml(getActionReasonText(primaryBan))} &bull; <strong>Issued by:</strong> ${escapeHtml(primaryBan.moderator || 'Staff')}</p>
                    </div>
                </div>
                <button type="button" class="btn-remove-sanction btn-remove-permaban" onclick="openRemoveModal('${primaryBan.id}')">
                    <i data-lucide="shield-check" style="width: 14px; height: 14px;"></i> Remove Ban
                </button>
            </div>
        `);
    }

    // HIERARCHY 2: Last Chance
    if (lastChanceBan) {
        sanctionCards.push(`
            <div class="sanction-card-item item-lastchance">
                <div class="sanction-info-left">
                    <div class="sanction-icon-box"><i data-lucide="alert-octagon"></i></div>
                    <div class="sanction-text-wrap">
                        <h3>LAST CHANCE ACTIVE</h3>
                        <p><strong>Reason:</strong> ${escapeHtml(getActionReasonText(lastChanceBan))} &bull; <strong>Issued by:</strong> ${escapeHtml(lastChanceBan.moderator || 'Staff')}</p>
                    </div>
                </div>
                <button type="button" class="btn-remove-sanction btn-remove-lastchance" onclick="openLiftLastChanceModal()">
                    <i data-lucide="rotate-ccw" style="width: 14px; height: 14px;"></i> Remove Last Chance
                </button>
            </div>
        `);
    }

    // HIERARCHY 3: Warns
    if (activeWarns.length > 0) {
        const latestWarn = activeWarns[0];
        sanctionCards.push(`
            <div class="sanction-card-item item-warn">
                <div class="sanction-info-left">
                    <div class="sanction-icon-box"><i data-lucide="alert-triangle"></i></div>
                    <div class="sanction-text-wrap">
                        <h3>${activeWarns.length} ACTIVE WARNING${activeWarns.length > 1 ? 'S' : ''}</h3>
                        <p><strong>Reason:</strong> ${escapeHtml(getActionReasonText(latestWarn))} &bull; <strong>Issued by:</strong> ${escapeHtml(latestWarn.moderator || 'Staff')}</p>
                    </div>
                </div>
                <button type="button" class="btn-remove-sanction btn-remove-warn" onclick="openRemoveWarningModal()">
                    <i data-lucide="shield-check" style="width: 14px; height: 14px;"></i> Remove Warning
                </button>
            </div>
        `);
    }

    // If completely clean
    if (sanctionCards.length === 0) {
        sanctionCards.push(`
            <div class="sanction-card-item item-clean">
                <div class="sanction-info-left">
                    <div class="sanction-icon-box"><i data-lucide="shield-check"></i></div>
                    <div class="sanction-text-wrap">
                        <h3>PLAYER IN GOOD STANDING</h3>
                        <p>No active sanctions, warnings, or restrictions are currently applied to this player.</p>
                    </div>
                </div>
            </div>
        `);
    }

    if (sanctionsHub) {
        sanctionsHub.innerHTML = sanctionCards.join('');
    }

    // 1. Ban Player Button State (grayed out if already permanently banned)
    const btnBan = document.querySelector('.btn-act-ban');
    if (btnBan) {
        btnBan.style.display = 'inline-flex';
        if (activePermanentBan) {
            btnBan.classList.add('disabled');
            btnBan.style.pointerEvents = 'none';
            btnBan.title = 'Player is already Permanently Banned';
        } else {
            btnBan.classList.remove('disabled');
            btnBan.style.pointerEvents = '';
            btnBan.title = '';
        }
    }

    // 2. Apply Last Chance Button State (grayed out if already active, instead of disappearing)
    const applyLastChanceButton = document.getElementById('btn-apply-last-chance');
    if (applyLastChanceButton) {
        applyLastChanceButton.style.display = 'inline-flex';
        if (lastChanceBan || hasActiveLastChance(playerActions)) {
            applyLastChanceButton.classList.add('disabled');
            applyLastChanceButton.style.pointerEvents = 'none';
            applyLastChanceButton.title = 'Player already has an active Last Chance';
        } else {
            applyLastChanceButton.classList.remove('disabled');
            applyLastChanceButton.style.pointerEvents = '';
            applyLastChanceButton.title = '';
        }
    }

    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }

    switchTab(getPersistedTab());

    // Update Tab Counts
    const tabCountWarns = document.getElementById('tab-count-warns');
    if (tabCountWarns) tabCountWarns.innerText = warningHistory.length;
    const tabCountBans = document.getElementById('tab-count-bans');
    if (tabCountBans) tabCountBans.innerText = bans.length;
    const tabCountLastChance = document.getElementById('tab-count-lastchance');
    if (tabCountLastChance) tabCountLastChance.innerText = lastChanceActions.length;

    // Render Warns Table
    if (warningHistory.length === 0) {
        document.getElementById('tbody-warns').innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="table-empty-state">
                        <i data-lucide="shield-check" style="color: #10b981;"></i>
                        <h4>No Warning Records</h4>
                        <p>This player has never received any warning strikes.</p>
                    </div>
                </td>
            </tr>
        `;
    } else {
        document.getElementById('tbody-warns').innerHTML = warningHistory.map(w => {
            const isWarningRemoval = Boolean(w.warningRemoval);
            const warningIsActive = !isWarningRemoval && isWarningActive(w, playerActions);
            const slotText = isWarningRemoval ? '-' : (Array.isArray(w.warningNumbers) ? w.warningNumbers.map(n => `Warn #${n}`).join(', ') : (w.warningNumber ? `Warn #${w.warningNumber}` : '-'));
            const wOtherMods = Array.isArray(w.otherModerators) && w.otherModerators.length ? w.otherModerators : (Array.isArray(w.otherStaffers) && w.otherStaffers.length ? w.otherStaffers : []);
            const wOtherBadge = wOtherMods.length ? `<span class="staff-others-pill" onclick="event.stopPropagation(); showStaffTeamModal('${escapeHtml(w.moderator || 'Staff')}', ${escapeHtml(JSON.stringify(wOtherMods))})" title="Click to view staff team"><i data-lucide="users" style="width: 10px; height: 10px;"></i> +${wOtherMods.length}</span>` : '';

            return `
            <tr>
                <td style="color: #94a3b8; font-size: 12px; white-space: nowrap;">${new Date(w.timestamp).toLocaleString()}</td>
                <td><span class="badge-status-pill ${isWarningRemoval ? 'unbanned' : 'warn'}"><i data-lucide="${isWarningRemoval ? 'check-circle' : 'alert-triangle'}" style="width: 12px; height: 12px;"></i> ${isWarningRemoval ? 'REMOVED' : 'APPLIED'}</span></td>
                <td><span style="font-weight: 700; color: #fbbf24; font-size: 12px;">${slotText}</span></td>
                <td style="font-weight: 500;">
                    ${escapeHtml(getActionReasonText(w))}
                    ${Array.isArray(w.recidiveReasons) && w.recidiveReasons.length ? `<span style="display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(251,146,60,0.15);border:1px solid #fb923c;color:#fb923c;vertical-align:middle;">⟳ RECIDIVIST</span>` : ''}
                </td>
                <td>
                    <div style="display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                        <span class="feed-staff-tag"><i data-lucide="user" style="width: 12px; height: 12px;"></i> ${escapeHtml(w.moderator || 'Staff')}</span>
                        ${wOtherBadge}
                    </div>
                </td>
                <td style="color: #94a3b8; font-size: 12px;">${escapeHtml(w.note || '-')}${w.removed ? `<br><span style="color: #10b981; font-size: 11px;">Removed by ${escapeHtml(w.removedBy || '-')} &middot; ${escapeHtml(w.removedReason || 'Buona Condotta')}</span>` : ''}</td>
                <td>
                    <div class="tbl-actions-cell">
                        ${isWarningRemoval
                            ? `<button type="button" class="btn-tbl-action btn-tbl-delete" onclick="deleteAction('${w.id}')"><i data-lucide="trash-2"></i> Delete</button>`
                            : `<button type="button" class="btn-tbl-action btn-tbl-edit" onclick="editAction('${w.id}')"><i data-lucide="edit-2"></i> Edit</button>
                               ${warningIsActive ? `<button type="button" class="btn-tbl-action btn-tbl-remove" onclick="openRemoveWarningModal('${w.id}')"><i data-lucide="shield-check"></i> Remove</button>` : ''}
                               <button type="button" class="btn-tbl-action btn-tbl-delete" onclick="deleteAction('${w.id}')"><i data-lucide="trash-2"></i> Delete</button>`
                        }
                    </div>
                </td>
            </tr>
            `;
        }).join('');
    }

    // Render Bans Table
    if (bans.length === 0) {
        document.getElementById('tbody-bans').innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="table-empty-state">
                        <i data-lucide="shield-check" style="color: #10b981;"></i>
                        <h4>No Ban Records</h4>
                        <p>This player has never been banned from the server.</p>
                    </div>
                </td>
            </tr>
        `;
    } else {
        document.getElementById('tbody-bans').innerHTML = bans.map(b => {
            const catText = b.banCategory === 'weapon' ? 'Weapon Ban' : 'Traditional Ban';
            const statusPillClass = b.permanentBanRemoval ? 'unbanned' : b.permanent ? 'permaban' : 'temporary';
            const statusPillText = b.permanentBanRemoval ? 'UNBANNED' : b.permanent ? 'PERMANENT' : 'TEMPORARY';
            const statusIcon = b.permanentBanRemoval ? 'unlock' : b.permanent ? 'flame' : 'clock';
            const durationText = b.permanentBanRemoval ? 'Forever' : (b.permanent ? 'Forever' : (b.duration ? `${b.duration} ${b.durationUnit || 'Days'}` : '-'));
            const bOtherMods = Array.isArray(b.otherModerators) && b.otherModerators.length ? b.otherModerators : (Array.isArray(b.otherStaffers) && b.otherStaffers.length ? b.otherStaffers : []);
            const bOtherBadge = bOtherMods.length ? `<span class="staff-others-pill" onclick="event.stopPropagation(); showStaffTeamModal('${escapeHtml(b.moderator || 'Staff')}', ${escapeHtml(JSON.stringify(bOtherMods))})" title="Click to view staff team"><i data-lucide="users" style="width: 10px; height: 10px;"></i> +${bOtherMods.length}</span>` : '';

            return `
            <tr>
                <td style="color: #94a3b8; font-size: 12px; white-space: nowrap;">${new Date(b.timestamp).toLocaleString()}</td>
                <td><span class="badge-status-pill ${statusPillClass}"><i data-lucide="${statusIcon}" style="width: 12px; height: 12px;"></i> ${statusPillText}</span></td>
                <td><span class="badge-category-pill">${b.permanentBanRemoval ? 'Unbanned' : catText}</span></td>
                <td style="font-weight: 500;">
                    ${escapeHtml(getActionReasonText(b))}
                    ${Array.isArray(b.recidiveReasons) && b.recidiveReasons.length ? `<span style="display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(251,146,60,0.15);border:1px solid #fb923c;color:#fb923c;vertical-align:middle;">⟳ RECIDIVIST</span>` : ''}
                </td>
                <td style="color: #cbd5e1; font-weight: 600; font-size: 12px;">${durationText}</td>
                <td>
                    <div style="display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                        <span class="feed-staff-tag"><i data-lucide="user" style="width: 12px; height: 12px;"></i> ${escapeHtml(b.moderator || 'Staff')}</span>
                        ${bOtherBadge}
                    </div>
                </td>
                <td style="color: #94a3b8; font-size: 12px;">${escapeHtml(b.note || '-')}${b.removed ? `<br><span style="color: #10b981; font-size: 11px;">Removed by ${escapeHtml(b.removedBy || '-')} &middot; ${escapeHtml(b.removedReason || 'Buona Condotta')}</span>` : ''}</td>
                <td>
                    <div class="tbl-actions-cell">
                        ${b.removed
                            ? `<span style="color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 600;">Removed</span>`
                            : `<button type="button" class="btn-tbl-action btn-tbl-edit" onclick="editAction('${b.id}')"><i data-lucide="edit-2"></i> Edit</button>
                               <button type="button" class="btn-tbl-action btn-tbl-remove" onclick="openRemoveModal('${b.id}')"><i data-lucide="shield-check"></i> Remove</button>`
                        }
                        <button type="button" class="btn-tbl-action btn-tbl-delete" onclick="deleteAction('${b.id}')"><i data-lucide="trash-2"></i> Delete</button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');
    }

    // Render Last Chance Table
    if (lastChanceActions.length === 0) {
        document.getElementById('tbody-last-chance').innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="table-empty-state">
                        <i data-lucide="shield-check" style="color: #10b981;"></i>
                        <h4>No Last Chance Records</h4>
                        <p>This player has not received probation actions.</p>
                    </div>
                </td>
            </tr>
        `;
    } else {
        document.getElementById('tbody-last-chance').innerHTML = lastChanceActions.map(action => {
            const isLifted = Boolean(action.lastChanceRemoval || action.lastChanceLifted);
            const lcOtherMods = Array.isArray(action.otherModerators) && action.otherModerators.length ? action.otherModerators : (Array.isArray(action.otherStaffers) && action.otherStaffers.length ? action.otherStaffers : []);
            const lcOtherBadge = lcOtherMods.length ? `<span class="staff-others-pill" onclick="event.stopPropagation(); showStaffTeamModal('${escapeHtml(action.moderator || 'Staff')}', ${escapeHtml(JSON.stringify(lcOtherMods))})" title="Click to view staff team"><i data-lucide="users" style="width: 10px; height: 10px;"></i> +${lcOtherMods.length}</span>` : '';

            return `
            <tr>
                <td style="color: #94a3b8; font-size: 12px; white-space: nowrap;">${new Date(action.timestamp).toLocaleString()}</td>
                <td><span class="badge-status-pill ${isLifted ? 'unbanned' : 'lastchance'}"><i data-lucide="${isLifted ? 'rotate-ccw' : 'alert-octagon'}" style="width: 12px; height: 12px;"></i> ${isLifted ? 'REMOVED' : 'APPLIED'}</span></td>
                <td style="font-weight: 500;">${escapeHtml(getActionReasonText(action))}</td>
                <td>
                    <div style="display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                        <span class="feed-staff-tag"><i data-lucide="user" style="width: 12px; height: 12px;"></i> ${escapeHtml(action.moderator || 'Staff')}</span>
                        ${lcOtherBadge}
                    </div>
                </td>
                <td style="color: #94a3b8; font-size: 12px;">${escapeHtml(action.note || '-')}</td>
                <td>
                    <div class="tbl-actions-cell">
                        <button type="button" class="btn-tbl-action btn-tbl-edit" onclick="${action.type === 'BAN' ? `editAction('${action.id}')` : `editLastChance('${action.id}')`}"><i data-lucide="edit-2"></i> Edit</button>
                        <button type="button" class="btn-tbl-action btn-tbl-delete" onclick="deleteAction('${action.id}')"><i data-lucide="trash-2"></i> Delete</button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');
    }

    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }

    // Restore preserved active tab
    switchTab(getPersistedTab());

    document.querySelector('main.main-content').style.visibility = 'visible';
}

function getPersistedTab() {
    const urlTab = new URLSearchParams(window.location.search).get('tab');
    if (urlTab && ['history-warn', 'history-ban', 'history-last-chance'].includes(urlTab)) return urlTab;
    const hash = window.location.hash.replace(/^#/, '');
    if (hash && ['history-warn', 'history-ban', 'history-last-chance'].includes(hash)) return hash;
    try {
        if (playerId) {
            const local = localStorage.getItem('active_player_tab_' + playerId);
            if (local && ['history-warn', 'history-ban', 'history-last-chance'].includes(local)) return local;
            const session = sessionStorage.getItem('active_player_tab_' + playerId);
            if (session && ['history-warn', 'history-ban', 'history-last-chance'].includes(session)) return session;
        }
        const globalLocal = localStorage.getItem('active_player_tab_global');
        if (globalLocal && ['history-warn', 'history-ban', 'history-last-chance'].includes(globalLocal)) return globalLocal;
        const globalSession = sessionStorage.getItem('active_player_tab_global');
        if (globalSession && ['history-warn', 'history-ban', 'history-last-chance'].includes(globalSession)) return globalSession;
    } catch {}
    return window.currentActiveTab || 'history-warn';
}

function switchTab(tabId) {
    if (!tabId) return;
    const tabButtons = [...document.querySelectorAll('.tab')];
    const tabContents = [...document.querySelectorAll('.tab-content')];
    const deleteWarningsButton = document.getElementById('delete-warnings-button');
    const deleteBansButton = document.getElementById('delete-bans-button');
    const deleteLastChanceButton = document.getElementById('delete-last-chance-button');

    tabButtons.forEach(tab => {
        const isMatch = tab.dataset.tab === tabId || tab.getAttribute('data-tab') === tabId || (tab.getAttribute('onclick') || '').includes(tabId);
        tab.classList.toggle('active', isMatch);
    });
    tabContents.forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });

    if (deleteWarningsButton) deleteWarningsButton.hidden = tabId !== 'history-warn';
    if (deleteBansButton) deleteBansButton.hidden = tabId !== 'history-ban';
    if (deleteLastChanceButton) deleteLastChanceButton.hidden = tabId !== 'history-last-chance';

    window.currentActiveTab = tabId;
    try {
        if (typeof playerId !== 'undefined' && playerId) {
            localStorage.setItem('active_player_tab_' + playerId, tabId);
            sessionStorage.setItem('active_player_tab_' + playerId, tabId);
        }
        localStorage.setItem('active_player_tab_global', tabId);
        sessionStorage.setItem('active_player_tab_global', tabId);
        const newUrl = new URL(window.location.href);
        if (newUrl.searchParams.get('tab') !== tabId) {
            newUrl.searchParams.set('tab', tabId);
            window.history.replaceState(null, '', newUrl.toString());
        }
    } catch {}
}
window.switchTab = switchTab;

window.setBanType = (type) => {
    document.getElementById('ban-type').value = type;
    const isTemp = type === 'TEMPORARY';
    document.querySelectorAll('#ban-type-segmented .seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === type);
    });
    const isBan = document.getElementById('modal-action-type').value === 'BAN';
    document.getElementById('duration-group').style.display = (isBan && isTemp) ? 'block' : 'none';
    
    // Hide and uncheck Last Chance option when Permanent Ban is selected
    const lcGroup = document.getElementById('last-chance-group');
    const lcCheck = document.getElementById('last-chance');
    if (lcGroup) {
        lcGroup.style.display = (isBan && isTemp) ? 'block' : 'none';
    }
    if (!isTemp && lcCheck) {
        lcCheck.checked = false;
    }
    
    syncBanDurationRequirement();
};

window.setBanCategory = (category) => {
    document.getElementById('ban-category').value = category;
    document.querySelectorAll('#ban-category-segmented .seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === category);
    });
};

window.setDurationPreset = (amount, unit) => {
    document.getElementById('ban-duration').value = amount;
    document.getElementById('ban-duration-unit').value = unit;
};

function getOccupiedWarningSlots(targetPlayerId, allActions, excludeActionId = null) {
    const playerActions = (allActions || []).filter(a => a.playerId === targetPlayerId);
    const activeWarnActions = playerActions.filter(a => a.type === 'WARN' && isWarningActive(a, playerActions) && a.id !== excludeActionId);

    const occupied = new Set();
    activeWarnActions.forEach(action => {
        if (Array.isArray(action.warningNumbers) && action.warningNumbers.length) {
            action.warningNumbers.forEach(n => occupied.add(Number(n)));
        } else if (action.warningNumber != null) {
            occupied.add(Number(action.warningNumber));
        } else {
            for (let i = 1; i <= 3; i++) {
                if (!occupied.has(i)) {
                    occupied.add(i);
                    break;
                }
            }
        }
    });
    return occupied;
}

function setupWarningSlots(occupiedSlots, selectedSlots = []) {
    const slotsInfoEl = document.getElementById('warning-slots-info');
    const availableSlots = [1, 2, 3].filter(n => !occupiedSlots.has(n));

    if (slotsInfoEl) {
        if (availableSlots.length === 0) {
            slotsInfoEl.innerHTML = `<span style="color: #ef4444; font-weight: 700;">Max 3/3 active</span>`;
        } else {
            slotsInfoEl.innerHTML = `<span style="color: #94a3b8; font-weight: 500;">${3 - availableSlots.length}/3 active</span>`;
        }
    }

    [1, 2, 3].forEach(num => {
        const isOccupied = occupiedSlots.has(num);
        const check = document.querySelector(`input[name="warning-number"][value="${num}"]`);
        const btn = document.querySelector(`#warning-number-segmented .seg-btn[data-warn="${num}"]`);

        if (check) {
            check.disabled = isOccupied;
            check.checked = !isOccupied && selectedSlots.includes(num);
        }
        if (btn) {
            btn.classList.toggle('occupied', isOccupied);
            btn.classList.toggle('active', !isOccupied && selectedSlots.includes(num));
            btn.title = isOccupied ? `Warn #${num} is already active for this player` : `Select Warn #${num}`;
            btn.style.pointerEvents = isOccupied ? 'none' : 'auto';
        }
    });
}

window.toggleWarnNumber = (warnNum) => {
    const check = document.querySelector(`input[name="warning-number"][value="${warnNum}"]`);
    const btn = document.querySelector(`#warning-number-segmented .seg-btn[data-warn="${warnNum}"]`);
    if (check && !check.disabled) {
        check.checked = !check.checked;
        if (btn) btn.classList.toggle('active', check.checked);
    }
};

async function openActionModal(type) {
    const isBan = type === 'BAN';
    const isWarn = type === 'WARN';

    const allActions = await ModAPI.getActions();
    const playerActions = allActions.filter(a => a.playerId === playerId);
    const activePermBan = getActivePermanentBan(playerActions);
    console.log('[DEBUG-OPEN] playerActions count:', playerActions.length, 'activePermBan:', activePermBan, 'type:', type);
    playerActions.forEach(a => console.log('[DEBUG-OPEN]   action:', a.id, 'type:', a.type, 'permanent:', a.permanent, 'lastChance:', a.lastChance));

    if (isBan && activePermBan) {
        showToast('This player is already permanently banned.', 'warning');
        return;
    }
    console.log('[DEBUG-OPEN] Gate passed, opening modal');

    document.getElementById('modal-action-type').value = type;
    
    const container = document.getElementById('action-modal-container');
    if (container) {
        container.className = 'modal modal-pro modal-anim ' + (isWarn ? 'theme-warn' : isBan ? 'theme-ban' : 'theme-lastchance');
    }
    
    document.getElementById('modal-title').innerText = isWarn ? 'Issue Warning' : 'Ban Player';
    const subtitleEl = document.getElementById('modal-subtitle');
    if (subtitleEl) {
        subtitleEl.innerText = isWarn ? 'Add warning strike to player profile' : 'Restrict player server access and permissions';
    }
    
    const iconEl = document.getElementById('modal-icon-element');
    if (iconEl) {
        iconEl.setAttribute('data-lucide', isWarn ? 'alert-triangle' : 'gavel');
    }
    
    const modalTargetUser = document.getElementById('modal-target-username');
    if (modalTargetUser) modalTargetUser.innerText = currentPlayer?.username || 'Player';
    const modalTargetDisc = document.getElementById('modal-target-discord');
    if (modalTargetDisc) modalTargetDisc.innerText = currentPlayer?.discordId || '-';
    
    const confirmBtn = document.getElementById('btn-confirm-action');
    confirmBtn.innerText = isWarn ? 'Issue Warning' : 'Confirm Ban';
    confirmBtn.style.background = isWarn ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' : 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)';
    confirmBtn.style.boxShadow = isWarn ? '0 4px 14px rgba(217, 119, 6, 0.4)' : '0 4px 14px rgba(220, 38, 38, 0.4)';
    confirmBtn.style.color = 'white';
    
    window.reasonSelection = [];
    window.recidiveSelection = [];
    await populateIssuerSelect();
    window.setSelectedOtherStaffers([]);
    await initOtherStaffersSelector();
    const invGroup = document.getElementById('involved-players-group');
    if (invGroup) invGroup.style.display = 'block';
    window.setSelectedInvolvedPlayers([]);
    await initInvolvedPlayersSelector(playerId);
    populateReasonSelect(type);
    
    document.getElementById('ban-type-group').style.display = isBan ? 'block' : 'none';
    document.getElementById('ban-category-group').style.display = isBan ? 'block' : 'none';
    setBanType('TEMPORARY');
    setBanCategory('traditional');
    
    document.getElementById('warning-number-group').style.display = isWarn ? 'block' : 'none';
    
    const occupiedSlots = getOccupiedWarningSlots(playerId, allActions);
    if (isWarn && occupiedSlots.size >= 3) {
        showToast('This player already has 3 active warnings (Max limit reached).');
    }
    const firstAvailable = [1, 2, 3].find(n => !occupiedSlots.has(n));
    const defaultSelected = firstAvailable ? [firstAvailable] : [];
    setupWarningSlots(occupiedSlots, defaultSelected);
    
    document.getElementById('last-chance-group').style.display = isBan ? 'block' : 'none';
    document.getElementById('last-chance').checked = false;
    document.getElementById('action-date').value = toDateTimeLocalValue();
    
    syncBanDurationRequirement();
    
    document.getElementById('action-modal').style.display = 'flex';
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function closeActionModal() {
    document.getElementById('action-modal').style.display = 'none';
    document.getElementById('action-form').reset();
    editingActionId = null;
    editingLastChanceId = null;
}

async function ensureModeratorDiscordId(name) {
    const moderatorName = String(name || '').trim();
    if (!moderatorName || moderatorName.toLocaleLowerCase() === UNKNOWN_ISSUER.toLocaleLowerCase()) return true;
    const moderators = await ModAPI.getModerators();
    const existing = moderators.find(m => String(m.name).toLocaleLowerCase() === moderatorName.toLocaleLowerCase());
    if (existing) return true;

    const modal = document.getElementById('new-moderator-modal');
    const nameElement = document.getElementById('new-moderator-name');
    const input = document.getElementById('new-moderator-discord-id');
    nameElement.innerText = moderatorName;
    input.value = '';
    modal.style.display = 'flex';

    const discordId = await new Promise(resolve => {
        modal._resolveDiscordId = resolve;
    });
    modal.style.display = 'none';
    if (!discordId) return false;

    await ModAPI.saveModerators([...moderators, { name: moderatorName, discordId }]);
    return true;
}

window.closeNewModeratorModal = () => {
    const modal = document.getElementById('new-moderator-modal');
    modal.style.display = 'none';
    modal._resolveDiscordId?.(null);
    modal._resolveDiscordId = null;
};

document.getElementById('new-moderator-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('new-moderator-discord-id');
    if (!/^\d{17,20}$/.test(input.value.trim())) {
        showToast('Enter a valid Discord ID');
        return;
    }
    const modal = document.getElementById('new-moderator-modal');
    const resolve = modal._resolveDiscordId;
    modal._resolveDiscordId = null;
    resolve?.(input.value.trim());
});

function syncBanDurationRequirement() {
    const duration = document.getElementById('ban-duration');
    const isBan = document.getElementById('modal-action-type').value === 'BAN';
    const isTemporary = document.getElementById('ban-type').value === 'TEMPORARY';
    const isLastChance = document.getElementById('last-chance').checked;
    duration.required = isBan && isTemporary && !isLastChance;
}

window.editAction = async (actionId) => {
    const actions = await ModAPI.getActions();
    const action = actions.find(item => item.id === actionId && (item.type === 'WARN' || item.type === 'BAN'));
    if (!action) return;

    editingActionId = actionId;
    document.getElementById('editing-action-id').value = actionId;
    document.getElementById('modal-action-type').value = action.type;
    const isWarn = action.type === 'WARN';
    const isBan = action.type === 'BAN';
    
    const container = document.getElementById('action-modal-container');
    if (container) {
        container.className = 'modal modal-pro modal-anim ' + (isWarn ? 'theme-warn' : 'theme-ban');
    }
    
    document.getElementById('modal-title').innerText = `Edit ${isWarn ? 'Warning' : 'Ban'}`;
    const subtitleEl = document.getElementById('modal-subtitle');
    if (subtitleEl) subtitleEl.innerText = 'Modify existing sanction details';
    
    const iconEl = document.getElementById('modal-icon-element');
    if (iconEl) iconEl.setAttribute('data-lucide', isWarn ? 'edit-3' : 'edit-3');

    document.getElementById('modal-target-username').innerText = currentPlayer?.username || 'Player';
    document.getElementById('modal-target-discord').innerText = currentPlayer?.discordId || '-';

    const confirmBtn = document.getElementById('btn-confirm-action');
    confirmBtn.innerText = 'Save Changes';
    confirmBtn.style.background = isWarn ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' : 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)';
    confirmBtn.style.boxShadow = isWarn ? '0 4px 14px rgba(217, 119, 6, 0.4)' : '0 4px 14px rgba(220, 38, 38, 0.4)';
    confirmBtn.style.color = 'white';

    await populateIssuerSelect();
    const invGroup = document.getElementById('involved-players-group');
    if (invGroup) invGroup.style.display = 'none';
    const otherStaff = Array.isArray(action.otherModerators) ? action.otherModerators : (Array.isArray(action.otherStaffers) ? action.otherStaffers : []);
    window.setSelectedOtherStaffers(otherStaff);
    await initOtherStaffersSelector();
    window.reasonSelection = getActionReasons(action);
    await populateReasonSelect(action.type);
    const reasonSelect = document.getElementById('action-reason');
    const currentReasons = getActionReasons(action);
    currentReasons.forEach(currentReason => {
        if (currentReason && ![...reasonSelect.querySelectorAll('input[type="checkbox"]')].some(input => input.value === currentReason)) {
            const label = document.createElement('label');
            label.className = 'reason-checkbox';
            label.innerHTML = `<input type="checkbox" value="${currentReason}" data-count="0"><span>${currentReason}</span>`;
            reasonSelect.appendChild(label);
        }
    });
    [...reasonSelect.querySelectorAll('input[type="checkbox"]')].forEach(input => { input.checked = currentReasons.includes(input.value); });
    window.reasonSelection = currentReasons;
    const issuerEl = document.getElementById('action-issuer');
    if (issuerEl) {
        issuerEl.value = action.moderator || '';
        issuerEl.dispatchEvent(new Event('change'));
    }
    document.getElementById('warning-number-group').style.display = isWarn ? 'block' : 'none';
    if (isWarn) {
        const occupiedSlots = getOccupiedWarningSlots(playerId, actions, actionId);
        const warningNumbers = Array.isArray(action.warningNumbers)
            ? action.warningNumbers.map(Number)
            : action.warningNumber != null ? [Number(action.warningNumber)] : [1];
        setupWarningSlots(occupiedSlots, warningNumbers);
    }
    document.getElementById('action-date').value = toDateTimeLocalValue(action.timestamp);
    document.getElementById('action-note').value = action.note || '';

    document.getElementById('ban-type-group').style.display = isBan ? 'block' : 'none';
    document.getElementById('ban-category-group').style.display = isBan ? 'block' : 'none';
    setBanType(action.permanent ? 'PERMANENT' : 'TEMPORARY');
    setBanCategory(action.banCategory || 'traditional');
    document.getElementById('last-chance-group').style.display = isBan ? 'block' : 'none';
    document.getElementById('last-chance').checked = Boolean(action.lastChance);
    document.getElementById('duration-group').style.display = isBan && !action.permanent ? 'block' : 'none';
    document.getElementById('ban-duration').value = action.duration || '';
    document.getElementById('ban-duration-unit').value = action.durationUnit || 'Days';
    syncBanDurationRequirement();
    document.getElementById('action-modal').style.display = 'flex';
    if (window.lucide && lucide.createIcons) lucide.createIcons();
};

window.deleteAction = async (actionId) => {
    let actions = await ModAPI.getActions();
    const actionTarget = actions.find(a => a.id === actionId);
    const deletedLabel = actionTarget?.type === 'WARN' ? 'Warning' : actionTarget?.type === 'LAST_CHANCE' ? 'Last Chance' : 'Ban';

    const confirmed = await showCustomConfirm({
        title: `Delete ${deletedLabel}`,
        message: `Are you sure you want to permanently delete this ${deletedLabel.toLowerCase()} record from the player history?`,
        confirmText: 'Yes, Delete Record',
        cancelText: 'Cancel',
        type: 'danger',
        icon: 'trash-2'
    });
    if (!confirmed) return;

    actions = actions.filter(a => a.id !== actionId);
    await ModAPI.saveActions(actions);
    await ModAPI.logEvent(`Deleted ${actionTarget ? actionTarget.type : 'action'} for player ${currentPlayer ? currentPlayer.username : ''}`, 'System Admin');
    // Update player's status in players DB
    const players = await ModAPI.getPlayers();
    const pIdx = players.findIndex(p => p.id === playerId);
    if (pIdx > -1) {
        const playerActions = actions.filter(a => a.playerId === playerId);
        const pBans = getActivePlayerBans(actions);
        const pWarns = playerActions.filter(a => isWarningActive(a, playerActions));
        let newStatus;
        if (pBans.some(b => b.permanent)) newStatus = 'Permanently Banned';
        else if (pBans.length > 0) newStatus = 'Banned';
        else if (pWarns.length > 0) newStatus = 'Warned';
        else newStatus = 'Clean';
        players[pIdx].status = newStatus;
        await ModAPI.savePlayers(players);
    }
    showToast(`${deletedLabel} deleted successfully.`);
    const tabToKeep = window.currentActiveTab || 'history-warn';
    await initPlayerProfile();
    switchTab(tabToKeep);
};

window.clearActions = async (type) => {
    let label = 'Actions';
    if (type === 'WARN') label = 'Warnings';
    else if (type === 'BAN') label = 'Bans';
    else if (type === 'LAST_CHANCE') label = 'Last Chances';

    const confirmed = await showCustomConfirm({
        title: `Remove All ${label}`,
        message: `Are you sure you want to delete all ${label.toLowerCase()} history for this player? This cannot be undone.`,
        confirmText: `Remove All ${label}`,
        cancelText: 'Cancel',
        type: 'danger',
        icon: 'trash-2'
    });
    if (!confirmed) return;

    let actions = await ModAPI.getActions();
    if (type === 'LAST_CHANCE') {
        actions = actions.filter(a => !(a.playerId === playerId && (a.type === 'LAST_CHANCE' || a.lastChance || a.lastChanceRemoval || a.lastChanceLifted)));
    } else {
        actions = actions.filter(a => !(a.playerId === playerId && a.type === type));
    }
    await ModAPI.saveActions(actions);
    await ModAPI.logEvent(`Cleared all ${type} records for player ${currentPlayer ? currentPlayer.username : ''}`, 'System Admin');
    // Update player's status in players DB
    const players = await ModAPI.getPlayers();
    const pIdx = players.findIndex(p => p.id === playerId);
    if (pIdx > -1) {
        const playerActions = actions.filter(a => a.playerId === playerId);
        const pBans = getActivePlayerBans(actions);
        const pWarns = playerActions.filter(a => isWarningActive(a, playerActions));
        let newStatus;
        if (pBans.some(b => b.permanent)) newStatus = 'Permanently Banned';
        else if (pBans.length > 0) newStatus = 'Banned';
        else if (pWarns.length > 0) newStatus = 'Warned';
        else newStatus = 'Clean';
        players[pIdx].status = newStatus;
        await ModAPI.savePlayers(players);
    }
    showToast(`${label} deleted successfully.`);
    await initPlayerProfile();
    switchTab(type === 'LAST_CHANCE' ? 'history-last-chance' : (type === 'BAN' ? 'history-ban' : 'history-warn'));
};

window.deletePlayer = async () => {
    const confirmed = await showCustomConfirm({
        title: 'Delete Player Record',
        message: `Are you sure you want to delete player "${currentPlayer ? currentPlayer.username : ''}" and all associated sanction records permanently?`,
        confirmText: 'Delete Player Record',
        cancelText: 'Cancel',
        type: 'danger',
        icon: 'trash-2'
    });
    if (!confirmed) return;

    let players = await ModAPI.getPlayers();
    let actions = await ModAPI.getActions();
    
    players = players.filter(p => p.id !== playerId);
    actions = actions.filter(a => a.playerId !== playerId);
    
    await ModAPI.savePlayers(players);
    await ModAPI.saveActions(actions);
    await ModAPI.logEvent(`Deleted player ${currentPlayer ? currentPlayer.username : ''} and all associated records`, 'System Admin');
    notifyAfterNavigation('Player deleted successfully.');
    location.href = 'players.html';
};

document.getElementById('ban-type').addEventListener('change', (e) => {
    document.getElementById('duration-group').style.display = e.target.value === 'TEMPORARY' ? 'block' : 'none';
    syncBanDurationRequirement();
});

document.getElementById('last-chance').addEventListener('change', syncBanDurationRequirement);

document.getElementById('action-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const type = document.getElementById('modal-action-type').value;
        const isPermanent = type === 'BAN' && document.getElementById('ban-type').value === 'PERMANENT';
        const isEditing = Boolean(editingActionId);
        const lastChance = type === 'BAN' && !isPermanent && document.getElementById('last-chance').checked;
        console.log('[DEBUG-SUBMIT] type:', type, 'isPermanent:', isPermanent, 'isEditing:', isEditing, 'lastChance:', lastChance, 'banTypeValue:', document.getElementById('ban-type').value);

        const issuerInput = document.getElementById('action-issuer');
        if (!issuerInput.value.trim()) {
            highlightInvalidInput(issuerInput, 'Please select or type the Staff Issuer');
            return;
        }

        const actionDateInput = document.getElementById('action-date');
        if (!actionDateInput.value || Number.isNaN(new Date(actionDateInput.value).getTime())) {
            highlightInvalidInput(actionDateInput, 'Please select a valid Date & Time');
            return;
        }

        if (type === 'BAN' && !isPermanent && !lastChance) {
            const durationInput = document.getElementById('ban-duration');
            if (!durationInput.value || Number(durationInput.value) <= 0) {
                highlightInvalidInput(durationInput, 'Please enter a valid duration for the Temporary Ban');
                return;
            }
        }

        const selectedReasons = window.reasonSelection || getSelectedReasons(document.getElementById('action-reason'));
        if (!selectedReasons.length) {
            const reasonInput = document.getElementById('reason-filter');
            highlightInvalidInput(reasonInput, `Please select at least one reason for the ${type === 'WARN' ? 'Warning' : 'Ban'}`);
            return;
        }

        const actionDate = actionDateInput.value;
        const warningNumberInputs = [...document.querySelectorAll('input[name="warning-number"]:checked:not(:disabled)')];
        if (type === 'WARN' && !warningNumberInputs.length) {
            showToast('Please select at least one available warning level (Warn 1, 2, or 3)', 'warning');
            return;
        }
        const warningNumbers = warningNumberInputs.map(input => Number(input.value));
        if (!isEditing && !(await ensureModeratorDiscordId(issuerInput.value))) return;
        const actions = await ModAPI.getActions();
        if (type === 'WARN') {
            const occupied = getOccupiedWarningSlots(playerId, actions, isEditing ? editingActionId : null);
            const conflicting = warningNumbers.filter(n => occupied.has(n));
            if (conflicting.length) {
                showToast(`Warn #${conflicting.join(', #')} is already active for this player.`, 'error');
                return;
            }
        }

        function extractReasonKey(txt) {
        if(!txt) return 'Unspecified';
        let t = String(txt).trim();
        const low = t.toLowerCase();
        const multiseps = [' for ', ' | ', ' / '];
        let idx = -1;
        for (const s of multiseps) {
            const i = low.indexOf(s);
            if (i !== -1 && (idx === -1 || i < idx)) idx = i;
        }
        const seps = [':', '-', '—', '(', '[', ']'];
        for (const s of seps) {
            const i = t.indexOf(s);
            if (i !== -1 && (idx === -1 || i < idx)) idx = i;
        }
        if (idx !== -1) return t.slice(0, idx).trim();
        if (t.length > 60) return t.slice(0,60).trim() + '…';
        return t;
    }
    const actionToEdit = isEditing ? actions.find(action => action.id === editingActionId) : null;
    const reasonKeys = [...new Set(selectedReasons.map(extractReasonKey))];
    const rawReason = selectedReasons.join(', ');
    const reasonCount = actions.filter(action =>
        action.id !== editingActionId &&
        (action.type === 'WARN' || action.type === 'BAN') &&
        getActionReasons(action).some(reason => reasonKeys.includes(reason))
    ).length + 1;

    const otherModerators = typeof window.getSelectedOtherStaffers === 'function' ? window.getSelectedOtherStaffers() : [];

    if (isEditing && actionToEdit) {
        const oldDetails = `${actionToEdit.type}, reason: ${actionToEdit.reason}, issuer: ${actionToEdit.moderator || '-'}, duration: ${actionToEdit.permanent ? 'Permanent' : `${actionToEdit.duration || '-'} ${actionToEdit.durationUnit || ''}`.trim()}`;
        const updatedAction = {
            ...actionToEdit,
            reason: rawReason,
            reasonKey: reasonKeys[0],
            reasonKeys,
            reasonRaw: rawReason,
            reasonCount,
            recidiveReasons: (window.recidiveSelection || []).filter(r => selectedReasons.includes(r)),
            warningNumber: type === 'WARN' ? warningNumbers[0] : null,
            warningNumbers: type === 'WARN' ? warningNumbers : null,
            moderator: document.getElementById('action-issuer').value,
            otherModerators,
            otherStaffers: otherModerators,
            timestamp: new Date(actionDate).toISOString(),
            permanent: isPermanent,
            lastChance,
            duration: type === 'BAN' && !isPermanent ? document.getElementById('ban-duration').value : null,
            durationUnit: type === 'BAN' && !isPermanent ? document.getElementById('ban-duration-unit').value : null,
            banCategory: type === 'BAN' ? document.getElementById('ban-category').value : null,
            note: document.getElementById('action-note').value,
            updatedAt: new Date().toISOString()
        };
        const actionIndex = actions.findIndex(action => action.id === editingActionId);
        actions[actionIndex] = updatedAction;
        if (isPermanent) {
            const activeLC = getActiveLastChanceBan(actions.filter(a => a.playerId === playerId));
            if (activeLC) {
                const issuerName = document.getElementById('action-issuer').value.trim();
                actions.push({
                    id: `a${Date.now() + 50}_lc_rem_${playerId}`,
                    playerId,
                    type: 'LAST_CHANCE',
                    lastChanceRemoval: true,
                    lastChanceLifted: true,
                    removedFromActionId: activeLC.id,
                    reason: 'Banned',
                    reasonKey: 'Banned',
                    reasonKeys: ['Banned'],
                    reasonRaw: 'Banned',
                    moderator: issuerName,
                    timestamp: new Date(new Date(actionDate).getTime() + 1000).toISOString(),
                    permanent: false,
                    note: 'Last Chance automatically removed due to Permanent Ban'
                });
                ModAPI.logEvent(`Removed Last Chance status from player ${currentPlayer.username}. Reason: Banned`, issuerName).catch(() => {});
            }
        }
        await ModAPI.saveActions(actions);
        const newDetails = `${updatedAction.type}, reason: ${updatedAction.reason}, issuer: ${updatedAction.moderator || '-'}, duration: ${updatedAction.permanent ? 'Permanent' : `${updatedAction.duration || '-'} ${updatedAction.durationUnit || ''}`.trim()}`;
        await ModAPI.logEvent(`Edited ${type} for player ${currentPlayer.username}. From [${oldDetails}] to [${newDetails}]`, 'System Admin');
        const tabToKeep = window.currentActiveTab || (type === 'BAN' ? 'history-ban' : (type === 'LAST_CHANCE' || actionToEdit?.lastChance ? 'history-last-chance' : 'history-warn'));
        closeActionModal();
        showToast(`${type} updated successfully.`);
        await initPlayerProfile();
        switchTab(tabToKeep);
        return;
    }

    const involvedPlayers = typeof window.getSelectedInvolvedPlayers === 'function' ? window.getSelectedInvolvedPlayers() : [];
    const allInvolvedIds = [playerId, ...involvedPlayers.map(p => p.id)];
    const allInvolvedUsernames = [currentPlayer?.username || 'Player', ...involvedPlayers.map(p => p.username)];

    const newAction = {
        id: `a${Date.now()}`,
        playerId: playerId,
        type: type,
        reason: rawReason,
        reasonKey: reasonKeys[0],
        reasonKeys,
        reasonRaw: rawReason,
        reasonCount: reasonCount,
        recidiveReasons: (window.recidiveSelection || []).filter(r => selectedReasons.includes(r)),
        warningNumber: type === 'WARN' ? warningNumbers[0] : null,
        warningNumbers: type === 'WARN' ? warningNumbers : null,
        moderator: document.getElementById('action-issuer').value,
        otherModerators,
        otherStaffers: otherModerators,
        involvedPlayerIds: involvedPlayers.length ? allInvolvedIds : null,
        involvedPlayerUsernames: involvedPlayers.length ? allInvolvedUsernames : null,
        timestamp: new Date(actionDate).toISOString(),
        permanent: isPermanent,
        lastChance,
        duration: type === 'BAN' && !isPermanent ? document.getElementById('ban-duration').value : null,
        durationUnit: type === 'BAN' && !isPermanent ? document.getElementById('ban-duration-unit').value : null,
        banCategory: type === 'BAN' ? document.getElementById('ban-category').value : null,
        note: document.getElementById('action-note').value
    };

    actions.push(newAction);
    console.log('[DEBUG-SUBMIT] newAction created:', newAction.id, 'permanent:', newAction.permanent, 'type:', newAction.type);

    // Collect log messages to send AFTER saveActions (logEvent does its own fetchDB+writeDB which causes race conditions)
    const pendingLogs = [];
    pendingLogs.push({ msg: `Issued ${type} to ${currentPlayer.username}. Reason: ${newAction.reason}`, author: newAction.moderator });

    // Create cloned sibling sanction for each involved player
    for (let i = 0; i < involvedPlayers.length; i++) {
        const invPlayer = involvedPlayers[i];
        let invWarningNumber = null;
        let invWarningNumbers = null;
        if (type === 'WARN') {
            const pOccupied = getOccupiedWarningSlots(invPlayer.id, actions);
            const desiredSlot = warningNumbers[0] || 1;
            const assignedSlot = !pOccupied.has(desiredSlot) ? desiredSlot : ([1, 2, 3].find(n => !pOccupied.has(n)) || 1);
            invWarningNumber = assignedSlot;
            invWarningNumbers = [assignedSlot];
        }

        const siblingAction = {
            ...newAction,
            id: `a${Date.now()}_inv_${i}_${invPlayer.id}`,
            playerId: invPlayer.id,
            warningNumber: invWarningNumber,
            warningNumbers: invWarningNumbers
        };

        actions.push(siblingAction);
        pendingLogs.push({ msg: `Issued ${type} to ${invPlayer.username} (Involved with ${currentPlayer.username}). Reason: ${newAction.reason}`, author: newAction.moderator });
    }

    // If this is a Permanent Ban, automatically revoke any active Last Chance with reason 'Banned'
    if (isPermanent) {
        allInvolvedIds.forEach((targetId, idx) => {
            const activeLC = getActiveLastChanceBan(actions.filter(a => a.playerId === targetId));
            if (activeLC) {
                const targetUsername = targetId === playerId ? (currentPlayer?.username || 'Player') : (involvedPlayers.find(p => p.id === targetId)?.username || 'Player');
                const issuerName = document.getElementById('action-issuer').value.trim();
                actions.push({
                    id: `a${Date.now() + 50 + idx}_lc_rem_${targetId}`,
                    playerId: targetId,
                    type: 'LAST_CHANCE',
                    lastChanceRemoval: true,
                    lastChanceLifted: true,
                    removedFromActionId: activeLC.id,
                    reason: 'Banned',
                    reasonKey: 'Banned',
                    reasonKeys: ['Banned'],
                    reasonRaw: 'Banned',
                    moderator: issuerName,
                    timestamp: new Date(new Date(actionDate).getTime() + 1000).toISOString(),
                    permanent: false,
                    note: 'Last Chance automatically removed due to Permanent Ban'
                });
                pendingLogs.push({ msg: `Removed Last Chance status from player ${targetUsername}. Reason: Banned`, author: issuerName });
            }
        });
    }

    // SAVE FIRST, then log events (logEvent does fetchDB+writeDB which would overwrite unsaved changes)
    console.log('[DEBUG-SUBMIT] About to saveActions, total actions:', actions.length);
    await ModAPI.saveActions(actions);
    console.log('[DEBUG-SUBMIT] saveActions completed successfully');

    // Now safe to log events (they will read the just-saved data)
    for (const log of pendingLogs) {
        await ModAPI.logEvent(log.msg, log.author);
    }

    const players = await ModAPI.getPlayers();
    
    // Recalculate player status from saved actions for primary player and all involved players
    allInvolvedIds.forEach(targetId => {
        const pIdx = players.findIndex(p => p.id === targetId);
        if (pIdx > -1) {
            const playerActions = actions.filter(a => a.playerId === targetId);
            const pBans = getActivePlayerBans(actions).filter(a => a.playerId === targetId);
            const pWarns = playerActions.filter(a => isWarningActive(a, playerActions));
            let newStatus;
            if (pBans.some(b => b.permanent)) newStatus = 'Permanently Banned';
            else if (pBans.length > 0) newStatus = 'Banned';
            else if (pWarns.length > 0) newStatus = 'Warned';
            else newStatus = 'Clean';
            players[pIdx].status = newStatus;
        }
    });
    
    await ModAPI.savePlayers(players);
    
    closeActionModal();
    const successMsg = involvedPlayers.length
        ? `${type} successfully issued to ${currentPlayer.username} and ${involvedPlayers.length} involved player(s).`
        : `${type} successfully issued.`;
    showToast(successMsg);
    await initPlayerProfile();
    switchTab(type === 'BAN' ? 'history-ban' : (type === 'LAST_CHANCE' || lastChance ? 'history-last-chance' : 'history-warn'));
    } catch (error) {
        console.error('Failed to submit action:', error);
        showToast('Error saving action: ' + (error.message || error), 'error');
    }
});

function populateSimpleReasonSelect(containerId, reasons) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = reasons
        .map((reason, index) => `<label class="reason-checkbox"><input type="checkbox" value="${reason}" id="${containerId}-${index}"><span>${reason}</span></label>`)
        .join('');
}

window.openRemoveModal = async (actionId) => {
    removingActionId = actionId;
    populateSimpleReasonSelect('remove-reason', REMOVAL_REASONS);
    await populateIssuerSelect('remove-issuer', 'remove-issuer-options');
    document.getElementById('remove-date').value = toDateTimeLocalValue();
    document.getElementById('remove-note').value = '';
    document.getElementById('remove-modal').style.display = 'flex';
    if (window.lucide && lucide.createIcons) lucide.createIcons();
};

window.closeRemoveModal = () => {
    document.getElementById('remove-modal').style.display = 'none';
    document.getElementById('remove-form').reset();
    removingActionId = null;
};

const removeForm = document.getElementById('remove-form');
if (removeForm) {
    removeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!removingActionId) return;
        const selectedReasons = [...document.querySelectorAll('#remove-reason input[type="checkbox"]:checked')].map(cb => cb.value);
        if (!selectedReasons.length) {
            showToast('Add a reason for the removal', 'warning');
            return;
        }
        const removeDate = document.getElementById('remove-date').value;
        if (!removeDate || Number.isNaN(new Date(removeDate).getTime())) {
            showToast('Select a valid date', 'warning');
            return;
        }
        const issuer = document.getElementById('remove-issuer').value;
        const note = document.getElementById('remove-note').value;

        if (!(await ensureModeratorDiscordId(issuer))) return;

        const actions = await ModAPI.getActions();
        const actionIndex = actions.findIndex(a => a.id === removingActionId);
        if (actionIndex === -1) { closeRemoveModal(); return; }
        const target = actions[actionIndex];
        actions[actionIndex] = {
            ...target,
            removed: true,
            removedAt: new Date(removeDate).toISOString(),
            removedBy: issuer,
            removedReason: selectedReasons.join(', '),
            removedNote: note
        };
        await ModAPI.saveActions(actions);
        // Logged as a system event only, so it is not counted among tracked WARN/BAN statistics.
        await ModAPI.logEvent(`Removed ${target.type} for player ${currentPlayer ? currentPlayer.username : ''}. Reason: ${selectedReasons.join(', ')}`, issuer);

        const players = await ModAPI.getPlayers();
        const pIdx = players.findIndex(p => p.id === playerId);
        if (pIdx > -1) {
            const playerActions = actions.filter(a => a.playerId === playerId);
            const pBans = getActivePlayerBans(actions);
            const pWarns = playerActions.filter(a => isWarningActive(a, playerActions));
            let newStatus;
            if (pBans.some(b => b.permanent)) newStatus = 'Permanently Banned';
            else if (pBans.length > 0) newStatus = 'Banned';
            else if (pWarns.length > 0) newStatus = 'Warned';
            else newStatus = 'Clean';
            players[pIdx].status = newStatus;
            await ModAPI.savePlayers(players);
        }

        closeRemoveModal();
        showToast(`${target.type === 'WARN' ? 'Warning' : 'Ban'} removed successfully.`);
        await initPlayerProfile();
        switchTab(target.type === 'BAN' ? 'history-ban' : 'history-warn');
    });
}

window.openLiftLastChanceModal = async () => {
    if (!currentLastChanceBanId) return;
    populateSimpleReasonSelect('lift-last-chance-reason', REMOVAL_REASONS);
    await populateIssuerSelect('lift-last-chance-issuer', 'lift-last-chance-issuer-options');
    document.getElementById('lift-last-chance-date').value = toDateTimeLocalValue();
    document.getElementById('lift-last-chance-modal').style.display = 'flex';
    if (window.lucide && lucide.createIcons) lucide.createIcons();
};

window.closeLiftLastChanceModal = () => {
    document.getElementById('lift-last-chance-modal').style.display = 'none';
    document.getElementById('lift-last-chance-form').reset();
};

document.getElementById('lift-last-chance-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
    if (!currentLastChanceBanId) return;
    const selectedReasons = getSelectedReasons(document.getElementById('lift-last-chance-reason'));
    if (!selectedReasons.length) {
        showToast('Add a reason for removing Last Chance');
        return;
    }
    const liftDate = document.getElementById('lift-last-chance-date').value;
    if (!liftDate || Number.isNaN(new Date(liftDate).getTime())) {
        showToast('Select a valid date');
        return;
    }
    const issuer = document.getElementById('lift-last-chance-issuer').value;
    const note = document.getElementById('lift-last-chance-note').value;

    const actions = await ModAPI.getActions();
    const actionIndex = actions.findIndex(a => a.id === currentLastChanceBanId);
    if (actionIndex === -1) { closeLiftLastChanceModal(); return; }
    const target = actions[actionIndex];
    actions.push({
        id: `a${Date.now()}`,
        playerId,
        type: 'LAST_CHANCE',
        lastChance: true,
        lastChanceRemoval: true,
        removedFromActionId: target.id,
        reason: selectedReasons.join(', '),
        reasonKey: selectedReasons[0],
        reasonKeys: selectedReasons,
        reasonRaw: selectedReasons.join(', '),
        moderator: issuer,
        timestamp: new Date(liftDate).toISOString(),
        permanent: false,
        note
    });
    await ModAPI.saveActions(actions);
    // Logged as a system event only, so it is not counted among tracked WARN/BAN statistics.
    await ModAPI.logEvent(`Removed Last Chance status from player ${currentPlayer ? currentPlayer.username : ''}. Reason: ${selectedReasons.join(', ')}`, issuer);

    closeLiftLastChanceModal();
    showToast('Last Chance removed successfully.');
    await initPlayerProfile();
    switchTab('history-last-chance');
    } catch (error) {
        console.error('Failed to remove Last Chance:', error);
        showToast('Last Chance could not be removed. Check that the server is running.');
    }
});

window.openRemovePermanentBanModal = async () => {
    if (!removingPermanentBanId) return;
    populateSimpleReasonSelect('remove-permanent-ban-reason', REMOVAL_REASONS);
    document.getElementById('remove-permanent-ban-date').value = toDateTimeLocalValue();
    const lcCheck = document.getElementById('remove-permanent-ban-apply-last-chance');
    if (lcCheck) lcCheck.checked = false;
    document.getElementById('remove-permanent-ban-modal').style.display = 'flex';
    await populateIssuerSelect('remove-permanent-ban-issuer', 'remove-permanent-ban-issuer-options');
    if (window.lucide && lucide.createIcons) lucide.createIcons();
};

window.closeRemovePermanentBanModal = () => {
    document.getElementById('remove-permanent-ban-modal').style.display = 'none';
    document.getElementById('remove-permanent-ban-form').reset();
    const lcCheck = document.getElementById('remove-permanent-ban-apply-last-chance');
    if (lcCheck) lcCheck.checked = false;
    removingPermanentBanId = null;
};

document.getElementById('remove-permanent-ban-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        if (!removingPermanentBanId) return;
        const selectedReasons = getSelectedReasons(document.getElementById('remove-permanent-ban-reason'));
        if (!selectedReasons.length) return showToast('Add a reason for removing the Permanent Ban');
        const date = document.getElementById('remove-permanent-ban-date').value;
        if (!date || Number.isNaN(new Date(date).getTime())) return showToast('Select a valid date');
        const issuer = document.getElementById('remove-permanent-ban-issuer').value.trim();
        if (!(await ensureModeratorDiscordId(issuer))) return;
        const note = document.getElementById('remove-permanent-ban-note').value;
        const applyLastChance = Boolean(document.getElementById('remove-permanent-ban-apply-last-chance')?.checked);
        const actions = await ModAPI.getActions();
        if (!actions.some(action => action.id === removingPermanentBanId)) return closeRemovePermanentBanModal();
        
        // 1. Record Permaban Removal Action
        actions.push({
            id: `a${Date.now()}`,
            playerId,
            type: 'BAN',
            reason: selectedReasons.join(', '),
            reasonKey: selectedReasons[0],
            reasonKeys: selectedReasons,
            reasonRaw: selectedReasons.join(', '),
            moderator: issuer,
            timestamp: new Date(date).toISOString(),
            permanent: false,
            permanentBanRemoval: true,
            removedFromActionId: removingPermanentBanId,
            duration: 'Forever',
            durationUnit: null,
            banCategory: 'Unbanned',
            note
        });

        // 2. If requested, automatically apply Last Chance
        if (applyLastChance) {
            const lcReason = `Last Chance granted following Unban (Reason: ${selectedReasons.join(', ')})`;
            actions.push({
                id: `a${Date.now() + 50}`,
                playerId,
                type: 'LAST_CHANCE',
                reason: lcReason,
                reasonKey: selectedReasons[0] || 'Unban Last Chance',
                reasonKeys: selectedReasons,
                reasonRaw: lcReason,
                moderator: issuer,
                timestamp: new Date(new Date(date).getTime() + 1000).toISOString(),
                permanent: false,
                lastChance: true,
                note: note ? `Unban Note: ${note}` : 'Assegnato contestualmente all\'unban da Permaban'
            });
            await ModAPI.logEvent(`Applied Last Chance to ${currentPlayer ? currentPlayer.username : ''} upon Unban. Reason: ${selectedReasons.join(', ')}`, issuer);
        }

        await ModAPI.saveActions(actions);
        await ModAPI.logEvent(`Removed Permanent Ban from player ${currentPlayer ? currentPlayer.username : ''}. Reason: ${selectedReasons.join(', ')}`, issuer);
        
        // 3. Update player status
        const players = await ModAPI.getPlayers();
        const playerIndex = players.findIndex(player => player.id === playerId);
        if (playerIndex > -1) {
            const playerBans = getActivePlayerBans(actions);
            const playerWarns = actions.filter(action => action.playerId === playerId && isWarningActive(action, actions));
            
            if (applyLastChance || hasActiveLastChance(actions.filter(a => a.playerId === playerId))) {
                players[playerIndex].status = 'Last Chance';
            } else {
                players[playerIndex].status = playerBans.some(ban => ban.permanent)
                    ? 'Permanently Banned' : playerBans.length ? 'Banned' : playerWarns.length ? 'Warned' : 'Clean';
            }
            await ModAPI.savePlayers(players);
        }
        
        closeRemovePermanentBanModal();
        showToast(applyLastChance ? 'Permanent Ban removed and Last Chance assigned!' : 'Permanent Ban removed successfully.');
        await initPlayerProfile();
        if (applyLastChance) {
            switchTab('history-last-chance');
        }
    } catch (error) {
        console.error('Failed to remove Permanent Ban:', error);
        showToast('Permanent Ban could not be removed. Check that the server is running.');
    }
});

window.openApplyLastChanceModal = async () => {
    editingLastChanceId = null;
    populateSimpleReasonSelect('apply-last-chance-reason', [...COMMON_REASONS, ...BAN_ONLY_REASONS]);
    await populateIssuerSelect('apply-last-chance-issuer', 'apply-last-chance-issuer-options');
    document.getElementById('apply-last-chance-date').value = toDateTimeLocalValue();
    document.getElementById('apply-last-chance-modal').style.display = 'flex';
    if (window.lucide && lucide.createIcons) lucide.createIcons();
};

window.closeApplyLastChanceModal = () => {
    document.getElementById('apply-last-chance-modal').style.display = 'none';
    document.getElementById('apply-last-chance-form').reset();
    editingLastChanceId = null;
};

document.getElementById('apply-last-chance-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
    const selectedReasons = getSelectedReasons(document.getElementById('apply-last-chance-reason'));
    if (!selectedReasons.length) {
        showToast('Add a reason for the Last Chance');
        return;
    }
    const applyDate = document.getElementById('apply-last-chance-date').value;
    if (!applyDate || Number.isNaN(new Date(applyDate).getTime())) {
        showToast('Select a valid date');
        return;
    }
    const issuer = document.getElementById('apply-last-chance-issuer').value;
    if (!(await ensureModeratorDiscordId(issuer))) return;
    const note = document.getElementById('apply-last-chance-note').value;
    const rawReason = selectedReasons.join(', ');

    const actions = await ModAPI.getActions();
    if (editingLastChanceId) {
        const index = actions.findIndex(action => action.id === editingLastChanceId);
        if (index > -1) {
            actions[index] = {
                ...actions[index],
                reason: rawReason,
                reasonKey: selectedReasons[0],
                reasonKeys: selectedReasons,
                reasonRaw: rawReason,
                moderator: issuer,
                timestamp: new Date(applyDate).toISOString(),
                note
            };
            await ModAPI.saveActions(actions);
            closeApplyLastChanceModal();
            showToast('Last Chance updated successfully.');
            await initPlayerProfile();
            return;
        }
    }
    const newAction = {
        id: `a${Date.now()}`,
        playerId,
        type: 'LAST_CHANCE',
        reason: rawReason,
        reasonKey: selectedReasons[0],
        reasonKeys: selectedReasons,
        reasonRaw: rawReason,
        moderator: issuer,
        timestamp: new Date(applyDate).toISOString(),
        permanent: false,
        lastChance: true,
        note
    };
    actions.push(newAction);
    await ModAPI.saveActions(actions);
    // Tracked like any other moderation action (shown in Activity and Statistics).
    await ModAPI.logEvent(`Applied Last Chance to ${currentPlayer ? currentPlayer.username : ''}. Reason: ${rawReason}`, issuer);

    closeApplyLastChanceModal();
    showToast('Last Chance applied successfully.');
    await initPlayerProfile();
    } catch (error) {
        console.error('Failed to apply Last Chance:', error);
        showToast('Last Chance could not be saved. Check that the server is running.');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    switchTab(getPersistedTab());
    initPlayerProfile();
    populateIssuerSelect();
});

window.editLastChance = async (actionId) => {
    const actions = await ModAPI.getActions();
    const action = actions.find(item => item.id === actionId && item.type === 'LAST_CHANCE');
    if (!action) return;
    editingLastChanceId = actionId;
    populateSimpleReasonSelect('apply-last-chance-reason', [...COMMON_REASONS, ...BAN_ONLY_REASONS]);
    [...document.querySelectorAll('#apply-last-chance-reason input[type="checkbox"]')].forEach(input => {
        input.checked = getActionReasons(action).includes(input.value);
    });
    await populateIssuerSelect('apply-last-chance-issuer', 'apply-last-chance-issuer-options');
    const lastChanceIssuerEl = document.getElementById('apply-last-chance-issuer');
    if (lastChanceIssuerEl) {
        lastChanceIssuerEl.value = action.moderator || '';
        lastChanceIssuerEl.dispatchEvent(new Event('input'));
    }
    document.getElementById('apply-last-chance-date').value = toDateTimeLocalValue(action.timestamp);
    document.getElementById('apply-last-chance-note').value = action.note || '';
    document.getElementById('apply-last-chance-modal').style.display = 'flex';
    if (window.lucide && lucide.createIcons) lucide.createIcons();
};

window.openRemoveWarningModal = async (warningId = '') => {
    const actions = await ModAPI.getActions();
    const activeWarnings = actions
        .filter(action => action.playerId === playerId && isWarningActive(action, actions))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (!activeWarnings.length) return;
    removingWarningId = warningId;
    const select = document.getElementById('remove-warning-select');
    select.innerHTML = activeWarnings.map((warning, index) =>
        `<option value="${warning.id}">${new Date(warning.timestamp).toLocaleString()} - ${getActionReasonText(warning)} - ${warning.moderator || '-'}</option>`
    ).join('');
    if (warningId && activeWarnings.some(warning => warning.id === warningId)) select.value = warningId;
    populateSimpleReasonSelect('remove-warning-reason', REMOVAL_REASONS);
    await populateIssuerSelect('remove-warning-issuer', 'remove-warning-issuer-options');
    document.getElementById('remove-warning-date').value = toDateTimeLocalValue();
    document.getElementById('remove-warning-modal').style.display = 'flex';
    if (window.lucide && lucide.createIcons) lucide.createIcons();
};

window.closeRemoveWarningModal = () => {
    document.getElementById('remove-warning-modal').style.display = 'none';
    document.getElementById('remove-warning-form').reset();
    removingWarningId = null;
};

document.getElementById('remove-warning-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const selectedReasons = getSelectedReasons(document.getElementById('remove-warning-reason'));
        if (!selectedReasons.length) return showToast('Add a reason for removing the Warning');
        const removeDate = document.getElementById('remove-warning-date').value;
        if (!removeDate || Number.isNaN(new Date(removeDate).getTime())) return showToast('Select a valid date');
        const issuer = document.getElementById('remove-warning-issuer').value.trim();
        if (!(await ensureModeratorDiscordId(issuer))) return;
        const actions = await ModAPI.getActions();
        const warning = actions.find(action => action.id === document.getElementById('remove-warning-select').value &&
            action.playerId === playerId && isWarningActive(action, actions));
        if (!warning) return closeRemoveWarningModal();
        actions.push({
            id: `a${Date.now()}`,
            playerId,
            type: 'LOG',
            warningRemoval: true,
            removedFromActionId: warning.id,
            reason: `Removed WARN for player ${currentPlayer ? currentPlayer.username : ''}. Reason: ${selectedReasons.join(', ')}`,
            reasonKey: selectedReasons[0],
            reasonKeys: selectedReasons,
            reasonRaw: selectedReasons.join(', '),
            reasonCount: 0,
            moderator: issuer,
            timestamp: new Date(removeDate).toISOString(),
            permanent: false,
            note: document.getElementById('remove-warning-note').value
        });
        await ModAPI.saveActions(actions);
        closeRemoveWarningModal();
        showToast('Warning removed successfully.');
        await initPlayerProfile();
    } catch (error) {
        console.error('Failed to remove Warning:', error);
        showToast('Warning could not be removed. Check that the server is running.');
    }
});
