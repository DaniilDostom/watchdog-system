
let currentServerInfo = null;

async function initSettingsPage() {
    if (window.lucide && lucide.createIcons) lucide.createIcons();
    loadCurrentServerSettings();
}

async function loadCurrentServerSettings() {
    const user = getAuthUser();
    const activeServerId = (typeof getActiveServerId === 'function') ? getActiveServerId() : 'default_server';

    try {
        const res = await fetch(`${API_URL}/server/current`, {
            headers: {
                'x-server-id': activeServerId,
                'x-discord-id': user?.discordId || ''
            }
        });

        if (res.ok) {
            const data = await res.json();
            currentServerInfo = data;
            renderServerSettings(data, user);
        }
    } catch (err) {}
}

function renderServerSettings(data, user) {
    // Hero Banner
    const heroName = document.getElementById('hero-server-name');
    const heroId = document.getElementById('hero-server-id');
    const heroExpiry = document.getElementById('hero-expiry-label');
    const heroStatus = document.getElementById('hero-status-pill');

    if (heroName) heroName.textContent = data.name || 'Watchdog Server';
    if (heroId) heroId.textContent = `ID: ${data.id}`;
    if (heroExpiry) heroExpiry.textContent = data.expiresAt ? `Expires: ${new Date(data.expiresAt).toLocaleDateString()}` : 'Lifetime License';
    if (heroStatus) {
        heroStatus.textContent = data.status || 'ACTIVE';
        heroStatus.className = `server-status-pill ${data.status === 'ACTIVE' ? 'active' : 'suspended'}`;
    }

    // Owner Avatar & Name
    const ownerAvatar = document.getElementById('hero-owner-avatar');
    const ownerName = document.getElementById('hero-owner-name');
    const ownerSub = document.getElementById('hero-owner-sub');

    if (ownerAvatar && user?.avatarUrl) ownerAvatar.src = user.avatarUrl;
    if (ownerName && user?.name) ownerName.textContent = user.name;
    if (ownerSub && user?.discordId) ownerSub.textContent = `@${user.username || 'owner'} • ${user.discordId}`;

    // Key Box
    const keyInput = document.getElementById('settings-api-key-val');
    if (keyInput) keyInput.value = data.apiKey || '';

    // Discord Guild ID Input
    const guildInput = document.getElementById('settings-guild-id-input');
    if (guildInput) guildInput.value = data.guildId || '';

    // Lua Preview
    const luaBox = document.getElementById('lua-code-preview');
    if (luaBox) {
        const originUrl = window.location.origin || 'http://localhost:3000';
        luaBox.textContent = `Config = {}
Config.ApiUrl = "${originUrl}"
Config.ServerKey = "${data.apiKey || 'wd_live_xxx'}"`;
    }
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}

async function handleUpdateGuildId(e) {
    e.preventDefault();
    const user = getAuthUser();
    const activeServerId = (typeof getActiveServerId === 'function') ? getActiveServerId() : 'default_server';
    const guildInput = document.getElementById('settings-guild-id-input');
    const submitBtn = document.getElementById('btn-save-guild-id');

    const guildId = (guildInput?.value || '').trim();

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Saving...</span>';
    }

    try {
        const res = await fetch(`${API_URL}/server/update-guild`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-server-id': activeServerId,
                'x-discord-id': user?.discordId || ''
            },
            body: JSON.stringify({
                serverId: activeServerId,
                guildId: guildId || null,
                discordId: user?.discordId
            })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast('Discord Guild ID saved successfully!', 'success');
        } else {
            showToast(data.error || 'Failed to save Guild ID', 'error');
        }
    } catch (err) {
        showToast('Server connection error', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Save ID</span>';
        }
    }
}
window.handleUpdateGuildId = handleUpdateGuildId;

