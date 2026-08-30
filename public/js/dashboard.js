async function initDashboard() {
    try {
        populateIssuerSelect().catch(() => {});
    } catch {}

    const [players, actions] = await Promise.all([
        ModAPI.getPlayers(),
        ModAPI.getActions()
    ]);

    const playerMap = new Map((players || []).map(p => [p.id, p]));

    // KPI: Total Players
    const totalCountEl = document.getElementById('total-players-count');
    if (totalCountEl) {
        totalCountEl.innerHTML = `${players.length} <span class="kpi-sub">players tracked</span>`;
    }

    // Avatar preview stack: Most recently sanctioned players with Discord avatars spanning the row
    const previewStackEl = document.getElementById('recent-players-preview');
    if (previewStackEl) {
        const sanctionedActions = actions
            .filter(a => (a.type === 'WARN' || a.type === 'BAN' || a.type === 'LAST_CHANCE') && a.playerId && a.playerId !== 'SYSTEM')
            .slice()
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        const uniqueSanctionedIds = [...new Set(sanctionedActions.map(a => a.playerId))];
        let recentSanctionedPlayers = uniqueSanctionedIds.map(id => playerMap.get(id)).filter(Boolean);
        
        // Fill up to 14 players if available to span the card nicely to the right
        if (recentSanctionedPlayers.length < 14) {
            const existing = new Set(recentSanctionedPlayers.map(p => p.id));
            for (const p of [...players].reverse()) {
                if (!existing.has(p.id)) {
                    recentSanctionedPlayers.push(p);
                    existing.add(p.id);
                }
                if (recentSanctionedPlayers.length >= 14) break;
            }
        }
        
        const displayPlayers = recentSanctionedPlayers.slice(0, 14);

        let localCache = {};
        try {
            localCache = JSON.parse(localStorage.getItem('players_avatar_cache_v3') || localStorage.getItem('discord_avatar_cache_v2') || '{}');
        } catch {}

        function getPlayerAvatarUrl(p) {
            if (!p) return null;
            if (p.avatarUrl) return p.avatarUrl;
            if (p.discordId && localCache[p.discordId]?.url) return localCache[p.discordId].url;
            if (p.discordId && /^\d{17,20}$/.test(p.discordId)) {
                try {
                    const defaultIdx = Number((BigInt(p.discordId) >> 22n) % 6n);
                    return `https://cdn.discordapp.com/embed/avatars/${defaultIdx}.png`;
                } catch {}
            }
            return null;
        }

        const colors = ['#6366f1', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#06b6d4'];

        previewStackEl.innerHTML = displayPlayers.map((p, i) => {
            const initial = (p.username || '?').charAt(0).toUpperCase();
            const avatarUrl = getPlayerAvatarUrl(p);
            const bg = colors[i % colors.length];

            return `
                <a href="player.html?id=${encodeURIComponent(p.id)}" class="avatar-stack-item" style="background: ${bg};" title="${escapeHtml(p.username)} (Discord: ${escapeHtml(p.discordId || 'N/A')})" data-discord-id="${escapeHtml(p.discordId || '')}">
                    ${avatarUrl 
                        ? `<img src="${avatarUrl}" alt="" class="avatar-stack-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" /><span class="avatar-stack-fallback" style="display:none;">${initial}</span>`
                        : `<span class="avatar-stack-fallback">${initial}</span>`
                    }
                </a>
            `;
        }).join('');

        window._dashboardGetPlayerAvatarUrl = getPlayerAvatarUrl;
        window._dashboardLocalCache = localCache;
    }

    // KPI: Warn & Ban Stats
    let warns = 0, bans = 0, permabans = 0;
    const actionsByPlayer = new Map();
    for (const a of actions) {
        if (!a) continue;
        if (a.playerId) {
            let list = actionsByPlayer.get(a.playerId);
            if (!list) {
                list = [];
                actionsByPlayer.set(a.playerId, list);
            }
            list.push(a);
        }
        if (a.type === 'WARN' && !a.warningRemoval) warns++;
        else if (a.type === 'BAN') {
            if (a.permanent) permabans++;
            else bans++;
        }
    }

    const warnsEl = document.getElementById('total-warns');
    const bansEl = document.getElementById('total-bans');
    const permabansEl = document.getElementById('total-permabans');
    const lastchanceEl = document.getElementById('total-lastchance');
    if (warnsEl) warnsEl.innerText = warns;
    if (bansEl) bansEl.innerText = bans;
    if (permabansEl) permabansEl.innerText = permabans;

    let lastChanceCount = 0;
    for (const p of players) {
        if (hasActiveLastChance(actionsByPlayer.get(p.id) || [])) lastChanceCount++;
    }
    if (lastchanceEl) lastchanceEl.innerText = lastChanceCount;

    // Helper for avatar URL in dashboard
    const resolveAvatar = (p) => {
        if (window._dashboardGetPlayerAvatarUrl) return window._dashboardGetPlayerAvatarUrl(p);
        if (!p) return null;
        if (p.avatarUrl) return p.avatarUrl;
        if (p.discordId && /^\d{17,20}$/.test(p.discordId)) {
            const idx = Number((BigInt(p.discordId) >> 22n) % 6n);
            return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
        }
        return null;
    };

    // Recent Sanctions Table
    const sanctionsBody = document.getElementById('recent-sanctions-tbody');
    let recentSanctions = [];
    if (sanctionsBody) {
        sanctionsBody.innerHTML = '';
        recentSanctions = actions
            .filter(action => action.type === 'WARN' || action.type === 'BAN' || action.type === 'LAST_CHANCE')
            .slice()
            .reverse()
            .slice(0, 5);
        
        if (recentSanctions.length === 0) {
            sanctionsBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #64748b; padding: 24px;">No recent sanctions recorded.</td></tr>`;
        } else {
            recentSanctions.forEach(action => {
                const player = playerMap.get(action.playerId);
                const tr = document.createElement('tr');
                tr.style.cursor = player ? 'pointer' : 'default';
                if (player) tr.onclick = () => {
                    const tab = action.type === 'BAN' ? 'history-ban' : action.type === 'LAST_CHANCE' ? 'history-last-chance' : 'history-warn';
                    location.href = `player.html?id=${encodeURIComponent(player.id)}&tab=${tab}`;
                };

                const initial = (player?.username || '?').charAt(0).toUpperCase();
                const avatarUrl = resolveAvatar(player);

                let badgeClass = 'warn';
                let badgeText = action.type;
                let badgeIcon = 'alert-triangle';

                if (action.permanentBanRemoval) {
                    badgeClass = 'unbanned';
                    badgeText = 'UNBANNED';
                    badgeIcon = 'shield-check';
                } else if (action.warningRemoval) {
                    badgeClass = 'unbanned';
                    badgeText = 'REMOVED';
                    badgeIcon = 'shield-check';
                } else if (action.type === 'BAN') {
                    badgeClass = action.permanent ? 'permaban' : 'temporary';
                    badgeText = action.permanent ? 'PERMABAN' : 'TEMP BAN';
                    badgeIcon = action.permanent ? 'flame' : 'clock';
                } else if (action.type === 'LAST_CHANCE') {
                    badgeClass = 'lastchance';
                    badgeText = 'LAST CHANCE';
                    badgeIcon = 'alert-octagon';
                }

                tr.innerHTML = `
                    <td>
                        <div class="player-td-cell">
                            <div class="player-mini-avatar-wrap" data-discord-id="${escapeHtml(player?.discordId || '')}">
                                ${avatarUrl 
                                    ? `<img src="${avatarUrl}" alt="" class="player-mini-avatar-img" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" /><span class="player-mini-avatar-fallback" style="display:none;">${initial}</span>`
                                    : `<span class="player-mini-avatar-fallback">${initial}</span>`
                                }
                            </div>
                            <span style="font-weight: 600; color: #f8fafc;">${player ? escapeHtml(player.username) : 'Unknown'}</span>
                        </div>
                    </td>
                    <td><span class="badge-status-pill ${badgeClass}"><i data-lucide="${badgeIcon}" style="width: 11px; height: 11px;"></i> ${badgeText}</span></td>
                    <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(getActionReasonText(action))}</td>
                    <td style="color: #94a3b8; font-size: 11.5px; white-space: nowrap;">${new Date(action.timestamp).toLocaleDateString()}</td>
                `;
                sanctionsBody.appendChild(tr);
            });
        }
    }

    // Unified Asynchronous Discord Avatar Preloading for entire Dashboard
    const topStackPlayers = (previewStackEl && window._dashboardGetPlayerAvatarUrl) ? (actions ? players.slice(0, 20) : []) : [];
    const recentSanctionPlayers = recentSanctions.map(a => playerMap.get(a.playerId)).filter(Boolean);
    const allTargetDiscordIds = [
        ...topStackPlayers.map(p => p.discordId),
        ...recentSanctionPlayers.map(p => p.discordId)
    ].filter(id => id && /^\d{17,20}$/.test(id));

    const uniqueDiscordIds = [...new Set(allTargetDiscordIds)];
    if (uniqueDiscordIds.length > 0) {
        (async () => {
            try {
                const freshProfiles = await ModAPI.getDiscordAvatars(uniqueDiscordIds);
                if (freshProfiles && typeof freshProfiles === 'object') {
                    const cache = window._dashboardLocalCache || {};
                    Object.assign(cache, freshProfiles);
                    try {
                        localStorage.setItem('players_avatar_cache_v3', JSON.stringify(cache));
                        localStorage.setItem('discord_avatar_cache_v2', JSON.stringify(cache));
                    } catch {}

                    uniqueDiscordIds.forEach(id => {
                        if (freshProfiles[id]?.url) {
                            const url = freshProfiles[id].url;
                            
                            // 1. Update Preview Stack
                            if (previewStackEl) {
                                previewStackEl.querySelectorAll(`.avatar-stack-item[data-discord-id="${CSS.escape(id)}"]`).forEach(item => {
                                    let img = item.querySelector('.avatar-stack-img');
                                    const fallback = item.querySelector('.avatar-stack-fallback');
                                    if (img) {
                                        img.src = url;
                                        img.style.display = 'block';
                                    } else {
                                        img = document.createElement('img');
                                        img.src = url;
                                        img.className = 'avatar-stack-img';
                                        item.prepend(img);
                                    }
                                    if (fallback) fallback.style.display = 'none';
                                });
                            }

                            // 2. Update Recent Sanctions Table
                            if (sanctionsBody) {
                                sanctionsBody.querySelectorAll(`.player-mini-avatar-wrap[data-discord-id="${CSS.escape(id)}"]`).forEach(wrap => {
                                    let img = wrap.querySelector('.player-mini-avatar-img');
                                    const fallback = wrap.querySelector('.player-mini-avatar-fallback');
                                    if (img) {
                                        img.src = url;
                                        img.style.display = 'block';
                                    } else {
                                        img = document.createElement('img');
                                        img.src = url;
                                        img.className = 'player-mini-avatar-img';
                                        wrap.prepend(img);
                                    }
                                    if (fallback) fallback.style.display = 'none';
                                });
                            }
                        }
                    });
                }
            } catch (err) {
                console.warn('Dashboard avatar fetch:', err);
            }
        })();
    }

    // Action Feed List (Timeline Cards)
    const feedContainer = document.getElementById('action-feed-list');
    if (feedContainer) {
        feedContainer.innerHTML = '';
        const feedActions = [...actions].reverse().slice(0, 5);
        if (feedActions.length === 0) {
            feedContainer.innerHTML = `<div style="text-align: center; color: #64748b; padding: 24px;">No activity logs found.</div>`;
        } else {
            feedActions.forEach(action => {
                const item = document.createElement('div');
                item.className = 'feed-item-card';

                let iconClass = 'icon-system';
                let iconName = 'activity';
                let title = 'System Log';
                let desc = getActionReasonText(action);

                if (action.type === 'BAN') {
                    iconClass = action.permanent ? 'icon-ban' : 'icon-ban';
                    iconName = action.permanent ? 'flame' : 'gavel';
                    const player = players.find(p => p.id === action.playerId);
                    title = action.permanent ? 'Permanent Ban' : 'Temporary Ban';
                    desc = `<strong>${player ? escapeHtml(player.username) : 'Player'}</strong> banned for "${escapeHtml(getActionReasonText(action))}"`;
                } else if (action.type === 'WARN') {
                    iconClass = 'icon-warn';
                    iconName = 'alert-triangle';
                    const player = players.find(p => p.id === action.playerId);
                    title = 'Warning Strike';
                    desc = `<strong>${player ? escapeHtml(player.username) : 'Player'}</strong> received strike for "${escapeHtml(getActionReasonText(action))}"`;
                } else if (action.type === 'LAST_CHANCE') {
                    iconClass = 'icon-lastchance';
                    iconName = 'alert-octagon';
                    const player = players.find(p => p.id === action.playerId);
                    title = action.lastChanceRemoval ? 'Last Chance Lifted' : 'Last Chance Applied';
                    desc = `<strong>${player ? escapeHtml(player.username) : 'Player'}</strong>: "${escapeHtml(getActionReasonText(action))}"`;
                } else if (action.permanentBanRemoval || action.warningRemoval) {
                    iconClass = 'icon-check';
                    iconName = 'shield-check';
                    title = 'Sanction Revoked';
                    desc = `Pardoned: "${escapeHtml(getActionReasonText(action))}"`;
                }

                const timeStr = new Date(action.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = new Date(action.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

                item.innerHTML = `
                    <div class="feed-item-icon ${iconClass}">
                        <i data-lucide="${iconName}"></i>
                    </div>
                    <div class="feed-item-content">
                        <div class="feed-item-header">
                            <span class="feed-item-title">${title}</span>
                            <span class="feed-item-time">${dateStr} ${timeStr}</span>
                        </div>
                        <div class="feed-item-desc">${desc}</div>
                        ${action.moderator ? `<div style="margin-top: 3px;"><span class="feed-staff-tag"><i data-lucide="user" style="width: 11px; height: 11px;"></i> ${escapeHtml(action.moderator)}</span></div>` : ''}
                    </div>
                `;
                feedContainer.appendChild(item);
            });
        }
    }

    if (window.lucide && lucide.createIcons) {
        lucide.createIcons();
    }

    // Action Form Submit Hook
    const form = document.getElementById('action-form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        const playerId = document.getElementById('modal-player-id').value;
        const type = document.getElementById('action-type').value;
        const selectedReasons = window.reasonSelection || getSelectedReasons(document.getElementById('action-reason'));
        const isPermanent = type === 'BAN' ? document.getElementById('ban-type').value === 'PERMANENT' : false;
        const lastChance = type === 'BAN' && document.getElementById('last-chance').checked;

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

        // Validate reason is provided
        if (!selectedReasons.length) {
            showToast(`Add a reason for the ${type === 'WARN' ? 'Warn' : 'Ban'}`);
            return;
        }

        const reasonKeys = [...new Set(selectedReasons.map(extractReasonKey))];
        const reasonRaw = selectedReasons.join(', ');
        const reasonCount = {};
        reasonKeys.forEach(reasonKey => {
            reasonCount[reasonKey] = actions.filter(action =>
                (action.type === 'WARN' || action.type === 'BAN') &&
                getActionReasons(action).includes(reasonKey)
            ).length + 1;
        });

        const newAction = {
            id: `a${Date.now()}`,
            playerId,
            type,
            reason: reasonRaw,
            reasonKey: reasonKeys[0],
            reasonKeys,
            reasonRaw,
            reasonCount,
            moderator: document.getElementById('action-issuer').value.trim(),
            timestamp: new Date().toISOString(),
            permanent: isPermanent,
            lastChance
        };

        actions.push(newAction);
        
        // Update player status based on actual actions
        const playerIndex = players.findIndex(p => p.id === playerId);
        await ModAPI.saveActions(actions);
        if(playerIndex > -1) {
            const updatedActions = actions.filter(a => a.playerId === playerId);
            const pBans = updatedActions.filter(a => a.type === 'BAN' && isActionActive(a));
            const pWarns = updatedActions.filter(a => isWarningActive(a, updatedActions));
            let newStatus;
            if (pBans.some(b => b.permanent)) newStatus = 'Permanently Banned';
            else if (pBans.length > 0) newStatus = 'Banned';
            else if (pWarns.length > 0) newStatus = 'Warned';
            else newStatus = 'Clean';
            players[playerIndex].status = newStatus;
            await ModAPI.savePlayers(players);
        }
        
        closeModal();
        showToast(`${type} added successfully.`);
        initDashboard(); // Refresh UI without reload
    };
}

document.addEventListener('DOMContentLoaded', initDashboard);