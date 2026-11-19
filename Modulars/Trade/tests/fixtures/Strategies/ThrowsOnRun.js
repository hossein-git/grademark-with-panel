'use strict';

// Test fixture: loads fine but fails while the backtest runs.
module.exports = {
    name: 'Throws on run',
    strategy: {
        entryRule: () => {
            throw new Error('boom from strategy');
        },
    },
};
