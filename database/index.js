const fs = require("node:fs");
const path = require("node:path");
const sqlite = require("node:sqlite");
const SqliteDatabase = sqlite.Database || sqlite.DatabaseSync;

function resolveDatabasePath() {
    if (process.env.DATABASE_PATH) {
        return process.env.DATABASE_PATH;
    }

    // Deplexo mounts a persistent application volume at /data by default.
    // Locally, use a project data directory instead.
    if (fs.existsSync("/data")) {
        return "/data/la-communaute-live.sqlite";
    }

    return path.join(process.cwd(), "data", "la-communaute-live.sqlite");
}

function createDatabase(databasePath = resolveDatabasePath()) {
    if (databasePath !== ":memory:") {
        fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }

    const database = new SqliteDatabase(databasePath);

    database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;

        CREATE TABLE IF NOT EXISTS member_progress (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
            coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
            last_text_message_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS xp_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            source TEXT NOT NULL,
            amount INTEGER NOT NULL CHECK (amount > 0),
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_xp_transactions_member
            ON xp_transactions (guild_id, user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS economy_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            from_user_id TEXT,
            to_user_id TEXT,
            amount INTEGER NOT NULL CHECK (amount > 0),
            transaction_type TEXT NOT NULL,
            details TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_economy_transactions_guild_time
            ON economy_transactions (guild_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS active_xp_boosts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            multiplier INTEGER NOT NULL CHECK (multiplier IN (2, 3, 4, 5, 10)),
            starts_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_boost_per_member
            ON active_xp_boosts (guild_id, user_id)
            WHERE status = 'active';

        CREATE TABLE IF NOT EXISTS app_settings (
            guild_id TEXT NOT NULL,
            setting_key TEXT NOT NULL,
            setting_value TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, setting_key)
        );
    `);

    return database;
}

module.exports = { createDatabase, resolveDatabasePath };
