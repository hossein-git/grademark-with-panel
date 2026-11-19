'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

/**
 * Opens (and creates if needed) the SQLite database.
 * Pass ':memory:' for an in-memory database (used by tests).
 */
function openDatabase(filename) {
    const inMemory = filename === ':memory:';
    if (!inMemory) {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
    }

    const db = new Database(filename);
    if (!inMemory) {
        db.pragma('journal_mode = WAL');
    }
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    return db;
}

/**
 * Applies every migration that has not run yet. Each migration runs in its
 * own transaction, so a failing migration leaves the database unchanged.
 *
 * @param db          better-sqlite3 database
 * @param migrations  array of { id: string, up: (db) => void }; ids must be unique
 * @returns ids of the migrations applied by this call
 */
function runMigrations(db, migrations) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            id         TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
    `);

    const seen = new Set();
    for (const migration of migrations) {
        if (seen.has(migration.id)) {
            throw new Error(`Duplicate migration id: ${migration.id}`);
        }
        seen.add(migration.id);
    }

    const isApplied = db.prepare('SELECT 1 FROM migrations WHERE id = ?').pluck();
    const markApplied = db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)');

    const applied = [];
    for (const migration of migrations) {
        if (isApplied.get(migration.id)) {
            continue;
        }
        db.transaction(() => {
            migration.up(db);
            markApplied.run(migration.id, new Date().toISOString());
        })();
        applied.push(migration.id);
    }
    return applied;
}

module.exports = { openDatabase, runMigrations };