async function handleUpdateDbPassword(e) {
    e.preventDefault();
    const user = getAuthUser();
    const activeServerId = (typeof getActiveServerId === 'function') ? getActiveServerId() : 'default_server';
    const pwd1 = document.getElementById('settings-new-pwd')?.value?.trim();
    const pwd2 = document.getElementById('settings-confirm-pwd')?.value?.trim();
    const msgEl = document.getElementById('pwd-change-msg');
    const submitBtn = document.getElementById('btn-save-settings-pwd');

    if (!pwd1 || pwd1.length < 4) {
        if (msgEl) {
            msgEl.textContent = 'Password must be at least 4 characters long.';
            msgEl.style.display = 'block';
            msgEl.style.color = '#ef4444';
            msgEl.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            msgEl.style.background = 'rgba(239, 68, 68, 0.1)';
        }
        return;
    }

    if (pwd1 !== pwd2) {
        if (msgEl) {
            msgEl.textContent = 'Passwords do not match. Please re-enter.';
            msgEl.style.display = 'block';
            msgEl.style.color = '#ef4444';
            msgEl.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            msgEl.style.background = 'rgba(239, 68, 68, 0.1)';
        }
        return;
    }

    if (msgEl) msgEl.style.display = 'none';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Saving...</span>';
    }

    try {
        const res = await fetch(`${API_URL}/server/update-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-server-id': activeServerId,
                'x-discord-id': user?.discordId || ''
            },
            body: JSON.stringify({
                serverId: activeServerId,
                newPassword: pwd1,
                discordId: user?.discordId
            })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast('Database access password updated successfully!', 'success');
            document.getElementById('change-db-pwd-form')?.reset();
            if (msgEl) {
                msgEl.textContent = 'Security password updated! Your staff will need this password on their next login.';
                msgEl.style.display = 'block';
                msgEl.style.color = '#34d399';
                msgEl.style.borderColor = 'rgba(52, 211, 153, 0.4)';
                msgEl.style.background = 'rgba(52, 211, 153, 0.1)';
            }
        } else {
            if (msgEl) {
                msgEl.textContent = data.error || 'Failed to update password.';
                msgEl.style.display = 'block';
                msgEl.style.color = '#ef4444';
                msgEl.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                msgEl.style.background = 'rgba(239, 68, 68, 0.1)';
            }
        }
    } catch (err) {
        if (msgEl) {
            msgEl.textContent = 'Server connection error.';
            msgEl.style.display = 'block';
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i data-lucide="shield-check" style="width: 17px; height: 17px;"></i> <span>Update Security Password</span>`;
            if (window.lucide && lucide.createIcons) lucide.createIcons();
        }
    }
}
window.handleUpdateDbPassword = handleUpdateDbPassword;

function toggleSettingsKeyVisibility() {
    const input = document.getElementById('settings-api-key-val');
    const icon = document.getElementById('settings-eye-icon');
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.setAttribute('data-lucide', 'eye-off');
    } else {
        input.type = 'password';
        if (icon) icon.setAttribute('data-lucide', 'eye');
    }
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}
window.toggleSettingsKeyVisibility = toggleSettingsKeyVisibility;

function copySettingsApiKey() {
    const input = document.getElementById('settings-api-key-val');
    if (input && input.value) {
        navigator.clipboard.writeText(input.value).then(() => {
            showToast('FiveM Secret Key copied to clipboard!', 'success');
        });
    }
}
window.copySettingsApiKey = copySettingsApiKey;

async function regenerateSettingsApiKey() {
    const confirmed = await showCustomConfirm({
        title: 'Regenerate FiveM Key?',
        message: 'This will invalidate your current FiveM Secret Key. You will need to update config.lua on your FiveM server.',
        confirmText: 'Regenerate',
        cancelText: 'Cancel',
        type: 'danger',
        icon: 'refresh-cw'
    });
    if (!confirmed) return;

    const user = getAuthUser();
    const activeServerId = (typeof getActiveServerId === 'function') ? getActiveServerId() : 'default_server';

    try {
        const res = await fetch(`${API_URL}/server/regenerate-key`, {
            method: 'POST',
            headers: {
                'x-server-id': activeServerId,
                'x-discord-id': user?.discordId || ''
            }
        });

        if (res.ok) {
            const data = await res.json();
            showToast('New FiveM Secret Key generated!', 'success');
            loadCurrentServerSettings();
        }
    } catch (err) {
        showToast('Failed to regenerate key', 'error');
    }
}
window.regenerateSettingsApiKey = regenerateSettingsApiKey;

function copyLuaSnippet() {
    const luaBox = document.getElementById('lua-code-preview');
    const label = document.getElementById('lua-copy-label');
    if (luaBox && luaBox.textContent) {
        navigator.clipboard.writeText(luaBox.textContent).then(() => {
            showToast('config.lua snippet copied to clipboard!', 'success');
            if (label) {
                label.textContent = 'Copied!';
                setTimeout(() => { label.textContent = 'Copy'; }, 2000);
            }
        });
    }
}
window.copyLuaSnippet = copyLuaSnippet;

document.addEventListener('DOMContentLoaded', initSettingsPage);
