require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();

// 1. Enhanced Security Headers (Helmet)
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Additional HTTP Hardening
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// High-Performance Middleware Stack
app.use(cors());
app.use(compression({ level: 6, threshold: 512 }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// 2. Cryptographic Session Token Engine (HMAC-SHA256)
const AUTH_SECRET = process.env.AUTH_SECRET || 'wd_super_secret_auth_key_2026_' + (process.env.DISCORD_BOT_TOKEN || 'seed_key').substring(0, 16);

function generateAuthToken(payload) {
    const data = {
        ...payload,
        iat: Date.now(),
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days expiration
    };
    const bodyStr = Buffer.from(JSON.stringify(data)).toString('base64url');
    const signature = crypto.createHmac('sha256', AUTH_SECRET).update(bodyStr).digest('base64url');
    return `${bodyStr}.${signature}`;
}

function verifyAuthToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [bodyStr, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(bodyStr).digest('base64url');
    if (signature !== expectedSig) return null;
    try {
        const data = JSON.parse(Buffer.from(bodyStr, 'base64url').toString('utf8'));
        if (data.exp && Date.now() > data.exp) return null;
        return data;
    } catch {
        return null;
    }
}

function extractToken(req) {
    if (req.cookies && req.cookies.watchdog_auth_token) {
        return req.cookies.watchdog_auth_token;
    }
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7).trim();
    }
    return req.headers['x-auth-token'] || req.query.token || null;
}

// 3. Rate Limiting Middleware
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 35, // 35 auth attempts per 15 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { authorized: false, error: 'Too many authentication attempts. Please try again later.' }
});

const globalApiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 600, // 600 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' }
});

app.use('/api/', globalApiLimiter);
app.use('/api/auth/', authLimiter);

// 4. Server-Side Guard for Protected HTML Pages (Zero Leakage via URL typing)
const PROTECTED_HTML_PAGES = new Set([
    'index.html',
    'players.html',
    'player.html',
    'moderators.html',
    'reasons.html',
    'statistics.html',
    'activity.html',
    'settings.html',
    'admin.html',
    'select-server.html'
]);

app.use((req, res, next) => {
    let reqPage = req.path.replace(/^\//, '').toLowerCase();
    if (!reqPage || reqPage === 'login' || reqPage === 'login.html' || reqPage === 'home.html') {
        return next();
    }

    if (PROTECTED_HTML_PAGES.has(reqPage)) {
        const token = extractToken(req);
        const user = verifyAuthToken(token);

        // If unauthenticated at the server level, immediately 302 Redirect to /login.html
        if (!user) {
            return res.redirect('/login.html');
        }

        // Server-Side Role Authorization
        if ((reqPage === 'admin.html' || reqPage === 'select-server.html') && !user.isMaster) {
            return res.redirect('/index.html');
        }
        if (reqPage === 'settings.html' && !user.isOwner && !user.isMaster) {
            return res.redirect('/index.html');
        }

        req.user = user;
    }
    next();
});

// Serve root directly to the Watchdog Login Portal
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/home.html', (req, res) => res.redirect('/'));

// Static asset delivery with ETags enabled
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true
}));

// Master Admin Verification Middleware
function requireMasterAdmin(req, res, next) {
    const token = extractToken(req);
    const user = verifyAuthToken(token);
    if (user && user.isMaster) {
        req.user = user;
        return next();
    }
    const adminId = req.headers['x-discord-id'] || req.query.adminId || req.body?.adminId;
    if (adminId && db.isOwner(adminId)) {
        req.user = { discordId: adminId, isMaster: true, isOwner: true };
        return next();
    }
    return res.status(403).json({ error: 'Forbidden: Master Admin privileges required.' });
}

// Master Admin Endpoints
app.get('/api/admin/servers', requireMasterAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    const servers = db.getServers();
    
    const enriched = await Promise.all(servers.map(async (s) => {
        const profile = await resolveDiscordProfile(s.ownerDiscordId);
        return {
            ...s,
            ownerName: profile.globalName || profile.username || 'Owner',
            ownerUsername: profile.username || 'user',
            ownerAvatarUrl: profile.url || null
        };
    }));
    
    res.json(enriched);
});

