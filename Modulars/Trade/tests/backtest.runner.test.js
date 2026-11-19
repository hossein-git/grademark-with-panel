'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runBacktest } = require('../backtest.runner');
const { FIXTURE_CHARTS, FIXTURE_STRATEGIES } = require('./helpers');

describe('Trade/backtest runner', () => {
    describe('HoldThreeBars on TEST_D1 (20 rising bars, then 20 falling bars)', () => {
        let result;
        before(() => {
            result = runBacktest({
                strategyPath: path.join(FIXTURE_STRATEGIES, 'HoldThreeBars.js'),
                chartPath: path.join(FIXTURE_CHARTS, 'TEST_D1.csv'),
                startingCapital: 1000,
            });
        });

        it('enters on the next bar open and exits three bars later, every six bars', () => {
            assert.equal(result.trades.length, 7);
            assert.deepEqual(result.trades[0], {
                direction: 'long',
                entryTime: '2024-01-02T00:00:00.000Z',
                entryPrice: 101,
                exitTime: '2024-01-06T00:00:00.000Z',
                exitPrice: 105,
                profit: 4,
                profitPct: (4 / 101) * 100,
                growth: 105 / 101,
                riskPct: null, // no stop loss -> no risk
                rmultiple: null,
                holdingPeriod: 3,
                exitReason: 'exit-rule',
                stopPrice: null,
                profitTarget: null,
            });
            // The last position is still open at the end of the data and gets closed at the last close.
            assert.equal(result.trades[6].exitReason, 'finalize');
            assert.equal(result.trades[6].exitPrice, 100.5);
        });

        it('wins on the rising half and loses on the falling half', () => {
            assert.deepEqual(result.trades.map((t) => t.profit > 0), [true, true, true, false, false, false, false]);
            assert.equal(result.analysis.numWinningTrades, 3);
            assert.equal(result.analysis.numLosingTrades, 4);
        });

        it('returns a timestamped equity curve and drawdown (start + one point per trade)', () => {
            assert.equal(result.equityCurve.length, 8);
            assert.deepEqual(result.equityCurve[0], { time: '2024-01-01T00:00:00.000Z', value: 1000 });
            assert.deepEqual(result.equityCurve.slice(1).map((p) => p.time), result.trades.map((t) => t.exitTime));
            assert.equal(result.equityCurve[7].value, result.analysis.finalCapital);
            assert.equal(result.drawdown.length, 8);
            assert.ok(result.drawdown.every((p) => p.value <= 0));
        });

        it('includes chart info and the strategy parameters', () => {
            assert.equal(result.barCount, 40);
            assert.equal(result.firstBarTime, '2024-01-01T00:00:00.000Z');
            assert.equal(result.lastBarTime, '2024-02-09T00:00:00.000Z');
            assert.deepEqual(result.parameters, { holdBars: 3 });
        });

        it('is JSON-safe (survives a round trip unchanged)', () => {
            assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
        });
    });

    it('works on intraday and comma-separated charts', () => {
        for (const chart of ['TEST_H4.csv', 'OTHER_M15.csv']) {
            const result = runBacktest({
                strategyPath: path.join(FIXTURE_STRATEGIES, 'HoldThreeBars.js'),
                chartPath: path.join(FIXTURE_CHARTS, chart),
                startingCapital: 1000,
            });
            assert.ok(result.trades.length > 0, chart);
        }
    });

    it('stores null parameters when the strategy has none, and NaN/Infinity as null', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-runner-'));
        try {
            // No trades at all: some ratios in the analysis are 0/0.
            const file = path.join(dir, 'NeverTrades.js');
            fs.writeFileSync(file, 'module.exports = { strategy: { entryRule() {} } };');
            const result = runBacktest({ strategyPath: file, chartPath: path.join(FIXTURE_CHARTS, 'TEST_D1.csv'), startingCapital: 1000 });
            assert.equal(result.parameters, null);
            assert.equal(result.trades.length, 0);
            assert.deepEqual(result.equityCurve, [{ time: '2024-01-01T00:00:00.000Z', value: 1000 }]);
            for (const [key, value] of Object.entries(result.analysis)) {
                assert.ok(value === null || Number.isFinite(value), `${key} = ${value}`);
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('propagates errors from the strategy and from invalid files', () => {
        const chartPath = path.join(FIXTURE_CHARTS, 'TEST_D1.csv');
        assert.throws(
            () => runBacktest({ strategyPath: path.join(FIXTURE_STRATEGIES, 'ThrowsOnRun.js'), chartPath, startingCapital: 1000 }),
            /boom from strategy/,
        );
        assert.throws(
            () => runBacktest({ strategyPath: path.join(FIXTURE_STRATEGIES, 'Broken.js'), chartPath, startingCapital: 1000 }),
            /Missing "strategy" object/,
        );
        assert.throws(
            () => runBacktest({ strategyPath: path.join(FIXTURE_STRATEGIES, 'HoldThreeBars.js'), chartPath: '/nope/X_D1.csv', startingCapital: 1000 }),
            /ENOENT/,
        );
    });

    describe('empty chart', () => {
        let dir;
        before(() => {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-runner-'));
        });
        after(() => fs.rmSync(dir, { recursive: true, force: true }));

        it('fails with a clear message', () => {
            const chartPath = path.join(dir, 'EMPTY_D1.csv');
            fs.writeFileSync(chartPath, 'date,open,high,low,close\n');
            assert.throws(
                () => runBacktest({ strategyPath: path.join(FIXTURE_STRATEGIES, 'HoldThreeBars.js'), chartPath, startingCapital: 1000 }),
                /The chart has no bars/,
            );
        });
    });
});
