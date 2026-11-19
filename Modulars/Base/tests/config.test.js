'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig, PROJECT_ROOT } = require('../config');

describe('Base/config', () => {
    it('provides sensible defaults', () => {
        const config = loadConfig({});
        assert.equal(config.port, 3000);
        assert.equal(config.host, '127.0.0.1');
        assert.equal(config.dbPath, path.join(PROJECT_ROOT, 'database', 'app.sqlite'));
        assert.deepEqual(config.auth, { sessionTtlHours: 12, rememberTtlDays: 30 });
    });

    it('reads values from the environment', () => {
        const config = loadConfig({
            PORT: '8080',
            HOST: '0.0.0.0',
            DB_PATH: '/tmp/custom.sqlite',
            SESSION_TTL_HOURS: '2',
            SESSION_REMEMBER_TTL_DAYS: '7',
        });
        assert.equal(config.port, 8080);
        assert.equal(config.host, '0.0.0.0');
        assert.equal(config.dbPath, '/tmp/custom.sqlite');
        assert.deepEqual(config.auth, { sessionTtlHours: 2, rememberTtlDays: 7 });
    });

    it('resolves a relative DB_PATH against the project root, not the cwd', () => {
        assert.equal(loadConfig({ DB_PATH: 'data/x.sqlite' }).dbPath, path.join(PROJECT_ROOT, 'data', 'x.sqlite'));
    });

    it('rejects invalid numbers instead of silently using a fallback', () => {
        assert.throws(() => loadConfig({ PORT: 'abc' }), /Invalid value for PORT/);
        assert.throws(() => loadConfig({ SESSION_TTL_HOURS: '0' }), /SESSION_TTL_HOURS/);
        assert.throws(() => loadConfig({ SESSION_REMEMBER_TTL_DAYS: '1.5' }), /SESSION_REMEMBER_TTL_DAYS/);
    });
});