app.post('/api/admin/servers', requireMasterAdmin, (req, res) => {
    try {
        const { name, ownerDiscordId, durationDays } = req.body || {};
        if (!name || !ownerDiscordId) {
            return res.status(400).json({ error: 'Server Name and Owner Discord ID are required.' });
        }
        const created = db.createServer({ name, ownerDiscordId, durationDays });
        res.status(201).json(created);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/admin/servers/:id/toggle-status', requireMasterAdmin, (req, res) => {
    const newStatus = db.toggleServerStatus(req.params.id);
    if (!newStatus) return res.status(404).json({ error: 'Server not found' });
    res.json({ status: newStatus });
});

app.post('/api/admin/servers/:id/regenerate-key', requireMasterAdmin, (req, res) => {
    const newKey = db.regenerateServerApiKey(req.params.id);
    res.json({ apiKey: newKey });
});

app.delete('/api/admin/servers/:id', requireMasterAdmin, (req, res) => {
    try {
        db.deleteServer(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/admin/servers/:id/export', requireMasterAdmin, (req, res) => {
    const server = db.getServerById(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    
    const dump = {
        server,
        players: db.getAll('players', server.id),
        actions: db.getAll('actions', server.id),
        moderators: db.getModerators(server.id),
        reasons: db.getReasons(server.id),
        exportedAt: new Date().toISOString()
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="watchdog_backup_${server.id}.json"`);
    res.json(dump);
});

// Multi-Tenant Server Context Resolver
function resolveServerId(req) {
    const key = req.headers['x-watchdog-key'] || req.query.key;
    if (key) {
        const srv = db.getServerByApiKey(key);
        if (srv) {
            if (srv.status === 'SUSPENDED' || (srv.expiresAt && Date.now() > srv.expiresAt)) {
                return 'suspended_empty';
            }
            return srv.id;
        }
    }
    const headerServerId = req.headers['x-server-id'];
    if (headerServerId && typeof headerServerId === 'string' && headerServerId.trim()) {
        const sid = headerServerId.trim();
        const srv = db.getServerById(sid);
        const adminId = req.headers['x-discord-id'] || req.query.adminId;
        const isMasterAdmin = adminId && db.isOwner(adminId);
        if (srv && !isMasterAdmin && (srv.status === 'SUSPENDED' || (srv.expiresAt && Date.now() > srv.expiresAt))) {
            return 'suspended_empty';
        }
        return sid;
    }
    const queryServerId = req.query.serverId;
    if (queryServerId && typeof queryServerId === 'string' && queryServerId.trim()) {
        return queryServerId.trim();
    }
    return 'unauthenticated_empty';
}

// Staff verification & Discord Login endpoint
app.post('/api/auth/verify-staff', async (req, res) => {
    const rawId = req.body?.discordId;
    if (!rawId) return res.status(400).json({ authorized: false, error: 'Discord ID is required' });
    
    const discordId = String(rawId).trim();
    const isMaster = db.isOwner(discordId);
    const customerServer = db.getServerByOwner(discordId);

    // Resolve real live Discord profile (avatar, display name)
    const profile = await resolveDiscordProfile(discordId);

    // 1. MASTER CREATOR
    if (isMaster) {
        const tokenPayload = { discordId, role: 'owner', isOwner: true, isMaster: true, serverId: 'default_server' };
        const token = generateAuthToken(tokenPayload);
        res.cookie('watchdog_auth_token', token, { path: '/', maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
        return res.json({
            authorized: true,
            token,
            role: 'owner',
            isOwner: true,
            isMaster: true,
            requiresDbPassword: false,
            requiresPasswordSetup: false,
            serverId: 'default_server',
            serverName: 'Main Watchdog Server',
            name: profile.globalName || profile.username || 'Dos',
            username: profile.username || 'dosfpsss',
            discordId,
            avatarUrl: profile.url || null
        });
    }

    // 2. CUSTOMER SERVER OWNER
    if (customerServer) {
        if (customerServer.status === 'SUSPENDED') {
            return res.status(403).json({
                authorized: false,
                error: 'License Suspended: Access to this server database has been suspended by the Master Administrator.'
            });
        }
        if (customerServer.expiresAt && Date.now() > customerServer.expiresAt) {
            return res.status(403).json({
                authorized: false,
                error: 'License Expired: Your server subscription has expired. Please contact the administrator.'
            });
        }

        const requiresPasswordSetup = !customerServer.password;
        const tokenPayload = { discordId, role: 'owner', isOwner: true, isMaster: false, serverId: customerServer.id };
        const token = generateAuthToken(tokenPayload);
        res.cookie('watchdog_auth_token', token, { path: '/', maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
        return res.json({
            authorized: true,
            token,
            role: 'owner',
            isOwner: true,
            isMaster: false,
            requiresDbPassword: false,
            requiresPasswordSetup,
            serverId: customerServer.id,
            serverName: customerServer.name,
            name: profile.globalName || profile.username || 'Owner',
            username: profile.username || 'User',
            discordId,
            avatarUrl: profile.url || null
        });
    }

    // 3. STAFFER / NON-OWNER: Authenticated with Discord, now requires DB Password
    const tokenPayload = { discordId, role: 'staffer', isOwner: false, isMaster: false, serverId: srv.id };
    const token = generateAuthToken(tokenPayload);
    res.cookie('watchdog_auth_token', token, { path: '/', maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    return res.json({
        authorized: true,
        token,
        role: 'staffer',
        isOwner: false,
        isMaster: false,
        requiresDbPassword: true,
        requiresPasswordSetup: false,
        name: profile.globalName || profile.username || 'Staffer',
        username: profile.username || 'User',
        discordId,
        avatarUrl: profile.url || null
    });
});

// Staff DB Password Verification (Submits Discord ID + Database Password)
app.post('/api/auth/verify-staff-db-password', async (req, res) => {
    const { discordId, password } = req.body || {};
    if (!discordId || !password) {
        return res.status(400).json({ authorized: false, error: 'Discord ID and Database Password are required.' });
    }

    const srv = db.verifyServerPassword(password);
    if (!srv) {
        return res.status(401).json({ authorized: false, error: 'Invalid Database Access Password.' });
    }

    if (srv.status === 'SUSPENDED') {
        return res.status(403).json({ authorized: false, error: 'License Suspended: Access to this server database is suspended.' });
    }

    if (srv.expiresAt && Date.now() > srv.expiresAt) {
        return res.status(403).json({ authorized: false, error: 'License Expired: This server license has expired.' });
    }

    const profile = await resolveDiscordProfile(discordId);

    // Auto-register staff member into moderators list for this server
    try {
        const mods = db.getModerators(srv.id) || [];
        const exists = mods.some(m => String(m.discordId) === String(discordId));
        if (!exists) {
            mods.push({
                name: profile.globalName || profile.username || 'Staffer',
                discordId: String(discordId),
                avatarUrl: profile.url || null,
                bannerUrl: profile.bannerUrl || null,
                isFormer: false
            });
            db.saveModerators(mods, srv.id);
        }
    } catch (e) {}

    return res.json({
        authorized: true,
        role: 'staffer',
        isOwner: false,
        isMaster: false,
        requiresDbPassword: false,
        serverId: srv.id,
        serverName: srv.name,
        name: profile.globalName || profile.username || 'Staffer',
        username: profile.username || 'User',
        discordId,
        avatarUrl: profile.url || null
    });
});

// Set initial or updated server access password
app.post('/api/auth/server/set-password', (req, res) => {
    const { serverId, password, discordId } = req.body || {};
    if (!serverId || !password) {
        return res.status(400).json({ success: false, error: 'Server ID and Password are required.' });
    }
    if (String(password).trim().length < 4) {
        return res.status(400).json({ success: false, error: 'Password must be at least 4 characters long.' });
    }

    const srv = db.getServerById(serverId);
    if (!srv) return res.status(404).json({ success: false, error: 'Server not found.' });

    const isMasterAdmin = discordId && db.isOwner(discordId);
    const isServerOwner = discordId && srv.ownerDiscordId === String(discordId).trim();

    if (!isMasterAdmin && !isServerOwner) {
        return res.status(403).json({ success: false, error: 'Unauthorized: Only the Server Owner or Master Admin can set the access password.' });
    }

    db.setServerPassword(serverId, password);
    res.json({ success: true, message: 'Server access password set successfully.' });
});

// Get Current Server Information for Settings Page
app.get('/api/server/current', (req, res) => {
    const serverId = resolveServerId(req);
    const srv = db.getServerById(serverId);
    if (!srv) {
        return res.status(404).json({ error: 'Server not found.' });
    }
    return res.json({
        id: srv.id,
        name: srv.name,
        ownerDiscordId: srv.ownerDiscordId,
        apiKey: srv.apiKey,
        guildId: srv.guildId || null,
        hasPassword: !!srv.password,
        status: srv.status,
        expiresAt: srv.expiresAt,
        createdAt: srv.createdAt
    });
});

// Update Discord Guild ID for Server
app.post('/api/server/update-guild', (req, res) => {
    const serverId = resolveServerId(req);
    const { guildId, discordId } = req.body || {};
    const srv = db.getServerById(serverId);
    if (!srv) return res.status(404).json({ error: 'Server not found.' });

    const adminId = discordId || req.headers['x-discord-id'];
    const isMasterAdmin = adminId && db.isOwner(adminId);
    const isServerOwner = adminId && srv.ownerDiscordId === String(adminId).trim();

    if (!isMasterAdmin && !isServerOwner) {
        return res.status(403).json({ error: 'Unauthorized: Only the Server Owner can configure Discord Guild ID.' });
    }

    db.setServerGuildId(srv.id, guildId);
    return res.json({ success: true, message: 'Discord Guild ID updated successfully.' });
});

// Update Database Password
app.post('/api/server/update-password', (req, res) => {
    const serverId = resolveServerId(req);
    const { newPassword, discordId } = req.body || {};
    if (!newPassword || String(newPassword).trim().length < 4) {
        return res.status(400).json({ success: false, error: 'Password must be at least 4 characters long.' });
    }

    const srv = db.getServerById(serverId);
    if (!srv) return res.status(404).json({ success: false, error: 'Server not found.' });

    const adminId = discordId || req.headers['x-discord-id'];
    const isMasterAdmin = adminId && db.isOwner(adminId);
    const isServerOwner = adminId && srv.ownerDiscordId === String(adminId).trim();

    if (!isMasterAdmin && !isServerOwner) {
        return res.status(403).json({ success: false, error: 'Unauthorized: Only the Server Owner can change the database password.' });
    }

    db.setServerPassword(srv.id, newPassword);
    return res.json({ success: true, message: 'Database password updated successfully.' });
});

// Regenerate FiveM Secret Key for Active Server
app.post('/api/server/regenerate-key', (req, res) => {
    const serverId = resolveServerId(req);
    const srv = db.getServerById(serverId);
    if (!srv) return res.status(404).json({ error: 'Server not found.' });

    const adminId = req.headers['x-discord-id'];
    const isMasterAdmin = adminId && db.isOwner(adminId);
    const isServerOwner = adminId && srv.ownerDiscordId === String(adminId).trim();

    if (!isMasterAdmin && !isServerOwner) {
        return res.status(403).json({ error: 'Unauthorized: Only the Server Owner can regenerate the FiveM Key.' });
    }

    const newKey = db.regenerateServerApiKey(srv.id);
    return res.json({ apiKey: newKey });
});

app.get('/api/auth/current-owner', (req, res) => {
    res.json({ ownerDiscordId: db.getOwnerDiscordId() });
});

// Discord OAuth2 Login Redirect
app.get('/api/auth/discord/login', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID || '1542217467105906798';
    const host = req.get('host');
    const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const redirectUri = `${protocol}://${host}/api/auth/discord/callback`;

    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=identify`;
    res.redirect(authUrl);
});

// Discord OAuth2 Callback Handler
app.get('/api/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.redirect('/login.html?error=oauth_failed');
    }

    const clientId = process.env.DISCORD_CLIENT_ID || '1542217467105906798';
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const host = req.get('host');
    const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const redirectUri = `${protocol}://${host}/api/auth/discord/callback`;

    if (!clientSecret) {
        return res.redirect('/login.html?error=' + encodeURIComponent('Discord Client Secret not configured. Please use Direct Discord ID login.'));
    }

    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri
            })
        });

        if (!tokenRes.ok) {
            return res.redirect('/login.html?error=oauth_failed');
        }

        const tokenData = await tokenRes.json();
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });

        if (!userRes.ok) {
            return res.redirect('/login.html?error=oauth_failed');
        }

        const discordUser = await userRes.json();
        const discordId = discordUser.id;

        const isMaster = db.isOwner(discordId);
        const customerServer = db.getServerByOwner(discordId);

        const avatarExt = discordUser.avatar?.startsWith('a_') ? 'gif' : 'png';
        const avatarUrl = discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${avatarExt}?size=128`
            : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(discordId) >> 22n) % 6n)}.png`;

        // 1. MASTER ADMIN
        if (isMaster) {
            const payload = {
                authorized: true,
                role: 'owner',
                isOwner: true,
                isMaster: true,
                requiresDbPassword: false,
                requiresPasswordSetup: false,
                serverId: 'default_server',
                serverName: 'Main Watchdog Server',
                name: discordUser.global_name || discordUser.username || 'Dos',
                username: discordUser.username || 'user',
                discordId,
                avatarUrl
            };
            return res.redirect(`/login.html?auth_payload=${encodeURIComponent(JSON.stringify(payload))}`);
        }

        // 2. CUSTOMER OWNER
        if (customerServer) {
            if (customerServer.status === 'SUSPENDED') {
                return res.redirect('/login.html?error=' + encodeURIComponent('License Suspended: Access to this server database has been suspended by the Master Administrator.'));
            }
            if (customerServer.expiresAt && Date.now() > customerServer.expiresAt) {
                return res.redirect('/login.html?error=' + encodeURIComponent('License Expired: Your server subscription has expired. Please contact the administrator.'));
            }

            const payload = {
                authorized: true,
                role: 'owner',
                isOwner: true,
                isMaster: false,
                requiresDbPassword: false,
                requiresPasswordSetup: !customerServer.password,
                serverId: customerServer.id,
                serverName: customerServer.name,
                name: discordUser.global_name || discordUser.username || 'Owner',
                username: discordUser.username || 'user',
                discordId,
                avatarUrl
            };
            return res.redirect(`/login.html?auth_payload=${encodeURIComponent(JSON.stringify(payload))}`);
        }

        // 3. STAFF / NON-OWNER
        const payload = {
            authorized: true,
            role: 'staffer',
            isOwner: false,
            isMaster: false,
            requiresDbPassword: true,
            requiresPasswordSetup: false,
            name: discordUser.global_name || discordUser.username || 'Staffer',
            username: discordUser.username || 'user',
            discordId,
            avatarUrl
        };
        return res.redirect(`/login.html?auth_payload=${encodeURIComponent(JSON.stringify(payload))}`);
    } catch (err) {
        return res.redirect('/login.html?error=oauth_failed');
    }
});

