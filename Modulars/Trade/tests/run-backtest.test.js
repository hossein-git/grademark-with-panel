'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { main } = require('../scripts/run-backtest');
const { FIXTURE_CHARTS, FIXTURE_STRATEGIES } = require('./helpers');

describe('Trade/scripts/run-backtest (CLI)', () => {
    let dir;
    let env;
    let out;

    const run = (args) => main(args, { env, out });
    const query = (sql) => {
        const db = new Database(env.DB_PATH, { readonly: true });
        try {
            return db.prepare(sql).all();
        } finally {
            db.close();
        }
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-backtest-cli-'));
        env = { DB_PATH: path.join(dir, 'app.sqlite'), CHARTS_DIR: FIXTURE_CHARTS, STRATEGIES_DIR: FIXTURE_STRATEGIES };
        const quietWarn = () => {};
        out = { lines: [], errors: [], log(m) { this.lines.push(m); }, error(m) { this.errors.push(m); }, warn: quietWarn };
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('runs the backtest, prints the analysis and saves it with its trades', async () => {
        const code = await run(['--strategy', 'HoldThreeBars', '--chart', 'test_d1', '--capital', '2500']);
        assert.equal(code, 0, out.errors.join('\n'));

        const text = out.lines.join('\n');
        assert.match(text, /^Made 7 trades!/);
        assert.match(text, /=== Analysis ===/);
        assert.match(text, /"startingCapital": 2500/);
        assert.match(text, /Saved as backtest #1 \(Hold three bars on TEST_D1\)\./);

        assert.deepEqual(query('SELECT status, trade_count, starting_capital, user_id FROM backtests'), [
            { status: 'completed', trade_count: 7, starting_capital: 2500, user_id: null },
        ]);
        assert.equal(query('SELECT COUNT(*) AS n FROM backtest_trades')[0].n, 7);
    });

    it('exits with 1 and lists the options for an unknown strategy or chart', async () => {
        assert.equal(await run(['--strategy', 'Nope', '--chart', 'TEST_D1']), 1);
        assert.match(out.errors.join('\n'), /Unknown strategy "Nope"\. Available: Broken, HoldThreeBars/);
        assert.equal(await run(['--strategy', 'HoldThreeBars', '--chart', 'EURUSD_D1']), 1);
        assert.match(out.errors.join('\n'), /Unknown chart "EURUSD_D1"\. Available: OTHER_M15, TEST_H4, TEST_D1/);
    });

    it('exits with 1 when the backtest fails or cannot start', async () => {
        assert.equal(await run(['--strategy', 'ThrowsOnRun', '--chart', 'TEST_D1']), 1);
        assert.match(out.errors.join('\n'), /Backtest #1 failed: boom from strategy/);
        assert.equal(await run(['--strategy', 'Broken', '--chart', 'TEST_D1']), 1);
        assert.match(out.errors.join('\n'), /Strategy "Broken" is unavailable/);
    });

    it('validates the arguments', async () => {
        assert.equal(await run(['--strategy', 'HoldThreeBars']), 1);
        assert.match(out.errors.join('\n'), /--strategy and --chart are required/);
        for (const capital of ['0', 'abc', '--capital=-5']) {
            out.errors = [];
            const args = capital.startsWith('--') ? [capital] : ['--capital', capital];
            assert.equal(await run(['--strategy', 'HoldThreeBars', '--chart', 'TEST_D1', ...args]), 1, capital);
            assert.match(out.errors.join('\n'), /--capital must be a positive number/, capital);
        }
        assert.equal(await run(['--bogus']), 1);
        assert.equal(await run(['--help']), 0);
        assert.match(out.lines.join('\n'), /Usage: npm run backtest/);
    });
});
