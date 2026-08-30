let chartActivity, chartDist, chartCat, chartTrend, chartTopPlayers, chartSanctionsTime;
let stafferActions = [];
let periodActions = [];
let topPlayerStats = [];
let topPlayersSort = 'TOTAL';
let hourlySelectedDate = '';
let dailySelectedDate = '';
let monthlySelectedMonth = '';
let sanctionsChartMode = 'HOURLY';

window.selectStaffer = function(name) {
    if (!name) return;
    const search = document.getElementById('staffer-search');
    if (search) {
        search.value = name;
        const clearBtn = document.getElementById('staffer-search-clear');
        if (clearBtn) clearBtn.style.display = 'flex';
    }
    const dropdown = document.getElementById('staffer-custom-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    if (typeof renderStafferReport === 'function') {
        renderStafferReport(name);
    }
    const panel = document.querySelector('.staff-panel-pro') || document.getElementById('staffer-report');
    if (panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
};

function localDateKey(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function updateFirstCharts() {
    const startInput = document.getElementById('daily-chart-start');
    const endInput = document.getElementById('daily-chart-end');
    const reasonSelect = document.getElementById('daily-chart-reason');

    const startDate = startInput ? startInput.value : '';
    const endDate = endInput ? endInput.value : '';
    const selectedReason = reasonSelect ? reasonSelect.value : 'ALL';

    let selectedActions = periodActions;

    // Filter by date range
    if (startDate && endDate) {
        selectedActions = selectedActions.filter(action => {
            const d = localDateKey(action.timestamp);
            return d >= startDate && d <= endDate;
        });
    } else if (startDate) {
        selectedActions = selectedActions.filter(action => {
            const d = localDateKey(action.timestamp);
            return d >= startDate;
        });
    } else if (endDate) {
        selectedActions = selectedActions.filter(action => {
            const d = localDateKey(action.timestamp);
            return d <= endDate;
        });
    }

    // Filter by reason
    if (selectedReason && selectedReason !== 'ALL') {
        selectedActions = selectedActions.filter(action => {
            const reasons = getActionReasons(action);
            return reasons.includes(selectedReason);
        });
    }

    const warns = selectedActions.filter(action => action.type === 'WARN' && !action.warningRemoval);
    const bans = selectedActions.filter(action => action.type === 'BAN' && !action.permanent);
    const perms = selectedActions.filter(action => action.type === 'BAN' && action.permanent);
    const tradBans = selectedActions.filter(action => action.type === 'BAN' && action.banCategory === 'traditional');
    const weapBans = selectedActions.filter(action => action.type === 'BAN' && action.banCategory === 'weapon');
    updateCharts(warns, bans, perms, tradBans, weapBans, selectedReason, startDate, endDate);
}

function setupDailyChartFilter(actions) {
    periodActions = actions;

    const startInput = document.getElementById('daily-chart-start');
    const endInput = document.getElementById('daily-chart-end');
    const reasonSelect = document.getElementById('daily-chart-reason');
    const resetBtn = document.getElementById('daily-chart-reset');

    if (startInput) startInput.onchange = () => updateFirstCharts();
    if (endInput) endInput.onchange = () => updateFirstCharts();

    if (reasonSelect) {
        const previousReason = reasonSelect.value;
        const reasonSet = new Set();
        actions.forEach(a => {
            getActionReasons(a).forEach(r => {
                if (r) reasonSet.add(r);
            });
        });
        const reasons = [...reasonSet].sort((a, b) => a.localeCompare(b));
        reasonSelect.innerHTML = '<option value="ALL">All Reasons</option>' + reasons.map(r => `<option value="${r}">${r}</option>`).join('');
        reasonSelect.value = reasons.includes(previousReason) ? previousReason : 'ALL';
        reasonSelect.onchange = () => updateFirstCharts();
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            if (startInput) startInput.value = '';
            if (endInput) endInput.value = '';
            if (reasonSelect) reasonSelect.value = 'ALL';
            updateFirstCharts();
        };
    }
}

function durationInDays(action) {
    if (action.permanent) return null;
    const duration = Number(action.duration);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    return String(action.durationUnit || 'Days').toLowerCase().startsWith('hour') ? duration / 24 : duration;
}

function filteredDurations(durations) {
    if (durations.length < 4) return durations;
    const sorted = [...durations].sort((a, b) => a - b);
    const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
    const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
    const iqr = q3 - q1;
    const lower = Math.max(0, q1 - (iqr * 1.5));
    const upper = q3 + (iqr * 1.5);
    return durations.filter(duration => duration >= lower && duration <= upper);
}

let moderatorsCache = [];

function renderStafferReport(stafferName) {
    const report = document.getElementById('staffer-report');
    if (!report) return;
    const selectedNames = Array.isArray(stafferName) ? stafferName : stafferName ? [stafferName] : [];
    
    const clearBtn = document.getElementById('staffer-search-clear');
    if (clearBtn) clearBtn.style.display = selectedNames.length ? 'flex' : 'none';

    // Update active state on quick pills
    document.querySelectorAll('.staff-quick-pill').forEach(pill => {
        const pName = pill.dataset.staffer;
        pill.classList.toggle('active', selectedNames.length === 1 && selectedNames[0] === pName);
    });

    if (!selectedNames.length) {
        report.className = 'staffer-report-wrap';
        report.innerHTML = `
            <div class="staff-empty-state-pro">
                <div class="staff-empty-state-icon">
                    <i data-lucide="user-search" style="width: 30px; height: 30px;"></i>
                </div>
                <h4>Select a Staff Member</h4>
                <p>Choose any staffer from the search bar above or click one of the quick picks to inspect their sanction distribution, ban duration averages, and reasoning breakdown.</p>
            </div>
        `;
        if (window.lucide && lucide.createIcons) lucide.createIcons();
        return;
    }

    const selectedActions = stafferActions.filter(action => selectedNames.includes(action.moderator));
    const warns = selectedActions.filter(action => action.type === 'WARN' && !action.warningRemoval);
    const bans = selectedActions.filter(action => action.type === 'BAN');
    const permBans = bans.filter(action => action.permanent);
    const tempBans = bans.filter(action => !action.permanent);

    const reasonRows = (typeActions, themeClass) => {
        const counts = {};
        typeActions.forEach(action => getActionReasons(action).forEach(reason => {
            counts[reason] = (counts[reason] || 0) + 1;
        }));
        const total = typeActions.length;
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (!entries.length) {
            return `<div style="padding: 24px 0; text-align: center; color: #64748b; font-size: 12.5px;">No ${themeClass === 'warn-theme' ? 'warnings' : 'bans'} recorded for this staffer.</div>`;
        }
        return entries.map(([reason, count]) => {
            const pct = total ? Math.round(count / total * 100) : 0;
            return `
                <div class="staff-reason-item">
                    <div class="staff-reason-item-top">
                        <span class="staff-reason-name" title="${escapeHtml(reason)}">${escapeHtml(reason)}</span>
                        <span class="staff-reason-metric">${count} <span style="font-size: 11px; color: #64748b; font-weight: 500;">(${pct}%)</span></span>
                    </div>
                    <div class="staff-progress-track">
                        <div class="staff-progress-fill" style="width: ${Math.max(4, pct)}%;"></div>
                    </div>
                </div>
            `;
        }).join('');
    };

    const allDurations = bans.map(durationInDays).filter(duration => duration !== null);
    const cleanDurations = filteredDurations(allDurations);
    const average = cleanDurations.length ? cleanDurations.reduce((sum, duration) => sum + duration, 0) / cleanDurations.length : 0;
    
    const durationRows = bans.map(action => {
        const duration = durationInDays(action);
        const isPerm = Boolean(action.permanent);
        const label = isPerm ? 'Permanent' : duration === null ? 'Not specified' : `${duration % 1 === 0 ? duration : duration.toFixed(1)} Days`;
        const dateStr = action.timestamp ? new Date(action.timestamp).toLocaleDateString() : '-';
        return `
            <div class="staff-duration-item">
                <div class="staff-duration-date">
                    <i data-lucide="calendar" style="width: 12px; height: 12px; color: #64748b;"></i>
                    <span>${dateStr}</span>
                </div>
                <span class="staff-duration-pill ${isPerm ? 'perm' : 'temp'}">${label}</span>
            </div>
        `;
    }).join('') || '<div style="padding: 24px 0; text-align: center; color: #64748b; font-size: 12.5px;">No ban durations recorded.</div>';

    // Staffer Profile Banner
    let stafferMetaHtml = '';
    if (selectedNames.length === 1) {
        const stafferNameSingle = selectedNames[0];
        const modInfo = (moderatorsCache || []).find(m => m.name && m.name.toLowerCase() === stafferNameSingle.toLowerCase());
        const initial = stafferNameSingle.charAt(0).toUpperCase();
        const avatarStyle = modInfo?.avatarUrl ? `background-image: url('${escapeHtml(modInfo.avatarUrl)}'); background-size: cover;` : '';
        const totalSanctions = warns.length + bans.length;
        const banPct = totalSanctions ? Math.round(bans.length / totalSanctions * 100) : 0;
        const warnPct = totalSanctions ? Math.round(warns.length / totalSanctions * 100) : 0;

        stafferMetaHtml = `
            <div class="staff-profile-banner">
                <div class="staff-profile-left">
                    <div class="staff-profile-avatar" style="${avatarStyle}">
                        ${!modInfo?.avatarUrl ? initial : ''}
                    </div>
                    <div class="staff-profile-meta">
                        <h4>
                            <span>${escapeHtml(stafferNameSingle)}</span>
                        </h4>
                        <p>
                            <i data-lucide="shield" style="width: 13px; height: 13px; color: #818cf8;"></i>
                            <span>${modInfo?.discordId ? `Discord ID: ${escapeHtml(modInfo.discordId)}` : 'Staff Member'}</span>
                        </p>
                    </div>
                </div>
                <div class="staff-profile-tags">
                    <span class="staff-tag-pill total"><i data-lucide="layers" style="width: 13px; height: 13px;"></i> ${totalSanctions} Total Actions</span>
                    <span class="staff-tag-pill ratio"><i data-lucide="pie-chart" style="width: 13px; height: 13px;"></i> ${banPct}% Bans · ${warnPct}% Warns</span>
                </div>
            </div>
        `;
    }

    const totalSanctions = warns.length + bans.length;
    const warnRatioPct = totalSanctions ? Math.round(warns.length / totalSanctions * 100) : 0;
    const banRatioPct = totalSanctions ? Math.round(bans.length / totalSanctions * 100) : 0;
    const validSamplePct = bans.length ? Math.round(cleanDurations.length / bans.length * 100) : 0;

    report.className = 'staffer-report-wrap';
    report.innerHTML = `
        ${stafferMetaHtml}

        <!-- 4 Modern Glass KPI Cards -->
        <div class="staff-kpi-grid">
            <div class="staff-kpi-card warn-kpi">
                <div class="staff-kpi-icon-wrap">
                    <i data-lucide="alert-triangle" style="width: 20px; height: 20px;"></i>
                </div>
                <div>
                    <div class="staff-kpi-val">${warns.length}</div>
                    <div class="staff-kpi-lbl">Warns Given</div>
                    <div class="staff-kpi-sub">${warnRatioPct}% of staffer actions</div>
                </div>
            </div>

            <div class="staff-kpi-card ban-kpi">
                <div class="staff-kpi-icon-wrap">
                    <i data-lucide="ban" style="width: 20px; height: 20px;"></i>
                </div>
                <div>
                    <div class="staff-kpi-val">${bans.length}</div>
                    <div class="staff-kpi-lbl">Bans Given</div>
                    <div class="staff-kpi-sub">${permBans.length} Perm · ${tempBans.length} Temp</div>
                </div>
            </div>

            <div class="staff-kpi-card avg-kpi">
                <div class="staff-kpi-icon-wrap">
                    <i data-lucide="clock" style="width: 20px; height: 20px;"></i>
                </div>
                <div>
                    <div class="staff-kpi-val">${average ? average.toFixed(1) + 'd' : '-'}</div>
                    <div class="staff-kpi-lbl">Average Ban Duration</div>
                    <div class="staff-kpi-sub">Outlier-filtered median</div>
                </div>
            </div>

            <div class="staff-kpi-card acc-kpi">
                <div class="staff-kpi-icon-wrap">
                    <i data-lucide="sliders" style="width: 20px; height: 20px;"></i>
                </div>
                <div>
                    <div class="staff-kpi-val">${cleanDurations.length}/${bans.length}</div>
                    <div class="staff-kpi-lbl">Included Durations</div>
                    <div class="staff-kpi-sub">${validSamplePct}% duration accuracy</div>
                </div>
            </div>
        </div>

        <!-- 3 Modern Breakdown Cards Grid -->
        <div class="staff-breakdown-grid">
            <div class="staff-card-panel warn-theme">
                <div class="staff-card-panel-header">
                    <div class="staff-card-panel-title">
                        <i data-lucide="alert-triangle" style="width: 16px; height: 16px; color: #f59e0b;"></i>
                        <span>Warn Reasons</span>
                    </div>
                    <span class="staff-card-panel-badge">${warns.length} total</span>
                </div>
                <div class="staff-reason-list">
                    ${reasonRows(warns, 'warn-theme')}
                </div>
            </div>

            <div class="staff-card-panel ban-theme">
                <div class="staff-card-panel-header">
                    <div class="staff-card-panel-title">
                        <i data-lucide="shield-alert" style="width: 16px; height: 16px; color: #ef4444;"></i>
                        <span>Ban Reasons</span>
                    </div>
                    <span class="staff-card-panel-badge">${bans.length} total</span>
                </div>
                <div class="staff-reason-list">
                    ${reasonRows(bans, 'ban-theme')}
                </div>
            </div>

            <div class="staff-card-panel">
                <div class="staff-card-panel-header">
                    <div class="staff-card-panel-title">
                        <i data-lucide="calendar" style="width: 16px; height: 16px; color: #818cf8;"></i>
                        <span>Ban Durations</span>
                    </div>
                    <span class="staff-card-panel-badge">${bans.length} logs</span>
                </div>
                <div class="staff-duration-timeline">
                    ${durationRows}
                </div>
            </div>
        </div>
    `;

    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function setupStafferSearch(actions, moderators = []) {
    moderatorsCache = moderators || [];
    stafferActions = actions.filter(action => (action.type === 'WARN' && !action.warningRemoval) || action.type === 'BAN');
    const stafferNames = [...new Set(stafferActions.map(action => action.moderator).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    
    // Calculate staffer counts for dropdown counts
    const stafferCounts = {};
    stafferActions.forEach(a => {
        if (a.moderator) stafferCounts[a.moderator] = (stafferCounts[a.moderator] || 0) + 1;
    });

    const search = document.getElementById('staffer-search');
    const clearBtn = document.getElementById('staffer-search-clear');
    const dropdown = document.getElementById('staffer-custom-dropdown');
    let focusedIndex = -1;

    function renderDropdownList(filterQuery = '') {
        if (!dropdown) return;
        const normalized = filterQuery.toLowerCase().trim();
        const matches = normalized
            ? stafferNames.filter(name => name.toLowerCase().includes(normalized))
            : stafferNames;

        if (!matches.length) {
            dropdown.innerHTML = `<div class="staff-dropdown-empty">No staffer matching "${escapeHtml(filterQuery)}"</div>`;
            dropdown.style.display = 'flex';
            return;
        }

        dropdown.innerHTML = matches.map((name, idx) => {
            const count = stafferCounts[name] || 0;
            const modInfo = (moderatorsCache || []).find(m => m.name && m.name.toLowerCase() === name.toLowerCase());
            const initial = name.charAt(0).toUpperCase();
            const avatarStyle = modInfo?.avatarUrl ? `background-image: url('${escapeHtml(modInfo.avatarUrl)}'); background-size: cover;` : '';
            return `
                <div class="staff-dropdown-item ${search && search.value.trim().toLowerCase() === name.toLowerCase() ? 'focused' : ''}" data-index="${idx}" data-staffer="${escapeHtml(name)}">
                    <div class="staff-dropdown-item-left">
                        <div class="staff-dropdown-avatar" style="${avatarStyle}">
                            ${!modInfo?.avatarUrl ? initial : ''}
                        </div>
                        <span class="staff-dropdown-name">${escapeHtml(name)}</span>
                    </div>
                    <span class="staff-dropdown-count">${count} actions</span>
                </div>
            `;
        }).join('');

        dropdown.querySelectorAll('.staff-dropdown-item').forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                const name = item.dataset.staffer;
                selectStaffer(name);
            };
        });

        dropdown.style.display = 'flex';
        focusedIndex = -1;
    }

    function selectStaffer(name) {
        if (!name) return;
        if (search) {
            search.value = name;
            if (clearBtn) clearBtn.style.display = 'flex';
        }
        if (dropdown) dropdown.style.display = 'none';
        renderStafferReport(name);
        const panel = document.querySelector('.staff-panel-pro') || document.getElementById('staffer-report');
        if (panel) {
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    window.selectStaffer = selectStaffer;
    window.selectStafferQuickPick = (name) => {
        selectStaffer(name);
    };

    if (search) {
        search.onfocus = () => {
            renderDropdownList(search.value);
        };

        search.onclick = () => {
            renderDropdownList(search.value);
        };

        search.oninput = (e) => {
            const typed = e.target.value;
            renderDropdownList(typed);
            const normalized = typed.trim().toLowerCase();
            const matches = normalized ? stafferNames.filter(n => n.toLowerCase().includes(normalized)) : [];
            renderStafferReport(matches.length === 1 ? matches[0] : matches);
        };

        search.onkeydown = (e) => {
            if (!dropdown || dropdown.style.display === 'none') {
                if (e.key === 'ArrowDown') {
                    renderDropdownList(search.value);
                    return;
                }
                return;
            }
            const items = dropdown.querySelectorAll('.staff-dropdown-item');
            if (!items.length) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusedIndex = (focusedIndex + 1) % items.length;
                updateFocus(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                focusedIndex = (focusedIndex - 1 + items.length) % items.length;
                updateFocus(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (focusedIndex >= 0 && items[focusedIndex]) {
                    selectStaffer(items[focusedIndex].dataset.staffer);
                } else if (items.length > 0) {
                    selectStaffer(items[0].dataset.staffer);
                }
            } else if (e.key === 'Escape') {
                dropdown.style.display = 'none';
            }
        };
    }

    function updateFocus(items) {
        items.forEach((item, idx) => {
            const isFoc = idx === focusedIndex;
            item.classList.toggle('focused', isFoc);
            if (isFoc) item.scrollIntoView({ block: 'nearest' });
        });
    }

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        const wrap = document.getElementById('staff-search-wrap');
        if (wrap && !wrap.contains(e.target) && dropdown) {
            dropdown.style.display = 'none';
        }
    });

    if (clearBtn && search) {
        clearBtn.onclick = () => {
            search.value = '';
            if (dropdown) dropdown.style.display = 'none';
            renderStafferReport('');
            search.focus();
        };
    }

    renderStafferReport('');
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function renderTopPlayersChart() {
    if (chartTopPlayers) chartTopPlayers.destroy();
    const sortedPlayers = [...topPlayerStats].sort((a, b) => {
        if (topPlayersSort === 'WARNS') return b.warns - a.warns || b.total - a.total;
        if (topPlayersSort === 'BANS') return b.bans - a.bans || b.total - a.total;
        return b.total - a.total;
    }).slice(0, 6);
    const topCtx = document.getElementById('topPlayersChart');
    if (!topCtx) return;

    const themeColor = topPlayersSort === 'WARNS' ? '#f59e0b' : topPlayersSort === 'BANS' ? '#ef4444' : '#fb7185';

    chartTopPlayers = new Chart(topCtx, {
        type: 'bar',
        data: {
            labels: sortedPlayers.map(player => player.username),
            datasets: [{
                label: topPlayersSort === 'WARNS' ? 'Warns' : topPlayersSort === 'BANS' ? 'Bans' : 'Sanctions',
                data: sortedPlayers.map(player => topPlayersSort === 'WARNS' ? player.warns : topPlayersSort === 'BANS' ? player.bans : player.total),
                backgroundColor: themeColor,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8', precision: 0 }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#f1f5f9', font: { weight: '600', size: 12 } }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#ffffff',
                    bodyColor: '#cbd5e1',
                    borderColor: 'rgba(255, 255, 255, 0.12)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        afterLabel: () => '👉 Click to view player profile'
                    }
                }
            }
        }
    });

    topCtx.style.cursor = 'pointer';
    topCtx.onclick = (e) => {
        if (!chartTopPlayers || !chartTopPlayers.scales || !chartTopPlayers.scales.y) return;
        const rect = topCtx.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const index = chartTopPlayers.scales.y.getValueForPixel(y);
        if (index >= 0 && index < sortedPlayers.length) {
            const player = sortedPlayers[index];
            if (player && player.id) {
                window.location.href = `player.html?id=${encodeURIComponent(player.id)}`;
            }
        }
    };
}

function updateSanctionsTimeChart(sanctions) {
    const chartCanvas = document.getElementById('sanctionsTimeChart');
    if (!chartCanvas) return;
    if (chartSanctionsTime) chartSanctionsTime.destroy();

    let chartLabels = [];

    if (sanctionsChartMode === 'MONTHLY' || sanctionsChartMode === 'DAILY') {
        const selectedSanctions = sanctions.filter(action => {
            const date = new Date(action.timestamp);
            if (sanctionsChartMode === 'DAILY') return dailySelectedDate && localDateKey(action.timestamp) === dailySelectedDate;
            const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            return monthlySelectedMonth ? month === monthlySelectedMonth : true;
        });
        const stafferCounts = {};
        selectedSanctions.forEach(action => {
            const staffer = action.moderator || 'Unknown';
            if (!stafferCounts[staffer]) stafferCounts[staffer] = { WARN: 0, BAN: 0 };
            stafferCounts[staffer][action.type]++;
        });
        const staffers = Object.entries(stafferCounts).sort((a, b) => (b[1].WARN + b[1].BAN) - (a[1].WARN + a[1].BAN) || a[0].localeCompare(b[0]));
        chartLabels = staffers.map(entry => entry[0]);

        const chartWrap = document.getElementById('sanctionsTimeChartWrap') || chartCanvas.parentElement;
        const chartCard = chartCanvas.closest('.sanctions-time-card');
        if (chartCard) { chartCard.style.height = 'auto'; chartCard.style.minHeight = '0'; }
        if (chartWrap) chartWrap.style.height = `${Math.max(150, staffers.length * 30 + 55)}px`;

        chartSanctionsTime = new Chart(chartCanvas, {
            type: 'bar',
            data: {
                labels: chartLabels,
                datasets: [
                    { label: 'Warns', data: staffers.map(entry => entry[1].WARN), backgroundColor: '#f59e0b', borderRadius: 4 },
                    { label: 'Bans', data: staffers.map(entry => entry[1].BAN), backgroundColor: '#ef4444', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                layout: { padding: { top: 0, bottom: 0, left: 0, right: 8 } },
                scales: {
                    x: {
                        stacked: true,
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', precision: 0 }
                    },
                    y: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { color: '#f1f5f9', autoSkip: false, font: { weight: '600', size: 12 } }
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#cbd5e1', font: { weight: '600' }, boxWidth: 14, padding: 16 }
                    },
                    title: {
                        display: true,
                        text: sanctionsChartMode === 'DAILY' ? 'Daily Sanctions by Staffer' : 'Monthly Sanctions by Staffer',
                        color: '#94a3b8',
                        font: { size: 12.5, weight: '500' }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#ffffff',
                        bodyColor: '#cbd5e1',
                        borderColor: 'rgba(255, 255, 255, 0.12)',
                        borderWidth: 1,
                        padding: 10,
                        cornerRadius: 8,
                        callbacks: {
                            afterLabel: () => '👉 Click to view staffer performance'
                        }
                    }
                }
            }
        });
    } else {
        const selectedSanctions = hourlySelectedDate
            ? sanctions.filter(action => localDateKey(action.timestamp) === hourlySelectedDate)
            : sanctions;
        const timeBands = ['0-7', '7-14', '14-20', '20-0'];
        const bandLabels = ['Night (00:00 - 07:00)', 'Morning (07:00 - 14:00)', 'Afternoon (14:00 - 20:00)', 'Evening / Night (20:00 - 00:00)'];
        const bandColors = ['#38bdf8', '#34d399', '#f59e0b', '#fb7185'];
        const counts = {};
        selectedSanctions.forEach(action => {
            const hour = new Date(action.timestamp).getHours();
            const band = hour < 7 ? '0-7' : hour < 14 ? '7-14' : hour < 20 ? '14-20' : '20-0';
            const moderator = action.moderator || 'Unknown';
            if (!counts[moderator]) counts[moderator] = { moderator, total: 0, values: [0, 0, 0, 0], types: [0, 0, 0, 0].map(() => ({ WARN: 0, BAN: 0 })) };
            const bandIndex = timeBands.indexOf(band);
            counts[moderator].values[bandIndex]++;
            counts[moderator].types[bandIndex][action.type]++;
            counts[moderator].total++;
        });
        const staffers = Object.values(counts).sort((a, b) => b.total - a.total || a.moderator.localeCompare(b.moderator));
        chartLabels = staffers.map(entry => entry.moderator);

        const chartWrap = document.getElementById('sanctionsTimeChartWrap') || chartCanvas.parentElement;
        const chartCard = chartCanvas.closest('.sanctions-time-card');
        if (chartCard) { chartCard.style.height = 'auto'; chartCard.style.minHeight = '0'; }
        if (chartWrap) chartWrap.style.height = `${Math.max(150, staffers.length * 30 + 55)}px`;
        const datasets = timeBands.map((band, bandIndex) => ({
            label: bandLabels[bandIndex],
            data: staffers.map(entry => entry.values[bandIndex]),
            backgroundColor: bandColors[bandIndex],
            borderRadius: 4,
            borderWidth: 0,
            stafferTypes: staffers.map(entry => entry.types[bandIndex])
        }));
        chartSanctionsTime = new Chart(chartCanvas, {
            type: 'bar',
            data: { labels: chartLabels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 0, bottom: 0, left: 0, right: 8 } },
                scales: {
                    x: {
                        stacked: true,
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', precision: 0 },
                        title: { display: true, text: 'Sanctions Count', color: '#94a3b8', font: { size: 11 } }
                    },
                    y: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { color: '#f1f5f9', autoSkip: false, font: { weight: '600', size: 12 } },
                        title: { display: true, text: 'Staffer', color: '#94a3b8', font: { size: 11 } }
                    }
                },
                indexAxis: 'y',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#cbd5e1', font: { weight: '600' }, boxWidth: 14, padding: 14 }
                    },
                    title: {
                        display: true,
                        text: 'Sanctions by Staffer and Time Band Distribution',
                        color: '#94a3b8',
                        font: { size: 12.5, weight: '500' }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#ffffff',
                        bodyColor: '#cbd5e1',
                        borderColor: 'rgba(255, 255, 255, 0.12)',
                        borderWidth: 1,
                        padding: 10,
                        cornerRadius: 8,
                        callbacks: {
                            label: context => {
                                const types = context.dataset.stafferTypes[context.dataIndex];
                                return `${context.dataset.label}: ${context.raw} (Warns: ${types.WARN}, Bans: ${types.BAN})`;
                            },
                            afterLabel: () => '👉 Click to view staffer performance'
                        }
                    }
                }
            }
        });
    }

    chartCanvas.style.cursor = 'pointer';
    chartCanvas.onclick = (e) => {
        if (!chartSanctionsTime || !chartSanctionsTime.scales || !chartSanctionsTime.scales.y) return;
        const rect = chartCanvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const index = chartSanctionsTime.scales.y.getValueForPixel(y);
        if (index >= 0 && index < chartLabels.length) {
            const stafferName = chartLabels[index];
            if (stafferName && typeof window.selectStaffer === 'function') {
                window.selectStaffer(stafferName);
            }
        }
    };
}

