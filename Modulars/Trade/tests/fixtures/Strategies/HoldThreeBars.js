'use strict';

// Test strategy with predictable trades: always long, exits after holding `holdBars` bars.
module.exports = {
    name: 'Hold three bars',
    description: 'Test fixture: always enters long and exits after three bars.',
    strategy: {
        parameters: { holdBars: 3 },
        entryRule: (enterPosition) => enterPosition({ direction: 'long' }),
        exitRule: (exitPosition, args) => {
            if (args.position.holdingPeriod >= args.parameters.holdBars) exitPosition();
        },
    },
};
