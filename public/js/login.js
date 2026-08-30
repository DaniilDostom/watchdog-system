
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

    // Check if OAuth callback passed auth payload in sessionStorage / hash
    const authDataParam = urlParams.get('auth_payload');
    if (authDataParam) {
        try {
            const data = JSON.parse(decodeURIComponent(authDataParam));
            if (data && data.authorized) {
                setAuthUser(data);
                if (data.serverId) {
                    localStorage.setItem('watchdog_active_server_id', data.serverId);
                    if (typeof clearClientApiCache === 'function') clearClientApiCache();
                }
                showToast(`Welcome back, ${data.name}!`, 'success');
                setTimeout(() => {
                    location.href = data.isMaster ? 'select-server.html' : 'index.html';
                }, 300);
            }
        } catch (e) {}
    }
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
            setAuthUser(data);
            if (data.serverId) {
                localStorage.setItem('watchdog_active_server_id', data.serverId);
                if (typeof clearClientApiCache === 'function') clearClientApiCache();
            }
            showToast(`Welcome back, ${data.name}! Logged in as ${data.isMaster ? 'Master Creator' : (data.role === 'owner' ? 'Server Owner' : 'Staffer')}.`, 'success');

            setTimeout(() => {
                location.href = data.isMaster ? 'select-server.html' : 'index.html';
            }, 350);
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

document.addEventListener('DOMContentLoaded', initLoginPage);
