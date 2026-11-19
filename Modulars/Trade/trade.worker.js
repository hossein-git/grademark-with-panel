'use strict';

// Worker thread entry: runs one job so long work does not block the API.
// Receives the job in `workerData` and posts back { ok: true, result } or { ok: false, error }.
const { parentPort, workerData } = require('node:worker_threads');
const { runBacktest } = require('./backtest.runner');
const { runMonteCarlo } = require('./monte-carlo.runner');

const handlers = {
    backtest: runBacktest,
    monteCarlo: runMonteCarlo,
};

try {
    const handler = handlers[workerData.type];
    if (!handler) throw new Error(`Unknown job type: ${workerData.type}`);
    parentPort.postMessage({ ok: true, result: handler(workerData) });
} catch (err) {
    parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
}
