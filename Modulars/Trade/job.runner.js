'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_PATH = path.join(__dirname, 'trade.worker.js');
const JOB_LABELS = { backtest: 'Backtest', monteCarlo: 'Monte Carlo simulation' };

/**
 * Runs a job ({ type: 'backtest' | 'monteCarlo', ... }) in a worker thread, so heavy work
 * does not block the API. Rejects on error, on a crash or after `timeoutMs`.
 */
function runInWorker(job, timeoutMs) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(WORKER_PATH, { workerData: job });
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(value);
        };
        const timer = setTimeout(() => {
            worker.terminate();
            const label = JOB_LABELS[job.type] || 'Job';
            finish(reject, new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`));
        }, timeoutMs);

        worker.once('message', (message) => {
            if (message.ok) finish(resolve, message.result);
            else finish(reject, new Error(message.error));
        });
        worker.once('error', (err) => finish(reject, err));
        worker.once('exit', (code) => finish(reject, new Error(`Worker stopped unexpectedly (exit code ${code})`)));
    });
}

/** Counts running jobs so backtests and Monte Carlo simulations share one concurrency limit. */
class JobSlots {
    constructor(max) {
        this.max = max;
        this.running = 0;
    }

    /** Takes a slot. Returns false if all slots are in use. */
    tryAcquire() {
        if (this.running >= this.max) return false;
        this.running += 1;
        return true;
    }

    release() {
        this.running = Math.max(0, this.running - 1);
    }
}

module.exports = { runInWorker, JobSlots };
