async function initActivity() {
    const [players, actions] = await Promise.all([ModAPI.getPlayers(), ModAPI.getActions()]);
    const playerMap = new Map((players || []).map(p => [p.id, p]));

    function classifyAction(a) {
        if (a.permanentBanRemoval)                       return { cls: 'unbanned',   text: 'UNBANNED',            icon: 'unlock',         filterKey: 'UNBANNED' };
        if (a.warningRemoval)                            return { cls: 'active',     text: 'WARNING REMOVED',     icon: 'shield-check',   filterKey: 'WARNING_REMOVED' };
        if (a.lastChanceRemoval || a.lastChanceLifted)   return { cls: 'active',     text: 'LAST CHANCE LIFTED',  icon: 'shield-off',     filterKey: 'LC_LIFTED' };
        if (a.type === 'BAN' && a.permanent)             return { cls: 'permaban',   text: 'PERMANENTLY BANNED',  icon: 'flame',          filterKey: 'BAN' };
        if (a.type === 'BAN' && a.lastChance)            return { cls: 'lastchance', text: 'LAST CHANCE BAN',     icon: 'alert-octagon',  filterKey: 'BAN' };
        if (a.type === 'BAN')                            return { cls: 'ban',        text: 'TEMP BAN',            icon: 'clock',          filterKey: 'BAN' };
        if (a.type === 'LAST_CHANCE')                    return { cls: 'lastchance', text: 'LAST CHANCE',         icon: 'alert-octagon',  filterKey: 'LAST_CHANCE' };
        if (a.type === 'WARN')                           return { cls: 'warn',       text: 'WARN',                icon: 'alert-triangle', filterKey: 'WARN' };
        return { cls: 'warn', text: a.type || 'ACTION', icon: 'activity', filterKey: a.type || '' };
    }

    function render() {
        const searchF = (document.getElementById('filter-search')?.value || '').trim().toLowerCase();
        const typeF   = document.getElementById('filter-type')?.value || 'ALL';
        const catF    = document.getElementById('filter-category')?.value || 'ALL';

        const catSelect = document.getElementById('filter-category');
        if (catSelect) catSelect.style.display = typeF === 'BAN' ? 'block' : 'none';

        const tbody = document.getElementById('activity-tbody');
        if (!tbody) return;

        let data = (actions || []).slice().reverse();

        if (typeF !== 'ALL') {
            data = data.filter(a => classifyAction(a).filterKey === typeF);
        }
        if (typeF === 'BAN' && catF !== 'ALL') {
            data = data.filter(a => a.banCategory === catF);
        }

        if (searchF) {
            data = data.filter(a => {
                const p = playerMap.get(a.playerId);
                const pName = p ? p.username : (a.playerId === 'SYSTEM' ? 'SYSTEM' : 'Unknown');
                const otherMods = Array.isArray(a.otherModerators) ? a.otherModerators : (Array.isArray(a.otherStaffers) ? a.otherStaffers : []);
                const reasonTxt = getActionReasonText(a);
                const { text: badgeText } = classifyAction(a);
                return (
                    pName.toLowerCase().includes(searchF) ||
                    badgeText.toLowerCase().includes(searchF) ||
                    reasonTxt.toLowerCase().includes(searchF) ||
                    (a.moderator && a.moderator.toLowerCase().includes(searchF)) ||
                    otherMods.some(m => String(m).toLowerCase().includes(searchF)) ||
                    (a.banCategory && a.banCategory.toLowerCase().includes(searchF))
                );
            });
        }

        tbody.innerHTML = data.map(a => {
            const p = playerMap.get(a.playerId);
            const { cls: badgeCls, text: badgeText, icon: badgeIcon } = classifyAction(a);

            const playerCell = a.playerId === 'SYSTEM' && !a.warningRemoval
                ? '<span style="color:#64748b;font-weight:600;">SYSTEM</span>'
                : `<a href="player.html?id=${encodeURIComponent(a.playerId)}" style="color:var(--color-player); text-decoration:none; font-weight:600;">${escapeHtml(p ? p.username : 'Unknown')}</a>`;

            let catBadge = '<td>-</td>';
            if (a.permanentBanRemoval || a.warningRemoval || a.lastChanceRemoval || a.lastChanceLifted) {
                catBadge = `<td><span class="badge active">PARDON</span></td>`;
            } else if (a.type === 'BAN') {
                let catCls, catText;
                if (a.permanent)                     { catCls = 'permaban';    catText = 'PERMANENT'; }
                else if (a.lastChance)               { catCls = 'lastchance';  catText = 'LAST CHANCE'; }
                else if (a.banCategory === 'weapon') { catCls = 'weapon';      catText = 'WEAPON BAN'; }
                else                                 { catCls = 'traditional'; catText = 'TRADITIONAL'; }
                catBadge = `<td><span class="badge ${catCls}">${catText}</span></td>`;
            } else if (a.type === 'LAST_CHANCE') {
                catBadge = `<td><span class="badge lastchance">LAST CHANCE</span></td>`;
            } else if (a.type === 'WARN') {
                catBadge = `<td><span class="badge warn">STRIKE</span></td>`;
            }

            const otherMods = Array.isArray(a.otherModerators) && a.otherModerators.length
                ? a.otherModerators
                : (Array.isArray(a.otherStaffers) && a.otherStaffers.length ? a.otherStaffers : []);
            const otherModsHtml = otherMods.length
                ? `<span class="staff-others-pill" onclick="event.stopPropagation(); showStaffTeamModal('${escapeHtml(a.moderator || 'Staff')}', ${escapeHtml(JSON.stringify(otherMods))})" title="Click to view staff team"><i data-lucide="users" style="width: 10px; height: 10px;"></i> +${otherMods.length}</span>`
                : '';

            const dateStr = a.timestamp ? new Date(a.timestamp).toLocaleString() : '-';

            return `
                <tr>
                    <td style="white-space: nowrap; color: #94a3b8; font-size: 12.5px;">${dateStr}</td>
                    <td>${playerCell}</td>
                    <td><span class="badge ${badgeCls}"><i data-lucide="${badgeIcon}" style="width:11px;height:11px;display:inline-block;vertical-align:middle;margin-right:3px;"></i>${badgeText}</span></td>
                    ${catBadge}
                    <td>${escapeHtml(getActionReasonText(a))}</td>
                    <td>
                        <div style="display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                            <span>${escapeHtml(a.moderator || '-')}</span>
                            ${otherModsHtml}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    }

    let searchTimer = null;
    document.getElementById('filter-search')?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(render, 80);
    });
    document.getElementById('filter-type')?.addEventListener('change', render);
    document.getElementById('filter-category')?.addEventListener('change', render);
    render();
}
document.addEventListener('DOMContentLoaded', initActivity);
