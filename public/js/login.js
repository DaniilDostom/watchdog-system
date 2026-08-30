
let pendingAuthUser = null;

function initLoginPage() {
    if (window.lucide && lucide.createIcons) lucide.createIcons();

    // Check for query errors (e.g. from OAuth failure)
    const urlParams = new URLSearchParams(window.location.search);
    const errorParam = urlParams.get('error');
    const errEl = document.getElementById('login-error-msg');
    
    if (errorParam && errEl) {
        if (errorParam === 'unauthorized') {
            errEl.textContent = 'Unauthorized: This Discord account is not registered as a Staffer or Owner.';
        } else if (errorParam === 'oauth_failed') {
            errEl.textContent = 'Discord OAuth authentication was cancelled or failed. Please try again.';
        } else {
            errEl.textContent = errorParam;
        }
        errEl.style.display = 'block';
    }

    // Check if OAuth callback passed auth payload
    const authDataParam = urlParams.get('auth_payload');
    if (authDataParam) {
        try {
            const data = JSON.parse(decodeURIComponent(authDataParam));
            if (data && data.authorized) {
                handleLoginSuccess(data);
            }
        } catch (e) {}
    }
}

function switchLoginTab(tab) {
    const ownerSection = document.getElementById('owner-login-section');
    const staffSection = document.getElementById('staff-login-section');
    const tabOwner = document.getElementById('tab-owner');
    const tabStaff = document.getElementById('tab-staff');
    const errEl = document.getElementById('login-error-msg');
    if (errEl) errEl.style.display = 'none';

    if (tab === 'staff') {
        if (ownerSection) ownerSection.style.display = 'none';
        if (staffSection) staffSection.style.display = 'block';
        if (tabOwner) tabOwner.classList.remove('active');
        if (tabStaff) tabStaff.classList.add('active');
        document.getElementById('staff-server-password')?.focus();
    } else {
        if (ownerSection) ownerSection.style.display = 'block';
        if (staffSection) staffSection.style.display = 'none';
        if (tabOwner) tabOwner.classList.add('active');
        if (tabStaff) tabStaff.classList.remove('active');
        document.getElementById('login-discord-id')?.focus();
    }
    if (window.lucide && lucide.createIcons) lucide.createIcons();
}
window.switchLoginTab = switchLoginTab;

function handleLoginSuccess(data) {
    if (data.requiresPasswordSetup) {
        // Show First-Time Password Creation Modal
        pendingAuthUser = data;
        const modal = document.getElementById('owner-pwd-setup-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.getElementById('new-server-pwd')?.focus();
            if (window.lucide && lucide.createIcons) lucide.createIcons();
        }
        return;
    }

    setAuthUser(data);
    if (data.serverId) {
        localStorage.setItem('watchdog_active_server_id', data.serverId);
        if (typeof clearClientApiCache === 'function') clearClientApiCache();
    }
    showToast(`Welcome back, ${data.name}!`, 'success');

    setTimeout(() => {
        location.href = data.isMaster ? 'select-server.html' : 'index.html';
    }, 350);
}