function setupAnalyticsSortControls() {
    document.querySelectorAll('[data-analytics-sort]').forEach(button => {
        button.onclick = () => {
            topPlayersSort = button.dataset.analyticsSort;
            document.querySelectorAll('[data-analytics-sort]').forEach(control => control.classList.toggle('active', control === button));
            renderTopPlayersChart();
        };
    });
}

function setupSanctionsChartModeControls() {
    const hourlyButton = document.getElementById('hourly-view-button');
    const dailyButton = document.getElementById('daily-view-button');
    const monthlyButton = document.getElementById('monthly-view-button');
    const dailyDateControls = document.getElementById('daily-date-controls');
    const monthlyDateControls = document.getElementById('monthly-date-controls');
    const setActiveMode = mode => {
        sanctionsChartMode = mode;
        hourlyButton.classList.toggle('active', mode === 'HOURLY');
        dailyButton.classList.toggle('active', mode === 'DAILY');
        monthlyButton.classList.toggle('active', mode === 'MONTHLY');
        dailyDateControls.style.display = mode === 'DAILY' ? 'flex' : 'none';
        monthlyDateControls.style.display = mode === 'MONTHLY' ? 'flex' : 'none';
        updateSanctionsTimeChart(periodActions);
    };
    hourlyButton.onclick = () => {
        setActiveMode('HOURLY');
    };
    dailyButton.onclick = () => {
        setActiveMode('DAILY');
    };
    monthlyButton.onclick = () => {
        setActiveMode('MONTHLY');
    };
}

