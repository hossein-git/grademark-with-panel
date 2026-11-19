'use strict';

const express = require('express');
const { HttpError } = require('../Base/errors');
const {
    parseId,
    validateStartBacktest,
    validateSetActive,
    validateBacktestFilters,
    validateStartMonteCarlo,
} = require('./trade.validation');

/**
 * Routes mounted at /api/trade (all require authentication):
 *   GET   /strategies                  strategies with backtest counts (re-syncs the Strategies folder)
 *   PATCH /strategies/:id              { isActive } activate or deactivate a strategy
 *   GET   /strategies/:id/backtests    ?symbol=&timeframe=  -> { strategy, backtests, filterOptions }
 *   GET   /charts                      charts (re-syncs the Charts folder)
 *   PATCH /charts/:id                  { isActive } activate or deactivate a chart
 *   POST  /backtests                   { strategyId, chartId, startingCapital? } -> 202 { backtest } (runs in the background)
 *   GET   /backtests/:id               full result: analysis, equity curve, drawdown, trades, monteCarlo (or null)
 *   POST  /backtests/:id/monte-carlo   { numIterations?, numSamples?, randomSeed? } -> 202 { monteCarlo } (runs in the background)
 *   GET   /backtests/:id/monte-carlo   -> { monteCarlo }, 404 if the backtest has no simulation
 */
function createTradeRouter({ catalogService, backtestService, monteCarloService }) {
    const router = express.Router();

    router.get('/strategies', (req, res) => {
        catalogService.syncStrategies();
        res.json({ strategies: catalogService.listStrategies() });
    });

    router.patch('/strategies/:id', (req, res) => {
        const { isActive } = validateSetActive(req.body);
        res.json({ strategy: catalogService.setStrategyActive(parseId(req.params.id, 'Strategy'), isActive) });
    });

    router.get('/strategies/:id/backtests', (req, res) => {
        const strategy = catalogService.getStrategy(parseId(req.params.id, 'Strategy'));
        const filters = validateBacktestFilters(req.query);
        res.json({ strategy, ...backtestService.listForStrategy(strategy.id, filters) });
    });

    router.get('/charts', (req, res) => {
        catalogService.syncCharts();
        res.json({ charts: catalogService.listCharts() });
    });

    router.patch('/charts/:id', (req, res) => {
        const { isActive } = validateSetActive(req.body);
        res.json({ chart: catalogService.setChartActive(parseId(req.params.id, 'Chart'), isActive) });
    });

    router.post('/backtests', (req, res) => {
        const input = validateStartBacktest(req.body);
        const { backtest } = backtestService.start({ ...input, userId: req.auth.user.id });
        res.status(202).location(`${req.baseUrl}/backtests/${backtest.id}`).json({ backtest });
    });

    router.get('/backtests/:id', (req, res) => {
        const id = parseId(req.params.id, 'Backtest');
        res.json({ backtest: { ...backtestService.getDetail(id), monteCarlo: monteCarloService.get(id) } });
    });

    router.post('/backtests/:id/monte-carlo', (req, res) => {
        const backtestId = parseId(req.params.id, 'Backtest');
        const input = validateStartMonteCarlo(req.body);
        const { monteCarlo } = monteCarloService.start({ ...input, backtestId, userId: req.auth.user.id });
        res.status(202).location(`${req.baseUrl}/backtests/${backtestId}/monte-carlo`).json({ monteCarlo });
    });

    router.get('/backtests/:id/monte-carlo', (req, res) => {
        const backtestId = parseId(req.params.id, 'Backtest');
        backtestService.getDetail(backtestId); // 404 for an unknown backtest
        const monteCarlo = monteCarloService.get(backtestId);
        if (!monteCarlo) throw HttpError.notFound('This backtest has no Monte Carlo simulation yet');
        res.json({ monteCarlo });
    });

    return router;
}

module.exports = { createTradeRouter };
