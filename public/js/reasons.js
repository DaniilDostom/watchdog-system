let reasonsData = { normal: [], bad: [], good: [] };
let allActionsCache = [];
const CATEGORIES = ['normal', 'bad', 'good'];

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function computeReasonUsage() {
    const usageMap = new Map();

    const registerUsage = (reasonStr) => {
        if (!reasonStr) return;
        String(reasonStr).split(/[,;|\n]+/).forEach(r => {
            const trimmed = r.trim();
            if (trimmed) {
                const key = trimmed.toLowerCase();
                usageMap.set(key, (usageMap.get(key) || 0) + 1);
            }
        });
    };

    allActionsCache.forEach(a => {
        if (Array.isArray(a.reasonKeys)) {
            a.reasonKeys.forEach(registerUsage);
        } else if (a.reasonKey) {
            registerUsage(a.reasonKey);
        }
        if (a.reasonRaw) registerUsage(a.reasonRaw);
        if (a.reason) registerUsage(a.reason);
        if (a.removedReason) registerUsage(a.removedReason);
    });

    return usageMap;
}

function updateOverviewCounters() {
    const normalCount = (reasonsData.normal || []).length;
    const badCount = (reasonsData.bad || []).length;
    const goodCount = (reasonsData.good || []).length;
    const total = normalCount + badCount + goodCount;

    const elTotal = document.getElementById('stat-total-reasons');
    const elNormal = document.getElementById('count-normal');
    const elBad = document.getElementById('count-bad');
    const elGood = document.getElementById('count-good');

    const badgeNormal = document.getElementById('badge-normal');
    const badgeBad = document.getElementById('badge-bad');
    const badgeGood = document.getElementById('badge-good');

    if (elTotal) elTotal.innerText = total;
    if (elNormal) elNormal.innerText = normalCount;
    if (elBad) elBad.innerText = badCount;
    if (elGood) elGood.innerText = goodCount;

    if (badgeNormal) badgeNormal.innerText = `${normalCount} reasons`;
    if (badgeBad) badgeBad.innerText = `${badCount} reasons`;
    if (badgeGood) badgeGood.innerText = `${goodCount} reasons`;
}

async function initReasons() {
    const [reasons, actions] = await Promise.all([
        ModAPI.getReasons(),
        ModAPI.getActions()
    ]);

    reasonsData = reasons || { normal: [], bad: [], good: [] };
    allActionsCache = actions || [];

    updateOverviewCounters();
    renderAll();

    document.querySelectorAll('[data-add]').forEach(button => {
        button.addEventListener('click', () => addReason(button.dataset.add));
    });

    document.querySelectorAll('.reason-add-form-v2 input').forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const category = input.id.replace('add-', '').replace('-input', '');
                addReason(category);
            }
        });
    });

    const searchInput = document.getElementById('reasons-search-input');
    const clearBtn = document.getElementById('reasons-search-clear');

    let reasonSearchTimer = null;
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            if (clearBtn) clearBtn.style.display = searchInput.value ? 'block' : 'none';
            clearTimeout(reasonSearchTimer);
            reasonSearchTimer = setTimeout(renderAll, 80);
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            clearBtn.style.display = 'none';
            renderAll();
            searchInput.focus();
        });
    }
}

function renderAll() {
    updateOverviewCounters();
    CATEGORIES.forEach(renderList);
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
}