function setupSanctionsDateControls(allActions) {
    const dailyDate = document.getElementById('daily-date');
    const monthlyDate = document.getElementById('monthly-date');
    const dailyDates = [...new Set(allActions.map(action => localDateKey(action.timestamp)).filter(Boolean))].sort().reverse();
    const monthlyDates = [...new Set(dailyDates.map(date => date.slice(0, 7)))].sort().reverse();
    dailyDate.innerHTML = dailyDates.map(date => `<option value="${date}">${new Date(`${date}T00:00:00`).toLocaleDateString()}</option>`).join('');
    dailySelectedDate = dailyDates[0] || '';
    dailyDate.value = dailySelectedDate;
    monthlyDate.innerHTML = monthlyDates.map(month => `<option value="${month}">${month}</option>`).join('');
    monthlySelectedMonth = monthlyDates[0] || '';
    monthlyDate.value = monthlySelectedMonth;
    dailyDate.onchange = () => {
        dailySelectedDate = dailyDate.value;
        updateSanctionsTimeChart(periodActions);
    };
    monthlyDate.onchange = () => {
        monthlySelectedMonth = monthlyDate.value;
        updateSanctionsTimeChart(periodActions);
    };
}

let timeBandState = {
    allActions: [],
    players: [],
    periodActions: [],
    selectedBand: 'ALL',
    singleHour: null,
    customStart: 0,
    customEnd: 23,
    search: '',
    category: 'ALL',
    moderator: 'ALL',
    date: 'ALL',
    initialized: false
};

function getActionHour(action) {
    if (!action || !action.timestamp) return -1;
    const d = new Date(action.timestamp);
    return isNaN(d.getTime()) ? -1 : d.getHours();
}

function isHourInBand(hour, band, singleHour, customStart, customEnd) {
    if (hour < 0 || hour > 23) return false;
    if (band === 'SINGLE_HOUR') return hour === singleHour;
    if (band === 'ALL') return true;
    if (band === '0-7') return hour >= 0 && hour < 7;
    if (band === '7-14') return hour >= 7 && hour < 14;
    if (band === '14-20') return hour >= 14 && hour < 20;
    if (band === '20-0') return hour >= 20 && hour <= 23;
    if (band === 'CUSTOM') {
        const s = Number(customStart);
        const e = Number(customEnd);
        if (s <= e) return hour >= s && hour <= e;
        return hour >= s || hour <= e;
    }
    return true;
}