// REST API Endpoints (Direct L1 Memory Cache with sub-millisecond dispatch)
app.get('/api/players', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json(db.getAll('players', resolveServerId(req)));
});

app.post('/api/players', (req, res) => {
    db.replaceAll('players', req.body, resolveServerId(req));
    res.sendStatus(200);
});

app.get('/api/actions', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json(db.getAll('actions', resolveServerId(req)));
});

app.post('/api/actions', (req, res) => {
    db.replaceAll('actions', req.body, resolveServerId(req));
    res.sendStatus(200);
});

app.get('/api/reasons', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json(db.getReasons(resolveServerId(req)));
});

app.post('/api/reasons', (req, res) => {
    db.saveReasons(req.body, resolveServerId(req));
    res.sendStatus(200);
});

app.get('/api/moderators', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    const serverId = resolveServerId(req);
    const list = db.getModerators(serverId);
    for (const m of list) {
        if (m.discordId && (!m.avatarUrl || !m.bannerUrl)) {
            const cached = discordProfileCache.get(m.discordId);
            if (cached?.data?.url && !m.avatarUrl) m.avatarUrl = cached.data.url;
            if (cached?.data?.bannerUrl && !m.bannerUrl) m.bannerUrl = cached.data.bannerUrl;
        }
    }
    res.json(list);
});

