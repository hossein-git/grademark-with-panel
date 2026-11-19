'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { main } = require('../scripts/create-user');
const { verifyPassword } = require('../password');

describe('User/scripts/create-user (CLI)', () => {
    let dir;
    let env;
    let out;

    const run = (args) => main(args, { env, out });
    const readUsers = () => {
        const db = new Database(env.DB_PATH, { readonly: true });
        try {
            return db.prepare('SELECT * FROM users ORDER BY id').all();
        } finally {
            db.close();
        }
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-cli-'));
        env = { DB_PATH: path.join(dir, 'app.sqlite') };
        out = { lines: [], errors: [], log(msg) { this.lines.push(msg); }, error(msg) { this.errors.push(msg); } };
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('creates the database on first run and an admin user by default', async () => {
        const code = await run(['--name', 'Jane Doe', '--email', 'Jane@Example.com', '--password', 'super-secret']);

        assert.equal(code, 0);
        assert.match(out.lines.join('\n'), /Created admin user #1: Jane Doe <jane@example.com>/);
        const [user] = readUsers();
        assert.equal(user.role, 'admin');
        assert.equal(user.email, 'jane@example.com');
        assert.equal(await verifyPassword('super-secret', user.password_hash), true);
        assert.ok(!out.lines.join('\n').includes('super-secret'), 'a password given on the command line is not printed back');
    });

    it('generates and prints a password when none is given', async () => {
        const code = await run(['--name', 'Gen', '--email', 'gen@example.com', '--role', 'user']);

        assert.equal(code, 0);
        const line = out.lines.find((l) => l.startsWith('Generated password'));
        assert.ok(line, 'prints the generated password');
        const password = line.split(': ').pop();
        assert.ok(password.length >= 16);

        const [user] = readUsers();
        assert.equal(user.role, 'user');
        assert.equal(await verifyPassword(password, user.password_hash), true);
    });

    it('exits with code 1 and field errors for invalid input', async () => {
        const code = await run(['--name', 'X', '--email', 'not-an-email', '--password', 'short']);
        assert.equal(code, 1);
        assert.match(out.errors.join('\n'), /email: Email must be a valid email address/);
        assert.match(out.errors.join('\n'), /password: Password must be between 8 and 128 characters/);
    });

    it('exits with code 1 for a duplicate email', async () => {
        await run(['--name', 'A', '--email', 'dup@example.com', '--password', 'password-1']);
        const code = await run(['--name', 'B', '--email', 'DUP@example.com', '--password', 'password-2']);
        assert.equal(code, 1);
        assert.match(out.errors.join('\n'), /already exists/);
        assert.equal(readUsers().length, 1);
    });

    it('exits with code 1 for unknown flags and prints usage for --help', async () => {
        assert.equal(await run(['--nmae', 'typo']), 1);
        assert.match(out.errors.join('\n'), /Usage:/);
        assert.equal(await run(['--help']), 0);
        assert.match(out.lines.join('\n'), /Usage:/);
    });
});
