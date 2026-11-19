'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTestApp, silentLogger } = require('../../Base/tests/helpers');

const FIXTURES = path.join(__dirname, 'fixtures');
const FIXTURE_CHARTS = path.join(FIXTURES, 'Charts');
const FIXTURE_STRATEGIES = path.join(FIXTURES, 'Strategies');

/** Copies the fixture Charts and Strategies folders to a temp dir that tests can change freely. */
function copyFixtures() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-trade-'));
    const chartsDir = path.join(dir, 'Charts');
    const strategiesDir = path.join(dir, 'Strategies');
    fs.cpSync(FIXTURE_CHARTS, chartsDir, { recursive: true });
    fs.cpSync(FIXTURE_STRATEGIES, strategiesDir, { recursive: true });
    return { dir, chartsDir, strategiesDir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Boots the full app on an in-memory database, using the given (or fixture) chart and strategy folders. */
function createTradeApp({ chartsDir = FIXTURE_CHARTS, strategiesDir = FIXTURE_STRATEGIES, env = {}, logger = silentLogger } = {}) {
    return createTestApp({ env: { CHARTS_DIR: chartsDir, STRATEGIES_DIR: strategiesDir, ...env }, logger });
}

/** Collects log calls so tests can check warnings. */
function recordingLogger() {
    const entries = [];
    const record = (level) => (...args) => entries.push({ level, message: args.map(String).join(' ') });
    return { entries, log: record('log'), info: record('info'), warn: record('warn'), error: record('error') };
}

module.exports = { FIXTURES, FIXTURE_CHARTS, FIXTURE_STRATEGIES, copyFixtures, createTradeApp, recordingLogger };