app.post('/api/moderators', (req, res) => {
    db.saveModerators(req.body, resolveServerId(req));
    res.sendStatus(200);
});

app.get('/api/server/api-key', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ apiKey: db.getApiKey(resolveServerId(req)) });
});

app.post('/api/server/api-key/regenerate', (req, res) => {
    const newKey = db.regenerateApiKey(resolveServerId(req));
    res.json({ apiKey: newKey });
});
app.get('/api/check-license/:license', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    const clientKey = req.headers['x-watchdog-key'] || req.query.key;
    let serverId = 'default_server';
    if (clientKey) {
        const server = db.getServerByApiKey(clientKey);
        if (!server) {
            return res.status(401).json({ error: 'Unauthorized: Invalid Secret API Key' });
        }
        if (server.status === 'SUSPENDED') {
            return res.status(403).json({ error: 'Forbidden: Server license is suspended. Please renew.' });
        }
        if (server.expiresAt && Date.now() > server.expiresAt) {
            return res.status(403).json({ error: 'Forbidden: Server license has expired.' });
        }
        serverId = server.id;
    }

    const license = decodeURIComponent(req.params.license || '').trim().toLowerCase();
    if (!license) return res.status(400).json({ error: 'License is required' });
    const players = db.getAll('players', serverId);
    const actions = db.getAll('actions', serverId);
    const player = players.find(p => (p.fivemLicense || '').toLowerCase() === license);
    if (!player) return res.json({ found: false, player: null, activeBan: false, activePermanentBan: false, warnCount: 0 });

    const playerActions = actions.filter(a => a.playerId === player.id);
    const now = Date.now();
    const activePermanentBanAction = playerActions.find(a => a.type === 'BAN' && a.permanent && !a.permanentBanRemoval && !a.removed);
    const activePermanentBan = !!activePermanentBanAction;

    let activeTempBanAction = null;
    const activeTempBan = playerActions.some(a => {
        if (a.type !== 'BAN' || a.permanent || a.permanentBanRemoval || a.removed) return false;
        const dur = Number(a.duration);
        if (!Number.isFinite(dur) || dur <= 0) return true;
        const ms = String(a.durationUnit || 'Days').toLowerCase().startsWith('hour') ? dur * 3600000 : dur * 86400000;
        const isActive = now < new Date(a.timestamp).getTime() + ms;
        if (isActive) activeTempBanAction = a;
        return isActive;
    });

    const activeBan = activePermanentBan || activeTempBan;
    const banReason = activePermanentBanAction?.reason || activeTempBanAction?.reason || null;
    const banIssuer = activePermanentBanAction?.issuer || activeTempBanAction?.issuer || null;
    const warnCount = playerActions.filter(a => a.type === 'WARN' && !a.warningRemoval && !a.removed).length;

    res.json({
        found: true,
        player: { id: player.id, username: player.username, discordId: player.discordId, fivemLicense: player.fivemLicense, status: player.status },
        activeBan,
        activePermanentBan,
        banReason,
        banIssuer,
        warnCount
    });
});

