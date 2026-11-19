'use strict';

const { loadConfig } = require('../config');
const { openDatabase } = require('../database');
const { bootstrap } = require('../bootstrap');

const silentLogger = { log() {}, info() {}, warn() {}, error() {} };

/** Boots the full application on a fresh in-memory database. */
function createTestApp({ env = {}, modules = require('../..'), logger = silentLogger } = {}) {
    const config = loadConfig(env);
    return bootstrap({ config, modules, db: openDatabase(':memory:'), logger });
}

/**
 * Starts `app` on a random free port.
 * `request(method, path, { body, token, headers, rawBody })` resolves to { status, headers, body }.
 */
async function startServer(app) {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    async function request(method, path, { body, rawBody, token, headers = {} } = {}) {
        const finalHeaders = { ...headers };
        if (body !== undefined || rawBody !== undefined) {
            finalHeaders['content-type'] = finalHeaders['content-type'] || 'application/json';
        }
        if (token) {
            finalHeaders.authorization = `Bearer ${token}`;
        }
        const res = await fetch(baseUrl + path, {
            method,
            headers: finalHeaders,
            body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let parsed = null;
        if (text) {
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = text;
            }
        }
        return { status: res.status, headers: res.headers, body: parsed };
    }

    function close() {
        return new Promise((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
        });
    }

    return { baseUrl, request, close };
}

module.exports = { createTestApp, startServer, silentLogger };
