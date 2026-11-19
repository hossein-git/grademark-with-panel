'use strict';

const { loadEngine } = require('./engine');
const { loadChartDataFrame } = require('./chart.files');
const { loadStrategyDefinition } = require('./strategy.files');

/** JSON and SQLite cannot represent NaN/Infinity well, so they are stored as null. */
function finiteOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Non-finite numbers become null. Undefined also becomes null: the engine leaves some fields
 * undefined (e.g. maxRiskPct without a stop loss), and JSON would otherwise drop those keys.
 */
function sanitizeNumbers(obj) {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        out[key] = typeof value === 'number' || value === undefined ? finiteOrNull(value) : value;
    }
    return out;
}

function toIso(date) {
    return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
}

function serializeTrade(trade) {
    return {
        direction: trade.direction,
        entryTime: toIso(trade.entryTime),
        entryPrice: trade.entryPrice,
        exitTime: toIso(trade.exitTime),
        exitPrice: trade.exitPrice,
        profit: finiteOrNull(trade.profit),
        profitPct: finiteOrNull(trade.profitPct),
        growth: finiteOrNull(trade.growth),
        riskPct: finiteOrNull(trade.riskPct),
        rmultiple: finiteOrNull(trade.rmultiple),
        holdingPeriod: trade.holdingPeriod,
        exitReason: trade.exitReason,
        stopPrice: finiteOrNull(trade.stopPrice),
        profitTarget: finiteOrNull(trade.profitTarget),
    };
}

/**
 * Runs one backtest. Pure apart from reading the two files; it does not touch the database.
 *
 * @param job.strategyPath     absolute path of the strategy file
 * @param job.chartPath        absolute path of the chart CSV
 * @param job.startingCapital  capital used for the analysis, equity curve and drawdown
 * @returns plain JSON-safe result: { barCount, firstBarTime, lastBarTime, parameters, analysis, trades, equityCurve, drawdown }
 */
function runBacktest({ strategyPath, chartPath, startingCapital }) {
    const engine = loadEngine();
    const { strategy } = loadStrategyDefinition(strategyPath);
    const bars = loadChartDataFrame(chartPath);

    if (bars.none()) {
        throw new Error('The chart has no bars');
    }

    const trades = engine.backtest(strategy, bars);
    const analysis = engine.analyze(startingCapital, trades);
    const equity = engine.computeEquityCurve(startingCapital, trades);
    const drawdown = engine.computeDrawdown(startingCapital, trades);

    const firstBarTime = toIso(bars.first().time);
    // Equity/drawdown have one point before the first trade plus one after each trade,
    // so each point gets the chart start time or the exit time of that trade.
    const pointTimes = [firstBarTime, ...trades.map((t) => toIso(t.exitTime))];
    const timeline = (values) => values.map((value, i) => ({ time: pointTimes[i], value: finiteOrNull(value) }));

    return {
        barCount: bars.count(),
        firstBarTime,
        lastBarTime: toIso(bars.last().time),
        parameters: strategy.parameters === undefined ? null : JSON.parse(JSON.stringify(strategy.parameters)),
        analysis: sanitizeNumbers(analysis),
        trades: trades.map(serializeTrade),
        equityCurve: timeline(equity),
        drawdown: timeline(drawdown),
    };
}

module.exports = { runBacktest };
