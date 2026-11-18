const dataForge = require('data-forge');
require('data-forge-fs');
require('data-forge-indicators');
const { backtest, analyze, computeEquityCurve, computeDrawdown } = require('./build/index');

let inputSeries = dataForge.readFileSync("./Charts/EURUSD_D1.csv")
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

const sma20 = inputSeries.deflate(bar => bar.close).sma(20);
const sma50 = inputSeries.deflate(bar => bar.close).sma(50);

inputSeries = inputSeries
    .withSeries("sma20", sma20)
    .withSeries("sma50", sma50)
    .skip(50);

const strategy = {
    entryRule: (enterPosition, args) => {
        if (args.bar.sma20 > args.bar.sma50) {
            enterPosition({ direction: "long" });
        }
    },

    exitRule: (exitPosition, args) => {
        if (args.bar.sma20 < args.bar.sma50) {
            exitPosition();
        }
    },

    stopLoss: args => {
        return args.entryPrice * (2 / 100);
    },
};

const trades = backtest(strategy, inputSeries);
console.log("Made " + trades.length + " trades!");
console.log("");

const startingCapital = 10000;
const analysis = analyze(startingCapital, trades);
console.log("=== Analysis ===");
console.log(JSON.stringify(analysis, null, 2));
