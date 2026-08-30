const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.sqlite');
const LEGACY_PLAYERS_FILE = path.join(DATA_DIR, 'players.txt');
const LEGACY_ACTIONS_FILE = path.join(DATA_DIR, 'actions.txt');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS players (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS actions (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        playerId TEXT,
        type TEXT,
        timestamp TEXT,
        data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_actions_playerId ON actions(playerId);
    CREATE INDEX IF NOT EXISTS idx_actions_type ON actions(type);
    CREATE TABLE IF NOT EXISTS moderators (
        name TEXT PRIMARY KEY,
        discordId TEXT,
        avatarUrl TEXT,
        bannerUrl TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
        CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ownerDiscordId TEXT NOT NULL,
        apiKey TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        expiresAt INTEGER,
        createdAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS discord_cache (
        discordId TEXT PRIMARY KEY,
        url TEXT,
        bannerUrl TEXT,
        updatedAt INTEGER
    );
`);

try { db.exec('ALTER TABLE moderators ADD COLUMN avatarUrl TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE moderators ADD COLUMN bannerUrl TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE moderators ADD COLUMN isFormer INTEGER DEFAULT 0;'); } catch (e) {}

const DEFAULT_REASON_LISTS = {
    normal: [
        'Ricerca ingaggio', 'Mancanza modulo', 'Infrazione regolamento AC',
        'Mancanza clip', 'Infrazione Regolamento',
        'Uso scorretto comando', 'Metagame OOC', 'Slog in azione', 'Spawnkill',
        'Blasfemia', 'FailRP', 'Tossicità', 'Respawn in Azione', 'Powergame', 'No Reason',
        'No Fear', 'Loot in azione', 'Loot non consono', 'Rientro In Azione',
        'RDM', 'Call Discord', 'Utilizzo Tetti', 'Combat Log', 'Comportamento Non Consono',
        'Varie infrazioni', 'Grief Fazione', 'Bug Abuse', 'Troll', 'Termini Bannabili', 'Carjack',
        'Metagame IC', 'Azione In Zona Safe', 'Clip Non Conforme', 'Scarso RP', 'Soft Flame',
        'Azioni Senza Modulo Fazione', 'Uso Scorretto Chat Anon', 'MixChat', 'Scorretto Uso /Ambulanza',
        'Scorretto Uso /Me', 'Doppia Fazione', 'VDM'
    ],
    bad: [
        'Player non idoneo', 'Insulti allo staff', 'No Fear Estremo', 'Cheating',
        'Diffusione Asset', 'Omertà', 'Refusal SS', 'Run Away From SS', 'Omofobia',
        'Account Sharing', 'Modding', 'Acquisto Whitelist'
    ],
    good: ['Buona Condotta', 'Ricorso Accolto', 'Errore di Applicazione', 'Decisione dello Staff']
};

// =========================================================================
// ENTERPRISE L1 IN-MEMORY CACHE (< 0.1ms access time)
// =========================================================================
const memoryCache = {
    players: null,
    actions: null,
    reasons: null,
    moderators: null,
    discordCache: null
};

function getSetting(key, fallback) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return fallback;
    try {
        return JSON.parse(row.value);
    } catch (error) {
        return fallback;
    }
}

function setSetting(key, value) {
    db.prepare(`
        INSERT INTO settings (key, value) VALUES (@key, @value)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run({ key, value: JSON.stringify(value) });
}

function getReasons() {
    if (memoryCache.reasons) return memoryCache.reasons;
    memoryCache.reasons = {
        normal: getSetting('reasons_normal', DEFAULT_REASON_LISTS.normal),
        bad: getSetting('reasons_bad', DEFAULT_REASON_LISTS.bad),
        good: getSetting('reasons_good', DEFAULT_REASON_LISTS.good)
    };
    return memoryCache.reasons;
}

function saveReasons(reasons) {
    const cleanReasons = {
        normal: Array.isArray(reasons.normal) ? reasons.normal : [],
        bad: Array.isArray(reasons.bad) ? reasons.bad : [],
        good: Array.isArray(reasons.good) ? reasons.good : []
    };
    memoryCache.reasons = cleanReasons;
    setSetting('reasons_normal', cleanReasons.normal);
    setSetting('reasons_bad', cleanReasons.bad);
    setSetting('reasons_good', cleanReasons.good);
}

function getModerators() {
    if (memoryCache.moderators) return memoryCache.moderators;
    memoryCache.moderators = db.prepare('SELECT name, discordId, avatarUrl, bannerUrl, isFormer FROM moderators ORDER BY name COLLATE NOCASE ASC').all();
    return memoryCache.moderators;
}

function saveModerators(list) {
    if (!Array.isArray(list) || !list.length) return;
    memoryCache.moderators = list;
    const upsert = db.prepare(`
        INSERT INTO moderators (name, discordId, avatarUrl, bannerUrl, isFormer)
        VALUES (@name, @discordId, @avatarUrl, @bannerUrl, @isFormer)
        ON CONFLICT(name) DO UPDATE SET
            discordId = excluded.discordId,
            avatarUrl = excluded.avatarUrl,
            bannerUrl = excluded.bannerUrl,
            isFormer = excluded.isFormer
    `);
    const runAll = db.transaction((items) => {
        for (const item of items) {
            upsert.run({
                name: String(item.name),
                discordId: item.discordId ? String(item.discordId).trim() : null,
                avatarUrl: item.avatarUrl || null,
                bannerUrl: item.bannerUrl || null,
                isFormer: item.isFormer ? 1 : 0
            });
        }
    });
    runAll(list);
}

function readLegacyJson(file) {
    if (!fs.existsSync(file)) return [];
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
    } catch (error) {
        return [];
    }
}

// One-time import from the old .txt/JSON files
function migrateLegacyDataIfNeeded() {
    const playersCount = db.prepare('SELECT COUNT(*) AS count FROM players').get().count;
    if (playersCount === 0) {
        const legacyPlayers = readLegacyJson(LEGACY_PLAYERS_FILE);
        if (legacyPlayers.length) replaceAll('players', legacyPlayers);
    }

    const actionsCount = db.prepare('SELECT COUNT(*) AS count FROM actions').get().count;
    if (actionsCount === 0) {
        const legacyActions = readLegacyJson(LEGACY_ACTIONS_FILE);
        if (legacyActions.length) replaceAll('actions', legacyActions);
    }
}

const getAllStatements = {
    players: db.prepare('SELECT data FROM players ORDER BY seq ASC'),
    actions: db.prepare('SELECT data FROM actions ORDER BY seq ASC')
};

function getAll(table) {
    if (memoryCache[table]) return memoryCache[table];
    const data = getAllStatements[table].all().map(row => JSON.parse(row.data));
    memoryCache[table] = data;
    return data;
}

const insertStatements = {
    players: db.prepare('INSERT INTO players (id, data) VALUES (@id, @data)'),
    actions: db.prepare('INSERT INTO actions (id, playerId, type, timestamp, data) VALUES (@id, @playerId, @type, @timestamp, @data)')
};

const deleteAllStatements = {
    players: db.prepare('DELETE FROM players'),
    actions: db.prepare('DELETE FROM actions')
};

function replaceAll(table, records) {
    memoryCache[table] = Array.isArray(records) ? records.slice() : [];
    const runReplace = db.transaction((items) => {
        deleteAllStatements[table].run();
        for (const item of items) {
            const data = JSON.stringify(item);
            if (table === 'players') {
                insertStatements.players.run({ id: String(item.id), data });
            } else {
                insertStatements.actions.run({
                    id: String(item.id),
                    playerId: item.playerId != null ? String(item.playerId) : null,
                    type: item.type || null,
                    timestamp: item.timestamp || null,
                    data
                });
            }
        }
    });
    runReplace(records);
}

function getDiscordCache() {
    if (memoryCache.discordCache) return memoryCache.discordCache;
    const rows = db.prepare('SELECT discordId, url, bannerUrl, updatedAt FROM discord_cache').all();
    const map = new Map();
    for (const r of rows) {
        map.set(r.discordId, { url: r.url, bannerUrl: r.bannerUrl, updatedAt: r.updatedAt });
    }
    memoryCache.discordCache = map;
    return map;
}

function setDiscordCache(discordId, data) {
    if (!memoryCache.discordCache) getDiscordCache();
    memoryCache.discordCache.set(discordId, {
        url: data.url || null,
        bannerUrl: data.bannerUrl || null,
        updatedAt: Date.now()
    });

    db.prepare(`
        INSERT INTO discord_cache (discordId, url, bannerUrl, updatedAt)
        VALUES (@discordId, @url, @bannerUrl, @updatedAt)
        ON CONFLICT(discordId) DO UPDATE SET
            url = excluded.url,
            bannerUrl = excluded.bannerUrl,
            updatedAt = excluded.updatedAt
    `).run({
        discordId,
        url: data.url || null,
        bannerUrl: data.bannerUrl || null,
        updatedAt: Date.now()
    });
}

function getApiKey() {
    let key = getSetting('server_api_key', null);
    if (!key) {
        const crypto = require('crypto');
        key = 'wd_live_' + crypto.randomBytes(20).toString('hex');
        setSetting('server_api_key', key);
    }
    return key;
}

function regenerateApiKey() {
    const crypto = require('crypto');
    const key = 'wd_live_' + crypto.randomBytes(20).toString('hex');
    setSetting('server_api_key', key);
    return key;
}

function validateApiKey(key) {
    if (!key || typeof key !== 'string') return false;
    const current = getApiKey();
    return key.trim() === current.trim();
}

function getModeratorByDiscordId(discordId) {
    if (!discordId) return null;
    const mods = getModerators();
    return mods.find(m => String(m.discordId).trim() === String(discordId).trim()) || null;
}

function getOwnerDiscordId() {
    return getSetting('owner_discord_id', process.env.DISCORD_OWNER_ID || '320110089727901697');
}

function setOwnerDiscordId(discordId) {
    setSetting('owner_discord_id', String(discordId).trim());
}

function isOwner(discordId) {
    if (!discordId) return false;
    const currentOwner = getOwnerDiscordId();
    return String(discordId).trim() === String(currentOwner).trim();
}

// Warm up L1 cache on initial load
migrateLegacyDataIfNeeded();
getAll('players');
getAll('actions');
getReasons();
getModerators();
getDiscordCache();
getApiKey();


// ==========================================
// MULTI-TENANT SERVER / CUSTOMER MANAGEMENT
// ==========================================

function initDefaultServer() {
    try {
        const count = db.prepare('SELECT COUNT(*) as count FROM servers').get().count;
        if (count === 0) {
            const masterOwnerId = getOwnerDiscordId();
            const masterKey = getApiKey();
            db.prepare(`
                INSERT INTO servers (id, name, ownerDiscordId, apiKey, status, expiresAt, createdAt)
                VALUES (@id, @name, @ownerDiscordId, @apiKey, @status, @expiresAt, @createdAt)
            `).run({
                id: 'default_server',
                name: 'Main Watchdog Server',
                ownerDiscordId: masterOwnerId,
                apiKey: masterKey,
                status: 'ACTIVE',
                expiresAt: null, // Lifetime
                createdAt: Date.now()
            });
        }
    } catch (e) {
        console.error('Error initializing default server:', e);
    }
}

function getServers() {
    initDefaultServer();
    const rows = db.prepare('SELECT * FROM servers ORDER BY createdAt DESC').all();
    const totalPlayers = getAll('players').length;
    const totalActions = getAll('actions').length;

    return rows.map(s => ({
        ...s,
        playerCount: s.id === 'default_server' ? totalPlayers : 0,
        actionCount: s.id === 'default_server' ? totalActions : 0,
        isMaster: s.id === 'default_server'
    }));
}

function getServerById(id) {
    if (!id) return null;
    return db.prepare('SELECT * FROM servers WHERE id = ?').get(id) || null;
}

function getServerByApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') return null;
    return db.prepare('SELECT * FROM servers WHERE apiKey = ?').get(apiKey.trim()) || null;
}

