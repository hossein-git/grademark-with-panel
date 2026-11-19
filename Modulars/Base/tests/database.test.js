'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, runMigrations } = require('../database');

const tableExists = (db, name) =>
    Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

describe('Base/database', () => {
    it('creates the database file and its parent folders', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-db-'));
        const file = path.join(dir, 'nested', 'app.sqlite');
        const db = openDatabase(file);
        try {
            assert.ok(fs.existsSync(file));
            assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
            assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
        } finally {
            db.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('applies pending migrations in order and only once', () => {
        const db = openDatabase(':memory:');
        const calls = [];
        const migrations = [
            { id: 'a', up: (d) => { calls.push('a'); d.exec('CREATE TABLE a (id INTEGER)'); } },
            { id: 'b', up: (d) => { calls.push('b'); d.exec('CREATE TABLE b (id INTEGER)'); } },
        ];

        assert.deepEqual(runMigrations(db, migrations), ['a', 'b']);
        assert.deepEqual(runMigrations(db, migrations), []);
        assert.deepEqual(calls, ['a', 'b']);
        assert.ok(tableExists(db, 'a') && tableExists(db, 'b'));

        // A new migration added later is picked up on the next run.
        const c = { id: 'c', up: (d) => d.exec('CREATE TABLE c (id INTEGER)') };
        assert.deepEqual(runMigrations(db, [...migrations, c]), ['c']);
        db.close();
    });

    it('rolls back a failing migration and does not record it', () => {
        const db = openDatabase(':memory:');
        const broken = {
            id: 'broken',
            up: (d) => {
                d.exec('CREATE TABLE half_done (id INTEGER)');
                throw new Error('boom');
            },
        };

        assert.throws(() => runMigrations(db, [broken]), /boom/);
        assert.equal(tableExists(db, 'half_done'), false);
        assert.equal(db.prepare('SELECT COUNT(*) FROM migrations').pluck().get(), 0);
        db.close();
    });

    it('rejects duplicate migration ids', () => {
        const db = openDatabase(':memory:');
        const m = { id: 'dup', up: () => {} };
        assert.throws(() => runMigrations(db, [m, m]), /Duplicate migration id: dup/);
        db.close();
    });
});
