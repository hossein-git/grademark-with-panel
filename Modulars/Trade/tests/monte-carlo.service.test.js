'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MonteCarloService } = require('../monte-carlo.service');
const { BacktestService } = require('../backtest.service');
const { JobSlots } = require('../job.runner');
const { createTradeApp } = require('./helpers');

describe('Trade/MonteCarloService', () => {
    let db;
    let context;
    let ids;
    let backtestId; // a completed HoldThreeBars backtest on TEST_D1 (7 trades)

    const expectHttpError = async (fn, status, message) => {
        await assert.rejects(async () => fn(), (err) => {
            assert.equal(err.status, status, err.message);
            if (message) assert.match(err.message, message);
            return true;
        });
    };

    /** A service whose jobs finish only when the test calls release(). */
    function controllableService(jobSlots = new JobSlots(2)) {
        const pending = [];
        const service = new MonteCarloService({
            monteCarloModel: context.monteCarloService.monteCarloModel,
            backtestModel: context.backtestService.backtestModel,
            tradeConfig: context.config.trade,
            jobSlots,
            runJob: (job) => new Promise((resolve, reject) => pending.push({ job, resolve, reject })),
        });
        const next = async () => {
            while (pending.length === 0) await new Promise((r) => setImmediate(r));
            return pending.shift();
        };
        return { service, next };
    }

    beforeEach(async () => {
        ({ db, context } = createTradeApp());
        ids = Object.fromEntries([
            ...context.catalogService.listStrategies().map((s) => [s.key, s.id]),
            ...context.catalogService.listCharts().map((c) => [c.name, c.id]),
        ]);
        const { done } = context.backtestService.start({ strategyId: ids.HoldThreeBars, chartId: ids.TEST_D1, startingCapital: 1000 });
        backtestId = (await done).id;
    });

    it('runs in a worker with sensible defaults and stores the result', async () => {
        const user = await context.userService.createUser({ name: 'Quant', email: 'quant@example.com', password: 'password-123' });
        const { monteCarlo, done } = context.monteCarloService.start({ backtestId, userId: user.id });

        assert.equal(monteCarlo.status, 'running');
        assert.equal(monteCarlo.backtestId, backtestId);
        assert.equal(monteCarlo.numIterations, 1000);
        assert.equal(monteCarlo.numSamples, 7, 'defaults to the number of trades in the backtest');
        assert.ok(Number.isInteger(monteCarlo.randomSeed), 'a seed is generated and stored so the run can be reproduced');
        assert.equal(monteCarlo.startingCapital, 1000);
        assert.deepEqual(monteCarlo.user, { id: user.id, name: 'Quant' });
        assert.equal(monteCarlo.result, null);

        const finished = await done;
        assert.equal(finished.status, 'completed');
        assert.equal(finished.error, null);
        assert.ok(finished.durationMs >= 0);
        assert.equal(finished.result.populationSize, 7);
        assert.equal(finished.result.numIterations, 1000);
        assert.equal(finished.result.randomSeed, monteCarlo.randomSeed);
        assert.equal(finished.result.metrics.finalCapital.count, 1000);
        assert.deepEqual(context.monteCarloService.get(backtestId), finished);
    });

    it('uses the given iterations, samples and seed, and the same seed gives the same result', async () => {
        const first = await context.monteCarloService.start({ backtestId, numIterations: 300, numSamples: 20, randomSeed: 99 }).done;
        assert.deepEqual([first.numIterations, first.numSamples, first.randomSeed], [300, 20, 99]);

        // Same input on a second, identical backtest gives identical statistics.
        const other = await context.backtestService.start({ strategyId: ids.HoldThreeBars, chartId: ids.TEST_D1, startingCapital: 1000 }).done;
        const second = await context.monteCarloService.start({ backtestId: other.id, numIterations: 300, numSamples: 20, randomSeed: 99 }).done;
        assert.deepEqual(second.result, first.result);
    });

    it('a backtest can only have one simulation: starting again is refused while running and after completion', async () => {
        const { service, next } = controllableService();
        const { done } = service.start({ backtestId });
        await expectHttpError(() => service.start({ backtestId }), 409, /already running/);

        const job = await next();
        assert.equal(job.job.type, 'monteCarlo');
        assert.equal(job.job.trades.length, 7);
        job.resolve({ fake: true });
        assert.equal((await done).status, 'completed');

        await expectHttpError(() => service.start({ backtestId }), 409, /already has a Monte Carlo simulation/);
        await expectHttpError(() => context.monteCarloService.start({ backtestId }), 409, /already has/);
        assert.equal(db.prepare('SELECT COUNT(*) FROM monte_carlo_simulations').pluck().get(), 1);
    });

    it('a failed simulation can be run again, reusing its row', async () => {
        const { service, next } = controllableService();
        const first = service.start({ backtestId, numIterations: 10 });
        (await next()).reject(new Error('worker crashed'));
        const failed = await first.done;
        assert.equal(failed.status, 'failed');
        assert.equal(failed.error, 'worker crashed');

        const second = service.start({ backtestId, numIterations: 20 });
        assert.equal(second.monteCarlo.id, failed.id);
        assert.equal(second.monteCarlo.status, 'running');
        assert.equal(second.monteCarlo.error, null);
        assert.equal(second.monteCarlo.numIterations, 20);
        (await next()).resolve({ ok: 1 });
        assert.deepEqual((await second.done).result, { ok: 1 });
    });

    it('refuses backtests that are unknown, not completed or have no trades', async () => {
        await expectHttpError(() => context.monteCarloService.start({ backtestId: 9999 }), 404, /Backtest not found/);

        const failed = await context.backtestService.start({ strategyId: ids.ThrowsOnRun, chartId: ids.TEST_D1, startingCapital: 1000 }).done;
        await expectHttpError(() => context.monteCarloService.start({ backtestId: failed.id }), 409, /needs a completed backtest/);

        const model = context.backtestService.backtestModel;
        const noTrades = model.createRunning({ strategyId: ids.HoldThreeBars, chartId: ids.TEST_D1, startingCapital: 1000 });
        model.complete(noTrades, {
            parameters: null, barCount: 1, firstBarTime: 'x', lastBarTime: 'x', trades: [],
            analysis: {}, equityCurve: [], drawdown: [],
        }, new Date(), 1);
        await expectHttpError(() => context.monteCarloService.start({ backtestId: noTrades }), 409, /no trades to simulate/);

        assert.equal(db.prepare('SELECT COUNT(*) FROM monte_carlo_simulations').pluck().get(), 0);
    });

    it('refuses more than 10,000,000 simulated trades in total', async () => {
        await expectHttpError(() => context.monteCarloService.start({ backtestId, numIterations: 10000, numSamples: 1001 }), 400);
        const ok = context.monteCarloService.start({ backtestId, numIterations: 1000, numSamples: 10 });
        await ok.done;
    });

    it('shares the concurrency limit with backtests', async () => {
        const jobSlots = new JobSlots(1);
        const backtests = new BacktestService({
            backtestModel: context.backtestService.backtestModel,
            catalogModel: context.catalogModel,
            tradeConfig: context.config.trade,
            jobSlots,
            runJob: () => new Promise(() => {}), // never finishes: keeps the only slot busy
        });
        backtests.start({ strategyId: ids.HoldThreeBars, chartId: ids.TEST_D1, startingCapital: 1000 });

        const { service } = controllableService(jobSlots);
        await expectHttpError(() => service.start({ backtestId }), 429, /Too many/);
        assert.equal(context.monteCarloService.get(backtestId), null, 'nothing is stored when refused');
    });

    it('failInterruptedRuns marks simulations left running as failed', async () => {
        const { service } = controllableService();
        service.start({ backtestId });
        assert.equal(context.monteCarloService.failInterruptedRuns(), 1);
        const row = context.monteCarloService.get(backtestId);
        assert.equal(row.status, 'failed');
        assert.match(row.error, /Interrupted/);
    });

    it('the Trade module marks interrupted backtests and simulations as failed at server start', () => {
        const { service } = controllableService();
        service.start({ backtestId });
        context.backtestService.backtestModel.createRunning({ strategyId: ids.HoldThreeBars, chartId: ids.TEST_D1, startingCapital: 1000 });

        require('../index').onServerStart(context);

        assert.equal(context.monteCarloService.get(backtestId).status, 'failed');
        assert.equal(db.prepare("SELECT COUNT(*) FROM backtests WHERE status = 'running'").pluck().get(), 0);
    });

    it('the database allows one simulation per backtest and deletes it with the backtest', async () => {
        await context.monteCarloService.start({ backtestId, numIterations: 5 }).done;
        const insert = db.prepare(`
            INSERT INTO monte_carlo_simulations (backtest_id, status, num_iterations, num_samples, random_seed, starting_capital, started_at)
            VALUES (?, 'running', 1, 1, 1, 1000, 'now')
        `);
        assert.throws(() => insert.run(backtestId), /UNIQUE constraint failed/);

        db.prepare('DELETE FROM backtests WHERE id = ?').run(backtestId);
        assert.equal(db.prepare('SELECT COUNT(*) FROM monte_carlo_simulations').pluck().get(), 0);
    });

    it('model: createOrRestart never replaces a running or completed simulation (safety net for races)', async () => {
        const model = context.monteCarloService.monteCarloModel;
        const params = { backtestId, numIterations: 5, numSamples: 1, randomSeed: 1, startingCapital: 1000 };

        assert.equal(model.createOrRestart(params), true);
        assert.equal(model.createOrRestart({ ...params, numIterations: 99 }), false, 'running');
        model.complete(backtestId, { kept: true }, new Date(), 1);
        assert.equal(model.createOrRestart({ ...params, numIterations: 99 }), false, 'completed');

        const row = context.monteCarloService.get(backtestId);
        assert.deepEqual([row.status, row.numIterations, row.result], ['completed', 5, { kept: true }]);
    });

    it('get returns null when there is no simulation', () => {
        assert.equal(context.monteCarloService.get(backtestId), null);
    });
});
