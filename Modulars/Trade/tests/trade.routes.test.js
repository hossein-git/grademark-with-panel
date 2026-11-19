'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../../Base/tests/helpers');
const { createTradeApp } = require('./helpers');

describe('Trade routes (HTTP)', () => {
    let server;
    let context;
    let token;
    let ids;

    const api = (method, path, options = {}) => server.request(method, `/api/trade${path}`, { token, ...options });

    /** Polls GET /backtests/:id until the backtest is no longer running. */
    async function waitForBacktest(id) {
        for (let i = 0; i < 200; i++) {
            const res = await api('GET', `/backtests/${id}`);
            if (res.body.backtest.status !== 'running') return res;
            await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(`backtest ${id} did not finish`);
    }

    before(async () => {
        const created = createTradeApp();
        context = created.context;
        await context.userService.createUser({ name: 'Trader', email: 'trader@example.com', password: 'password-123', role: 'admin' });
        server = await startServer(created.app);
        const login = await server.request('POST', '/api/auth/login', { body: { email: 'trader@example.com', password: 'password-123' } });
        token = login.body.token;

        const strategies = (await api('GET', '/strategies')).body.strategies;
        const charts = (await api('GET', '/charts')).body.charts;
        ids = Object.fromEntries([...strategies.map((s) => [s.key, s.id]), ...charts.map((c) => [c.name, c.id])]);
    });

    after(() => server.close());

    it('requires authentication on every endpoint', async () => {
        const endpoints = [
            ['GET', '/strategies'],
            ['PATCH', '/strategies/1'],
            ['GET', '/strategies/1/backtests'],
            ['GET', '/charts'],
            ['PATCH', '/charts/1'],
            ['POST', '/backtests'],
            ['GET', '/backtests/1'],
        ];
        for (const [method, path] of endpoints) {
            const res = await server.request(method, `/api/trade${path}`, method === 'GET' ? {} : { body: {} });
            assert.equal(res.status, 401, `${method} ${path}`);
        }
    });

    it('GET /strategies and GET /charts list the catalog', async () => {
        const strategies = await api('GET', '/strategies');
        assert.equal(strategies.status, 200);
        const hold = strategies.body.strategies.find((s) => s.key === 'HoldThreeBars');
        assert.deepEqual(
            { name: hold.name, isActive: hold.isActive, isAvailable: hold.isAvailable },
            { name: 'Hold three bars', isActive: true, isAvailable: true },
        );

        const charts = await api('GET', '/charts');
        assert.equal(charts.status, 200);
        assert.deepEqual(charts.body.charts.map((c) => `${c.symbol}/${c.timeframe}`), ['OTHER/M15', 'TEST/H4', 'TEST/D1']);
    });

    it('POST /backtests starts a run (202) and GET /backtests/:id returns the full result when done', async () => {
        const res = await api('POST', '/backtests', { body: { strategyId: ids.HoldThreeBars, chartId: ids.TEST_D1, startingCapital: 5000 } });
        assert.equal(res.status, 202);
        assert.equal(res.body.backtest.status, 'running');
        assert.equal(res.body.backtest.startingCapital, 5000);
        assert.equal(res.body.backtest.user.name, 'Trader');
        assert.equal(res.headers.get('location'), `/api/trade/backtests/${res.body.backtest.id}`);

        const done = await waitForBacktest(res.body.backtest.id);
        assert.equal(done.status, 200);
        const { backtest } = done.body;
        assert.equal(backtest.status, 'completed');
        assert.equal(backtest.tradeCount, 7);
        assert.equal(backtest.trades.length, 7);
        assert.equal(backtest.equityCurve[0].value, 5000);
        assert.equal(backtest.analysis.startingCapital, 5000);
        assert.equal(backtest.chart.name, 'TEST_D1');
    });

    it('uses a starting capital of 10000 by default', async () => {
        const res = await api('POST', '/backtests', { body: { strategyId: ids.HoldThreeBars, chartId: ids.TEST_H4 } });
        assert.equal(res.status, 202);
        assert.equal(res.body.backtest.startingCapital, 10000);
        await waitForBacktest(res.body.backtest.id);
    });

    it('a failing strategy ends as a failed backtest with its error', async () => {
        const res = await api('POST', '/backtests', { body: { strategyId: ids.ThrowsOnRun, chartId: ids.TEST_D1 } });
        const { backtest } = (await waitForBacktest(res.body.backtest.id)).body;
        assert.equal(backtest.status, 'failed');
        assert.match(backtest.error, /boom from strategy/);
    });

    it('POST /backtests validates the body', async () => {
        const res = await api('POST', '/backtests', { body: { strategyId: 'x', chartId: -1, startingCapital: 0 } });
        assert.equal(res.status, 400);
        assert.deepEqual(Object.keys(res.body.details).sort(), ['chartId', 'startingCapital', 'strategyId']);

        assert.equal((await api('POST', '/backtests', { body: { strategyId: 999, chartId: ids.TEST_D1 } })).status, 404);
        assert.equal((await api('POST', '/backtests', { body: { strategyId: ids.Broken, chartId: ids.TEST_D1 } })).status, 409);
    });

    it('GET /strategies/:id/backtests lists runs for a strategy with symbol and timeframe filters', async () => {
        const res = await api('GET', `/strategies/${ids.HoldThreeBars}/backtests`);
        assert.equal(res.status, 200);
        assert.equal(res.body.strategy.key, 'HoldThreeBars');
        assert.deepEqual(res.body.backtests.map((b) => b.chart.name), ['TEST_H4', 'TEST_D1']);
        assert.deepEqual(res.body.filterOptions, { symbols: ['TEST'], timeframes: ['H4', 'D1'] });
        assert.equal('trades' in res.body.backtests[0], false, 'lists do not include trades');

        const filtered = await api('GET', `/strategies/${ids.HoldThreeBars}/backtests?symbol=test&timeframe=d1`);
        assert.deepEqual(filtered.body.backtests.map((b) => b.chart.name), ['TEST_D1']);

        const bad = await api('GET', `/strategies/${ids.HoldThreeBars}/backtests?symbol=${encodeURIComponent("x' OR 1=1 --")}`);
        assert.equal(bad.status, 400);

        assert.equal((await api('GET', '/strategies/999/backtests')).status, 404);
        assert.equal((await api('GET', '/strategies/abc/backtests')).status, 404);
    });

    it('the strategy list shows backtest counts', async () => {
        const { strategies } = (await api('GET', '/strategies')).body;
        const hold = strategies.find((s) => s.key === 'HoldThreeBars');
        assert.deepEqual([hold.backtestCount, hold.completedCount], [2, 2]);
    });

    it('PATCH /strategies/:id and /charts/:id activate and deactivate', async () => {
        const off = await api('PATCH', `/charts/${ids.OTHER_M15}`, { body: { isActive: false } });
        assert.equal(off.status, 200);
        assert.equal(off.body.chart.isActive, false);
        const blocked = await api('POST', '/backtests', { body: { strategyId: ids.HoldThreeBars, chartId: ids.OTHER_M15 } });
        assert.equal(blocked.status, 409);
        assert.match(blocked.body.error, /deactivated/);
        assert.equal((await api('PATCH', `/charts/${ids.OTHER_M15}`, { body: { isActive: true } })).body.chart.isActive, true);

        const strategyOff = await api('PATCH', `/strategies/${ids.NeverFinishes}`, { body: { isActive: false } });
        assert.equal(strategyOff.body.strategy.isActive, false);

        assert.equal((await api('PATCH', `/strategies/${ids.HoldThreeBars}`, { body: { isActive: 'yes' } })).status, 400);
        assert.equal((await api('PATCH', '/strategies/999', { body: { isActive: true } })).status, 404);
        assert.equal((await api('PATCH', '/charts/999', { body: { isActive: true } })).status, 404);
    });

    it('GET /backtests/:id returns 404 for unknown or invalid ids', async () => {
        assert.equal((await api('GET', '/backtests/99999')).status, 404);
        assert.equal((await api('GET', '/backtests/1.5')).status, 404);
        assert.equal((await api('GET', '/backtests/-1')).status, 404);
    });
});
