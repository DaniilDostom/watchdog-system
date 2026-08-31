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
    CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ownerDiscordId TEXT NOT NULL,
        apiKey TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        expiresAt INTEGER,
        createdAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS players (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        serverId TEXT DEFAULT 'default_server',
        id TEXT NOT NULL,
        data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS actions (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        serverId TEXT DEFAULT 'default_server',
        id TEXT NOT NULL,
        playerId TEXT,
        type TEXT,
        timestamp TEXT,
        data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS moderators (
        serverId TEXT DEFAULT 'default_server',
        name TEXT NOT NULL,
        discordId TEXT,
        avatarUrl TEXT,
        bannerUrl TEXT,
        isFormer INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
        serverId TEXT DEFAULT 'default_server',
        key TEXT NOT NULL,
        value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS discord_cache (
        discordId TEXT PRIMARY KEY,
        url TEXT,
        bannerUrl TEXT,
        updatedAt INTEGER
    );
`);

// Migrations for existing columns
try { db.exec("ALTER TABLE servers ADD COLUMN password TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE servers ADD COLUMN guildId TEXT DEFAULT NULL;"); } catch (e) {}
try { db.exec("ALTER TABLE players ADD COLUMN serverId TEXT DEFAULT 'default_server';"); } catch (e) {}
try { db.exec("ALTER TABLE actions ADD COLUMN serverId TEXT DEFAULT 'default_server';"); } catch (e) {}
try { db.exec("ALTER TABLE moderators ADD COLUMN serverId TEXT DEFAULT 'default_server';"); } catch (e) {}
try { db.exec("ALTER TABLE settings ADD COLUMN serverId TEXT DEFAULT 'default_server';"); } catch (e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_players_serverId ON players(serverId);"); } catch (e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_actions_serverId ON actions(serverId);"); } catch (e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_actions_playerId ON actions(playerId);"); } catch (e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_actions_type ON actions(type);"); } catch (e) {}

// Ensure all unassigned legacy records belong to 'default_server'
db.exec("UPDATE players SET serverId = 'default_server' WHERE serverId IS NULL OR serverId = '';");
db.exec("UPDATE actions SET serverId = 'default_server' WHERE serverId IS NULL OR serverId = '';");
db.exec("UPDATE moderators SET serverId = 'default_server' WHERE serverId IS NULL OR serverId = '';");
db.exec("UPDATE settings SET serverId = 'default_server' WHERE serverId IS NULL OR serverId = '';");

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
// L1 IN-MEMORY CACHE (Scoped by ServerId)
// =========================================================================
const memoryCache = {
    players: {},
    actions: {},
    reasons: {},
    moderators: {},
    discordCache: null
};

function getSetting(key, fallback, serverId = 'default_server') {
    const row = db.prepare('SELECT value FROM settings WHERE serverId = ? AND key = ?').get(serverId, key);
    if (!row) return fallback;
    try {
        return JSON.parse(row.value);
    } catch (error) {
        return fallback;
    }
}

function setSetting(key, value, serverId = 'default_server') {
    db.prepare(`
        INSERT INTO settings (serverId, key, value) VALUES (@serverId, @key, @value)
        ON CONFLICT(serverId, key) DO UPDATE SET value = excluded.value
    `).run({ serverId, key, value: JSON.stringify(value) });
}

function getReasons(serverId = 'default_server') {
    if (!memoryCache.reasons) memoryCache.reasons = {};
    if (memoryCache.reasons[serverId]) return memoryCache.reasons[serverId];
    const data = {
        normal: getSetting('reasons_normal', DEFAULT_REASON_LISTS.normal, serverId),
        bad: getSetting('reasons_bad', DEFAULT_REASON_LISTS.bad, serverId),
        good: getSetting('reasons_good', DEFAULT_REASON_LISTS.good, serverId)
    };
    memoryCache.reasons[serverId] = data;
    return data;
}

function saveReasons(reasons, serverId = 'default_server') {
    if (!memoryCache.reasons) memoryCache.reasons = {};
    const cleanReasons = {
        normal: Array.isArray(reasons.normal) ? reasons.normal : [],
        bad: Array.isArray(reasons.bad) ? reasons.bad : [],
        good: Array.isArray(reasons.good) ? reasons.good : []
    };
    memoryCache.reasons[serverId] = cleanReasons;
    setSetting('reasons_normal', cleanReasons.normal, serverId);
    setSetting('reasons_bad', cleanReasons.bad, serverId);
    setSetting('reasons_good', cleanReasons.good, serverId);
}

function getModerators(serverId = 'default_server') {
    if (!memoryCache.moderators) memoryCache.moderators = {};
    if (memoryCache.moderators[serverId]) return memoryCache.moderators[serverId];
    const list = db.prepare('SELECT name, discordId, avatarUrl, bannerUrl, isFormer FROM moderators WHERE serverId = ? ORDER BY name COLLATE NOCASE ASC').all(serverId);
    memoryCache.moderators[serverId] = list;
    return list;
}

function saveModerators(list, serverId = 'default_server') {
    if (!Array.isArray(list)) return;
    if (!memoryCache.moderators) memoryCache.moderators = {};
    memoryCache.moderators[serverId] = list;
    const upsert = db.prepare(`
        INSERT INTO moderators (serverId, name, discordId, avatarUrl, bannerUrl, isFormer)
        VALUES (@serverId, @name, @discordId, @avatarUrl, @bannerUrl, @isFormer)
        ON CONFLICT(serverId, name) DO UPDATE SET
            discordId = excluded.discordId,
            avatarUrl = excluded.avatarUrl,
            bannerUrl = excluded.bannerUrl,
            isFormer = excluded.isFormer
    `);
    const runAll = db.transaction((items) => {
        for (const item of items) {
            upsert.run({
                serverId,
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

function migrateLegacyDataIfNeeded() {
    const playersCount = db.prepare("SELECT COUNT(*) AS count FROM players WHERE serverId = 'default_server'").get().count;
    if (playersCount === 0) {
        const legacyPlayers = readLegacyJson(LEGACY_PLAYERS_FILE);
        if (legacyPlayers.length) replaceAll('players', legacyPlayers, 'default_server');
    }

    const actionsCount = db.prepare("SELECT COUNT(*) AS count FROM actions WHERE serverId = 'default_server'").get().count;
    if (actionsCount === 0) {
        const legacyActions = readLegacyJson(LEGACY_ACTIONS_FILE);
        if (legacyActions.length) replaceAll('actions', legacyActions, 'default_server');
    }
}

function getAll(table, serverId = 'default_server') {
    if (!memoryCache[table]) memoryCache[table] = {};
    if (memoryCache[table][serverId]) return memoryCache[table][serverId];
    const rows = db.prepare(`SELECT data FROM ${table} WHERE serverId = ? ORDER BY seq ASC`).all(serverId);
    const data = rows.map(row => JSON.parse(row.data));
    memoryCache[table][serverId] = data;
    return data;
}

function replaceAll(table, records, serverId = 'default_server') {
    if (!memoryCache[table]) memoryCache[table] = {};
    memoryCache[table][serverId] = Array.isArray(records) ? records.slice() : [];
    const deleteStmt = db.prepare(`DELETE FROM ${table} WHERE serverId = ?`);
    const insertPlayer = db.prepare('INSERT INTO players (serverId, id, data) VALUES (@serverId, @id, @data)');
    const insertAction = db.prepare('INSERT INTO actions (serverId, id, playerId, type, timestamp, data) VALUES (@serverId, @id, @playerId, @type, @timestamp, @data)');

    const runReplace = db.transaction((items) => {
        deleteStmt.run(serverId);
        for (const item of items) {
            const data = JSON.stringify(item);
            if (table === 'players') {
                insertPlayer.run({ serverId, id: String(item.id), data });
            } else {
                insertAction.run({
                    serverId,
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

function getApiKey(serverId = 'default_server') {
    const srv = getServerById(serverId);
    if (srv && srv.apiKey) return srv.apiKey;
    let key = getSetting('server_api_key', null, serverId);
    if (!key) {
        const crypto = require('crypto');
        key = 'wd_live_' + crypto.randomBytes(20).toString('hex');
        setSetting('server_api_key', key, serverId);
    }
    return key;
}

function regenerateApiKey(serverId = 'default_server') {
    const crypto = require('crypto');
    const key = 'wd_live_' + crypto.randomBytes(20).toString('hex');
    setSetting('server_api_key', key, serverId);
    db.prepare('UPDATE servers SET apiKey = ? WHERE id = ?').run(key, serverId);
    return key;
}

function validateApiKey(key, serverId = 'default_server') {
    if (!key || typeof key !== 'string') return false;
    const current = getApiKey(serverId);
    return key.trim() === current.trim();
}

function getModeratorByDiscordId(discordId, serverId = 'default_server') {
    if (!discordId) return null;
    const mods = getModerators(serverId);
    return mods.find(m => String(m.discordId).trim() === String(discordId).trim()) || null;
}

function getOwnerDiscordId() {
    return getSetting('owner_discord_id', process.env.DISCORD_OWNER_ID || '320110089727901697', 'default_server');
}

function setOwnerDiscordId(discordId) {
    setSetting('owner_discord_id', String(discordId).trim(), 'default_server');
}

function isOwner(discordId) {
    if (!discordId) return false;
    const currentOwner = getOwnerDiscordId();
    return String(discordId).trim() === String(currentOwner).trim();
}

// ==========================================
// MULTI-TENANT SERVER / CUSTOMER MANAGEMENT
// ==========================================

function initDefaultServer() {
    try {
        const count = db.prepare('SELECT COUNT(*) as count FROM servers').get().count;
        if (count === 0) {
            const masterOwnerId = getOwnerDiscordId();
            const masterKey = 'wd_live_master_' + require('crypto').randomBytes(16).toString('hex');
            db.prepare(`
                INSERT INTO servers (id, name, ownerDiscordId, apiKey, status, expiresAt, createdAt)
                VALUES (@id, @name, @ownerDiscordId, @apiKey, @status, @expiresAt, @createdAt)
            `).run({
                id: 'default_server',
                name: 'Main Watchdog Server',
                ownerDiscordId: masterOwnerId,
                apiKey: masterKey,
                status: 'ACTIVE',
                expiresAt: null,
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

    return rows.map(s => {
        const playerCount = db.prepare('SELECT COUNT(*) as count FROM players WHERE serverId = ?').get(s.id).count;
        const actionCount = db.prepare('SELECT COUNT(*) as count FROM actions WHERE serverId = ?').get(s.id).count;
        return {
            ...s,
            playerCount,
            actionCount,
            isMaster: s.id === 'default_server'
        };
    });
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
    const apiKey = 'wd_live_' + crypto.randomBytes(32).toString('hex'); // 256-bit entropy
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
    const newKey = 'wd_live_' + crypto.randomBytes(32).toString('hex'); // 256-bit entropy
    db.prepare('UPDATE servers SET apiKey = ? WHERE id = ?').run(newKey, id);
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
    db.prepare('DELETE FROM players WHERE serverId = ?').run(id);
    db.prepare('DELETE FROM actions WHERE serverId = ?').run(id);
    db.prepare('DELETE FROM moderators WHERE serverId = ?').run(id);
    db.prepare('DELETE FROM settings WHERE serverId = ?').run(id);
    if (memoryCache.players) delete memoryCache.players[id];
    if (memoryCache.actions) delete memoryCache.actions[id];
    if (memoryCache.reasons) delete memoryCache.reasons[id];
    if (memoryCache.moderators) delete memoryCache.moderators[id];
    return true;
}

// Warm up default server
migrateLegacyDataIfNeeded();
getAll('players', 'default_server');
getAll('actions', 'default_server');
getReasons('default_server');
getModerators('default_server');
getDiscordCache();

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Application-Layer Column AEAD Encryption (AES-256-GCM)
const AEAD_KEY = crypto.createHash('sha256').update(process.env.AEAD_SECRET || 'wd_aead_secret_key_2026_fivem').digest();

function encryptDataAEAD(text) {
    if (!text) return text;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', AEAD_KEY, iv);
    let encrypted = cipher.update(String(text), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptDataAEAD(cipherText) {
    if (!cipherText || typeof cipherText !== 'string' || !cipherText.includes(':')) return cipherText;
    try {
        const [ivHex, authTagHex, encryptedHex] = cipherText.split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', AEAD_KEY, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch {
        return cipherText;
    }
}

// Bcrypt with Cost Factor 12 & Transparent Auto-Migration
function setServerPassword(serverId, password, costFactor = 12) {
    if (!serverId) throw new Error('Server ID is required');
    if (!password) {
        db.prepare('UPDATE servers SET password = NULL WHERE id = ?').run(serverId);
        return true;
    }
    const pwd = String(password).trim();
    const isCost12 = pwd.startsWith('$2a$12$') || pwd.startsWith('$2b$12$');
    const hash = isCost12 ? pwd : bcrypt.hashSync(pwd, costFactor);
    db.prepare('UPDATE servers SET password = ? WHERE id = ?').run(hash, serverId);
    return true;
}

function verifyServerPassword(password, serverId = null) {
    if (!password) return null;
    const pwd = String(password).trim();
    
    if (serverId) {
        const srv = db.prepare("SELECT * FROM servers WHERE id = ? AND status = 'ACTIVE'").get(serverId);
        if (!srv || !srv.password) return null;
        
        let isMatch = false;
        if (srv.password.startsWith('$2a$') || srv.password.startsWith('$2b$')) {
            isMatch = bcrypt.compareSync(pwd, srv.password);
        } else if (srv.password === pwd) {
            isMatch = true;
        }

        if (isMatch) {
            // Auto-migrate older hashes or plaintext to Bcrypt Cost Factor 12
            if (!srv.password.startsWith('$2a$12$') && !srv.password.startsWith('$2b$12$')) {
                setServerPassword(srv.id, pwd, 12);
            }
            return srv;
        }
        return null;
    }

    const activeServers = db.prepare("SELECT * FROM servers WHERE status = 'ACTIVE' AND password IS NOT NULL").all();
    for (const srv of activeServers) {
        let isMatch = false;
        if (srv.password.startsWith('$2a$') || srv.password.startsWith('$2b$')) {
            isMatch = bcrypt.compareSync(pwd, srv.password);
        } else if (srv.password === pwd) {
            isMatch = true;
        }

        if (isMatch) {
            if (!srv.password.startsWith('$2a$12$') && !srv.password.startsWith('$2b$12$')) {
                setServerPassword(srv.id, pwd, 12);
            }
            return srv;
        }
    }
    return null;
}

function getServerPassword(serverId) {
    if (!serverId) return null;
    const row = db.prepare('SELECT password FROM servers WHERE id = ?').get(serverId);
    return row?.password || null;
}

function setServerGuildId(serverId, guildId) {
    if (!serverId) throw new Error('Server ID is required');
    const gid = guildId ? String(guildId).trim() : null;
    db.prepare('UPDATE servers SET guildId = ? WHERE id = ?').run(gid, serverId);
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
    getOwnerDiscordId,
    setOwnerDiscordId,
    isOwner,
    getServers,
    getServerById,
    getServerByApiKey,
    getServerByOwner,
    createServer,
    updateServer,
    regenerateServerApiKey,
    toggleServerStatus,
    deleteServer,
    setServerPassword,
    verifyServerPassword,
    getServerPassword,
    encryptDataAEAD,
    decryptDataAEAD,
    setServerGuildId
};