function getServerByOwner(discordId) {
    if (!discordId) return null;
    return db.prepare('SELECT * FROM servers WHERE ownerDiscordId = ?').get(String(discordId).trim()) || null;
}

function createServer({ name, ownerDiscordId, durationDays }) {
    if (!name || !ownerDiscordId) throw new Error('Name and Owner Discord ID are required');
    const crypto = require('crypto');
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 12) || 'server';
    const id = `srv_${slug}_${crypto.randomBytes(3).toString('hex')}`;
    const apiKey = 'wd_live_' + crypto.randomBytes(20).toString('hex');
    const days = Number(durationDays);
    const expiresAt = Number.isFinite(days) && days > 0 ? Date.now() + (days * 86400000) : null;
    const createdAt = Date.now();

    db.prepare(`
        INSERT INTO servers (id, name, ownerDiscordId, apiKey, status, expiresAt, createdAt)
        VALUES (@id, @name, @ownerDiscordId, @apiKey, @status, @expiresAt, @createdAt)
    `).run({
        id,
        name: name.trim(),
        ownerDiscordId: String(ownerDiscordId).trim(),
        apiKey,
        status: 'ACTIVE',
        expiresAt,
        createdAt
    });

    return getServerById(id);
}

function updateServer(id, fields = {}) {
    const current = getServerById(id);
    if (!current) return null;

    const name = fields.name !== undefined ? fields.name.trim() : current.name;
    const ownerDiscordId = fields.ownerDiscordId !== undefined ? String(fields.ownerDiscordId).trim() : current.ownerDiscordId;
    const status = fields.status !== undefined ? fields.status : current.status;
    const expiresAt = fields.expiresAt !== undefined ? fields.expiresAt : current.expiresAt;

    db.prepare(`
        UPDATE servers SET name = @name, ownerDiscordId = @ownerDiscordId, status = @status, expiresAt = @expiresAt
        WHERE id = @id
    `).run({ id, name, ownerDiscordId, status, expiresAt });

    return getServerById(id);
}

