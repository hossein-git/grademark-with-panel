'use strict';

const crypto = require('node:crypto');
const { HttpError } = require('../Base/errors');
const { MonteCarloModel } = require('./monte-carlo.model');
const { runInWorker, JobSlots } = require('./job.runner');

const { MAX_SAMPLES } = require('./trade.validation');

const DEFAULT_ITERATIONS = 1000;
// iterations x samples above this would take too long and use too much memory (10M takes ~5 s and ~250 MB).
const MAX_TOTAL_TRADES = 10000000;

class MonteCarloService {
    /**
     * @param deps.runJob    function(job) => Promise<result>; defaults to a worker thread
     * @param deps.jobSlots  concurrency limit shared with backtests
     */
    constructor({ monteCarloModel, backtestModel, tradeConfig, logger = console, runJob, jobSlots, now = () => new Date() }) {
        this.monteCarloModel = monteCarloModel;
        this.backtestModel = backtestModel;
        this.logger = logger;
        this.now = now;
        this.runJob = runJob || ((job) => runInWorker(job, tradeConfig.backtestTimeoutSeconds * 1000));
        this.jobSlots = jobSlots || new JobSlots(tradeConfig.maxConcurrentBacktests);
    }

    /**
     * Starts a Monte Carlo simulation for a completed backtest, in the background.
     * Each backtest can have one simulation; only a failed one can be run again.
     *
     * @param input.numIterations  number of simulated trade sequences (default 1000)
     * @param input.numSamples     trades per sequence (default: the backtest's trade count, at most 10000)
     * @param input.randomSeed     seed for reproducible results (default: random, stored with the result)
     * @returns { monteCarlo, done }: the new simulation and a promise for its final state (never rejects)
     * @throws HttpError 400 too much work requested, 404 unknown backtest,
     *         409 not completed / no trades / already simulated, 429 too many running
     */
    start({ backtestId, numIterations = DEFAULT_ITERATIONS, numSamples, randomSeed, userId = null }) {
        const backtest = this.backtestModel.findById(backtestId);
        if (!backtest) throw HttpError.notFound('Backtest not found');
        if (backtest.status !== 'completed') {
            throw HttpError.conflict('Monte Carlo simulation needs a completed backtest');
        }
        if (!backtest.trade_count) {
            throw HttpError.conflict('The backtest has no trades to simulate');
        }

        const existing = this.monteCarloModel.findByBacktestId(backtestId);
        if (existing && existing.status !== 'failed') {
            throw HttpError.conflict(existing.status === 'running'
                ? 'A Monte Carlo simulation is already running for this backtest'
                : 'This backtest already has a Monte Carlo simulation');
        }

        const samples = numSamples === undefined ? Math.min(backtest.trade_count, MAX_SAMPLES) : numSamples;
        const seed = randomSeed === undefined ? crypto.randomInt(0, 2 ** 31 - 1) : randomSeed;
        if (numIterations * samples > MAX_TOTAL_TRADES) {
            throw HttpError.badRequest('Validation failed', {
                numIterations: `numIterations x numSamples must be at most ${MAX_TOTAL_TRADES.toLocaleString('en-US')} (got ${(numIterations * samples).toLocaleString('en-US')})`,
            });
        }

        if (!this.jobSlots.tryAcquire()) {
            throw new HttpError(429, 'Too many backtests or simulations are running. Please wait for one to finish.');
        }

        const startedAt = this.now();
        let created;
        try {
            created = this.monteCarloModel.createOrRestart({
                backtestId,
                userId,
                numIterations,
                numSamples: samples,
                randomSeed: seed,
                startingCapital: backtest.starting_capital,
                startedAt,
            });
        } catch (err) {
            this.jobSlots.release();
            throw err;
        }
        if (!created) {
            this.jobSlots.release();
            throw HttpError.conflict('This backtest already has a Monte Carlo simulation');
        }

        const job = {
            type: 'monteCarlo',
            trades: this.backtestModel.listTrades(backtestId).map((t) => ({
                direction: t.direction,
                entryTime: t.entry_time,
                entryPrice: t.entry_price,
                exitTime: t.exit_time,
                exitPrice: t.exit_price,
                profit: t.profit,
                profitPct: t.profit_pct,
                growth: t.growth,
                riskPct: t.risk_pct,
                rmultiple: t.rmultiple,
                holdingPeriod: t.holding_period,
                exitReason: t.exit_reason,
                stopPrice: t.stop_price,
                profitTarget: t.profit_target,
            })),
            startingCapital: backtest.starting_capital,
            numIterations,
            numSamples: samples,
            randomSeed: seed,
        };

        const done = Promise.resolve()
            .then(() => this.runJob(job))
            .then(
                (result) => {
                    const finishedAt = this.now();
                    this.monteCarloModel.complete(backtestId, result, finishedAt, finishedAt - startedAt);
                },
                (err) => {
                    const finishedAt = this.now();
                    this.monteCarloModel.fail(backtestId, err && err.message ? err.message : String(err), finishedAt, finishedAt - startedAt);
                },
            )
            .catch((err) => {
                this.logger.error(`[trade] could not save the Monte Carlo simulation of backtest #${backtestId}`, err);
                try {
                    this.monteCarloModel.fail(backtestId, `Could not save the result: ${err.message}`, this.now(), null);
                } catch {
                    // Nothing more we can do.
                }
            })
            .finally(() => {
                this.jobSlots.release();
            })
            .then(() => {
                try {
                    return this.get(backtestId);
                } catch {
                    return null;
                }
            });

        return { monteCarlo: this.get(backtestId), done };
    }

    /** The simulation of a backtest, or null if it has none. */
    get(backtestId) {
        return MonteCarloModel.toPublic(this.monteCarloModel.findByBacktestId(backtestId));
    }

    /** Marks simulations left 'running' by a previous server process as failed. Call once at server start. */
    failInterruptedRuns() {
        const count = this.monteCarloModel.failAllRunning('Interrupted: the server stopped before the simulation finished');
        if (count > 0) this.logger.warn(`[trade] marked ${count} interrupted Monte Carlo simulation(s) as failed`);
        return count;
    }
}

module.exports = { MonteCarloService, DEFAULT_ITERATIONS, MAX_TOTAL_TRADES };
