'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('../../Base/tests/helpers');
const { verifyPassword } = require('../password');
const { UserModel } = require('../user.model');

describe('User/UserService + UserModel', () => {
    let db;
    let userService;
    let userModel;

    beforeEach(() => {
        ({ db, context: { userService, userModel } } = createTestApp());
    });

    it('creates a user and stores only a password hash', async () => {
        const user = await userService.createUser({ name: 'Jane', email: 'Jane@Example.com', password: 'super-secret', role: 'admin' });

        assert.deepEqual(Object.keys(user).sort(), ['createdAt', 'email', 'id', 'isActive', 'lastLoginAt', 'name', 'role', 'updatedAt']);
        assert.equal(user.email, 'jane@example.com');
        assert.equal(user.role, 'admin');
        assert.equal(user.isActive, true);
        assert.equal(user.lastLoginAt, null);
        assert.match(user.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

        const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
        assert.notEqual(row.password_hash, 'super-secret');
        assert.match(row.password_hash, /^scrypt\$/);
        assert.equal(await verifyPassword('super-secret', row.password_hash), true);
    });

    it('rejects a duplicate email with 409, regardless of case', async () => {
        await userService.createUser({ name: 'Jane', email: 'jane@example.com', password: 'super-secret' });
        await assert.rejects(
            userService.createUser({ name: 'Other', email: 'JANE@EXAMPLE.COM', password: 'another-secret' }),
            (err) => err.status === 409 && /already exists/.test(err.message),
        );
    });

    it('maps a UNIQUE violation from a concurrent insert to 409', async () => {
        // Make the "already exists?" check miss so the insert itself hits the constraint,
        // as it would if two requests created the same email at the same time.
        await userService.createUser({ name: 'Jane', email: 'jane@example.com', password: 'super-secret' });
        userModel.findByEmail = () => null;
        await assert.rejects(
            userService.createUser({ name: 'Jane 2', email: 'jane@example.com', password: 'super-secret' }),
            (err) => err.status === 409,
        );
    });

    it('rejects invalid input with 400 before touching the database', async () => {
        await assert.rejects(userService.createUser({ name: '', email: 'bad', password: '1' }), (err) => err.status === 400);
        assert.equal(db.prepare('SELECT COUNT(*) FROM users').pluck().get(), 0);
    });

    it('looks up emails case-insensitively', async () => {
        const user = await userService.createUser({ name: 'Jane', email: 'jane@example.com', password: 'super-secret' });
        assert.equal(userModel.findByEmail('JaNe@ExAmPlE.cOm').id, user.id);
        assert.equal(userModel.findByEmail('nobody@example.com'), null);
        assert.equal(userModel.findById(999), null);
    });

    it('toPublic never exposes the password hash', async () => {
        const user = await userService.createUser({ name: 'Jane', email: 'jane@example.com', password: 'super-secret' });
        const publicUser = UserModel.toPublic(userModel.findById(user.id));
        assert.equal('password_hash' in publicUser, false);
        assert.equal('passwordHash' in publicUser, false);
        assert.equal(UserModel.toPublic(null), null);
    });

    it('enforces schema constraints at the database level too', () => {
        const insert = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
        assert.throws(() => insert.run('X', 'x@example.com', 'h', 'superuser'), /CHECK constraint failed/);
        assert.throws(() => insert.run(null, 'y@example.com', 'h', 'user'), /NOT NULL/);
    });
});