async function fetchDiscordJson(url, headers, attempts = 2) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            const response = await fetch(url, { headers });
            if (response.ok) return response.json();
            if (![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts - 1) return null;
            const retryAfter = Number(response.headers.get('retry-after'));
            const delay = Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 3000) : 300 * (attempt + 1);
            await new Promise(resolve => setTimeout(resolve, delay));
        } catch (e) {
            return null;
        }
    }
    return null;
}

const discordProfileCacheTtl = 7 * 24 * 60 * 60 * 1000; // 7 days
const discordProfileCache = new Map();

try {
    const initialCache = db.getDiscordCache();
    for (const [id, val] of initialCache.entries()) {
        discordProfileCache.set(id, {
            data: { url: val.url, isDefault: !val.url, bannerUrl: val.bannerUrl },
            expiresAt: (val.updatedAt || Date.now()) + discordProfileCacheTtl
        });
    }
} catch (e) {}

let discordMembersCache = null;
let discordMembersCacheExpiresAt = 0;
const discordMembersCacheTtl = 60 * 60 * 1000; // 1 hour

app.get('/api/discord-members', async (req, res) => {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const serverId = resolveServerId(req);
    const srv = db.getServerById(serverId);
    const guildId = srv?.guildId || process.env.DISCORD_GUILD_ID;
    if (!botToken || !/^\d{17,20}$/.test(guildId || '')) return res.json([]);

    if (discordMembersCache && discordMembersCacheExpiresAt > Date.now()) {
        return res.json(discordMembersCache);
    }

    try {
        const members = [];
        let after = '';
        do {
            const query = new URLSearchParams({ limit: '1000' });
            if (after) query.set('after', after);
            const page = await fetchDiscordJson(`https://discord.com/api/v10/guilds/${guildId}/members?${query}`, {
                Authorization: `Bot ${botToken}`
            }, 1);
            if (!page || !Array.isArray(page)) break;
            members.push(...page.map(member => ({
                id: member.user?.id,
                username: member.user?.username,
                globalName: member.user?.global_name,
                nickname: member.nick
            })).filter(member => member.id));
            if (page.length < 1000) break;
            after = page[page.length - 1].user.id;
        } while (after);

        if (members.length > 0) {
            discordMembersCache = members;
            discordMembersCacheExpiresAt = Date.now() + discordMembersCacheTtl;
        }
        res.json(members);
    } catch (error) {
        res.json(discordMembersCache || []);
    }
});

