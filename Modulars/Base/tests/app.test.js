'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { HttpError } = require('../errors');
const { createTestApp, startServer } = require('./helpers');

describe('Base/app', () => {
    let server;
    const logged = [];

    // A small module that exercises the error handling paths.
    const probeModule = {
        name: 'Probe',
        migrations: [{ id: 'probe_001', up: (db) => db.exec('CREATE TABLE probe (id INTEGER)') }],
        createServices: () => ({ probeService: { ping: () => 'pong' } }),
        register(app, context) {
            app.get('/api/probe/ping', (req, res) => res.json({ reply: context.probeService.ping() }));
            app.post('/api/probe/echo', (req, res) => res.json(req.body));
            app.get('/api/probe/http-error', () => {
                throw HttpError.badRequest('Nope', { field: 'bad' });
            });
            app.get('/api/probe/crash', async () => {
                throw new Error('secret internal detail');
            });
        },
    };

    before(async () => {
        const logger = { error: (...args) => logged.push(args) };
        const { app, db } = createTestApp({ modules: [probeModule], logger });
        assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'probe'").get(), 'module migration ran');
        server = await startServer(app);
    });

    after(() => server.close());

    it('exposes a health check', async () => {
        const res = await server.request('GET', '/api/health');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { status: 'ok' });
    });

    it('mounts module routes and shares module services through the context', async () => {
        const res = await server.request('GET', '/api/probe/ping');
        assert.deepEqual(res.body, { reply: 'pong' });
    });

    it('does not advertise Express', async () => {
        const res = await server.request('GET', '/api/health');
        assert.equal(res.headers.get('x-powered-by'), null);
    });

    it('returns JSON 404 for unknown API routes', async () => {
        const res = await server.request('GET', '/api/does-not-exist');
        assert.equal(res.status, 404);
        assert.match(res.body.error, /not found/);
    });

    it('returns the message and details of an HttpError', async () => {
        const res = await server.request('GET', '/api/probe/http-error');
        assert.equal(res.status, 400);
        assert.deepEqual(res.body, { error: 'Nope', details: { field: 'bad' } });
    });

    it('returns 400 for malformed JSON', async () => {
        const res = await server.request('POST', '/api/probe/echo', { rawBody: '{not json' });
        assert.equal(res.status, 400);
        assert.deepEqual(res.body, { error: 'Malformed JSON body' });
    });

    it('returns 413 for oversized bodies', async () => {
        const res = await server.request('POST', '/api/probe/echo', { body: { big: 'x'.repeat(20 * 1024) } });
        assert.equal(res.status, 413);
    });

    it('hides details of unexpected errors from the client but logs them', async () => {
        const res = await server.request('GET', '/api/probe/crash');
        assert.equal(res.status, 500);
        assert.deepEqual(res.body, { error: 'Internal server error' });
        assert.ok(logged.some((args) => args.some((a) => a instanceof Error && a.message === 'secret internal detail')));
    });
});