function renderTimeBandExplorer() {
    const { allActions, players, periodActions, selectedBand, singleHour, customStart, customEnd, search, category, moderator, date } = timeBandState;
    const allBans = periodActions.filter(a => a.type === 'BAN');
    const playerMap = new Map(players.map(p => [p.id, p]));

    // 1. Calculate preset band counts (based on bans matching non-hourly filters)
    const baseFilteredBans = allBans.filter(action => {
        if (category !== 'ALL') {
            if (category === 'permaban' && !action.permanent) return false;
            if (category === 'traditional' && (action.permanent || action.banCategory !== 'traditional')) return false;
            if (category === 'weapon' && (action.permanent || action.banCategory !== 'weapon')) return false;
        }
        if (moderator !== 'ALL' && (action.moderator || 'Unknown') !== moderator) return false;
        if (date !== 'ALL' && localDateKey(action.timestamp) !== date) return false;
        if (search) {
            const p = playerMap.get(action.playerId);
            const pName = p ? p.username : (action.playerId || '');
            const reason = getActionReasonText(action);
            const mod = action.moderator || '';
            const note = action.note || '';
            const dt = new Date(action.timestamp).toLocaleString();
            const textToMatch = `${pName} ${reason} ${mod} ${note} ${dt}`.toLowerCase();
            if (!textToMatch.includes(search)) return false;
        }
        return true;
    });

    const countAll = baseFilteredBans.length;
    const count0_7 = baseFilteredBans.filter(a => { const h = getActionHour(a); return h >= 0 && h < 7; }).length;
    const count7_14 = baseFilteredBans.filter(a => { const h = getActionHour(a); return h >= 7 && h < 14; }).length;
    const count14_20 = baseFilteredBans.filter(a => { const h = getActionHour(a); return h >= 14 && h < 20; }).length;
    const count20_0 = baseFilteredBans.filter(a => { const h = getActionHour(a); return h >= 20 && h <= 23; }).length;

    const elCountAll = document.getElementById('pill-count-all');
    const elCount0_7 = document.getElementById('pill-count-0-7');
    const elCount7_14 = document.getElementById('pill-count-7-14');
    const elCount14_20 = document.getElementById('pill-count-14-20');
    const elCount20_0 = document.getElementById('pill-count-20-0');

    if (elCountAll) elCountAll.innerText = countAll;
    if (elCount0_7) elCount0_7.innerText = count0_7;
    if (elCount7_14) elCount7_14.innerText = count7_14;
    if (elCount14_20) elCount14_20.innerText = count14_20;
    if (elCount20_0) elCount20_0.innerText = count20_0;

    // Update preset pills active classes
    document.querySelectorAll('#timeband-presets .timeband-pill').forEach(pill => {
        const band = pill.dataset.band;
        if (selectedBand === 'SINGLE_HOUR') {
            pill.classList.remove('active');
        } else {
            pill.classList.toggle('active', band === selectedBand);
        }
    });

    // 2. Render 24-Hour Distribution Histogram
    const hourlyCounts = new Array(24).fill(0);
    baseFilteredBans.forEach(a => {
        const h = getActionHour(a);
        if (h >= 0 && h <= 23) hourlyCounts[h]++;
    });
    const maxHourly = Math.max(...hourlyCounts, 1);

    const histBars = document.getElementById('timeband-histogram-bars');
    if (histBars) {
        histBars.innerHTML = hourlyCounts.map((cnt, h) => {
            const pct = (cnt / maxHourly) * 100;
            const inBand = isHourInBand(h, selectedBand, singleHour, customStart, customEnd);
            const isSingle = selectedBand === 'SINGLE_HOUR' && singleHour === h;
            const hStr = String(h).padStart(2, '0');
            const nextHStr = String((h + 1) % 24).padStart(2, '0');
            const tooltip = `Hour ${hStr}:00 - ${nextHStr}:00: ${cnt} bans`;
            const cls = isSingle ? 'active-single' : (inBand ? 'in-band' : '');
            return `
                <div class="timeband-hour-col ${cls}" data-hour="${h}" data-tooltip="${tooltip}">
                    <div class="bar-fill" style="height: ${Math.max(5, pct)}%;"></div>
                    <span class="hour-label">${hStr}</span>
                </div>
            `;
        }).join('');

        histBars.querySelectorAll('.timeband-hour-col').forEach(col => {
            col.onclick = () => {
                const clickedH = parseInt(col.dataset.hour);
                if (timeBandState.selectedBand === 'SINGLE_HOUR' && timeBandState.singleHour === clickedH) {
                    timeBandState.selectedBand = 'ALL';
                    timeBandState.singleHour = null;
                } else {
                    timeBandState.selectedBand = 'SINGLE_HOUR';
                    timeBandState.singleHour = clickedH;
                }
                const customBox = document.getElementById('timeband-custom-range-box');
                if (customBox) customBox.style.display = 'none';
                renderTimeBandExplorer();
            };
        });
    }

    // Active label
    const labelEl = document.getElementById('timeband-active-hour-label');
    if (labelEl) {
        if (selectedBand === 'SINGLE_HOUR') {
            const hStr = String(singleHour).padStart(2, '0');
            const nextHStr = String((singleHour + 1) % 24).padStart(2, '0');
            labelEl.innerText = `Single Hour: ${hStr}:00 - ${nextHStr}:00 (click again to reset)`;
        } else if (selectedBand === '0-7') {
            labelEl.innerText = `Night Band (00:00 - 07:00)`;
        } else if (selectedBand === '7-14') {
            labelEl.innerText = `Morning Band (07:00 - 14:00)`;
        } else if (selectedBand === '14-20') {
            labelEl.innerText = `Afternoon Band (14:00 - 20:00)`;
        } else if (selectedBand === '20-0') {
            labelEl.innerText = `Evening / Night Band (20:00 - 00:00)`;
        } else if (selectedBand === 'CUSTOM') {
            const sStr = String(customStart).padStart(2, '0');
            const eStr = String(customEnd).padStart(2, '0');
            labelEl.innerText = `Custom Band: ${sStr}:00 - ${eStr}:00`;
        } else {
            labelEl.innerText = `All hours (00:00 - 24:00)`;
        }
    }

    // 3. Filter final bans to display in table and KPIs
    const finalBans = baseFilteredBans.filter(action => {
        const h = getActionHour(action);
        return isHourInBand(h, selectedBand, singleHour, customStart, customEnd);
    }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // 4. Update Summary KPIs
    const statCount = document.getElementById('timeband-stat-count');
    const statPeak = document.getElementById('timeband-stat-peak');
    const statReason = document.getElementById('timeband-stat-reason');
    const statMod = document.getElementById('timeband-stat-mod');
    const badgeText = document.getElementById('timeband-total-badge-text');

    if (statCount) statCount.innerText = `${finalBans.length} (${countAll ? Math.round(finalBans.length / countAll * 100) : 0}%)`;
    if (badgeText) badgeText.innerText = `${finalBans.length} ${finalBans.length === 1 ? 'Ban Found' : 'Bans Found'}`;

    // Peak hour
    const finalHourCounts = {};
    finalBans.forEach(a => {
        const h = getActionHour(a);
        if (h >= 0) finalHourCounts[h] = (finalHourCounts[h] || 0) + 1;
    });
    const peakHourEntry = Object.entries(finalHourCounts).sort((a, b) => b[1] - a[1])[0];
    if (statPeak) {
        if (peakHourEntry) {
            const h = parseInt(peakHourEntry[0]);
            const nextH = (h + 1) % 24;
            statPeak.innerText = `${String(h).padStart(2, '0')}:00 - ${String(nextH).padStart(2, '0')}:00 (${peakHourEntry[1]})`;
        } else {
            statPeak.innerText = '-';
        }
    }

    // Most common reason
    const reasonCounts = {};
    finalBans.forEach(a => {
        getActionReasons(a).forEach(r => {
            reasonCounts[r] = (reasonCounts[r] || 0) + 1;
        });
    });
    const topReasonEntry = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];
    if (statReason) {
        if (topReasonEntry) {
            statReason.innerText = `${topReasonEntry[0]} (${topReasonEntry[1]})`;
            statReason.title = `${topReasonEntry[0]} (${topReasonEntry[1]})`;
        } else {
            statReason.innerText = '-';
            statReason.title = '-';
        }
    }

    // Top moderator
    const modCounts = {};
    finalBans.forEach(a => {
        const mod = a.moderator || 'Unknown';
        modCounts[mod] = (modCounts[mod] || 0) + 1;
    });
    const topModEntry = Object.entries(modCounts).sort((a, b) => b[1] - a[1])[0];
    if (statMod) {
        statMod.innerText = topModEntry ? `${topModEntry[0]} (${topModEntry[1]})` : '-';
    }

    // 5. Render Table
    const tbody = document.getElementById('timeband-bans-tbody');
    const emptyState = document.getElementById('timeband-empty-state');
    if (tbody && emptyState) {
        if (finalBans.length === 0) {
            tbody.innerHTML = '';
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
            tbody.innerHTML = finalBans.slice(0, 150).map(action => {
                const player = playerMap.get(action.playerId);
                const d = new Date(action.timestamp);
                const timeStr = !isNaN(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '--:--';
                const dateStr = !isNaN(d.getTime()) ? d.toLocaleDateString() : '';

                const badgeCls = action.permanent ? 'permaban' : (action.banCategory === 'weapon' ? 'weapon' : 'traditional');
                const badgeText = action.permanent ? 'PERMANENT' : (action.banCategory === 'weapon' ? 'WEAPON BAN' : 'TRADITIONAL BAN');
                const reasonsText = getActionReasonText(action);
                const durationLabel = action.permanent ? '<span style="color:var(--color-permaban); font-weight:700;">Permanent</span>' : (action.duration ? `${action.duration} ${action.durationUnit || 'Days'}` : '-');

                return `
                    <tr>
                        <td>
                            <div style="display:flex; flex-direction:column; gap:2px;">
                                <span class="time-badge"><i data-lucide="clock" style="width:12px;height:12px;"></i> ${timeStr}</span>
                                <span style="font-size:11px; color:var(--text-secondary);">${dateStr}</span>
                            </div>
                        </td>
                        <td>
                            <a href="player.html?id=${encodeURIComponent(action.playerId)}" style="color:var(--text-primary); font-weight:600; text-decoration:none;">
                                ${player ? player.username : (action.playerId || 'Unknown')}
                            </a>
                        </td>
                        <td><span class="badge ${badgeCls}">${badgeText}</span></td>
                        <td style="max-width:240px; word-break:break-word;">${reasonsText}</td>
                        <td>${durationLabel}</td>
                        <td><span style="color:var(--text-secondary); font-size:13px;">${action.moderator || 'Unknown'}</span></td>
                        <td>
                            <button class="cta" style="width:auto; margin:0; padding:4px 10px; font-size:12px;" onclick="location.href='player.html?id=${encodeURIComponent(action.playerId)}'">View</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
}

function setupTimeBandBanExplorer(allActions, players, periodActions) {
    if (!document.getElementById('timeband-explorer-card')) return;
    timeBandState.allActions = allActions;
    timeBandState.players = players;
    timeBandState.periodActions = periodActions;

    const allBans = allActions.filter(a => a.type === 'BAN');

    // Populate custom range select dropdowns if not done yet
    const customStartSelect = document.getElementById('timeband-custom-start');
    const customEndSelect = document.getElementById('timeband-custom-end');
    if (customStartSelect && customStartSelect.options.length === 0) {
        for (let h = 0; h < 24; h++) {
            const hStr = `${String(h).padStart(2, '0')}:00`;
            customStartSelect.innerHTML += `<option value="${h}">${hStr}</option>`;
            customEndSelect.innerHTML += `<option value="${h}" ${h === 23 ? 'selected' : ''}>${hStr}</option>`;
        }
    }

    // Populate moderator dropdown
    const modSelect = document.getElementById('timeband-moderator-select');
    if (modSelect) {
        const currentMod = modSelect.value || 'ALL';
        const moderators = [...new Set(allBans.map(a => a.moderator).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        modSelect.innerHTML = '<option value="ALL">All Staffers</option>' + moderators.map(m => `<option value="${m}">${m}</option>`).join('');
        if (moderators.includes(currentMod) || currentMod === 'ALL') {
            modSelect.value = currentMod;
        }
    }

    // Populate date dropdown
    const dateSelect = document.getElementById('timeband-date-select');
    if (dateSelect) {
        const currentDate = dateSelect.value || 'ALL';
        const dates = [...new Set(allBans.map(a => localDateKey(a.timestamp)).filter(Boolean))].sort().reverse();
        dateSelect.innerHTML = '<option value="ALL">All Dates</option>' + dates.map(d => `<option value="${d}">${new Date(`${d}T00:00:00`).toLocaleDateString()}</option>`).join('');
        if (dates.includes(currentDate) || currentDate === 'ALL') {
            dateSelect.value = currentDate;
        }
    }

    // Set up events once
    if (!timeBandState.initialized) {
        timeBandState.initialized = true;

        // Preset band pills
        document.querySelectorAll('#timeband-presets .timeband-pill').forEach(pill => {
            pill.onclick = () => {
                const band = pill.dataset.band;
                timeBandState.selectedBand = band;
                timeBandState.singleHour = null;

                const customBox = document.getElementById('timeband-custom-range-box');
                if (customBox) {
                    customBox.style.display = band === 'CUSTOM' ? 'flex' : 'none';
                }
                renderTimeBandExplorer();
            };
        });

        // Search input
        const searchInput = document.getElementById('timeband-search-input');
        if (searchInput) {
            searchInput.oninput = (e) => {
                timeBandState.search = e.target.value.trim().toLowerCase();
                renderTimeBandExplorer();
            };
        }

        // Category select
        const catSelect = document.getElementById('timeband-category-select');
        if (catSelect) {
            catSelect.onchange = (e) => {
                timeBandState.category = e.target.value;
                renderTimeBandExplorer();
            };
        }

        // Moderator select
        if (modSelect) {
            modSelect.onchange = (e) => {
                timeBandState.moderator = e.target.value;
                renderTimeBandExplorer();
            };
        }

        // Date select
        if (dateSelect) {
            dateSelect.onchange = (e) => {
                timeBandState.date = e.target.value;
                renderTimeBandExplorer();
            };
        }

        // Custom range selectors
        if (customStartSelect && customEndSelect) {
            customStartSelect.onchange = (e) => {
                timeBandState.customStart = parseInt(e.target.value);
                renderTimeBandExplorer();
            };
            customEndSelect.onchange = (e) => {
                timeBandState.customEnd = parseInt(e.target.value);
                renderTimeBandExplorer();
            };
        }
    }

    renderTimeBandExplorer();
}

let trendTimelineState = {
    allActions: [],
    mode: 'bar',
    startDate: '',
    endDate: '',
    minDate: '',
    maxDate: '',
    initialized: false
};

function resetTrendToFullRange() {
    trendTimelineState.startDate = trendTimelineState.minDate;
    trendTimelineState.endDate = trendTimelineState.maxDate;
}

function zoomTrendRange(factor) {
    if (!trendTimelineState.startDate || !trendTimelineState.endDate) return;
    const startObj = new Date(`${trendTimelineState.startDate}T00:00:00`);
    const endObj = new Date(`${trendTimelineState.endDate}T00:00:00`);
    const minObj = new Date(`${trendTimelineState.minDate}T00:00:00`);
    const maxObj = new Date(`${trendTimelineState.maxDate}T00:00:00`);

    const currentSpan = Math.max(1, Math.round((endObj.getTime() - startObj.getTime()) / (1000 * 60 * 60 * 24)));
    let newSpan = Math.round(currentSpan * factor);
    if (newSpan < 4) newSpan = 4;
    const maxSpan = Math.round((maxObj.getTime() - minObj.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (newSpan > maxSpan) newSpan = maxSpan;

    const centerTime = (startObj.getTime() + endObj.getTime()) / 2;
    const halfSpanMs = (newSpan * 24 * 60 * 60 * 1000) / 2;

    let newStart = new Date(centerTime - halfSpanMs);
    let newEnd = new Date(centerTime + halfSpanMs);

    if (newStart < minObj) {
        newStart = new Date(minObj);
        newEnd = new Date(minObj.getTime() + newSpan * 86400000);
    }
    if (newEnd > maxObj) {
        newEnd = new Date(maxObj);
        newStart = new Date(maxObj.getTime() - newSpan * 86400000);
        if (newStart < minObj) newStart = new Date(minObj);
    }

    trendTimelineState.startDate = localDateKey(newStart);
    trendTimelineState.endDate = localDateKey(newEnd);

    renderTrendTimelineChart();
}

function renderTrendTimelineChart() {
    if (!trendTimelineState.startDate || !trendTimelineState.endDate) return;

    const startObj = new Date(`${trendTimelineState.startDate}T00:00:00`);
    const endObj = new Date(`${trendTimelineState.endDate}T00:00:00`);
    const diffDays = Math.max(1, Math.round((endObj.getTime() - startObj.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    const dateKeys = [];
    const dateLabels = [];
    const cur = new Date(startObj);
    for (let i = 0; i < diffDays; i++) {
        const key = localDateKey(cur);
        dateKeys.push(key);
        dateLabels.push(new Date(cur).toLocaleDateString());
        cur.setDate(cur.getDate() + 1);
    }

    const dayWarns = [];
    const dayTempBans = [];
    const dayPermabans = [];
    const dayLastChance = [];

    let totalWarns = 0;
    let totalTempBans = 0;
    let totalPermabans = 0;
    let totalLastChance = 0;

    dateKeys.forEach(key => {
        const dayActions = trendTimelineState.allActions.filter(a => localDateKey(a.timestamp) === key);
        const w = dayActions.filter(a => a.type === 'WARN' && !a.warningRemoval).length;
        const tb = dayActions.filter(a => a.type === 'BAN' && !a.permanent && !a.lastChance).length;
        const pb = dayActions.filter(a => a.type === 'BAN' && a.permanent).length;
        const lc = dayActions.filter(isLastChanceGrant).length;

        dayWarns.push(w);
        dayTempBans.push(tb);
        dayPermabans.push(pb);
        dayLastChance.push(lc);

        totalWarns += w;
        totalTempBans += tb;
        totalPermabans += pb;
        totalLastChance += lc;
    });

    const totalSum = totalWarns + totalTempBans + totalPermabans + totalLastChance;

    const startInput = document.getElementById('trend-date-start');
    const endInput = document.getElementById('trend-date-end');
    if (startInput) startInput.value = trendTimelineState.startDate;
    if (endInput) endInput.value = trendTimelineState.endDate;

    const infoEl = document.getElementById('trend-info-summary');
    if (infoEl) {
        infoEl.innerHTML = `Showing: <span style="color:#60a5fa;">${trendTimelineState.startDate}</span> — <span style="color:#60a5fa;">${trendTimelineState.endDate}</span> (${diffDays} days, <strong>${totalSum}</strong> total sanctions)`;
    }

    if (chartTrend) chartTrend.destroy();
    const isLine = trendTimelineState.mode === 'line';

    const datasets = [
        {
            label: 'Warns',
            data: dayWarns,
            backgroundColor: isLine ? 'rgba(245, 158, 11, 0.2)' : '#f59e0b',
            borderColor: '#f59e0b',
            borderWidth: isLine ? 2 : 0,
            borderRadius: isLine ? 0 : 3,
            fill: isLine,
            tension: 0.25,
            stack: 'total'
        },
        {
            label: 'Temp Bans',
            data: dayTempBans,
            backgroundColor: isLine ? 'rgba(239, 68, 68, 0.25)' : '#ef4444',
            borderColor: '#ef4444',
            borderWidth: isLine ? 2 : 0,
            borderRadius: isLine ? 0 : 3,
            fill: isLine,
            tension: 0.25,
            stack: 'total'
        },
        {
            label: 'PERMANENT',
            data: dayPermabans,
            backgroundColor: isLine ? 'rgba(153, 27, 27, 0.4)' : '#991b1b',
            borderColor: '#ff4d4d',
            borderWidth: isLine ? 2 : 0,
            borderRadius: isLine ? 0 : 3,
            fill: isLine,
            tension: 0.25,
            stack: 'total'
        },
        {
            label: 'Last Chance',
            data: dayLastChance,
            backgroundColor: isLine ? 'rgba(251, 146, 60, 0.3)' : '#fb923c',
            borderColor: '#fb923c',
            borderWidth: isLine ? 2 : 0,
            borderRadius: isLine ? 0 : 3,
            fill: isLine,
            tension: 0.25,
            stack: 'total'
        }
    ];

    const trendCtx = document.getElementById('trendChart');
    if (!trendCtx) return;

    chartTrend = new Chart(trendCtx, {
        type: isLine ? 'line' : 'bar',
        data: {
            labels: dateLabels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        color: '#94a3b8',
                        maxTicksLimit: Math.min(14, diffDays),
                        autoSkip: true,
                        maxRotation: 0,
                        font: { size: 11 }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: {
                        color: '#94a3b8',
                        precision: 0,
                        font: { size: 11 }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#cbd5e1',
                        usePointStyle: true,
                        boxWidth: 8,
                        padding: 16,
                        font: { size: 12, weight: '600' }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f8fafc',
                    bodyColor: '#cbd5e1',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    boxPadding: 4,
                    usePointStyle: true,
                    callbacks: {
                        footer: (tooltipItems) => {
                            let sum = 0;
                            tooltipItems.forEach(item => { sum += Number(item.parsed.y || 0); });
                            return `Daily total: ${sum}`;
                        }
                    }
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x'
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                            speed: 0.1
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'x'
                    }
                }
            }
        }
    });
}

function setupTrendTimelineChart(allActions) {
    trendTimelineState.allActions = allActions;

    const actionDates = allActions.map(a => localDateKey(a.timestamp)).filter(Boolean).sort();
    if (actionDates.length) {
        trendTimelineState.minDate = actionDates[0];
        trendTimelineState.maxDate = actionDates[actionDates.length - 1];
    } else {
        const today = localDateKey(new Date());
        trendTimelineState.minDate = today;
        trendTimelineState.maxDate = today;
    }

    if (!trendTimelineState.initialized) {
        trendTimelineState.initialized = true;
        resetTrendToFullRange();

        // Mode switchers
        const barBtn = document.getElementById('trend-mode-bar');
        const lineBtn = document.getElementById('trend-mode-line');
        if (barBtn && lineBtn) {
            barBtn.onclick = () => {
                trendTimelineState.mode = 'bar';
                barBtn.classList.add('active');
                lineBtn.classList.remove('active');
                renderTrendTimelineChart();
            };
            lineBtn.onclick = () => {
                trendTimelineState.mode = 'line';
                lineBtn.classList.add('active');
                barBtn.classList.remove('active');
                renderTrendTimelineChart();
            };
        }

        // Zoom In / Out / Reset
        const zoomInBtn = document.getElementById('trend-zoom-in');
        const zoomOutBtn = document.getElementById('trend-zoom-out');
        const zoomResetBtn = document.getElementById('trend-zoom-reset');
        if (zoomInBtn) zoomInBtn.onclick = () => zoomTrendRange(0.65);
        if (zoomOutBtn) zoomOutBtn.onclick = () => zoomTrendRange(1.45);
        if (zoomResetBtn) zoomResetBtn.onclick = () => {
            resetTrendToFullRange();
            renderTrendTimelineChart();
        };

        // Date Range Apply
        const applyDatesBtn = document.getElementById('trend-apply-dates');
        if (applyDatesBtn) {
            applyDatesBtn.onclick = () => {
                const s = document.getElementById('trend-date-start').value;
                const e = document.getElementById('trend-date-end').value;
                if (s && e && s <= e) {
                    trendTimelineState.startDate = s;
                    trendTimelineState.endDate = e;
                    renderTrendTimelineChart();
                }
            };
        }
    } else if (!trendTimelineState.startDate || !trendTimelineState.endDate) {
        resetTrendToFullRange();
    }

    renderTrendTimelineChart();
}

async function loadData() {
    const days = parseInt(document.getElementById('time-filter').value);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const [players, allActions, moderators] = await Promise.all([
        ModAPI.getPlayers(),
        ModAPI.getActions(),
        ModAPI.getModerators ? ModAPI.getModerators().catch(() => []) : Promise.resolve([])
    ]);
    const actions = allActions.filter(a => new Date(a.timestamp) >= cutoff);
    const sanctions = actions.filter(a => (a.type === 'WARN' && !a.warningRemoval) || a.type === 'BAN');
    setupDailyChartFilter(sanctions);
    setupSanctionsDateControls(allActions);
    setupStafferSearch(allActions, moderators);
    setupTimeBandBanExplorer(allActions, players, actions);
    setupPredictorModule(allActions, players);

    // Last Chance is a current status, independent of the selected time window.
    const lastChancePlayers = players.filter(p => hasActiveLastChance(allActions.filter(a => a.playerId === p.id)));
    document.getElementById('kpi-lastchance').innerText = lastChancePlayers.length;
    const lastChanceList = document.getElementById('lastchance-list');
    if (lastChanceList) {
        lastChanceList.innerHTML = lastChancePlayers.length
            ? lastChancePlayers.map(p => `
                <a href="player.html?id=${encodeURIComponent(p.id)}" class="lastchance-chip-pro" title="Open player profile">
                    <i data-lucide="flame" style="width: 12px; height: 12px; color: #f97316;"></i>
                    <span>${escapeHtml(p.username)}</span>
                </a>
            `).join('')
            : '<div style="color: #64748b; font-size: 13px; padding: 12px 0;">No players currently on Last Chance.</div>';
        lastChanceList.className = lastChancePlayers.length ? 'lastchance-chips-grid' : 'lastchance-chips-grid staff-empty';
    }

    // Tracked like any WARN/BAN: how many Last Chance grants happened in the selected time window.
    const lastChanceGrants = actions.filter(isLastChanceGrant);
    document.getElementById('kpi-lastchance-given').innerText = lastChanceGrants.length;

    const warns = sanctions.filter(a => a.type === 'WARN' && !a.warningRemoval);
    const bans = sanctions.filter(a => a.type === 'BAN' && !a.permanent);
    const perms = sanctions.filter(a => a.type === 'BAN' && a.permanent);
    
    const tradBans = sanctions.filter(a => a.type === 'BAN' && a.banCategory === 'traditional');
    const weapBans = sanctions.filter(a => a.type === 'BAN' && a.banCategory === 'weapon');

    document.getElementById('kpi-warns').innerText = warns.length;
    document.getElementById('kpi-bans').innerText = bans.length + perms.length;
    document.getElementById('kpi-permabans').innerText = perms.length;
    document.getElementById('kpi-trad').innerText = tradBans.length;
    document.getElementById('kpi-weap').innerText = weapBans.length;

    // Compute most common reason (use reasonKey when available, exclude system logs)
    function extractReasonKeyFallback(txt) {
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

    const reasonCounts = {};
    sanctions.forEach(a => {
        getActionReasons(a).forEach(reason => {
            const reasonKey = reason || extractReasonKeyFallback(a.reason || a.reasonRaw || 'Unspecified');
            const label = `${reasonKey} (${a.type === 'BAN' ? 'Ban' : 'Warn'})`;
            reasonCounts[label] = (reasonCounts[label] || 0) + 1;
        });
    });
    const topReason = Object.keys(reasonCounts).sort((a, b) => reasonCounts[b] - reasonCounts[a])[0];
    const topReasonEl = document.getElementById('kpi-reason');
    if (topReasonEl) {
        topReasonEl.innerText = topReason || 'None';
        topReasonEl.title = topReason || 'None';
    }

    const pBansPct = bans.length + perms.length === 0 ? 0 : Math.round((perms.length / (bans.length + perms.length)) * 100);
    const insightsContainer = document.getElementById('insights-container');
    if (insightsContainer) {
        insightsContainer.innerHTML = `
            <div class="insight-icon-wrap">
                <i data-lucide="sparkles" style="width: 20px; height: 20px;"></i>
            </div>
            <div class="insight-content">
                <div class="insight-label">System Intelligence</div>
                <div class="insight-text">
                    ${topReason ? `<strong>"${escapeHtml(topReason)}"</strong> is the primary cause of sanctions.` : 'No significant trends recorded for this period.'} 
                    Permanent bans account for <strong style="color: #fb7185;">${pBansPct}%</strong> of all bans in this timeframe.
                </div>
            </div>
        `;
    }

    updateCharts(warns, bans, perms, tradBans, weapBans);
    updateSanctionsTimeChart(sanctions);

    // Render timeline trend chart and top players
    setupTrendTimelineChart(allActions);
    setupAnalyticsSortControls();
    setupSanctionsChartModeControls();

    // Top players by actions (exclude system/log entries)
    const counts = {};
    sanctions.forEach(a => {
        if (!a) return;
        if (!a.playerId) return;
        const pid = String(a.playerId);
        if (pid.trim().toUpperCase() === 'SYSTEM') return;
        if (!counts[pid]) counts[pid] = { total: 0, warns: 0, bans: 0 };
        counts[pid].total++;
        if (a.type === 'WARN' && !a.warningRemoval) counts[pid].warns++;
        if (a.type === 'BAN') counts[pid].bans++;
    });
    topPlayerStats = Object.entries(counts).map(([id, stats]) => {
        const player = players.find(item => item.id === id);
        return { id, username: player ? player.username : id, ...stats };
    });
    renderTopPlayersChart();

    const tbody = document.getElementById('recent-actions-body');
    if (tbody) {
        let localCache = {};
        try { localCache = JSON.parse(localStorage.getItem('discord_avatar_cache_v2') || '{}'); } catch {}

        const recentActions = sanctions.slice(-10).reverse();
        tbody.innerHTML = recentActions.map(a => {
            const p = players.find(x => x.id === a.playerId);
            const username = p ? p.username : (a.playerId || 'Unknown');
            const initial = (username.charAt(0) || '?').toUpperCase();
            const isPerm = Boolean(a.permanent);
            const badgeClass = isPerm ? 'permaban' : a.type.toLowerCase();
            const badgeText = isPerm ? 'PERMANENT BAN' : a.type;
            const dateStr = a.timestamp ? new Date(a.timestamp).toLocaleDateString() : '-';
            const reasonText = getActionReasonText(a);

            let avatarUrl = null;
            if (p?.discordId && localCache[p.discordId]?.url) {
                avatarUrl = localCache[p.discordId].url;
            } else if (p?.avatarUrl) {
                avatarUrl = p.avatarUrl;
            } else if (p?.discordId && /^\d{17,20}$/.test(p.discordId)) {
                try {
                    const defaultIdx = Number((BigInt(p.discordId) >> 22n) % 6n);
                    avatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultIdx}.png`;
                } catch {}
            }

            return `
                <tr>
                    <td>
                        <a href="player.html?id=${encodeURIComponent(a.playerId)}" style="color:#f1f5f9; font-weight: 600; text-decoration:none; display: inline-flex; align-items: center; gap: 8px;" class="player-table-link" data-discord-id="${escapeHtml(p?.discordId || '')}">
                            ${avatarUrl
                                ? `<img src="${escapeHtml(avatarUrl)}" alt="" class="player-table-avatar" style="width: 26px; height: 26px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255, 255, 255, 0.18); flex-shrink: 0;" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';" />
                                   <span class="player-table-avatar-fallback" style="display:none; width: 26px; height: 26px; border-radius: 50%; background: rgba(99, 102, 241, 0.2); color: #a5b4fc; font-size: 11px; font-weight: 700; align-items: center; justify-content: center; border: 1px solid rgba(99, 102, 241, 0.3); flex-shrink: 0;">${initial}</span>`
                                : `<span class="player-table-avatar-fallback" style="display: inline-flex; width: 26px; height: 26px; border-radius: 50%; background: rgba(99, 102, 241, 0.2); color: #a5b4fc; font-size: 11px; font-weight: 700; align-items: center; justify-content: center; border: 1px solid rgba(99, 102, 241, 0.3); flex-shrink: 0;">${initial}</span>`
                            }
                            <span>${escapeHtml(username)}</span>
                        </a>
                    </td>
                    <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                    <td style="color: #cbd5e1; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(reasonText)}">${escapeHtml(reasonText)}</td>
                    <td style="color: #94a3b8; font-size: 12.5px;">${dateStr}</td>
                    <td style="min-width: 140px; text-align: right;">
                        <button class="cta" style="width: auto; padding: 5px 10px; font-size: 11.5px; border-radius: 6px;" onclick="location.href='player.html?id=${encodeURIComponent(a.playerId)}'">View</button>
                        <button class="cta" style="width: auto; padding: 5px 10px; font-size: 11.5px; margin-left: 6px; background: transparent; border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; border-radius: 6px;" onclick="deletePlayerById('${encodeURIComponent(a.playerId)}')">Delete</button>
                    </td>
                </tr>
            `;
        }).join('');

        // Non-blocking fetch for fresh discord avatars
        const discordIdsToFetch = recentActions
            .map(a => players.find(x => x.id === a.playerId)?.discordId)
            .filter(id => id && /^\d{17,20}$/.test(id));

        if (discordIdsToFetch.length > 0 && typeof ModAPI !== 'undefined' && ModAPI.getDiscordAvatars) {
            ModAPI.getDiscordAvatars(discordIdsToFetch).then(freshProfiles => {
                if (freshProfiles && typeof freshProfiles === 'object') {
                    Object.assign(localCache, freshProfiles);
                    try { localStorage.setItem('discord_avatar_cache_v2', JSON.stringify(localCache)); } catch {}
                    
                    document.querySelectorAll('#recent-actions-body .player-table-link').forEach(link => {
                        const dId = link.dataset.discordId;
                        if (dId && freshProfiles[dId]?.url) {
                            const url = freshProfiles[dId].url;
                            const img = link.querySelector('.player-table-avatar');
                            const fallback = link.querySelector('.player-table-avatar-fallback');
                            if (img) {
                                img.src = url;
                                img.style.display = 'inline-block';
                            } else {
                                const newImg = document.createElement('img');
                                newImg.src = url;
                                newImg.className = 'player-table-avatar';
                                newImg.style.cssText = 'width: 26px; height: 26px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255, 255, 255, 0.18); flex-shrink: 0;';
                                newImg.onerror = () => { newImg.style.display = 'none'; if (fallback) fallback.style.display = 'inline-flex'; };
                                link.prepend(newImg);
                            }
                            if (fallback) fallback.style.display = 'none';
                        }
                    });
                }
            }).catch(() => {});
        }
    }

    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function updateCharts(warns, bans, perms, trad, weap, selectedReason = 'ALL', startDate = '', endDate = '') {
    if(chartActivity) chartActivity.destroy();
    if(chartDist) chartDist.destroy();
    if(chartCat) chartCat.destroy();

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'bottom',
                labels: { color: '#cbd5e1', font: { weight: '600', size: 11 }, boxWidth: 12, padding: 12 }
            },
            title: { display: false },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleColor: '#ffffff',
                bodyColor: '#cbd5e1',
                borderColor: 'rgba(255, 255, 255, 0.12)',
                borderWidth: 1,
                padding: 10,
                cornerRadius: 8
            }
        }
    };

    const distCtx = document.getElementById('distributionChart');
    if (distCtx) {
        chartDist = new Chart(distCtx, {
            type: 'doughnut',
            data: {
                labels: ['Warns', 'Temp Bans', 'Permanent'],
                datasets: [{
                    data: [warns.length, bans.length, perms.length],
                    backgroundColor: ['#f59e0b', '#ef4444', '#f43f5e'],
                    borderWidth: 2,
                    borderColor: '#0f172a'
                }]
            },
            options: Object.assign({}, commonOptions, { cutout: '72%' })
        });
    }

    const catCtx = document.getElementById('categoryChart');
    if (catCtx) {
        chartCat = new Chart(catCtx, {
            type: 'doughnut',
            data: {
                labels: ['Traditional', 'Weapon'],
                datasets: [{
                    data: [trad.length, weap.length],
                    backgroundColor: ['#3b82f6', '#a855f7'],
                    borderWidth: 2,
                    borderColor: '#0f172a'
                }]
            },
            options: Object.assign({}, commonOptions, { cutout: '72%' })
        });
    }

    let titleParts = [];
    if (selectedReason && selectedReason !== 'ALL') {
        titleParts.push(selectedReason);
    }
    if (startDate && endDate) {
        titleParts.push(startDate === endDate ? `${startDate}` : `${startDate} — ${endDate}`);
    } else if (startDate) {
        titleParts.push(`From ${startDate}`);
    } else if (endDate) {
        titleParts.push(`Up to ${endDate}`);
    }

    const titleText = titleParts.length > 0
        ? `Operations: ${titleParts.join(' | ')}`
        : 'Operations Breakdown';

    chartActivity = new Chart(document.getElementById('activityChart'), {
        type: 'bar',
        data: {
            labels: ['Warns', 'Temp Bans', 'Permabans'],
            datasets: [
                {
                    label: 'Count',
                    data: [warns.length, bans.length, perms.length],
                    backgroundColor: ['#f59e0b', '#ef4444', '#991b1b'],
                    borderRadius: 4
                }
            ]
        },
        options: Object.assign({}, commonOptions, {
            plugins: {
                legend: { display: false },
                title: { display: true, text: titleText, color: '#94a3b8', font: { size: 13, weight: '600' } },
                tooltip: {
                    callbacks: {
                        label: (context) => ` ${context.label}: ${context.parsed.y}`
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                y: {
                    ticks: { color: '#94a3b8', precision: 0 },
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                }
            }
        })
    });
}

async function initStats() {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';
    Chart.defaults.devicePixelRatio = window.devicePixelRatio || 1;
    document.getElementById('time-filter').addEventListener('change', loadData);
    await loadData();
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
}

document.addEventListener('DOMContentLoaded', initStats);

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
    const newPlayers = players.filter(p => p.id !== id);
    const newActions = actions.filter(a => a.playerId !== id);
    await ModAPI.savePlayers(newPlayers);
    await ModAPI.saveActions(newActions);
    await ModAPI.logEvent(`Deleted player ${target ? target.username : id} and all associated records`, 'System Admin');
    showToast('Player deleted successfully.');
    await loadData();
};

