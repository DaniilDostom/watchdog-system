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

// REST API Endpoints (Direct L1 Memory Cache with sub-millisecond dispatch)
app.get('/api/players', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json(db.getAll('players'));
});

// FiveM ban-check endpoint — called by server-side Lua script on player connect
// GET /api/check-license/:license  →  { found, player, activeBan, activePermanentBan, warnCount, reason, expiry }
app.get('/api/check-license/:license', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    const clientKey = req.headers['x-watchdog-key'] || req.query.key;
    if (clientKey && !db.validateApiKey(clientKey)) {
        return res.status(401).json({ error: 'Unauthorized: Invalid Secret API Key' });
    }

    const license = decodeURIComponent(req.params.license || '').trim().toLowerCase();
    if (!license) return res.status(400).json({ error: 'License is required' });
    const players = db.getAll('players');
    const actions = db.getAll('actions');
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

// Secret API Key management
app.get('/api/server/api-key', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ apiKey: db.getApiKey() });
});

app.post('/api/server/api-key/regenerate', (req, res) => {
    const newKey = db.regenerateApiKey();
    res.json({ apiKey: newKey });
});

// Staff verification & Discord Login endpoint
app.post('/api/auth/verify-staff', async (req, res) => {
    const rawId = req.body?.discordId;
    if (!rawId) return res.status(400).json({ authorized: false, error: 'Discord ID is required' });
    
    const discordId = String(rawId).trim();
    const isOwner = db.isOwner(discordId);
    const mod = db.getModeratorByDiscordId(discordId);

    if (!isOwner && (!mod || mod.isFormer)) {
        return res.status(403).json({
            authorized: false,
            error: 'Non sei autorizzato: il tuo account Discord non è registrato come Staffer o Owner per questo server Watchdog.'
        });
    }

    // Resolve real live Discord profile (avatar, display name)
    const profile = await resolveDiscordProfile(discordId);

    return res.json({
        authorized: true,
        role: isOwner ? 'owner' : 'staffer',
        name: mod?.name || profile.globalName || profile.username || (isOwner ? 'Owner' : 'Staffer'),
        username: profile.username || mod?.name || 'User',
        isOwner,
        discordId,
        avatarUrl: profile.url || mod?.avatarUrl || null
    });
});

app.get('/api/auth/current-owner', (req, res) => {
    res.json({ ownerDiscordId: db.getOwnerDiscordId() });
});

app.post('/api/players', (req, res) => {
    db.replaceAll('players', req.body);
    res.sendStatus(200);
});

app.get('/api/actions', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json(db.getAll('actions'));
});

app.post('/api/actions', (req, res) => {
    db.replaceAll('actions', req.body);
    res.sendStatus(200);
});

app.get('/api/reasons', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json(db.getReasons());
});

app.post('/api/reasons', (req, res) => {
    db.saveReasons(req.body);
    res.sendStatus(200);
});

app.get('/api/moderators', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    const list = db.getModerators();
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
    db.saveModerators(req.body);
    res.sendStatus(200);
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
    if (cachedProfile && cachedProfile.expiresAt > Date.now()) return cachedProfile.data;
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

        const profile = { url: url || defaultAvatarUrl, isDefault: !url, bannerUrl };
        const ttl = url ? discordProfileCacheTtl : 60 * 60 * 1000;
        discordProfileCache.set(userId, { data: profile, expiresAt: Date.now() + ttl });
        try { db.setDiscordCache(userId, profile); } catch (e) {}
        return profile;
    } catch (error) {
        const profile = { url: defaultAvatarUrl, isDefault: true };
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
