require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const db = require('./db');

const app = express();

// Security Headers Middleware
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

// Memory Rate Limiter for API
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 400; // max requests per minute per IP

function rateLimiter(req, res, next) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = rateLimitMap.get(ip);
    if (!entry || now - entry.startTime > RATE_LIMIT_WINDOW) {
        entry = { startTime: now, count: 1 };
        rateLimitMap.set(ip, entry);
    } else {
        entry.count += 1;
        if (entry.count > RATE_LIMIT_MAX) {
            return res.status(429).json({ error: 'Too many requests. Please slow down.' });
        }
    }
    next();
}
app.use('/api', rateLimiter);

// Serve root directly to the main Watchdog Dashboard
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/home.html', (req, res) => res.redirect('/'));

// Static asset delivery with ETags enabled
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    etag: true
}));

// Master Admin Verification Middleware
function requireMasterAdmin(req, res, next) {
    const adminId = req.headers['x-discord-id'] || req.query.adminId || req.body?.adminId;
    if (!adminId || !db.isOwner(adminId)) {
        return res.status(403).json({ error: 'Forbidden: Master Admin privileges required.' });
    }
    next();
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
        if (srv) return srv.id;
    }
    const headerServerId = req.headers['x-server-id'];
    if (headerServerId && typeof headerServerId === 'string' && headerServerId.trim()) {
        return headerServerId.trim();
    }
    const queryServerId = req.query.serverId;
    if (queryServerId && typeof queryServerId === 'string' && queryServerId.trim()) {
        return queryServerId.trim();
    }
    return 'default_server';
}

// Staff verification & Discord Login endpoint
app.post('/api/auth/verify-staff', async (req, res) => {
    const rawId = req.body?.discordId;
    if (!rawId) return res.status(400).json({ authorized: false, error: 'Discord ID is required' });
    
    const discordId = String(rawId).trim();
    const isMaster = db.isOwner(discordId);
    const customerServer = db.getServerByOwner(discordId);
    const serverId = resolveServerId(req);
    const mod = db.getModeratorByDiscordId(discordId, serverId) || db.getModeratorByDiscordId(discordId, 'default_server');

    if (!isMaster && !customerServer && (!mod || mod.isFormer)) {
        return res.status(403).json({
            authorized: false,
            error: 'Unauthorized: Your Discord account is not registered as a Staffer or Owner for this Watchdog server.'
        });
    }

    // Resolve real live Discord profile (avatar, display name)
    const profile = await resolveDiscordProfile(discordId);
    const isOwnerUser = isMaster || !!customerServer;

    return res.json({
        authorized: true,
        role: isOwnerUser ? 'owner' : 'staffer',
        isOwner: isOwnerUser,
        isMaster: isMaster,
        serverId: customerServer ? customerServer.id : (isMaster ? 'default_server' : serverId),
        serverName: customerServer ? customerServer.name : (isMaster ? 'Main Watchdog Server' : null),
        name: profile.globalName || profile.username || mod?.name || (isOwnerUser ? 'Owner' : 'Staffer'),
        username: profile.username || mod?.name || 'User',
        discordId,
        avatarUrl: profile.url || mod?.avatarUrl || null
    });
});

app.get('/api/auth/current-owner', (req, res) => {
    res.json({ ownerDiscordId: db.getOwnerDiscordId() });
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
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!botToken || !/^d{17,20}$/.test(guildId || '')) return res.json([]);

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