async function handleDirectLogin(e) {
    e.preventDefault();
    const idInput = document.getElementById('login-discord-id');
    const submitBtn = document.getElementById('btn-login-submit');
    const errEl = document.getElementById('login-error-msg');

    const discordId = (idInput?.value || '').trim();
    if (!discordId) return;

    if (errEl) errEl.style.display = 'none';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Verifying...</span>';
    }

    try {
        const res = await fetch(`${API_URL}/auth/verify-staff`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ discordId })
        });

        const data = await res.json();
        if (res.ok && data.authorized) {
            handleLoginSuccess(data);
        } else {
            if (errEl) {
                errEl.textContent = data.error || 'Unauthorized: Discord account is not registered.';
                errEl.style.display = 'block';
            }
            if (idInput) highlightInvalidInput(idInput, 'Unauthorized Discord ID');
        }
    } catch (err) {
        if (errEl) {
            errEl.textContent = 'Server connection error. Please try again.';
            errEl.style.display = 'block';
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i data-lucide="shield-check" style="width: 17px; height: 17px;"></i> <span>Verify & Enter</span>`;
            if (window.lucide && lucide.createIcons) lucide.createIcons();
        }
    }
}
window.handleDirectLogin = handleDirectLogin;

async function handleStaffPasswordLogin(e) {
    e.preventDefault();
    const pwdInput = document.getElementById('staff-server-password');
    const submitBtn = document.getElementById('btn-staff-submit');
    const errEl = document.getElementById('login-error-msg');

    const password = (pwdInput?.value || '').trim();
    if (!password) return;

    if (errEl) errEl.style.display = 'none';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Authenticating...</span>';
    }

    try {
        const res = await fetch(`${API_URL}/auth/staff-password-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await res.json();
        if (res.ok && data.authorized) {
            setAuthUser(data);
            if (data.serverId) {
                localStorage.setItem('watchdog_active_server_id', data.serverId);
                if (typeof clearClientApiCache === 'function') clearClientApiCache();
            }
            showToast(`Logged in successfully into ${data.serverName}!`, 'success');
            setTimeout(() => {
                location.href = 'index.html';
            }, 350);
        } else {
            if (errEl) {
                errEl.textContent = data.error || 'Invalid Server Access Password.';
                errEl.style.display = 'block';
            }
            if (pwdInput) highlightInvalidInput(pwdInput, 'Incorrect password');
        }
    } catch (err) {
        if (errEl) {
            errEl.textContent = 'Server connection error. Please try again.';
            errEl.style.display = 'block';
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i data-lucide="lock" style="width: 17px; height: 17px;"></i> <span>Unlock Dashboard</span>`;
            if (window.lucide && lucide.createIcons) lucide.createIcons();
        }
    }
}
window.handleStaffPasswordLogin = handleStaffPasswordLogin;

async function handleOwnerPasswordSetup(e) {
    e.preventDefault();
    if (!pendingAuthUser) return;

    const pwd1 = document.getElementById('new-server-pwd')?.value?.trim();
    const pwd2 = document.getElementById('confirm-server-pwd')?.value?.trim();
    const errEl = document.getElementById('pwd-setup-error');
    const submitBtn = document.getElementById('btn-save-pwd');

    if (!pwd1 || pwd1.length < 4) {
        if (errEl) {
            errEl.textContent = 'Password must be at least 4 characters long.';
            errEl.style.display = 'block';
        }
        return;
    }

    if (pwd1 !== pwd2) {
        if (errEl) {
            errEl.textContent = 'Passwords do not match. Please re-enter.';
            errEl.style.display = 'block';
        }
        return;
    }

    if (errEl) errEl.style.display = 'none';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Saving security password...</span>';
    }

    try {
        const res = await fetch(`${API_URL}/auth/server/set-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                serverId: pendingAuthUser.serverId,
                discordId: pendingAuthUser.discordId,
                password: pwd1
            })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            showToast('Server access password set successfully!', 'success');
            pendingAuthUser.requiresPasswordSetup = false;
            setAuthUser(pendingAuthUser);
            if (pendingAuthUser.serverId) {
                localStorage.setItem('watchdog_active_server_id', pendingAuthUser.serverId);
                if (typeof clearClientApiCache === 'function') clearClientApiCache();
            }
            setTimeout(() => {
                location.href = pendingAuthUser.isMaster ? 'select-server.html' : 'index.html';
            }, 350);
        } else {
            if (errEl) {
                errEl.textContent = data.error || 'Failed to save password.';
                errEl.style.display = 'block';
            }
        }
    } catch (err) {
        if (errEl) {
            errEl.textContent = 'Server connection error.';
            errEl.style.display = 'block';
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i data-lucide="check-circle" style="width: 17px; height: 17px;"></i> <span>Save Password & Open Dashboard</span>`;
            if (window.lucide && lucide.createIcons) lucide.createIcons();
        }
    }
}
window.handleOwnerPasswordSetup = handleOwnerPasswordSetup;

document.addEventListener('DOMContentLoaded', initLoginPage);
