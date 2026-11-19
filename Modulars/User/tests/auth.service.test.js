'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, runMigrations } = require('../../Base/database');
const migrations = require('../user.migrations');
const { UserModel } = require('../user.model');
const { SessionModel } = require('../session.model');
const { UserService } = require('../user.service');
const { AuthService, hashToken } = require('../auth.service');

const HOUR = 60 * 60 * 1000;

describe('User/AuthService', () => {
    let db;
    let userModel;
    let auth;
    let clock;
    let jane;

    const advance = (ms) => {
        clock = new Date(clock.getTime() + ms);
    };
    const sessionCount = () => db.prepare('SELECT COUNT(*) FROM user_sessions').pluck().get();

    beforeEach(async () => {
        db = openDatabase(':memory:');
        runMigrations(db, migrations);
        userModel = new UserModel(db);
        clock = new Date('2030-01-01T00:00:00.000Z');
        auth = new AuthService({
            userModel,
            sessionModel: new SessionModel(db),
            authConfig: { sessionTtlHours: 12, rememberTtlDays: 30 },
            now: () => clock,
        });
        jane = await new UserService({ userModel }).createUser({ name: 'Jane', email: 'jane@example.com', password: 'super-secret' });
    });

    it('logs in with the right credentials and returns a token, expiry and public user', async () => {
        const result = await auth.login({ email: 'jane@example.com', password: 'super-secret' });

        assert.match(result.token, /^[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
        assert.equal(result.expiresAt, '2030-01-01T12:00:00.000Z');
        assert.equal(result.user.id, jane.id);
        assert.equal(result.user.lastLoginAt, clock.toISOString());
        assert.equal('password_hash' in result.user, false);
    });

    it('stores only the SHA-256 hash of the session token', async () => {
        const { token } = await auth.login({ email: 'jane@example.com', password: 'super-secret' });
        const row = db.prepare('SELECT * FROM user_sessions').get();
        assert.equal(row.token_hash, hashToken(token));
        assert.notEqual(row.token_hash, token);
    });

    it('issues a different token for each login', async () => {
        const a = await auth.login({ email: 'jane@example.com', password: 'super-secret' });
        const b = await auth.login({ email: 'jane@example.com', password: 'super-secret' });
        assert.notEqual(a.token, b.token);
        assert.ok(auth.authenticate(a.token) && auth.authenticate(b.token), 'both devices stay logged in');
    });

    it('uses the longer lifetime when "remember me" is set', async () => {
        const { expiresAt } = await auth.login({ email: 'jane@example.com', password: 'super-secret', remember: true });
        assert.equal(expiresAt, '2030-01-31T00:00:00.000Z');
    });

    it('gives the same error for a wrong password, an unknown email and a deactivated user', async () => {
        const expectInvalid = (promise) =>
            assert.rejects(promise, (err) => err.status === 401 && err.message === 'Invalid email or password');

        await expectInvalid(auth.login({ email: 'jane@example.com', password: 'wrong-password' }));
        await expectInvalid(auth.login({ email: 'ghost@example.com', password: 'super-secret' }));

        userModel.setActive(jane.id, false);
        await expectInvalid(auth.login({ email: 'jane@example.com', password: 'super-secret' }));

        assert.equal(sessionCount(), 0, 'failed logins never create sessions');
        assert.equal(userModel.findById(jane.id).last_login_at, null);
    });

    it('authenticates a valid token and rejects unknown or empty tokens', async () => {
        const { token } = await auth.login({ email: 'jane@example.com', password: 'super-secret' });

        const result = auth.authenticate(token);
        assert.equal(result.user.email, 'jane@example.com');
        assert.equal(result.session.expiresAt, '2030-01-01T12:00:00.000Z');

        assert.equal(auth.authenticate('not-a-real-token'), null);
        assert.equal(auth.authenticate(''), null);
        assert.equal(auth.authenticate(undefined), null);
    });

    it('rejects a session once it expires', async () => {
        const { token } = await auth.login({ email: 'jane@example.com', password: 'super-secret' });

        advance(12 * HOUR - 1);
        assert.ok(auth.authenticate(token), 'still valid 1ms before expiry');
        advance(1);
        assert.equal(auth.authenticate(token), null, 'invalid exactly at expiry');
    });

    it('rejects existing sessions right after the user is deactivated', async () => {
        const { token } = await auth.login({ email: 'jane@example.com', password: 'super-secret' });
        userModel.setActive(jane.id, false);
        assert.equal(auth.authenticate(token), null);
    });

    it('logout revokes only that session', async () => {
        const laptop = await auth.login({ email: 'jane@example.com', password: 'super-secret' });
        const phone = await auth.login({ email: 'jane@example.com', password: 'super-secret' });

        assert.equal(auth.logout(laptop.token), true);
        assert.equal(auth.authenticate(laptop.token), null);
        assert.ok(auth.authenticate(phone.token));

        assert.equal(auth.logout(laptop.token), false, 'logging out twice is harmless');
        assert.equal(auth.logout(''), false);
    });

    it('removes the user\'s expired sessions when they log in again', async () => {
        await auth.login({ email: 'jane@example.com', password: 'super-secret' });
        await auth.login({ email: 'jane@example.com', password: 'super-secret' });
        assert.equal(sessionCount(), 2);

        advance(13 * HOUR);
        await auth.login({ email: 'jane@example.com', password: 'super-secret' });
        assert.equal(sessionCount(), 1);
    });

    it('deletes sessions when their user is deleted', async () => {
        await auth.login({ email: 'jane@example.com', password: 'super-secret' });
        db.prepare('DELETE FROM users WHERE id = ?').run(jane.id);
        assert.equal(sessionCount(), 0);
    });
});
