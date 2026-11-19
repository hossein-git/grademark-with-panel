'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { BacktestService } = require('../backtest.service');
const { runInWorker } = require('../job.runner');
const { createTradeApp, FIXTURE_CHARTS, FIXTURE_STRATEGIES } = require('./helpers');
const path = require('node:path');

describe('Trade/BacktestService', () => {
    let db;
    let context;
    let ids;

    beforeEach(() => {
        ({ db, context } = createTradeApp());
        const strategies = Object.fromEntries(context.catalogService.listStrategies().map((s) => [s.key, s.id]));
        const charts = Object.fromEntries(context.catalogService.listCharts().map((c) => [c.name, c.id]));
        ids = { ...strategies, ...charts };
    });

    const start = (overrides = {}) => context.backtestService.start({
        strategyId: ids.HoldThreeBars,
        chartId: ids.TEST_D1,
        startingCapital: 1000,
        ...overrides,
    });

    it('runs in a worker and stores the result, metrics and trades', async () => {
        const user = await context.userService.createUser({ name: 'Runner', email: 'runner@example.com', password: 'password-123' });
        const { backtest, done } = start({ userId: user.id });

        assert.equal(backtest.status, 'running');
        assert.deepEqual(backtest.strategy, { id: ids.HoldThreeBars, key: 'HoldThreeBars', name: 'Hold three bars' });
        assert.deepEqual(backtest.chart, { id: ids.TEST_D1, name: 'TEST_D1', symbol: 'TEST', timeframe: 'D1' });
        assert.deepEqual(backtest.user, { id: user.id, name: 'Runner' });

        const finished = await done;
        assert.equal(finished.status, 'completed');
        assert.equal(finished.error, null);
        assert.equal(finished.tradeCount, 7);
        assert.equal(finished.barCount, 40);
        assert.deepEqual(finished.parameters, { holdBars: 3 });
        assert.ok(finished.durationMs >= 0);
        assert.ok(finished.finishedAt >= finished.startedAt);

        const detail = context.backtestService.getDetail(backtest.id);
        assert.equal(detail.trades.length, 7);
        assert.deepEqual(detail.trades.map((t) => t.number), [1, 2, 3, 4, 5, 6, 7]);
        assert.equal(detail.trades[0].entryPrice, 101);
        assert.equal(detail.equityCurve.length, 8);
        assert.equal(detail.drawdown.length, 8);
        assert.equal(detail.analysis.totalTrades, 7);
        assert.equal(detail.analysis.maxRiskPct, null);
        // Headline columns match the full analysis.
        assert.equal(detail.profitPct, detail.analysis.profitPct);
        assert.equal(detail.finalCapital, detail.analysis.finalCapital);
        assert.equal(detail.percentProfitable, detail.analysis.percentProfitable);
        assert.equal(detail.expectancy, detail.analysis.expectency);
        assert.equal(db.prepare('SELECT COUNT(*) FROM backtest_trades').pluck().get(), 7);
    });

    it('stores a failed backtest with the error message when the strategy throws', async () => {
        const { done } = start({ strategyId: ids.ThrowsOnRun });
        const finished = await done;
        assert.equal(finished.status, 'failed');
        assert.match(finished.error, /boom from strategy/);
        assert.equal(finished.tradeCount, null);
        assert.deepEqual(context.backtestService.getDetail(finished.id).trades, []);
    });

    it('validates the strategy and chart before creating anything', () => {
        const expectStatus = (overrides, status, message) => assert.throws(() => start(overrides), (err) => {
            assert.equal(err.status, status);
            if (message) assert.match(err.message, message);
            return true;
        });

        expectStatus({ strategyId: 999 }, 404, /Strategy not found/);
        expectStatus({ chartId: 999 }, 404, /Chart not found/);
        expectStatus({ strategyId: ids.Broken }, 409, /unavailable: Missing "strategy" object/);

        context.catalogService.setStrategyActive(ids.HoldThreeBars, false);
        expectStatus({}, 409, /Strategy "Hold three bars" is deactivated/);
        context.catalogService.setStrategyActive(ids.HoldThreeBars, true);

        context.catalogService.setChartActive(ids.TEST_D1, false);
        expectStatus({}, 409, /Chart "TEST_D1" is deactivated/);

        assert.equal(db.prepare('SELECT COUNT(*) FROM backtests').pluck().get(), 0);
    });

    it('limits how many backtests run at once', async () => {
        const releases = [];
        const service = new BacktestService({
            backtestModel: context.backtestService.backtestModel,
            catalogModel: context.catalogModel,
            tradeConfig: { ...context.config.trade, maxConcurrentBacktests: 2 },
            // Fake runner that finishes only when the test says so.
            runJob: () => new Promise((resolve, reject) => releases.push({ resolve, reject })),
        });
        const startWith = () => service.start({ strategyId: ids.HoldThreeBars, chartId: ids.TEST_D1, startingCapital: 1000 });

        const first = startWith();
        const second = startWith();
        assert.throws(startWith, (err) => err.status === 429);

        await new Promise((r) => setImmediate(r));
        releases[0].reject(new Error('cancelled'));
        await first.done;
        const third = startWith(); // a slot is free again
        releases[1].reject(new Error('cancelled'));
        await new Promise((r) => setImmediate(r));
        releases[2].reject(new Error('cancelled'));
        assert.deepEqual([(await second.done).status, (await third.done).status], ['failed', 'failed']);
    });

    it('failInterruptedRuns marks backtests left running as failed', () => {
        const id = context.backtestService.backtestModel.createRunning({ strategyId: ids.HoldThreeBars, chartId: ids.TEST_D1, startingCapital: 1000 });
        assert.equal(context.backtestService.failInterruptedRuns(), 1);
        const summary = context.backtestService.getSummary(id);
        assert.equal(summary.status, 'failed');
        assert.match(summary.error, /Interrupted/);
        assert.equal(context.backtestService.failInterruptedRuns(), 0);
    });

    it('lists a strategy\'s backtests newest first, with symbol/timeframe filters and filter options', async () => {
        await start({ chartId: ids.TEST_D1 }).done;
        await start({ chartId: ids.TEST_H4 }).done;
        await start({ chartId: ids.OTHER_M15 }).done;
        await start({ strategyId: ids.ThrowsOnRun }).done; // other strategy: never listed below

        const all = context.backtestService.listForStrategy(ids.HoldThreeBars, {});
        assert.deepEqual(all.backtests.map((b) => b.chart.name), ['OTHER_M15', 'TEST_H4', 'TEST_D1']);
        assert.deepEqual(all.filterOptions, { symbols: ['OTHER', 'TEST'], timeframes: ['M15', 'H4', 'D1'] });

        const bySymbol = context.backtestService.listForStrategy(ids.HoldThreeBars, { symbol: 'TEST' });
        assert.deepEqual(bySymbol.backtests.map((b) => b.chart.name), ['TEST_H4', 'TEST_D1']);

        const both = context.backtestService.listForStrategy(ids.HoldThreeBars, { symbol: 'TEST', timeframe: 'H4' });
        assert.deepEqual(both.backtests.map((b) => b.chart.name), ['TEST_H4']);

        assert.deepEqual(context.backtestService.listForStrategy(ids.HoldThreeBars, { timeframe: 'W1' }).backtests, []);

        const strategies = context.catalogService.listStrategies();
        const hold = strategies.find((s) => s.key === 'HoldThreeBars');
        assert.deepEqual([hold.backtestCount, hold.completedCount], [3, 3]);
        assert.ok(hold.lastRunAt);
        const throws = strategies.find((s) => s.key === 'ThrowsOnRun');
        assert.deepEqual([throws.backtestCount, throws.completedCount], [1, 0]);
    });

    it('getDetail throws 404 for an unknown backtest', () => {
        assert.throws(() => context.backtestService.getDetail(12345), (err) => err.status === 404);
    });

    describe('runInWorker', () => {
        const chartPath = path.join(FIXTURE_CHARTS, 'TEST_D1.csv');

        it('stops a backtest that runs longer than the timeout', async () => {
            const startedAt = Date.now();
            await assert.rejects(
                runInWorker({ type: 'backtest', strategyPath: path.join(FIXTURE_STRATEGIES, 'NeverFinishes.js'), chartPath, startingCapital: 1000 }, 300),
                /Backtest timed out after/,
            );
            assert.ok(Date.now() - startedAt < 5000, 'the worker is terminated instead of hanging');
        });

        it('rejects with the strategy error message', async () => {
            await assert.rejects(
                runInWorker({ type: 'backtest', strategyPath: path.join(FIXTURE_STRATEGIES, 'ThrowsOnRun.js'), chartPath, startingCapital: 1000 }, 30000),
                /boom from strategy/,
            );
        });
    });
});
