'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../../Base/tests/helpers');
const { createTradeApp } = require('./helpers');

describe('Trade Monte Carlo routes (HTTP)', () => {
    let server;
    let context;
    let token;
    let ids;

    const api = (method, path, options = {}) => server.request(method, `/api/trade${path}`, { token, ...options });

    async function waitFor(path, field) {
        for (let i = 0; i < 400; i++) {
            const res = await api('GET', path);
            if (res.status === 200 && res.body[field].status !== 'running') return res;
            await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(`${path} did not finish`);
    }

    async function newBacktest(strategy = 'HoldThreeBars') {
        const res = await api('POST', '/backtests', { body: { strategyId: ids[strategy], chartId: ids.TEST_D1, startingCapital: 1000 } });
        return (await waitFor(`/backtests/${res.body.backtest.id}`, 'backtest')).body.backtest;
    }

    before(async () => {
        const created = createTradeApp();
        context = created.context;
        await context.userService.createUser({ name: 'Quant', email: 'quant@example.com', password: 'password-123' });
        server = await startServer(created.app);
        token = (await server.request('POST', '/api/auth/login', { body: { email: 'quant@example.com', password: 'password-123' } })).body.token;
        ids = Object.fromEntries([
            ...context.catalogService.listStrategies().map((s) => [s.key, s.id]),
            ...context.catalogService.listCharts().map((c) => [c.name, c.id]),
        ]);
    });

    after(() => server.close());

    it('requires authentication', async () => {
        assert.equal((await server.request('POST', '/api/trade/backtests/1/monte-carlo', { body: {} })).status, 401);
        assert.equal((await server.request('GET', '/api/trade/backtests/1/monte-carlo')).status, 401);
    });

    it('runs a simulation once: 202, then the result, then 409 on a second attempt', async () => {
        const backtest = await newBacktest();
        assert.equal(backtest.monteCarlo, null, 'a new backtest has no simulation');
        assert.equal((await api('GET', `/backtests/${backtest.id}/monte-carlo`)).status, 404);

        const started = await api('POST', `/backtests/${backtest.id}/monte-carlo`, { body: { numIterations: 500, randomSeed: 42 } });
        assert.equal(started.status, 202);
        assert.equal(started.headers.get('location'), `/api/trade/backtests/${backtest.id}/monte-carlo`);
        assert.deepEqual(
            { status: started.body.monteCarlo.status, numIterations: started.body.monteCarlo.numIterations, numSamples: started.body.monteCarlo.numSamples, randomSeed: started.body.monteCarlo.randomSeed, user: started.body.monteCarlo.user.name },
            { status: 'running', numIterations: 500, numSamples: 7, randomSeed: 42, user: 'Quant' },
        );

        const done = (await waitFor(`/backtests/${backtest.id}/monte-carlo`, 'monteCarlo')).body.monteCarlo;
        assert.equal(done.status, 'completed');
        assert.equal(done.result.metrics.finalCapital.count, 500);
        assert.deepEqual(Object.keys(done.result.equityBands).sort(), ['p25', 'p5', 'p50', 'p75', 'p95', 'steps']);
        assert.ok(done.result.histograms.profitPct.length > 0);

        // The backtest details include the simulation, so the page knows not to offer it again.
        const detail = (await api('GET', `/backtests/${backtest.id}`)).body.backtest;
        assert.equal(detail.monteCarlo.status, 'completed');
        assert.deepEqual(detail.monteCarlo.result, done.result);

        const again = await api('POST', `/backtests/${backtest.id}/monte-carlo`, { body: {} });
        assert.equal(again.status, 409);
        assert.match(again.body.error, /already has a Monte Carlo simulation/);
    });

    it('uses defaults when the body is empty', async () => {
        const backtest = await newBacktest();
        const started = await api('POST', `/backtests/${backtest.id}/monte-carlo`);
        assert.equal(started.status, 202);
        assert.equal(started.body.monteCarlo.numIterations, 1000);
        assert.equal(started.body.monteCarlo.numSamples, 7);
        await waitFor(`/backtests/${backtest.id}/monte-carlo`, 'monteCarlo');
    });

    it('validates the body', async () => {
        const backtest = await newBacktest();
        const res = await api('POST', `/backtests/${backtest.id}/monte-carlo`, {
            body: { numIterations: 0, numSamples: 10001, randomSeed: -1 },
        });
        assert.equal(res.status, 400);
        assert.deepEqual(Object.keys(res.body.details).sort(), ['numIterations', 'numSamples', 'randomSeed']);

        assert.equal((await api('POST', `/backtests/${backtest.id}/monte-carlo`, { body: { numIterations: 1.5 } })).status, 400);
        assert.equal((await api('POST', `/backtests/${backtest.id}/monte-carlo`, { body: { numIterations: '100' } })).status, 400);
        const tooMuch = await api('POST', `/backtests/${backtest.id}/monte-carlo`, { body: { numIterations: 10000, numSamples: 10000 } });
        assert.equal(tooMuch.status, 400);
        assert.match(tooMuch.body.details.numIterations, /at most 10,000,000/);
        assert.equal((await api('GET', `/backtests/${backtest.id}/monte-carlo`)).status, 404, 'nothing was started');
    });

    it('returns 409 for a failed backtest and 404 for unknown ones', async () => {
        const failed = await newBacktest('ThrowsOnRun');
        const res = await api('POST', `/backtests/${failed.id}/monte-carlo`, { body: {} });
        assert.equal(res.status, 409);
        assert.match(res.body.error, /needs a completed backtest/);

        assert.equal((await api('POST', '/backtests/99999/monte-carlo', { body: {} })).status, 404);
        assert.equal((await api('GET', '/backtests/99999/monte-carlo')).status, 404);
        assert.equal((await api('GET', '/backtests/abc/monte-carlo')).status, 404);
    });
});