function renderList(category) {
    const searchQuery = (document.getElementById('reasons-search-input')?.value || '').toLowerCase().trim();
    const usageMap = computeReasonUsage();

    let items = [...(reasonsData[category] || [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    if (searchQuery) {
        items = items.filter(r => r.toLowerCase().includes(searchQuery));
    }

    const list = document.getElementById(`list-${category}`);
    if (!list) return;

    if (!items.length) {
        list.innerHTML = `<li style="text-align: center; color: #64748b; font-size: 12.5px; padding: 24px 0; font-style: italic;">No reasons found</li>`;
        return;
    }

    list.innerHTML = items.map(reason => {
        const safeReason = escapeHtml(reason);
        const uses = usageMap.get(reason.toLowerCase()) || 0;
        const usageText = uses === 1 ? '1 use' : `${uses} uses`;

        return `
            <li class="reason-item-card">
                <span class="reason-item-text">${safeReason}</span>
                <span class="reason-usage-pill" title="Used in ${uses} sanctions across database">
                    <i data-lucide="activity" style="width: 10px; height: 10px;"></i>
                    ${usageText}
                </span>
                <div style="display: inline-flex; gap: 4px;">
                    <button type="button" class="reason-edit-btn" title="Edit reason and cascade to sanctions" onclick="openEditReasonModal('${category}', '${safeReason.replace(/'/g, "\\'")}')">
                        <i data-lucide="edit-2" style="width: 14px; height: 14px;"></i>
                    </button>
                    <button type="button" class="reason-del-btn" title="Remove reason" onclick="removeReason('${category}', '${safeReason.replace(/'/g, "\\'")}')">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
            </li>
        `;
    }).join('');
}

function openEditReasonModal(category, reason) {
    const modal = document.getElementById('edit-reason-modal');
    const catInput = document.getElementById('edit-reason-category');
    const origInput = document.getElementById('edit-reason-original');
    const currentDisplay = document.getElementById('edit-reason-current-display');
    const newInput = document.getElementById('edit-reason-new-input');

    if (catInput) catInput.value = category;
    if (origInput) origInput.value = reason;
    if (currentDisplay) currentDisplay.value = reason;
    if (newInput) newInput.value = reason;

    if (modal) modal.style.display = 'flex';
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    newInput?.focus();
    newInput?.select();
}

function closeEditReasonModal() {
    const modal = document.getElementById('edit-reason-modal');
    if (modal) modal.style.display = 'none';
    document.getElementById('edit-reason-form')?.reset();
}

window.openEditReasonModal = openEditReasonModal;
window.closeEditReasonModal = closeEditReasonModal;

async function addReason(category) {
    const input = document.getElementById(`add-${category}-input`);
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;

    if (!reasonsData[category]) reasonsData[category] = [];

    if (reasonsData[category].some(r => r.toLowerCase() === value.toLowerCase())) {
        showToast('This reason already exists in this category.', 'warning');
        return;
    }

    reasonsData[category].push(value);
    await ModAPI.saveReasons(reasonsData);
    input.value = '';
    renderAll();
    showToast('Reason added successfully.');
}

async function removeReason(category, reason) {
    let confirmed = false;
    if (typeof showCustomConfirm === 'function') {
        confirmed = await showCustomConfirm({
            title: 'Delete Reason Preset',
            message: `Are you sure you want to remove "${reason}" from ${category.toUpperCase()} reasons? Existing logs will remain intact.`,
            confirmText: 'Yes, Delete',
            cancelText: 'Cancel',
            type: 'danger',
            icon: 'trash-2'
        });
    } else {
        confirmed = confirm(`Do you want to remove the reason "${reason}"?`);
    }

    if (!confirmed) return;

    reasonsData[category] = (reasonsData[category] || []).filter(r => r !== reason);
    await ModAPI.saveReasons(reasonsData);
    renderAll();
    showToast('Reason removed successfully.');
}

window.removeReason = removeReason;

document.addEventListener('DOMContentLoaded', () => {
    initReasons();

    const editForm = document.getElementById('edit-reason-form');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const category = document.getElementById('edit-reason-category')?.value;
            const originalReason = document.getElementById('edit-reason-original')?.value;
            const newReason = document.getElementById('edit-reason-new-input')?.value.trim();

            if (!newReason) {
                showToast('Please enter a valid reason name.', 'warning');
                return;
            }

            if (newReason.toLowerCase() !== originalReason.toLowerCase()) {
                if (reasonsData[category]?.some(r => r.toLowerCase() === newReason.toLowerCase())) {
                    showToast('A reason with this name already exists.', 'warning');
                    return;
                }
            }

            // 1. Update in category list
            const idx = (reasonsData[category] || []).indexOf(originalReason);
            if (idx > -1) {
                reasonsData[category][idx] = newReason;
            } else {
                reasonsData[category].push(newReason);
            }
            await ModAPI.saveReasons(reasonsData);

            // 2. Cascade update to all actions in database
            let cascadeCount = 0;
            const escapedOrig = originalReason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b${escapedOrig}\\b`, 'gi');

            allActionsCache.forEach(action => {
                let changed = false;

                if (Array.isArray(action.reasonKeys)) {
                    action.reasonKeys = action.reasonKeys.map(k => {
                        if (k.toLowerCase() === originalReason.toLowerCase()) {
                            changed = true;
                            return newReason;
                        }
                        return k;
                    });
                    action.reasonKeys = [...new Set(action.reasonKeys)];
                }

                if (typeof action.reasonKey === 'string' && action.reasonKey.toLowerCase() === originalReason.toLowerCase()) {
                    action.reasonKey = newReason;
                    changed = true;
                }

                if (typeof action.reasonRaw === 'string' && regex.test(action.reasonRaw)) {
                    action.reasonRaw = action.reasonRaw.replace(regex, newReason);
                    changed = true;
                }

                if (typeof action.reason === 'string' && regex.test(action.reason)) {
                    action.reason = action.reason.replace(regex, newReason);
                    changed = true;
                }

                if (typeof action.removedReason === 'string' && regex.test(action.removedReason)) {
                    action.removedReason = action.removedReason.replace(regex, newReason);
                    changed = true;
                }

                if (changed) cascadeCount++;
            });

            if (cascadeCount > 0) {
                await ModAPI.saveActions(allActionsCache);
            }

            closeEditReasonModal();
            renderAll();
            showToast(`Reason updated and cascaded to ${cascadeCount} sanctions.`);
        });
    }
});


