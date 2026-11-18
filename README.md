# Grademark with Panel

An algo trading backtester with an admin panel, built on top of [Grademark](https://github.com/grademark/grademark). Load your chart data, define strategies, run backtests, and view results through a web dashboard.

## Tech Stack

- **Backtesting engine**: [Grademark](https://github.com/grademark/grademark) + [Data-Forge](http://data-forge-js.com/)
- **Backend**: Node.js + Express + SQLite
- **Frontend**: Vue 3 + Vuetify

## Features

- Run backtests from the admin panel or command line
- Support for multiple symbols and timeframes
- Define custom strategies with entry/exit rules
- Built-in indicators (SMA, EMA, etc.) via Data-Forge Indicators
- Intrabar stop loss, profit target, and trailing stop loss
- Conditional entry at a price level
- Equity curve and drawdown visualization
- Results dashboard with filtering and sorting
- Batch backtest across all symbols at once

## Data Format

Your CSV data needs the following columns, sorted in forward chronological order (oldest first):

```typescript
interface IBar {
    time: Date;
    open: number;
    high: number;
    low: number;
    close: number;
}
```

## How It Works

### Import modules

```javascript
const dataForge = require('data-forge');
require('data-forge-fs');
require('data-forge-indicators');
const { backtest, analyze, computeEquityCurve, computeDrawdown } = require('grademark');
```

### Load your data

```javascript
let inputSeries = dataForge.readFileSync("EURUSD_H1.csv")
    .parseCSV({ separator: '\t' })
    .parseDates("<DATE>", "YYYY.MM.DD")
    .parseFloats(["<OPEN>", "<HIGH>", "<LOW>", "<CLOSE>"])
    .renameSeries({
        "<DATE>": "time",
        "<OPEN>": "open",
        "<HIGH>": "high",
        "<LOW>": "low",
        "<CLOSE>": "close",
    });
```

### Add indicators

```javascript
const movingAverage = inputSeries
    .deflate(bar => bar.close)
    .sma(30);

inputSeries = inputSeries
    .withSeries("sma", movingAverage)
    .skip(30);
```

### Create a strategy

```javascript
const strategy = {
    entryRule: (enterPosition, args) => {
        if (args.bar.close < args.bar.sma) {
            enterPosition({ direction: "long" });
        }
    },

    exitRule: (exitPosition, args) => {
        if (args.bar.close > args.bar.sma) {
            exitPosition();
        }
    },

    stopLoss: args => {
        return args.entryPrice * (5/100);
    },
};
```

### Run a backtest

```javascript
const trades = backtest(strategy, inputSeries);
console.log("Made " + trades.length + " trades!");

const startingCapital = 10000;
const analysis = analyze(startingCapital, trades);
console.log(analysis);
```

### Visualize results

```javascript
computeEquityCurve(trades)
    .plot()
    .renderImage("output/my-equity-curve.png");

computeDrawdown(trades)
    .plot()
    .renderImage("output/my-drawdown.png");
```

## Project Structure

```
grademark-with-panel/
├── backend/        # Express API + Grademark backtesting engine
├── frontend/       # Vue 3 + Vuetify admin dashboard
├── data/           # CSV chart data files
└── strategies/     # Strategy definition files
```

## Installation

```bash
npm install
```

## License

MIT
