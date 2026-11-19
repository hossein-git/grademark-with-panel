'use strict';

// Same ISO-8601 UTC format as Date#toISOString(), so stored timestamps
// compare correctly as strings.
const NOW_ISO = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

module.exports = [
    {
        id: 'user_001_create_users',
        up(db) {
            db.exec(`
                CREATE TABLE users (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    name          TEXT    NOT NULL,
                    email         TEXT    NOT NULL COLLATE NOCASE UNIQUE,
                    password_hash TEXT    NOT NULL,
                    role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
                    is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
                    last_login_at TEXT,
                    created_at    TEXT    NOT NULL DEFAULT ${NOW_ISO},
                    updated_at    TEXT    NOT NULL DEFAULT ${NOW_ISO}
                )
            `);
        },
    },
    {
        id: 'user_002_create_user_sessions',
        up(db) {
            db.exec(`
                CREATE TABLE user_sessions (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                    token_hash TEXT    NOT NULL UNIQUE,
                    expires_at TEXT    NOT NULL,
                    created_at TEXT    NOT NULL DEFAULT ${NOW_ISO}
                );
                CREATE INDEX idx_user_sessions_user_id ON user_sessions (user_id);
            `);
        },
    },
];
