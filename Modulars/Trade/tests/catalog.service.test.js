'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { copyFixtures, createTradeApp, recordingLogger } = require('./helpers');

describe('Trade/CatalogService (sync with the Charts and Strategies folders)', () => {
    let fixtures;
    let context;
    let logger;

    const strategy = (key) => context.catalogService.listStrategies().find((s) => s.key === key);
    const chart = (name) => context.catalogService.listCharts().find((c) => c.name === name);

    beforeEach(() => {
        fixtures = copyFixtures();
        logger = recordingLogger();
        ({ context } = createTradeApp({ chartsDir: fixtures.chartsDir, strategiesDir: fixtures.strategiesDir, logger }));
    });

    afterEach(() => fixtures.cleanup());

    it('adds every strategy file at startup, active by default', () => {
        const strategies = context.catalogService.listStrategies();
        assert.deepEqual(strategies.map((s) => s.key), ['Broken', 'HoldThreeBars', 'NeverFinishes', 'ThrowsOnRun']);

        const hold = strategy('HoldThreeBars');
        assert.equal(hold.name, 'Hold three bars');
        assert.equal(hold.fileName, 'HoldThreeBars.js');
        assert.equal(hold.isActive, true);
        assert.equal(hold.isAvailable, true);
        assert.equal(hold.loadError, null);
        assert.equal(hold.backtestCount, 0);
        assert.equal(hold.lastRunAt, null);
    });

    it('records a strategy that fails to load as unavailable, with the error', () => {
        const broken = strategy('Broken');
        assert.equal(broken.isAvailable, false);
        assert.match(broken.loadError, /Missing "strategy" object/);
        assert.ok(logger.entries.some((e) => e.level === 'warn' && e.message.includes('Broken.js')));
    });

    it('adds charts with symbol and timeframe, sorted by symbol then timeframe, and warns about bad names', () => {
        const charts = context.catalogService.listCharts();
        assert.deepEqual(charts.map((c) => c.name), ['OTHER_M15', 'TEST_H4', 'TEST_D1']);
        assert.deepEqual(
            { symbol: charts[1].symbol, timeframe: charts[1].timeframe, isActive: charts[1].isActive, isAvailable: charts[1].isAvailable },
            { symbol: 'TEST', timeframe: 'H4', isActive: true, isAvailable: true },
        );
        assert.ok(logger.entries.some((e) => e.level === 'warn' && e.message.includes('notes.csv')));
    });

    it('picks up new files on the next sync', () => {
        fs.copyFileSync(path.join(fixtures.chartsDir, 'TEST_D1.csv'), path.join(fixtures.chartsDir, 'GBPUSD_H1.csv'));
        fs.writeFileSync(path.join(fixtures.strategiesDir, 'Fresh.js'), "module.exports = { name: 'Fresh', strategy: { entryRule() {} } };");
        context.catalogService.sync();
        assert.equal(chart('GBPUSD_H1').symbol, 'GBPUSD');
        assert.equal(strategy('Fresh').isAvailable, true);
    });

    it('marks deleted files unavailable but keeps the rows, and restores them when the file returns', () => {
        const holdId = strategy('HoldThreeBars').id;
        const chartId = chart('TEST_D1').id;
        const strategyFile = path.join(fixtures.strategiesDir, 'HoldThreeBars.js');
        const chartFile = path.join(fixtures.chartsDir, 'TEST_D1.csv');
        const strategySource = fs.readFileSync(strategyFile);
        const chartSource = fs.readFileSync(chartFile);

        fs.rmSync(strategyFile);
        fs.rmSync(chartFile);
        context.catalogService.sync();
        assert.deepEqual([strategy('HoldThreeBars').isAvailable, strategy('HoldThreeBars').loadError], [false, 'File not found']);
        assert.equal(chart('TEST_D1').isAvailable, false);

        fs.writeFileSync(strategyFile, strategySource);
        fs.writeFileSync(chartFile, chartSource);
        context.catalogService.sync();
        assert.deepEqual([strategy('HoldThreeBars').id, strategy('HoldThreeBars').isAvailable, strategy('HoldThreeBars').loadError], [holdId, true, null]);
        assert.deepEqual([chart('TEST_D1').id, chart('TEST_D1').isAvailable], [chartId, true]);
    });

    it('keeps the last good name when a strategy file breaks, and updates it when the file is fixed', () => {
        const file = path.join(fixtures.strategiesDir, 'HoldThreeBars.js');
        fs.writeFileSync(file, 'module.exports = {');
        context.catalogService.sync();
        assert.equal(strategy('HoldThreeBars').name, 'Hold three bars');
        assert.equal(strategy('HoldThreeBars').isAvailable, false);

        fs.writeFileSync(file, "module.exports = { name: 'Renamed', strategy: { entryRule() {} } };");
        context.catalogService.sync();
        assert.equal(strategy('HoldThreeBars').name, 'Renamed');
        assert.equal(strategy('HoldThreeBars').isAvailable, true);
    });

    it('activation is kept across syncs', () => {
        const id = strategy('HoldThreeBars').id;
        assert.equal(context.catalogService.setStrategyActive(id, false).isActive, false);
        assert.equal(context.catalogService.setChartActive(chart('TEST_D1').id, false).isActive, false);
        context.catalogService.sync();
        assert.equal(strategy('HoldThreeBars').isActive, false);
        assert.equal(chart('TEST_D1').isActive, false);
        assert.equal(context.catalogService.setStrategyActive(id, true).isActive, true);
    });

    it('setStrategyActive / setChartActive / getStrategy throw 404 for unknown ids', () => {
        for (const fn of [
            () => context.catalogService.setStrategyActive(999, true),
            () => context.catalogService.setChartActive(999, true),
            () => context.catalogService.getStrategy(999),
        ]) {
            assert.throws(fn, (err) => err.status === 404);
        }
    });

    it('does nothing harmful when the folders do not exist', () => {
        const { context: empty } = createTradeApp({ chartsDir: '/nope/charts', strategiesDir: '/nope/strategies' });
        assert.deepEqual(empty.catalogService.listStrategies(), []);
        assert.deepEqual(empty.catalogService.listCharts(), []);
    });
});
