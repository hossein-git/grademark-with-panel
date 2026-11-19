'use strict';

const { HttpError } = require('../Base/errors');
const { listChartFiles } = require('./chart.files');
const { listStrategyFiles, loadStrategyDefinition } = require('./strategy.files');
const { CatalogModel } = require('./catalog.model');

/**
 * Keeps the `strategies` and `charts` tables in sync with the Strategies folder and the Charts folder.
 * New files are added as active. Files that disappear (or, for strategies, fail to load) are marked
 * unavailable but keep their rows, so existing backtests still point to them.
 */
class CatalogService {
    constructor({ catalogModel, tradeConfig, logger = console }) {
        this.catalogModel = catalogModel;
        this.tradeConfig = tradeConfig;
        this.logger = logger;
    }

    sync() {
        this.syncStrategies();
        this.syncCharts();
    }

    syncStrategies() {
        const files = listStrategyFiles(this.tradeConfig.strategiesDir);
        for (const file of files) {
            try {
                const definition = loadStrategyDefinition(file.filePath);
                this.catalogModel.upsertStrategy({
                    key: file.key,
                    name: definition.name,
                    description: definition.description,
                    fileName: file.fileName,
                    isAvailable: true,
                });
            } catch (err) {
                this.logger.warn(`[trade] strategy ${file.fileName} could not be loaded: ${err.message}`);
                this.catalogModel.upsertStrategy({
                    key: file.key,
                    name: file.key,
                    description: null,
                    fileName: file.fileName,
                    isAvailable: false,
                    loadError: err.message,
                });
            }
        }
        this.catalogModel.markMissingStrategies(new Set(files.map((f) => f.key)));
    }

    syncCharts() {
        const { charts, skipped } = listChartFiles(this.tradeConfig.chartsDir);
        for (const fileName of skipped) {
            this.logger.warn(`[trade] ignoring chart file "${fileName}": expected <SYMBOL>_<TIMEFRAME>.csv, e.g. EURUSD_H4.csv`);
        }
        for (const chart of charts) {
            this.catalogModel.upsertChart(chart);
        }
        this.catalogModel.markMissingCharts(new Set(charts.map((c) => c.name)));
    }

    listStrategies() {
        return this.catalogModel.listStrategies().map(CatalogModel.toPublicStrategy);
    }

    listCharts() {
        return this.catalogModel.listCharts().map(CatalogModel.toPublicChart);
    }

    getStrategy(id) {
        const strategy = CatalogModel.toPublicStrategy(this.catalogModel.findStrategyById(id));
        if (!strategy) throw HttpError.notFound('Strategy not found');
        return strategy;
    }

    setStrategyActive(id, isActive) {
        if (!this.catalogModel.setStrategyActive(id, isActive)) throw HttpError.notFound('Strategy not found');
        return this.getStrategy(id);
    }

    setChartActive(id, isActive) {
        if (!this.catalogModel.setChartActive(id, isActive)) throw HttpError.notFound('Chart not found');
        return CatalogModel.toPublicChart(this.catalogModel.findChartById(id));
    }
}

module.exports = { CatalogService };
