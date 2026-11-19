'use strict';

/**
 * Runs a backtest from the command line, saves it to the database and prints the result.
 * The result then shows up in the admin panel (Backtesting > Results).
 *
 *   npm run backtest -- --strategy SampleStrategy --chart EURUSD_D1 [--capital 10000]
 *
 * --strategy is the strategy file name in Modulars/Trade/Strategies (without .js).
 * --chart is the chart file name in Charts/ (without .csv).
 */

const { parseArgs } = require('node:util');
const { loadConfig } = require('../../Base/config');
const { bootstrap } = require('../../Base/bootstrap');
const { DEFAULT_STARTING_CAPITAL } = require('../trade.validation');
const modules = require('../..');

const USAGE = 'Usage: npm run backtest -- --strategy <StrategyKey> --chart <SYMBOL_TIMEFRAME> [--capital 10000]';

async function main(argv = process.argv.slice(2), { env = process.env, out = console } = {}) {
    let values;
    try {
        ({ values } = parseArgs({
            args: argv,
            options: {
                strategy: { type: 'string' },
                chart: { type: 'string' },
                capital: { type: 'string' },
                help: { type: 'boolean', short: 'h' },
            },
        }));
    } catch (err) {
        out.error(`${err.message}\n${USAGE}`);
        return 1;
    }
    if (values.help) {
        out.log(USAGE);
        return 0;
    }
    if (!values.strategy || !values.chart) {
        out.error(`--strategy and --chart are required.\n${USAGE}`);
        return 1;
    }
    const startingCapital = values.capital === undefined ? DEFAULT_STARTING_CAPITAL : Number(values.capital);
    if (!Number.isFinite(startingCapital) || startingCapital <= 0) {
        out.error(`--capital must be a positive number.\n${USAGE}`);
        return 1;
    }

    const { db, context } = bootstrap({ config: loadConfig(env), modules, logger: out });
    try {
        const { catalogModel, backtestService } = context;
        const strategy = catalogModel.findStrategyByKey(values.strategy);
        if (!strategy) {
            out.error(`Unknown strategy "${values.strategy}". Available: ${catalogModel.listStrategies().map((s) => s.key).join(', ') || 'none'}`);
            return 1;
        }
        const chart = catalogModel.findChartByName(values.chart.toUpperCase());
        if (!chart) {
            out.error(`Unknown chart "${values.chart}". Available: ${catalogModel.listCharts().map((c) => c.name).join(', ') || 'none'}`);
            return 1;
        }

        let started;
        try {
            started = backtestService.start({ strategyId: strategy.id, chartId: chart.id, startingCapital });
        } catch (err) {
            if (err.status) {
                out.error(err.message);
                return 1;
            }
            throw err;
        }

        const result = await started.done;
        if (result.status !== 'completed') {
            out.error(`Backtest #${result.id} failed: ${result.error}`);
            return 1;
        }

        const detail = backtestService.getDetail(result.id);
        out.log(`Made ${detail.tradeCount} trades!`);
        out.log('');
        out.log('=== Analysis ===');
        out.log(JSON.stringify(detail.analysis, null, 2));
        out.log('');
        out.log(`Saved as backtest #${detail.id} (${detail.strategy.name} on ${detail.chart.name}).`);
        return 0;
    } finally {
        db.close();
    }
}

if (require.main === module) {
    main().then((code) => {
        process.exitCode = code;
    }, (err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

module.exports = { main };