/* =========================================================================
   AI SANCTION & RISK PREDICTOR WITH REASON CORRELATION HEATMAP
   ========================================================================= */

let predictorSelectedPlayer = null;
let predictorCachedPlayers = [];
let predictorCachedAllActions = [];

function setupPredictorModule(allActions, players) {
    predictorCachedAllActions = allActions || [];
    predictorCachedPlayers = players || [];

    const playerSanctionCounts = {};
    allActions.forEach(a => {
        if (!a || !a.playerId || a.playerId === 'SYSTEM') return;
        playerSanctionCounts[a.playerId] = (playerSanctionCounts[a.playerId] || 0) + 1;
    });

    const sortedPlayers = [...players].sort((a, b) => (playerSanctionCounts[b.id] || 0) - (playerSanctionCounts[a.id] || 0));

    setupPredictorPlayerSearch(sortedPlayers, allActions, playerSanctionCounts);

    if (predictorSelectedPlayer && players.some(p => p.id === predictorSelectedPlayer.id)) {
        renderPredictionForPlayer(predictorSelectedPlayer, allActions);
    } else {
        renderPredictorEmptyState();
    }
}

function renderPredictorEmptyState() {
    const container = document.getElementById('predictor-results-container');
    if (!container) return;
    container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: #94a3b8; font-size: 13px;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 50px; height: 50px; border-radius: 12px; background: rgba(168, 85, 247, 0.12); border: 1px solid rgba(168, 85, 247, 0.25); color: #c084fc; margin-bottom: 12px;">
                <i data-lucide="user-search" style="width: 24px; height: 24px;"></i>
            </div>
            <div style="font-size: 15px; font-weight: 700; color: #f1f5f9; margin-bottom: 4px;">No Player Selected</div>
            <div style="max-width: 440px; margin: 0 auto; color: #94a3b8; font-size: 12.5px; line-height: 1.5;">Select a player from the search bar above to generate AI moderation forecast, reason correlation matrix, and escalation timeline.</div>
        </div>
    `;
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

function setupPredictorPlayerSearch(sortedPlayers, allActions, playerSanctionCounts) {
    const search = document.getElementById('predictor-player-search');
    const clearBtn = document.getElementById('predictor-player-clear');
    const dropdown = document.getElementById('predictor-player-dropdown');
    if (!search || !dropdown) return;

    if (predictorSelectedPlayer) {
        search.value = predictorSelectedPlayer.username;
        if (clearBtn) clearBtn.style.display = 'flex';
    } else {
        search.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
    }

    let localCache = {};
    try { localCache = JSON.parse(localStorage.getItem('discord_avatar_cache_v2') || '{}'); } catch {}

    // Asynchronously fetch fresh custom Discord profile avatars for all players
    const discordIdsToFetch = sortedPlayers
        .map(p => p.discordId)
        .filter(id => id && /^\d{17,20}$/.test(id));

    if (discordIdsToFetch.length > 0 && typeof ModAPI !== 'undefined' && ModAPI.getDiscordAvatars) {
        ModAPI.getDiscordAvatars(discordIdsToFetch).then(freshProfiles => {
            if (freshProfiles && typeof freshProfiles === 'object') {
                Object.assign(localCache, freshProfiles);
                try { localStorage.setItem('discord_avatar_cache_v2', JSON.stringify(localCache)); } catch {}

                // Live update any avatar elements currently rendered in the dropdown
                document.querySelectorAll('#predictor-player-dropdown .staff-dropdown-item').forEach(item => {
                    const pId = item.dataset.playerId;
                    const pl = sortedPlayers.find(p => p.id === pId);
                    if (pl && pl.discordId && freshProfiles[pl.discordId]?.url) {
                        const avatarEl = item.querySelector('.staff-dropdown-avatar');
                        if (avatarEl) {
                            avatarEl.style.backgroundImage = `url('${escapeHtml(freshProfiles[pl.discordId].url)}')`;
                            avatarEl.style.backgroundSize = 'cover';
                            avatarEl.innerText = '';
                        }
                    }
                });
            }
        }).catch(() => {});
    }

    function renderDropdown(filterQuery = '') {
        const query = filterQuery.toLowerCase().trim();
        const matches = query
            ? sortedPlayers.filter(p => p.username.toLowerCase().includes(query))
            : sortedPlayers;

        if (!matches.length) {
            dropdown.innerHTML = `<div class="staff-dropdown-empty">No player matching "${escapeHtml(filterQuery)}"</div>`;
            dropdown.style.display = 'flex';
            return;
        }

        dropdown.innerHTML = matches.slice(0, 30).map((p) => {
            const count = playerSanctionCounts[p.id] || 0;
            const initial = (p.username.charAt(0) || '?').toUpperCase();
            let avatarUrl = localCache[p.discordId]?.url || p.avatarUrl;
            const avatarStyle = avatarUrl ? `background-image: url('${escapeHtml(avatarUrl)}'); background-size: cover;` : '';

            return `
                <div class="staff-dropdown-item ${predictorSelectedPlayer && predictorSelectedPlayer.id === p.id ? 'focused' : ''}" data-player-id="${escapeHtml(p.id)}">
                    <div class="staff-dropdown-item-left">
                        <div class="staff-dropdown-avatar" style="${avatarStyle}">
                            ${!avatarUrl ? initial : ''}
                        </div>
                        <span class="staff-dropdown-name">${escapeHtml(p.username)}</span>
                    </div>
                    <span class="staff-dropdown-count">${count} sanctions</span>
                </div>
            `;
        }).join('');

        dropdown.querySelectorAll('.staff-dropdown-item').forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                const pId = item.dataset.playerId;
                const player = sortedPlayers.find(p => p.id === pId);
                if (player) {
                    predictorSelectedPlayer = player;
                    search.value = player.username;
                    if (clearBtn) clearBtn.style.display = 'flex';
                    dropdown.style.display = 'none';
                    renderPredictionForPlayer(player, allActions);
                }
            };
        });

        dropdown.style.display = 'flex';
    }

    search.onfocus = () => renderDropdown(search.value);
    search.onclick = () => renderDropdown(search.value);
    search.oninput = (e) => renderDropdown(e.target.value);

    if (clearBtn) {
        clearBtn.onclick = () => {
            predictorSelectedPlayer = null;
            search.value = '';
            clearBtn.style.display = 'none';
            if (dropdown) dropdown.style.display = 'none';
            renderPredictorEmptyState();
            search.focus();
        };
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#predictor-search-wrap')) {
            dropdown.style.display = 'none';
        }
    });
}

function isSystemLogReason(txt) {
    if (!txt) return true;
    const str = String(txt).trim();
    if (str.length > 55) return true;
    const low = str.toLowerCase();
    const systemKeywords = [
        'registered new', 'issued ban', 'issued warn', 'edited ban', 'edited warn',
        'deleted', 'from [ban', 'from [warn', 'system admin', 'import', 'unknown',
        'pardon', 'sban', 'unban', 'rimozion', 'rimoss', 'annulla', 
        'decisione staff', 'ticket accettato', 'richiesta accettata',
        'accettato', 'accettata', 'scadut', 'revocat', 'scusat', 'sbann',
        'decisione', 'richiesta sban', 'richiesta unban', 'sospeso per errore',
        'errore staff', 'sbannato', 'sbannata', 'pardon reason'
    ];
    return systemKeywords.some(kw => low.includes(kw));
}

function extractCleanActionReasons(action) {
    if (!action) return [];
    if (action.type !== 'WARN' && action.type !== 'BAN') return [];
    if (action.warningRemoval) return [];

    let rawReasons = [];
    if (Array.isArray(action.reasonKeys) && action.reasonKeys.length) rawReasons = action.reasonKeys;
    else if (Array.isArray(action.reasonKey) && action.reasonKey.length) rawReasons = action.reasonKey;
    else if (action.reasonKey) rawReasons = [action.reasonKey];
    else if (action.reason) rawReasons = [action.reason];

    return rawReasons.filter(r => r && !isSystemLogReason(r) && r !== 'Unspecified');
}

function calculateReasonCorrelationMatrix(playerActions, allServerActions) {
    // Collect all transitions across all players on the server (excluding system logs & pardons)
    const transitions = {};
    const reasonFrequency = {};

    const actionsByPlayer = {};
    allServerActions.forEach(a => {
        if (!a || !a.playerId || a.playerId === 'SYSTEM') return;
        if (a.warningRemoval || a.type === 'PARDON' || a.type === 'UNBAN') return;
        if (!actionsByPlayer[a.playerId]) actionsByPlayer[a.playerId] = [];
        actionsByPlayer[a.playerId].push(a);
    });

    Object.values(actionsByPlayer).forEach(pActions => {
        const sorted = [...pActions]
            .filter(a => (a.type === 'WARN' && !a.warningRemoval) || a.type === 'BAN')
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        for (let i = 0; i < sorted.length; i++) {
            const reasonsA = extractCleanActionReasons(sorted[i]);
            const mainA = reasonsA[0];
            if (!mainA) continue;

            reasonFrequency[mainA] = (reasonFrequency[mainA] || 0) + 1;

            if (i < sorted.length - 1) {
                const reasonsB = extractCleanActionReasons(sorted[i + 1]);
                const mainB = reasonsB[0];
                if (!mainB) continue;

                if (!transitions[mainA]) transitions[mainA] = {};
                transitions[mainA][mainB] = (transitions[mainA][mainB] || 0) + 1;
            }
        }
    });

    // Top 4 most frequent actual infraction reasons for the matrix
    const topReasons = Object.keys(reasonFrequency)
        .filter(r => r && !isSystemLogReason(r) && r !== 'Unspecified')
        .sort((a, b) => reasonFrequency[b] - reasonFrequency[a])
        .slice(0, 4);

    if (topReasons.length < 4) {
        ['Slog In Azione', 'Tossicità', 'No Fear', 'Infrazione Regolamento AC'].forEach(fallback => {
            if (!topReasons.includes(fallback) && topReasons.length < 4) topReasons.push(fallback);
        });
    }

    // Build the 4x4 matrix
    const matrix = [];
    topReasons.forEach(source => {
        const row = [];
        let totalOut = 0;
        topReasons.forEach(target => {
            totalOut += (transitions[source]?.[target] || 0);
        });
        topReasons.forEach(target => {
            const count = transitions[source]?.[target] || 0;
            const prob = totalOut > 0 ? Math.round((count / totalOut) * 100) : (source === target ? 50 : 16);
            row.push(prob);
        });
        matrix.push(row);
    });

    // Determine predicted next reasons for this specific player (ignoring logs/pardons)
    const validPlayerActions = playerActions.filter(a => extractCleanActionReasons(a).length > 0);

    const playerLastAction = validPlayerActions[validPlayerActions.length - 1];
    const playerLastReasons = playerLastAction ? extractCleanActionReasons(playerLastAction) : [];
    const playerLastReason = playerLastReasons[0] || 'Slog In Azione';
    
    const possibleNext = transitions[playerLastReason] || {};
    const sortedNext = Object.entries(possibleNext).filter(([r]) => !isSystemLogReason(r)).sort((a, b) => b[1] - a[1]);
    
    let topPredictedReason = sortedNext[0]?.[0] || playerLastReason || topReasons[0];
    let topPredictedConfidence = sortedNext[0] ? Math.min(88, Math.max(55, sortedNext[0][1] * 12)) : 65;

    return {
        topReasons,
        matrix,
        playerLastReason,
        topPredictedReason,
        topPredictedConfidence
    };
}

function getInfractionSeverityTier(reason) {
    if (!reason) return 'MEDIUM';
    const low = String(reason).toLowerCase().trim();

    // TIER 4: CRITICAL / ZERO TOLERANCE -> Immediate Permaban
    const permTerms = [
        'cheating', 'modding', 'diffusione asset', 'doxxing', 
        'evasione ban', 'omofobia', 'account sharing', 'acquisto whitelist',
        'vendita account', 'troll estremo'
    ];
    if (permTerms.some(t => low === t || low.includes(t))) return 'PERMABAN';

    // TIER 3: HEAVY / SEVERE -> Starts directly at high Temp Ban (3-7-14D) and skips warns
    const heavyTerms = [
        'insulti allo staff', 'no fear estremo', 'player non idoneo', 
        'refusal ss', 'run away from ss', 'grief fazione', 'bug abuse', 
        'blasfemia', 'combat log', 'comportamento non consono grave', 'no reason'
    ];
    if (heavyTerms.some(t => low === t || low.includes(t))) return 'HEAVY';

    // TIER 1: MINOR / PROCEDURAL -> Warn first, light penalty
    const minorTerms = [
        'mancanza modulo', 'mancanza clip', 'clip non conforme', 'scarso rp', 
        'soft flame', 'uso scorretto comando', 'uso scorretto chat', 'mixchat', 
        'scorretto uso /ambulanza', 'scorretto uso /me', 'ricerca ingaggio', 
        'metagame ooc', 'metagame ic', 'call discord', 'utilizzo tetti',
        'azioni senza modulo', 'doppia fazione'
    ];
    if (minorTerms.some(t => low === t || low.includes(t))) return 'MINOR';

    // TIER 2: MEDIUM GAMEPLAY (Slog in azione, Tossicità, No Fear, RDM, VDM, FailRP, Powergame, Spawnkill...)
    return 'MEDIUM';
}

function renderPredictionForPlayer(player, allActions, hypotheticalReason = null) {
    const container = document.getElementById('predictor-results-container');
    if (!container || !player) return;

    const playerActions = allActions.filter(a => a.playerId === player.id).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const validPlayerActions = playerActions.filter(a => !a.warningRemoval && a.type !== 'PARDON' && a.type !== 'UNBAN');
    const warns = playerActions.filter(a => a.type === 'WARN' && !a.warningRemoval).length;
    const bans = playerActions.filter(a => a.type === 'BAN' && !a.permanent).length;
    const perms = playerActions.filter(a => a.type === 'BAN' && a.permanent).length;
    const hasLC = hasActiveLastChance(playerActions);

    const correlation = calculateReasonCorrelationMatrix(playerActions, allActions);
    const predictedReason = hypotheticalReason || correlation.topPredictedReason;
    const violationTier = getInfractionSeverityTier(predictedReason);

    // Calculate Escalation Verdict & Probabilities based on Player History & Infraction Severity Tier
    let verdictTitle = '';
    let verdictBadgeClass = '';
    let verdictDescription = '';
    let confidence = 85;
    let riskScore = 20;
    let probPerm = 5;
    let probLC = 5;
    let probBan = 20;
    let probWarn = 70;

    if (violationTier === 'PERMABAN') {
        verdictTitle = 'PERMANENT BAN (ZERO TOLERANCE)';
        verdictBadgeClass = 'verdict-permaban';
        verdictDescription = `Violation "${escapeHtml(predictedReason)}" is classified under zero-tolerance policy, triggering immediate permanent banishment.`;
        confidence = 95;
        riskScore = 95;
        probPerm = 94;
        probLC = 4;
        probBan = 2;
        probWarn = 0;
    } else if (hasLC) {
        if (violationTier === 'MINOR') {
            verdictTitle = 'REVOCA LAST CHANCE / ULTIMO AVVISO';
            verdictBadgeClass = 'verdict-lastchance';
            verdictDescription = `Player is on <strong>ACTIVE LAST CHANCE</strong>. Minor violation ("${escapeHtml(predictedReason)}") triggers emergency staff review before final permaban.`;
            confidence = 88;
            riskScore = 78;
            probPerm = 52;
            probLC = 35;
            probBan = 10;
            probWarn = 3;
        } else {
            verdictTitle = 'PERMANENT BAN (REVOCA ACCORDO)';
            verdictBadgeClass = 'verdict-permaban';
            verdictDescription = `Player is currently on <strong>ACTIVE LAST CHANCE</strong>. Committing "${escapeHtml(predictedReason)}" results in immediate permanent banishment and agreement revocation.`;
            confidence = 98;
            riskScore = 98;
            probPerm = 96;
            probLC = 0;
            probBan = 3;
            probWarn = 1;
        }
    } else if (violationTier === 'HEAVY') {
        // Heavy Infractions bypass warnings and escalate directly into aggressive suspensions
        if (bans >= 4 || (bans >= 2 && perms > 0)) {
            verdictTitle = 'LAST CHANCE / PERMABAN (GRAVE)';
            verdictBadgeClass = 'verdict-permaban';
            verdictDescription = `Severe infraction ("${escapeHtml(predictedReason)}") combined with accumulated ban record (${bans} bans) triggers terminal escalation.`;
            confidence = 92;
            riskScore = 90;
            probLC = 50;
            probPerm = 45;
            probBan = 5;
            probWarn = 0;
        } else if (bans === 3) {
            verdictTitle = 'LAST CHANCE (INFRAZIONE GRAVE)';
            verdictBadgeClass = 'verdict-lastchance';
            verdictDescription = `Severe violation ("${escapeHtml(predictedReason)}") on top of ${bans} prior bans warrants a Last Chance Pact before Permaban.`;
            confidence = 88;
            riskScore = 84;
            probLC = 60;
            probPerm = 25;
            probBan = 15;
            probWarn = 0;
        } else if (bans === 2) {
            verdictTitle = 'TEMP BAN: 14 - 30 GIORNI (GRAVE)';
            verdictBadgeClass = 'verdict-ban';
            verdictDescription = `Aggressive suspension amplification applied due to severe violation ("${escapeHtml(predictedReason)}") with 2 prior bans.`;
            confidence = 86;
            riskScore = 78;
            probBan = 75;
            probLC = 20;
            probPerm = 5;
            probWarn = 0;
        } else if (bans === 1) {
            verdictTitle = 'TEMP BAN: 7 - 14 GIORNI (GRAVE)';
            verdictBadgeClass = 'verdict-ban';
            verdictDescription = `Severe offense ("${escapeHtml(predictedReason)}") skips minor ladders to 7-14 days suspension.`;
            confidence = 85;
            riskScore = 68;
            probBan = 82;
            probLC = 10;
            probPerm = 3;
            probWarn = 5;
        } else {
            verdictTitle = 'TEMP BAN: 3 - 7 GIORNI (GRAVE)';
            verdictBadgeClass = 'verdict-ban';
            verdictDescription = `Severe violation ("${escapeHtml(predictedReason)}") skips initial advisory warns directly to a temporary suspension.`;
            confidence = 84;
            riskScore = 58;
            probBan = 80;
            probLC = 5;
            probPerm = 2;
            probWarn = 13;
        }
    } else if (violationTier === 'MINOR') {
        // Minor procedural infractions favor warning notices unless the player has extreme history
        if (bans >= 5) {
            verdictTitle = 'TEMP BAN: 3 - 7 GIORNI (RECIDIVO)';
            verdictBadgeClass = 'verdict-ban';
            verdictDescription = `Minor violation ("${escapeHtml(predictedReason)}") escalated to suspension due to elevated prior sanction history (${bans} bans).`;
            confidence = 85;
            riskScore = 55;
            probBan = 65;
            probWarn = 25;
            probLC = 8;
            probPerm = 2;
        } else if (bans >= 3) {
            verdictTitle = '1° WARN DI DIFFIDA (STORICO ALTO)';
            verdictBadgeClass = 'verdict-warn';
            verdictDescription = `Minor procedural infraction ("${escapeHtml(predictedReason)}") issued with strict warning notice despite ${bans} prior bans.`;
            confidence = 86;
            riskScore = 38;
            probWarn = 75;
            probBan = 20;
            probLC = 4;
            probPerm = 1;
        } else if (warns >= 2) {
            verdictTitle = '3° WARN ➔ AUTO BAN (24H - 3D)';
            verdictBadgeClass = 'verdict-warn';
            verdictDescription = 'Player is at <strong>2/3 Active Warnings</strong>. This minor offense triggers automatic warn limit conversion.';
            confidence = 92;
            riskScore = 48;
            probBan = 60;
            probWarn = 35;
            probLC = 4;
            probPerm = 1;
        } else if (warns === 1) {
            verdictTitle = '2° WARN (DIFFIDA SCRITTA)';
            verdictBadgeClass = 'verdict-warn';
            verdictDescription = `Minor infraction ("${escapeHtml(predictedReason)}") recorded as 2nd official warning.`;
            confidence = 88;
            riskScore = 28;
            probWarn = 82;
            probBan = 15;
            probLC = 2;
            probPerm = 1;
        } else {
            verdictTitle = '1° WARN / AVVISO PROCEDURALE';
            verdictBadgeClass = 'verdict-clean';
            verdictDescription = `Minor procedural infraction ("${escapeHtml(predictedReason)}"). Handled via initial educational warning notice.`;
            confidence = 94;
            riskScore = 10;
            probWarn = 92;
            probBan = 6;
            probLC = 1;
            probPerm = 1;
        }
    } else {
        // TIER 2: MEDIUM GAMEPLAY INFRACTIONS (Slog, Tossicità, No Fear, RDM, VDM, Spawnkill...)
        if (bans >= 5 || (bans >= 3 && perms > 0)) {
            verdictTitle = 'LAST CHANCE AGREEMENT';
            verdictBadgeClass = 'verdict-lastchance';
            verdictDescription = `Player has accumulated <strong>${bans} prior bans</strong>. Escalation protocol warrants a Last Chance Pact before permanent ban.`;
            confidence = 88;
            riskScore = 86;
            probLC = 60;
            probPerm = 28;
            probBan = 10;
            probWarn = 2;
        } else if (bans === 4) {
            verdictTitle = 'TEMP BAN: 30 GIORNI';
            verdictBadgeClass = 'verdict-ban';
            verdictDescription = 'Critical escalation tier (4th Temp Ban). Standard progression applies a 30-day suspension before Last Chance.';
            confidence = 86;
            riskScore = 78;
            probBan = 65;
            probLC = 25;
            probPerm = 8;
            probWarn = 2;
        } else if (bans === 3) {
            verdictTitle = 'TEMP BAN: 14 - 30 GIORNI';
            verdictBadgeClass = 'verdict-ban';
            verdictDescription = 'High escalation tier (3rd Temp Ban). Requires extended duration amplification (14 to 30 days).';
            confidence = 85;
            riskScore = 70;
            probBan = 70;
            probLC = 20;
            probPerm = 5;
            probWarn = 5;
        } else if (bans === 2) {
            verdictTitle = 'TEMP BAN: 7 - 14 GIORNI';
            verdictBadgeClass = 'verdict-ban';
            verdictDescription = 'Medium escalation tier (2nd Temp Ban). Escalates from initial ban to 7-14 days suspension.';
            confidence = 84;
            riskScore = 60;
            probBan = 75;
            probLC = 15;
            probPerm = 3;
            probWarn = 7;
        } else if (bans === 1) {
            verdictTitle = 'TEMP BAN: 3 - 7 GIORNI';
            verdictBadgeClass = 'verdict-ban';
            verdictDescription = 'First-tier recurrence. Escalates to 3-7 days suspension based on infraction gravity.';
            confidence = 82;
            riskScore = 48;
            probBan = 72;
            probLC = 8;
            probPerm = 2;
            probWarn = 18;
        } else if (warns >= 2) {
            verdictTitle = '3° WARN ➔ AUTO BAN (3 GIORNI)';
            verdictBadgeClass = 'verdict-warn';
            verdictDescription = 'Player is at <strong>2/3 Active Warnings</strong>. The next threshold converts automatically into a 3-day suspension.';
            confidence = 91;
            riskScore = 52;
            probBan = 65;
            probWarn = 28;
            probLC = 5;
            probPerm = 2;
        } else if (warns === 1) {
            verdictTitle = '2° WARN (FINAL WARNING)';
            verdictBadgeClass = 'verdict-warn';
            verdictDescription = 'First warning on record. Next infraction triggers the 2nd official warning.';
            confidence = 86;
            riskScore = 32;
            probWarn = 75;
            probBan = 20;
            probLC = 4;
            probPerm = 1;
        } else {
            verdictTitle = '1° WARN / RICHIESTA CHIARIMENTI';
            verdictBadgeClass = 'verdict-clean';
            verdictDescription = 'Clean record. Initial advisory warning with standard first-offense protocol.';
            confidence = 90;
            riskScore = 15;
            probWarn = 85;
            probBan = 12;
            probLC = 2;
            probPerm = 1;
        }
    }

    let riskBadgeColor = '#10b981';
    let riskCategory = 'LOW RISK';
    if (riskScore >= 85) { riskBadgeColor = '#f43f5e'; riskCategory = 'CRITICAL RISK'; }
    else if (riskScore >= 60) { riskBadgeColor = '#f97316'; riskCategory = 'HIGH ESCALATION'; }
    else if (riskScore >= 30) { riskBadgeColor = '#f59e0b'; riskCategory = 'MODERATE'; }

    // Render Unique Available Clean Infraction Reasons for What-If
    const officialReasons = [...(COMMON_REASONS || []), ...(BAN_ONLY_REASONS || [])];
    const extractedFromActions = allActions.flatMap(a => extractCleanActionReasons(a));
    const serverUniqueReasons = [...new Set([...officialReasons, ...extractedFromActions])]
        .filter(r => r && !isSystemLogReason(r) && r !== 'Unspecified')
        .sort((a, b) => a.localeCompare(b));

    // Heatmap HTML table with complete names and word wrap
    const heatmapRows = correlation.topReasons.map((rowName, rIdx) => {
        const cells = correlation.matrix[rIdx].map((val, cIdx) => {
            const alpha = Math.min(0.9, Math.max(0.12, val / 100));
            const colName = correlation.topReasons[cIdx];
            const bg = `rgba(168, 85, 247, ${alpha})`;
            return `
                <td class="heatmap-cell" style="background: ${bg};" title="If prior is ${escapeHtml(rowName)}, next is ${escapeHtml(colName)}: ${val}% correlation">
                    ${val}%
                </td>
            `;
        }).join('');

        return `
            <tr>
                <th class="row-label" title="${escapeHtml(rowName)}" style="white-space: normal; max-width: 140px; line-height: 1.25; font-size: 11px; text-align: right; padding: 6px 8px; color: #cbd5e1;">
                    ${escapeHtml(rowName)}
                </th>
                ${cells}
            </tr>
        `;
    }).join('');

    const heatmapCols = correlation.topReasons.map(c => `
        <th title="${escapeHtml(c)}" style="white-space: normal; min-width: 90px; max-width: 130px; line-height: 1.25; font-size: 11px; vertical-align: bottom; padding: 6px 4px; color: #cbd5e1;">
            ${escapeHtml(c)}
        </th>
    `).join('');

    // Escalation Trail Nodes
    const recentTrail = validPlayerActions.slice(-4);
    const trailNodesHtml = recentTrail.map(a => {
        const isPerm = Boolean(a.permanent);
        const typeBadge = isPerm ? 'PERM' : a.type;
        const color = isPerm ? '#f43f5e' : a.type === 'BAN' ? '#ef4444' : '#f59e0b';
        const dStr = a.timestamp ? new Date(a.timestamp).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '';
        const reason = extractCleanActionReasons(a)[0] || 'Sanction';
        return `
            <div class="trail-node">
                <span style="font-size: 10px; color: #94a3b8;">${dStr}</span>
                <span style="color: ${color}; font-weight: 800;">${typeBadge}</span>
                <span style="font-size: 10.5px; max-width: 90px; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(reason)}">${escapeHtml(reason)}</span>
            </div>
            <i data-lucide="chevron-right" class="trail-arrow" style="width: 14px; height: 14px;"></i>
        `;
    }).join('');

    container.innerHTML = `
        <!-- 4 KPI Verdict Cards -->
        <div class="predictor-kpi-grid">
            <div class="predictor-kpi-card" style="border-left: 3px solid #c084fc;">
                <div class="predictor-kpi-title">
                    <i data-lucide="shield-alert" style="width: 14px; height: 14px; color: #c084fc;"></i>
                    Predicted Next Action
                </div>
                <div class="predictor-verdict-badge ${verdictBadgeClass}">
                    ${verdictTitle}
                </div>
                <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">${verdictDescription}</div>
            </div>

            <div class="predictor-kpi-card" style="border-left: 3px solid #38bdf8;">
                <div class="predictor-kpi-title">
                    <i data-lucide="target" style="width: 14px; height: 14px; color: #38bdf8;"></i>
                    Forecast Confidence
                </div>
                <div style="font-size: 26px; font-weight: 800; color: #38bdf8;">${confidence}%</div>
                <div style="font-size: 11px; color: #94a3b8;">Based on historical ladder & velocity</div>
            </div>

            <div class="predictor-kpi-card" style="border-left: 3px solid ${riskBadgeColor};">
                <div class="predictor-kpi-title">
                    <i data-lucide="activity" style="width: 14px; height: 14px; color: ${riskBadgeColor};"></i>
                    Escalation Risk Score
                </div>
                <div style="display: flex; align-items: baseline; gap: 8px;">
                    <span style="font-size: 26px; font-weight: 800; color: #ffffff;">${riskScore}</span>
                    <span style="font-size: 13px; color: #94a3b8;">/ 100</span>
                    <span style="font-size: 11px; font-weight: 700; color: ${riskBadgeColor}; background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px;">${riskCategory}</span>
                </div>
                <div class="prob-bar-track" style="margin-top: 6px;">
                    <div class="prob-bar-fill" style="width: ${riskScore}%; background: ${riskBadgeColor};"></div>
                </div>
            </div>

            <div class="predictor-kpi-card" style="border-left: 3px solid #f97316;">
                <div class="predictor-kpi-title">
                    <i data-lucide="tag" style="width: 14px; height: 14px; color: #f97316;"></i>
                    Predicted Next Reason
                </div>
                <div style="font-size: 17px; font-weight: 800; color: #fdba74; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(predictedReason)}">
                    ${escapeHtml(predictedReason)}
                </div>
                <div style="font-size: 11px; color: #94a3b8;">${correlation.topPredictedConfidence}% Transition Correlation</div>
            </div>
        </div>

        <!-- 2 Column Body: Probabilities & What-If vs Reason Heatmap Matrix -->
        <div class="predictor-body-grid">
            <!-- Left Subpanel: Probabilities & What-If -->
            <div class="predictor-sub-panel">
                <div class="predictor-sub-title">
                    <span><i data-lucide="bar-chart-2" style="width: 14px; height: 14px; color: #c084fc; margin-right: 6px;"></i> Sanction Probabilities Breakdown</span>
                    <span style="font-size: 11px; color: #94a3b8;">Next Event</span>
                </div>

                <div class="prob-bar-row">
                    <div class="prob-bar-labels">
                        <span style="color: #fda4af;">Permanent Ban</span>
                        <span>${probPerm}%</span>
                    </div>
                    <div class="prob-bar-track"><div class="prob-bar-fill" style="width: ${probPerm}%; background: #f43f5e;"></div></div>
                </div>

                <div class="prob-bar-row">
                    <div class="prob-bar-labels">
                        <span style="color: #fdba74;">Last Chance Agreement</span>
                        <span>${probLC}%</span>
                    </div>
                    <div class="prob-bar-track"><div class="prob-bar-fill" style="width: ${probLC}%; background: #f97316;"></div></div>
                </div>

                <div class="prob-bar-row">
                    <div class="prob-bar-labels">
                        <span style="color: #fca5a5;">Temporary Suspension (Ban)</span>
                        <span>${probBan}%</span>
                    </div>
                    <div class="prob-bar-track"><div class="prob-bar-fill" style="width: ${probBan}%; background: #ef4444;"></div></div>
                </div>

                <div class="prob-bar-row">
                    <div class="prob-bar-labels">
                        <span style="color: #fde68a;">Warning (Warn)</span>
                        <span>${probWarn}%</span>
                    </div>
                    <div class="prob-bar-track"><div class="prob-bar-fill" style="width: ${probWarn}%; background: #f59e0b;"></div></div>
                </div>

                <!-- What-If Infraction Simulator -->
                <div class="whatif-box" style="margin-top: 10px;">
                    <div style="font-size: 11.5px; font-weight: 700; color: #c084fc; display: flex; align-items: center; gap: 5px;">
                        <i data-lucide="flask-conical" style="width: 13px; height: 13px;"></i>
                        "What-If" Infraction Simulator
                    </div>
                    <div style="font-size: 11px; color: #94a3b8;">Simulate how the sanction escalates if the player commits a specific violation:</div>
                    <select id="whatif-reason-select" class="whatif-select" aria-label="Select violation for simulation">
                        <option value="">-- Standard Forecast (${escapeHtml(correlation.topPredictedReason)}) --</option>
                        ${serverUniqueReasons.map(r => `<option value="${escapeHtml(r)}" ${hypotheticalReason === r ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
                    </select>
                </div>
            </div>

            <!-- Right Subpanel: Reason Correlation & Transition Heatmap -->
            <div class="predictor-sub-panel">
                <div class="predictor-sub-title">
                    <span><i data-lucide="flame" style="width: 14px; height: 14px; color: #f97316; margin-right: 6px;"></i> Reason Correlation & Transition Heatmap</span>
                    <span style="font-size: 11px; color: #94a3b8;">Historical Sequence Matrix</span>
                </div>

                <div class="heatmap-wrap">
                    <table class="heatmap-table">
                        <thead>
                            <tr>
                                <th style="text-align: right; font-size: 10px;">Prior ➔ Next</th>
                                ${heatmapCols}
                            </tr>
                        </thead>
                        <tbody>
                            ${heatmapRows}
                        </tbody>
                    </table>
                </div>

                <div style="font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                    <span>🔥 Dark = Low Probability | Bright Neon = High Repeat Correlation</span>
                </div>
            </div>
        </div>

        <!-- Escalation Timeline & Predicted Step -->
        <div class="predictor-sub-panel">
            <div class="predictor-sub-title">
                <span><i data-lucide="git-commit" style="width: 14px; height: 14px; color: #818cf8; margin-right: 6px;"></i> Escalation Sequence & Forecast Timeline</span>
                <span style="font-size: 11px; color: #94a3b8;">Recent History ➔ Predicted Node</span>
            </div>
            <div class="escalation-trail">
                ${trailNodesHtml}
                <div class="trail-node future-node">
                    <span style="font-size: 10px; color: #c084fc; font-weight: 700;">PREDICTED NEXT</span>
                    <span style="color: #ffffff; font-weight: 800;">${verdictTitle}</span>
                    <span style="font-size: 10.5px; color: #fdba74;">${escapeHtml(predictedReason)}</span>
                </div>
            </div>
        </div>
    `;

    // Bind What-If Select Handler
    const whatIfSelect = document.getElementById('whatif-reason-select');
    if (whatIfSelect) {
        whatIfSelect.onchange = () => {
            const chosen = whatIfSelect.value || null;
            renderPredictionForPlayer(player, allActions, chosen);
        };
    }

    if (window.lucide && lucide.createIcons) lucide.createIcons();
}