async function resolveDiscordProfile(userId) {
    if (!/^\d{17,20}$/.test(userId)) return { url: null, isDefault: true };

    const cachedProfile = discordProfileCache.get(userId);
    if (cachedProfile && cachedProfile.expiresAt > Date.now() && cachedProfile.data.username) return cachedProfile.data;
    if (cachedProfile) discordProfileCache.delete(userId);

    const defaultAvatarIndex = Number((BigInt(userId) >> 22n) % 6n);
    const defaultAvatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) return { url: defaultAvatarUrl, isDefault: true };

    try {
        const user = await fetchDiscordJson(`https://discord.com/api/v10/users/${userId}`, {
            Authorization: `Bot ${botToken}`
        });
        if (!user) {
            const profile = { url: defaultAvatarUrl, isDefault: true };
            discordProfileCache.set(userId, { data: profile, expiresAt: Date.now() + 3 * 60 * 1000 });
            return profile;
        }
        const extension = user.avatar?.startsWith('a_') ? 'gif' : 'png';
        const url = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`
            : null;
        const bannerExtension = user.banner?.startsWith('a_') ? 'gif' : 'png';
        const bannerUrl = user.banner
            ? `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.${bannerExtension}?size=1024`
            : null;

        const profile = {
            url: url || defaultAvatarUrl,
            isDefault: !url,
            bannerUrl,
            username: user.username || 'user',
            globalName: user.global_name || user.username || 'User'
        };
        const ttl = url ? discordProfileCacheTtl : 60 * 60 * 1000;
        discordProfileCache.set(userId, { data: profile, expiresAt: Date.now() + ttl });
        try { db.setDiscordCache(userId, profile); } catch (e) {}
        return profile;
    } catch (error) {
        const profile = { url: defaultAvatarUrl, isDefault: true, username: 'user', globalName: 'User' };
        discordProfileCache.set(userId, { data: profile, expiresAt: Date.now() + 3 * 60 * 1000 });
        return profile;
    }
}

app.get('/api/discord-avatar/:userId', async (req, res) => {
    const userId = String(req.params.userId || '');
    const profile = await resolveDiscordProfile(userId);
    res.json(profile);
});

app.post('/api/discord-avatars', async (req, res) => {
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    const validIds = [...new Set(userIds.map(id => String(id).trim()).filter(id => /^\d{17,20}$/.test(id)))];

    const results = {};
    const missingIds = [];

    for (const id of validIds) {
        const cached = discordProfileCache.get(id);
        if (cached && cached.expiresAt > Date.now()) {
            results[id] = cached.data;
        } else {
            missingIds.push(id);
        }
    }

    if (missingIds.length > 0) {
        const concurrency = 10;
        for (let i = 0; i < missingIds.length; i += concurrency) {
            const batch = missingIds.slice(i, i + concurrency);
            await Promise.all(batch.map(async (id) => {
                results[id] = await resolveDiscordProfile(id);
            }));
        }
    }

    res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Watchdog System Server running on port ${PORT}`));
