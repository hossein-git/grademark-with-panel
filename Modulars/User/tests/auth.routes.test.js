'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, startServer } = require('../../Base/tests/helpers');

describe('User/auth routes (HTTP)', () => {
    let server;
    let context;
    const credentials = { email: 'admin@example.com', password: 'correct horse battery' };

    const login = (body = credentials) => server.request('POST', '/api/auth/login', { body });

    before(async () => {
        const created = createTestApp();
        context = created.context;
        await context.userService.createUser({ name: 'Admin', role: 'admin', ...credentials });
        server = await startServer(created.app);
    });

    after(() => server.close());

    describe('POST /api/auth/login', () => {
        it('returns a token and the public user for valid credentials', async () => {
            const res = await login();
            assert.equal(res.status, 200);
            assert.equal(typeof res.body.token, 'string');
            assert.ok(!Number.isNaN(Date.parse(res.body.expiresAt)));
            assert.equal(res.body.user.email, 'admin@example.com');
            assert.equal(res.body.user.name, 'Admin');
            assert.equal(res.body.user.role, 'admin');
            assert.equal(JSON.stringify(res.body).includes('scrypt$'), false, 'no password hash in the response');
            assert.equal(res.headers.get('cache-control'), 'no-store');
        });

        it('treats the email as case-insensitive and ignores surrounding whitespace', async () => {
            const res = await login({ email: '  ADMIN@Example.com ', password: credentials.password });
            assert.equal(res.status, 200);
        });

        it('returns 401 with a generic message for a wrong password or unknown email', async () => {
            const wrongPassword = await login({ email: credentials.email, password: 'nope-nope' });
            const unknownEmail = await login({ email: 'ghost@example.com', password: credentials.password });
            for (const res of [wrongPassword, unknownEmail]) {
                assert.equal(res.status, 401);
                assert.deepEqual(res.body, { error: 'Invalid email or password' });
            }
        });

        it('returns 400 with field details for missing credentials', async () => {
            const res = await login({});
            assert.equal(res.status, 400);
            assert.equal(res.body.error, 'Validation failed');
            assert.deepEqual(Object.keys(res.body.details).sort(), ['email', 'password']);
        });

        it('returns 400 for malformed JSON', async () => {
            const res = await server.request('POST', '/api/auth/login', { rawBody: '{"email":' });
            assert.equal(res.status, 400);
        });

        it('honours "remember me" with a longer expiry', async () => {
            const normal = await login({ ...credentials, remember: false });
            const remembered = await login({ ...credentials, remember: true });
            const hours = (r) => (Date.parse(r.body.expiresAt) - Date.now()) / 3600e3;
            assert.ok(Math.abs(hours(normal) - 12) < 0.1, `normal session ~12h, got ${hours(normal)}`);
            assert.ok(Math.abs(hours(remembered) - 30 * 24) < 0.1, `remembered session ~30d, got ${hours(remembered)}`);
        });
    });

    describe('GET /api/auth/me', () => {
        it('returns the current user for a valid token', async () => {
            const { body: { token } } = await login();
            const res = await server.request('GET', '/api/auth/me', { token });
            assert.equal(res.status, 200);
            assert.equal(res.body.user.email, 'admin@example.com');
            assert.ok(res.body.user.lastLoginAt);
        });

        it('returns 401 without a token, with a bad token or with a malformed header', async () => {
            const noToken = await server.request('GET', '/api/auth/me');
            assert.equal(noToken.status, 401);
            assert.deepEqual(noToken.body, { error: 'Authentication required' });

            const badToken = await server.request('GET', '/api/auth/me', { token: 'forged-token' });
            assert.equal(badToken.status, 401);
            assert.deepEqual(badToken.body, { error: 'Invalid or expired session' });

            const { body: { token } } = await login();
            const wrongScheme = await server.request('GET', '/api/auth/me', { headers: { authorization: `Basic ${token}` } });
            assert.equal(wrongScheme.status, 401);
        });

        it('accepts a lowercase "bearer" scheme', async () => {
            const { body: { token } } = await login();
            const res = await server.request('GET', '/api/auth/me', { headers: { authorization: `bearer ${token}` } });
            assert.equal(res.status, 200);
        });
    });

    describe('POST /api/auth/logout', () => {
        it('revokes the token so it can no longer be used', async () => {
            const { body: { token } } = await login();
            assert.equal((await server.request('GET', '/api/auth/me', { token })).status, 200);

            const res = await server.request('POST', '/api/auth/logout', { token });
            assert.equal(res.status, 204);
            assert.equal(res.body, null);

            assert.equal((await server.request('GET', '/api/auth/me', { token })).status, 401);
            assert.equal((await server.request('POST', '/api/auth/logout', { token })).status, 401);
        });

        it('requires authentication', async () => {
            assert.equal((await server.request('POST', '/api/auth/logout')).status, 401);
        });
    });

    it('blocks a deactivated user on their next request', async () => {
        await context.userService.createUser({ name: 'Temp', email: 'temp@example.com', password: 'temp-password' });
        const { body: { token, user } } = await login({ email: 'temp@example.com', password: 'temp-password' });
        assert.equal((await server.request('GET', '/api/auth/me', { token })).status, 200);

        context.userModel.setActive(user.id, false);
        assert.equal((await server.request('GET', '/api/auth/me', { token })).status, 401);
        assert.equal((await login({ email: 'temp@example.com', password: 'temp-password' })).status, 401);
    });

    it('exposes requireAuth so other modules can protect their routes', () => {
        assert.equal(typeof context.requireAuth, 'function');
    });
});
