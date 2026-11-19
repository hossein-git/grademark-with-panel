'use strict';

// Test fixture: blocks forever, used to test the backtest timeout.
module.exports = {
    name: 'Never finishes',
    strategy: {
        entryRule: () => {
            for (;;) { /* spin */ }
        },
    },
};
