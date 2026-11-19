'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runMonteCarlo, toEngineTrade, percentile, describe: describeValues, histogram, curveSteps } = require('../monte-carlo.runner');
const { loadEngine } = require('../engine');

/** A stored trade (the shape saved in backtest_trades) with the given growth. */
function trade(growth, overrides = {}) {
    return {
        direction: 'long',
        entryTime: '2024-01-01T00:00:00.000Z',
        entryPrice: 100,
        exitTime: '2024-01-02T00:00:00.000Z',
        exitPrice: 100 * growth,
        profit: 100 * growth - 100,
        profitPct: (growth - 1) * 100,
        growth,
        riskPct: null,
        rmultiple: null,
        holdingPeriod: 1,
        exitReason: 'exit-rule',
        stopPrice: null,
        profitTarget: null,
        ...overrides,
    };
}

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

describe('Trade/Monte Carlo runner', () => {
    describe('helpers', () => {
        it('percentile interpolates linearly between values', () => {
            const sorted = [10, 20, 30, 40, 50];
            assert.equal(percentile(sorted, 0), 10);
            assert.equal(percentile(sorted, 50), 30);
            assert.equal(percentile(sorted, 100), 50);
            assert.equal(percentile(sorted, 25), 20);
            close(percentile(sorted, 5), 12, 'p5'); // rank 0.2 -> 10 + 0.2 * 10
            assert.equal(percentile([7], 95), 7);
            assert.equal(percentile([], 50), null);
        });

        it('describe returns count, mean, population std dev, min/max and percentiles of the finite values', () => {
            const stats = describeValues([4, 2, NaN, 8, 6, undefined, Infinity]);
            assert.equal(stats.count, 4);
            assert.equal(stats.mean, 5);
            close(stats.stdDev, Math.sqrt(5), 'stdDev'); // ((1+9+9+1)/4) = 5
            assert.deepEqual([stats.min, stats.p50, stats.max], [2, 5, 8]);
            assert.deepEqual(describeValues([undefined, NaN]), {
                count: 0, mean: null, stdDev: null, min: null, max: null, p5: null, p25: null, p50: null, p75: null, p95: null,
            });
        });

        it('histogram makes equal-width bins that include the maximum', () => {
            const bins = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
            assert.equal(bins.length, 5);
            assert.deepEqual(bins.map((b) => b.count), [2, 2, 2, 2, 3]);
            assert.deepEqual([bins[0].from, bins[4].to], [0, 10]);
            assert.deepEqual(histogram([3, 3, 3]), [{ from: 3, to: 3, count: 3 }]);
            assert.deepEqual(histogram([]), []);
        });

        it('curveSteps keeps every trade up to 200 and spreads 201 points above that', () => {
            assert.deepEqual(curveSteps(3), [0, 1, 2, 3]);
            assert.equal(curveSteps(200).length, 201);
            const steps = curveSteps(1000);
            assert.equal(steps.length, 201);
            assert.deepEqual([steps[0], steps[1], steps[200]], [0, 5, 1000]);
        });

        it('toEngineTrade turns stored nulls back into undefined and times into Dates', () => {
            const converted = toEngineTrade(trade(1.1, { riskPct: 2, rmultiple: null, stopPrice: null }));
            assert.equal(converted.riskPct, 2);
            assert.equal(converted.rmultiple, undefined);
            assert.equal(converted.stopPrice, undefined);
            assert.equal(converted.profitTarget, undefined);
            assert.ok(converted.entryTime instanceof Date);
            assert.throws(() => toEngineTrade(trade(1.1, { growth: null })), /missing its growth value/);
        });
    });

    it('with a single trade every iteration is identical', () => {
        const result = runMonteCarlo({ trades: [trade(1.1)], startingCapital: 1000, numIterations: 50, numSamples: 3, randomSeed: 1 });
        const expectedFinal = 1000 * 1.1 ** 3;

        assert.deepEqual(
            { populationSize: result.populationSize, numIterations: result.numIterations, numSamples: result.numSamples, randomSeed: result.randomSeed },
            { populationSize: 1, numIterations: 50, numSamples: 3, randomSeed: 1 },
        );
        const final = result.metrics.finalCapital;
        assert.equal(final.count, 50);
        for (const key of ['mean', 'min', 'p5', 'p50', 'p95', 'max']) close(final[key], expectedFinal, key);
        assert.equal(final.stdDev, 0);
        close(result.metrics.profitPct.p50, (1.1 ** 3 - 1) * 100, 'profitPct');
        assert.equal(result.metrics.maxDrawdownPct.max, 0);
        assert.equal(result.metrics.percentProfitable.p50, 100);
        assert.equal(result.probabilityOfProfit, 100);
        assert.equal(result.histograms.profitPct.length, 1);

        assert.deepEqual(result.equityBands.steps, [0, 1, 2, 3]);
        [1000, 1100, 1210, 1331].forEach((value, i) => {
            close(result.equityBands.p5[i], value, `p5[${i}]`);
            close(result.equityBands.p95[i], value, `p95[${i}]`);
        });
    });

    it('matches the engine\'s own samples (one win of +10% and one loss of -10%, one trade per sample)', () => {
        const trades = [trade(1.1), trade(0.9)];
        const result = runMonteCarlo({ trades, startingCapital: 1000, numIterations: 1000, numSamples: 1, randomSeed: 7 });

        // Independent count from the engine's monteCarlo() with the same seed.
        const samples = loadEngine().monteCarlo(trades.map(toEngineTrade), 1000, 1, { randomSeed: 7 });
        const wins = samples.filter((s) => s[0].growth > 1).length;

        close(result.probabilityOfProfit, (wins / 1000) * 100, 'probabilityOfProfit');
        assert.ok(wins > 400 && wins < 600, `roughly half should win, got ${wins}`);
        close(result.metrics.finalCapital.min, 900, 'min');
        close(result.metrics.finalCapital.max, 1100, 'max');
        close(result.metrics.finalCapital.mean, (wins * 1100 + (1000 - wins) * 900) / 1000, 'mean');
        close(result.metrics.maxDrawdownPct.min, -10, 'worst drawdown');
        assert.equal(result.histograms.profitPct.reduce((sum, b) => sum + b.count, 0), 1000);
    });

    it('is reproducible with the same seed and changes with another seed', () => {
        const trades = [trade(1.05), trade(0.97), trade(1.02), trade(0.99)];
        const run = (randomSeed) => runMonteCarlo({ trades, startingCapital: 1000, numIterations: 200, numSamples: 10, randomSeed });
        assert.deepEqual(run(123), run(123));
        assert.notDeepEqual(run(123).metrics.finalCapital, run(124).metrics.finalCapital);
    });

    it('leaves expectancy empty when trades have no R-multiple (no stop loss), instead of treating null as 0', () => {
        const noStop = runMonteCarlo({ trades: [trade(1.1), trade(0.95)], startingCapital: 1000, numIterations: 20, numSamples: 2, randomSeed: 3 });
        assert.equal(noStop.metrics.expectancy.count, 0);
        assert.equal(noStop.metrics.expectancy.p50, null);

        const withStop = runMonteCarlo({
            trades: [trade(1.1, { rmultiple: 2, riskPct: 5 }), trade(0.95, { rmultiple: -1, riskPct: 5 })],
            startingCapital: 1000, numIterations: 20, numSamples: 2, randomSeed: 3,
        });
        assert.equal(withStop.metrics.expectancy.count, 20);
        assert.ok(withStop.metrics.expectancy.min >= -1 && withStop.metrics.expectancy.max <= 2);
    });

    it('samples the equity bands at most ~200 points for long sequences, with ordered percentiles', () => {
        const trades = [trade(1.01), trade(0.995), trade(1.003)];
        const result = runMonteCarlo({ trades, startingCapital: 1000, numIterations: 100, numSamples: 500, randomSeed: 5 });
        const { steps, p5, p25, p50, p75, p95 } = result.equityBands;
        assert.equal(steps.length, 201);
        assert.deepEqual([steps[0], steps[200]], [0, 500]);
        for (const band of [p5, p25, p50, p75, p95]) assert.equal(band.length, 201);
        for (let i = 0; i < steps.length; i++) {
            assert.ok(p5[i] <= p25[i] && p25[i] <= p50[i] && p50[i] <= p75[i] && p75[i] <= p95[i], `bands ordered at ${i}`);
        }
        close(p50[0], 1000, 'every sequence starts at the starting capital');
        close(p95[200], result.metrics.finalCapital.p95, 'last band point = final capital percentile');
    });

    it('is JSON-safe', () => {
        const result = runMonteCarlo({ trades: [trade(1.1), trade(0.9)], startingCapital: 1000, numIterations: 30, numSamples: 4, randomSeed: 1 });
        assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    });

    it('rejects an empty trade list', () => {
        assert.throws(() => runMonteCarlo({ trades: [], startingCapital: 1000, numIterations: 10, numSamples: 1, randomSeed: 1 }), /no trades to simulate/);
    });
});
