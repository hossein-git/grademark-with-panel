'use strict';

/**
 * Sample strategy: SMA 20/50 crossover (long only) with a 2% stop loss.
 *
 * Strategy file format (every .js file in this folder is a strategy; its key is the file name):
 *   module.exports = {
 *       name: 'Display name',            // optional, defaults to the file name
 *       description: 'What it does',     // optional
 *       strategy: { ... },               // a Grademark IStrategy (see src/lib/strategy.ts)
 *   };
 *
 * `strategy.prepIndicators({ inputSeries, parameters })` receives the chart bars
 * ({ time, open, high, low, close, ... }) as a Data-Forge DataFrame and returns them with indicator columns added.
 * `strategy.parameters` is stored with every backtest, so results can be traced back to the settings used.
 */
require('data-forge-indicators');

module.exports = {
    name: 'Sample Strategy (SMA 20/50 crossover)',
    description: 'Goes long when the 20-bar SMA is above the 50-bar SMA and exits when it crosses back below. 2% stop loss.',

    strategy: {
        parameters: {
            fastPeriod: 20,
            slowPeriod: 50,
            stopLossPct: 2,
        },

        prepIndicators: ({ inputSeries, parameters }) => {
            const fast = inputSeries.deflate((bar) => bar.close).sma(parameters.fastPeriod);
            const slow = inputSeries.deflate((bar) => bar.close).sma(parameters.slowPeriod);
            return inputSeries
                .withSeries('smaFast', fast)
                .withSeries('smaSlow', slow)
                .skip(parameters.slowPeriod);
        },

        entryRule: (enterPosition, args) => {
            if (args.bar.smaFast > args.bar.smaSlow) {
                enterPosition({ direction: 'long' });
            }
        },

        exitRule: (exitPosition, args) => {
            if (args.bar.smaFast < args.bar.smaSlow) {
                exitPosition();
            }
        },

        stopLoss: (args) => args.entryPrice * (args.parameters.stopLossPct / 100),
    },
};
