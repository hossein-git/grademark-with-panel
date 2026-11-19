'use strict';

const { loadEngine } = require('./engine');

// Per-iteration values that are summarized (from the engine's analyze() of each sample).
const METRICS = Object.freeze({
    finalCapital: (a) => a.finalCapital,
    profitPct: (a) => a.profitPct,
    maxDrawdownPct: (a) => a.maxDrawdownPct,
    percentProfitable: (a) => a.percentProfitable,
    expectancy: (a) => a.expectency, // (sic) engine field name; undefined when trades have no stop loss
});
const PERCENTILES = Object.freeze([5, 25, 50, 75, 95]);
const MAX_CURVE_POINTS = 200;
const HISTOGRAM_BINS = 20;

/**
 * Turns a stored trade back into the engine's ITrade shape. Optional fields stored as null must
 * become undefined again: analyze() checks `riskPct !== undefined` and `rmultiple !== undefined`,
 * and a null would be treated as 0 and change the results.
 */
function toEngineTrade(trade) {
    const optional = (value) => (value === null || value === undefined ? undefined : value);
    if (!Number.isFinite(trade.growth)) {
        throw new Error('A trade is missing its growth value, so it cannot be simulated');
    }
    return {
        direction: trade.direction,
        entryTime: new Date(trade.entryTime),
        entryPrice: trade.entryPrice,
        exitTime: new Date(trade.exitTime),
        exitPrice: trade.exitPrice,
        profit: trade.profit,
        profitPct: trade.profitPct,
        growth: trade.growth,
        riskPct: optional(trade.riskPct),
        rmultiple: optional(trade.rmultiple),
        holdingPeriod: trade.holdingPeriod,
        exitReason: trade.exitReason,
        stopPrice: optional(trade.stopPrice),
        profitTarget: optional(trade.profitTarget),
    };
}

/** Percentile of an ascending array, with linear interpolation between neighbouring values. */
function percentile(sorted, p) {
    if (sorted.length === 0) return null;
    const rank = (p / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/** Summary statistics of the finite values. Every field is null when there are none. */
function describe(values) {
    const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
    const stats = { count: finite.length, mean: null, stdDev: null, min: null, max: null };
    for (const p of PERCENTILES) stats[`p${p}`] = null;
    if (finite.length === 0) return stats;

    const mean = finite.reduce((sum, v) => sum + v, 0) / finite.length;
    stats.mean = mean;
    stats.stdDev = Math.sqrt(finite.reduce((sum, v) => sum + (v - mean) ** 2, 0) / finite.length);
    stats.min = finite[0];
    stats.max = finite[finite.length - 1];
    for (const p of PERCENTILES) stats[`p${p}`] = percentile(finite, p);
    return stats;
}

/** Equal-width histogram of the finite values: [{ from, to, count }]. */
function histogram(values, bins = HISTOGRAM_BINS) {
    const finite = values.filter(Number.isFinite);
    if (finite.length === 0) return [];
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    if (min === max) return [{ from: min, to: max, count: finite.length }];

    const width = (max - min) / bins;
    const result = Array.from({ length: bins }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
    result[bins - 1].to = max;
    for (const value of finite) {
        result[Math.min(bins - 1, Math.floor((value - min) / width))].count += 1;
    }
    return result;
}

/** Trade numbers (0 = before the first trade) at which the equity bands are sampled, at most ~200 points. */
function curveSteps(numSamples) {
    if (numSamples <= MAX_CURVE_POINTS) {
        return Array.from({ length: numSamples + 1 }, (_, i) => i);
    }
    const steps = new Set();
    for (let i = 0; i <= MAX_CURVE_POINTS; i++) steps.add(Math.round((i * numSamples) / MAX_CURVE_POINTS));
    return [...steps].sort((a, b) => a - b);
}

/**
 * Runs a Monte Carlo simulation on a backtest's trades, using the engine's monteCarlo():
 * `numIterations` samples of `numSamples` trades, drawn with replacement. Every sample is analyzed
 * as if it were traded in that order, starting from `startingCapital`.
 * Pure apart from the engine; the same inputs (including `randomSeed`) always give the same result.
 *
 * @param job.trades  the backtest's trades (stored shape, see toEngineTrade)
 * @returns JSON-safe summary: { populationSize, numIterations, numSamples, randomSeed, startingCapital,
 *          probabilityOfProfit, metrics, equityBands, histograms }
 */
function runMonteCarlo({ trades, startingCapital, numIterations, numSamples, randomSeed }) {
    const engine = loadEngine();
    const population = trades.map(toEngineTrade);
    if (population.length === 0) {
        throw new Error('The backtest has no trades to simulate');
    }

    const samples = engine.monteCarlo(population, numIterations, numSamples, { randomSeed });

    const steps = curveSteps(numSamples);
    const values = Object.fromEntries(Object.keys(METRICS).map((name) => [name, new Array(samples.length)]));
    const equityAtStep = steps.map(() => new Float64Array(samples.length));
    let profitable = 0;

    samples.forEach((sample, i) => {
        const analysis = engine.analyze(startingCapital, sample);
        for (const [name, pick] of Object.entries(METRICS)) {
            values[name][i] = pick(analysis);
        }
        if (analysis.finalCapital > startingCapital) profitable += 1;

        const curve = engine.computeEquityCurve(startingCapital, sample);
        steps.forEach((step, j) => {
            equityAtStep[j][i] = curve[step];
        });
    });

    const equityBands = { steps };
    for (const p of PERCENTILES) equityBands[`p${p}`] = [];
    for (const column of equityAtStep) {
        const sorted = Array.from(column).sort((a, b) => a - b);
        for (const p of PERCENTILES) equityBands[`p${p}`].push(percentile(sorted, p));
    }

    return {
        populationSize: population.length,
        numIterations,
        numSamples,
        randomSeed,
        startingCapital,
        probabilityOfProfit: (profitable / samples.length) * 100,
        metrics: Object.fromEntries(Object.keys(METRICS).map((name) => [name, describe(values[name])])),
        equityBands,
        histograms: {
            profitPct: histogram(values.profitPct),
            maxDrawdownPct: histogram(values.maxDrawdownPct),
        },
    };
}

module.exports = { runMonteCarlo, toEngineTrade, percentile, describe, histogram, curveSteps };
