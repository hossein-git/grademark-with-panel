// Runs the sample strategy (Modulars/Trade/Strategies/SampleStrategy.js), prints the
// analysis and saves the backtest to the database so it shows up in the admin panel.
//
//   node SampleStrategy              -> runs on Charts/EURUSD_D1.csv
//   node SampleStrategy GBPUSD_H4    -> runs on Charts/GBPUSD_H4.csv
//
// Any strategy/chart: npm run backtest -- --strategy <Key> --chart <SYMBOL_TIMEFRAME>
// Requires the engine to be built first: npm run build
const { main } = require('./Modulars/Trade/scripts/run-backtest');

const chart = process.argv[2] || 'EURUSD_D1';

main(['--strategy', 'SampleStrategy', '--chart', chart]).then((code) => {
    process.exitCode = code;
}, (err) => {
    console.error(err);
    process.exitCode = 1;
});
