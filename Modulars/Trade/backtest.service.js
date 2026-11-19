'use strict';

const path = require('node:path');
const { HttpError } = require('../Base/errors');
const { BacktestModel } = require('./backtest.model');
const { runInWorker, JobSlots } = require('./job.runner');

class BacktestService {
    /**
     * @param deps.runJob    function(job) => Promise<result>; defaults to running in a worker thread.
     *                       Tests can replace it to control timing.
     * @param deps.jobSlots  concurrency limit shared with Monte Carlo simulations
     */
    constructor({ backtestModel, catalogModel, tradeConfig, logger = console, runJob, jobSlots, now = () => new Date() }) {
        this.backtestModel = backtestModel;
        this.catalogModel = catalogModel;
        this.tradeConfig = tradeConfig;
        this.logger = logger;
        this.now = now;
        this.runJob = runJob || ((job) => runInWorker(job, tradeConfig.backtestTimeoutSeconds * 1000));
        this.jobSlots = jobSlots || new JobSlots(tradeConfig.maxConcurrentBacktests);
    }

    /**
     * Checks the input, creates a 'running' backtest and starts it in the background.
     *
     * @returns { backtest, done }: the new backtest summary, and a promise that resolves with the
     *          final summary once it has completed or failed (it never rejects)
     * @throws HttpError 404 unknown strategy/chart, 409 inactive/unavailable, 429 too many running
     */
    start({ strategyId, chartId, startingCapital, userId = null }) {
        const strategy = this.catalogModel.findStrategyById(strategyId);
        if (!strategy) throw HttpError.notFound('Strategy not found');
        const chart = this.catalogModel.findChartById(chartId);
        if (!chart) throw HttpError.notFound('Chart not found');

        if (strategy.is_active !== 1) throw HttpError.conflict(`Strategy "${strategy.name}" is deactivated`);
        if (strategy.is_available !== 1) {
            throw HttpError.conflict(`Strategy "${strategy.name}" is unavailable: ${strategy.load_error || 'file not found'}`);
        }
        if (chart.is_active !== 1) throw HttpError.conflict(`Chart "${chart.name}" is deactivated`);
        if (chart.is_available !== 1) throw HttpError.conflict(`Chart "${chart.name}" is unavailable: file not found`);

        if (!this.jobSlots.tryAcquire()) {
            throw new HttpError(429, 'Too many backtests or simulations are running. Please wait for one to finish.');
        }

        const startedAt = this.now();
        let id;
        try {
            id = this.backtestModel.createRunning({ strategyId, chartId, userId, startingCapital, startedAt });
        } catch (err) {
            this.jobSlots.release();
            throw err;
        }

        const job = {
            type: 'backtest',
            strategyPath: path.join(this.tradeConfig.strategiesDir, strategy.file_name),
            chartPath: path.join(this.tradeConfig.chartsDir, chart.file_name),
            startingCapital,
        };

        const done = Promise.resolve()
            .then(() => this.runJob(job))
            .then(
                (result) => {
                    const finishedAt = this.now();
                    this.backtestModel.complete(id, result, finishedAt, finishedAt - startedAt);
                },
                (err) => {
                    const finishedAt = this.now();
                    this.backtestModel.fail(id, err && err.message ? err.message : String(err), finishedAt, finishedAt - startedAt);
                },
            )
            .catch((err) => {
                // Saving the result failed (e.g. the database is closed). Record it if possible, never throw.
                this.logger.error(`[trade] could not save backtest #${id}`, err);
                try {
                    this.backtestModel.fail(id, `Could not save the result: ${err.message}`, this.now(), null);
                } catch {
                    // Nothing more we can do.
                }
            })
            .finally(() => {
                this.jobSlots.release();
            })
            .then(() => {
                try {
                    return this.getSummary(id);
                } catch {
                    return null;
                }
            });

        return { backtest: this.getSummary(id), done };
    }

    /** Marks backtests left 'running' by a previous server process as failed. Call once at server start. */
    failInterruptedRuns() {
        const count = this.backtestModel.failAllRunning('Interrupted: the server stopped before the backtest finished');
        if (count > 0) this.logger.warn(`[trade] marked ${count} interrupted backtest(s) as failed`);
        return count;
    }

    getSummary(id) {
        return BacktestModel.toSummary(this.backtestModel.findById(id));
    }

    getDetail(id) {
        const row = this.backtestModel.findById(id);
        if (!row) throw HttpError.notFound('Backtest not found');
        return BacktestModel.toDetail(row, row.status === 'completed' ? this.backtestModel.listTrades(id) : []);
    }

    listForStrategy(strategyId, filters) {
        return {
            backtests: this.backtestModel.listForStrategy(strategyId, filters).map(BacktestModel.toSummary),
            filterOptions: this.backtestModel.filterOptions(strategyId),
        };
    }
}

module.exports = { BacktestService };