function regenerateServerApiKey(id) {
    const crypto = require('crypto');
    const newKey = 'wd_live_' + crypto.randomBytes(20).toString('hex');
    db.prepare('UPDATE servers SET apiKey = ? WHERE id = ?').run(newKey, id);
    if (id === 'default_server') {
        setSetting('server_api_key', newKey);
    }
    return newKey;
}

function toggleServerStatus(id) {
    const current = getServerById(id);
    if (!current) return null;
    const newStatus = current.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    db.prepare('UPDATE servers SET status = ? WHERE id = ?').run(newStatus, id);
    return newStatus;
}

function deleteServer(id) {
    if (id === 'default_server') throw new Error('Cannot delete main system server');
    db.prepare('DELETE FROM servers WHERE id = ?').run(id);
    return true;
}

module.exports = {
    getAll,
    replaceAll,
    getReasons,
    saveReasons,
    getModerators,
    saveModerators,
    getDiscordCache,
    setDiscordCache,
    getApiKey,
    regenerateApiKey,
    validateApiKey,
    getModeratorByDiscordId,
    getServers,
    getServerById,
    getServerByApiKey,
    getServerByOwner,
    createServer,
    updateServer,
    regenerateServerApiKey,
    toggleServerStatus,
    deleteServer,

    getOwnerDiscordId,
    setOwnerDiscordId,
    isOwner
};

