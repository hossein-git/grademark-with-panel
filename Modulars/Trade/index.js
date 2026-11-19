'use strict';

const migrations = require('./trade.migrations');
const { CatalogModel } = require('./catalog.model');
const { BacktestModel } = require('./backtest.model');
const { CatalogService } = require('./catalog.service');
const { BacktestService } = require('./backtest.service');
const { MonteCarloModel } = require('./monte-carlo.model');
const { MonteCarloService } = require('./monte-carlo.service');
const { JobSlots } = require('./job.runner');
const { createTradeRouter } = require('./trade.routes');

/** Trade module: strategies, charts, backtests and Monte Carlo simulations. Depends on the User module (users table, requireAuth). */
module.exports = {
    name: 'Trade',

    migrations,

    createServices({ db, config, logger }) {
        const catalogModel = new CatalogModel(db);
        const backtestModel = new BacktestModel(db);
        const catalogService = new CatalogService({ catalogModel, tradeConfig: config.trade, logger });
        catalogService.sync();
        // Backtests and Monte Carlo simulations share one limit on jobs running at the same time.
        const jobSlots = new JobSlots(config.trade.maxConcurrentBacktests);
        const backtestService = new BacktestService({ backtestModel, catalogModel, tradeConfig: config.trade, logger, jobSlots });
        const monteCarloService = new MonteCarloService({
            monteCarloModel: new MonteCarloModel(db),
            backtestModel,
            tradeConfig: config.trade,
            logger,
            jobSlots,
        });
        return { catalogModel, catalogService, backtestService, monteCarloService };
    },

    register(app, context) {
        app.use('/api/trade', context.requireAuth, createTradeRouter(context));
    },

    // Called by server.js only (not by CLI scripts, which may run while the server is busy).
    onServerStart(context) {
        context.backtestService.failInterruptedRuns();
        context.monteCarloService.failInterruptedRuns();
    },
};
